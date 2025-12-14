/**
 * Fix Invoice Item Rates
 * 
 * Updates invoice item rates to match the current guardian hourly rate
 * and recalculates totals
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const User = require('../models/User');

async function fixInvoiceRates() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find the invoice
    const invoiceIdentifier = process.argv[2] || 'INV-202511-0001';
    
    console.log(`🔍 Searching for invoice: ${invoiceIdentifier}\n`);
    
    const invoice = await Invoice.findOne({
      $or: [
        { invoiceNumber: invoiceIdentifier },
        { invoiceName: invoiceIdentifier },
        { _id: mongoose.Types.ObjectId.isValid(invoiceIdentifier) ? invoiceIdentifier : null }
      ]
    }).populate('guardian', 'firstName lastName email guardianInfo');

    if (!invoice) {
      console.log('❌ Invoice not found');
      process.exit(1);
    }

    console.log('📋 INVOICE FOUND');
    console.log('==================');
    console.log(`Invoice: ${invoice.invoiceNumber}`);
    console.log(`Guardian: ${invoice.guardian?.firstName} ${invoice.guardian?.lastName}`);
    console.log(`Status: ${invoice.status}`);
    console.log('');

    // Get the current guardian rate
    const guardianRate = invoice.guardianFinancial?.hourlyRate 
      || invoice.guardian?.guardianInfo?.hourlyRate 
      || 10;

    console.log('💰 RATE INFORMATION');
    console.log('==================');
    console.log(`Current Guardian Rate: $${guardianRate}/hour`);
    console.log('');

    // Show current item rates
    console.log('📦 CURRENT ITEM RATES');
    console.log('==================');
    let needsUpdate = false;
    
    invoice.items.forEach((item, index) => {
      const currentRate = Number(item.rate || 0);
      const currentAmount = Number(item.amount || 0);
      const duration = Number(item.duration || 0);
      const hours = duration / 60;
      
      console.log(`Item ${index + 1}:`);
      console.log(`  Current Rate: $${currentRate}/hour`);
      console.log(`  Current Amount: $${currentAmount.toFixed(2)}`);
      console.log(`  Duration: ${hours.toFixed(2)} hours`);
      
      if (Math.abs(currentRate - guardianRate) > 0.01) {
        const newAmount = (hours * guardianRate).toFixed(2);
        console.log(`  ⚠️  Rate mismatch! Should be $${guardianRate}/hour`);
        console.log(`  ✅ Will update amount to: $${newAmount}`);
        needsUpdate = true;
      } else {
        console.log(`  ✅ Rate is correct`);
      }
      console.log('');
    });

    if (!needsUpdate) {
      console.log('✅ All item rates are correct. No update needed.');
      process.exit(0);
    }

    // Ask for confirmation
    console.log('\n⚠️  UPDATE CONFIRMATION');
    console.log('==================');
    console.log(`This will update all item rates from their current values to $${guardianRate}/hour`);
    console.log(`and recalculate the invoice totals.`);
    console.log('');
    console.log('BEFORE:');
    console.log(`  Subtotal: $${invoice.subtotal?.toFixed(2)}`);
    console.log(`  Total: $${invoice.total?.toFixed(2)}`);
    console.log('');

    // Update all item rates
    console.log('🔄 UPDATING ITEM RATES...');
    console.log('==================');
    
    let updatedCount = 0;
    invoice.items.forEach((item, index) => {
      const currentRate = Number(item.rate || 0);
      
      if (Math.abs(currentRate - guardianRate) > 0.01) {
        const duration = Number(item.duration || 0);
        const hours = duration / 60;
        const newAmount = Math.round((hours * guardianRate) * 100) / 100;
        
        console.log(`Item ${index + 1}: $${currentRate} → $${guardianRate} (Amount: $${item.amount} → $${newAmount.toFixed(2)})`);
        
        item.rate = guardianRate;
        item.amount = newAmount;
        updatedCount++;
      }
    });

    console.log(`\n✅ Updated ${updatedCount} item(s)`);
    console.log('');

    // Recalculate totals
    console.log('🔄 RECALCULATING TOTALS...');
    console.log('==================');
    
    invoice.recalculateTotals();
    
    console.log('AFTER:');
    console.log(`  Subtotal: $${invoice.subtotal?.toFixed(2)}`);
    console.log(`  Total: $${invoice.total?.toFixed(2)}`);
    console.log(`  Hours Covered: ${invoice.hoursCovered}`);
    console.log('');

    // Calculate expected total
    const expectedSubtotal = invoice.coverage?.maxHours 
      ? invoice.coverage.maxHours * guardianRate 
      : invoice.items.length * guardianRate;
    const expectedTotal = expectedSubtotal + (invoice.guardianFinancial?.transferFee?.amount || 0);
    
    console.log('📊 VERIFICATION');
    console.log('==================');
    console.log(`Expected Total: $${expectedTotal.toFixed(2)}`);
    console.log(`Calculated Total: $${invoice.total?.toFixed(2)}`);
    
    if (Math.abs(invoice.total - expectedTotal) < 0.01) {
      console.log('✅ Totals match!');
    } else {
      console.log('⚠️  Totals do not match exactly');
    }
    console.log('');

    // Save the invoice
    console.log('💾 SAVING INVOICE...');
    console.log('==================');
    
    invoice.updatedAt = new Date();
    await invoice.save();
    
    console.log('✅ Invoice saved successfully!');
    console.log('');
    
    console.log('📋 FINAL SUMMARY');
    console.log('==================');
    console.log(`Invoice: ${invoice.invoiceNumber}`);
    console.log(`Items Updated: ${updatedCount}`);
    console.log(`New Subtotal: $${invoice.subtotal?.toFixed(2)}`);
    console.log(`New Total: $${invoice.total?.toFixed(2)}`);
    console.log(`Transfer Fee: $${invoice.guardianFinancial?.transferFee?.amount?.toFixed(2) || '0.00'}`);
    console.log('');
    console.log('✅ Done! The invoice rates and totals have been updated.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

// Run the fix
console.log('🔧 Fix Invoice Item Rates\n');
console.log('Usage: node fix_invoice_rates.js [invoice-number-or-id]\n');

fixInvoiceRates();
