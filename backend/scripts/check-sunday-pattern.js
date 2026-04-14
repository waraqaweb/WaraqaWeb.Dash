#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Get the specific pattern class on Sunday
  const cls = await Class.findById('69db6bf90583ebb6b6643e40')
    .populate('teacher', 'firstName lastName')
    .lean();

  if (!cls) {
    console.log('Class not found by ID, searching...');
    const found = await Class.findOne({
      scheduledDate: new Date('2026-04-12T08:30:00.000Z'),
      status: 'pattern'
    }).lean();
    console.log('Found:', JSON.stringify(found, null, 2));
    process.exit(0);
  }

  console.log('=== Pattern class full dump ===');
  console.log(JSON.stringify(cls, null, 2));

  // Check: what is the recurrence config?
  console.log('\n=== Recurrence fields ===');
  console.log('recurrenceDays:', cls.recurrenceDays);
  console.log('recurrenceRule:', cls.recurrenceRule);
  console.log('schedule:', JSON.stringify(cls.schedule, null, 2));
  console.log('slots:', JSON.stringify(cls.slots, null, 2));
  console.log('isRecurring:', cls.isRecurring);
  console.log('recurrenceGroupId:', cls.recurrenceGroupId);
  console.log('timezone:', cls.timezone);

  // Also check: how many classes were generated from this pattern?
  if (cls.recurrenceGroupId) {
    const generated = await Class.find({ recurrenceGroupId: cls.recurrenceGroupId, status: { $ne: 'pattern' } }).countDocuments();
    console.log(`\nGenerated instances from this pattern: ${generated}`);
  }

  // Find the student details
  console.log('\n=== Student ===');
  console.log(JSON.stringify(cls.student, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
