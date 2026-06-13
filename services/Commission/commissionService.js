const pool = require('../../config/db');           // ✅ direct pool, no .pool property
const { getAncestors } = require('./memberService');

/**
 * Call after every successful transaction.
 * @param {string} serviceType - "dmt" | "aeps" | "recharge" | "matm" | "billpay"
 * @param {number} transactionAmount - the amount of the transaction (not commission)
 * @param {number} retailerUserId - the user who did the transaction
 * @param {object} options - { subType: 'transfer'|'dmt1verify'|'payout_verify'|'remitter_kyc' }
 */
async function processCommission(serviceType, transactionAmount, retailerUserId, options = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get all ancestors in order (parent → grandparent → ...)
    const ancestors = await getAncestors(retailerUserId);
    console.log(`[DEBUG] Found ${ancestors.length} ancestors for user ${retailerUserId}`);

    // 2. Also credit the retailer themselves
    const selfRes = await client.query(
      'SELECT id, role, plan FROM users WHERE id = $1',
      [retailerUserId]
    );
    if (!selfRes.rows[0]) throw new Error('Retailer not found');

    const allToCredit = [selfRes.rows[0], ...ancestors].filter(Boolean);

    for (const user of allToCredit) {
      let commAmt = 0;

      if (serviceType === 'dmt' || serviceType === 'dmt_smart') {
      commAmt = await getDMTCommission(
        client,
        user.role,
        user.plan,
        transactionAmount,
        options.subType || 'transfer',
        serviceType   // pass the actual service type to the helper
      );

      }  else if (serviceType === 'recharge') {
      commAmt = await getRechargeCommission(
        client, user.role, user.plan,
        transactionAmount, options.operator || ''
      );
    }
    else if (serviceType === 'billpay') {
      commAmt = await getBillpayCommission(
        client, user.role, user.plan,
        transactionAmount, options.serviceType || ''
      );
    }
      else if (serviceType === 'aeps') {
        commAmt = await getAEPSCommission(
          client,
          user.role,
          user.plan,
          transactionAmount,
          options.subType || 'withdrawal'
        );
      }      
      else {
        const rateRes = await client.query(
          `SELECT rate_value, rate_type FROM commission_rates
           WHERE service_type = $1 AND role = $2 AND is_active = TRUE`,
          [serviceType, user.role]
        );
        const rate = rateRes.rows[0];
        if (!rate || parseFloat(rate.rate_value) <= 0) continue;
        commAmt = rate.rate_type === 'flat'
          ? parseFloat(rate.rate_value)
          : Math.round(transactionAmount * parseFloat(rate.rate_value) / 100 * 100) / 100;
      }

  if (commAmt <= 0) continue;

console.log(`[DEBUG] Crediting user ${user.id} role ${user.role} with ${commAmt} for ${serviceType}`);

try {
  // Update commission wallet
  await client.query(
    `UPDATE users SET commission_wallet = COALESCE(commission_wallet, 0) + $1 WHERE id = $2`,
    [commAmt, user.id]
  );
  console.log(`[DEBUG] Updated users.commission_wallet for user ${user.id}`);

  // Insert into commission_ledger (only required non-null columns)
  await client.query(
    `INSERT INTO commission_ledger
       (user_id, service_type, txn_amount, commission_amount, role_at_time)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, serviceType, transactionAmount, commAmt, user.role]
  );
  console.log(`[DEBUG] Inserted commission_ledger for user ${user.id}`);
} catch (err) {
  console.error(`[DEBUG] Failed for user ${user.id}:`, err.message);
  throw err;
}
    }

    await client.query('COMMIT');
    console.log(`[DEBUG] processCommission completed successfully for user ${retailerUserId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[commissionService] processCommission failed:', err.message);
    // Do NOT rethrow — commission failure must not fail the main transaction
  } finally {
    client.release();
  }
}

/**
 * DMT-specific commission lookup using slab + plan + subType
 */
async function getDMTCommission(client, role, plan, amount, subType, serviceType = 'dmt') {
  try {
    const normalizedRole = (role || '').toLowerCase();
    const normalizedPlan = (plan || 'free').toLowerCase();
    const normalizedSub  = (subType || 'transfer').toLowerCase();
    const normalizedService = (serviceType || 'dmt').toLowerCase();

    let query, params;

    if (normalizedSub === 'transfer') {
      // For transfer slab, use amount range lookup
      query = `
        SELECT rate_value, rate_type
        FROM commission_rates
        WHERE service_type = $1
          AND slab_name     = 'transfer'
          AND role          = $2
          AND (plan = $3 OR plan IS NULL)
          AND is_active     = TRUE
          AND $4::numeric  >= min_amount
          AND $4::numeric  <= max_amount
        LIMIT 1
      `;
      params = [normalizedService, normalizedRole, normalizedPlan, amount];
    } else {
      // For other slabs (like remitter_kyc, dmt1verify, etc.) – exact match, no amount range
      query = `
        SELECT rate_value, rate_type
        FROM commission_rates
        WHERE service_type = $1
          AND slab_name     = $2
          AND role          = $3
          AND plan          = $4
          AND is_active     = TRUE
        LIMIT 1
      `;
      params = [normalizedService, normalizedSub, normalizedRole, normalizedPlan];
    }

    const { rows } = await client.query(query, params);
    if (!rows.length || parseFloat(rows[0].rate_value) <= 0) return 0;

    const { rate_value, rate_type } = rows[0];
    if (rate_type === 'flat') return parseFloat(rate_value);
    return Math.round(amount * parseFloat(rate_value) / 100 * 100) / 100;
  } catch (err) {
    console.error(`[commissionService] getDMTCommission failed for service ${serviceType}:`, err.message);
    return 0;
  }
}

/**
 * AEPS-specific commission lookup using slab + plan + subType
 */
async function getAEPSCommission(client, role, plan, amount, subType) {
  try {
    const normalizedRole = (role || '').toLowerCase();
    const normalizedPlan = (plan || 'free').toLowerCase();
    const normalizedSub  = (subType || 'withdrawal').toLowerCase();

    let query, params;

    if (normalizedSub === 'withdrawal') {
      // Allow plan IS NULL for distributor/master_distributor
      query = `
        SELECT rate_value, rate_type
        FROM commission_rates
        WHERE service_type = 'aeps'
          AND slab_name     = 'withdrawal'
          AND role          = $1
          AND (plan = $2 OR plan IS NULL)
          AND is_active     = TRUE
          AND $3::numeric  >= min_amount
          AND $3::numeric  <= max_amount
        LIMIT 1
      `;
      params = [normalizedRole, normalizedPlan, amount];
    } else {
      // Flat charge for mini_statement, deposit, aadhaar_pay
      query = `
        SELECT rate_value, rate_type
        FROM commission_rates
        WHERE service_type = 'aeps'
          AND slab_name     = $1
          AND role          = $2
          AND (plan = $3 OR plan IS NULL)
          AND is_active     = TRUE
        LIMIT 1
      `;
      params = [normalizedSub, normalizedRole, normalizedPlan];
    }

    const { rows } = await client.query(query, params);
    console.log(`[DEBUG] AEPS commission query for role=${normalizedRole}, plan=${normalizedPlan}, amount=${amount}, subType=${normalizedSub}, rows returned: ${rows.length}`);

    if (!rows.length || parseFloat(rows[0].rate_value) <= 0) return 0;

    const { rate_value, rate_type } = rows[0];
    if (rate_type === 'flat') return parseFloat(rate_value);
    return Math.round(amount * parseFloat(rate_value) / 100 * 100) / 100;
  } catch (err) {
    console.error('[commissionService] getAEPSCommission failed:', err.message);
    return 0;
  }
}



/**
 * Recharge commission lookup using operator (slab_name) + plan + role
 */
async function getRechargeCommission(client, role, plan, amount, operator) {
  try {
    const r   = (role     || '').toLowerCase();
    const p   = (plan     || 'free').toLowerCase();
    // Normalize operator to match DB slab_name
    // e.g. "Airtel" → "AIRTEL", "Jio" → "JIORECH"
    const op  = (operator || '').toUpperCase().trim();

    const { rows } = await client.query(`
      SELECT rate_value, rate_type
      FROM commission_rates
      WHERE service_type = 'recharge'
        AND slab_name    = $1
        AND role         = $2
        AND (plan = $3 OR plan IS NULL)
        AND is_active    = TRUE
      LIMIT 1
    `, [op, r, p]);

    if (!rows.length || parseFloat(rows[0].rate_value) <= 0) return 0;

    const { rate_value, rate_type } = rows[0];
    return rate_type === 'flat'
      ? parseFloat(rate_value)
      : Math.round(amount * parseFloat(rate_value) / 100 * 100) / 100;

  } catch (err) {
    console.error('[commissionService] getRechargeCommission failed:', err.message);
    return 0;
  }
}


async function getBillpayCommission(client, role, plan, amount, serviceType) {
  try {
    const r  = (role        || '').toLowerCase();
    const p  = (plan        || 'free').toLowerCase();

    // Normalize serviceType from paymentService to match DB slab_name
    const serviceTypeMap = {
      'electricity':        'electricity',
      'water':              'water',
      'lpg':                'lpg_gas',
      'lpg_gas':            'lpg_gas',
      'postpaid':           'postpaid',
      'loan':               'loan_repayment',
      'loan_repayment':     'loan_repayment',
      'fasttag':            'fastag',
      'fastag':             'fastag',
      'credit_card':        'credit_card',
      'cc_payment':         'credit_card',
      'broadband':          'broadband',
      'cable_tv':           'cable_tv',
      'donation':           'donation',
      'education_fees':     'education_fees',
      'hospitals':          'hospitals',
      'housing_society':    'housing_society',
      'landline':           'landline',
      'municipal_services': 'municipal_services',
      'municipal_taxes':    'municipal_taxes',
      'ncmc_recharge':      'ncmc_recharge',
      'recurring_deposit':  'recurring_deposit',
      'rental':             'rental',
      'subscription':       'subscription',
      'piped_gas':          'piped_gas',
      'clubs_associations': 'clubs_associations',
    };
    const slab = serviceTypeMap[(serviceType || '').toLowerCase()] || (serviceType || '').toLowerCase();

    const { rows } = await client.query(`
      SELECT rate_value, rate_type
      FROM commission_rates
      WHERE service_type = 'billpay'
        AND slab_name    = $1
        AND role         = $2
        AND plan         = $3
        AND is_active    = TRUE
      LIMIT 1
    `, [slab, r, p]);

    if (!rows.length || parseFloat(rows[0].rate_value) <= 0) return 0;

    const { rate_value, rate_type } = rows[0];
    return rate_type === 'flat'
      ? parseFloat(rate_value)
      : Math.round(amount * parseFloat(rate_value) / 100 * 100) / 100;

  } catch (err) {
    console.error('[commissionService] getBillpayCommission failed:', err.message);
    return 0;
  }
}

module.exports = { processCommission, getRechargeCommission, getAEPSCommission, getDMTCommission, getBillpayCommission };