const db = require('../../config/db');
const bbps = require('../../providers/bbps/bbpsBillPay');

// =====================================================
// AGGRESSIVE SANITIZATION HELPERS (VimoPay compliant)
// =====================================================

// Clean merchant name: only alphanumeric, no spaces, no special characters
function sanitizeMerchantName(name) {
    if (!name) return '';
    return name.trim().replace(/[^a-zA-Z0-9]/g, '');
}

// Aggressive address sanitization:
// - VimoPay allows only: letters, numbers, spaces, dots (.), forward slashes (/), dashes (-)
// - We replace commas with space, remove all other special characters
function sanitizeAddress(addr) {
    if (!addr) return '';
    
    let cleaned = addr
        .trim()
        // 1. Replace commas with space (most important for your use case)
        .replace(/,/g, ' ')
        // 2. Replace ampersand with ' and '
        .replace(/&/g, ' and ')
        // 3. Replace @ with ' at '
        .replace(/@/g, ' at ')
        // 4. Replace underscore, colon, semicolon, hash with space
        .replace(/[_:;#]/g, ' ')
        // 5. Remove parentheses, brackets, curly braces
        .replace(/[()[\]{}]/g, ' ')
        // 6. Remove any other character that is NOT allowed:
        //    Allowed: A-Z a-z 0-9 space . / -
        .replace(/[^a-zA-Z0-9\s\.\/\-]/g, ' ')
        // 7. Collapse multiple spaces into single space
        .replace(/\s+/g, ' ')
        .trim();
    
    // Fallback if result is empty
    if (!cleaned) {
        cleaned = 'Shop Address';
    }
    
    return cleaned;
}

// Clean person name: only letters, no spaces, no numbers
function sanitizePersonName(name) {
    if (!name) return '';
    return name.trim().replace(/[^a-zA-Z]/g, '');
}

// Clean pincode: only digits, max 6
function sanitizePincode(pincode) {
    if (!pincode) return '';
    return pincode.trim().replace(/[^0-9]/g, '').slice(0, 6);
}

// Clean mobile: only digits, max 10
function sanitizeMobile(mobile) {
    if (!mobile) return '';
    return mobile.trim().replace(/[^0-9]/g, '').slice(0, 10);
}

// Clean email: trim and lowercase
function sanitizeEmail(email) {
    if (!email) return '';
    return email.trim().toLowerCase();
}

// Clean Aadhaar: only digits, max 12
function sanitizeAadhaar(aadhaar) {
    if (!aadhaar) return '';
    return aadhaar.trim().replace(/[^0-9]/g, '').slice(0, 12);
}

// Clean PAN: only alphanumeric, uppercase, max 10
function sanitizePan(pan) {
    if (!pan) return '';
    return pan.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10);
}

// Clean IFSC: only alphanumeric, uppercase, max 11
function sanitizeIfsc(ifsc) {
    if (!ifsc) return '';
    return ifsc.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 11);
}

// Clean account number: only digits, max 18
function sanitizeAccountNo(accountNo) {
    if (!accountNo) return '';
    return accountNo.trim().replace(/[^0-9]/g, '').slice(0, 18);
}

// Clean bank name: only letters and spaces
function sanitizeBankName(bankName) {
    if (!bankName) return '';
    return bankName.trim().replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, ' ');
}

// Clean business type: only letters, numbers, and spaces
function sanitizeBusinessType(businessType) {
    if (!businessType) return '';
    return businessType.trim().replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' ');
}

