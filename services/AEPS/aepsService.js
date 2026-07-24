const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const aepsProviderRouter = require('./aepsProviderRouter');
const aepsWalletService = require('./aepsWalletService');
const aepsLogger = require('../../utils/aepsLogger');
const { processCommission } = require('../Commission/commissionService');   // ✅ only commission service
const vimopayAepsProvider = require('../../providers/vimopayAepsProvider');

// ---------- Bank IIN cache ----------
const bankIINCache = {
  data: null,
  lastFetched: 0,
  TTL: 60 * 60 * 1000, // 1 hour
};

// ==============================
// Helper: Insert provider log (pending)
// ==============================
const insertPendingLog = async (clientOrDb, params) => {
  const { module, merchant_ref_id, transaction_id, transaction_type, request_payload } = params;
  const query = `
    INSERT INTO provider_logs 
      (module, merchant_ref_id, transaction_id, transaction_type, request_payload, final_status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id
  `;
  const values = [module, merchant_ref_id, transaction_id, transaction_type, request_payload, 'pending'];
  const res = await clientOrDb.query(query, values);
  return res.rows[0].id;
};

const updateLog = async (clientOrDb, logId, response_payload, response_time_ms, final_status, http_status, error_message) => {
  const query = `
    UPDATE provider_logs 
    SET response_payload = $1, response_time_ms = $2, final_status = $3,
        http_status = $4, error_message = $5, updated_at = NOW()
    WHERE id = $6
  `;
  await clientOrDb.query(query, [response_payload, response_time_ms, final_status, http_status, error_message, logId]);
};

// ==============================
// Merchant Registration (pipe‑aware)
// ==============================

// const getMerchantStatus = async (userId, pipe = '2') => {
//   try {
//     if (!['1', '2', '3'].includes(pipe)) {
//       throw new Error('Invalid pipe value. Must be "1", "2", or "3".');
//     }
    
//     const result = await db.query(
//       `SELECT merchant_id, registration_status, state_code, district_code, 
//               shop_address, pipe, merchant_ref_id
//        FROM aeps_merchants WHERE user_id = $1 AND pipe = $2`,
//       [userId, pipe]
//     );
//     if (result.rows.length === 0) return { isRegistered: false, pipe };
//     const row = result.rows[0];
//     return {
//       isRegistered:       true,
//       registrationStatus: row.registration_status,
//       merchantId:         row.merchant_id,
//       stateCode:          row.state_code,
//       districtCode:       row.district_code,
//       shopAddress:        row.shop_address,
//       pipe:               row.pipe,
//       merchantRefId:      row.merchant_ref_id,
//     };
//   } catch (error) {
//     console.error('getMerchantStatus error:', error);
//     throw new Error('Failed to get merchant status');
//   }
// };



const getAllMerchantStatuses = async (userId) => {
  const result = await db.query(
    `SELECT merchant_id, merchant_ref_id, registration_status, pipe,
            state_code, district_code, shop_address
     FROM aeps_merchants WHERE user_id = $1`,
    [userId]
  );
  return result.rows.map(row => ({
    isRegistered: true,
    merchantId: row.merchant_id,
    merchantRefId: row.merchant_ref_id,
    registrationStatus: row.registration_status,
    pipe: row.pipe,
    stateCode: row.state_code,
    districtCode: row.district_code,
    shopAddress: row.shop_address,
  }));
};



const registerMerchant = async (userId, data) => {
  const {
    stateCode, districtCode, shopAddress, shopPincode,
    bankAccount, bankIfsc, bankNameCode, pipe,
    merchantRefId: customRefId, ipAddress, lat, long,
    firstName, lastName, middleName, dob,
    merchantPhoneNumber, merchantAddress1, merchantAddress2,
    merchantPan, shopPan, aadhaarNo, pidData,
  } = data;

  const startTime = Date.now();
  let logId = null;
  const merchantRefId = customRefId || `NEO_${userId}_${Date.now()}`;

  try {
    if (!pipe || !['1', '2', '3', '4'].includes(pipe)) {
      throw new Error('Valid pipe (1, 2, 3, or 4) is required');
    }
    
    const existing = await db.query(
      'SELECT id FROM aeps_merchants WHERE user_id = $1 AND pipe = $2',
      [userId, pipe]
    );
    if (existing.rows.length > 0) throw new Error(`Merchant already registered for pipe ${pipe}`);

    // ✅ Fetch the logged‑in user's email from the users table
    const userRes = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
    const userEmail = userRes.rows[0]?.email;
    if (!userEmail) {
      throw new Error('User email not found. Please check your profile.');
    }

    const requestPayload = {
      stateCode, districtCode, shopAddress, shopPincode, bankAccount, bankIfsc, bankNameCode, pipe,
      merchantRefId, ipAddress, lat, long, firstName, lastName, middleName, dob,
      merchantPhoneNumber, merchantAddress1, merchantAddress2, merchantPan, shopPan, aadhaarNo,
      email: userEmail,   // for logging
    };

    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantRefId,
      transaction_id: null,
      transaction_type: 'aeps_register_merchant',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.registerMerchant({
      stateCode, districtCode, shopAddress, shopPincode,
      bankAccount, bankIfsc, bankNameCode, pipe: pipe || '1',
      merchantRefId, ipAddress: ipAddress || '127.0.0.1',
      lat: lat || '0.0', long: long || '0.0',
      firstName, lastName, middleName: middleName || '',
      dob, merchantPhoneNumber,
      merchantAddress1, merchantAddress2: merchantAddress2 || '',
      merchantPan: merchantPan || 'AAAAA0000A',
      shopPan: shopPan || 'AAAAA0000A',
      aadhaarNo,
      pidData,
      emailId: userEmail,   // ✅ pass the real email to the provider
    });

    // ✅ Insert only when provider returns success (status '000')
    if (providerResult.status === '000') {
      await db.query(
        `INSERT INTO aeps_merchants 
           (user_id, merchant_ref_id, merchant_id, txn_ref_id, registration_status, 
            state_code, district_code, shop_address, shop_pincode, bank_account, bank_ifsc, bank_name_code, pipe,
            registered_at, raw_response)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), $14)`,
        [
          userId,
          providerResult.merchantRefId || merchantRefId,
          providerResult.merchantId || null,
          providerResult.txnRefId || null,
          providerResult.status === '000' ? 'otp_pending' : 'pending',
          stateCode, districtCode, shopAddress, shopPincode,
          bankAccount, bankIfsc, bankNameCode, pipe || '1',
          JSON.stringify(providerResult),
        ]
      );
    } else {
      // Provider registration failed – do NOT insert into DB
      await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime, 'failed', 200, providerResult.statusDescription);
      throw new Error(`Provider registration failed: ${providerResult.statusDescription || 'Unknown error'}`);
    }

    await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    return {
      status:            providerResult.status,
      merchantStatus:    providerResult.merchantStatus,
      statusDescription: providerResult.statusDescription,
      merchantId:        providerResult.merchantId,
      txnRefId:          providerResult.txnRefId,
      merchantRefId:     providerResult.merchantRefId,
      pipe:              providerResult.pipe,
    };
  } catch (error) {
    if (logId) await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('registerMerchant error:', error);
    throw error;
  }
};

