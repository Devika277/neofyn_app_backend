// ============================================
// Admin/Whitelabel Authorization Middleware
// Checks if the authenticated user has role='admin' or 'whitelabel'
// ============================================
const adminMiddleware = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'User not authenticated' 
      });
    }
    const userRole = user.role ? user.role.toLowerCase() : '';
    if (userRole !== 'admin' && userRole !== 'whitelabel') {
      return res.status(403).json({ 
        success: false, 
        error: 'Access denied. Admin or Whitelabel privileges required.' 
      });
    }
    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error during authorization' 
    });
  }
};

// ✅ Added a named export for strict admin-only checks (used by AePS)
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Admin access required' });
  }
};


module.exports = adminMiddleware;
module.exports.isAdmin = isAdmin;
module.exports.adminOnly = isAdmin;