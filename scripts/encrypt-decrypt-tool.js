// decrypt-tool.js
// Advanced decryption tool for VimoPay AEPS

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load .env if available
try {
  require('dotenv').config();
} catch (e) {
  console.log('⚠️ dotenv not found, using environment variables directly');
}

// ============================================================
// EXACT COPY OF YOUR ENCRYPTION/DECRYPTION FUNCTIONS
// ============================================================

function encryptAES(text) {
  try {
    const key = Buffer.from(process.env.AEPS_ED_KEY, 'utf8');
    const iv = Buffer.from(process.env.AEPS_IV_KEY, 'utf8');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]).toString('base64');
  } catch (e) {
    console.error('Encryption error:', e.message);
    return null;
  }
}

function decryptAES(encryptedData) {
  try {
    const key = Buffer.from(process.env.AEPS_ED_KEY, 'utf8');
    const iv = Buffer.from(process.env.AEPS_IV_KEY, 'utf8');
    const data = Buffer.from(encryptedData, 'base64');
    const tag = data.slice(-16);
    const ct = data.slice(0, -16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8').trim();
  } catch (e) {
    return null;
  }
}

// ============================================================
// ALTERNATIVE DECRYPTION METHODS (for troubleshooting)
// ============================================================

/**
 * Try decryption with different key combinations
 */
function tryAllKeyVariations(encryptedData) {
  console.log('\n🔑 Trying different key combinations...');
  
  const originalEdKey = process.env.AEPS_ED_KEY || '';
  const originalIvKey = process.env.AEPS_IV_KEY || '';
  
  const variations = [];
  
  // Variation 1: Current keys
  variations.push({
    name: 'Current keys',
    edKey: originalEdKey,
    ivKey: originalIvKey,
  });
  
  // Variation 2: Try trimming whitespace
  variations.push({
    name: 'Trimmed keys',
    edKey: originalEdKey.trim(),
    ivKey: originalIvKey.trim(),
  });
  
  // Variation 3: Try hex encoding (if keys are hex)
  try {
    const edHex = Buffer.from(originalEdKey, 'hex').toString('utf8');
    const ivHex = Buffer.from(originalIvKey, 'hex').toString('utf8');
    if (edHex && ivHex && edHex.length >= 16) {
      variations.push({
        name: 'Hex to UTF8',
        edKey: edHex.substring(0, 32).padEnd(32, '0'),
        ivKey: ivHex.substring(0, 16).padEnd(16, '0'),
      });
    }
  } catch (e) {}
  
  // Variation 4: Try Base64 decode
  try {
    const edB64 = Buffer.from(originalEdKey, 'base64').toString('utf8');
    const ivB64 = Buffer.from(originalIvKey, 'base64').toString('utf8');
    if (edB64 && ivB64 && edB64.length >= 16) {
      variations.push({
        name: 'Base64 to UTF8',
        edKey: edB64.substring(0, 32).padEnd(32, '0'),
        ivKey: ivB64.substring(0, 16).padEnd(16, '0'),
      });
    }
  } catch (e) {}
  
  // Variation 5: If IV is 32 chars, use first 16
  if (originalIvKey.length === 32) {
    variations.push({
      name: 'IV first 16 chars',
      edKey: originalEdKey,
      ivKey: originalIvKey.substring(0, 16),
    });
  }
  
  // Test each variation
  let found = false;
  for (const variation of variations) {
    // Temporarily override keys
    const tempEdKey = process.env.AEPS_ED_KEY;
    const tempIvKey = process.env.AEPS_IV_KEY;
    
    process.env.AEPS_ED_KEY = variation.edKey;
    process.env.AEPS_IV_KEY = variation.ivKey;
    
    const result = decryptAES(encryptedData);
    
    // Restore keys
    process.env.AEPS_ED_KEY = tempEdKey;
    process.env.AEPS_IV_KEY = tempIvKey;
    
    if (result) {
      console.log(`✅ Success with: ${variation.name}`);
      console.log(`   ED Key: ${variation.edKey.substring(0, 10)}... (${variation.edKey.length} chars)`);
      console.log(`   IV Key: ${variation.ivKey.substring(0, 10)}... (${variation.ivKey.length} chars)`);
      return { result, edKey: variation.edKey, ivKey: variation.ivKey };
    }
  }
  
  return null;
}

/**
 * Try to decrypt with custom keys
 */
function decryptWithCustomKeys(encryptedData, edKey, ivKey) {
  try {
    const key = Buffer.from(edKey, 'utf8');
    const iv = Buffer.from(ivKey, 'utf8');
    const data = Buffer.from(encryptedData, 'base64');
    const tag = data.slice(-16);
    const ct = data.slice(0, -16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8').trim();
  } catch (e) {
    return null;
  }
}

// ============================================================
// DECRYPT AND PRINT FUNCTIONS
// ============================================================

function decryptAndPrint(encryptedData, showDebug = true) {
  console.log('\n' + '='.repeat(70));
  console.log('🔓 DECRYPTING DATA');
  console.log('='.repeat(70));
  
  console.log('\n📥 Encrypted Data:');
  console.log(encryptedData.substring(0, 150) + (encryptedData.length > 150 ? '...' : ''));
  console.log(`📊 Length: ${encryptedData.length} characters`);
  
  // Show current keys
  console.log('\n🔑 Current Keys:');
  const edKey = process.env.AEPS_ED_KEY || 'NOT SET';
  const ivKey = process.env.AEPS_IV_KEY || 'NOT SET';
  console.log(`  AEPS_ED_KEY: ${edKey.substring(0, 10)}... (${edKey.length} chars) ${edKey.length === 32 ? '✅' : '⚠️ Expected 32'}`);
  console.log(`  AEPS_IV_KEY: ${ivKey.substring(0, 10)}... (${ivKey.length} chars) ${ivKey.length === 16 ? '✅' : '⚠️ Expected 16'}`);
  
  // Try decryption
  console.log('\n🔄 Attempting decryption...');
  let decrypted = decryptAES(encryptedData);
  
  if (decrypted === null && showDebug) {
    console.log('\n❌ Decryption failed with current keys.');
    console.log('\n🔍 Trying alternative key variations...');
    
    const result = tryAllKeyVariations(encryptedData);
    if (result) {
      decrypted = result.result;
      console.log('\n✅ Found working keys!');
      console.log(`   AEPS_ED_KEY=${result.edKey}`);
      console.log(`   AEPS_IV_KEY=${result.ivKey}`);
      console.log('\n📝 Update your .env file with these keys.');
    }
  }
  
  if (decrypted === null) {
    console.log('\n❌ Decryption failed!');
    console.log('\n🔍 Debugging Suggestions:');
    console.log('  1. Check if AEPS_ED_KEY is exactly 32 characters');
    console.log('  2. Check if AEPS_IV_KEY is exactly 16 characters');
    console.log('  3. Verify these keys match what VimoPay provided');
    console.log('  4. The encrypted data might be corrupted');
    console.log('  5. Try decrypting with: node decrypt-tool.js --interactive');
    console.log('  6. Check if the data needs to be decoded first (URL decode, etc.)');
    return null;
  }
  
  console.log('\n✅ Decryption successful!\n');
  console.log('📝 Decrypted Text:');
  console.log(decrypted);
  console.log(`\n📊 Length: ${decrypted.length} characters`);
  
  // Try to parse as JSON
  try {
    const jsonData = JSON.parse(decrypted);
    console.log('\n📦 Parsed as JSON:');
    console.log(JSON.stringify(jsonData, null, 2));
    return jsonData;
  } catch (e) {
    // Not JSON, return as string
    console.log('\n⚠️ Not valid JSON (returning as text)');
    return decrypted;
  }
}

// ============================================================
// ADDITIONAL UTILITIES
// ============================================================

/**
 * Check if data is base64 encoded
 */
function isBase64(str) {
  try {
    return Buffer.from(str, 'base64').toString('base64') === str;
  } catch (e) {
    return false;
  }
}

/**
 * Decode URL encoded data
 */
function urlDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch (e) {
    return str;
  }
}

/**
 * Try to decrypt after various preprocessing
 */
function tryPreprocessing(encryptedData) {
  console.log('\n🔄 Trying different preprocessing methods...');
  
  const methods = [
    { name: 'Original', data: encryptedData },
    { name: 'URL Decoded', data: urlDecode(encryptedData) },
    { name: 'Trimmed', data: encryptedData.trim() },
    { name: 'Trim + URL Decode', data: urlDecode(encryptedData.trim()) },
  ];
  
  for (const method of methods) {
    if (method.data !== encryptedData) {
      console.log(`\n📌 Trying: ${method.name}`);
      const result = decryptAES(method.data);
      if (result) {
        console.log(`✅ Success with ${method.name}!`);
        return { data: method.data, result };
      }
    }
  }
  
  return null;
}

// ============================================================
// COMMAND LINE INTERFACE
// ============================================================

function printUsage() {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           AEPS Decryption Tool v2.0                             ║
║           With Debugging & Key Discovery                       ║
╚══════════════════════════════════════════════════════════════════╝

USAGE:
  node decrypt-tool.js <encrypted-base64-string>
  node decrypt-tool.js --file <filename>
  node decrypt-tool.js --interactive
  node decrypt-tool.js --test
  node decrypt-tool.js --debug <encrypted-string>
  node decrypt-tool.js --keys <ed_key> <iv_key> <encrypted-string>
  node decrypt-tool.js --help

EXAMPLES:
  # Decrypt a string directly
  node decrypt-tool.js "yfglSRhyZ7qiO+tqNPxP/ZHxQV8p+AIHzrJqeD1rxv+..."

  # Decrypt with debug info
  node decrypt-tool.js --debug "yfglSRhyZ7qiO+tqNPxP/ZHxQV8p+AIHzrJqeD1rxv+..."

  # Decrypt with custom keys
  node decrypt-tool.js --keys "742ea7c0240c27eec70726277a007366" "a718b5caeb2542b0" "encrypted-data"

  # Decrypt from file
  node decrypt-tool.js --file encrypted.txt

  # Interactive mode (paste encrypted data)
  node decrypt-tool.js --interactive

  # Test your keys
  node decrypt-tool.js --test

ENVIRONMENT VARIABLES:
  AEPS_ED_KEY - 32-character encryption key (AES-256)
  AEPS_IV_KEY - 16-character IV key (AES-GCM)
`);
}

function testDecryption() {
  console.log('\n' + '='.repeat(70));
  console.log('🧪 TESTING DECRYPTION');
  console.log('='.repeat(70));
  
  // Check if keys are set
  if (!process.env.AEPS_ED_KEY || !process.env.AEPS_IV_KEY) {
    console.log('\n❌ Environment variables not set!');
    console.log('Please set AEPS_ED_KEY and AEPS_IV_KEY in your .env file');
    return;
  }
  
  console.log(`\n✅ AEPS_ED_KEY: ${process.env.AEPS_ED_KEY.substring(0, 10)}... (${process.env.AEPS_ED_KEY.length} chars)`);
  console.log(`✅ AEPS_IV_KEY: ${process.env.AEPS_IV_KEY.substring(0, 10)}... (${process.env.AEPS_IV_KEY.length} chars)`);
  
  // Test encryption/decryption
  const testData = JSON.stringify({
    merchantId: '268',
    status: 'test',
    timestamp: new Date().toISOString()
  });
  
  console.log(`\n📝 Test Data: ${testData}`);
  
  const encrypted = encryptAES(testData);
  console.log(`🔐 Encrypted: ${encrypted}`);
  
  const decrypted = decryptAES(encrypted);
  console.log(`🔓 Decrypted: ${decrypted}`);
  
  if (decrypted === testData) {
    console.log('\n✅ Test PASSED - Encryption/Decryption working correctly');
  } else {
    console.log('\n❌ Test FAILED - Please check your keys');
  }
}

function decryptFromFile(filename) {
  try {
    const data = fs.readFileSync(filename, 'utf8').trim();
    console.log(`\n📄 Read from file: ${filename}`);
    decryptAndPrint(data);
  } catch (error) {
    console.log(`\n❌ Error reading file: ${error.message}`);
  }
}

function interactiveMode() {
  console.log('\n' + '='.repeat(70));
  console.log('🔄 INTERACTIVE DECRYPTION MODE');
  console.log('='.repeat(70));
  console.log('\nPaste your encrypted data and press Enter (Ctrl+C to exit):\n');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  rl.question('🔐 Encrypted Data: ', (answer) => {
    if (answer.trim()) {
      decryptAndPrint(answer.trim());
    } else {
      console.log('❌ No data provided');
    }
    rl.close();
  });
}

function debugDecrypt(encryptedData) {
  console.log('\n' + '='.repeat(70));
  console.log('🐛 DEBUG MODE');
  console.log('='.repeat(70));
  
  // Show raw data
  console.log('\n📥 Raw Encrypted Data:');
  console.log(encryptedData);
  console.log(`\n📊 Length: ${encryptedData.length}`);
  console.log(`🔍 Is Base64: ${isBase64(encryptedData) ? 'Yes' : 'No'}`);
  
  // Try different preprocessing
  const preprocessed = tryPreprocessing(encryptedData);
  if (preprocessed) {
    console.log('\n✅ Found working preprocessing method!');
    console.log(`📌 Method: ${preprocessed.data !== encryptedData ? 'Preprocessed' : 'Original'}`);
    console.log('📝 Decrypted Result:');
    console.log(preprocessed.result);
    return preprocessed.result;
  }
  
  // Try all key variations
  console.log('\n🔑 Trying all key variations...');
  const result = tryAllKeyVariations(encryptedData);
  if (result) {
    console.log('\n✅ Found working keys!');
    console.log(`   AEPS_ED_KEY=${result.edKey}`);
    console.log(`   AEPS_IV_KEY=${result.ivKey}`);
    console.log('\n📝 Decrypted Result:');
    console.log(result.result);
    return result.result;
  }
  
  console.log('\n❌ All decryption attempts failed.');
  console.log('\n📋 Next Steps:');
  console.log('  1. Contact VimoPay support for the correct encryption keys');
  console.log('  2. Check if the encrypted data needs to be decoded first');
  console.log('  3. Verify the data is not truncated');
  console.log('  4. Check if the encryption algorithm is AES-256-GCM');
  
  return null;
}

// ============================================================
// MAIN
// ============================================================

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printUsage();
    return;
  }
  
  const command = args[0];
  
  switch (command) {
    case '--file':
    case '-f':
      if (args[1]) {
        decryptFromFile(args[1]);
      } else {
        console.log('❌ Please specify a filename');
      }
      break;
      
    case '--interactive':
    case '-i':
      interactiveMode();
      break;
      
    case '--test':
    case '-t':
      testDecryption();
      break;
      
    case '--debug':
    case '-d':
      if (args[1]) {
        debugDecrypt(args[1]);
      } else {
        console.log('❌ Please provide encrypted data');
      }
      break;
      
    case '--keys':
    case '-k':
      if (args.length >= 4) {
        const edKey = args[1];
        const ivKey = args[2];
        const data = args[3];
        console.log(`\n🔑 Using custom keys:`);
        console.log(`  ED Key: ${edKey.substring(0, 10)}... (${edKey.length} chars)`);
        console.log(`  IV Key: ${ivKey.substring(0, 10)}... (${ivKey.length} chars)`);
        
        // Temporarily set keys
        const tempEdKey = process.env.AEPS_ED_KEY;
        const tempIvKey = process.env.AEPS_IV_KEY;
        process.env.AEPS_ED_KEY = edKey;
        process.env.AEPS_IV_KEY = ivKey;
        
        decryptAndPrint(data);
        
        // Restore keys
        process.env.AEPS_ED_KEY = tempEdKey;
        process.env.AEPS_IV_KEY = tempIvKey;
      } else {
        console.log('❌ Usage: --keys <ed_key> <iv_key> <encrypted-data>');
      }
      break;
      
    case '--help':
    case '-h':
      printUsage();
      break;
      
    default:
      // Treat as encrypted data
      decryptAndPrint(command);
  }
}

// ============================================================
// EXPORTS
// ============================================================

if (require.main === module) {
  main();
}

module.exports = {
  encryptAES,
  decryptAES,
  decryptAndPrint,
  tryAllKeyVariations,
  debugDecrypt,
  isBase64,
  urlDecode,
};