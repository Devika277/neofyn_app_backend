// controllers/bbpsController.js
const bbpsService = require('../services/BBPS/bbpsService');
const logger = require('../utils/logger');

/**
 * Helper: Ensure the user has a merchantCode.
 * If not, automatically register the user as a merchant.
 */
async function ensureMerchantCode(userId) {
    let merchantCode = await bbpsService.getUserMerchantCode(userId);
    if (!merchantCode) {
        logger.info(`No merchantCode for user ${userId}, registering now...`);
        const { merchantCode: newCode } = await bbpsService.registerMerchant(userId);
        await bbpsService.saveMerchantCodeForUser(userId, newCode);
        merchantCode = newCode;
    }
    return merchantCode;
}

// GET /api/bbps/categories
async function getCategories(req, res) {
    try {
        // Note: The new BBPS flow doesn't have a direct "categories" endpoint.
        // You can either fetch from a local list or call a master API.
        // For now, return a static list (or you can implement a call to /masterapi if needed)
        const categories = [
            { id: "ELECTRICITY", name: "Electricity Bill", icon: "⚡" },
            { id: "WATER", name: "Water Bill", icon: "💧" },
            { id: "GAS", name: "Gas Bill", icon: "🔥" },
            { id: "TELECOM", name: "Broadband / Landline", icon: "📞" },
            { id: "MOBILE", name: "Mobile Recharge", icon: "📱" }
        ];
        return res.json({ success: true, data: categories });
    } catch (err) {
        logger.error('BBPS getCategories error', { error: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
}

// GET /api/bbps/states (uses the encryption-based master API)
async function getStates(req, res) {
    try {
        // Use the existing getStateList from the service (already uses encryption & authorization)
        const result = await bbpsService.getStateList();
        return res.json(result);
    } catch (err) {
        logger.error('BBPS getStates error', err);
        return res.status(500).json({ success: false, error: err.message });
    }
}

// POST /api/bbps/fetch-bill
async function fetchBill(req, res) {
    try {
        const { serviceType, customerId, billerId, consumerNumber, additionalParams } = req.body;
        const userId = req.user.id;

        // Normalize inputs
        const finalServiceType = serviceType || billerId;
        const finalCustomerId = customerId || consumerNumber;

        if (!finalServiceType || !finalCustomerId) {
            return res.status(400).json({
                success: false,
                message: "Service type and customer ID are required",
                received: { serviceType, customerId, billerId, consumerNumber }
            });
        }

        // Ensure user is registered as a merchant (auto-register if needed)
        await ensureMerchantCode(userId);

        // Call the real fetchBill from bbpsService (encrypts request, decrypts response)
        const fetchBillResult = await bbpsService.fetchBill(userId, {
            billerId: finalServiceType,
            consumerNumber: finalCustomerId,
            additionalParams: additionalParams || {}
        });

        // Store the fetch result temporarily (could be in a cache or DB) so that payBill can use it.
        // For simplicity, we return the whole result to the client; the client must send it back for payment.
        return res.status(200).json({
            success: true,
            data: fetchBillResult
        });
    } catch (error) {
        logger.error('Fetch bill error:', error);
        return res.status(500).json({
            success: false,
            message: error.message,
            code: error.code || "FETCH_FAILED"
        });
    }
}

// POST /api/bbps/pay-bill
async function payBill(req, res) {
    try {
        const { transactionRequest } = req.body;  // Expect the full transactionRequest object from Flutter
        const userId = req.user.id;

        if (!transactionRequest) {
            return res.status(400).json({
                success: false,
                message: "transactionRequest object is required"
            });
        }

        // Ensure merchant code exists
        await ensureMerchantCode(userId);

        // Call the real payBill
        const paymentResult = await bbpsService.payBill(userId, transactionRequest);

        // Optionally save the payment record to your database (not shown here)
        return res.status(200).json({
            success: paymentResult.success,
            transactionId: paymentResult.transactionId,
            transactionRefId: paymentResult.transactionRefId,
            status: paymentResult.paymentStatus,
            message: paymentResult.message,
            rawResponse: paymentResult.rawResponse
        });
    } catch (error) {
        logger.error('Pay bill error:', error);
        return res.status(500).json({
            success: false,
            message: error.message,
            code: error.code || "PAYMENT_FAILED"
        });
    }
}

// GET /api/bbps/history (depends on your own DB, not on BBPS gateway)
async function getBillHistory(req, res) {
    try {
        const userId = req.user.id;
        const { serviceType, limit = 50, offset = 0 } = req.query;

        // This should fetch from your local database where you store past transactions
        // For demonstration, we return an empty array (implement your own DB storage)
        const history = {
            success: true,
            bills: [],   // replace with actual DB query
            total: 0
        };

        return res.status(200).json(history);
    } catch (error) {
        logger.error('Get bill history error:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

// GET /api/bbps/services (static list, or fetch from master)
async function getServices(req, res) {
    try {
        // You could also call bbpsService.getServiceList() if available in the future
        const services = [
            { name: 'ELECTRICITY', display_name: 'Electricity Bill', category: 'UTILITY' },
            { name: 'WATER', display_name: 'Water Bill', category: 'UTILITY' },
            { name: 'GAS', display_name: 'Gas Bill', category: 'UTILITY' },
            { name: 'TELECOM', display_name: 'Broadband Bill', category: 'UTILITY' },
            { name: 'MOBILE', display_name: 'Mobile Recharge', category: 'PREPAID' }
        ];
        return res.status(200).json({ success: true, services });
    } catch (error) {
        logger.error('Get services error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
}

// Optional: Explicit endpoint for merchant registration (can be called separately)
async function registerMerchantEndpoint(req, res) {
    try {
        const userId = req.user.id;
        const merchantCode = await ensureMerchantCode(userId);
        return res.status(200).json({
            success: true,
            merchantCode,
            message: "Merchant registered successfully"
        });
    } catch (error) {
        logger.error('Merchant registration error:', error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

module.exports = {
    getCategories,
    getStates,
    fetchBill,
    payBill,
    getBillHistory,
    getServices,
    registerMerchantEndpoint   // optional extra endpoint
};