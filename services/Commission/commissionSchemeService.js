// services/commissionSchemeService.js
const pool = require('../config/db');

// ─── Scheme (Plan) CRUD ───────────────────────────────────────────────
async function getAllSchemes() {
    const result = await pool.query(
        `SELECT id, name, is_active, created_at, updated_at
         FROM commission_schemes
         ORDER BY id`
    );
    return result.rows;
}

async function getSchemeById(id) {
    const result = await pool.query(
        `SELECT id, name, is_active, created_at, updated_at
         FROM commission_schemes
         WHERE id = $1`,
        [id]
    );
    return result.rows[0];
}

async function createScheme(name) {
    const result = await pool.query(
        `INSERT INTO commission_schemes (name)
         VALUES ($1)
         RETURNING id, name, is_active, created_at, updated_at`,
        [name]
    );
    return result.rows[0];
}

async function updateScheme(id, { name, is_active }) {
    const result = await pool.query(
        `UPDATE commission_schemes
         SET name = COALESCE($1, name),
             is_active = COALESCE($2, is_active),
             updated_at = NOW()
         WHERE id = $3
         RETURNING id, name, is_active, created_at, updated_at`,
        [name, is_active, id]
    );
    return result.rows[0];
}

// ─── Commission Rules CRUD ────────────────────────────────────────────
async function getRulesBySchemeId(schemeId) {
    const result = await pool.query(
        `SELECT r.*, p.name as provider_name
         FROM commission_rules r
         JOIN providers p ON p.id = r.provider_id
         WHERE r.scheme_id = $1
         ORDER BY r.service_type, p.name`,
        [schemeId]
    );
    return result.rows;
}

async function upsertRule(schemeId, { service_type, provider_id, commission_type, whitelabel_rate, md_rate, distributor_rate, retailer_rate }) {
    const result = await pool.query(
        `INSERT INTO commission_rules
         (scheme_id, service_type, provider_id, commission_type,
          whitelabel_rate, md_rate, distributor_rate, retailer_rate, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (scheme_id, service_type, provider_id)
         DO UPDATE SET
            commission_type = EXCLUDED.commission_type,
            whitelabel_rate = EXCLUDED.whitelabel_rate,
            md_rate = EXCLUDED.md_rate,
            distributor_rate = EXCLUDED.distributor_rate,
            retailer_rate = EXCLUDED.retailer_rate,
            updated_at = NOW()
         RETURNING *`,
        [schemeId, service_type, provider_id, commission_type,
         whitelabel_rate, md_rate, distributor_rate, retailer_rate]
    );
    return result.rows[0];
}

async function deleteRule(schemeId, service_type, provider_id) {
    const result = await pool.query(
        `DELETE FROM commission_rules
         WHERE scheme_id = $1 AND service_type = $2 AND provider_id = $3
         RETURNING id`,
        [schemeId, service_type, provider_id]
    );
    return result.rowCount > 0;
}

// ─── Assign scheme to user ────────────────────────────────────────────
async function assignSchemeToUser(userId, schemeId) {
    const result = await pool.query(
        `UPDATE users
         SET scheme_id = $1
         WHERE id = $2
         RETURNING id, scheme_id`,
        [schemeId, userId]
    );
    return result.rows[0];
}

module.exports = {
    getAllSchemes,
    getSchemeById,
    createScheme,
    updateScheme,
    getRulesBySchemeId,
    upsertRule,
    deleteRule,
    assignSchemeToUser
};