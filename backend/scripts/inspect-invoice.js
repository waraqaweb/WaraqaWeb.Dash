const mongoose = require('mongoose');
const TeacherInvoice = require('../models/TeacherInvoice');
const Class = require('../models/Class');

const INVOICE_ID = process.argv[2] || '69cc450deddfcdc651a5f8f5';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqa');
  const inv = await TeacherInvoice.findById(INVOICE_ID);
  if (!inv) { console.log('NOT FOUND'); process.exit(0); }

  console.log('Invoice:', inv.invoiceNumber);
  console.log('Teacher:', inv.teacher);
  console.log('Month/Year:', inv.month + '/' + inv.year);
  console.log('Status:', inv.status);
  console.log('totalHours (stored):', inv.totalHours);
  console.log('monthlyHoursSnapshot:', inv.monthlyHoursSnapshot);
  console.log('classIds count:', (inv.classIds || []).length);

  const classIds = inv.classIds || [];
  const classes = await Class.find({ _id: { $in: classIds } }).select('_id duration status student dateTime');
  console.log('Classes found:', classes.length);

  const totalMinutes = classes.reduce((sum, c) => sum + (Number(c.duration) || 0), 0);
  console.log('Computed hours from classes:', (totalMinutes / 60).toFixed(2));

  const foundIds = new Set(classes.map(c => c._id.toString()));
  const missing = classIds.filter(id => !foundIds.has(id.toString()));
  console.log('Missing class IDs:', missing.length);
  if (missing.length > 0) {
    console.log('Missing IDs:', missing.map(String).join(', '));
  }

  const durations = {};
  classes.forEach(c => {
    const d = Number(c.duration) || 0;
    durations[d] = (durations[d] || 0) + 1;
  });
  console.log('Duration breakdown:', JSON.stringify(durations));

  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
