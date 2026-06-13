// backend/services/memberService.js

const db = require('../../config/db');

/**
 * Returns ALL users in the downline of userId (recursive).
 * If userId is the admin, returns all users.
 */
async function getDownline(userId, isAdmin = false) {
  if (isAdmin) {
    const res = await db.query(
      `SELECT id, first_name, last_name, email, phone, role,
       member_id, parent_id, created_at, approved_at
       FROM users WHERE role != 'pending' ORDER BY created_at DESC`
    );
    return res.rows;
  }
  const res = await db.query(
    `WITH RECURSIVE downline AS (
       SELECT id FROM users WHERE parent_id = $1
       UNION ALL
       SELECT u.id FROM users u
       INNER JOIN downline d ON u.parent_id = d.id
     )
     SELECT u.id, u.first_name, u.last_name, u.email, u.phone,
            u.role, u.member_id, u.parent_id, u.created_at, u.approved_at
     FROM users u
     WHERE u.id IN (SELECT id FROM downline)
     ORDER BY u.created_at DESC`,
    [userId]
  );
  return res.rows;
}

/**
 * Returns only direct children (one level down).
 */
async function getDirectChildren(userId) {
  const res = await db.query(
    `SELECT id, first_name, last_name, email, phone,
            role, member_id, created_at
     FROM users WHERE parent_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return res.rows;
}

/**
 * Walks UP the tree from userId to root. Used by commission engine.
 */
async function getAncestors(userId) {
  const res = await db.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, role, parent_id FROM users WHERE id = $1
       UNION ALL
       SELECT u.id, u.role, u.parent_id FROM users u
       INNER JOIN ancestors a ON u.id = a.parent_id
     )
     SELECT id, role, parent_id FROM ancestors
     WHERE id != $1`,
    [userId]
  );
  return res.rows; // ordered from direct parent to root
}

module.exports = { getDownline, getDirectChildren, getAncestors };