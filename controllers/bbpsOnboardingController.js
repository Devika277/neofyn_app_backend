const db = require('../config/db');
const svc = require('../services/BBPS/bbpsOnboardingService');

// =====================================================
// AGGRESSIVE ADDRESS SANITIZATION (same as service/provider)
// =====================================================
function sanitizeAddress(addr) {
    if (!addr) return '';
    let cleaned = addr
        .trim()
        .replace(/,/g, ' ')                // comma → space
        .replace(/&/g, ' and ')
        .replace(/@/g, ' at ')
        .replace(/[_:;#]/g, ' ')
        .replace(/[()[\]{}]/g, ' ')
        .replace(/[^a-zA-Z0-9\s\.\/\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'Shop Address';
}

// =====================================================
// HELPER: Validate onboarding request data
// =====================================================
function validateOnboardingData(data) {
    const errors = [];
    
    // Required personal fields
    if (!data.first_name || data.first_name.trim() === '') {
        errors.push('First name is required');
    } else if (data.first_name.length < 2) {
        errors.push('First name must be at least 2 characters');
    } else if (data.first_name.length > 50) {
        errors.push('First name must be less than 50 characters');
    }
    
    if (!data.last_name || data.last_name.trim() === '') {
        errors.push('Last name is required');
    } else if (data.last_name.length < 2) {
        errors.push('Last name must be at least 2 characters');
    } else if (data.last_name.length > 50) {
        errors.push('Last name must be less than 50 characters');
    }
    
    if (!data.dob || data.dob.trim() === '') {
        errors.push('Date of birth is required');
    } else {
        const dobDate = new Date(data.dob);
        const today = new Date();
        const age = today.getFullYear() - dobDate.getFullYear();
        const monthDiff = today.getMonth() - dobDate.getMonth();
        
        if (isNaN(dobDate.getTime())) {
            errors.push('Invalid date of birth format');
        } else if (age < 18 || (age === 18 && monthDiff < 0)) {
            errors.push('You must be at least 18 years old to register as a merchant');
        } else if (age > 100) {
            errors.push('Please verify your date of birth');
        }
    }
    
    // Required shop fields
    if (!data.shop_name || data.shop_name.trim() === '') {
        errors.push('Shop name is required');
    } else if (data.shop_name.length < 2) {
        errors.push('Shop name must be at least 2 characters');
    } else if (data.shop_name.length > 100) {
        errors.push('Shop name must be less than 100 characters');
    } else {
        const cleaned = data.shop_name.replace(/[^a-zA-Z0-9]/g, '');
        if (cleaned !== data.shop_name) {
            errors.push('Shop name must contain only letters and numbers (no spaces or special characters)');
        }
    }
    
    if (!data.shop_address || data.shop_address.trim() === '') {
        errors.push('Shop address is required');
    } else if (data.shop_address.length < 5) {
        errors.push('Shop address must be at least 5 characters');
    }
    
    if (!data.shop_state || data.shop_state.trim() === '') {
        errors.push('Shop state is required');
    } else if (!/^[A-Z]{2}$/.test(data.shop_state.trim().toUpperCase())) {
        errors.push('Shop state must be a valid 2-letter state code (e.g., KL, MH, DL)');
    }
    
    if (!data.shop_city || data.shop_city.trim() === '') {
        errors.push('Shop city is required');
    } else if (data.shop_city.length < 2) {
        errors.push('Shop city must be at least 2 characters');
    }
    
    if (!data.pincode || data.pincode.trim() === '') {
        errors.push('Shop pincode is required');
    } else if (!/^\d{6}$/.test(data.pincode)) {
        errors.push('Pincode must be exactly 6 digits');
    }
    
    // Contact validation
    if (!data.mobile || data.mobile.trim() === '') {
        errors.push('Mobile number is required');
    } else {
        const cleanMobile = data.mobile.toString().replace(/[^0-9]/g, '');
        if (cleanMobile.length !== 10) {
            errors.push('Mobile number must be exactly 10 digits');
        } else if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
            errors.push('Mobile number must start with 6, 7, 8, or 9');
        }
    }
    
    if (!data.email || data.email.trim() === '') {
        errors.push('Email address is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        errors.push('Invalid email address format');
    } else if (data.email.length > 100) {
        errors.push('Email address must be less than 100 characters');
    }
    
    // Business type validation
    if (!data.business_type || data.business_type.trim() === '') {
        errors.push('Business type is required');
    }
    
    // Optional field validations
    if (data.aadhar_no && data.aadhar_no.trim() !== '') {
        const cleanAadhaar = data.aadhar_no.replace(/[^0-9]/g, '');
        if (cleanAadhaar.length !== 12) {
            errors.push('Aadhaar number must be exactly 12 digits');
        }
    }
    
    if (data.pan_no && data.pan_no.trim() !== '') {
        const cleanPan = data.pan_no.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan)) {
            errors.push('PAN number must be in valid format (e.g., ABCDE1234F)');
        }
    }
    
    if (data.ifsc_code && data.ifsc_code.trim() !== '') {
        const cleanIfsc = data.ifsc_code.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        if (cleanIfsc.length !== 11) {
            errors.push('IFSC code must be exactly 11 characters');
        }
    }
    
    if (data.account_no && data.account_no.trim() !== '') {
        const cleanAccount = data.account_no.replace(/[^0-9]/g, '');
        if (cleanAccount.length < 9 || cleanAccount.length > 18) {
            errors.push('Account number must be between 9 and 18 digits');
        }
    }
    
    if (data.resPincode && data.resPincode.trim() !== '') {
        const cleanResPincode = data.resPincode.replace(/[^0-9]/g, '');
        if (cleanResPincode.length !== 6 && cleanResPincode.length !== 0) {
            errors.push('Residential pincode must be exactly 6 digits');
        }
    }
    
    return errors;
}

// =====================================================
// HELPER: Sanitize request data before processing
// =====================================================
function sanitizeRequestData(data) {
    const sanitized = { ...data };
    
    // Trim all string fields
    if (sanitized.first_name) sanitized.first_name = sanitized.first_name.trim();
    if (sanitized.middle_name) sanitized.middle_name = sanitized.middle_name.trim();
    if (sanitized.last_name) sanitized.last_name = sanitized.last_name.trim();
    
    // Clean shop_name: only alphanumeric
    if (sanitized.shop_name) {
        sanitized.shop_name = sanitized.shop_name.trim().replace(/[^a-zA-Z0-9]/g, '');
    }
    
    // Aggressively clean shop_address and residential address
    if (sanitized.shop_address) {
        sanitized.shop_address = sanitizeAddress(sanitized.shop_address);
    }
    if (sanitized.address) {
        sanitized.address = sanitizeAddress(sanitized.address);
    }
    
    if (sanitized.business_type) sanitized.business_type = sanitized.business_type.trim();
    if (sanitized.business_type_other) sanitized.business_type_other = sanitized.business_type_other.trim();
    
    // Clean phone numbers (remove non-digits)
    if (sanitized.mobile) {
        sanitized.mobile = sanitized.mobile.toString().replace(/[^0-9]/g, '');
    }
    
    // Clean pincodes
    if (sanitized.pincode) {
        sanitized.pincode = sanitized.pincode.toString().replace(/[^0-9]/g, '');
    }
    if (sanitized.pincode_res) {
        sanitized.pincode_res = sanitized.pincode_res.toString().replace(/[^0-9]/g, '');
    }
    if (sanitized.resPincode) {
        sanitized.resPincode = sanitized.resPincode.toString().replace(/[^0-9]/g, '');
    }
    
    // Clean Aadhaar
    if (sanitized.aadhar_no) {
        sanitized.aadhar_no = sanitized.aadhar_no.toString().replace(/[^0-9]/g, '');
    }
    
    // Clean PAN
    if (sanitized.pan_no) {
        sanitized.pan_no = sanitized.pan_no.toString().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    }
    
    // Clean IFSC
    if (sanitized.ifsc_code) {
        sanitized.ifsc_code = sanitized.ifsc_code.toString().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    }
    
    // Clean account number
    if (sanitized.account_no) {
        sanitized.account_no = sanitized.account_no.toString().replace(/[^0-9]/g, '');
    }
    
    // Lowercase email
    if (sanitized.email) {
        sanitized.email = sanitized.email.trim().toLowerCase();
    }
    
    // Convert state/city codes to uppercase
    if (sanitized.state) sanitized.state = sanitized.state.trim().toUpperCase();
    if (sanitized.shop_state) sanitized.shop_state = sanitized.shop_state.trim().toUpperCase();
    if (sanitized.resState) sanitized.resState = sanitized.resState.trim().toUpperCase();
    
    if (sanitized.city) sanitized.city = sanitized.city.trim().toUpperCase();
    if (sanitized.shop_city) sanitized.shop_city = sanitized.shop_city.trim().toUpperCase();
    if (sanitized.resCity) sanitized.resCity = sanitized.resCity.trim().toUpperCase();
    
    return sanitized;
}

// =====================================================
// ONBOARD MERCHANT
// =====================================================
async function onboard(req, res) {
    console.log('[BBPS-CTRL] onboard() called, user:', req.user?.id);
    
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required. Please login again.' 
            });
        }
        
        const userId = req.user.id;
        
        let requestData = sanitizeRequestData(req.body);
        
        const mappedData = {
            first_name: requestData.first_name,
            middle_name: requestData.middle_name,
            last_name: requestData.last_name,
            dob: requestData.dob,
            address: requestData.address || requestData.resAddress,
            state: requestData.state || requestData.resState,
            city: requestData.city || requestData.resCity,
            pincode_res: requestData.pincode_res || requestData.resPincode,
            shop_name: requestData.shop_name,
            shop_address: requestData.shop_address,
            shop_state: requestData.shop_state,
            shop_city: requestData.shop_city,
            pincode: requestData.pincode || requestData.shopPincode,
            business_type: requestData.business_type === 'other' 
                ? requestData.business_type_other 
                : requestData.business_type,
            aadhar_no: requestData.aadhar_no,
            pan_no: requestData.pan_no,
            bank_name: requestData.bank_name,
            account_no: requestData.account_no,
            ifsc_code: requestData.ifsc_code,
            mobile: requestData.mobile,
            email: requestData.email,
            latitude: requestData.latitude,
            longitude: requestData.longitude,
            ipAddress: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '127.0.0.1',
        };
        
        const validationErrors = validateOnboardingData(mappedData);
        if (validationErrors.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Validation failed',
                errors: validationErrors 
            });
        }
        
        console.log('[BBPS-CTRL] Processing onboarding for user:', userId);
        console.log('[BBPS-CTRL] Shop name (sanitized):', mappedData.shop_name);
        console.log('[BBPS-CTRL] Shop address (sanitized):', mappedData.shop_address);
        console.log('[BBPS-CTRL] Mobile:', mappedData.mobile);
        
        const result = await svc.onboardMerchant(userId, mappedData);
        
        if (result.bbpsResult && result.bbpsResult.code === '000') {
            return res.status(200).json({ 
                success: true, 
                message: 'Merchant onboarded successfully',
                data: {
                    status: 'active',
                    merchantCode: result.dbRecord.bbps_merchant_code,
                    onboardingId: result.dbRecord.id,
                    merchantName: result.dbRecord.shop_name
                }
            });
        } 
        
        if (result.dbRecord && result.dbRecord.status === 'failed') {
            return res.status(400).json({ 
                success: false, 
                message: 'Merchant registration failed. Please check your details and try again.',
                error: result.bbpsResult?.message || 'Registration rejected by VimoPay'
            });
        }
        
        return res.status(200).json({ 
            success: true, 
            message: 'Onboarding data saved. Registration is being processed.',
            data: {
                status: result.dbRecord?.status || 'pending',
                onboardingId: result.dbRecord?.id
            }
        });
        
    } catch (err) {
        console.error('[BBPS-CTRL] onboard error:', err.message);
        console.error('[BBPS-CTRL] onboard error stack:', err.stack);
        
        let statusCode = 500;
        let errorMessage = err.message;
        
        if (err.message.includes('Shop name must contain')) {
            statusCode = 400;
            errorMessage = 'Invalid shop name. Use only letters and numbers (no spaces or special characters).';
        } else if (err.message.includes('Shop address')) {
            statusCode = 400;
            errorMessage = 'Invalid shop address. Use only letters, numbers, spaces, dots (.), forward slashes (/), and dashes (-).';
        } else if (err.message.includes('mobile number') || err.message.includes('Mobile')) {
            statusCode = 400;
            errorMessage = 'Invalid mobile number. Please provide a valid 10-digit mobile number.';
        } else if (err.message.includes('email')) {
            statusCode = 400;
            errorMessage = 'Invalid email address. Please provide a valid email.';
        } else if (err.message.includes('pincode')) {
            statusCode = 400;
            errorMessage = 'Invalid pincode. Please provide a valid 6-digit pincode.';
        } else if (err.message.includes('VimoPay registration failed')) {
            statusCode = 400;
            errorMessage = err.message;
        } else if (err.message.includes('duplicate key')) {
            statusCode = 409;
            errorMessage = 'A record for this user already exists. Please contact support if you need to re-submit.';
        } else if (err.message.includes('PAN number is already registered')) {
            statusCode = 409;
            errorMessage = err.message;
        } else if (err.message.includes('Aadhaar number is already registered')) {
            statusCode = 409;
            errorMessage = err.message;
        }
        
        return res.status(statusCode).json({ 
            success: false, 
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// =====================================================
// GET MERCHANT STATUS
// =====================================================
async function getStatus(req, res) {
    console.log('[BBPS-CTRL] getStatus() userId:', req.params.userId);
    
    try {
        const userId = req.params.userId;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID is required' 
            });
        }
        
        if (req.user && req.user.id !== parseInt(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'You do not have permission to view this merchant status' 
            });
        }
        
        const record = await svc.getMerchantStatus(userId);
        
        if (!record) {
            return res.status(200).json({ 
                success: true, 
                data: null,
                message: 'No onboarding record found for this user'
            });
        }
        
        const safeRecord = {
            id: record.id,
            user_id: record.user_id,
            status: record.status,
            bbps_merchant_code: record.bbps_merchant_code,
            first_name: record.first_name,
            middle_name: record.middle_name,
            last_name: record.last_name,
            shop_name: record.shop_name,
            shop_address: record.shop_address,
            shop_state: record.shop_state,
            shop_city: record.shop_city,
            shop_pincode: record.shop_pincode,
            business_type: record.business_type,
            mobile: record.mobile,
            email: record.email,
            created_at: record.created_at,
            updated_at: record.updated_at,
            aadhar_no: record.aadhar_no ? maskSensitiveData('aadhaar', record.aadhar_no) : null,
            pan_no: record.pan_no ? maskSensitiveData('pan', record.pan_no) : null,
            account_no: record.account_no ? maskSensitiveData('account', record.account_no) : null,
            latitude: record.latitude,
            longitude: record.longitude,
            error_message: record.error_message,
        };
        
        return res.status(200).json({ 
            success: true, 
            data: safeRecord 
        });
        
    } catch (err) {
        console.error('[BBPS-CTRL] getStatus error:', err.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch merchant status',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
}

// =====================================================
// HELPER: Mask sensitive data
// =====================================================
function maskSensitiveData(type, value) {
    if (!value) return null;
    const str = value.toString();
    switch (type) {
        case 'aadhaar':
            return 'XXXX-XXXX-' + str.slice(-4);
        case 'pan':
            return str.slice(0, 5) + 'XXXXX';
        case 'account':
            return 'XXXXXX' + str.slice(-4);
        default:
            return '****';
    }
}

// =====================================================
// DELETE ONBOARDING RECORD (Admin only)
// =====================================================
async function deleteOnboarding(req, res) {
    console.log('[BBPS-CTRL] deleteOnboarding() called, userId:', req.params.userId);
    
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin access required' 
            });
        }
        
        const userId = req.params.userId;
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID is required' 
            });
        }
        
        const result = await db.query(
            'DELETE FROM merchant_onboarding WHERE user_id = $1 RETURNING id',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'No onboarding record found for this user' 
            });
        }
        
        return res.status(200).json({ 
            success: true, 
            message: 'Onboarding record deleted successfully' 
        });
        
    } catch (err) {
        console.error('[BBPS-CTRL] deleteOnboarding error:', err.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to delete onboarding record' 
        });
    }
}

module.exports = { 
    onboard, 
    getStatus,
    deleteOnboarding 
};