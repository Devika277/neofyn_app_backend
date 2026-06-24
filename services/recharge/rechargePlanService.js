// backend/services/rechargePlanService.js
const db = require('../../config/db');

/**
 * Get active recharge plans for a specific operator, grouped by category.
 * (Used by legacy user-facing endpoint; new endpoint uses rechargeService.getPlansByOperatorAndCircle)
 * @param {string} operator - Operator code (JIO, AIRTEL, VI, BSNL)
 * @returns {Promise<Object>} - Object with category keys and array of plans
 */
async function getActivePlansByOperator(operator) {
    const query = `
        SELECT 
            id,
            amount,
            validity_days,
            data_benefit,
            category,
            display_order
        FROM recharge_plans
        WHERE operator = $1
          AND is_active = true
        ORDER BY category, display_order ASC, amount ASC
    `;
    const result = await db.query(query, [operator]);

    const grouped = {};
    for (const plan of result.rows) {
        const cat = plan.category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push({
            id: plan.id,
            amount: parseFloat(plan.amount),
            validity_days: plan.validity_days,
            data_benefit: plan.data_benefit,
            category: plan.category,
        });
    }
    return grouped;
}

/**
 * Get all recharge plans (admin only) with optional filters.
 * @param {Object} filters - { operator, category, circle, is_active }
 * @returns {Promise<Array>}
 */
async function getAllPlans(filters = {}) {
    let query = `
        SELECT 
            id,
            operator,
            amount,
            validity_days,
            data_benefit,
            category,
            circle,
            display_order,
            is_active,
            created_at,
            updated_at
        FROM recharge_plans
        WHERE 1=1
    `;
    const params = [];
    let idx = 1;

    if (filters.operator) {
        query += ` AND operator = $${idx++}`;
        params.push(filters.operator);
    }
    if (filters.category) {
        query += ` AND category = $${idx++}`;
        params.push(filters.category);
    }
    if (filters.circle) {
        query += ` AND circle = $${idx++}`;
        params.push(filters.circle);
    }
    if (filters.is_active !== undefined) {
        query += ` AND is_active = $${idx++}`;
        params.push(filters.is_active === 'true' || filters.is_active === true);
    }
    query += ` ORDER BY operator, circle, category, display_order, amount`;
    const result = await db.query(query, params);
    return result.rows;
}

/**
 * Create a single recharge plan.
 * @param {Object} data - plan data (includes circle)
 * @returns {Promise<Object>} created plan
 */
async function createPlan(data) {
    const { operator, amount, validity_days, data_benefit, category, circle, display_order, is_active } = data;
    const query = `
        INSERT INTO recharge_plans
        (operator, amount, validity_days, data_benefit, category, circle, display_order, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
    `;
    const values = [
        operator,
        amount,
        validity_days || null,
        data_benefit || null,
        category,
        circle || 'ALL',               // default to All India if not provided
        display_order || 0,
        is_active !== undefined ? is_active : true
    ];
    const result = await db.query(query, values);
    return result.rows[0];
}

/**
 * Bulk create plans for a single operator.
 * @param {string} operator - Operator code
 * @param {Array} plans - Array of plan objects: { amount, validity_days, data_benefit, category, circle, display_order }
 * @returns {Promise<Array>} created plans
 */
async function bulkCreatePlans(operator, plans) {
    const created = [];
    for (const plan of plans) {
        if (!plan.amount || !plan.category) continue; // skip incomplete rows
        const newPlan = await createPlan({
            operator,
            amount: plan.amount,
            validity_days: plan.validity_days || null,
            data_benefit: plan.data_benefit || null,
            category: plan.category,
            circle: plan.circle || 'ALL',   // accept circle per plan
            display_order: plan.display_order || 0,
            is_active: true,
        });
        created.push(newPlan);
    }
    return created;
}

/**
 * Update an existing recharge plan.
 * @param {number} id - plan ID
 * @param {Object} data - updated fields (includes circle)
 * @returns {Promise<Object>} updated plan
 */
async function updatePlan(id, data) {
    const { operator, amount, validity_days, data_benefit, category, circle, display_order, is_active } = data;
    const query = `
        UPDATE recharge_plans
        SET operator = $1,
            amount = $2,
            validity_days = $3,
            data_benefit = $4,
            category = $5,
            circle = $6,
            display_order = $7,
            is_active = $8,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING *
    `;
    const values = [
        operator,
        amount,
        validity_days || null,
        data_benefit || null,
        category,
        circle || 'ALL',
        display_order || 0,
        is_active,
        id
    ];
    const result = await db.query(query, values);
    return result.rows[0];
}

/**
 * Toggle active status (soft delete / restore).
 * @param {number} id - plan ID
 * @returns {Promise<Object>} updated plan
 */
async function toggleActive(id) {
    const query = `
        UPDATE recharge_plans
        SET is_active = NOT is_active,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
    `;
    const result = await db.query(query, [id]);
    return result.rows[0];
}

/**
 * Delete a plan (hard delete – optional; we prefer soft delete via toggleActive).
 */
async function deletePlan(id) {
    const query = `DELETE FROM recharge_plans WHERE id = $1 RETURNING id`;
    const result = await db.query(query, [id]);
    return result.rows[0];
}

module.exports = {
    getActivePlansByOperator,
    getAllPlans,
    createPlan,
    bulkCreatePlans,
    updatePlan,
    toggleActive,
    deletePlan,
};