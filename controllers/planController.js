const pool = require('../config/db');

// GET /api/plans
async function getAllPlans(req, res) {
    try {
        const result = await pool.query(
            `SELECT id, name, display_name, is_active, created_at, updated_at
             FROM plans
             ORDER BY id`
        );
        const schemes = result.rows.map(row => ({
            id: row.id,
            name: row.display_name || row.name,
            raw_name: row.name,
            is_active: row.is_active,
            created_at: row.created_at,
            updated_at: row.updated_at
        }));
        res.json({ success: true, data: schemes });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

// POST /api/plans
async function createPlan(req, res) {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Plan name required' });
    try {
        const existing = await pool.query('SELECT id FROM plans WHERE name = $1', [name]);
        if (existing.rows.length) {
            return res.status(409).json({ success: false, message: 'Plan already exists' });
        }
        const displayName = name.toUpperCase().replace(/_/g, ' ');
        const result = await pool.query(
            `INSERT INTO plans (name, display_name, is_active)
             VALUES ($1, $2, true)
             RETURNING id, name, display_name, is_active, created_at, updated_at`,
            [name, displayName]
        );
        const newPlan = result.rows[0];
        res.status(201).json({
            success: true,
            data: {
                id: newPlan.id,
                name: newPlan.display_name,
                raw_name: newPlan.name,
                is_active: newPlan.is_active,
                created_at: newPlan.created_at,
                updated_at: newPlan.updated_at
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

// PUT /api/plans/:id
async function updatePlan(req, res) {
    const { id } = req.params;
    const { name, display_name, is_active } = req.body;
    try {
        const updates = [];
        const values = [];
        if (name !== undefined) {
            updates.push(`name = $${values.length + 1}`);
            values.push(name);
        }
        if (display_name !== undefined) {
            updates.push(`display_name = $${values.length + 1}`);
            values.push(display_name);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${values.length + 1}`);
            values.push(is_active);
        }
        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }
        updates.push(`updated_at = NOW()`);
        values.push(id);
        const query = `UPDATE plans SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`;
        const result = await pool.query(query, values);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Plan not found' });
        }
        const updated = result.rows[0];
        res.json({
            success: true,
            data: {
                id: updated.id,
                name: updated.display_name || updated.name,
                raw_name: updated.name,
                is_active: updated.is_active,
                created_at: updated.created_at,
                updated_at: updated.updated_at
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

// POST /api/plans/assign/:userId
async function assignPlanToUser(req, res) {
    const { userId } = req.params;
    const { planName } = req.body;
    if (!planName) return res.status(400).json({ success: false, message: 'planName required' });
    try {
        const planCheck = await pool.query('SELECT id FROM plans WHERE name = $1', [planName]);
        if (planCheck.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Plan not found' });
        }
        const result = await pool.query(
            `UPDATE users SET plan = $1 WHERE id = $2 RETURNING id, plan`,
            [planName, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, message: 'Plan assigned to user', data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

// DELETE /api/plans/:id
async function deletePlan(req, res) {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const planRes = await client.query('SELECT name FROM plans WHERE id = $1', [id]);
        if (planRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Plan not found' });
        }
        const planName = planRes.rows[0].name;

        const deletedRates = await client.query('DELETE FROM commission_rates WHERE plan = $1', [planName]);
        console.log(`Deleted ${deletedRates.rowCount} commission rates for plan ${planName}`);

        const updatedUsers = await client.query("UPDATE users SET plan = 'free' WHERE plan = $1", [planName]);
        console.log(`Reset ${updatedUsers.rowCount} users from plan ${planName} to 'free'`);

        const deletePlanResult = await client.query('DELETE FROM plans WHERE id = $1', [id]);
        if (deletePlanResult.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Plan not found' });
        }

        await client.query('COMMIT');
        res.json({
            success: true,
            message: `Plan "${planName}" deleted. ${deletedRates.rowCount} commission rates removed, ${updatedUsers.rowCount} users reset to 'free'.`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Delete plan error:', err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
}

// GET /api/plans/:planName/rules
async function getRulesByPlanName(req, res) {
    const { planName } = req.params;
    try {
        const result = await pool.query(
            `SELECT * FROM commission_rates WHERE plan = $1 ORDER BY service_type, role, slab_name`,
            [planName]
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
}

// POST /api/plans/:planName/rules
async function upsertRuleForPlan(req, res) {
    const { planName } = req.params;
    const { service_type, role, slab_name, min_amount, max_amount, rate_value, rate_type } = req.body;

    if (!service_type || !role || !slab_name) {
        return res.status(400).json({ success: false, message: 'Missing required fields: service_type, role, slab_name' });
    }
    if (!['percent', 'flat'].includes(rate_type)) {
        return res.status(400).json({ success: false, message: 'rate_type must be "percent" or "flat"' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO commission_rates 
                (plan, service_type, role, slab_name, min_amount, max_amount, rate_value, rate_type, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
             ON CONFLICT (plan, service_type, role, slab_name)
             DO UPDATE SET
                rate_value = EXCLUDED.rate_value,
                rate_type  = EXCLUDED.rate_type,
                min_amount = EXCLUDED.min_amount,
                max_amount = EXCLUDED.max_amount,
                updated_at = NOW()
             RETURNING *`,
            [planName, service_type, role, slab_name, min_amount ?? 0, max_amount ?? 0, rate_value, rate_type]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error('upsertRuleForPlan error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
}

// DELETE /api/plans/:planName/rules/:ruleId
async function deleteRuleForPlan(req, res) {
    const { ruleId } = req.params;
    try {
        const result = await pool.query('DELETE FROM commission_rates WHERE id = $1 RETURNING id', [ruleId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Rule not found' });
        }
        res.json({ success: true, message: 'Rule deleted' });
    } catch (err) {
        console.error('deleteRuleForPlan error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
}

module.exports = {
    getAllPlans,
    createPlan,
    updatePlan,
    assignPlanToUser,
    deletePlan,
    getRulesByPlanName,
    upsertRuleForPlan,
    deleteRuleForPlan
};