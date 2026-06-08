require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const dmtRoutes = require('./routes/dmtRoutes');
const masterRoutes = require('./routes/master');
const merchantRoutes = require('./routes/merchant');
const aepsRoutes = require('./routes/aepsRoutes');  // Add AEPS routes
const payoutRoutes = require('./routes/payoutRoutes'); // ADD THIS LINE

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
        aeps: "/api/aeps"
    }
}));

app.use('/api/wallet', require('./routes/walletRoutes')); // ← ADD THIS
app.use('/api/beneficiary', require('./routes/beneficiaryRoutes'));


// Existing Routes
app.use('/api/auth', authRoutes);
app.use('/api/dmt', dmtRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/recharge', require('./routes/rechargeRoutes'));
app.use('/api/bbps', require('./routes/bbpsRoutes'));

// NEW: AEPS Routes
app.use('/api/aeps', aepsRoutes);

app.use('/api/payout', payoutRoutes); // ADD THIS LINE

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

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Neofyn Backend running on port ${PORT}`);
    console.log(`📍 Access URL: http://0.0.0.0:${PORT}`);
    console.log(`📋 Available endpoints:`);
    console.log(`   - Health: http://0.0.0.0:${PORT}/`);
    console.log(`   - AEPS: http://0.0.0.0:${PORT}/api/aeps`);
    console.log(`   - Banks: http://0.0.0.0:${PORT}/api/aeps/banks`);
    console.log(`   - Payout: http://0.0.0.0:${PORT}/api/payout`); // ADD THIS LINE

});