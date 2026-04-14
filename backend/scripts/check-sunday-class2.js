#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Search broadly: April 11 00:00 UTC to April 13 00:00 UTC
  const start = new Date('2026-04-11T00:00:00Z');
  const end = new Date('2026-04-13T23:59:59Z');
  
  // First: find all classes with "Sehrish" in teacher or student name
  const allClasses = await Class.find({
    date: { $gte: start, $lt: end },
    status: { $in: ['scheduled', 'attended'] }
  }).populate('teacher', 'firstName lastName')
    .populate('student', 'firstName lastName')
    .lean();

  console.log(`All scheduled/attended classes Apr 11-13: ${allClasses.length}`);
  for (const c of allClasses) {
    const d = new Date(c.date);
    const sn = c.student ? `${c.student.firstName} ${c.student.lastName}` : '?';
    const tn = c.teacher ? `${c.teacher.firstName} ${c.teacher.lastName}` : '?';
    if (sn.includes('Sehrish') || tn.includes('Sehrish') || c.subject?.match(/tajweed/i)) {
      console.log(JSON.stringify({
        id: c._id,
        date: c.date,
        isoDate: d.toISOString(),
        dayUTC: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()],
        time: d.toISOString().slice(11,16),
        subject: c.subject,
        student: sn,
        teacher: tn,
        status: c.status,
        duration: c.duration,
        recurrenceGroupId: c.recurrenceGroupId,
        isRecurring: c.isRecurring,
        startTime: c.startTime,
        timezone: c.timezone
      }, null, 2));
    }
  }

  // Also search by student name directly
  console.log('\n--- Direct student name search ---');
  const sehrish = await Class.find({
    date: { $gte: new Date('2026-04-01'), $lt: new Date('2026-04-30') }
  }).populate('teacher', 'firstName lastName')
    .populate('student', 'firstName lastName')
    .lean();
  
  const filtered = sehrish.filter(c => {
    const sn = c.student ? `${c.student.firstName} ${c.student.lastName}` : '';
    return sn.includes('Sehrish');
  });
  
  console.log(`Sehrish classes in April: ${filtered.length}`);
  for (const c of filtered) {
    const d = new Date(c.date);
    console.log(`  ${d.toISOString().slice(0,10)} ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]} ${d.toISOString().slice(11,16)} - ${c.subject} status=${c.status} rgId=${c.recurrenceGroupId || 'none'}`);
  }

  // If we find a recurrenceGroupId, show its config
  if (filtered.length > 0) {
    const rgId = filtered[0].recurrenceGroupId;
    if (rgId) {
      console.log(`\n--- Recurrence group ${rgId} full config ---`);
      const first = await Class.findOne({ recurrenceGroupId: rgId }).sort({ date: 1 }).select('date recurrenceRule recurrenceDays schedule slots startTime timezone').lean();
      console.log(JSON.stringify(first, null, 2));
      
      // Show all unique days of week in this group
      const allInGroup = await Class.find({ recurrenceGroupId: rgId }).select('date status').lean();
      const dayMap = {};
      allInGroup.forEach(c => {
        const d = new Date(c.date);
        const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()];
        if (!dayMap[day]) dayMap[day] = 0;
        dayMap[day]++;
      });
      console.log('Day distribution:', JSON.stringify(dayMap));
      console.log(`Total classes in group: ${allInGroup.length}`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
