const mongoose = require('mongoose');
const TeacherInvoice = require('../models/TeacherInvoice');
const User = require('../models/User');

async function checkTeacherYTD() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/waraqa');
    console.log('Connected to database\n');
    
    // Find the invoice with 0.92 hours
    const invoice = await TeacherInvoice.findOne({
      totalHours: { $gte: 0.91, $lte: 0.93 },
      deleted: false
    })
    .populate('teacher', 'firstName lastName teacherInfo')
    .lean();
    
    if (!invoice) {
      console.log('No invoice found with ~0.92 hours');
      await mongoose.disconnect();
      return;
    }
    
    console.log('Invoice Details:');
    console.log('================');
    console.log(`Invoice Number: ${invoice.invoiceNumber || 'N/A'}`);
    console.log(`Teacher: ${invoice.teacher?.firstName} ${invoice.teacher?.lastName}`);
    console.log(`Month/Year: ${invoice.month}/${invoice.year}`);
    console.log(`Total Hours (this month): ${invoice.totalHours}`);
    console.log(`Rate: $${invoice.rateSnapshot?.rate}/hr`);
    console.log(`Partition: ${invoice.rateSnapshot?.partition}`);
    console.log('');
    
    console.log('Teacher YTD Information:');
    console.log('========================');
    console.log(`YTD Hours: ${invoice.teacher?.teacherInfo?.totalHoursYTD || 0}`);
    console.log(`Combined Hours (YTD + Current): ${(invoice.teacher?.teacherInfo?.totalHoursYTD || 0) + invoice.totalHours}`);
    console.log('');
    
    console.log('Rate Calculation:');
    console.log('=================');
    console.log('The system uses YTD + current month hours to determine the rate tier.');
    console.log(`This teacher has ${invoice.teacher?.teacherInfo?.totalHoursYTD || 0} YTD hours + ${invoice.totalHours} current hours`);
    console.log(`= ${(invoice.teacher?.teacherInfo?.totalHoursYTD || 0) + invoice.totalHours} total hours`);
    console.log('');
    console.log('Rate Tiers:');
    console.log('  1-60h: $3.00/hr');
    console.log('  61-75h: $3.25/hr');
    console.log('  76-90h: $3.50/hr');
    console.log('  91-110h: $3.75/hr');
    console.log('  111-130h: $4.00/hr');
    console.log('  131-150h: $4.25/hr');
    console.log('  151+h: $4.50/hr');
    
    const combinedHours = (invoice.teacher?.teacherInfo?.totalHoursYTD || 0) + invoice.totalHours;
    console.log('');
    console.log(`For ${combinedHours.toFixed(2)} hours, the rate should be:`);
    if (combinedHours <= 60) console.log('  → $3.00/hr (1-60h tier)');
    else if (combinedHours <= 75) console.log('  → $3.25/hr (61-75h tier)');
    else if (combinedHours <= 90) console.log('  → $3.50/hr (76-90h tier)');
    else if (combinedHours <= 110) console.log('  → $3.75/hr (91-110h tier)');
    else if (combinedHours <= 130) console.log('  → $4.00/hr (111-130h tier)');
    else if (combinedHours <= 150) console.log('  → $4.25/hr (131-150h tier)');
    else console.log('  → $4.50/hr (151+h tier) ✓ CORRECT');
    
    await mongoose.disconnect();
    console.log('\nDisconnected');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkTeacherYTD();
