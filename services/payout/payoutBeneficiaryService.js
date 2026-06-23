// /**
//  * Payout Beneficiary Service
//  * //payout/payoutBeneficiaryService.js
//  * Handles all XPayout beneficiary operations:
//  * - Add beneficiary (with OTP)
//  * - Verify OTP and save beneficiary (with account verification via provider)
//  * - List beneficiaries
//  * - Soft delete
//  * - Cooling period check
//  */

// const db = require('../../config/db');
// const { getPayoutProvider } = require('../../providers/payoutProviderRouter');
// const { generateOtp, sendOtp } = require('../../utils/otpHelper');
// const aepsWalletService = require('../AEPS/aepsService'); // <-- ADD THIS


// // Simple in-memory OTP store (replace with Redis or DB in production)
// const otpStore = new Map(); // key: userId_phone, value: { otp, expiresAt, beneData }

// // OTP expiry (5 minutes)
// const OTP_EXPIRY_MS = 5 * 60 * 1000;

// /**
//  * Add beneficiary step 1: send OTP to agent's mobile
//  * @param {number} userId - agent's user ID
//  * @param {string} phone - agent's phone number (for OTP)
//  * @param {Object} beneData - { bene_type, account_name?, account_number?, ifsc_code?, upi_id? }
//  * @returns {Promise<{ message: string }>}
//  */
// async function addBeneficiary(userId, phone, beneData) {
//   const { bene_type, account_name, account_number, ifsc_code, upi_id } = beneData;

//   console.log('\n========================================');
//   console.log('[addBeneficiary] ===== START =====');
//   console.log('[addBeneficiary] userId:', userId);
//   console.log('[addBeneficiary] phone:', phone);
//   console.log('[addBeneficiary] bene_type:', bene_type);
//   console.log('[addBeneficiary] account_name:', account_name);
//   console.log('[addBeneficiary] account_number:', account_number);
//   console.log('[addBeneficiary] ifsc_code:', ifsc_code);
//   console.log('[addBeneficiary] upi_id:', upi_id);
//   console.log('========================================\n');

//   // Validate required fields
//   if (bene_type === 'bank') {
//     if (!account_number || !ifsc_code) {
//       console.log('[addBeneficiary] Validation failed: Missing account_number or ifsc_code');
//       throw new Error('Account number and IFSC are required for bank beneficiary');
//     }
//   } else if (bene_type === 'upi') {
//     if (!upi_id) {
//       console.log('[addBeneficiary] Validation failed: Missing upi_id');
//       throw new Error('UPI ID is required for UPI beneficiary');
//     }
//   } else {
//     console.log('[addBeneficiary] Validation failed: Invalid bene_type');
//     throw new Error('Invalid beneficiary type');
//   }

//   // Check if beneficiary already exists (active)
//   let existingQuery;
//   let existingParams;
//   if (bene_type === 'bank') {
//     existingQuery = `SELECT id FROM payout_beneficiaries WHERE user_id = $1 AND bene_type = 'bank' AND account_number = $2 AND ifsc_code = $3 AND is_active = true`;
//     existingParams = [userId, account_number, ifsc_code];
//   } else {
//     existingQuery = `SELECT id FROM payout_beneficiaries WHERE user_id = $1 AND bene_type = 'upi' AND upi_id = $2 AND is_active = true`;
//     existingParams = [userId, upi_id];
//   }
  
//   console.log('[addBeneficiary] Checking if beneficiary already exists...');
//   const existing = await db.query(existingQuery, existingParams);
//   if (existing.rows.length > 0) {
//     console.log('[addBeneficiary] Beneficiary already exists, ID:', existing.rows[0].id);
//     throw new Error('Beneficiary already exists');
//   }
//   console.log('[addBeneficiary] Beneficiary does not exist, proceeding...');

//   // Generate OTP and store
//   const otp = generateOtp();
//   const key = `${userId}_${phone}`;
  
//   console.log('[addBeneficiary] Generated OTP:', otp);
//   console.log('[addBeneficiary] Storage key:', key);
//   console.log('[addBeneficiary] OTP will expire at:', new Date(Date.now() + OTP_EXPIRY_MS).toLocaleString());
  
