const mongoose = require('mongoose');
const TeacherInvoice = require('../models/TeacherInvoice');

async function listAllInvoices() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/waraqadb');
    console.log('Connected to database\n');
    
    // Find all invoices
    const invoices = await TeacherInvoice.find({ deleted: false })
    .populate('teacher', 'firstName lastName teacherInfo')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
    
    console.log(`Found ${invoices.length} recent invoices:\n`);
    
    invoices.forEach((inv, i) => {
      console.log(`#${i + 1}: INV-${inv.invoiceNumber || 'N/A'} | ${inv.teacher?.firstName} ${inv.teacher?.lastName} | ${inv.month}/${inv.year} | ${inv.totalHours}h | $${inv.rateSnapshot?.rate}/hr (${inv.rateSnapshot?.partition}) | ${inv.status}`);
    });
    
    await mongoose.disconnect();
    console.log('\nDisconnected');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

listAllInvoices();
