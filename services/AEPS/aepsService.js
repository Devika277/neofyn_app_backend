const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const aepsProviderRouter = require('./aepsProviderRouter');
const aepsWalletService = require('./aepsWalletService');
// const aepsLogger = require('../utils/aepsLogger');
const { processCommission } = require('./commissionService');   // ✅ only commission service

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

const getMerchantStatus = async (userId, pipe = '2') => {
  try {
    if (!['1', '2', '3'].includes(pipe)) {
      throw new Error('Invalid pipe value. Must be "1", "2", or "3".');
    }
    
    const result = await db.query(
      `SELECT merchant_id, registration_status, state_code, district_code, 
              shop_address, pipe, merchant_ref_id
       FROM aeps_merchants WHERE user_id = $1 AND pipe = $2`,
      [userId, pipe]
    );
    if (result.rows.length === 0) return { isRegistered: false, pipe };
    const row = result.rows[0];
    return {
      isRegistered:       true,
      registrationStatus: row.registration_status,
      merchantId:         row.merchant_id,
      stateCode:          row.state_code,
      districtCode:       row.district_code,
      shopAddress:        row.shop_address,
      pipe:               row.pipe,
      merchantRefId:      row.merchant_ref_id,
    };
  } catch (error) {
    console.error('getMerchantStatus error:', error);
    throw new Error('Failed to get merchant status');
  }
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
    if (!pipe || !['1', '2', '3'].includes(pipe)) {
      throw new Error('Valid pipe (1, 2, or 3) is required');
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
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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
    if (!['1', '2', '3'].includes(pipe)) {
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
const perform2FA = async (userId, pipe, { merchantId, merchantRefId, aadhaarNumber, deviceType, pidData, ipAddress, lat, long }) => {
  const startTime = Date.now();
  let logId = null;
  try {
    if (!['1', '2', '3'].includes(pipe)) {
      throw new Error('Invalid pipe value');
    }
    
    const merchant = await db.query(
      'SELECT id FROM aeps_merchants WHERE user_id = $1 AND pipe = $2 AND merchant_id = $3',
      [userId, pipe, merchantId]
    );
    if (merchant.rows.length === 0) throw new Error('Merchant not found for this pipe');

    const requestPayload = { merchantId, merchantRefId, aadhaarNumber, pipe, deviceType, ipAddress, lat, long };
    logId = await insertPendingLog(db, {
      module: 'aeps',
      merchant_ref_id: merchantRefId,
      transaction_id: null,
      transaction_type: 'aeps_2fa',
      request_payload: JSON.stringify(requestPayload),
    });

    const providerResult = await aepsProviderRouter.perform2FA({
      merchantId, merchantRefId, aadhaarNumber, pipe, deviceType, pidData,
      lat: lat || '0.0',
      long: long || '0.0',
    });

    if (providerResult.status === '000') {
      await db.query(
        `UPDATE aeps_merchants SET last_2fa_at = NOW() WHERE merchant_id = $1 AND pipe = $2`,
        [merchantId, pipe]
      );

      // ✅ Deduct ₹3 from AEPS wallet for daily 2FA (only on success)
      await aepsWalletService.debitAepsWallet(
        userId,
        3,
        'Daily 2FA fee',
        null,
        null,
        null
      ).catch(err => console.error('2FA fee deduction failed:', err.message));
    }

    await updateLog(db, logId, JSON.stringify(providerResult), Date.now() - startTime,
      providerResult.status === '000' ? 'success' : 'failed', 200, null);

    return providerResult;
  } catch (error) {
    if (logId) await updateLog(db, logId, null, Date.now() - startTime, 'error', 500, error.message);
    console.error('perform2FA error:', error);
    throw error;
  }
};

// ==============================
// AePS Transactions (pipe‑aware + 2FA gate)
// ==============================
const getMerchantInfo = async (userId, pipe, client = db) => {
  if (!['1', '2', '3'].includes(pipe)) {
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
  if (!['1', '2', '3'].includes(pipe)) {
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

// Cash Withdrawal
const cashWithdrawal = async (userId, pipe, { amount, bankCode, pidData, accountType, lat, long, device, aadhaarNo, mobileNo, ipAddress }) => {
  if (!['1', '2', '3'].includes(pipe)) {
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
         (user_id, aeps_wallet_id, txn_type, amount, status, provider, device_used, pipe, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id`,
      [userId, wallet.id, 'cash_withdrawal', amount, 'pending', process.env.AEPS_PROVIDER || 'vimopay', device, pipe]
    );
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
        providerResult.availableBalance || null,
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
  if (!['1', '2', '3'].includes(pipe)) {
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
         (user_id, aeps_wallet_id, txn_type, amount, status, provider, device_used, pipe, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id`,
      [userId, wallet.id, 'cash_deposit', amount, 'pending', process.env.AEPS_PROVIDER || 'vimopay', device, pipe]
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
        providerResult.availableBalance || null,
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
  if (!['1', '2', '3'].includes(pipe)) {
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
         (user_id, aeps_wallet_id, txn_type, status, provider, device_used, pipe, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [userId, walletId, 'balance_enquiry', 'pending', process.env.AEPS_PROVIDER || 'vimopay', device, pipe]
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
        providerResult.availableBalance || null,
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
  if (!['1', '2', '3'].includes(pipe)) {
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
         (user_id, aeps_wallet_id, txn_type, status, provider, device_used, pipe, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [userId, walletId, 'mini_statement', 'pending', process.env.AEPS_PROVIDER || 'vimopay', device, pipe]
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
        providerResult.availableBalance || null,
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
      if (!['1', '2', '3'].includes(pipe)) {
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

module.exports = {
  getMerchantStatus,
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
};