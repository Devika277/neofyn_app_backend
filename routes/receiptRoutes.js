const express = require('express');
const { 
  getPayoutReceipt, 
  getRechargeReceipt, 
  getAepsReceipt,
  getBbpsReceipt 
} = require('../controllers/receiptController');

const router = express.Router();

router.get('/payout/:transactionId', getPayoutReceipt);
router.get('/recharge/:transactionId', getRechargeReceipt);
router.get('/aeps/:transactionId', getAepsReceipt);
router.get('/bbps/:transactionId', getBbpsReceipt);

module.exports = router;