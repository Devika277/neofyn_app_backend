//permission middle ware
const db = require('../config/db');

/**
 * Middleware factory to check if the current user has a specific permission.
 * Decision order:
 *  1. Super-admin bypass (role = 'admin' or 'super_admin') → always allow.
 *  2. User override in user_permissions table (most specific):
 *       - If row exists and granted = true  → allow.
 *       - If row exists and granted = false → deny (403).
 *  3. Role default in role_permissions table:
 *       - If row exists → allow.
 *       - No row → deny.
 *
 * Returns 403 only when a permission is explicitly denied or the role lacks it.
 */
function requirePermission(permissionName) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const role = req.user?.role?.toLowerCase().trim();

      if (!userId || !role) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // ── 1. Super-admin bypass ──────────────────────────────────────────
      if (role === 'admin' || role === 'super_admin') {
        return next();
      }

      // ── 2. User-level override (check granted column) ─────────────────
      try {
        const override = await db.query(
          `SELECT granted FROM user_permissions
           WHERE user_id = $1 AND LOWER(permission) = LOWER($2)`,
          [userId, permissionName]
        );

        if (override.rows.length > 0) {
          if (override.rows[0].granted === true) {
            return next();               // explicit allow
          } else {
            // granted === false → explicit deny
            return res.status(403).json({
              error: `Access denied — permission "${permissionName}" is explicitly blocked for your account.`,
              permission: permissionName,
            });
          }
        }
      } catch (err) {
        // If table doesn't exist yet, skip user check
        if (err.code !== '42P01' && err.code !== '42703') {
          console.error('[permissionMiddleware] user_permissions error:', err.message);
        }
      }

      // ── 3. Role default (only if no user override was found) ───────────
      try {
        const roleCheck = await db.query(
          `SELECT permission FROM role_permissions
           WHERE LOWER(role) = LOWER($1) AND LOWER(permission) = LOWER($2)`,
          [role, permissionName]
        );

        if (roleCheck.rows.length > 0) {
          return next();   // role allows it
        }

        // No role row → deny
        return res.status(403).json({
          error: `Access denied — your role (${role}) does not have permission: ${permissionName}`,
          permission: permissionName,
        });
      } catch (err) {
        // If role_permissions table is missing (fresh install), deny by default
        if (err.code === '42P01') {
          console.warn(`[permissionMiddleware] role_permissions table missing — denying access for ${permissionName}`);
          return res.status(403).json({
            error: 'Permission system not fully configured (missing role_permissions table).',
          });
        }
        console.error('[permissionMiddleware] role_permissions error:', err.message);
        return res.status(500).json({ error: 'Permission check failed' });
      }
    } catch (err) {
      console.error('[requirePermission] Unexpected error:', err.message);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { requirePermission };