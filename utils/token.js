const jwt = require('jsonwebtoken');


exports.generateAccessToken = (user) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set in .env');

    const tpinSet = !!user.tpin;  // or user.tpinSet if passed explicitly

    // ✅ Only sign minimal fields — NOT the whole user object
    return jwt.sign(
        {
            id:    user.id,
            email: user.email,
            phone: user.phone,
            role:  user.role,
            tpinSet: tpinSet,           // ✅ critical for frontend

        },
        secret,
        { expiresIn: '7d' }
    );
};


// exports.generateRefreshToken = (user) => {
//   return jwt.sign({ id: user.id }, process.env.REFRESH_TOKEN_SECRET);
// };

exports.generateRefreshToken = (user) => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set in .env');

    return jwt.sign(
        { id: user.id },
        secret,
        { expiresIn: '30d' }
    );
};

//module.exports = { generateAccessToken, generateRefreshToken };