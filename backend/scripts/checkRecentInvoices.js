const mongoose = require('mongoose');
const TeacherInvoice = require('../models/TeacherInvoice');

async function checkRecentInvoices() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/waraqadb');
    console.log('Connected to database\n');
    
    // Find recent invoices for October 2025
    const invoices = await TeacherInvoice.find({
      month: 10,
      year: 2025,
      deleted: false
    })
    .populate('teacher', 'firstName lastName teacherInfo')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
    
    console.log(`Found ${invoices.length} invoices for October 2025:\n`);
    
    invoices.forEach((inv, i) => {
      console.log(`Invoice #${i + 1}: ${inv.invoiceNumber || 'N/A'}`);
      console.log(`  Teacher: ${inv.teacher?.firstName} ${inv.teacher?.lastName}`);
      console.log(`  Total Hours: ${inv.totalHours}`);
      console.log(`  Rate Snapshot:`);
      console.log(`    - Partition: ${inv.rateSnapshot?.partition}`);
      console.log(`    - Rate: $${inv.rateSnapshot?.rate}/hr`);
      console.log(`  Teacher YTD Hours: ${inv.teacher?.teacherInfo?.totalHoursYTD || 0}`);
      console.log(`  Status: ${inv.status}`);
      console.log(`  Classes: ${inv.classIds?.length || 0}`);
      console.log('');
    });
    
    await mongoose.disconnect();
    console.log('Disconnected');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkRecentInvoices();
