#!/usr/bin/env node

/**
 * Repair teacher monthly hours for the current month.
 *
 * The monthly invoice job previously zeroed monthlyHours instead of subtracting
 * the invoiced amount. Any classes reported between midnight and the job run
 * (00:05 Cairo on the 1st) had their hours lost.
 *
 * This script:
 *  1. Finds all active teachers
 *  2. For each, aggregates countable classes for the current calendar month (UTC)
 *  3. Compares with stored monthlyHours
 *  4. If mismatch, patches the teacher doc
 *
 * Usage:
 *   DRY_RUN=1 node backend/scripts/repair-teacher-monthly-hours.js
 *   node backend/scripts/repair-teacher-monthly-hours.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/waraqa';
const DRY_RUN = process.env.DRY_RUN === '1';

async function main() {
  console.log(`[repair-teacher-hours] Connecting to ${MONGO_URI.replace(/\/\/[^@]*@/, '//***@')} ...`);
  await mongoose.connect(MONGO_URI);

  const User = require('../models/User');
  const Class = require('../models/Class');

  const now = dayjs.utc();
  const startOfMonth = now.startOf('month').toDate();
  const endOfMonth = now.add(1, 'month').startOf('month').toDate();

  console.log(`[repair-teacher-hours] Current month range: ${startOfMonth.toISOString()} — ${endOfMonth.toISOString()}`);
  console.log(`[repair-teacher-hours] DRY_RUN=${DRY_RUN}\n`);

  const teachers = await User.find({ role: 'teacher', disabled: { $ne: true } })
    .select('firstName lastName teacherInfo')
    .exec();

  console.log(`[repair-teacher-hours] Found ${teachers.length} active teachers\n`);

  const COUNTABLE = ['attended', 'missed_by_student', 'completed', 'absent'];
  let fixedCount = 0;

  for (const teacher of teachers) {
    const classes = await Class.find({
      teacher: teacher._id,
      scheduledDate: { $gte: startOfMonth, $lt: endOfMonth },
      status: { $in: COUNTABLE },
      deleted: { $ne: true }
    }).select('duration scheduledDate status subject').lean();

    const actualHours = Math.round(
      classes.reduce((sum, c) => sum + (Number(c.duration || 0) / 60), 0) * 1000
    ) / 1000;

    const storedHours = Math.round((teacher.teacherInfo?.monthlyHours || 0) * 1000) / 1000;

    const name = `${teacher.firstName} ${teacher.lastName}`.trim();
    const diff = Math.round((actualHours - storedHours) * 1000) / 1000;

    if (Math.abs(diff) >= 0.001) {
      console.log(`⚠️  ${name} (${teacher._id}): stored=${storedHours}h, actual=${actualHours}h, diff=${diff > 0 ? '+' : ''}${diff}h  [${classes.length} classes]`);

      if (!DRY_RUN) {
        teacher.teacherInfo = teacher.teacherInfo || {};
        teacher.teacherInfo.monthlyHours = actualHours;
        teacher.teacherInfo.monthlyRate = typeof teacher.calculateMonthlyRate === 'function' ? teacher.calculateMonthlyRate() : 0;
        teacher.teacherInfo.monthlyEarnings = actualHours * (teacher.teacherInfo.monthlyRate || 0) + (teacher.teacherInfo.bonus || 0);
        await teacher.save();
        console.log(`   ✅ Fixed → ${actualHours}h`);
      } else {
        console.log(`   🔍 (dry run — would fix to ${actualHours}h)`);
      }
      fixedCount++;
    } else {
      console.log(`✅ ${name}: stored=${storedHours}h, actual=${actualHours}h — OK`);
    }
  }

  console.log(`\n[repair-teacher-hours] Done. ${fixedCount} teacher(s) ${DRY_RUN ? 'would be' : 'were'} fixed.`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[repair-teacher-hours] Fatal:', err);
  process.exit(1);
});
