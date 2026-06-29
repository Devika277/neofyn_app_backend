const { Pool } = require('pg');
const pool = require('../config/db');

async function processBBPSCommission() {
    const client = await pool.connect();
    try {
        console.log('🔄 Starting commission processing for BBPS...');
        console.log('📌 Using service_type = "billpay" for commission rates');
        
        // Get all successful BBPS transactions for RETAILERS without commission
        const result = await client.query(`
            SELECT 
                t.id,
                t.user_id,
                t.plan_amount,
                t.type,
                t.operator,
                t.consumer_number,
                t.provider_name,
                t.created_at,
                u.role,
                u.plan AS user_plan
            FROM transactions t
            JOIN users u ON u.id = t.user_id
            WHERE t.type = 'BILL_PAYMENT'
              AND t.status = 'success'
              AND u.role = 'retailer'
              AND NOT EXISTS (
                  SELECT 1 
                  FROM commission_ledger cl 
                  WHERE cl.transaction_ref = t.id::text 
                    AND cl.service_type = 'billpay'
              )
            ORDER BY t.id ASC
        `);

        console.log(`📍 Found ${result.rows.length} BBPS transactions to process`);

        // Show existing rates
        const ratesCheck = await client.query(`
            SELECT DISTINCT slab_name, role, rate_type, rate_value, plan, min_amount, max_amount
            FROM commission_rates
            WHERE service_type = 'billpay'
              AND role = 'retailer'
              AND is_active = TRUE
            ORDER BY slab_name
        `);
        console.log('📋 Existing BBPS retailer rates in DB:');
        ratesCheck.rows.forEach(r => {
            console.log(`   ${r.slab_name} → ${r.rate_type === 'flat' ? '₹' : ''}${r.rate_value}${r.rate_type === 'percent' ? '%' : ''} (plan: ${r.plan}, min: ${r.min_amount}, max: ${r.max_amount})`);
        });

        let processed = 0;
        let totalCommission = 0;

        for (const txn of result.rows) {
            // Map operator to slab_name
            let slabName = txn.operator?.toLowerCase().trim() || 'others';
            
            // Map common biller names to slab names
            const serviceTypeMap = {
                // Electricity
                'electricity': 'electricity',
                'eb': 'electricity',
                'electric': 'electricity',
                'tneb': 'electricity',
                'kesco': 'electricity',
                'bescom': 'electricity',
                'tata power': 'electricity',
                'adani electricity': 'electricity',
                
                // Water
                'water': 'water',
                'water supply': 'water',
                
                // Gas
                'lpg': 'lpg_gas',
                'lpg_gas': 'lpg_gas',
                'indane': 'lpg_gas',
                'bharat gas': 'lpg_gas',
                'hp gas': 'lpg_gas',
                'piped gas': 'piped_gas',
                'piped_gas': 'piped_gas',
                
                // Telecom
                'postpaid': 'postpaid',
                'mobile postpaid': 'postpaid',
                'airtel postpaid': 'postpaid',
                'jio postpaid': 'postpaid',
                'vi postpaid': 'postpaid',
                'broadband': 'broadband',
                'internet': 'broadband',
                'wifi': 'broadband',
                'landline': 'landline',
                'phone': 'landline',
                
                // Financial
                'credit_card': 'credit_card',
                'credit card': 'credit_card',
                'cc': 'credit_card',
                'loan': 'loan_repayment',
                'loan_repayment': 'loan_repayment',
                'emi': 'loan_repayment',
                
                // Others
                'fastag': 'fastag',
                'fasttag': 'fastag',
                'toll': 'fastag',
                'education': 'education_fees',
                'education_fees': 'education_fees',
                'school fees': 'education_fees',
                'college fees': 'education_fees',
                'municipal': 'municipal_taxes',
                'municipal_taxes': 'municipal_taxes',
                'property tax': 'municipal_taxes',
                'rental': 'rental',
                'rent': 'rental',
                'subscription': 'subscription',
                'cable_tv': 'cable_tv',
                'cable': 'cable_tv',
                'donation': 'donation',
                'ncmc': 'ncmc_recharge',
                'ncmc_recharge': 'ncmc_recharge',
                'metro': 'ncmc_recharge',
                'recurring_deposit': 'recurring_deposit',
                'rd': 'recurring_deposit',
                'housing_society': 'housing_society',
                'society': 'housing_society',
                'hospitals': 'hospitals',
                'hospital': 'hospitals',
                'medical': 'hospitals',
                'municipal_services': 'municipal_services',
                'clubs_associations': 'clubs_associations',
                'club': 'clubs_associations'
            };
            
            slabName = serviceTypeMap[slabName] || slabName;

            console.log(`🔍 Processing txn ${txn.id}: operator=${txn.operator} → slabName=${slabName}, amount=${txn.plan_amount}, user_plan=${txn.user_plan || 'free'}`);

            // Get commission rate - using plan = user's plan
            const rateResult = await client.query(`
                SELECT rate_value, rate_type
                FROM commission_rates
                WHERE service_type = 'billpay'
                  AND slab_name = $1
                  AND role = 'retailer'
                  AND plan = $2
                  AND is_active = TRUE
                  AND $3 >= min_amount
                  AND $3 <= max_amount
                LIMIT 1
            `, [slabName, txn.user_plan || 'free', txn.plan_amount]);

            console.log(`   Query result: ${rateResult.rows.length} rows found`);

            if (rateResult.rows.length === 0) {
                console.log(`⚠️ No BBPS rate found for ${txn.id}: ${slabName}, plan: ${txn.user_plan || 'free'}`);
                continue;
            }

            const rate = rateResult.rows[0];
            let commissionAmount = 0;

            if (rate.rate_type === 'flat') {
                commissionAmount = parseFloat(rate.rate_value);
            } else {
                commissionAmount = Math.round((txn.plan_amount * parseFloat(rate.rate_value) / 100) * 100) / 100;
            }

            if (commissionAmount <= 0) {
                console.log(`⚠️ Commission zero for ${txn.id}`);
                continue;
            }

            // Insert commission
            await client.query(`
                INSERT INTO commission_ledger (
                    user_id, service_type, txn_amount, commission_rate,
                    commission_amount, role_at_time, transaction_ref,
                    created_at, updated_at, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), 'credited')
            `, [
                txn.user_id,
                'billpay',
                txn.plan_amount,
                rate.rate_value,
                commissionAmount,
                'retailer',
                txn.id.toString(),
                txn.created_at
            ]);

            // Update user's commission wallet
            await client.query(`
                UPDATE users 
                SET commission_wallet = COALESCE(commission_wallet, 0) + $1
                WHERE id = $2
            `, [commissionAmount, txn.user_id]);

            processed++;
            totalCommission += commissionAmount;
            console.log(`✅ Transaction ${txn.id}: ₹${commissionAmount} credited to retailer ${txn.user_id}`);
        }

        console.log('✅ BBPS Commission processing complete!');
        console.log(`📊 Processed: ${processed} transactions`);
        console.log(`💰 Total Commission: ₹${totalCommission.toFixed(2)}`);

        // Show summary
        const summary = await client.query(`
            SELECT 
                COUNT(*) AS total_entries,
                SUM(commission_amount) AS total_commission,
                COUNT(DISTINCT user_id) AS retailers_affected
            FROM commission_ledger
            WHERE service_type = 'billpay'
        `);
        console.log('📊 Summary:');
        console.log(`   Total Commission Entries: ${summary.rows[0]?.total_entries || 0}`);
        console.log(`   Total Commission Amount: ₹${summary.rows[0]?.total_commission || 0}`);
        console.log(`   Retailers Affected: ${summary.rows[0]?.retailers_affected || 0}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
    }
}

// Run the script
processBBPSCommission();