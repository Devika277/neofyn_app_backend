const express = require('express');
const router = express.Router();
const protect  = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Import controller methods directly — avoids class binding issues
const bbpsController = require('../controllers/bbpsController');
console.log('BBPS Routes - Available functions:', Object.keys(bbpsController));

router.use(protect);

router.get('/categories', protect, (req, res) => bbpsController.getCategories(req, res));
router.get('/states',     (req, res) => bbpsController.getStates(req, res));
router.get('/billers',    (req, res) => bbpsController.getBillers(req, res));
// router.post('/fetch-bill',(req, res) => bbpsController.fetchBill(req, res));
// router.post('/pay-bill',  (req, res) => bbpsController.payBill(req, res));
router.get('/status/:merchantRefId', (req, res) => bbpsController.checkStatus(req, res));


router.post('/fetch-bill', protect, (req, res) => bbpsController.fetchBill(req, res));
router.post('/pay-bill', protect, (req, res) => bbpsController.payBill(req, res));
router.get('/bill-history', protect, (req, res) => bbpsController.getBillHistory(req, res));
module.exports = router;