// =====================================================
// MAIN ONBOARDING FUNCTION
// =====================================================
async function onboardMerchant(userId, data) {
    console.log('[BBPS-SVC] onboardMerchant() called for userId:', userId);

    // =====================================================
    // STEP 1: Sanitize ALL incoming data
    // =====================================================
    const sanitizedData = {
        // Personal details
        first_name: sanitizePersonName(data.first_name),
        middle_name: sanitizePersonName(data.middle_name),
        last_name: sanitizePersonName(data.last_name),
        dob: data.dob || null,
        
        // Residential address
        address: sanitizeAddress(data.address),
        state: data.state ? data.state.trim().toUpperCase() : null,
        city: data.city ? data.city.trim().toUpperCase() : null,
        pincode_res: sanitizePincode(data.pincode_res),
        
        // Shop details
        shop_name: sanitizeMerchantName(data.shop_name),
        shop_address: sanitizeAddress(data.shop_address),
        shop_state: data.shop_state ? data.shop_state.trim().toUpperCase() : null,
        shop_city: data.shop_city ? data.shop_city.trim().toUpperCase() : null,
        shop_pincode: sanitizePincode(data.pincode),
        
        // Business type
        business_type: sanitizeBusinessType(data.business_type),
        
        // KYC
        aadhar_no: sanitizeAadhaar(data.aadhar_no),
        pan_no: sanitizePan(data.pan_no),
        bank_name: sanitizeBankName(data.bank_name),
        account_no: sanitizeAccountNo(data.account_no),
        ifsc_code: sanitizeIfsc(data.ifsc_code),
        
        // Contact
        mobile: sanitizeMobile(data.mobile),
        email: sanitizeEmail(data.email),
        
        // Location
        latitude: data.latitude || '13.0827',
        longitude: data.longitude || '80.2707',
        ipAddress: data.ipAddress || '127.0.0.1',
    };

    // Validate required fields after sanitization
    if (!sanitizedData.shop_name) {
        throw new Error('Shop name must contain at least one letter or number (no spaces or special characters allowed)');
    }
    
    if (!sanitizedData.shop_address) {
        throw new Error('Shop address must contain valid characters (letters, numbers, spaces, dots, forward slashes, dashes)');
    }
    
    if (!sanitizedData.mobile || sanitizedData.mobile.length < 10) {
        throw new Error('Valid mobile number is required (10 digits)');
    }
    
    if (!sanitizedData.email || !sanitizedData.email.includes('@')) {
        throw new Error('Valid email address is required');
    }
    
    if (!sanitizedData.shop_state) {
        throw new Error('Shop state is required');
    }
    
    if (!sanitizedData.shop_city) {
        throw new Error('Shop city is required');
    }
    
    if (!sanitizedData.shop_pincode || sanitizedData.shop_pincode.length !== 6) {
        throw new Error('Valid 6-digit pincode is required');
    }

    // =====================================================
    // STEP 1.5: Check for duplicate PAN (across different users)
    // =====================================================
    if (sanitizedData.pan_no) {
        const existingPan = await db.query(
            `SELECT user_id, status, id FROM merchant_onboarding WHERE pan_no = $1 AND user_id != $2`,
            [sanitizedData.pan_no, userId]
        );
        if (existingPan.rows.length > 0) {
            throw new Error('PAN number is already registered with another merchant. Please use a different PAN.');
        }
    }

    // Optional: Check duplicate Aadhaar if needed
    if (sanitizedData.aadhar_no) {
        const existingAadhaar = await db.query(
            `SELECT user_id FROM merchant_onboarding WHERE aadhar_no = $1 AND user_id != $2`,
            [sanitizedData.aadhar_no, userId]
        );
        if (existingAadhaar.rows.length > 0) {
            throw new Error('Aadhaar number is already registered with another merchant. Please use a different Aadhaar.');
        }
    }

    console.log('[BBPS-SVC] Sanitized data:', {
        shop_name: sanitizedData.shop_name,
        shop_address: sanitizedData.shop_address,
        mobile: sanitizedData.mobile,
        email: sanitizedData.email,
        pan_no: sanitizedData.pan_no ? '***' + sanitizedData.pan_no.slice(-4) : null,
    });

    // =====================================================
    // STEP 2: Save to Database (with sanitized data)
    // =====================================================
    const existing = await db.query(
        'SELECT id, status FROM merchant_onboarding WHERE user_id = $1',
        [userId]
    );

    let dbId;

    if (existing.rows.length > 0) {
        // Update existing record – allow retry even if status was 'failed'
        dbId = existing.rows[0].id;
        await db.query(
            `UPDATE merchant_onboarding
             SET status = 'pending', 
                 updated_at = NOW(),
                 first_name = $2,
                 middle_name = $3,
                 last_name = $4,
                 dob = $5,
                 address = $6,
                 state = $7,
                 city = $8,
                 pincode = $9,
                 shop_name = $10,
                 shop_address = $11,
                 shop_state = $12,
                 shop_city = $13,
                 shop_pincode = $14,
                 business_type = $15,
                 aadhar_no = $16,
                 pan_no = $17,
                 bank_name = $18,
                 account_no = $19,
                 ifsc_code = $20,
                 mobile = $21,
                 email = $22,
                 latitude = $23,
                 longitude = $24,
                 error_message = NULL
             WHERE id = $1`,
            [
                dbId,
                sanitizedData.first_name || null,
                sanitizedData.middle_name || null,
                sanitizedData.last_name || null,
                sanitizedData.dob || null,
                sanitizedData.address || null,
                sanitizedData.state || null,
                sanitizedData.city || null,
                sanitizedData.pincode_res || null,
                sanitizedData.shop_name,
                sanitizedData.shop_address,
                sanitizedData.shop_state,
                sanitizedData.shop_city,
                sanitizedData.shop_pincode,
                sanitizedData.business_type || null,
                sanitizedData.aadhar_no || null,
                sanitizedData.pan_no || null,
                sanitizedData.bank_name || null,
                sanitizedData.account_no || null,
                sanitizedData.ifsc_code || null,
                sanitizedData.mobile,
                sanitizedData.email,
                sanitizedData.latitude,
                sanitizedData.longitude
            ]
        );
        console.log('[BBPS-SVC] Updated existing DB record, id:', dbId);
    } else {
        // Insert new record
        const ins = await db.query(
            `INSERT INTO merchant_onboarding
                (user_id, status, created_at, updated_at,
                 first_name, middle_name, last_name, dob,
                 address, state, city, pincode,
                 shop_name, shop_address, shop_state, shop_city, shop_pincode,
                 business_type,
                 aadhar_no, pan_no, bank_name, account_no, ifsc_code,
                 mobile, email, latitude, longitude)
             VALUES
                ($1, 'pending', NOW(), NOW(),
                 $2, $3, $4, $5,
                 $6, $7, $8, $9,
                 $10, $11, $12, $13, $14,
                 $15,
                 $16, $17, $18, $19, $20,
                 $21, $22, $23, $24)
             RETURNING id`,
            [
                userId,
                sanitizedData.first_name || null,
                sanitizedData.middle_name || null,
                sanitizedData.last_name || null,
                sanitizedData.dob || null,
                sanitizedData.address || null,
                sanitizedData.state || null,
                sanitizedData.city || null,
                sanitizedData.pincode_res || null,
                sanitizedData.shop_name,
                sanitizedData.shop_address,
                sanitizedData.shop_state,
                sanitizedData.shop_city,
                sanitizedData.shop_pincode,
                sanitizedData.business_type || null,
                sanitizedData.aadhar_no || null,
                sanitizedData.pan_no || null,
                sanitizedData.bank_name || null,
                sanitizedData.account_no || null,
                sanitizedData.ifsc_code || null,
                sanitizedData.mobile,
                sanitizedData.email,
                sanitizedData.latitude,
                sanitizedData.longitude
            ]
        );
        dbId = ins.rows[0].id;
        console.log('[BBPS-SVC] New DB record saved, id:', dbId);
    }

    // =====================================================
    // STEP 3: Call VimoPay Registration API
    // =====================================================
    let bbpsResult = null;
    
    try {
        // Final safety: clean merchant name one more time
        const finalMerchantName = sanitizedData.shop_name.replace(/[^a-zA-Z0-9]/g, '');
        
        const regPayload = {
            merchantRefId: Date.now().toString(),
            merchantName: finalMerchantName,
            merchantMobileNo: sanitizedData.mobile,
            merchantEmail: sanitizedData.email,
            merchantAddress: sanitizedData.shop_address,
            merchantState: sanitizedData.shop_state,
            merchantCity: sanitizedData.shop_city,
            merchantPinCode: sanitizedData.shop_pincode,
            ipAddress: sanitizedData.ipAddress,
            latitude: sanitizedData.latitude,
            longitude: sanitizedData.longitude,
            udf1: '',
            udf2: '',
            udf3: '',
        };
        
        console.log('[BBPS-SVC] Sending to VimoPay (final sanitized):', JSON.stringify(regPayload));
        bbpsResult = await bbps.registerMerchant(regPayload);
        console.log('[BBPS-SVC] VimoPay response:', JSON.stringify(bbpsResult));

        // Check if registration was successful
        if (bbpsResult && bbpsResult.code === '000') {
            const merchantCode = bbpsResult.merchantCode || bbpsResult.data?.merchantCode;
            await db.query(
                `UPDATE merchant_onboarding
                 SET status = 'active',
                     bbps_merchant_code = $1,
                     error_message = NULL,
                     updated_at = NOW()
                 WHERE id = $2`,
                [merchantCode, dbId]
            );
            console.log('[BBPS-SVC] Registration SUCCESS, merchantCode:', merchantCode);
        } else {
            const errorMsg = bbpsResult?.message || JSON.stringify(bbpsResult);
            console.error('[BBPS-SVC] VimoPay rejected:', errorMsg);
            await db.query(
                `UPDATE merchant_onboarding
                 SET status = 'failed',
                     error_message = $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [errorMsg, dbId]
            );
            throw new Error(`VimoPay registration failed: ${errorMsg}`);
        }
    } catch (err) {
        console.error('[BBPS-SVC] VimoPay call error:', err.message);
        
        // Mark onboarding as failed in DB (only if still pending)
        await db.query(
            `UPDATE merchant_onboarding
             SET status = 'failed',
                 error_message = $1,
                 updated_at = NOW()
             WHERE id = $2 AND status = 'pending'`,
            [err.message, dbId]
        );
        throw err;
    }

    // =====================================================
    // STEP 4: Return result
    // =====================================================
    const final = await db.query('SELECT * FROM merchant_onboarding WHERE id = $1', [dbId]);
    return { dbRecord: final.rows[0], bbpsResult };
}

// =====================================================
// GET MERCHANT STATUS
// =====================================================
async function getMerchantStatus(userId) {
    console.log('[BBPS-SVC] getMerchantStatus() userId:', userId);
    const result = await db.query(
        `SELECT * FROM merchant_onboarding WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [userId]
    );
    return result.rows[0] || null;
}

module.exports = { onboardMerchant, getMerchantStatus };