// ==============================
// Master Data (no logging needed)
// ==============================

const getBankList = async () => {
  try { return await aepsProviderRouter.getBankList(); }
  catch (error) { throw new Error('Failed to fetch banks'); }
};

const getStateList = async () => {
  try { return await aepsProviderRouter.getStateList(); }
  catch (error) { throw new Error('Failed to fetch states'); }
};

const getDistrictList = async (stateCode) => {
  try { return await aepsProviderRouter.getDistrictList(stateCode); }
  catch (error) { throw new Error('Failed to fetch districts'); }
};

// ==============================
// Bank IINs - Cache
// ==============================
const getBankIINs = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && bankIINCache.data && (now - bankIINCache.lastFetched) < bankIINCache.TTL) {
    console.log('[SERVICE] Returning cached bank IINs, count:', bankIINCache.data.length);
    return bankIINCache.data;
  }
  console.log('[SERVICE] Fetching fresh bank IINs from provider...');
  let iins = [];
  try {
    iins = await aepsProviderRouter.getBankIINs();
  } catch (err) {
    console.error('[SERVICE] Failed to fetch bank IINs:', err.message);
    if (bankIINCache.data && bankIINCache.data.length > 0) {
      console.warn('[SERVICE] Returning stale cache due to provider error');
      return bankIINCache.data;
    }
    throw new Error('Failed to fetch bank IINs: ' + err.message);
  }
  if (Array.isArray(iins) && iins.length > 0) {
    bankIINCache.data = iins;
    bankIINCache.lastFetched = now;
    console.log('[SERVICE] Cached fresh bank IINs, count:', iins.length);
  } else {
    console.warn('[SERVICE] Provider returned empty or invalid bank IINs – not caching');
  }
  return iins;
};

// ==============================
// OTP (pipe‑aware)
// ==============================
const sendOTP = async (userId, pipe, { merchantId, merchantRefId }) => {
  const startTime = Date.now();
  let logId = null;
  try {
    if (!['1', '2', '3', '4'].includes(pipe)) {
      throw new Error('Invalid pipe value');
    }
    
    const merchant = await db.query(
      'SELECT id FROM aeps_merchants WHERE user_id = $1 AND pipe = $2 AND merchant_id = $3',
      [userId, pipe, merchantId]
    );
    if (merchant.rows.length === 0) throw new Error('Merchant not found for this pipe');

    const requestPayload = { merchantId, merchantRefId, pipe };
    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantRefId,
      transaction_id: null,
      transaction_type: 'aeps_send_otp',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.sendOTP({ merchantId, merchantRefId, pipe });

    await db.query(
      `UPDATE aeps_merchants SET registration_status = 'otp_sent' WHERE merchant_id = $1 AND pipe = $2`,
      [merchantId, pipe]
    );

    await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    return providerResult;
  } catch (error) {
    if (logId) await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('sendOTP error:', error);
    throw error;
  }
};

const resendOTP = async (userId, pipe, { merchantId, merchantRefId }) => {
  const startTime = Date.now();
  let logId = null;
  try {
    if (!['1', '2', '3', '4'].includes(pipe)) {
      throw new Error('Invalid pipe value');
    }
    
    const merchant = await db.query(
      'SELECT id FROM aeps_merchants WHERE user_id = $1 AND pipe = $2 AND merchant_id = $3',
      [userId, pipe, merchantId]
    );
    if (merchant.rows.length === 0) throw new Error('Merchant not found for this pipe');

    const requestPayload = { merchantId, merchantRefId, pipe };
    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantRefId,
      transaction_id: null,
      transaction_type: 'aeps_resend_otp',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.resendOTP({ merchantId, merchantRefId, pipe });

    await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    return providerResult;
  } catch (error) {
    if (logId) await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('resendOTP error:', error);
    throw error;
  }
};

