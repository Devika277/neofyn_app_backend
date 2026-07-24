/**
 * Script to retroactively credit commission for DMT transactions
 * that were successful but didn't have commission credited.
 * 
 * Usage: node scripts/credit-missing-commission.js
 */

const db = require('../config/db');
const commissionService = require('../services/commission/commissionService');

async function creditMissingCommission() {
  console.log('🔍 Starting retroactive commission credit...');
  console.log('='.repeat(60));

  const client = await db.connect();
  
  try {
    await client.query('BEGIN');

    // 1. Find all successful transactions without commission
    const { rows: transactions } = await client.query(`
      SELECT 
        t.id,
        t.iyda_txn_id,
        t.retailer_id,
        t.remitter_id,
        t.amount,
        t.status,
        t.commission_credited,
        t.created_at,
        r.product_type,
        r.monthly_limit
      FROM dmt_transactions t
      LEFT JOIN dmt_remitters r ON t.remitter_id = r.id
      WHERE t.status = 'success' 
        AND t.commission_credited = false
        AND t.amount > 0
      ORDER BY t.created_at DESC
    `);

    if (transactions.length === 0) {
      console.log('✅ No transactions found with missing commission.');
      await client.query('COMMIT');
      return;
    }

    console.log(`📊 Found ${transactions.length} transactions with missing commission:`);
    console.log('='.repeat(60));

    let totalCredited = 0;
    let successCount = 0;
    let failCount = 0;

    for (const txn of transactions) {
      console.log(`\n📝 Processing Transaction: ${txn.iyda_txn_id}`);
      console.log(`   - Amount: ₹${txn.amount}`);
      console.log(`   - Retailer: ${txn.retailer_id}`);
      console.log(`   - Product Type: ${txn.product_type || 'unknown'}`);
      console.log(`   - Created: ${txn.created_at}`);

      try {
        // Determine service type
        const serviceType = txn.product_type === 'lite' ? 'dmt' : 'dmt_smart';
        
        console.log(`   - Service Type: ${serviceType}`);

        // Check if commission already exists in ledger
        const { rows: existingCommission } = await client.query(
          `SELECT id, commission_amount 
           FROM commission_ledger 
           WHERE transaction_ref = $1 AND user_id = $2`,
          [txn.iyda_txn_id, txn.retailer_id]
        );

        if (existingCommission.length > 0) {
          console.log(`   ⚠️ Commission already exists in ledger: ₹${existingCommission[0].commission_amount}`);
          // Update transaction to mark as credited
          await client.query(
            `UPDATE dmt_transactions SET commission_credited = true WHERE id = $1`,
            [txn.id]
          );
          console.log(`   ✅ Marked transaction as commission_credited (existing ledger entry)`);
          successCount++;
          continue;
        }

        // Process commission using existing logic
        console.log(`   💰 Crediting commission...`);
        
        // Call commission service
        const commissionResult = await commissionService.processCommission(
          serviceType,
          parseFloat(txn.amount),
          txn.retailer_id,
          {
            subType: 'transfer',
            transactionRef: txn.iyda_txn_id
          }
        );

        if (commissionResult > 0) {
          // Mark transaction as commission credited
          await client.query(
            `UPDATE dmt_transactions SET commission_credited = true WHERE id = $1`,
            [txn.id]
          );
          
          console.log(`   ✅ Commission credited: ₹${commissionResult}`);
          totalCredited += commissionResult;
          successCount++;
        } else {
          console.log(`   ⚠️ Commission returned ₹0 - possibly no commission rate configured`);
          // Still mark as credited to avoid re-processing
          await client.query(
            `UPDATE dmt_transactions SET commission_credited = true WHERE id = $1`,
            [txn.id]
          );
          successCount++;
        }

      } catch (error) {
        console.error(`   ❌ Failed to credit commission for ${txn.iyda_txn_id}:`, error.message);
        failCount++;
      }
    }

    await client.query('COMMIT');

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log(`   ✅ Successfully processed: ${successCount} transactions`);
    console.log(`   ❌ Failed: ${failCount} transactions`);
    console.log(`   💰 Total Commission Credited: ₹${totalCredited.toFixed(2)}`);
    console.log('='.repeat(60));

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Script failed:', error.message);
    console.error(error.stack);
  } finally {
    client.release();
    await db.end();
  }
}

// Run the script
creditMissingCommission()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });