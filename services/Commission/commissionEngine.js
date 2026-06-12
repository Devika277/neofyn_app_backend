// backend/services/commissionEngine.js
//
// FIX APPLIED:
//   [FIX] calculate() and reverse() now accept an optional `client` parameter.
//         When a client is passed (e.g. from processTransfer's transaction),
//         they run inside that transaction instead of opening a new one.
//         This prevents the nested-transaction deadlock that caused the
//         idle-in-transaction timeout crash.

const pool = require('../config/db');

// ─── CALCULATE: Called after every successful transaction ────────
async function calculate({ userId, serviceType, providerId, txnAmount, transactionRef }, client = null) {
  let ownClient = false;
  let dbClient  = client;

  if (!dbClient) {
    dbClient  = await pool.connect();
    ownClient = true;
  }

  try {
    if (ownClient) await dbClient.query('BEGIN');

    // 1. Get the retailer
    const userRes = await dbClient.query(
      `SELECT id, role, parent_id, scheme_id FROM users WHERE id = $1`,
      [userId]
    );
    const retailer = userRes.rows[0];
    if (!retailer || !retailer.scheme_id) {
      if (ownClient) await dbClient.query('ROLLBACK');
      return; // no scheme = no commission
    }

    // 2. Get commission rule
    const ruleRes = await dbClient.query(
      `SELECT * FROM commission_rules
       WHERE scheme_id = $1 AND service_type = $2 AND provider_id = $3`,
      [retailer.scheme_id, serviceType, providerId]
    );
    const rule = ruleRes.rows[0];
    if (!rule) {
      if (ownClient) await dbClient.query('ROLLBACK');
      return; // no rule = 0 commission
    }

    // 3. Calculate amounts
    const calc = (rate) => {
      if (!rate || rate === 0) return 0;
      return rule.commission_type === 'percent'
        ? parseFloat(((txnAmount * rate) / 100).toFixed(2))
        : parseFloat(rate);
    };

    const retailerAmt    = calc(rule.retailer_rate);
    const wlAmt          = calc(rule.whitelabel_rate);

    // 4. Credit retailer
    await creditUser(dbClient, retailer, retailerAmt, rule, txnAmount, transactionRef, serviceType, providerId);

    // 5. Walk up hierarchy
    let current  = retailer;
    let prevRate = rule.retailer_rate;
    while (current.parent_id) {
      const parentRes = await dbClient.query(
        `SELECT id, role, parent_id, commission_frozen FROM users WHERE id = $1`,
        [current.parent_id]
      );
      const parent = parentRes.rows[0];
      if (!parent || parent.role === 'admin' || parent.role === 'super_admin') break;

      if (parent.role === 'whitelabel') {
        await creditUser(dbClient, parent, wlAmt, rule, txnAmount, transactionRef, serviceType, providerId);
        break;
      }

      const thisRate = parent.role === 'master_distributor' ? rule.md_rate : rule.distributor_rate;
      const spread   = parseFloat((calc(thisRate) - calc(prevRate)).toFixed(2));
      if (spread > 0) {
        await creditUser(dbClient, parent, spread, rule, txnAmount, transactionRef, serviceType, providerId);
      }
      prevRate = thisRate;
      current  = parent;
    }

    if (ownClient) await dbClient.query('COMMIT');
  } catch (err) {
    if (ownClient) await dbClient.query('ROLLBACK');
    console.error('commissionEngine.calculate error:', err.message);
  } finally {
    if (ownClient && dbClient) dbClient.release();
  }
}

// ─── Internal: credit one user ───────────────────────────────────
async function creditUser(dbClient, user, amount, rule, txnAmount, transactionRef, serviceType, providerId) {
  if (!amount || amount <= 0) return;

  await dbClient.query(
    `UPDATE users SET commission_wallet = COALESCE(commission_wallet, 0) + $1 WHERE id = $2`,
    [amount, user.id]
  );

  const rateColumn     = user.role + '_rate';
  const commissionRate = rule[rateColumn] || 0;

  await dbClient.query(
    `INSERT INTO commission_ledger
       (user_id, transaction_ref, service_type, provider_id,
        txn_amount, commission_rate, commission_amount, role_at_time, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'credited')`,
    [user.id, transactionRef, serviceType, providerId,
     txnAmount, commissionRate, amount, user.role]
  );
}

// ─── REVERSE: Called on refund/fail ─────────────────────────────
async function reverse(transactionRef, client = null) {
  let ownClient = false;
  let dbClient  = client;

  if (!dbClient) {
    dbClient  = await pool.connect();
    ownClient = true;
  }

  try {
    if (ownClient) await dbClient.query('BEGIN');

    const ledger = await dbClient.query(
      `SELECT * FROM commission_ledger WHERE transaction_ref = $1 AND status = 'credited'`,
      [transactionRef]
    );

    for (const entry of ledger.rows) {
      await dbClient.query(
        `UPDATE users SET mainwallet = COALESCE(mainwallet, 0) + $1 WHERE id = $2`,
        [entry.commission_amount, entry.user_id]
      );
      await dbClient.query(
        `UPDATE commission_ledger SET status = 'reversed', updated_at = NOW() WHERE id = $1`,
        [entry.id]
      );
    }

    if (ownClient) await dbClient.query('COMMIT');
  } catch (err) {
    if (ownClient) await dbClient.query('ROLLBACK');
    console.error('commissionEngine.reverse error:', err.message);
  } finally {
    if (ownClient && dbClient) dbClient.release();
  }
}

module.exports = { calculate, reverse };