const verifyOTP = async (userId, pipe, { merchantId, merchantRefId, otp }) => {
  const startTime = Date.now();
  let logId = null;
  try {
    if (!['1', '2', '3', '4'].includes(pipe)) {
      throw new Error('Invalid pipe value');
    }
    
    const merchant = await db.query(
      'SELECT id FROM aeps_merchants WHERE user_id = $1 AND pipe = $2 AND merchant_id = $3',
      [userId, pipe, merchantId]
    );
    if (merchant.rows.length === 0) throw new Error('Merchant not found for this pipe');

    const requestPayload = { merchantId, merchantRefId, otp, pipe };
    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantRefId,
      transaction_id: null,
      transaction_type: 'aeps_verify_otp',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.verifyOTP({ merchantId, merchantRefId, otp, pipe });

    if (providerResult.status === '000') {
      await db.query(
        `UPDATE aeps_merchants SET registration_status = 'otp_verified' WHERE merchant_id = $1 AND pipe = $2`,
        [merchantId, pipe]
      );
    }

    await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    // Commission for mini statement (only on success, flat fee)
    if (providerResult.status === '000') {
      await processCommission('aeps', 0, userId, { subType: 'mini_statement' })
        .catch(err => console.error('AEPS mini-statement commission failed:', err.message));
    }
      
    return providerResult;
  } catch (error) {
    if (logId) await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('verifyOTP error:', error);
    throw error;
  }
};

// ==============================
// E-KYC (pipe‑aware)
// ==============================
const performEkyc = async (userId, pipe, { merchantId, merchantRefId, pidData, deviceType, aadhaarNumber, ipAddress }) => {
  const startTime = Date.now();
  let logId = null;
  try {
    if (!['1', '2', '3', '4'].includes(pipe)) {
      throw new Error('Invalid pipe value');
    }
    
    const merchant = await db.query(
      'SELECT id FROM aeps_merchants WHERE user_id = $1 AND pipe = $2 AND merchant_id = $3',
      [userId, pipe, merchantId]
    );
    if (merchant.rows.length === 0) throw new Error('Merchant not found for this pipe');

    const requestPayload = { merchantId, merchantRefId, pipe, deviceType, aadhaarNumber, ipAddress };
    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantRefId,
      transaction_id: null,
      transaction_type: 'aeps_ekyc',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.merchantEkyc({
      merchantId,
      merchantRefId,
      pipe,
      pidData,
      deviceType: deviceType || 'mantra',
      aadhaarNumber,
    });

    if (providerResult.status === '000') {
      await db.query(
        `UPDATE aeps_merchants SET registration_status = 'active' WHERE merchant_id = $1 AND pipe = $2`,
        [merchantId, pipe]
      );
    }

    await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    return providerResult;
  } catch (error) {
    if (logId) await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('performEkyc error:', error);
    throw error;
  }
};

// ==============================
// Daily 2FA (pipe‑aware)
// ==============================
// In your aepsProviderRouter.perform2FA function
// ==============================
// Daily 2FA (pipe‑aware) - FIXED
// ==============================
const perform2FA = async (userId, pipe, params) => {
  const startTime = Date.now();
  let logId = null;

  try {
    if (!['1', '2', '3', '4'].includes(pipe)) {
      throw new Error('Invalid pipe value. Must be "1", "2", "3", or "4".');
    }

    const { merchantId, merchantRefId, aadhaarNumber, deviceType, pidData, lat, long, ipAddress } = params;

    console.log('[AEPS Service] ════════════════════════════════════════════');
    console.log('[AEPS Service] perform2FA called with:');
    console.log('[AEPS Service]   userId:', userId);
    console.log('[AEPS Service]   merchantId:', merchantId);
    console.log('[AEPS Service]   merchantRefId:', merchantRefId);
    console.log('[AEPS Service]   aadhaarNumber:', aadhaarNumber ? '****' + aadhaarNumber.slice(-4) : 'NULL');
    console.log('[AEPS Service]   pipe:', pipe);
    console.log('[AEPS Service]   deviceType:', deviceType || 'mantra');
    console.log('[AEPS Service]   pidData length:', pidData ? pidData.length : 0);
    console.log('[AEPS Service] ════════════════════════════════════════════');

    // Validate required fields
    if (!merchantId) {
      throw new Error('merchantId is required');
    }
    if (!merchantRefId) {
      throw new Error('merchantRefId is required');
    }
    if (!aadhaarNumber || !/^\d{12}$/.test(aadhaarNumber)) {
      throw new Error('Valid 12-digit aadhaarNumber is required');
    }
    if (!pidData || pidData.length === 0) {
      throw new Error('pidData (fingerprint data) is required');
    }

    // Verify merchant exists and belongs to this user
    const merchant = await db.query(
      `SELECT id, merchant_ref_id, registration_status 
       FROM aeps_merchants 
       WHERE user_id = $1 AND pipe = $2 AND merchant_id = $3`,
      [userId, pipe, merchantId]
    );
    
    if (merchant.rows.length === 0) {
      throw new Error(`No merchant found for pipe ${pipe}. Please complete registration first.`);
    }

    console.log('[AEPS Service] ✅ Merchant found in DB:', {
      dbId: merchant.rows[0].id,
      status: merchant.rows[0].registration_status,
    });

    // Log the request
    const requestPayload = { 
      merchantId, 
      merchantRefId, 
      aadhaarNumber: '****' + aadhaarNumber.slice(-4), 
      pipe, 
      deviceType: deviceType || 'mantra', 
      pidDataLength: pidData.length 
    };
    
    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantRefId,
      transaction_id: null,
      transaction_type: 'aeps_2fa',
      request_payload: JSON.stringify(requestPayload),
    });

    console.log('[AEPS Service] 📞 Calling vimopayAepsProvider.perform2FA...');
    
    // ✅✅✅ FIX: Call the VimoPay provider DIRECTLY (not callVimoPayAPI)
    const providerResult = await vimopayAepsProvider.perform2FA({
      merchantId,
      merchantRefId,
      aadhaarNumber,
      pipe,
      deviceType: deviceType || 'mantra',
      pidData,
    });

    console.log('[AEPS Service] 📥 Provider response:', {
      status: providerResult.status,
      merchantStatus: providerResult.merchantStatus,
      statusDescription: providerResult.statusDescription,
      merchantId: providerResult.merchantId,
      txnRefId: providerResult.txnRefId,
    });

    // Update last_2fa_at on success
    if (providerResult.status === '000') {
      await db.query(
        `UPDATE aeps_merchants 
         SET last_2fa_at = NOW(), 
             registration_status = CASE 
               WHEN registration_status = 'otp_verified' THEN 'active' 
               ELSE registration_status 
             END
         WHERE merchant_id = $1 AND pipe = $2`,
        [merchantId, pipe]
      );
      console.log('[AEPS Service] ✅ Updated last_2fa_at for merchant:', merchantId);
    }

    // Update log
    await updateLog(
      db, 
      logId, 
      JSON.stringify(providerResult), 
      Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 
      200, 
      null
    );

    return providerResult;

  } catch (error) {
    if (logId) {
      await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    }
    console.error('[AEPS Service] ❌ perform2FA error:', error.message);
    console.error('[AEPS Service] Stack:', error.stack);
    throw error;
  }
};

