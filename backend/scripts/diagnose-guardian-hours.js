const mongoose = require('mongoose');
async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const Invoice = require('../models/Invoice');
  const User = require('../models/User');
  const Class = require('../models/Class');

  const targetId = process.argv[2] || '69d184216d767f6489cc74e8';
  const inv = await Invoice.findById(targetId).lean();
  if (!inv) { console.log('Invoice not found'); process.exit(0); }
  console.log('=== INVOICE 69d184216d767f6489cc74e8 ===');
  console.log('Status:', inv.status);
  console.log('Guardian:', inv.guardian);
  console.log('Items:', inv.items?.length);
  for (const item of (inv.items || [])) {
    console.log('  Item:', JSON.stringify({ classId: item.class||item.lessonId, duration: item.duration, amount: item.amount, attended: item.attended, status: item.status, date: item.date }));
  }

  const guardian = await User.findById(inv.guardian).lean();
  if (guardian) {
    console.log('\n=== GUARDIAN ===');
    console.log('Name:', guardian.firstName, guardian.lastName);
    console.log('totalHours:', guardian.guardianInfo?.totalHours);
    console.log('cumulativeConsumedHours:', guardian.guardianInfo?.cumulativeConsumedHours);
    for (const s of (guardian.guardianInfo?.students || [])) {
      console.log('  Student:', s.firstName, s.lastName, '- hoursRemaining:', s.hoursRemaining);
    }
  }

  const allInvs = await Invoice.find({ guardian: inv.guardian, deleted: { $ne: true } }).sort({ createdAt: 1 }).lean();
  console.log('\n=== ALL INVOICES FOR GUARDIAN ===');
  let paidHours = 0;
  for (const i of allInvs) {
    const totalHrs = (i.items||[]).reduce((s,it) => s + (it.duration||0)/60, 0);
    console.log('Invoice:', i._id, '| status:', i.status, '| items:', i.items?.length, '| totalHrs:', totalHrs.toFixed(2), '| paidAmount:', i.paidAmount);
    if (i.status === 'paid') paidHours += totalHrs;
  }

  const classes = await Class.find({ 'student.guardianId': inv.guardian, status: { $nin: ['pattern'] } }).sort({ scheduledDate: 1 }).lean();
  console.log('\n=== ALL CLASSES FOR GUARDIAN ===');
  let countedHours = 0;
  for (const c of classes) {
    const counted = ['attended', 'missed_by_student'].includes(c.status);
    if (counted) countedHours += (c.duration||60)/60;
    console.log('Class:', c._id, '| status:', c.status, '| duration:', c.duration, '| date:', c.scheduledDate?.toISOString()?.slice(0,10), '| billedIn:', c.billedInInvoiceId);
  }

  console.log('\n=== CALCULATION ===');
  console.log('Paid invoice hours:', paidHours.toFixed(2));
  console.log('Counted hours (attended+missed_by_student):', countedHours.toFixed(2));
  console.log('Expected remaining (paid - counted):', (paidHours - countedHours).toFixed(2));
  console.log('Actual totalHours on guardian:', guardian?.guardianInfo?.totalHours);

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