//   otpStore.set(key, {
//     otp,
//     expiresAt: Date.now() + OTP_EXPIRY_MS,
//     beneData: { bene_type, account_name, account_number, ifsc_code, upi_id }
//   });

//   console.log('[addBeneficiary] OTP stored successfully');
//   console.log('[addBeneficiary] Current OTP store size:', otpStore.size);
//   console.log('[addBeneficiary] All keys in store:', Array.from(otpStore.keys()));

//   // Send OTP
//   console.log('[addBeneficiary] Sending OTP to phone:', phone);
//   await sendOtp(phone, otp);
  
//   console.log('\n[addBeneficiary] ===== END =====\n');

//   return { message: 'OTP sent successfully' };
// }

// /**
//  * Verify OTP and create beneficiary (with provider verification)
//  * @param {number} userId - agent's user ID
//  * @param {string} phone - agent's phone number
//  * @param {string} otp - OTP entered
//  * @returns {Promise<{ beneficiary: object, message: string }>}
//  */
// async function verifyOtpAndCreateBeneficiary(userId, phone, otp) {
//   const key = `${userId}_${phone}`;
  
//   console.log('\n========================================');
//   console.log('[verifyOtpAndCreateBeneficiary] ===== START =====');
//   console.log('[verifyOtpAndCreateBeneficiary] Looking for key:', key);
//   console.log('[verifyOtpAndCreateBeneficiary] Current store size:', otpStore.size);
//   console.log('[verifyOtpAndCreateBeneficiary] All keys in store:', Array.from(otpStore.keys()));
  
//   const stored = otpStore.get(key);
  
//   if (!stored) {
//     console.log('[verifyOtpAndCreateBeneficiary] ❌ No OTP found for key:', key);
//     console.log('========================================\n');
//     throw new Error('Invalid or expired OTP');
//   }
  
//   console.log('[verifyOtpAndCreateBeneficiary] ✅ Found stored OTP');
//   console.log('[verifyOtpAndCreateBeneficiary] Stored OTP:', stored.otp);
//   console.log('[verifyOtpAndCreateBeneficiary] Provided OTP:', otp);
//   console.log('[verifyOtpAndCreateBeneficiary] Expires at:', new Date(stored.expiresAt).toLocaleString());
//   console.log('[verifyOtpAndCreateBeneficiary] Current time:', new Date().toLocaleString());
  
//   if (stored.otp !== otp) {
//     console.log('[verifyOtpAndCreateBeneficiary] ❌ OTP mismatch');
//     console.log('========================================\n');
//     throw new Error('Invalid or expired OTP');
//   }
  
//   if (stored.expiresAt < Date.now()) {
//     console.log('[verifyOtpAndCreateBeneficiary] ❌ OTP expired');
//     otpStore.delete(key);
//     console.log('========================================\n');
//     throw new Error('Invalid or expired OTP');
//   }
  
//   console.log('[verifyOtpAndCreateBeneficiary] ✅ OTP verified successfully');

//   const { bene_type, account_name, account_number, ifsc_code, upi_id } = stored.beneData;
//   const provider = getPayoutProvider();

//   console.log('[verifyOtpAndCreateBeneficiary] Verifying with provider...');
//   console.log('[verifyOtpAndCreateBeneficiary] bene_type:', bene_type);

//   // Verify with provider (penny drop for bank, UPI lookup for UPI)
//   let verificationResult;
//   if (bene_type === 'bank') {
//     console.log('[verifyOtpAndCreateBeneficiary] Calling provider.verifyAccount for bank...');
//     verificationResult = await provider.verifyAccount({
//       accountNo: account_number,
//       ifsc: ifsc_code,
//       mode: 'bank'
//     });
//     console.log('[verifyOtpAndCreateBeneficiary] Provider response:', verificationResult);
    
//     if (!verificationResult.isValid || verificationResult.status !== '000') {
//       console.log('[verifyOtpAndCreateBeneficiary] ❌ Bank verification failed');
//       throw new Error(verificationResult.message || 'Bank account verification failed');
//     }
    
//     // Use provider's returned name if available, otherwise use provided account_name
//     const finalAccountName = verificationResult.accountName || account_name || 'Unknown';
//     const bankName = verificationResult.bankName || null;

