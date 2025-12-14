/**
 * Debug Invoice Total Calculation
 * 
 * This script investigates why an invoice shows $19 instead of expected $15
 * Expected: 1 hour × $10 + $5 transfer fee = $15
 * Actual: $19
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const User = require('../models/User'); // Need to register User schema for populate

async function debugInvoiceTotal() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find the invoice - you can pass invoice ID as argument or modify this
    const invoiceNumber = process.argv[2] || 'INV-202511-0001';
    
    console.log(`🔍 Searching for invoice: ${invoiceNumber}\n`);
    
    const invoice = await Invoice.findOne({
      $or: [
        { invoiceNumber },
        { invoiceName: invoiceNumber },
        { _id: mongoose.Types.ObjectId.isValid(invoiceNumber) ? invoiceNumber : null }
      ]
    }).populate('guardian', 'firstName lastName email guardianInfo');

    if (!invoice) {
      console.log('❌ Invoice not found');
      process.exit(1);
    }

    console.log('📋 INVOICE DETAILS');
    console.log('==================');
    console.log(`Invoice ID: ${invoice._id}`);
    console.log(`Invoice Number: ${invoice.invoiceNumber}`);
    console.log(`Invoice Name: ${invoice.invoiceName}`);
    console.log(`Status: ${invoice.status}`);
    console.log(`Guardian: ${invoice.guardian?.firstName} ${invoice.guardian?.lastName}`);
    console.log('');

    // Analyze items
    console.log('📦 ITEMS ANALYSIS');
    console.log('==================');
    console.log(`Total items in invoice: ${invoice.items?.length || 0}`);
    
    let itemsSubtotal = 0;
    let itemsTotalMinutes = 0;
    
    if (invoice.items && invoice.items.length > 0) {
      invoice.items.forEach((item, index) => {
        const amount = Number(item.amount || 0);
        const duration = Number(item.duration || 0);
        const rate = Number(item.rate || 0);
        const hours = duration / 60;
        
        console.log(`\nItem ${index + 1}:`);
        console.log(`  Date: ${item.date}`);
        console.log(`  Duration: ${duration} minutes (${hours.toFixed(2)} hours)`);
        console.log(`  Rate: $${rate.toFixed(2)}/hour`);
        console.log(`  Amount: $${amount.toFixed(2)}`);
        console.log(`  Description: ${item.description || '-'}`);
        
        itemsSubtotal += amount;
        itemsTotalMinutes += duration;
      });
      
      console.log(`\n📊 Items Summary:`);
      console.log(`  Total Minutes: ${itemsTotalMinutes}`);
      console.log(`  Total Hours: ${(itemsTotalMinutes / 60).toFixed(2)}`);
      console.log(`  Items Subtotal: $${itemsSubtotal.toFixed(2)}`);
    }

    // Coverage analysis
    console.log('\n\n🎯 COVERAGE ANALYSIS');
    console.log('==================');
    if (invoice.coverage) {
      console.log(`Strategy: ${invoice.coverage.strategy || 'none'}`);
      console.log(`Max Hours: ${invoice.coverage.maxHours ?? 'none'}`);
      console.log(`End Date: ${invoice.coverage.endDate || 'none'}`);
      console.log(`Waive Transfer Fee: ${invoice.coverage.waiveTransferFee || false}`);
      
      // Apply coverage filter manually
      if (typeof invoice.coverage.maxHours === 'number' && invoice.coverage.maxHours > 0) {
        const maxMinutes = Math.round(invoice.coverage.maxHours * 60);
        console.log(`\n✂️ Applying maxHours filter: ${invoice.coverage.maxHours}h (${maxMinutes} minutes)`);
        
        let cumulativeMinutes = 0;
        let filteredSubtotal = 0;
        let includedCount = 0;
        
        const sortedItems = [...invoice.items].sort((a, b) => {
          return new Date(a.date) - new Date(b.date);
        });
        
        for (const item of sortedItems) {
          const duration = Number(item.duration || 0);
          if (cumulativeMinutes + duration > maxMinutes) {
            console.log(`  ⛔ Stopped at item: would exceed cap`);
            break;
          }
          cumulativeMinutes += duration;
          filteredSubtotal += Number(item.amount || 0);
          includedCount++;
        }
        
        console.log(`\n📊 After Coverage Filter:`);
        console.log(`  Included Items: ${includedCount} / ${invoice.items.length}`);
        console.log(`  Filtered Minutes: ${cumulativeMinutes}`);
        console.log(`  Filtered Hours: ${(cumulativeMinutes / 60).toFixed(2)}`);
        console.log(`  Filtered Subtotal: $${filteredSubtotal.toFixed(2)}`);
      }
    } else {
      console.log('No coverage settings');
    }

    // Excluded classes
    console.log('\n\n🚫 EXCLUDED CLASSES');
    console.log('==================');
    if (invoice.excludedClassIds && invoice.excludedClassIds.length > 0) {
      console.log(`Excluded class IDs: ${invoice.excludedClassIds.length}`);
      invoice.excludedClassIds.forEach(id => console.log(`  - ${id}`));
    } else {
      console.log('No excluded classes');
    }

    // Stored totals
    console.log('\n\n💰 STORED TOTALS (DATABASE)');
    console.log('==================');
    console.log(`Subtotal: $${(invoice.subtotal || 0).toFixed(2)}`);
    console.log(`Tax: $${(invoice.tax || 0).toFixed(2)} (${invoice.taxRate || 0}%)`);
    console.log(`Discount: $${(invoice.discount || 0).toFixed(2)}`);
    console.log(`Late Fee: $${(invoice.lateFee || 0).toFixed(2)}`);
    console.log(`Hours Covered: ${invoice.hoursCovered || 0}`);

    // Guardian financial
    console.log('\n\n💳 GUARDIAN FINANCIAL');
    console.log('==================');
    if (invoice.guardianFinancial) {
      console.log(`Hourly Rate: $${(invoice.guardianFinancial.hourlyRate || 0).toFixed(2)}`);
      
      if (invoice.guardianFinancial.transferFee) {
        const tf = invoice.guardianFinancial.transferFee;
        console.log(`\nTransfer Fee:`);
        console.log(`  Mode: ${tf.mode || 'fixed'}`);
        console.log(`  Value: ${tf.value || 0}`);
        console.log(`  Waived: ${tf.waived || false}`);
        console.log(`  Waived by Coverage: ${tf.waivedByCoverage || false}`);
        console.log(`  Amount: $${(tf.amount || 0).toFixed(2)}`);
        console.log(`  Source: ${tf.source || 'unknown'}`);
      }
    } else {
      console.log('No guardian financial data');
    }

    // Final totals
    console.log('\n\n🏁 FINAL TOTALS');
    console.log('==================');
    console.log(`Total: $${(invoice.total || 0).toFixed(2)}`);
    console.log(`Adjusted Total: $${(invoice.adjustedTotal || 0).toFixed(2)}`);
    console.log(`Paid Amount: $${(invoice.paidAmount || 0).toFixed(2)}`);
    console.log(`Tip: $${(invoice.tip || 0).toFixed(2)}`);
    
    const dueAmount = invoice.getDueAmount();
    console.log(`Due Amount (calculated): $${dueAmount.toFixed(2)}`);

    // Manual calculation check
    console.log('\n\n🧮 MANUAL CALCULATION CHECK');
    console.log('==================');
    
    const manualSubtotal = invoice.subtotal || 0;
    const manualTax = invoice.tax || 0;
    const manualDiscount = invoice.discount || 0;
    const manualLateFee = invoice.lateFee || 0;
    const manualTransferFee = invoice.guardianFinancial?.transferFee?.amount || 0;
    
    const manualBaseTotal = manualSubtotal + manualTax - manualDiscount + manualLateFee;
    const manualFinalTotal = manualBaseTotal + manualTransferFee;
    
    console.log(`Subtotal:        $${manualSubtotal.toFixed(2)}`);
    console.log(`+ Tax:           $${manualTax.toFixed(2)}`);
    console.log(`- Discount:      $${manualDiscount.toFixed(2)}`);
    console.log(`+ Late Fee:      $${manualLateFee.toFixed(2)}`);
    console.log(`= Base Total:    $${manualBaseTotal.toFixed(2)}`);
    console.log(`+ Transfer Fee:  $${manualTransferFee.toFixed(2)}`);
    console.log(`= Final Total:   $${manualFinalTotal.toFixed(2)}`);
    
    console.log('\n📍 COMPARISON:');
    console.log(`Expected:        $15.00 (1h × $10 + $5 fee)`);
    console.log(`Database Total:  $${(invoice.total || 0).toFixed(2)}`);
    console.log(`Calculated:      $${manualFinalTotal.toFixed(2)}`);
    
    const discrepancy = Math.abs((invoice.total || 0) - 15);
    if (discrepancy > 0.01) {
      console.log(`\n⚠️  DISCREPANCY DETECTED: $${discrepancy.toFixed(2)}`);
      
      // Investigate possible causes
      console.log('\n🔍 POSSIBLE CAUSES:');
      
      if (invoice.items.length > 1) {
        console.log(`  ❓ Multiple items (${invoice.items.length}) might be included`);
      }
      
      if (!invoice.coverage?.maxHours || invoice.coverage.maxHours > 1) {
        console.log(`  ❓ Coverage maxHours not set to 1 hour`);
      }
      
      if (invoice.excludedClassIds && invoice.excludedClassIds.length > 0) {
        console.log(`  ❓ Some classes marked as excluded`);
      }
      
      if (manualTax > 0) {
        console.log(`  ❓ Tax applied: $${manualTax.toFixed(2)}`);
      }
      
      if (manualLateFee > 0) {
        console.log(`  ❓ Late fee applied: $${manualLateFee.toFixed(2)}`);
      }
      
      if (invoice.guardianFinancial?.transferFee?.mode === 'percent') {
        console.log(`  ❓ Transfer fee is percentage-based, not fixed`);
      }
    } else {
      console.log('\n✅ Total matches expected value!');
    }

    // Test recalculateTotals
    console.log('\n\n🔄 TESTING recalculateTotals()');
    console.log('==================');
    console.log('Before recalculate:');
    console.log(`  Subtotal: $${invoice.subtotal?.toFixed(2)}`);
    console.log(`  Total: $${invoice.total?.toFixed(2)}`);
    
    invoice.recalculateTotals();
    
    console.log('\nAfter recalculate:');
    console.log(`  Subtotal: $${invoice.subtotal?.toFixed(2)}`);
    console.log(`  Total: $${invoice.total?.toFixed(2)}`);
    console.log(`  Hours Covered: ${invoice.hoursCovered}`);
    
    const newDiscrepancy = Math.abs((invoice.total || 0) - 15);
    if (newDiscrepancy > 0.01) {
      console.log(`\n⚠️  Still $${newDiscrepancy.toFixed(2)} difference after recalculate`);
    } else {
      console.log('\n✅ Total is correct after recalculate!');
      console.log('\n💡 SOLUTION: The invoice needs to be saved with recalculateTotals()');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.connection.close();
    console.log('\n\n✅ Database connection closed');
  }
}

// Run the debug
console.log('🚀 Invoice Total Debug Script\n');
console.log('Usage: node debug_invoice_total.js [invoice-number-or-id]\n');

debugInvoiceTotal();
