// ═══════════════════════════════════════════════════════
// myneofyn — DMT UAT FINAL TEST SCRIPT
// Follows Section 10 & 11 of DMT_Complete_Integration_Documentation
//
// KEY MAPPING (from your doc Section 5.1):
//   secretKey  → AES-256 encryption KEY
//   saltKey    → AES-256 IV (nonce)
//   encryptdecryptKey → Authorization header ONLY
//   Auth token → NOT encrypted, use raw
//
// Run: node testDMT_FINAL.js
// ═══════════════════════════════════════════════════════
require('dotenv').config();
const axios    = require('axios');
const crypto   = require('crypto');
const readline = require('readline');

// ── Credentials (exactly as your vimopayDMT.js uses them) ──
const BASE_URL = process.env.VIMOPAY_BASE_URL;
const SECRET   = process.env.VIMOPAY_SECRET_KEY;   // AES KEY
const SALT     = process.env.VIMOPAY_SALT_KEY;     // AES IV
const ED_KEY   = process.env.VIMOPAY_ED_KEY;       // Auth header only
const USER_ID  = process.env.VIMOPAY_USER_ID;

// ── Encrypt (matches your vimopayDMT.js exactly) ──────
function encrypt(payload) {
  const key    = Buffer.from(SECRET, 'utf8');  // secretKey = AES key
  const iv     = Buffer.from(SALT,   'utf8');  // saltKey   = AES IV
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([enc, tag]).toString('base64');
}

// ── Decrypt (matches your vimopayDMT.js exactly) ──────
function decrypt(encryptedText) {
  const key  = Buffer.from(SECRET, 'utf8');  // secretKey = AES key
  const iv   = Buffer.from(SALT,   'utf8');  // saltKey   = AES IV
  const buf  = Buffer.from(encryptedText, 'base64');
  const tag  = buf.slice(-16);
  const enc  = buf.slice(0, -16);
  const d    = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ── Safe decrypt — returns null if fails ──────────────
function safeDecrypt(data) {
  if (!data) return null;
  try { return JSON.parse(decrypt(data)); }
  catch (e) { return null; }
}

// ── OTP prompt ────────────────────────────────────────
function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(q, a => { rl.close(); r(a.trim()); }));
}

// ── Result logger ─────────────────────────────────────
function result(test, status, detail) {
  const icon = status === 'PASS' ? '✅' : status === 'SKIP' ? '⚠️ ' : '❌';
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`${icon}  ${test}`);
  console.log(`${'─'.repeat(55)}`);
  if (detail) console.log(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
}

