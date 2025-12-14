const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');

mongoose.connect('mongodb://localhost:27017/waraqa-test')
  .then(async () => {
    console.log('Connected to DB\n');
    
    // Count documents
    const invCount = await Invoice.countDocuments({});
    const invActiveCount = await Invoice.countDocuments({ deleted: { $ne: true } });
    const classCount = await Class.countDocuments({});
    
    console.log(`📊 Database stats:`);
    console.log(`  Total invoices: ${invCount}`);
    console.log(`  Active invoices: ${invActiveCount}`);
    console.log(`  Total classes: ${classCount}`);
    
    if (invActiveCount === 0) {
      console.log('\n⚠️ No active invoices found in database');
      mongoose.disconnect();
      return;
    }
    
    // Find all recent invoices
    const invoices = await Invoice.find({ deleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    
    console.log('\nRecent invoices:');
    invoices.forEach(inv => {
      console.log(`  - ${inv.friendlyNumber} | ${inv.guardianName} | Created: ${inv.createdAt.toISOString().slice(0, 10)} | Items: ${inv.items.length}`);
    });
    
    // Pick the one for Mariam (or first one)
    const inv = invoices.find(i => i.guardianName && i.guardianName.includes('Mariam')) || invoices[0];
    if (!inv) {
      console.log('Invoice not found');
      mongoose.disconnect();
      return;
    }
    
    console.log('\n📄 Selected Invoice:');
    console.log('  Created:', inv.createdAt);
    console.log('  Friendly:', inv.friendlyNumber);
    console.log('  Guardian:', inv.guardianName);
    console.log('  Internal note:', inv.internalNote);
    console.log('  Billing period:', inv.billingPeriod);
    console.log('  Items:', inv.items.length, 'classes');
    const sortedDates = inv.items.map(i => new Date(i.date)).sort((a, b) => a - b);
    console.log('  Date range:', sortedDates[0]?.toISOString().slice(0, 10), '→', sortedDates[sortedDates.length-1]?.toISOString().slice(0, 10));
    
    // Find ALL unbilled classes for this guardian
    const unbilledClasses = await Class.find({
      'student.guardianId': inv.guardian,
      scheduledDate: { $gte: new Date('2025-11-06'), $lt: new Date('2026-01-06') },
      billedInInvoiceId: null
    })
      .select('scheduledDate duration student status billedInInvoiceId')
      .sort('scheduledDate')
      .lean();
    
    console.log('\n📋 Unbilled classes for Mariam (Nov-Dec 2025):', unbilledClasses.length);
    unbilledClasses.forEach(c => {
      console.log('  -', c.scheduledDate.toISOString().slice(0, 10), c.student.studentName, c.duration + 'm', c.status);
    });
    
    // Check if there are classes BEFORE Dec 29
    const beforeDec29 = unbilledClasses.filter(c => c.scheduledDate < new Date('2025-12-29'));
    console.log('\n🚨 Unbilled classes BEFORE Dec 29:', beforeDec29.length);
    beforeDec29.forEach(c => {
      console.log('  -', c.scheduledDate.toISOString().slice(0, 10), c.student.studentName, c.duration + 'm', c.status);
    });
    
    mongoose.disconnect();
  })
  .catch(err => {
    console.error('Error:', err);
    mongoose.disconnect();
  });
