require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Invoice = require('../models/Invoice');

async function checkGuardianHours() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb');
    console.log('Connected to MongoDB');

    const guardian = await User.findOne({ email: 'khaled.mostafa@waraqa.co' });
    if (!guardian) {
      console.log('Guardian not found');
      process.exit(1);
    }

    console.log('\n=== GUARDIAN INFO ===');
    console.log('Name:', guardian.firstName, guardian.lastName);
    console.log('Email:', guardian.email);
    console.log('Total Hours:', guardian.guardianInfo?.totalHours || 0);
    
    console.log('\n=== STUDENTS ===');
    if (guardian.guardianInfo?.students) {
      guardian.guardianInfo.students.forEach(s => {
        console.log(`- ${s.firstName} ${s.lastName}: ${s.hoursRemaining || 0} hours`);
      });
    }

    // Check invoices
    const invoices = await Invoice.find({ guardian: guardian._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    console.log('\n=== RECENT INVOICES ===');
    invoices.forEach(inv => {
      console.log(`\n${inv.invoiceNumber} - ${inv.status}`);
      console.log(`  Total: $${inv.total}`);
      console.log(`  Paid: $${inv.paidAmount || 0}`);
      console.log(`  Items: ${inv.items?.length || 0}`);
      console.log(`  Total item minutes: ${inv.items?.reduce((sum, it) => sum + (it.duration || 0), 0) || 0}`);
      console.log(`  Coverage maxHours: ${inv.coverage?.maxHours || 'none'}`);
      if (inv.paymentLogs?.length) {
        console.log('  Payment logs:');
        inv.paymentLogs.forEach(log => {
          console.log(`    - $${log.amount} (${log.method}) paidHours: ${log.paidHours || 'N/A'}`);
        });
      }
    });

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkGuardianHours();