// ── Safe API call ─────────────────────────────────────
async function call(method, url, body, headers) {
  try {
    const res = method === 'GET'
      ? await axios.get(url, { headers })
      : await axios.post(url, body, { headers });
    console.log(`\n📦 Raw Response [${url.split('/').pop()}]:`);
    console.log(JSON.stringify(res.data, null, 2));
    return res.data;
  } catch (err) {
    console.log(`\n❌ HTTP Error: ${err.message}`);
    if (err.response) console.log(JSON.stringify(err.response.data, null, 2));
    throw err;
  }
}

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════
async function main() {
  console.log('\n' + '█'.repeat(55));
  console.log('  myneofyn DMT — UAT FINAL TEST');
  console.log('  Follows DMT_Complete_Integration_Documentation');
  console.log('█'.repeat(55));

  // ── ENV CHECK ──────────────────────────────────────
  console.log('\n🔍 ENV CHECK:');
  console.log('  BASE_URL  :', BASE_URL);
  console.log('  SECRET    :', SECRET ? SECRET.substring(0, 8) + '...' : '❌ MISSING');
  console.log('  SALT      :', SALT   ? SALT.substring(0, 8)   + '...' : '❌ MISSING');
  console.log('  ED_KEY    :', ED_KEY ? ED_KEY.substring(0, 8) + '...' : '❌ MISSING');
  console.log('  USER_ID   :', USER_ID);

  if (!BASE_URL || !SECRET || !SALT || !ED_KEY || !USER_ID) {
    console.log('\n❌ Missing env variables. Check your .env file.');
    process.exit(1);
  }

  // ── ENCRYPTION SELF TEST ───────────────────────────
  console.log('\n🔐 Encryption Self Test...');
  try {
    const test = { ping: 'pong', num: 42 };
    const enc  = encrypt(test);
    const dec  = JSON.parse(decrypt(enc));
    if (dec.ping === 'pong' && dec.num === 42) {
      console.log('  ✅ AES-256-GCM encrypt/decrypt working correctly');
    } else {
      throw new Error('Decrypted value mismatch');
    }
  } catch (e) {
    console.log('  ❌ Encryption FAILED:', e.message);
    console.log('  Check your SECRET and SALT keys in .env');
    process.exit(1);
  }

  let token, headers, agentCode;
  const scores = { pass: 0, fail: 0, skip: 0 };

  try {

    // ══════════════════════════════════════════════════
    // TEST 1 — AUTHORIZATION
    // Doc Section 10, Phase 1
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 1 — Authorization...');
    const authData = await call('POST',
      `${BASE_URL}/dmtapi/api/Signature/Authorizeuat`,
      {},
      { secretKey: SECRET, saltKey: SALT, encryptdecryptKey: ED_KEY, userId: USER_ID }
    );

    if (!authData.successStatus) {
      result('TEST 1 — Authorization', 'FAIL', `code: ${authData.responseCode}, msg: ${authData.message}`);
      scores.fail++;
      throw new Error('Authorization failed — cannot continue');
    }

    // ✅ Token is NOT encrypted — use raw (doc Section 5.1, Fix #2)
    token = authData.data;
    result('TEST 1 — Authorization', 'PASS', `Token received (${token.substring(0, 30)}...)`);
    scores.pass++;

    headers = {
      Authorization:  `Bearer ${token}`,
      userId:         USER_ID,
      'Content-Type': 'application/json'
    };

    // ══════════════════════════════════════════════════
    // TEST 2 — STATE LIST
    // Doc Section 10, Phase 2
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 2 — State List...');
    const stateData = await call('GET',
      `${BASE_URL}/masterapi/api/master/statelistuat`,
      null,
      headers
    );

    if (stateData.successStatus && stateData.data) {
      const states = safeDecrypt(stateData.data);
      result('TEST 2 — State List', 'PASS',
        `${states ? states.length : '?'} states returned. Sample: ${JSON.stringify(states?.slice(0, 2))}`
      );
      scores.pass++;
    } else {
      result('TEST 2 — State List', 'FAIL', stateData);
      scores.fail++;
    }

    // ══════════════════════════════════════════════════
    // TEST 3 — BANK LIST
    // Doc Section 10, Phase 2
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 3 — Bank List...');
    const bankData = await call('GET',
      `${BASE_URL}/masterapi/api/master/banklistuat`,
      null,
      headers
    );

    if (bankData.successStatus && bankData.data) {
      const banks = safeDecrypt(bankData.data);
      result('TEST 3 — Bank List', 'PASS',
        `${banks?.data?.length || '?'} banks returned. Sample: ${JSON.stringify(banks?.data?.slice(0, 2))}`
      );
      scores.pass++;
    } else {
      result('TEST 3 — Bank List', 'FAIL', bankData);
      scores.fail++;
    }

    // ══════════════════════════════════════════════════
    // TEST 4 — AGENT REGISTRATION
    // Doc Section 10, Phase 3 — agent code MER5946 already known
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 4 — Agent Registration...');

    const agentPayload = {
      merchantRefId: `MR-${Date.now()}`,
      agentMobile:   '9876543210',
      agentName:     'Neofyn Test Agent',
      agentPan:      'ABCDE1234F',
      agentDob:      '15-05-1990',
      agentGender:   'Male',
      agentShopName: 'Neofyn Shop',
      agentState:    'KL',
      agentCity:     'TVM',
      ipAddress:     '103.21.141.2',
      lat:           '10.8505',
      long:          '76.2711'
    };

    const agentRes = await call('POST',
      `${BASE_URL}/dmtapi/api/Registration/AgentRegistrationuat`,
      { requestBody: encrypt(agentPayload) },
      headers
    );

    if (!agentRes.data) {
      result('TEST 4 — Agent Registration', 'FAIL',
        `code: ${agentRes.responseCode}, msg: ${agentRes.message}`
      );
      scores.fail++;
      // Use fallback agent code from previous successful test
      agentCode = 'MER5946';
      console.log(`  ⚠️  Using previously known agentCode: ${agentCode}`);
    } else {
      const agentDecrypted = safeDecrypt(agentRes.data);
      if (agentDecrypted?.txnStatus === 'SUCCESS') {
        agentCode = agentDecrypted.agentCode;
        result('TEST 4 — Agent Registration', 'PASS', agentDecrypted);
        scores.pass++;
      } else {
        result('TEST 4 — Agent Registration', 'FAIL', agentDecrypted);
        scores.fail++;
        agentCode = 'MER5946';
        console.log(`  ⚠️  Using previously known agentCode: ${agentCode}`);
      }
    }

    // ══════════════════════════════════════════════════
    // TEST 5 — SENDER REGISTRATION
    // Doc Section 10, Phase 4 + Section 11.2
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 5 — Sender Registration...');
    console.log('  ⚠️  Use a NEW mobile number never registered before');
    const senderMobile = await ask('\n📱 Enter SENDER mobile number (real — OTP will come here): ');

    const senderPayload = {
      senderMobile,
      senderName:    'Test Sender',
      agentCode,
      senderState:   'KL',
      senderCity:    'TVM',
      aadhaar:       '123412341234',
      address:       'Test Address Kerala',
      pinCode:       '680001',
      merchantRefId: `MR-S-${Date.now()}`,
      ip:            '103.21.141.2',
      lat:           '10.8505',
      long:          '76.2711',
      pidData:       ''
    };

    const senderRes = await call('POST',
      `${BASE_URL}/dmtapi/api/Registration/SenderRegistrationUAT`,
      { requestBody: encrypt(senderPayload) },
      headers
    );

    if (!senderRes.data) {
      result('TEST 5 — Sender Registration', 'FAIL',
        `code: ${senderRes.responseCode}, msg: ${senderRes.message}`
      );
      scores.fail++;
      throw new Error('Sender Registration failed — cannot continue');
    }

    const senderDecrypted = safeDecrypt(senderRes.data);
    result('TEST 5 — Sender Registration', 'PASS', senderDecrypted);
    scores.pass++;

    // ══════════════════════════════════════════════════
    // TEST 6 — VERIFY SENDER OTP
    // Doc Section 11.2 — S4
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 6 — Verify Sender OTP...');
    const senderOtp = await ask(`\n🔢 Enter OTP received on ${senderMobile}: `);

    const verifyPayload = {
      senderMobile,
      otpPin:        senderOtp,
      ip:            '103.21.141.2',
      lat:           '10.8505',
      long:          '76.2711',
      merchantRefId: `MR-V-${Date.now()}`
    };

    const verifyRes = await call('POST',
      `${BASE_URL}/dmtapi/api/Registration/VerifySenderRegistrationUAT`,
      { requestBody: encrypt(verifyPayload) },
      headers
    );

    if (!verifyRes.data) {
      result('TEST 6 — Verify Sender OTP', 'FAIL',
        `code: ${verifyRes.responseCode}, msg: ${verifyRes.message}`
      );
      scores.fail++;
      throw new Error('OTP verification failed — cannot continue');
    }

    const verifyDecrypted = safeDecrypt(verifyRes.data);
    if (verifyDecrypted?.txnStatus !== 'SUCCESS') {
      result('TEST 6 — Verify Sender OTP', 'FAIL', verifyDecrypted);
      scores.fail++;
      throw new Error('OTP verification failed');
    }

    result('TEST 6 — Verify Sender OTP', 'PASS', verifyDecrypted);
    scores.pass++;
    console.log('\n  ✅ S5 CHECK: Run this in Neon DB to confirm:');
    console.log(`  SELECT mobile, vimopay_sender_registered FROM dmt_remitters`);
    console.log(`  WHERE mobile = '${senderMobile}';`);
    console.log(`  Expected: vimopay_sender_registered = true`);

    // ══════════════════════════════════════════════════
    // TEST 7 — BENEFICIARY REGISTRATION
    // Doc Section 10, Phase 5 + Section 11.3 — B1
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 7 — Beneficiary Registration...');
    console.log('  Use a REAL bank account for this test');
    const beneAccount = await ask('\n🏦 Enter beneficiary account number: ');
    const beneIFSC    = await ask('🏦 Enter beneficiary IFSC code: ');
    const beneMobile  = await ask('📱 Enter beneficiary mobile (OTP for transfer will come here): ');
    const bankCode    = await ask('🏦 Enter bank code (e.g. 013 for HDFC, 001 for Axis — from bank list): ');

    const benePayload = {
      beneName:      'Test Beneficiary',
      merchantRefId: `MR-B-${Date.now()}`,
      beneMobile,
      bankName:      bankCode,
      accountNo:     beneAccount,
      accountType:   'Savings',
      beneCity:      'TVM',
      beneState:     'KL',
      ifsc:          beneIFSC,
      ip:            '103.21.141.2',
      agentCode,
      lat:           '10.8505',
      long:          '76.2711'
    };

    const beneRes = await call('POST',
      `${BASE_URL}/dmtapi/api/Registration/BeneficiaryRegistrationuat`,
      { requestBody: encrypt(benePayload) },
      headers
    );

    if (!beneRes.data) {
      result('TEST 7 — Beneficiary Registration', 'FAIL',
        `code: ${beneRes.responseCode}, msg: ${beneRes.message}`
      );
      scores.fail++;
      throw new Error('Bene Registration failed — cannot continue');
    }

    const beneDecrypted = safeDecrypt(beneRes.data);
    if (beneDecrypted?.txnStatus !== 'SUCCESS') {
      result('TEST 7 — Beneficiary Registration', 'FAIL', beneDecrypted);
      scores.fail++;
      throw new Error('Bene Registration failed');
    }

    result('TEST 7 — Beneficiary Registration', 'PASS', beneDecrypted);
    scores.pass++;

    // ══════════════════════════════════════════════════
    // TEST 8 — PENNY DROP
    // Doc Section 11.3 — B1 (Rs 3 deducted, account verified)
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 8 — Penny Drop (account verification — Rs 3 charged)...');

    const pennyPayload = {
      merchantRefId:            `MR-PD-${Date.now()}`,
      beneficiaryAccountNumber: beneAccount,
      beneficiaryIFSC:          beneIFSC,
      lat:                      '10.8505',
      long:                     '76.2711'
    };

    const pennyRes = await call('POST',
      `${BASE_URL}/pennydropapi/api/Payment/pennydropuat`,
      { requestBody: encrypt(pennyPayload) },
      headers
    );

    let beneAccId;
    if (!pennyRes.data) {
      result('TEST 8 — Penny Drop', 'FAIL',
        `code: ${pennyRes.responseCode}, msg: ${pennyRes.message}`
      );
      scores.fail++;
      throw new Error('Penny Drop failed — cannot continue');
    }

    const pennyDecrypted = safeDecrypt(pennyRes.data);
    if (pennyDecrypted?.txnStatus !== 'Success') {
      result('TEST 8 — Penny Drop', 'FAIL', pennyDecrypted);
      scores.fail++;
      throw new Error('Penny Drop failed');
    }

    beneAccId = pennyDecrypted.txnId;
    result('TEST 8 — Penny Drop', 'PASS', pennyDecrypted);
    scores.pass++;
    console.log(`\n  📌 beneAccId to use for transfer: ${beneAccId}`);

    // ══════════════════════════════════════════════════
    // TEST 9 — OTP RETRIGGER (send OTP to beneficiary)
    // Doc Section 10, Phase 5b + Section 11.3 — T2
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 9 — Send Transfer OTP to Beneficiary...');

    const otpRetriggerPayload = {
      beneAccId,
      merchantRefId: `MR-OTP-${Date.now()}`
    };

    const otpRes = await call('POST',
      `${BASE_URL}/dmtapi/api/Registration/OtpRetriggerUAT`,
      { requestBody: encrypt(otpRetriggerPayload) },
      headers
    );

    if (!otpRes.data) {
      result('TEST 9 — Transfer OTP Retrigger', 'FAIL',
        `code: ${otpRes.responseCode}, msg: ${otpRes.message}`
      );
      scores.fail++;
    } else {
      const otpDecrypted = safeDecrypt(otpRes.data);
      result('TEST 9 — Transfer OTP Retrigger', 'PASS', otpDecrypted);
      scores.pass++;
    }

    // ══════════════════════════════════════════════════
    // TEST 10 — DMT TRANSACTION 💰
    // Doc Section 10, Phase 6 + Section 11.3 — T3
    // THE FINAL TEST
    // ══════════════════════════════════════════════════
    console.log('\n\n⏳ TEST 10 — DMT Transaction (THE REAL TRANSFER)...');
    console.log(`  OTP was sent to beneficiary mobile: ${beneMobile}`);
    const txnOtp = await ask(`\n🔢 Enter OTP received on ${beneMobile}: `);

    const txnPayload = {
      amount:        '1',
      beneAccId,
      ip:            '103.21.141.2',
      lat:           '10.8505',
      long:          '76.2711',
      merchantRefId: `TXN-${Date.now()}`,
      otp:           txnOtp,
      txnMode:       'IMPS'
    };

    const txnRes = await call('POST',
      `${BASE_URL}/dmtapi/api/Registration/dmttransactionuat`,
      { requestBody: encrypt(txnPayload) },
      headers
    );

    if (!txnRes.data) {
      result('TEST 10 — DMT Transaction', 'FAIL',
        `code: ${txnRes.responseCode}, msg: ${txnRes.message}`
      );
      scores.fail++;
    } else {
      const txnDecrypted = safeDecrypt(txnRes.data);
      if (txnDecrypted?.txnStatus === 'SUCCESS') {
        result('TEST 10 — DMT Transaction', 'PASS', txnDecrypted);
        scores.pass++;
        console.log('\n  📌 DB VERIFICATION — Run in Neon:');
        console.log(`  SELECT id, amount, status, provider_txn_id, utr_number`);
        console.log(`  FROM dmt_transactions ORDER BY created_at DESC LIMIT 1;`);
      } else {
        result('TEST 10 — DMT Transaction', 'FAIL', txnDecrypted);
        scores.fail++;
      }
    }

  } catch (err) {
    console.log(`\n${'═'.repeat(55)}`);
    console.log('⛔  Test stopped: ' + err.message);
  }

  // ══════════════════════════════════════════════════
  // FINAL SCORECARD
  // ══════════════════════════════════════════════════
  const total = scores.pass + scores.fail + scores.skip;
  console.log(`\n\n${'█'.repeat(55)}`);
  console.log('  UAT TEST RESULTS — FINAL SCORECARD');
  console.log(`${'█'.repeat(55)}`);
  console.log(`  ✅ PASS : ${scores.pass}`);
  console.log(`  ❌ FAIL : ${scores.fail}`);
  console.log(`  ⚠️  SKIP : ${scores.skip}`);
  console.log(`  TOTAL  : ${total}`);
  console.log('─'.repeat(55));

  if (scores.fail === 0) {
    console.log('  🎉 ALL TESTS PASSED — DMT UAT COMPLETE!');
    console.log('  You are ready to share callback URL with Vimopay.');
  } else if (scores.pass >= 8) {
    console.log('  🟡 ALMOST DONE — Fix the failed tests above.');
  } else {
    console.log('  🔴 Review failures above and fix before proceeding.');
  }
  console.log('█'.repeat(55) + '\n');
}

main();