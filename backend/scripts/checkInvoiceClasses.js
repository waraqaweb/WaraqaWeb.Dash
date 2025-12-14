const mongoose = require('mongoose');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqa';

async function checkInvoiceClasses() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check the invoice in question
    const invoiceNumber = 'Waraqa-Nov-2025-0007';
    const invoice = await Invoice.findOne({ invoiceNumber }).lean();
    
    if (!invoice) {
      console.log(`Invoice ${invoiceNumber} not found`);
      process.exit(1);
    }

    console.log('\n=== Invoice Details ===');
    console.log('Invoice ID:', invoice._id);
    console.log('Status:', invoice.status);
    console.log('Created:', invoice.createdAt);
    console.log('Items count:', invoice.items?.length || 0);
    console.log('Internal notes:', invoice.internalNotes);

    console.log('\n=== Checking each class in invoice ===');
    for (let i = 0; i < invoice.items.length; i++) {
      const item = invoice.items[i];
      const classId = item.class || item.lessonId;
      
      console.log(`\nItem #${i + 1}:`);
      console.log('  Class ID:', classId);
      console.log('  Date:', item.date);
      console.log('  Duration:', item.duration);
      console.log('  Attended:', item.attended);
      
      if (classId) {
        const cls = await Class.findById(classId).lean();
        if (cls) {
          console.log('  Class status:', cls.status);
          console.log('  Class scheduledDate:', cls.scheduledDate);
          console.log('  Class billedInInvoiceId:', cls.billedInInvoiceId);
          console.log('  Class billedAt:', cls.billedAt);
          
          // Check if this class is in another invoice
          if (cls.billedInInvoiceId && String(cls.billedInInvoiceId) !== String(invoice._id)) {
            const otherInvoice = await Invoice.findById(cls.billedInInvoiceId).select('invoiceNumber status').lean();
            console.log('  ⚠️  Class is linked to different invoice:', otherInvoice?.invoiceNumber, otherInvoice?.status);
          }
        } else {
          console.log('  ⚠️  Class not found in database');
        }
      }
    }

    // Check if there are other active invoices with these classes
    const classIds = invoice.items.map(it => it.class || it.lessonId).filter(Boolean);
    const otherInvoices = await Invoice.find({
      _id: { $ne: invoice._id },
      'items.class': { $in: classIds },
      deleted: { $ne: true },
      status: { $nin: ['cancelled', 'refunded'] }
    }).select('invoiceNumber status items').lean();

    if (otherInvoices.length > 0) {
      console.log('\n=== Found classes in other invoices ===');
      for (const otherInv of otherInvoices) {
        console.log(`\nInvoice: ${otherInv.invoiceNumber} (${otherInv.status})`);
        const sharedClasses = otherInv.items
          .filter(it => classIds.includes(String(it.class || it.lessonId)))
          .map(it => it.class || it.lessonId);
        console.log('  Shared classes:', sharedClasses);
      }
    }

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkInvoiceClasses();
