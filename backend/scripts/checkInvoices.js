const mongoose = require('mongoose');
require('dotenv').config();

const TeacherInvoice = require('../models/TeacherInvoice');

async function checkInvoices() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb');
    console.log('Connected to MongoDB');

    const count = await TeacherInvoice.countDocuments();
    console.log(`\n✓ Total teacher invoices: ${count}`);

    if (count > 0) {
      const invoices = await TeacherInvoice.find()
        .limit(10)
        .populate('teacher', 'name email')
        .select('teacher invoiceMonth invoiceYear status totalHours totalUSD totalEGP')
        .sort({ invoiceYear: -1, invoiceMonth: -1 });

      console.log('\nSample invoices:');
      invoices.forEach(inv => {
        console.log(`- ${inv.teacher?.name || 'Unknown'} | ${inv.invoiceMonth}/${inv.invoiceYear} | Status: ${inv.status} | Hours: ${inv.totalHours} | USD: $${inv.totalUSD} | EGP: ${inv.totalEGP}`);
      });

      // Check for October 2025
      const oct2025 = await TeacherInvoice.find({ invoiceMonth: 10, invoiceYear: 2025 });
      console.log(`\n✓ October 2025 invoices: ${oct2025.length}`);
      oct2025.forEach(inv => {
        console.log(`  - Teacher ID: ${inv.teacher} | Status: ${inv.status}`);
      });
    } else {
      console.log('\n⚠ No invoices found in database');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkInvoices();
