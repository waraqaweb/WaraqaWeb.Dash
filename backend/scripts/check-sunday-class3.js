#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Class = require('../models/Class');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Search using scheduledDate instead of date
  const start = new Date('2026-04-11T00:00:00Z');
  const end = new Date('2026-04-13T23:59:59Z');

  const cls = await Class.find({
    scheduledDate: { $gte: start, $lt: end }
  }).populate('teacher', 'firstName lastName')
    .populate('student', 'firstName lastName')
    .lean();

  console.log(`Classes by scheduledDate Apr 11-13: ${cls.length}`);
  for (const c of cls) {
    const sd = new Date(c.scheduledDate);
    const d = c.date ? new Date(c.date) : null;
    const sn = c.student ? `${c.student.firstName} ${c.student.lastName}` : '?';
    const tn = c.teacher ? `${c.teacher.firstName} ${c.teacher.lastName}` : '?';
    console.log(`  ${sd.toISOString()} ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][sd.getUTCDay()]} | ${sn} — ${c.subject} (${tn}) status=${c.status} dur=${c.duration}`);
    if (sn.includes('Sehrish') || c.subject?.match(/tajweed/i)) {
      console.log('    >>> MATCH! Full details:');
      console.log(JSON.stringify({
        id: c._id,
        scheduledDate: c.scheduledDate,
        date: c.date,
        startTime: c.startTime,
        endTime: c.endTime,
        timezone: c.timezone,
        recurrenceGroupId: c.recurrenceGroupId,
        recurrenceDays: c.recurrenceDays,
        recurrenceRule: c.recurrenceRule,
        isRecurring: c.isRecurring,
        status: c.status,
        reportSubmission: c.reportSubmission
      }, null, 2));
    }
  }

  // Also search April by student name pattern
  console.log('\n--- All Sehrish/Tajweed classes in April 2026 (scheduledDate) ---');
  const april = await Class.find({
    scheduledDate: { $gte: new Date('2026-04-01'), $lt: new Date('2026-04-30') }
  }).populate('teacher', 'firstName lastName')
    .populate('student', 'firstName lastName')
    .lean();

  const matches = april.filter(c => {
    const sn = c.student ? `${c.student.firstName} ${c.student.lastName}` : '';
    return sn.includes('Sehrish') || (c.subject && c.subject.match(/tajweed/i));
  });

  console.log(`Matched: ${matches.length}`);
  for (const c of matches) {
    const sd = new Date(c.scheduledDate);
    console.log(`  ${sd.toISOString().slice(0,10)} ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][sd.getUTCDay()]} ${sd.toISOString().slice(11,16)} ${c.subject} status=${c.status} rgId=${c.recurrenceGroupId || 'none'}`);
  }

  // If we found a recurrence group, show its slot config
  if (matches.length > 0 && matches[0].recurrenceGroupId) {
    const rgId = matches[0].recurrenceGroupId;
    console.log(`\n--- Recurrence group ${rgId} ---`);
    const allInGroup = await Class.find({ recurrenceGroupId: rgId }).sort({ scheduledDate: 1 }).select('scheduledDate date startTime status recurrenceDays').lean();
    const dayMap = {};
    for (const c of allInGroup) {
      const sd = new Date(c.scheduledDate);
      const day = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][sd.getUTCDay()];
      if (!dayMap[day]) dayMap[day] = 0;
      dayMap[day]++;
    }
    console.log('Day distribution (UTC):', JSON.stringify(dayMap));
    console.log(`Total: ${allInGroup.length}`);
    
    // Show recurrenceDays from first class
    console.log('recurrenceDays:', JSON.stringify(allInGroup[0].recurrenceDays));
    
    // Show last 10 classes
    console.log('Last 10:');
    const last10 = allInGroup.slice(-10);
    for (const c of last10) {
      const sd = new Date(c.scheduledDate);
      console.log(`  ${sd.toISOString()} ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][sd.getUTCDay()]} start=${c.startTime} status=${c.status}`);
    }
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
