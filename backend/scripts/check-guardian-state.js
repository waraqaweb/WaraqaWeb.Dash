const mongoose = require('mongoose');
const User = require('../models/User');
const Invoice = require('../models/Invoice');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb_test');
  
  const g = await User.findOne({ role: 'guardian', 'guardianInfo.students.firstName': 'Malak' }).lean();
  if (!g) { console.log('Guardian Khaled not found'); process.exit(0); }
  
  console.log('=== GUARDIAN ===');
  console.log('Name:', g.firstName, g.lastName);
  console.log('totalHours:', g.guardianInfo.totalHours);
  console.log('autoTotalHours:', g.autoTotalHours);
  console.log('cumulativeConsumedHours:', g.guardianInfo.cumulativeConsumedHours);
  console.log('');
  
  console.log('=== STUDENTS ===');
  for (const s of g.guardianInfo.students) {
    console.log(' ', s.firstName, s.lastName, '- hoursRemaining:', s.hoursRemaining);
  }
  console.log('');
  
  console.log('=== INVOICES ===');
  const invs = await Invoice.find({ guardian: g._id, deleted: { $ne: true } }).lean();
  for (const inv of invs) {
    const totalMins = (inv.items || []).reduce((a, it) => a + (it.duration || 0), 0);
    console.log('Invoice:', inv._id);
    console.log('  status:', inv.status, '| items:', inv.items?.length, '| totalMins:', totalMins, '| totalHrs:', (totalMins / 60).toFixed(2));
    console.log('  paidAmount:', inv.paidAmount, '| subtotal:', inv.subtotal, '| total:', inv.total);
    console.log('  adjustments:', (inv.adjustments || []).length);
    console.log('  Items:');
    for (const it of (inv.items || [])) {
      console.log('    class:', it.class, '| duration:', it.duration, '| amount:', it.amount, '| status:', it.status);
    }
  }
  
  // Check classes
  const Class = require('../models/Class');
  const classes = await Class.find({ 'student.guardianId': g._id, status: { $ne: 'pattern' } }).sort({ scheduledDate: 1 }).lean();
  console.log('\n=== CLASSES ===');
  for (const c of classes) {
    console.log(' ', c._id, '|', c.scheduledDate?.toISOString()?.slice(0, 10), '| duration:', c.duration, '| status:', c.status);
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
