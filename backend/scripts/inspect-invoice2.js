const mongoose = require('mongoose');
const TeacherInvoice = require('../models/TeacherInvoice');
const Class = require('../models/Class');

const INVOICE_ID = process.argv[2] || '69cc450deddfcdc651a5f8f5';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqa');
  const inv = await TeacherInvoice.findById(INVOICE_ID);
  if (!inv) { console.log('NOT FOUND'); process.exit(0); }

  console.log('=== Invoice Details ===');
  console.log('invoiceNumber:', inv.invoiceNumber);
  console.log('totalHours (stored):', inv.totalHours);
  console.log('grossAmountUSD:', inv.grossAmountUSD);
  console.log('rateSnapshot:', JSON.stringify(inv.rateSnapshot));
  console.log('monthlyHoursSnapshot:', inv.monthlyHoursSnapshot);

  // Check all classes linked
  const classIds = inv.classIds || [];
  const classes = await Class.find({ _id: { $in: classIds } })
    .select('_id duration status student dateTime scheduledDate billedForTeacherInvoice')
    .sort({ dateTime: 1 });
  
  console.log('\n=== Classes ===');
  let totalMin = 0;
  classes.forEach(c => {
    const dur = Number(c.duration) || 0;
    totalMin += dur;
    const dt = c.dateTime || c.scheduledDate;
    const name = c.student?.studentName || 'N/A';
    console.log(`  ${c._id} | ${dt ? new Date(dt).toISOString() : 'no-date'} | ${dur}min | ${name} | billed:${c.billedForTeacherInvoice || 'N/A'}`);
  });
  console.log(`\nTotal from durations: ${totalMin}min = ${(totalMin/60).toFixed(2)}h`);
  console.log(`Stored totalHours: ${inv.totalHours}h`);
  console.log(`Difference: ${(inv.totalHours - totalMin/60).toFixed(2)}h = ${(inv.totalHours*60 - totalMin)}min`);

  // Check if there's a change history
  if (inv.changeHistory && inv.changeHistory.length > 0) {
    console.log('\n=== Change History ===');
    inv.changeHistory.forEach(ch => {
      console.log(`  ${ch.changedAt || ch.createdAt} | ${ch.field || ch.type}: ${ch.oldValue} -> ${ch.newValue} | by: ${ch.changedBy}`);
    });
  }

  // Check if totalHours matches grossAmountUSD / rate
  const rate = inv.rateSnapshot?.rate || 0;
  if (rate > 0) {
    const impliedHours = inv.grossAmountUSD / rate;
    console.log(`\nImplied hours from gross/rate: ${inv.grossAmountUSD} / ${rate} = ${impliedHours.toFixed(2)}h`);
  }

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
