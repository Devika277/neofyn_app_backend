/**
 * OTP Helper
 * 
 * Simple OTP generation and sending.
 * In production, replace console.log with actual SMS gateway.
 */

const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const sendOtp = async (phone, otp) => {
  // TODO: Replace with actual SMS provider integration
  console.log(`[OTP] Sending OTP ${otp} to ${phone}`);
  // Simulate async delay
  await new Promise(resolve => setTimeout(resolve, 500));
  return true;
};

module.exports = { generateOtp, sendOtp };