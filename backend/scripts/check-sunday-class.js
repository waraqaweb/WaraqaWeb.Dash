#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Find Tajweed Basics classes on April 12 2026 (Sunday)
  const start = new Date('2026-04-12T00:00:00Z');
  const end = new Date('2026-04-13T00:00:00Z');
  const cls = await Class.find({
    date: { $gte: start, $lt: end },
    subject: /tajweed/i
  }).populate('teacher', 'firstName lastName')
    .populate('student', 'firstName lastName')
    .lean();

  console.log(`Found ${cls.length} Tajweed classes on Apr 12:`);
  for (const c of cls) {
    const d = new Date(c.date);
    console.log(JSON.stringify({
      id: c._id,
      date: c.date,
      dayName: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()],
      dayOfWeekUTC: d.getUTCDay(),
      subject: c.subject,
      student: c.student ? `${c.student.firstName} ${c.student.lastName}` : null,
      teacher: c.teacher ? `${c.teacher.firstName} ${c.teacher.lastName}` : null,
      status: c.status,
      duration: c.duration,
      recurrenceGroupId: c.recurrenceGroupId,
      isRecurring: c.isRecurring
    }, null, 2));

    // Now find the recurrence group config
    if (c.recurrenceGroupId) {
      // Find the first class in this recurrence group to get the schedule
      const first = await Class.findOne({ recurrenceGroupId: c.recurrenceGroupId })
        .sort({ date: 1 }).lean();
      console.log('\n--- First class in recurrence group ---');
      console.log(JSON.stringify({
        firstDate: first.date,
        firstDayName: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(first.date).getUTCDay()],
        recurrenceRule: first.recurrenceRule,
        recurrenceDays: first.recurrenceDays,
        schedule: first.schedule,
        slots: first.slots
      }, null, 2));

      // Show all classes in the group around Apr 12
      const nearby = await Class.find({
        recurrenceGroupId: c.recurrenceGroupId,
        date: { $gte: new Date('2026-04-05T00:00:00Z'), $lte: new Date('2026-04-19T00:00:00Z') }
      }).sort({ date: 1 }).lean();
      console.log('\n--- Nearby classes in recurrence group (Apr 5-19) ---');
      for (const n of nearby) {
        const nd = new Date(n.date);
        console.log(`  ${nd.toISOString().slice(0,10)} ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][nd.getUTCDay()]} ${nd.toISOString().slice(11,16)} status=${n.status}`);
      }
    }
  }

  // If no results, try broader search
  if (cls.length === 0) {
    console.log('\nTrying broader search for Sehrish Imdad...');
    const broader = await Class.find({
      date: { $gte: start, $lt: end }
    }).populate('teacher', 'firstName lastName')
      .populate('student', 'firstName lastName')
      .lean();
    console.log(`Total classes on Apr 12: ${broader.length}`);
    for (const c of broader) {
      const sn = c.student ? `${c.student.firstName} ${c.student.lastName}` : '?';
      const tn = c.teacher ? `${c.teacher.firstName} ${c.teacher.lastName}` : '?';
      console.log(`  ${sn} — ${c.subject} (${tn}) status=${c.status}`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