// ==============================
// AePS Transactions (pipe‑aware + 2FA gate)
// ==============================
const getMerchantInfo = async (userId, pipe, client = db) => {
  if (!['1', '2', '3', '4'].includes(pipe)) {
    throw new Error('Invalid pipe value');
  }
  
  const result = await client.query(
    'SELECT pipe, merchant_id, merchant_ref_id FROM aeps_merchants WHERE user_id = $1 AND pipe = $2',
    [userId, pipe]
  );
  if (result.rows.length === 0) throw new Error(`Merchant not found for pipe ${pipe}`);
  return {
    pipe:          result.rows[0].pipe,
    merchantId:    result.rows[0].merchant_id,
    merchantRefId: result.rows[0].merchant_ref_id,
  };
};

const check2FAGate = async (userId, pipe) => {
  if (!['1', '2', '3', '4'].includes(pipe)) {
    throw new Error('Invalid pipe value');
  }
  
  const merchantCheck = await db.query(
    'SELECT last_2fa_at FROM aeps_merchants WHERE user_id = $1 AND pipe = $2',
    [userId, pipe]
  );
  const last2fa = merchantCheck.rows[0]?.last_2fa_at;
  const today   = new Date().toDateString();
  if (!last2fa || new Date(last2fa).toDateString() !== today) {
    throw new Error('2FA required. Please scan your fingerprint to start your day.');
  }
};




// ===== Helper: Clean numeric values (remove commas, currency symbols, etc.) =====
function cleanNumericValue(value) {
    if (!value) return 0;
    
    // If it's already a number, return it
    if (typeof value === 'number') return value;
    
    // Convert to string and clean
    const cleaned = String(value)
        .replace(/,/g, '')           // Remove commas
        .replace(/[^\d.-]/g, '')     // Remove non-numeric characters (keep . and -)
        .trim();
    
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
}


