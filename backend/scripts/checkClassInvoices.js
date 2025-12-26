const mongoose = require('mongoose');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

async function checkClassInvoices() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get the CLASS_ID from command line argument
    const classId = process.argv[2];
    
    if (!classId) {
      console.log('Usage: node checkClassInvoices.js <CLASS_ID>');
      console.log('\nExample: node checkClassInvoices.js 6909ee4b38ebb5432efd1031');
      process.exit(1);
    }

    console.log(`\n=== Checking Class ${classId} ===`);
    
    const cls = await Class.findById(classId).lean();
    if (!cls) {
      console.log('Class not found!');
      process.exit(1);
    }

    console.log('\n Class Details:');
    console.log('  Status:', cls.status);
    console.log('  Scheduled Date:', cls.scheduledDate);
    console.log('  Duration:', cls.duration);
    console.log('  billedInInvoiceId:', cls.billedInInvoiceId);
    console.log('  billedAt:', cls.billedAt);
    console.log('  flaggedUninvoiced:', cls.flaggedUninvoiced);

    // Find all invoices containing this class
    const invoices = await Invoice.find({
      $or: [
        { 'items.class': classId },
        { 'items.lessonId': classId }
      ],
      deleted: { $ne: true }
    }).select('invoiceNumber status createdAt items').lean();

    console.log(`\n=== Found ${invoices.length} invoice(s) containing this class ===`);
    
    for (const inv of invoices) {
      console.log(`\nInvoice: ${inv.invoiceNumber}`);
      console.log('  ID:', inv._id);
      console.log('  Status:', inv.status);
      console.log('  Created:', inv.createdAt);
      
      const item = inv.items.find(it => 
        String(it.class || it.lessonId) === String(classId)
      );
      
      if (item) {
        console.log('  Item details:');
        console.log('    Date:', item.date);
        console.log('    Duration:', item.duration);
        console.log('    Amount:', item.amount);
        console.log('    Attended:', item.attended);
      }
      
      // Check if this matches the billedInInvoiceId
      if (cls.billedInInvoiceId) {
        if (String(inv._id) === String(cls.billedInInvoiceId)) {
          console.log('  ✅ This matches the class.billedInInvoiceId');
        } else {
          console.log('  ⚠️  This does NOT match the class.billedInInvoiceId');
        }
      }
    }

    // Check for active invoices (non-cancelled, non-refunded)
    const activeInvoices = invoices.filter(inv => 
      !['cancelled', 'refunded'].includes(inv.status)
    );
    
    if (activeInvoices.length > 1) {
      console.log(`\n❌ PROBLEM: Class appears in ${activeInvoices.length} ACTIVE invoices!`);
      activeInvoices.forEach(inv => {
        console.log(`  - ${inv.invoiceNumber} (${inv.status})`);
      });
    } else if (activeInvoices.length === 1) {
      console.log(`\n✅ Good: Class appears in only 1 active invoice: ${activeInvoices[0].invoiceNumber} (${activeInvoices[0].status})`);
    } else {
      console.log('\n✅ Class is not in any active invoices');
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkClassInvoices();
