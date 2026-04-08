const mongoose = require('mongoose');
async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb_test');
  const Invoice = require('../models/Invoice');
  const User = require('../models/User');
  const Class = require('../models/Class');

  const targetId = process.argv[2] || '69d189f0cfbb97a13fe017df';
  const inv = await Invoice.findById(targetId).lean();
  if (!inv) { console.log('Invoice not found:', targetId); process.exit(0); }

  const guardian = await User.findById(inv.guardian).lean();
  console.log('=== GUARDIAN STATE ===');
  console.log('autoTotalHours:', guardian?.guardianInfo?.autoTotalHours);
  console.log('totalHours:', guardian?.guardianInfo?.totalHours);
  console.log('cumulativeConsumedHours:', guardian?.guardianInfo?.cumulativeConsumedHours);
  for (const s of (guardian?.guardianInfo?.students || [])) {
    console.log('  Student:', s.firstName, s.lastName, '| _id:', s._id, '| hoursRemaining:', s.hoursRemaining);
  }

  console.log('\n=== INVOICE PAYMENT LOGS ===');
  for (const log of (inv.paymentLogs || [])) {
    console.log('  Log:', JSON.stringify({
      amount: log.amount,
      paidHours: log.paidHours,
      method: log.paymentMethod || log.method,
      paidAt: log.paidAt,
      tip: log.tip
    }));
  }

  console.log('\n=== INVOICE ADJUSTMENTS ===');
  for (const adj of (inv.adjustments || [])) {
    console.log('  Adj:', JSON.stringify({
      type: adj.type,
      reason: adj.reason,
      description: adj.description,
      hoursDelta: adj.hoursDelta,
      amountDelta: adj.amountDelta
    }));
  }

  console.log('\n=== INVOICE COVERAGE ===');
  console.log(JSON.stringify(inv.coverage, null, 2));

  console.log('\n=== INVOICE ITEMS (with class cross-ref) ===');
  let invoiceTotalMin = 0;
  for (const item of (inv.items || [])) {
    const classId = item.class || item.lessonId;
    const cls = classId ? await Class.findById(classId).select('duration status').lean() : null;
    invoiceTotalMin += (item.duration || 0);
    console.log('  Item:', JSON.stringify({
      classId: classId,
      itemDuration: item.duration,
      classDuration: cls?.duration,
      durationMatch: item.duration === cls?.duration,
      classStatus: cls?.status,
      itemAttended: item.attended
    }));
  }
  
  console.log('\n=== SUMMARY ===');
  const invoiceHours = invoiceTotalMin / 60;
  const paidHours = (inv.paymentLogs || []).reduce((s, l) => s + (Number(l.paidHours) || 0), 0);
  
  const classes = await Class.find({ 'student.guardianId': inv.guardian, status: { $in: ['attended', 'missed_by_student'] } }).lean();
  const countedHours = classes.reduce((s, c) => s + (c.duration || 60) / 60, 0);
  
  const studentHoursSum = (guardian?.guardianInfo?.students || []).reduce((s, st) => s + (Number(st.hoursRemaining) || 0), 0);
  
  console.log('Invoice item hours:', invoiceHours.toFixed(3));
  console.log('Paid hours (from logs):', paidHours.toFixed(3));
  console.log('Counted class hours:', countedHours.toFixed(3));
  console.log('Expected totalHours (paid - counted):', (paidHours - countedHours).toFixed(3));
  console.log('Sum of student hoursRemaining:', studentHoursSum.toFixed(3));
  console.log('Guardian totalHours:', guardian?.guardianInfo?.totalHours);
  console.log('autoTotalHours:', guardian?.guardianInfo?.autoTotalHours);

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
