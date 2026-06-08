const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const authHeader = req.headers['authorization'];

   // DEBUG — print exactly what is received
        console.log('=== AUTH DEBUG ===');
        console.log('Authorization header:', authHeader);
        console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
        console.log('JWT_SECRET value:', process.env.JWT_SECRET); // temp
        console.log('==================');

    console.log('=== AUTH MIDDLEWARE DEBUG ===');
    console.log('Headers received:', JSON.stringify(req.headers, null, 2));
    console.log('Authorization header:', req.headers.authorization);
    
         if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No token, authorization denied' });
        }

  const token = req.headers['authorization']?.split(' ')[1];
  
  console.log('Token length:', token.length);
  
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });
        console.log('Token being verified:', token);

if (!token) {
    console.log("❌ AUTH ERROR: No token found in headers");
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Decoded payload:', decoded);

    req.user = decoded;
    next();
  } catch (err) {

    // DEBUG LOG 2
    console.log("❌ AUTH ERROR: Token verification failed:", err.message);
    res.status(401).json({ message: 'Token is not valid' });

    res.status(401).json({ message: 'Token is not valid' });
    
    return res.status(401).json({ message: 'Token is not valid' }); // ✅ return added


  }
};