//     console.log('[verifyOtpAndCreateBeneficiary] Inserting bank beneficiary into database...');
//     // Insert into DB
//     const insertQuery = `
//       INSERT INTO payout_beneficiaries (
//         user_id, bene_type, account_name, account_number, ifsc_code, bank_name,
//         is_verified, verified_at, bene_added_at
//       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
//       RETURNING id, user_id, bene_type, account_name, account_number, ifsc_code, bank_name, is_verified, verified_at, bene_added_at, created_at, updated_at
//     `;
//     const values = [userId, 'bank', finalAccountName, account_number, ifsc_code, bankName, true];
//     const result = await db.query(insertQuery, values);
//     const newBeneficiary = result.rows[0];


//      // ✅ Deduct fee from AEPS wallet (e.g., ₹5)
//       const FEE_AMOUNT = 3; // could be fetched from settings table
//       await aepsWalletService.debitAepsWallet(
//         userId,
//         FEE_AMOUNT,
//         `Beneficiary registration fee for bank account ${account_number}`,
//         null,      // referenceId
//         client,    // pass the transaction client
//         null       // transactionId (optional)
//       );


//     console.log('[verifyOtpAndCreateBeneficiary] ✅ Bank beneficiary created, ID:', newBeneficiary.id);
//     otpStore.delete(key);
//     console.log('[verifyOtpAndCreateBeneficiary] OTP removed from store');
//     console.log('========================================\n');
//     return { beneficiary: newBeneficiary, message: 'Beneficiary added successfully' };
//   } 
//   else if (bene_type === 'upi') {
//     console.log('[verifyOtpAndCreateBeneficiary] Calling provider.verifyAccount for UPI...');
//     verificationResult = await provider.verifyAccount({
//       upiId: upi_id,
//       mode: 'upi'
//     });
//     console.log('[verifyOtpAndCreateBeneficiary] Provider response:', verificationResult);
    
//     if (!verificationResult.isValid || verificationResult.status !== '000') {
//       console.log('[verifyOtpAndCreateBeneficiary] ❌ UPI verification failed');
//       throw new Error(verificationResult.message || 'UPI ID verification failed');
//     }
    
//     const upiName = verificationResult.accountName || null;

//     console.log('[verifyOtpAndCreateBeneficiary] Inserting UPI beneficiary into database...');
//     const insertQuery = `
//       INSERT INTO payout_beneficiaries (
//         user_id, bene_type, upi_id, upi_name, is_verified, verified_at, bene_added_at
//       ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
//       RETURNING id, user_id, bene_type, upi_id, upi_name, is_verified, verified_at, bene_added_at, created_at, updated_at
//     `;
//     const values = [userId, 'upi', upi_id, upiName, true];
//     const result = await db.query(insertQuery, values);
//     const newBeneficiary = result.rows[0];

//     console.log('[verifyOtpAndCreateBeneficiary] ✅ UPI beneficiary created, ID:', newBeneficiary.id);
//     otpStore.delete(key);
//     console.log('[verifyOtpAndCreateBeneficiary] OTP removed from store');
//     console.log('========================================\n');
//     return { beneficiary: newBeneficiary, message: 'Beneficiary added successfully' };
//   }
// }

// /**
//  * List beneficiaries for a user
//  * @param {number} userId - agent's user ID
//  * @param {string} type - optional filter: 'bank' or 'upi'
//  * @returns {Promise<Array>}
//  */
// async function listBeneficiaries(userId, type = null) {
//   console.log('[listBeneficiaries] userId:', userId, 'type:', type);
//   let query = `SELECT * FROM payout_beneficiaries WHERE user_id = $1 AND is_active = true`;
//   const params = [userId];
//   if (type && (type === 'bank' || type === 'upi')) {
//     query += ` AND bene_type = $2`;
//     params.push(type);
//   }
//   query += ` ORDER BY created_at DESC`;
//   const result = await db.query(query, params);
//   console.log('[listBeneficiaries] Found', result.rows.length, 'beneficiaries');
//   return result.rows;
// }

