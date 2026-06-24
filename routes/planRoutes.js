const express = require('express');
const router = express.Router();
const planController = require('../controllers/planController');

router.get('/', planController.getAllPlans);
router.post('/', planController.createPlan);
router.put('/:id', planController.updatePlan);
router.post('/assign/:userId', planController.assignPlanToUser);
router.delete('/:id', planController.deletePlan);
router.get('/:planName/rules', planController.getRulesByPlanName);
router.post('/:planName/rules', planController.upsertRuleForPlan);
router.delete('/:planName/rules/:ruleId', planController.deleteRuleForPlan);

module.exports = router;