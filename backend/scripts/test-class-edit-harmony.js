/**
 * End-to-end test: verifies that editing class duration on a reported class
 * correctly updates teacher hours, guardian hours, and invoice in harmony.
 * Also tests cross-month teacher adjustments and countable→countable transitions.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const TeacherInvoice = require('../models/TeacherInvoice');

const PASS = 'PASS';
const FAIL = 'FAIL';
let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  const a = typeof actual === 'number' ? Math.round(actual * 10000) / 10000 : actual;
  const e = typeof expected === 'number' ? Math.round(expected * 10000) / 10000 : expected;
  if (a === e) {
    console.log(`  [${PASS}] ${label}: ${a}`);
    passed++;
  } else {
    console.log(`  [${FAIL}] ${label}: expected ${e}, got ${a}`);
    failed++;
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb_test');
  console.log('Connected\n');

  // Clear any leftover invoices from previous test runs
  await Invoice.deleteMany({});

  const guardian = await User.findOne({ role: 'guardian', firstName: 'Khaled' });
  const teacher = await User.findOne({ role: 'teacher', firstName: 'Lamiaa' });
  if (!guardian || !teacher) { console.log('Seed data not found'); process.exit(1); }

  const malak = guardian.guardianInfo.students.find(s => s.firstName === 'Malak');
  const hourlyRate = guardian.guardianInfo.hourlyRate || 14;

  const classes = await Class.find({
    'student.guardianId': guardian._id,
    status: 'scheduled'
  }).sort({ scheduledDate: 1 }).limit(3);

  if (classes.length < 3) { console.log('Need at least 3 classes'); process.exit(1); }

  // Create a paid invoice with 3 classes
  console.log('=== SETUP: Create paid invoice with 3 classes ===');
  const items = classes.map(c => ({
    class: c._id, lessonId: c._id, student: malak._id,
    studentName: malak.firstName + ' ' + malak.lastName,
    teacher: teacher._id, teacherName: teacher.firstName + ' ' + teacher.lastName,
    subject: c.subject, description: c.subject || 'Class',
    date: c.scheduledDate, duration: c.duration,
    rate: hourlyRate, amount: Math.round((c.duration / 60) * hourlyRate * 100) / 100,
    attended: false, status: c.status
  }));
  const totalHours = items.reduce((s, it) => s + (it.duration / 60), 0);
  const subtotal = Math.round(totalHours * hourlyRate * 100) / 100;

  const now = new Date();
  const startDate = classes[0].scheduledDate;
  const endDate = classes[2].scheduledDate;

  const invoice = await Invoice.create({
    guardian: guardian._id, invoiceName: 'Test Invoice',
    invoiceNumber: 'TEST-001', invoiceSlug: 'test-001-' + Date.now(),
    type: 'guardian_invoice',
    dueDate: new Date(now.getTime() + 30 * 86400000),
    items, hourlyRate, subtotal, total: subtotal,
    paidAmount: subtotal, paidHours: totalHours, status: 'paid',
    billingPeriod: {
      start: startDate, end: endDate,
      startDate: startDate, endDate: endDate,
      month: startDate.getMonth() + 1,
      year: startDate.getFullYear()
    },
    currency: 'USD'
  });

  for (const c of classes) {
    await Class.updateOne({ _id: c._id }, { $set: { billedInInvoiceId: invoice._id } });
  }

  // Credit hours to guardian
  malak.hoursRemaining = (malak.hoursRemaining || 0) + totalHours;
  guardian.guardianInfo.totalHours = (guardian.guardianInfo.totalHours || 0) + totalHours;
  guardian.markModified('guardianInfo');
  await guardian.save();

  console.log('  Items: ' + items.map(it => it.duration + 'min').join(', '));
  console.log('  Total: ' + totalHours.toFixed(4) + 'h, $' + subtotal);
  console.log('');

  // Baseline
  const g0 = await User.findById(guardian._id).lean();
  const t0 = await User.findById(teacher._id).lean();
  const baseTeacher = t0.teacherInfo.monthlyHours || 0;
  const baseGuardian = g0.guardianInfo.totalHours;
  const baseMalak = g0.guardianInfo.students.find(s => s.firstName === 'Malak').hoursRemaining;

  const testClass = classes[0];
  const origDur = testClass.duration;
  const origHrs = origDur / 60;

  // STEP 1: Mark class as attended
  console.log('=== STEP 1: Mark class as attended (' + origDur + 'min) ===');
  const c1 = await Class.findById(testClass._id);
  c1.status = 'attended';
  c1.wasReportSubmitted = true;
  await c1.save();
  await new Promise(r => setTimeout(r, 1500));

  const g1 = await User.findById(guardian._id).lean();
  const t1 = await User.findById(teacher._id).lean();
  assert('Teacher hours after attend', t1.teacherInfo.monthlyHours, baseTeacher + origHrs);
  assert('Guardian hours after attend', g1.guardianInfo.totalHours, baseGuardian - origHrs);
  assert('Malak hours after attend', g1.guardianInfo.students.find(s => s.firstName === 'Malak').hoursRemaining, baseMalak - origHrs);
  console.log('');

  // STEP 2: Change duration 55 -> 60
  const dur2 = 60;
  const diff2 = (dur2 - origDur) / 60;
  console.log('=== STEP 2: Duration ' + origDur + ' -> ' + dur2 + 'min (diff: ' + (diff2 > 0 ? '+' : '') + diff2.toFixed(4) + 'h) ===');
  const c2 = await Class.findById(testClass._id);
  c2.duration = dur2;
  await c2.save();
  await new Promise(r => setTimeout(r, 2000));

  const g2 = await User.findById(guardian._id).lean();
  const t2 = await User.findById(teacher._id).lean();
  const inv2 = await Invoice.findById(invoice._id).lean();
  const item2 = inv2.items.find(it => String(it.class) === String(testClass._id));

  assert('Teacher hours after dur change', t2.teacherInfo.monthlyHours, baseTeacher + origHrs + diff2);
  assert('Guardian hours after dur change', g2.guardianInfo.totalHours, baseGuardian - origHrs - diff2);
  assert('Malak hours after dur change', g2.guardianInfo.students.find(s => s.firstName === 'Malak').hoursRemaining, baseMalak - origHrs - diff2);
  assert('Invoice item duration', item2.duration, dur2);
  assert('Invoice item amount', item2.amount, Math.round((dur2 / 60) * hourlyRate * 100) / 100);
  console.log('');

  // STEP 3: Formula check — guardian balance = original credit - total consumed
  // Original credit was totalHours (2.75h), consumed is the attended class's current duration
  console.log('=== STEP 3: Verify guardian.totalHours = originalCredit - consumedHours ===');
  const consumedCls = await Class.find({ 'student.guardianId': guardian._id, status: { $in: ['attended', 'missed_by_student'] } }).lean();
  const consumedHrs = consumedCls.reduce((s, c) => s + (c.duration || 0) / 60, 0);
  const originalCredit = totalHours; // The hours we credited at payment time
  const expected = Math.round((originalCredit - consumedHrs) * 10000) / 10000;
  const actual = Math.round((g2.guardianInfo.totalHours || 0) * 10000) / 10000;
  console.log('  Original credit: ' + originalCredit.toFixed(4) + 'h | Consumed: ' + consumedHrs.toFixed(4) + 'h');
  assert('Formula: totalHours = credit - consumed', actual, expected);
  console.log('');

  // STEP 4: Change duration again 60 -> 45
  const dur3 = 45;
  const diff3 = (dur3 - dur2) / 60;
  console.log('=== STEP 4: Duration ' + dur2 + ' -> ' + dur3 + 'min (diff: ' + (diff3 > 0 ? '+' : '') + diff3.toFixed(4) + 'h) ===');
  const c3 = await Class.findById(testClass._id);
  c3.duration = dur3;
  await c3.save();
  await new Promise(r => setTimeout(r, 2000));

  const g3 = await User.findById(guardian._id).lean();
  const t3 = await User.findById(teacher._id).lean();
  const inv3 = await Invoice.findById(invoice._id).lean();
  const item3 = inv3.items.find(it => String(it.class) === String(testClass._id));

  assert('Teacher hours after 2nd change', t3.teacherInfo.monthlyHours, baseTeacher + origHrs + diff2 + diff3);
  assert('Guardian hours after 2nd change', g3.guardianInfo.totalHours, baseGuardian - origHrs - diff2 - diff3);
  assert('Malak hours after 2nd change', g3.guardianInfo.students.find(s => s.firstName === 'Malak').hoursRemaining, baseMalak - origHrs - diff2 - diff3);
  assert('Invoice item duration 2nd', item3.duration, dur3);
  console.log('');

  // Final formula verification
  console.log('=== FINAL: Re-verify formula ===');
  const fc = await Class.find({ 'student.guardianId': guardian._id, status: { $in: ['attended', 'missed_by_student'] } }).lean();
  const fch = fc.reduce((s, c) => s + (c.duration || 0) / 60, 0);
  const fe = Math.round((totalHours - fch) * 10000) / 10000;
  const fa = Math.round((g3.guardianInfo.totalHours || 0) * 10000) / 10000;
  console.log('  Credit: ' + totalHours.toFixed(4) + 'h | Consumed: ' + fch.toFixed(4) + 'h | Expected: ' + fe + ' | Actual: ' + fa);
  assert('Final: credit - consumed', fa, fe);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: attended → missed_by_student (countable → countable)
  // Hours should NOT change (both statuses are equally countable)
  // ═══════════════════════════════════════════════════════════════
  console.log('=== STEP 5: Status change attended → missed_by_student ===');
  const t_before = await User.findById(teacher._id).lean();
  const g_before = await User.findById(guardian._id).lean();
  const tHrsBefore = t_before.teacherInfo.monthlyHours;
  const gHrsBefore = g_before.guardianInfo.totalHours;
  const mHrsBefore = g_before.guardianInfo.students.find(s => s.firstName === 'Malak').hoursRemaining;

  const c5 = await Class.findById(testClass._id);
  c5.status = 'missed_by_student';
  await c5.save();
  await new Promise(r => setTimeout(r, 1500));

  const t5 = await User.findById(teacher._id).lean();
  const g5 = await User.findById(guardian._id).lean();
  assert('Teacher hrs unchanged (countable→countable)', t5.teacherInfo.monthlyHours, tHrsBefore);
  assert('Guardian hrs unchanged (countable→countable)', g5.guardianInfo.totalHours, gHrsBefore);
  assert('Malak hrs unchanged (countable→countable)', g5.guardianInfo.students.find(s => s.firstName === 'Malak').hoursRemaining, mHrsBefore);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 6: missed_by_student → attended (back to attended)
  // Still countable→countable, hours shouldn't change
  // ═══════════════════════════════════════════════════════════════
  console.log('=== STEP 6: Status change missed_by_student → attended ===');
  const c6 = await Class.findById(testClass._id);
  c6.status = 'attended';
  await c6.save();
  await new Promise(r => setTimeout(r, 1500));

  const t6 = await User.findById(teacher._id).lean();
  const g6 = await User.findById(guardian._id).lean();
  assert('Teacher hrs still unchanged', t6.teacherInfo.monthlyHours, tHrsBefore);
  assert('Guardian hrs still unchanged', g6.guardianInfo.totalHours, gHrsBefore);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 7: Cross-month teacher adjustment test
  // Create a class in a past month, attend it, then change duration.
  // Teacher monthlyHours should NOT change (it's a different month).
  // Instead, a pending cross-month adjustment should be stored.
  // ═══════════════════════════════════════════════════════════════
  console.log('=== STEP 7: Cross-month class duration change ===');
  const pastDate = new Date();
  pastDate.setMonth(pastDate.getMonth() - 2);
  pastDate.setDate(15);

  // Clear any existing teacher invoices
  await TeacherInvoice.deleteMany({});

  const crossMonthClass = await Class.create({
    title: 'Cross Month Test',
    subject: 'Arabic Conversation',
    teacher: teacher._id,
    student: { guardianId: guardian._id, studentId: malak._id, studentName: 'Malak Mostafa' },
    scheduledDate: pastDate,
    duration: 60,
    timezone: 'Africa/Cairo',
    status: 'scheduled',
    createdBy: guardian._id
  });

  // Mark attended (this is a past-month class becoming countable for the first time)
  const cm1 = await Class.findById(crossMonthClass._id);
  cm1.status = 'attended';
  cm1.wasReportSubmitted = true;
  await cm1.save();
  await new Promise(r => setTimeout(r, 1500));

  const t7a = await User.findById(teacher._id).lean();
  const tHrsAfterCrossAttend = t7a.teacherInfo.monthlyHours;
  // For first attend on cross-month class: should record cross-month adjustment, NOT touch monthlyHours
  console.log('  Teacher monthlyHours after cross-month attend: ' + tHrsAfterCrossAttend);
  assert('Teacher monthlyHours unchanged (cross-month attend)', tHrsAfterCrossAttend, tHrsBefore);

  // Now change duration on the cross-month class
  const cm2 = await Class.findById(crossMonthClass._id);
  cm2.duration = 45;
  await cm2.save();
  await new Promise(r => setTimeout(r, 1500));

  const t7b = await User.findById(teacher._id).lean();
  assert('Teacher monthlyHours still unchanged (cross-month dur change)', t7b.teacherInfo.monthlyHours, tHrsBefore);

  // Check pending adjustments stored
  const pending = t7b.teacherInfo.pendingCrossMonthAdjustments || [];
  const unapplied = pending.filter(p => !p.appliedAt);
  console.log('  Pending cross-month adjustments: ' + unapplied.length);
  assert('Has pending cross-month adjustments', unapplied.length >= 1, true);

  // Guardian hours should STILL be adjusted (no monthly reset for guardians)
  const g7 = await User.findById(guardian._id).lean();
  console.log('  Guardian totalHours after cross-month changes: ' + g7.guardianInfo.totalHours);
  console.log('');

  // ═══════════════════════════════════════════════════════════════
  // STEP 8: attended → cancelled (countable → non-countable)
  // Should use PREVIOUS duration (45 min) to undo, not current
  // ═══════════════════════════════════════════════════════════════
  console.log('=== STEP 8: attended → cancelled (undo uses prev duration) ===');
  const g_pre8 = await User.findById(guardian._id).lean();
  const gPre8 = g_pre8.guardianInfo.totalHours;

  const c8 = await Class.findById(testClass._id);
  const durBefore8 = c8.duration; // 45 min from step 4
  c8.status = 'cancelled_by_teacher';
  await c8.save();
  await new Promise(r => setTimeout(r, 1500));

  const g8 = await User.findById(guardian._id).lean();
  // Should get back durBefore8/60 hours (the PREVIOUS duration, not some other value)
  const expectedG8 = Math.round((gPre8 + durBefore8 / 60) * 10000) / 10000;
  assert('Guardian hours after cancel (undo prev dur)', Math.round(g8.guardianInfo.totalHours * 10000) / 10000, expectedG8);
  console.log('');

  // Cleanup cross-month class
  await Class.deleteOne({ _id: crossMonthClass._id });

  console.log('\n' + '='.repeat(50));
  console.log('RESULTS: ' + passed + ' passed, ' + failed + ' failed');
  console.log('='.repeat(50));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
