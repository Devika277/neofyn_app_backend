const express = require('express');
const router = express.Router();
const db = require('../config/db'); // adjust path to your db
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp'); // npm install sharp



// ─── Multer: receipt uploads ────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '../uploads/receipts');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `receipt_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB hard cap (we compress down after)
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('Only JPG, PNG, PDF files are allowed'));
  },
});

// Helper: compress image to < 500 KB if it's not a PDF
async function compressIfNeeded(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return; // skip PDFs

  const stat = fs.statSync(filePath);
  if (stat.size <= 500 * 1024) return; // already small enough

  const compressed = filePath.replace(/(\.\w+)$/, '_c$1');
  await sharp(filePath)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toFile(compressed);

  fs.unlinkSync(filePath);         // remove original
  fs.renameSync(compressed, filePath); // replace with compressed
}



// GET /api/wallet/main/:userIdJ
router.get('/main/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await db.query(
      `SELECT balance FROM wallets WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    res.json({ balance: result.rows[0]?.balance ?? 0 });
  } catch (err) {
    console.error('main wallet error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// GET /api/wallet/aeps/:userId  
router.get('/aeps/:userId', async (req, res) => {
  const { userId } = req.params;
  console.log('💰 wallet/aeps hit for userId:', userId);
  try {
    const result = await db.query(
      `SELECT balance FROM aeps_wallets WHERE user_id = $1 LIMIT 1`, // ← wallets table, not aeps_wallets
      [userId]
    );
    console.log('💰 AEPS DB result:', result.rows);
    res.json({ balance: result.rows[0]?.balance ?? 0 });
  } catch (error) {
    console.error('💥 aeps wallet error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/wallet/stats/:userId
router.get('/stats/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await db.query(
      `SELECT balance FROM wallets WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    res.json({
      rewards:    0,
      commission: 0,
      ccBalance:  row?.balance ?? 0,   // ← was main_balance (dropped column)
    });
  } catch (err) {
    console.error('stats error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/wallet/ledger/:userId ─────────────────────────────────────────
// Returns wallet ledger (credit/debit history) for a user
router.get('/ledger/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await db.query(
      `SELECT wl.*
       FROM   wallet_ledger wl
       JOIN   wallets w ON w.id = wl.wallet_id
       WHERE  w.user_id = $1
       ORDER  BY wl.created_at DESC
       LIMIT  100`,
      [userId]
    );
    res.json({ success: true, ledger: result.rows });
  } catch (err) {
    console.error('ledger error:', err.message); // ← this will tell you if wallet_ledger also missing
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/wallet/fund-requests/:userId ──────────────────────────────────
// Returns all fund requests for a user
router.get('/fund-requests/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await db.query(
      `SELECT * FROM fund_requests WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    console.error('fund-requests fetch error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/wallet/fund-request ──────────────────────────────────────────
// Submit a new fund request (with receipt upload)
router.post('/fund-request', upload.single('receipt'), async (req, res) => {
  try {
    const {
      user_id,
      amount,
      payment_mode,
      bank_name,
      reference_number,
      pay_date,
      remark,
    } = req.body;

    // Validate required fields
    if (!user_id || !amount || !payment_mode || !bank_name || !reference_number || !pay_date) {
      if (req.file) fs.unlinkSync(req.file.path); // clean up if validation fails
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Compress receipt if image
    let receiptPath = null;
    if (req.file) {
      await compressIfNeeded(req.file.path);
      // Store relative path (serve via /uploads/receipts/ static route)
      receiptPath = `receipts/${req.file.filename}`;
    }

    const result = await db.query(
      `INSERT INTO fund_requests
         (user_id, amount, payment_mode, bank_name, reference_number,
          pay_date, remark, receipt_path, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW())
       RETURNING id`,
      [user_id, amount, payment_mode, bank_name, reference_number,
       pay_date, remark || null, receiptPath]
    );

    res.json({
      success: true,
      message: 'Fund request has been initiated successfully',
      requestId: result.rows[0].id,
    });
  } catch (err) {
    console.error('fund-request submit error:', err.message);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /api/wallet/fund-request/:id/approve ─────────────────────────────
// Admin approves a fund request → credits wallet → writes ledger entry
router.patch('/fund-request/:id/approve', async (req, res) => {
  const { id }          = req.params;
  const { admin_id, admin_remark } = req.body;

  const client = await db.connect(); // transaction
  try {
    await client.query('BEGIN');

    // 1. Fetch the fund request
    const frResult = await client.query(
      `SELECT * FROM fund_requests WHERE id = $1 AND status = 'pending'`,
      [id]
    );
    if (frResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Fund request not found or already processed' });
    }
    const fr = frResult.rows[0];

    // 2. Get wallet
    const walletResult = await client.query(
      `SELECT * FROM wallets WHERE user_id = $1 LIMIT 1`,
      [fr.user_id]
    );
    if (walletResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Wallet not found for user' });
    }
    const wallet     = walletResult.rows[0];
    const newBalance = parseFloat(wallet.balance) + parseFloat(fr.amount);

    // 3. Credit the wallet
    await client.query(
      `UPDATE wallets SET balance = $1, updated_at = NOW() WHERE id = $2`,
      [newBalance, wallet.id]
    );

    // 4. Write wallet_ledger credit entry
    await client.query(
      `INSERT INTO wallet_ledger
         (wallet_id, transaction_type, amount, balance_after,
          description, reference_id, status, created_at)
       VALUES ($1, 'credit', $2, $3, $4, $5, 'success', NOW())`,
      [
        wallet.id,
        fr.amount,
        newBalance,
        `Fund request approved #${fr.user_id}`,
        fr.id,
      ]
    );

    // 5. Mark fund request approved
    await client.query(
      `UPDATE fund_requests
       SET status = 'approved', admin_remark = $1,
           reviewed_at = NOW(), reviewed_by = $2
       WHERE id = $3`,
      [admin_remark || null, admin_id || null, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Fund request approved and wallet credited', newBalance });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('approve error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ─── PATCH /api/wallet/fund-request/:id/reject ──────────────────────────────
router.patch('/fund-request/:id/reject', async (req, res) => {
  const { id }          = req.params;
  const { admin_id, admin_remark } = req.body;
  try {
    await db.query(
      `UPDATE fund_requests
       SET status = 'rejected', admin_remark = $1,
           reviewed_at = NOW(), reviewed_by = $2
       WHERE id = $3 AND status = 'pending'`,
      [admin_remark || null, admin_id || null, id]
    );
    res.json({ success: true, message: 'Fund request rejected' });
  } catch (err) {
    console.error('reject error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;