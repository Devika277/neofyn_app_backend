const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  console.log('=== AUTH MIDDLEWARE ===');
  console.log('Authorization header:', authHeader);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded payload:', decoded);
    req.user = decoded;   // contains id, email, phone, role, tpinSet
    next();
  } catch (err) {
    console.error('❌ AUTH ERROR:', err.message);
    // Send only ONE response
    return res.status(401).json({ message: 'Token is not valid' });
  }
};
module.exports = { protect }; 