// /**
//  * Soft delete a beneficiary
//  * @param {number} beneficiaryId - ID of beneficiary to delete
//  * @param {number} userId - user ID to ensure ownership
//  * @returns {Promise<{ message: string }>}
//  */
// async function deleteBeneficiary(beneficiaryId, userId) {
//   console.log('[deleteBeneficiary] beneficiaryId:', beneficiaryId, 'userId:', userId);
//   // Check ownership
//   const checkQuery = `SELECT id FROM payout_beneficiaries WHERE id = $1 AND user_id = $2 AND is_active = true`;
//   const checkResult = await db.query(checkQuery, [beneficiaryId, userId]);
//   if (checkResult.rows.length === 0) {
//     throw new Error('Beneficiary not found or already deleted');
//   }

//   const updateQuery = `UPDATE payout_beneficiaries SET is_active = false, updated_at = NOW() WHERE id = $1`;
//   await db.query(updateQuery, [beneficiaryId]);
//   console.log('[deleteBeneficiary] Beneficiary deleted successfully');
//   return { message: 'Beneficiary deleted successfully' };
// }

// /**
//  * Check cooling period for a beneficiary
//  * @param {number} beneficiaryId - beneficiary ID
//  * @param {number} userId - user ID
//  * @param {number} amount - transfer amount
//  * @returns {Promise<{ coolingRequired: boolean, remainingMinutes?: number }>}
//  */
// async function checkCoolingPeriod(beneficiaryId, userId, amount) {
//   // Cooling period applies only for amounts > ₹10,000
//   if (amount <= 10000) {
//     return { coolingRequired: false };
//   }

//   // Fetch beneficiary creation time
//   const query = `SELECT bene_added_at FROM payout_beneficiaries WHERE id = $1 AND user_id = $2 AND is_active = true`;
//   const result = await db.query(query, [beneficiaryId, userId]);
//   if (result.rows.length === 0) {
//     throw new Error('Beneficiary not found');
//   }

//   const addedAt = new Date(result.rows[0].bene_added_at);
//   const now = new Date();
//   const minutesElapsed = (now - addedAt) / (1000 * 60);

//   if (minutesElapsed >= 30) {
//     return { coolingRequired: false };
//   } else {
//     const remainingMinutes = Math.ceil(30 - minutesElapsed);
//     return { coolingRequired: true, remainingMinutes };
//   }
// }

// module.exports = {
//   addBeneficiary,
//   verifyOtpAndCreateBeneficiary,
//   listBeneficiaries,
//   deleteBeneficiary,
//   checkCoolingPeriod
// };




/**
 * Payout Beneficiary Service
 * Handles all XPayout beneficiary operations:
 * - Add beneficiary (direct save without OTP)
 * - List beneficiaries
 * - Soft delete
 * - Cooling period check
 */

// services/payout/payoutBeneficiaryService.js

// services/payout/payoutBeneficiaryService.js

// services/payout/payoutBeneficiaryService.js

const db = require('../../config/db');
const walletService = require('../walletService'); // ✅ Import wallet service
const { getPayoutProvider } = require('../../providers/payoutProviderRouter');

const BENEFICIARY_FEE = 3; // ₹3 fee for adding beneficiary

/**
 * Add beneficiary to agent_bank_accounts table
 * Deducts ₹3 from main wallet using walletService
 */
