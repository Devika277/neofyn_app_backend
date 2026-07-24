// scripts/test-decrypt.js
const { decryptVimoPayData } = require('../scripts/decrypt');
require('dotenv').config();

// Test data from your log
const testData = "TMCy8YldxOFEsyY10iT4jFCKJIwAHCwq2vliY2c8uHKqfi7ALKNMfg==";

console.log('🔍 Testing decryption with your confirmed method...\n');

try {
    const result = decryptVimoPayData(testData);
    console.log('\n✅ Decryption successful!');
    console.log('\n📊 Result:', result);
} catch (error) {
    console.error('\n❌ Decryption failed:', error.message);
}

// Also test with your encryption function to verify it works
const { encrypt } = require('../utils/vimoEncrypt'); // Adjust path

try {
    const testString = '{"test":"data"}';
    const encrypted = encrypt(testString);
    const decrypted = decryptVimoPayData(encrypted);
    console.log('\n🔄 Round-trip test:');
    console.log('  Original:', testString);
    console.log('  Encrypted:', encrypted);
    console.log('  Decrypted:', decrypted);
    console.log('  ✅ Match:', testString === decrypted);
} catch (error) {
    console.log('\n⚠️ Round-trip test skipped:', error.message);
}