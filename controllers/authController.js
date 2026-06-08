const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const { generateAccessToken, generateRefreshToken } = require('../utils/token');

exports.register = async (req, res) => {
  const client = await pool.connect();
  try {
    const { first_name, last_name, email, phone, password, business_name, business_type,
            business_address, city, state, pin_code, aadhaar_number, pan_number } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await client.query(
      `INSERT INTO users (first_name, last_name, email, phone, password, business_name,
       business_type, business_address, city, state, pin_code, aadhaar_number, pan_number, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending') RETURNING *`,
      [first_name, last_name, email, phone, hashedPassword, business_name,
       business_type, business_address, city, state, pin_code, aadhaar_number, pan_number]
    );

    res.status(201).json({ success: true, message: "Verification pending", user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  } finally { client.release(); }
};


exports.login = async (req, res) => {
  // Add debug logging
  console.log('===== LOGIN REQUEST RECEIVED =====');
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  console.log('Request body type:', typeof req.body);
  
  // Check if body exists
  if (!req.body) {
    console.log('ERROR: req.body is undefined or null');
    return res.status(400).json({ 
      success: false, 
      message: 'Request body is missing. Please send JSON data.' 
    });
  }
  
  const { phone, password } = req.body;
  
  console.log('Phone extracted:', phone);
  console.log('Password present:', !!password);
  
  if (!phone || !password) {
    console.log('ERROR: Missing phone or password');
    return res.status(400).json({ 
      success: false, 
      message: 'Phone number and password are required' 
    });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = result.rows[0];

    if (!user) {
      console.log('User not found:', phone);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log('Password mismatch for user:', phone);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.role === 'pending') {
      return res.status(403).json({ message: 'Account pending approval' });
    }
    if (user.role === 'rejected') {
      return res.status(403).json({ message: 'Application not approved' });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + interval \'7 days\')',
      [user.id, refreshToken]
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        phone: user.phone,
        role: user.role
      },
      accessToken,
      refreshToken
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ----------------------------------------------------------------------
// Forgot Password – generate OTP and return it (for testing)
// ----------------------------------------------------------------------
exports.forgotPassword = async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({ success: false, message: 'Phone number is required' });
  }

  try {
    // 1. Check if user exists
    const userResult = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (userResult.rows.length === 0) {
      // For security, you may want to return generic message, but for testing we tell them
      return res.status(404).json({ success: false, message: 'No account found with this phone number' });
    }

    // 2. Generate a random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // 3. Store OTP in password_resets table
    await pool.query(
      `INSERT INTO password_resets (phone, otp, expires_at)
       VALUES ($1, $2, $3)`,
      [phone, otp, expiresAt]
    );

    // 4. Return success + OTP (for testing)
    res.status(200).json({
      success: true,
      message: 'OTP generated successfully',
      otp: otp,   // ⚠️ Remove this line in production
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ----------------------------------------------------------------------
// Reset Password – verify OTP and update password
// ----------------------------------------------------------------------
exports.resetPassword = async (req, res) => {
  const { phone, otp, newPassword } = req.body;

  if (!phone || !otp || !newPassword) {
    return res.status(400).json({ success: false, message: 'Phone, OTP, and new password are required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }

  try {
    // 1. Fetch the most recent OTP for this phone
    const otpResult = await pool.query(
      `SELECT id, otp, expires_at, used
       FROM password_resets
       WHERE phone = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone]
    );

    if (otpResult.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No OTP request found for this number' });
    }

    const record = otpResult.rows[0];

    // 2. Validate OTP
    if (record.used) {
      return res.status(400).json({ success: false, message: 'OTP already used' });
    }

    if (new Date() > new Date(record.expires_at)) {
      return res.status(400).json({ success: false, message: 'OTP has expired' });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    // 3. Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 4. Update user's password
    await pool.query('UPDATE users SET password = $1 WHERE phone = $2', [hashedPassword, phone]);

    // 5. Mark OTP as used
    await pool.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [record.id]);

    // 6. (Optional) Invalidate all refresh tokens for this user
    await pool.query(
      `DELETE FROM refresh_tokens
       WHERE user_id = (SELECT id FROM users WHERE phone = $1)`,
      [phone]
    );

    res.status(200).json({
      success: true,
      message: 'Password reset successful. Please log in with your new password.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};