// Cash Withdrawal
const cashWithdrawal = async (userId, pipe, { amount, bankCode, pidData, accountType, lat, long, device, aadhaarNo, mobileNo, ipAddress }) => {
  if (!['1', '2', '3', '4'].includes(pipe)) {
    throw new Error('Invalid pipe value');
  }
  
  await check2FAGate(userId, pipe);

  const client = await db.connect();
  const transactionRef = `AEPS_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  const startTime = Date.now();
  let logId = null;

  try {
    await client.query('BEGIN');

    const walletResult = await client.query(
      'SELECT id, balance FROM aeps_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (walletResult.rows.length === 0) throw new Error('AePS wallet not found');
    const wallet = walletResult.rows[0];

    const merchantInfo = await getMerchantInfo(userId, pipe, client);

    const txnInsert = await client.query(
      `INSERT INTO aeps_transactions 
         (user_id, aeps_wallet_id, txn_type, amount, status, provider, device_used, pipe, device_type, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING id`,
      [userId, wallet.id, 'cash_withdrawal', amount, 'pending', process.env.AEPS_PROVIDER || 'vimopay', device, pipe, 'app']
)
    const txnId = txnInsert.rows[0].id;

    const requestPayload = { amount, bankCode, accountType, lat, long, device, aadhaarNo, mobileNo, pipe: merchantInfo.pipe, merchantId: merchantInfo.merchantId, ipAddress };
    logId = await insertPendingLog(client, {
      module: 'aeps',
      merchant_ref_id: merchantInfo.merchantRefId,
      transaction_id: txnId,
      transaction_type: 'aeps_cash_withdrawal',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.cashWithdrawal({
      amount, bankCode, pidData, accountType, lat, long, device, aadhaarNo, mobileNo,
      pipe: merchantInfo.pipe,
      merchantId: merchantInfo.merchantId,
      ipAddress: ipAddress || '127.0.0.1',
    });

  // ✅ Clean the numeric value before inserting
  const cleanedBalance = cleanNumericValue(providerResult.availableBalance);
  
  await client.query(
    `UPDATE aeps_transactions 
     SET rrn=$1, provider_txn_ref=$2, npci_code=$3, npci_message=$4,
         bank_iin=$5, bank_name=$6, aadhaar_last4=$7,
         available_balance=$8, status=$9, raw_response=$10, updated_at=NOW()
     WHERE id=$11`,
    [
      providerResult.rrn || null,
      providerResult.txnRefId || null,
      providerResult.npciCode || null,
      providerResult.npciMessage || null,
      providerResult.bankIIN || null,
      providerResult.bankName || null,
      providerResult.aadhaarNo ? providerResult.aadhaarNo.slice(-4) : null,
      cleanedBalance,  // ✅ CLEANED - no comma
      providerResult.status === '000' ? 'success' : 'failed',
      JSON.stringify(providerResult),
      txnId,
    ]
  );

    await updateLog(client, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    if (providerResult.status === '000') {
      await aepsWalletService.creditAepsWallet(
        userId, amount,
        `Cash withdrawal settlement - RRN: ${providerResult.rrn}`,
        `txn_${txnId}`, null, client
      );
      // ✅ Commission for withdrawal
      await processCommission('aeps', amount, userId, 
        { subType: 'withdrawal' }
      ).catch(err => console.error('AEPS withdrawal commission failed:', err.message));
    }

    await client.query('COMMIT');

    aepsLogger.log({ userId, type: 'cash_withdrawal', status: providerResult.status === '000' ? 'success' : 'failed', providerResult });

    return {
      ...providerResult,
      transactionId: txnId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (logId) await updateLog(client, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('cashWithdrawal error:', error);
    aepsLogger.log({ userId, type: 'cash_withdrawal', status: 'error', error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

// Cash Deposit
const cashDeposit = async (userId, pipe, { amount, bankCode, pidData, accountType, lat, long, device, aadhaarNo, mobileNo, ipAddress }) => {
  if (!['1', '2', '3', '4'].includes(pipe)) {
    throw new Error('Invalid pipe value');
  }
  
  await check2FAGate(userId, pipe);

  const client = await db.connect();
  const transactionRef = `AEPS_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  const startTime = Date.now();
  let logId = null;

  try {
    await client.query('BEGIN');

    const walletResult = await client.query(
      'SELECT id, balance FROM aeps_wallets WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (walletResult.rows.length === 0) throw new Error('AePS wallet not found');
    const wallet = walletResult.rows[0];

    const merchantInfo = await getMerchantInfo(userId, pipe, client);

    const txnInsert = await client.query(
      `INSERT INTO aeps_transactions 
         (user_id, aeps_wallet_id, txn_type, amount, status, provider, device_used, pipe, device_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING id`,
      [userId, wallet.id, 'cash_deposit', amount, 'pending', process.env.AEPS_PROVIDER || 'vimopay', device, pipe, 'app']
    );
    const txnId = txnInsert.rows[0].id;

    const requestPayload = { amount, bankCode, accountType, lat, long, device, aadhaarNo, mobileNo, pipe: merchantInfo.pipe, merchantId: merchantInfo.merchantId, ipAddress };
    logId = await insertPendingLog(client, {
      module: 'aeps',
      merchant_ref_id: merchantInfo.merchantRefId,
      transaction_id: txnId,
      transaction_type: 'aeps_cash_deposit',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.cashDeposit({
      amount, bankCode, pidData, accountType, lat, long, device, aadhaarNo, mobileNo,
      pipe: merchantInfo.pipe,
      merchantId: merchantInfo.merchantId,
      ipAddress: ipAddress || '127.0.0.1',
    });

  // ✅ Clean the numeric value before inserting
  const cleanedBalance = cleanNumericValue(providerResult.availableBalance);
  
  await client.query(
    `UPDATE aeps_transactions 
     SET rrn=$1, provider_txn_ref=$2, npci_code=$3, npci_message=$4,
         bank_iin=$5, bank_name=$6, aadhaar_last4=$7,
         available_balance=$8, status=$9, raw_response=$10, updated_at=NOW()
     WHERE id=$11`,
    [
      providerResult.rrn || null,
      providerResult.txnRefId || null,
      providerResult.npciCode || null,
      providerResult.npciMessage || null,
      providerResult.bankIIN || null,
      providerResult.bankName || null,
      providerResult.aadhaarNo ? providerResult.aadhaarNo.slice(-4) : null,
      cleanedBalance,  // ✅ CLEANED - no comma
      providerResult.status === '000' ? 'success' : 'failed',
      JSON.stringify(providerResult),
      txnId,
    ]
  );
  
    await updateLog(client, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    if (providerResult.status === '000') {
      await aepsWalletService.debitAepsWallet(
        userId, amount,
        `Cash deposit to customer - RRN: ${providerResult.rrn}`,
        `txn_${txnId}`, null, client
      );
      // ✅ Commission for deposit (flat fee, amount not used)
      await processCommission('aeps', amount, userId, 
        { subType: 'deposit' }
      ).catch(err => console.error('AEPS deposit commission failed:', err.message));
    }

    await client.query('COMMIT');

    aepsLogger.log({ userId, type: 'cash_deposit', status: providerResult.status === '000' ? 'success' : 'failed', providerResult });

    return {
      ...providerResult,
      transactionId: txnId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (logId) await updateLog(client, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('cashDeposit error:', error);
    aepsLogger.log({ userId, type: 'cash_deposit', status: 'error', error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

// Balance Enquiry
const balanceEnquiry = async (userId, pipe, { bankCode, pidData, accountType, device, aadhaarNo, mobileNo, lat, long, ipAddress }) => {
  if (!['1', '2', '3', '4'].includes(pipe)) {
    throw new Error('Invalid pipe value');
  }
  
  await check2FAGate(userId, pipe);
  const startTime = Date.now();
  let logId = null;

  try {
    const walletResult = await db.query(
      'SELECT id FROM aeps_wallets WHERE user_id = $1',
      [userId]
    );
    const walletId = walletResult.rows[0]?.id;
    if (!walletId) throw new Error('AePS wallet not found');

    const merchantInfo = await getMerchantInfo(userId, pipe);

    const txnInsert = await db.query(
      `INSERT INTO aeps_transactions 
         (user_id, aeps_wallet_id, txn_type, status, provider, device_used, pipe, device_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id`,
      [userId, walletId, 'balance_enquiry', 'pending', process.env.AEPS_PROVIDER || 'vimopay', device, pipe, 'app']
    );
    const txnId = txnInsert.rows[0].id;

    const requestPayload = { bankCode, accountType, device, aadhaarNo, mobileNo, lat, long, pipe: merchantInfo.pipe, merchantId: merchantInfo.merchantId, ipAddress };
    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantInfo.merchantRefId,
      transaction_id: txnId,
      transaction_type: 'aeps_balance_enquiry',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.balanceEnquiry({
      bankCode, pidData, accountType, aadhaarNo, mobileNo,
      lat: lat || '0.0',
      long: long || '0.0',
      pipe: merchantInfo.pipe,
      merchantId: merchantInfo.merchantId,
      ipAddress: ipAddress || '127.0.0.1',
    });

      // ✅ Clean the numeric value before inserting
   const cleanedBalance = cleanNumericValue(providerResult.availableBalance);
   
  await db.query(
    `UPDATE aeps_transactions 
     SET rrn=$1, provider_txn_ref=$2, npci_code=$3, npci_message=$4,
         bank_iin=$5, bank_name=$6, aadhaar_last4=$7,
         available_balance=$8, status=$9, raw_response=$10, updated_at=NOW()
     WHERE id=$11`,
    [
      providerResult.rrn || null,
      providerResult.txnRefId || null,
      providerResult.npciCode || null,
      providerResult.npciMessage || null,
      providerResult.bankIIN || null,
      providerResult.bankName || null,
      providerResult.aadhaarNo ? providerResult.aadhaarNo.slice(-4) : null,
      cleanedBalance,  // ✅ CLEANED - no comma
      providerResult.status === '000' ? 'success' : 'failed',
      JSON.stringify(providerResult),
      txnId,
    ]
  );

    await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    return {
      ...providerResult,
      transactionId: txnId,
    };
  } catch (error) {
    if (logId) await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('balanceEnquiry error:', error);
    throw error;
  }
};

// Mini Statement
const miniStatement = async (userId, pipe, { bankCode, pidData, accountType, device, aadhaarNo, mobileNo, lat, long, ipAddress }) => {
  if (!['1', '2', '3', '4'].includes(pipe)) {
    throw new Error('Invalid pipe value');
  }
  
  await check2FAGate(userId, pipe);
  const startTime = Date.now();
  let logId = null;

  try {
    const walletResult = await db.query(
      'SELECT id FROM aeps_wallets WHERE user_id = $1',
      [userId]
    );
    const walletId = walletResult.rows[0]?.id;
    if (!walletId) throw new Error('AePS wallet not found');

    const merchantInfo = await getMerchantInfo(userId, pipe);

    const txnInsert = await db.query(
      `INSERT INTO aeps_transactions 
         (user_id, aeps_wallet_id, txn_type, status, provider, device_used, pipe, device_type, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id`,
      [userId, walletId, 'mini_statement', 'pending', process.env.AEPS_PROVIDER || 'vimopay', device, pipe, 'app']
    );
    const txnId = txnInsert.rows[0].id;

    const requestPayload = { bankCode, accountType, device, aadhaarNo, mobileNo, lat, long, pipe: merchantInfo.pipe, merchantId: merchantInfo.merchantId, ipAddress };
    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantInfo.merchantRefId,
      transaction_id: txnId,
      transaction_type: 'aeps_mini_statement',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.miniStatement({
      bankCode, pidData, accountType, aadhaarNo, mobileNo,
      lat: lat || '0.0',
      long: long || '0.0',
      pipe: merchantInfo.pipe,
      merchantId: merchantInfo.merchantId,
      ipAddress: ipAddress || '127.0.0.1',
    });

    // ✅ Clean the numeric value before inserting
  const cleanedBalance = cleanNumericValue(providerResult.availableBalance);
  
  await db.query(
    `UPDATE aeps_transactions 
     SET rrn=$1, provider_txn_ref=$2, npci_code=$3, npci_message=$4,
         bank_iin=$5, bank_name=$6, aadhaar_last4=$7,
         mini_statement=$8, available_balance=$9,
         status=$10, raw_response=$11, updated_at=NOW()
     WHERE id=$12`,
    [
      providerResult.rrn || null,
      providerResult.txnRefId || null,
      providerResult.npciCode || null,
      providerResult.npciMessage || null,
      providerResult.bankIIN || null,
      providerResult.bankName || null,
      providerResult.aadhaarNo ? providerResult.aadhaarNo.slice(-4) : null,
      JSON.stringify(providerResult.transactionList || []),
      cleanedBalance,  // ✅ CLEANED - no comma
      providerResult.status === '000' ? 'success' : 'failed',
      JSON.stringify(providerResult),
      txnId,
    ]
  );

    await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    // ✅ Commission for mini statement (flat fee)
    if (providerResult.status === '000') {
      await processCommission('aeps', 0, userId, { subType: 'mini_statement' })
        .catch(err => console.error('AEPS mini-statement commission failed:', err.message));
    }

    return {
      ...providerResult,
      transactionId: txnId,
    };
  } catch (error) {
    if (logId) await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('miniStatement error:', error);
    throw error;
  }
};

const getUserTransactions = async (userId, pipe = null) => {
  try {
    let query = `
      SELECT id, txn_type, amount, aadhaar_last4, bank_iin, bank_name, rrn, npci_code, npci_message, status, provider, device_used, created_at
      FROM aeps_transactions WHERE user_id = $1
    `;
    const params = [userId];
    if (pipe) {
      if (!['1', '2', '3', '4'].includes(pipe)) {
        throw new Error('Invalid pipe value');
      }
      query += ` AND pipe = $2`;
      params.push(pipe);
    }
    query += ` ORDER BY created_at DESC`;
    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    throw new Error('Failed to fetch transactions');
  }
};

const getAllTransactions = async (status, type, from, to) => {
  try {
    let query = `
      SELECT t.*, u.first_name, u.last_name, u.email
      FROM aeps_transactions t
      JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    let i = 1;
    if (status) { query += ` AND t.status = $${i++}`; params.push(status); }
    if (type)   { query += ` AND t.txn_type = $${i++}`; params.push(type); }
    if (from)   { query += ` AND t.created_at >= $${i++}`; params.push(from); }
    if (to)     { query += ` AND t.created_at <= $${i++}`; params.push(to); }
    query += ` ORDER BY t.created_at DESC`;
    const result = await db.query(query, params);
    return result.rows;
  } catch (error) {
    throw new Error('Failed to fetch all transactions');
  }
};

const getAllMerchants = async () => {
  try {
    const result = await db.query(`
      SELECT am.*, u.first_name, u.last_name, u.email, u.phone
      FROM aeps_merchants am
      JOIN users u ON am.user_id = u.id
      ORDER BY am.created_at DESC
    `);
    return result.rows;
  } catch (error) {
    throw new Error('Failed to fetch merchants');
  }
};


// =====================================================
// MERCHANT PROFILE - SERVICE LAYER
// =====================================================

// Get merchant profile (first registered pipe only)
// services/AEPS/aepsService.js

// services/AEPS/aepsService.js

const getMerchantProfile = async (userId) => {
    try {
        const result = await db.query(
            `
            SELECT 
                am.user_id,
                am.merchant_ref_id,
                am.merchant_id,
                am.shop_address,
                am.shop_pincode,
                am.state_code,
                am.district_code,
                am.bank_account,
                am.bank_ifsc,
                am.bank_name_code,
                am.pipe,
                am.created_at as registered_at,
                u.first_name,
                u.last_name,
                u.email,
                u.phone as mobile,
                u.business_name,
                u.business_type,
                u.business_address,
                u.pin_code,
                u.aadhaar_number,
                u.pan_number,
                u.state,
                u.city
            FROM aeps_merchants am
            JOIN users u ON am.user_id = u.id
            WHERE am.user_id = $1
            ORDER BY am.created_at ASC
            LIMIT 1
            `,
            [userId]
        );
        
        if (result.rows.length === 0) {
            return null;
        }
        
        const record = result.rows[0];
        
        return {
            personalDetails: {
                firstName: record.first_name || '',
                middleName: null,
                lastName: record.last_name || '',
                email: record.email || '',
                mobile: record.mobile || '',
                aadhaarNumber: record.aadhaar_number ? maskAadhaar(record.aadhaar_number) : null,
                panNumber: record.pan_number ? maskPan(record.pan_number) : null,
            },
            businessDetails: {
                businessName: record.business_name || '',
                businessType: record.business_type || '',
                businessAddress: record.business_address || '',
                pinCode: record.pin_code || '',
                state: record.state || '',
                city: record.city || '',
            },
            shopDetails: {
                shopAddress: record.shop_address || '',
                shopPincode: record.shop_pincode || '',
                stateCode: record.state_code || '',
                districtCode: record.district_code || '',
            },
            bankDetails: {
                bankAccount: record.bank_account ? maskAccount(record.bank_account) : null,
                bankIfsc: record.bank_ifsc || '',
                bankNameCode: record.bank_name_code || '',
            },
            merchantDetails: {
                merchantRefId: record.merchant_ref_id || '',
                merchantId: record.merchant_id || '',
                pipe: record.pipe || '',
                registeredAt: record.registered_at || null,
            }
        };
        
    } catch (error) {
        console.error('[AEPS SERVICE] getMerchantProfile error:', error);
        throw new Error('Failed to fetch merchant profile: ' + error.message);
    }
};

// Get merchant profile by specific pipe
const getMerchantProfileByPipe = async (userId, pipe) => {
  try {
    if (!['1', '2', '3', '4'].includes(pipe)) {
      throw new Error('Invalid pipe value. Must be "1", "2", "3", or "4".');
    }
    
    const result = await db.query(
      `
      SELECT 
        am.user_id,
        am.merchant_ref_id,
        am.merchant_id,
        am.shop_address,
        am.shop_pincode,
        am.state_code,
        am.district_code,
        am.bank_account,
        am.bank_ifsc,
        am.bank_name_code,
        am.pipe,
        am.created_at as registered_at,
        u.first_name,
        u.last_name,
        u.email,
        u.phone as mobile,
        u.address as user_address,
        u.city,
        u.state,
        u.pincode,
        u.dob,
        u.aadhaar_no,
        u.pan_no
      FROM aeps_merchants am
      JOIN users u ON am.user_id = u.id
      WHERE am.user_id = $1 AND am.pipe = $2
      `,
      [userId, pipe]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0];
    
  } catch (error) {
    console.error('[AEPS SERVICE] getMerchantProfileByPipe error:', error);
    throw new Error('Failed to fetch merchant profile for pipe ' + pipe);
  }
};

// Helper: Mask sensitive data
const maskAadhaar = (aadhaar) => {
  if (!aadhaar) return null;
  const str = aadhaar.toString();
  if (str.length === 12) {
    return `XXXX-XXXX-${str.slice(-4)}`;
  }
  return str;
};

const maskPan = (pan) => {
  if (!pan) return null;
  const str = pan.toString();
  if (str.length === 10) {
    return `${str.slice(0, 5)}XXXXX`;
  }
  return str;
};

const maskAccount = (account) => {
  if (!account) return null;
  const str = account.toString();
  if (str.length > 4) {
    return `XXXX-XXXX-${str.slice(-4)}`;
  }
  return str;
};
// =====================================================
// 2FA STATUS - Check if 2FA is done today
// =====================================================
/**
 * Check if 2FA is completed today for a user
 * @param {string|number} userId - User ID
 * @returns {Promise<Object>} 2FA status
 */

const check2FAStatus = async (userId) => {
    try {
        console.log(`[AEPS Service] Checking 2FA status for user ${userId}`);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // ✅ Get ALL merchants for this user (REMOVED LIMIT 1)
        const { rows } = await db.query(
            `SELECT 
                last_2fa_at,
                registration_status,
                merchant_id,
                pipe
             FROM aeps_merchants 
             WHERE user_id = $1
             ORDER BY pipe ASC`,
            [userId]
        );
        
        // Initialize pipes with default values
        const pipes = {
            '1': { merchant_id: null, last_2fa_at: null, is2FADoneToday: false },
            '2': { merchant_id: null, last_2fa_at: null, is2FADoneToday: false },
            '3': { merchant_id: null, last_2fa_at: null, is2FADoneToday: false },
            '4': { merchant_id: null, last_2fa_at: null, is2FADoneToday: false },
        };
        
        let any2FADoneToday = false;
        
        // Process each merchant
        for (const merchant of rows) {
            const pipe = merchant.pipe;
            if (pipes[pipe]) {
                let isDoneToday = false;
                if (merchant.last_2fa_at) {
                    const lastDate = new Date(merchant.last_2fa_at);
                    lastDate.setHours(0, 0, 0, 0);
                    isDoneToday = lastDate.getTime() === today.getTime();
                }
                
                pipes[pipe] = {
                    merchant_id: merchant.merchant_id,
                    last_2fa_at: merchant.last_2fa_at,
                    is2FADoneToday: isDoneToday,
                };
                
                if (isDoneToday) {
                    any2FADoneToday = true;
                }
            }
        }
        
        console.log(`[AEPS Service] 2FA Status for user ${userId}:`, {
            any2FADoneToday,
            pipes: {
                '1': pipes['1'].is2FADoneToday,
                '2': pipes['2'].is2FADoneToday,
                '3': pipes['3'].is2FADoneToday,
                '4': pipes['4'].is2FADoneToday,
            }
        });
        
        return {
            success: true,
            data: {
                pipes: pipes,
                any2FADoneToday: any2FADoneToday,
            }
        };
        
    } catch (error) {
        console.error('[AEPS Service] check2FAStatus error:', error.message);
        throw error;
    }
};

// const check2FAStatus = async (userId) => {
//     try {
//         console.log(`[AEPS Service] Checking 2FA status for user ${userId}`);
        
//         // Check if 2FA was completed today
//         const today = new Date();
//         today.setHours(0, 0, 0, 0);
        
//         const { rows } = await db.query(
//             `SELECT 
//                 last_2fa_at,
//                 registration_status,
//                 merchant_id,
//                 pipe
//              FROM aeps_merchants 
//              WHERE user_id = $1
//              ORDER BY created_at DESC
//              LIMIT 1`,
//             [userId]
//         );
        
//         if (rows.length === 0) {
//             // No merchant found - 2FA not set up
//             return {
//                 success: true,
//                 isEnabled: false,
//                 isVerified: false,
//                 isVerifiedToday: false,
//                 requires2FA: false,
//                 lastVerifiedAt: null,
//                 message: '2FA not configured for this user'
//             };
//         }
        
//         const merchant = rows[0];
//         const lastVerified = merchant.last_2fa_at;
        
//         let isVerifiedToday = false;
//         if (lastVerified) {
//             const lastDate = new Date(lastVerified);
//             lastDate.setHours(0, 0, 0, 0);
//             isVerifiedToday = lastDate.getTime() === today.getTime();
//         }
        
//         return {
//             success: true,
//             isEnabled: true,
//             isVerified: isVerifiedToday,
//             isVerifiedToday: isVerifiedToday,
//             requires2FA: true,
//             lastVerifiedAt: lastVerified,
//             merchantId: merchant.merchant_id,
//             pipe: merchant.pipe,
//             registrationStatus: merchant.registration_status,
//             message: isVerifiedToday ? '2FA verified today' : '2FA not verified today'
//         };
        
//     } catch (error) {
//         console.error('[AEPS Service] check2FAStatus error:', error.message);
//         throw error;
//     }
// };



module.exports = {
  getAllMerchantStatuses,
  registerMerchant,
  getBankList,
  getStateList,
  getDistrictList,
  getBankIINs,
  sendOTP,
  resendOTP,
  verifyOTP,
  performEkyc,
  perform2FA,
  cashWithdrawal,
  cashDeposit,
  balanceEnquiry,
  miniStatement,
  getUserTransactions,
  getAllTransactions,
  getAllMerchants,
  getMerchantProfile,
  check2FAStatus,
  getMerchantProfileByPipe,
};
