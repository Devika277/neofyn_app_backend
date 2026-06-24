const express = require('express');
const router = express.Router();
const dmtService = require('../services/DMT/dmtService');

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// ========== MASTER DATA (no encryption) ==========
router.get('/states', asyncHandler(async (req, res) => {
    const result = await dmtService.getStates();
    res.json(result);  // already { success, data }
}));

// POST is correct as per Vimopay spec


// Fallback: POST for backward compatibility (optional)
// ✅ Only GET (no POST)
// Node router
router.get('/cities', asyncHandler(async (req, res) => {
    const { stateCode } = req.query;
    if (!stateCode) {
        return res.status(400).json({ success: false, message: 'stateCode required' });
    }
    const result = await dmtService.getCities(stateCode.trim());
    res.json(result);
}));


router.get('/banks', asyncHandler(async (req, res) => {
    const result = await dmtService.getBanks();
    res.json(result);   // result already { success, data }
}));

// ========== DMT REGISTRATION & TRANSACTIONS ==========
router.post('/agent/register', asyncHandler(async (req, res) => {
    const result = await dmtService.agentRegistration(req.body);
    res.json(result);
}));

router.post('/agent/login', asyncHandler(async (req, res) => {
    const { agentMobile, agentPan } = req.body;

    if (!agentMobile || !agentPan) {
        return res.status(400).json({ success: false, message: 'Mobile and PAN required' });
    }

    const query = `
        SELECT agent_code, agent_name, agent_shop_name, agent_mobile
        FROM agents
        WHERE agent_mobile = $1 AND agent_pan = $2
        LIMIT 1
    `;
    const result = await pool.query(query, [agentMobile, agentPan.toUpperCase()]);

    if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Agent not found. Please register first.' });
    }

    const agent = result.rows[0];
    res.json({
        success: true,
        agentCode: agent.agent_code,
        agentName: agent.agent_name,
        agentMobile: agent.agent_mobile,
        shopName: agent.agent_shop_name
    });
}));



router.post('/sender/register', asyncHandler(async (req, res) => {
    const result = await dmtService.senderRegistration(req.body);
    res.json(result);
}));

router.post('/sender/retrigger-otp', asyncHandler(async (req, res) => {
    const result = await dmtService.retriggerSenderOtp(req.body);
    res.json(result);
}));

router.post('/sender/verify-otp', asyncHandler(async (req, res) => {
    const result = await dmtService.verifySenderOtp(req.body);
    res.json(result);
}));

// Beneficiary List
router.post('/beneficiary/list', asyncHandler(async (req, res) => {
    const result = await dmtService.beneficiaryList(req.body);
    res.json(result);
}));


// router.post('/beneficiary/register', asyncHandler(async (req, res) => {
//     const result = await dmtService.beneficiaryRegistration(req.body);
//     res.json(result);
// }));

router.post('/beneficiary/register', asyncHandler(async (req, res) => {
    const result = await dmtService.registerBeneficiary(req.body);   // ✅ correct name
    res.json(result);
}));


// Penny Drop
router.post('/penny-drop', asyncHandler(async (req, res) => {
    const result = await dmtService.pennyDrop(req.body);
    res.json(result);
}));


router.post('/otp/resend', asyncHandler(async (req, res) => {
    const result = await dmtService.resendTransactionOtp(req.body);
    res.json(result);
}));

router.post('/transaction', asyncHandler(async (req, res) => {
    const result = await dmtService.dmtTransaction(req.body);
    res.json(result);
}));

// Local DB Sync (plain JSON, no encryption)
router.post('/beneficiary/sync-local', asyncHandler(async (req, res) => {
    const result = await dmtService.syncBeneficiaryWithLocalDb(req.body);
    res.json(result);
}));

module.exports = router;