async function addBeneficiary(userId, phone, beneData) {
  const { 
    account_name, 
    account_number, 
    ifsc_code, 
    bank_code,
    state_code,
    payment_mode,
    mobile,
    bank_name
  } = beneData;

  console.log('\n========================================');
  console.log('[addBeneficiary] ===== START =====');
  console.log('[addBeneficiary] userId:', userId);
  console.log('[addBeneficiary] account_name:', account_name);
  console.log('[addBeneficiary] account_number:', account_number);
  console.log('========================================\n');

  // Validate required fields
  if (!account_number || !ifsc_code) {
    throw new Error('Account number and IFSC are required');
  }
  if (!account_name) {
    throw new Error('Account holder name is required');
  }

  const client = await db.connect();
  
  try {
    await client.query('BEGIN');

    // ✅ Check if beneficiary already exists
    const existingQuery = `
      SELECT id FROM agent_bank_accounts 
      WHERE user_id = $1 AND account_number = $2 AND ifsc_code = $3 AND is_active = true
    `;
    const existing = await client.query(existingQuery, [userId, account_number, ifsc_code]);
    
    if (existing.rows.length > 0) {
      throw new Error('Beneficiary already exists');
    }

    // ✅ Check if user has sufficient balance using walletService
    const hasBalance = await walletService.hasSufficientBalance(userId, BENEFICIARY_FEE);
    if (!hasBalance) {
      const balance = await walletService.getBalance(userId);
      throw new Error(`Insufficient main wallet balance. Required: ₹${BENEFICIARY_FEE}, Available: ₹${balance}`);
    }

    // ✅ Deduct ₹3 from main wallet using walletService (within transaction)
    const deductResult = await walletService.deductBeneficiaryFee(
      userId, 
      BENEFICIARY_FEE, 
      account_name, 
      client  // ✅ Pass the client for transaction
    );

    console.log(`💰 Main wallet balance after deduction: ₹${deductResult.newBalance}`);

    // ✅ Insert beneficiary into agent_bank_accounts
    const insertQuery = `
      INSERT INTO agent_bank_accounts (
        user_id, 
        account_name, 
        account_number, 
        ifsc_code, 
        bank_name,
        mobile_number,
        state_code,
        vimopay_bank_code,
        is_primary,
        is_active,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING 
        id, 
        user_id, 
        account_name, 
        account_number, 
        ifsc_code, 
        bank_name,
        mobile_number,
        state_code,
        vimopay_bank_code,
        is_primary,
        is_active,
        created_at,
        updated_at
    `;
    
    const values = [
      userId, 
      account_name, 
      account_number, 
      ifsc_code, 
      bank_name || null,
      mobile || null,
      state_code || null,
      bank_code || null,
      false,  // is_primary = false (not the main account)
      true    // is_active = true
    ];
    
    const result = await client.query(insertQuery, values);
    const newBeneficiary = result.rows[0];

    await client.query('COMMIT');

    console.log('[addBeneficiary] ✅ Beneficiary saved, fee deducted from main wallet');
    console.log('========================================\n');

    return { 
      beneficiary: newBeneficiary, 
      message: `Beneficiary added successfully. ₹${BENEFICIARY_FEE} deducted from main wallet.`,
      feeDeducted: BENEFICIARY_FEE,
      newBalance: deductResult.newBalance
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[addBeneficiary] Error:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * List beneficiaries from agent_bank_accounts
 */
async function listBeneficiaries(userId) {
  console.log('[listBeneficiaries] userId:', userId);
  
  const query = `
    SELECT 
      id,
      user_id,
      account_name as name,
      account_number,
      ifsc_code as ifsc,
      bank_name,
      mobile_number as mobile,
      state_code,
      vimopay_bank_code as bank_code,
      is_primary,
      is_active,
      created_at,
      updated_at
    FROM agent_bank_accounts 
    WHERE user_id = $1 
      AND is_active = true 
      AND is_primary = false
    ORDER BY created_at DESC
  `;
  
  const result = await db.query(query, [userId]);
  console.log('[listBeneficiaries] Found', result.rows.length, 'beneficiaries');
  return result.rows;
}

/**
 * Soft delete a beneficiary from agent_bank_accounts
 */
async function deleteBeneficiary(beneficiaryId, userId) {
  console.log('[deleteBeneficiary] beneficiaryId:', beneficiaryId, 'userId:', userId);
  
  const checkQuery = `
    SELECT id FROM agent_bank_accounts 
    WHERE id = $1 AND user_id = $2 AND is_active = true AND is_primary = false
  `;
  const checkResult = await db.query(checkQuery, [beneficiaryId, userId]);
  
  if (checkResult.rows.length === 0) {
    throw new Error('Beneficiary not found or already deleted');
  }

  const updateQuery = `
    UPDATE agent_bank_accounts 
    SET is_active = false, updated_at = NOW() 
    WHERE id = $1
  `;
  await db.query(updateQuery, [beneficiaryId]);
  
  console.log('[deleteBeneficiary] Beneficiary deleted successfully');
  return { message: 'Beneficiary deleted successfully' };
}

module.exports = {
  addBeneficiary,
  listBeneficiaries,
  deleteBeneficiary
};