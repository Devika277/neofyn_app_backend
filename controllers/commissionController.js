// controllers/commissionController.js
const pool = require('../config/db');
const commissionEngine = require('../services/Commission/commissionEngine');

// ─── USER ENDPOINTS ───────────────────────────────────────────────────

// GET /api/commission/balance
const getBalance = async (req, res) => {
    const result = await pool.query(
        `SELECT commission_wallet AS balance, commission_frozen AS frozen
         FROM users WHERE id = $1`,
        [req.user.id]
    );
    res.json({ success: true, data: result.rows[0] });
};

// GET /api/commission/history?page=1&limit=20&status=credited
const getHistory = async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    
    let query = `SELECT * FROM commission_ledger WHERE user_id = $1`;
    const params = [req.user.id];
    
    if (status) {
        query += ` AND status = $${params.length + 1}`;
        params.push(status);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
};

// POST /api/commission/transfer
// controllers/commissionController.js

const transferToMain = async (req, res) => {
    const { amount } = req.body;
    console.log('💰 Transfer request:', { userId: req.user.id, amount });
    
    if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid amount' });
    }

    // Get min transfer amount from settings
    const setting = await pool.query(`SELECT value FROM commission_settings WHERE key = 'min_transfer_amount'`);
    const minAmt = parseFloat(setting.rows[0]?.value || 100);
    if (amount < minAmt) {
        return res.status(400).json({ success: false, message: `Minimum transfer is Rs.${minAmt}` });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Check user's commission balance
        const userRes = await client.query(
            `SELECT commission_wallet, commission_frozen FROM users WHERE id = $1 FOR UPDATE`,
            [req.user.id]
        );
        const user = userRes.rows[0];
        
        console.log('📊 User commission before transfer:', user);
        
        if (!user) throw new Error('User not found');
        if (user.commission_frozen) throw new Error('Commission wallet is frozen. Contact admin.');
        if (parseFloat(user.commission_wallet) < amount) throw new Error('Insufficient commission balance');

        // 2. Check if wallet exists for this user
        const walletCheck = await client.query(
            `SELECT id, balance FROM wallets WHERE user_id = $1 FOR UPDATE`,
            [req.user.id]
        );
        
        let walletId;
        let currentBalance = 0;
        
        if (walletCheck.rows.length === 0) {
            // Create wallet if it doesn't exist
            const newWallet = await client.query(
                `INSERT INTO wallets (user_id, balance, status, created_at, updated_at) 
                 VALUES ($1, $2, 'active', NOW(), NOW()) 
                 RETURNING id, balance`,
                [req.user.id, 0]
            );
            walletId = newWallet.rows[0].id;
            currentBalance = 0;
            console.log('📊 New wallet created for user:', req.user.id);
        } else {
            walletId = walletCheck.rows[0].id;
            currentBalance = parseFloat(walletCheck.rows[0].balance);
            console.log('📊 Existing wallet balance:', currentBalance);
        }

        // 3. Update commission wallet (users table) - DECREASE
        await client.query(
            `UPDATE users 
             SET commission_wallet = commission_wallet - $1 
             WHERE id = $2`,
            [amount, req.user.id]
        );

        // 4. Update main wallet (wallets table) - INCREASE
        await client.query(
            `UPDATE wallets 
             SET balance = balance + $1, 
                 updated_at = NOW() 
             WHERE user_id = $2`,
            [amount, req.user.id]
        );

        // 5. Log the transfer in commission_ledger
        await client.query(
            `INSERT INTO commission_ledger (
                user_id, 
                transaction_ref, 
                service_type, 
                txn_amount, 
                commission_amount, 
                role_at_time, 
                status, 
                created_at
            ) VALUES ($1, $2, 'transfer_to_main', $3, $4, $5, 'credited', NOW())`,
            [req.user.id, `TRANSFER_${Date.now()}`, amount, amount, req.user.role || 'user']
        );

        await client.query('COMMIT');
        
        // 6. Get updated balances
        const updatedUser = await client.query(
            `SELECT commission_wallet FROM users WHERE id = $1`,
            [req.user.id]
        );
        const updatedWallet = await client.query(
            `SELECT balance FROM wallets WHERE user_id = $1`,
            [req.user.id]
        );
        
        console.log('📊 Transfer completed:', {
            commission_wallet: updatedUser.rows[0].commission_wallet,
            main_wallet: updatedWallet.rows[0]?.balance || 0
        });
        
        res.json({ 
            success: true, 
            message: 'Transfer successful',
            data: {
                commission_wallet: parseFloat(updatedUser.rows[0].commission_wallet),
                main_wallet: parseFloat(updatedWallet.rows[0]?.balance || 0)
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Transfer error:', err);
        res.status(400).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
};

// ─── ADMIN ENDPOINTS ──────────────────────────────────────────────────

// GET /api/commission/admin/all?page=1&limit=50&search=
const getAllWallets = async (req, res) => {
    const { page = 1, limit = 50, search = '' } = req.query;
    const offset = (page - 1) * limit;
    const searchPattern = `%${search}%`;
    
    // Adjust column names to match your actual schema:
    // - name: concatenation of first_name and last_name
    // - mobile: column 'phone' or 'mobile' – change accordingly
    const result = await pool.query(
        `SELECT id, 
                CONCAT(first_name, ' ', last_name) AS name, 
                phone AS mobile, 
                role, 
                COALESCE(commission_wallet, 0) AS commission_wallet, 
                commission_frozen, 
                scheme_id
         FROM users
         WHERE (first_name ILIKE $1 OR last_name ILIKE $1 OR phone ILIKE $1)
         ORDER BY id
         LIMIT $2 OFFSET $3`,
        [searchPattern, limit, offset]
    );
    
    const total = await pool.query(
        `SELECT COUNT(*) FROM users 
         WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR phone ILIKE $1`,
        [searchPattern]
    );
    
    res.json({
        success: true,
        data: result.rows,
        pagination: { page, limit, total: parseInt(total.rows[0].count) }
    });
};

// POST /api/commission/admin/freeze/:userId
const freezeWallet = async (req, res) => {
    const { userId } = req.params;
    const { frozen } = req.body; // boolean
    
    if (typeof frozen !== 'boolean') {
        return res.status(400).json({ success: false, message: 'frozen must be boolean' });
    }
    
    const result = await pool.query(
        `UPDATE users SET commission_frozen = $1 WHERE id = $2 RETURNING id, commission_frozen`,
        [frozen, userId]
    );
    
    if (result.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    res.json({ success: true, message: `Commission wallet ${frozen ? 'frozen' : 'unfrozen'}`, data: result.rows[0] });
};

// GET /api/commission/admin/settings
const getSettings = async (req, res) => {
    const result = await pool.query(`SELECT key, value FROM commission_settings ORDER BY key`);
    const settings = {};
    result.rows.forEach(row => { settings[row.key] = row.value; });
    res.json({ success: true, data: settings });
};

// PUT /api/commission/admin/settings
const updateSettings = async (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined) {
        return res.status(400).json({ success: false, message: 'key and value required' });
    }
    
    const result = await pool.query(
        `INSERT INTO commission_settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
         RETURNING key, value`,
        [key, value]
    );
    
    res.json({ success: true, data: result.rows[0] });
};



const getCommissionRates = async (req, res) => {
  console.log("✅ getCommissionRates HIT!");
  console.log("📥 Received query params:", req.query);

  try {
    const { service, role, plan, slab_name } = req.query;
    let query = `SELECT * FROM commission_rates WHERE is_active = true`;
    const params = [];
    let idx = 1;

    if (service) { 
      query += ` AND service_type = $${idx++}`; 
      params.push(service); 
      console.log(`🔧 Added service filter: ${service}`);
    }
    if (role) { 
      query += ` AND role = $${idx++}`; 
      params.push(role); 
      console.log(`🔧 Added role filter: ${role}`);
    }
    if (plan) { 
      query += ` AND (plan = $${idx++} OR plan IS NULL)`; 
      params.push(plan); 
      console.log(`🔧 Added plan filter: ${plan}`);
    }
    if (slab_name) { 
      query += ` AND slab_name = $${idx++}`; 
      params.push(slab_name); 
      console.log(`🔧 Added slab_name filter: ${slab_name}`);
    }

    query += ` ORDER BY min_amount ASC`;
    console.log("📝 Final SQL Query:", query);
    console.log("📦 Query Parameters:", params);

    const result = await pool.query(query, params);
    console.log(`✅ Found ${result.rows.length} row(s)`);
    
    // Log first few rows for inspection
    if (result.rows.length > 0) {
      console.log("📋 Sample row:", JSON.stringify(result.rows[0], null, 2));
    } else {
      console.log("⚠️ No rows match the criteria");
    }

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("💥 Database error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};


// PUT /api/commission/rates/:id
const updateCommissionRate = async (req, res) => {
  const { id } = req.params;
  const { rate_value, rate_type, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE commission_rates 
       SET rate_value = $1, rate_type = $2, is_active = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [rate_value, rate_type, is_active, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Commission rate not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const createCommissionRate = async (req, res) => {
  const { service_type, slab_name, min_amount, max_amount, role, plan, rate_value, rate_type, is_active } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO commission_rates 
         (service_type, slab_name, min_amount, max_amount, role, plan, rate_value, rate_type, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [service_type, slab_name, min_amount, max_amount, role, plan, rate_value, rate_type, is_active ?? true]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
};



module.exports = {
    getBalance,
    getHistory,
    transferToMain,
    getAllWallets,
    freezeWallet,
    getSettings,
    updateSettings,
    getCommissionRates,
    updateCommissionRate,
    createCommissionRate
};