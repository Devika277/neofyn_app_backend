const { Pool } = require('pg');
const pool = require('../config/db');

async function processRetailerCommission() {
    const client = await pool.connect();
    try {
        console.log('🔄 Starting commission processing for RETAILERS only...');
        console.log('📌 Using service_type = "mobile" for commission rates');
        
        // Get all successful recharge transactions for RETAILERS without commission
        const result = await client.query(`
            SELECT 
                t.id,
                t.user_id,
                t.plan_amount,
                t.operator,
                t.created_at,
                u.role,
                u.plan AS user_plan
            FROM transactions t
            JOIN users u ON u.id = t.user_id
            WHERE t.type = 'MOBILE_RECHARGE'
              AND t.status = 'success'
              AND u.role = 'retailer'
              AND NOT EXISTS (
                  SELECT 1 
                  FROM commission_ledger cl 
                  WHERE cl.transaction_ref = t.id::text 
                    AND cl.service_type = 'mobile'
              )
            ORDER BY t.id ASC
        `);

        console.log(`📍 Found ${result.rows.length} retailer transactions to process`);

        // Show existing rates
        const ratesCheck = await client.query(`
            SELECT service_type, slab_name, role, rate_value, rate_type, is_active, plan, min_amount, max_amount
            FROM commission_rates
            WHERE service_type = 'mobile'
              AND role = 'retailer'
              AND is_active = TRUE
            ORDER BY slab_name
        `);
        console.log('📋 Existing retailer rates in DB:');
        ratesCheck.rows.forEach(r => {
            console.log(`   ${r.slab_name} → ${r.rate_value}% (plan: ${r.plan || 'NULL'}, min: ${r.min_amount}, max: ${r.max_amount})`);
        });

        let processed = 0;
        let totalCommission = 0;

        for (const txn of result.rows) {
            // Map operator
            let slabName = txn.operator.toUpperCase().trim();
            const operatorMap = {
                'JIO': 'JIO',
                'JIORECHARGE': 'JIO',
                'JIORECH': 'JIO',
                'AIRTEL': 'AIRTEL',
                'VI': 'VI',
                'VODAFONE': 'VI',
                'IDEA': 'VI',
                'BSNL': 'BSNL',
                'BSNLTOPUP': 'BSNL',
                'BSNL_TOPUP': 'BSNL'
            };
            slabName = operatorMap[slabName] || slabName;

            console.log(`🔍 Processing txn ${txn.id}: operator=${txn.operator} → slabName=${slabName}, amount=${txn.plan_amount}`);

            // Get commission rate for retailer - Using plan = 'free' since all rates have 'free'
            const rateResult = await client.query(`
                SELECT rate_value, rate_type
                FROM commission_rates
                WHERE service_type = 'mobile'
                  AND slab_name = $1
                  AND role = 'retailer'
                  AND plan = 'free'
                  AND is_active = TRUE
                  AND $2 >= min_amount
                  AND $2 <= max_amount
                LIMIT 1
            `, [slabName, txn.plan_amount]);

            console.log(`   Query result: ${rateResult.rows.length} rows found`);

            if (rateResult.rows.length === 0) {
                console.log(`⚠️ No retailer rate found for ${txn.id}: ${slabName}`);
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
                'mobile',
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

        console.log('✅ Commission processing complete!');
        console.log(`📊 Processed: ${processed} transactions`);
        console.log(`💰 Total Commission: ₹${totalCommission.toFixed(2)}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        client.release();
    }
}

// Run the script
processRetailerCommission();