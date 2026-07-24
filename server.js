require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const dmtRoutes = require('./routes/dmtRoutes');
const masterRoutes = require('./routes/master');
const merchantRoutes = require('./routes/merchant');
const aepsRoutes = require('./routes/aepsRoutes');  // Add AEPS routes
const payoutRoutes = require('./routes/payoutRoutes'); // ADD THIS LINE
const commissionRoutes = require('./routes/commissionRoutes');
const fundRoutes = require('./routes/fundRoutes');
const pool = require('./config/db.js');

const app = express();

// ========== MIDDLEWARE ==========
// Parse JSON bodies
app.use(express.json({ limit: '10mb' }));
// Parse URL-encoded bodies (for form data)
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// CORS
app.use(cors());
// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    console.log(`🔍 Incoming: ${req.method} ${req.url}`);

    next();
});

// ========== CHECK ENVIRONMENT VARIABLES ==========
console.log("JWT_SECRET loaded:", process.env.JWT_SECRET ? "YES" : "MISSING ❌");
console.log("AEPS credentials:", {
    baseURL: process.env.VIMOPAY_BASE_URL ? "YES" : "MISSING",
    secretKey: process.env._secretKey  ? "YES" : "MISSING",
    userId: process.env._userId ? "YES" : "MISSING"
});

// ========== ROUTES ==========
// Health check endpoint
app.get('/', (req, res) => res.json({ 
    status: "Server Health: OK",
    timestamp: new Date().toISOString(),
    endpoints: {
        auth: "/api/auth",
        dmt: "/api/dmt",
        master: "/api/master",
        merchant: "/api/merchant",
        recharge: "/api/recharge",
        bbps: "/api/bbps",
        aeps: "/api/aeps",
        payout: "/api/payout",
        wallet: "/api/wallet",
    }
}));

app.use('/api/wallet', require('./routes/walletRoutes')); // ← ADD THIS
app.use('/api/beneficiary', require('./routes/beneficiaryRoutes'));
app.use('/api/auth', authRoutes);
app.use('/api/payout/callback', (req, res, next) => {

  console.log('🔔 DMT CALLBACK HIT');
  console.log('Timestamp:', new Date().toISOString());
  console.log('IP:', req.ip);
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  next();
});
app.use('/api/dmt', dmtRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/fund', fundRoutes);
app.use('/api/states', require('./routes/bbpsStates.js'));
app.use('/api/recharge', require('./routes/rechargeRoutes'));
app.use('/api/bbps', require('./routes/bbpsRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/commission', commissionRoutes);
app.use('/api/aeps', aepsRoutes);
app.use('/api/payout', payoutRoutes);

// ========== 404 HANDLER ==========
// This should be AFTER all routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.path} not found`
    });
});

// ========== ERROR HANDLER ==========
// This should be LAST
app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({
        success: false,
        message: err.message || 'Internal server error'
    });
});



console.log('✅ Routes mounted:');
console.log('   - /api/auth');
console.log('   - /api/dmt');
console.log('   - /api/master');
console.log('   - /api/merchant');
console.log('   - /api/recharge');
console.log('   - /api/bbps');
console.log('   - /api/aeps');
console.log('   - /api/payout');
console.log('   - /api/wallet');
console.log('   - /api/beneficiary');

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {  // Changed this line to store server reference
    console.log(`✅ Neofyn Backend running on port http://0.0.0.0:${PORT}`);
    console.log(`📍 Access URL: http://0.0.0.0:${PORT}`);
    console.log(`📋 Available endpoints:`);
    console.log(`   - Health: http://0.0.0.0:${PORT}/`);
    console.log(`   - AEPS: http://0.0.0.0:${PORT}/api/aeps`);
    console.log(`   - Banks: http://0.0.0.0:${PORT}/api/aeps/banks`);
    console.log(`   - Payout: http://0.0.0.0:${PORT}/api/payout`); // ADD THIS LINE
});

// ========== SERVER CONFIGURATION ==========
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

// ========== UNHANDLED REJECTION HANDLERS ==========
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION:', err);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

// ========== GRACEFUL SHUTDOWN ==========
// Graceful shutdown — closes HTTP server then releases DB pool
async function gracefulShutdown(signal) {
  console.log(`[${signal}] Signal received — starting graceful shutdown...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log('[shutdown] Pool closed. Exiting.');
      process.exit(0);
    } catch (err) {
      console.error('[shutdown] Error closing pool:', err);
      process.exit(1);
    }
  });
  // Force exit if graceful shutdown takes longer than 10 seconds
  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));