#!/usr/bin/env node
// backend/scripts/seed-payment-link-test.js
// ============================================================
// Seeds a LOCAL test database with realistic invoice/class data
// for testing the PaymentLink credit-pool system.
//
// Usage:
//   node backend/scripts/seed-payment-link-test.js
//
// This script:
//   1. Connects to a SEPARATE test database (waraqadb_test)
//   2. Wipes existing test data
//   3. Creates 3 guardians, 2 teachers, multiple students
//   4. Creates invoices in various states (paid, draft, pending)
//   5. Creates classes in various states (attended, scheduled, cancelled, etc.)
//   6. Includes edge cases: split coverage, overage, partial attendance
//
// After seeding, run:  node backend/scripts/test-payment-links.js
// ============================================================

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ── Models ──
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const PaymentLink = require('../models/PaymentLink');

const TEST_DB = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb_test';
const TIMEZONE = 'Africa/Cairo';

// ── Helpers ──
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 0, 0, 0);
  return d;
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(10, 0, 0, 0);
  return d;
}

function monthStart(monthsAgo = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthEnd(monthsAgo = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo + 1, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

function nextMonthStart() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function nextMonthEnd() {
  const d = new Date();
  d.setMonth(d.getMonth() + 2, 0);
  d.setHours(23, 59, 59, 999);
  return d;
}

async function hashPassword(pw) {
  return bcrypt.hash(pw, 10);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log(`\n🔗 Connecting to ${TEST_DB} …`);
  await mongoose.connect(TEST_DB);
  console.log('✅ Connected\n');

  // ── Wipe ──
  console.log('🧹 Wiping test collections …');
  await Promise.all([
    User.deleteMany({}),
    Class.deleteMany({}),
    Invoice.deleteMany({}),
    PaymentLink.deleteMany({})
  ]);
  console.log('   Done\n');

  const pw = await hashPassword('Test@123');

  // ────────────────────────────────────────────
  // 1. ADMIN
  // ────────────────────────────────────────────
  const admin = await User.create({
    firstName: 'Admin', lastName: 'Test',
    email: 'admin@test.waraqa.co', password: pw,
    role: 'admin', isActive: true, isEmailVerified: true,
    timezone: TIMEZONE
  });
  console.log(`✅ Admin: ${admin.email}`);

  // ────────────────────────────────────────────
  // 2. TEACHERS
  // ────────────────────────────────────────────
  const teacher1 = await User.create({
    firstName: 'Ahmed', lastName: 'Teacher',
    email: 'ahmed.teacher@test.waraqa.co', password: pw,
    role: 'teacher', isActive: true, isEmailVerified: true,
    timezone: TIMEZONE,
    teacherInfo: {
      subjects: ['Quran'], hourlyRate: 8,
      monthlyHours: 0, monthlyEarnings: 0, bonus: 0,
      spokenLanguages: ['Arabic', 'English']
    }
  });

  const teacher2 = await User.create({
    firstName: 'Lamiaa', lastName: 'Teacher',
    email: 'lamiaa.teacher@test.waraqa.co', password: pw,
    role: 'teacher', isActive: true, isEmailVerified: true,
    timezone: TIMEZONE,
    teacherInfo: {
      subjects: ['Arabic'], hourlyRate: 10,
      monthlyHours: 0, monthlyEarnings: 0, bonus: 0,
      spokenLanguages: ['Arabic']
    }
  });
  console.log(`✅ Teachers: ${teacher1.email}, ${teacher2.email}`);

  // ────────────────────────────────────────────
  // 3. GUARDIANS + embedded students
  // ────────────────────────────────────────────
  // Guardian A: Mariam — 2 students, 4 classes/week, 2 paid invoices
  const guardianA = await User.create({
    firstName: 'Mariam', lastName: 'Guardian-A',
    email: 'mariam@test.waraqa.co', password: pw,
    role: 'guardian', isActive: true, isEmailVerified: true,
    timezone: TIMEZONE,
    guardianInfo: {
      relationship: 'mother', hourlyRate: 12,
      paymentMethod: 'bank_transfer',
      spokenLanguages: ['Arabic', 'English'],
      totalHours: 8, // 8 hours remaining (prepaid)
      students: [
        {
          firstName: 'Ali', lastName: 'A',
          grade: 'Grade 5', language: 'English',
          subjects: ['Quran'], gender: 'male',
          timezone: TIMEZONE, hoursRemaining: 4,
          dateOfBirth: new Date('2014-03-15')
        },
        {
          firstName: 'Huda', lastName: 'A',
          grade: 'Grade 3', language: 'English',
          subjects: ['Arabic'], gender: 'female',
          timezone: TIMEZONE, hoursRemaining: 4,
          dateOfBirth: new Date('2016-09-02')
        }
      ]
    }
  });

  // Guardian B: Khaled — 1 student, 2 classes/week, 1 paid invoice (near exhaustion)
  const guardianB = await User.create({
    firstName: 'Khaled', lastName: 'Guardian-B',
    email: 'khaled@test.waraqa.co', password: pw,
    role: 'guardian', isActive: true, isEmailVerified: true,
    timezone: TIMEZONE,
    guardianInfo: {
      relationship: 'father', hourlyRate: 14,
      paymentMethod: 'credit_card',
      spokenLanguages: ['Arabic'],
      totalHours: 2,
      students: [
        {
          firstName: 'Omar', lastName: 'B',
          grade: 'Grade 4', language: 'English',
          subjects: ['Quran'], gender: 'male',
          timezone: TIMEZONE, hoursRemaining: 2,
          dateOfBirth: new Date('2015-07-19')
        }
      ]
    }
  });

  // Guardian C: Fatima — 2 students, classes across 3 months, mix of paid/unpaid
  const guardianC = await User.create({
    firstName: 'Fatima', lastName: 'Guardian-C',
    email: 'fatima@test.waraqa.co', password: pw,
    role: 'guardian', isActive: true, isEmailVerified: true,
    timezone: TIMEZONE,
    guardianInfo: {
      relationship: 'mother', hourlyRate: 10,
      paymentMethod: 'bank_transfer',
      spokenLanguages: ['Arabic', 'English'],
      totalHours: 0, // exhausted
      students: [
        {
          firstName: 'Youssef', lastName: 'C',
          grade: 'Grade 6', language: 'Arabic',
          subjects: ['Quran', 'Arabic'], gender: 'male',
          timezone: TIMEZONE, hoursRemaining: 0,
          dateOfBirth: new Date('2013-11-05')
        },
        {
          firstName: 'Nour', lastName: 'C',
          grade: 'Grade 2', language: 'English',
          subjects: ['Arabic'], gender: 'female',
          timezone: TIMEZONE, hoursRemaining: 0,
          dateOfBirth: new Date('2017-04-12')
        }
      ]
    }
  });

  console.log(`✅ Guardians: ${guardianA.email}, ${guardianB.email}, ${guardianC.email}`);

  // Student references (shorthand)
  const sAli   = guardianA.guardianInfo.students[0];
  const sHuda  = guardianA.guardianInfo.students[1];
  const sOmar  = guardianB.guardianInfo.students[0];
  const sYoussef = guardianC.guardianInfo.students[0];
  const sNour  = guardianC.guardianInfo.students[1];

  // ────────────────────────────────────────────
  // 4. INVOICES
  // ────────────────────────────────────────────
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1;
  const prevYear = curMonth === 1 ? curYear - 1 : curYear;
  const nextMonth = curMonth === 12 ? 1 : curMonth + 1;
  const nextYear = curMonth === 12 ? curYear + 1 : curYear;

  // ── Guardian A invoices ──
  // Invoice A1: Last month, PAID, 4 hours credit @ $12/hr = $48
  const invA1 = await Invoice.create({
    invoiceNumber: 'TEST-A1',
    invoiceName: 'Mariam - Last Month',
    invoiceSlug: 'test-mariam-last-month',
    type: 'guardian_invoice',
    guardian: guardianA._id,
    billingPeriod: {
      startDate: monthStart(1), endDate: monthEnd(1),
      month: prevMonth, year: prevYear
    },
    items: [], // Items will be derived from PaymentLinks
    subtotal: 48, total: 48, currency: 'USD',
    status: 'paid', paidAmount: 48, paidDate: daysAgo(20),
    dueDate: daysAgo(25),
    creditHours: 4, // NEW FIELD
    guardianFinancial: { hourlyRate: 12 }
  });

  // Invoice A2: This month, PAID, 6 hours credit @ $12/hr = $72
  const invA2 = await Invoice.create({
    invoiceNumber: 'TEST-A2',
    invoiceName: 'Mariam - This Month',
    invoiceSlug: 'test-mariam-this-month',
    type: 'guardian_invoice',
    guardian: guardianA._id,
    billingPeriod: {
      startDate: monthStart(0), endDate: monthEnd(0),
      month: curMonth, year: curYear
    },
    items: [],
    subtotal: 72, total: 72, currency: 'USD',
    status: 'paid', paidAmount: 72, paidDate: daysAgo(5),
    dueDate: daysAgo(10),
    creditHours: 6,
    guardianFinancial: { hourlyRate: 12 }
  });

  // Invoice A3: Next month, DRAFT (unpaid), 4 hours expected
  const invA3 = await Invoice.create({
    invoiceNumber: 'TEST-A3',
    invoiceName: 'Mariam - Next Month',
    invoiceSlug: 'test-mariam-next-month',
    type: 'guardian_invoice',
    guardian: guardianA._id,
    billingPeriod: {
      startDate: nextMonthStart(), endDate: nextMonthEnd(),
      month: nextMonth, year: nextYear
    },
    items: [],
    subtotal: 48, total: 48, currency: 'USD',
    status: 'draft', paidAmount: 0,
    dueDate: daysFromNow(30),
    creditHours: 0, // unpaid = 0 credit
    guardianFinancial: { hourlyRate: 12 }
  });

  // ── Guardian B invoices ──
  // Invoice B1: This month, PAID, 3 hours credit (only has 2 hrs remaining, about to run out)
  const invB1 = await Invoice.create({
    invoiceNumber: 'TEST-B1',
    invoiceName: 'Khaled - This Month',
    invoiceSlug: 'test-khaled-this-month',
    type: 'guardian_invoice',
    guardian: guardianB._id,
    billingPeriod: {
      startDate: monthStart(0), endDate: monthEnd(0),
      month: curMonth, year: curYear
    },
    items: [],
    subtotal: 42, total: 42, currency: 'USD',
    status: 'paid', paidAmount: 42, paidDate: daysAgo(15),
    dueDate: daysAgo(20),
    creditHours: 3,
    guardianFinancial: { hourlyRate: 14 }
  });

  // ── Guardian C invoices ──
  // Invoice C1: 2 months ago, PAID, 4 hours @ $10 = $40
  const invC1 = await Invoice.create({
    invoiceNumber: 'TEST-C1',
    invoiceName: 'Fatima - 2 Months Ago',
    invoiceSlug: 'test-fatima-2months-ago',
    type: 'guardian_invoice',
    guardian: guardianC._id,
    billingPeriod: {
      startDate: monthStart(2), endDate: monthEnd(2),
      month: ((curMonth - 2 + 11) % 12) + 1,
      year: curMonth <= 2 ? curYear - 1 : curYear
    },
    items: [],
    subtotal: 40, total: 40, currency: 'USD',
    status: 'paid', paidAmount: 40, paidDate: daysAgo(55),
    dueDate: daysAgo(60),
    creditHours: 4,
    guardianFinancial: { hourlyRate: 10 }
  });

  // Invoice C2: Last month, PAID, 4 hours @ $10 = $40
  const invC2 = await Invoice.create({
    invoiceNumber: 'TEST-C2',
    invoiceName: 'Fatima - Last Month',
    invoiceSlug: 'test-fatima-last-month',
    type: 'guardian_invoice',
    guardian: guardianC._id,
    billingPeriod: {
      startDate: monthStart(1), endDate: monthEnd(1),
      month: prevMonth, year: prevYear
    },
    items: [],
    subtotal: 40, total: 40, currency: 'USD',
    status: 'paid', paidAmount: 40, paidDate: daysAgo(25),
    dueDate: daysAgo(30),
    creditHours: 4,
    guardianFinancial: { hourlyRate: 10 }
  });

  // Invoice C3: This month, PENDING (sent but not paid), 6 hours
  const invC3 = await Invoice.create({
    invoiceNumber: 'TEST-C3',
    invoiceName: 'Fatima - This Month',
    invoiceSlug: 'test-fatima-this-month',
    type: 'guardian_invoice',
    guardian: guardianC._id,
    billingPeriod: {
      startDate: monthStart(0), endDate: monthEnd(0),
      month: curMonth, year: curYear
    },
    items: [],
    subtotal: 60, total: 60, currency: 'USD',
    status: 'pending', paidAmount: 0,
    dueDate: daysFromNow(10),
    creditHours: 0, // unpaid
    guardianFinancial: { hourlyRate: 10 }
  });

  console.log(`✅ Invoices created: A1(paid), A2(paid), A3(draft), B1(paid), C1(paid), C2(paid), C3(pending)\n`);

  // ────────────────────────────────────────────
  // 5. CLASSES (the core test data)
  // ────────────────────────────────────────────

  const makeClass = (overrides) => ({
    title: 'Class Session',
    subject: 'Quran',
    timezone: TIMEZONE,
    hidden: false,
    createdBy: admin._id,
    ...overrides,
    endsAt: new Date((overrides.scheduledDate || new Date()).getTime() + (overrides.duration || 60) * 60000)
  });

  // ── Guardian A classes (Ali + Huda) ──
  // Last month: 4 attended classes = 4 hours total → should consume all of invA1 (4h credit)
  const clsA1 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianA._id, studentId: sAli._id, studentName: 'Ali A' },
    scheduledDate: daysAgo(28), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Ali - Week 1 last month'
  }));
  const clsA2 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianA._id, studentId: sAli._id, studentName: 'Ali A' },
    scheduledDate: daysAgo(21), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Ali - Week 2 last month'
  }));
  const clsA3 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianA._id, studentId: sHuda._id, studentName: 'Huda A' },
    scheduledDate: daysAgo(27), duration: 60, status: 'attended',
    subject: 'Arabic', description: 'Huda - Week 1 last month'
  }));
  const clsA4 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianA._id, studentId: sHuda._id, studentName: 'Huda A' },
    scheduledDate: daysAgo(20), duration: 60, status: 'attended',
    subject: 'Arabic', description: 'Huda - Week 2 last month'
  }));

  // This month: 3 attended + 1 scheduled + 1 EXTENDED (90 min)
  const clsA5 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianA._id, studentId: sAli._id, studentName: 'Ali A' },
    scheduledDate: daysAgo(14), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Ali - Week 1 this month'
  }));
  const clsA6 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianA._id, studentId: sAli._id, studentName: 'Ali A' },
    scheduledDate: daysAgo(7), duration: 90, status: 'attended', // EXTENDED: 1.5h
    subject: 'Quran', description: 'Ali - Week 2 this month (extended to 90 min)'
  }));
  const clsA7 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianA._id, studentId: sHuda._id, studentName: 'Huda A' },
    scheduledDate: daysAgo(13), duration: 60, status: 'attended',
    subject: 'Arabic', description: 'Huda - Week 1 this month'
  }));
  const clsA8 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianA._id, studentId: sHuda._id, studentName: 'Huda A' },
    scheduledDate: daysAgo(6), duration: 60, status: 'attended',
    subject: 'Arabic', description: 'Huda - Week 2 this month'
  }));
  // -- Scheduled future class (should be "projected")
  const clsA9 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianA._id, studentId: sAli._id, studentName: 'Ali A' },
    scheduledDate: daysFromNow(1), duration: 60, status: 'scheduled',
    subject: 'Quran', description: 'Ali - Upcoming class (scheduled)'
  }));
  // -- Another scheduled for next week
  const clsA10 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianA._id, studentId: sHuda._id, studentName: 'Huda A' },
    scheduledDate: daysFromNow(2), duration: 60, status: 'scheduled',
    subject: 'Arabic', description: 'Huda - Upcoming class (scheduled)'
  }));
  // -- Cancelled class (should NOT consume credit)
  const clsA11 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianA._id, studentId: sAli._id, studentName: 'Ali A' },
    scheduledDate: daysAgo(10), duration: 60, status: 'cancelled_by_student',
    subject: 'Quran', description: 'Ali - Cancelled class (should be excluded)'
  }));

  console.log(`✅ Guardian A: 11 classes (4 last month attended, 4 this month attended, 2 scheduled, 1 cancelled)`);

  // ── Guardian B classes (Omar) ──
  // This month: 2 attended (2h) + 2 scheduled (2h) = 4h needed, but only 3h credit
  const clsB1 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianB._id, studentId: sOmar._id, studentName: 'Omar B' },
    scheduledDate: daysAgo(12), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Omar - Week 1'
  }));
  const clsB2 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianB._id, studentId: sOmar._id, studentName: 'Omar B' },
    scheduledDate: daysAgo(5), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Omar - Week 2'
  }));
  const clsB3 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianB._id, studentId: sOmar._id, studentName: 'Omar B' },
    scheduledDate: daysFromNow(2), duration: 60, status: 'scheduled',
    subject: 'Quran', description: 'Omar - Upcoming 1'
  }));
  const clsB4 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianB._id, studentId: sOmar._id, studentName: 'Omar B' },
    scheduledDate: daysFromNow(9), duration: 60, status: 'scheduled',
    subject: 'Quran', description: 'Omar - Upcoming 2 (should be UNCOVERED)'
  }));

  console.log(`✅ Guardian B: 4 classes (2 attended, 2 scheduled) — 4h needed but only 3h credit`);

  // ── Guardian C classes (Youssef + Nour) ──
  // 2 months ago: 4 attended = 4h → exactly fills invC1 (4h credit)
  const clsC1 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianC._id, studentId: sYoussef._id, studentName: 'Youssef C' },
    scheduledDate: daysAgo(58), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Youssef - 2 months ago W1'
  }));
  const clsC2 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianC._id, studentId: sYoussef._id, studentName: 'Youssef C' },
    scheduledDate: daysAgo(51), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Youssef - 2 months ago W2'
  }));
  const clsC3 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianC._id, studentId: sNour._id, studentName: 'Nour C' },
    scheduledDate: daysAgo(57), duration: 60, status: 'attended',
    subject: 'Arabic', description: 'Nour - 2 months ago W1'
  }));
  const clsC4 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianC._id, studentId: sNour._id, studentName: 'Nour C' },
    scheduledDate: daysAgo(50), duration: 60, status: 'attended',
    subject: 'Arabic', description: 'Nour - 2 months ago W2'
  }));

  // Last month: 3 attended + 1 30-min class = 3.5h → invC2 has 4h credit, so 0.5h remains
  const clsC5 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianC._id, studentId: sYoussef._id, studentName: 'Youssef C' },
    scheduledDate: daysAgo(35), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Youssef - Last month W1'
  }));
  const clsC6 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianC._id, studentId: sYoussef._id, studentName: 'Youssef C' },
    scheduledDate: daysAgo(28), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Youssef - Last month W2'
  }));
  const clsC7 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianC._id, studentId: sNour._id, studentName: 'Nour C' },
    scheduledDate: daysAgo(34), duration: 60, status: 'attended',
    subject: 'Arabic', description: 'Nour - Last month W1'
  }));
  const clsC8 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianC._id, studentId: sNour._id, studentName: 'Nour C' },
    scheduledDate: daysAgo(27), duration: 30, status: 'attended', // SHORT class = 0.5h
    subject: 'Arabic', description: 'Nour - Last month W2 (30 min only)'
  }));

  // This month: 3 attended + 2 scheduled = 5h but only 0.5h spillover credit from invC2
  // These 5h are UNCOVERED since invC3 is unpaid
  const clsC9 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianC._id, studentId: sYoussef._id, studentName: 'Youssef C' },
    scheduledDate: daysAgo(14), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Youssef - This month W1'
  }));
  const clsC10 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianC._id, studentId: sYoussef._id, studentName: 'Youssef C' },
    scheduledDate: daysAgo(7), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Youssef - This month W2'
  }));
  const clsC11 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianC._id, studentId: sNour._id, studentName: 'Nour C' },
    scheduledDate: daysAgo(13), duration: 60, status: 'attended',
    subject: 'Arabic', description: 'Nour - This month W1'
  }));
  const clsC12 = await Class.create(makeClass({
    teacher: teacher2._id,
    student: { guardianId: guardianC._id, studentId: sNour._id, studentName: 'Nour C' },
    scheduledDate: daysFromNow(1), duration: 60, status: 'scheduled',
    subject: 'Arabic', description: 'Nour - Upcoming 1'
  }));
  const clsC13 = await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianC._id, studentId: sYoussef._id, studentName: 'Youssef C' },
    scheduledDate: daysFromNow(3), duration: 60, status: 'scheduled',
    subject: 'Quran', description: 'Youssef - Upcoming 1'
  }));

  console.log(`✅ Guardian C: 13 classes across 3 months (8 past attended, 3 this month attended, 2 scheduled)`);

  // ────────────────────────────────────────────
  // Guardian D: Sara — Tests report-window visibility logic
  // ────────────────────────────────────────────
  const guardianD = await User.create({
    firstName: 'Sara', lastName: 'Guardian-D',
    email: 'sara@test.waraqa.co', password: pw,
    role: 'guardian', isActive: true, isEmailVerified: true,
    timezone: TIMEZONE,
    guardianInfo: {
      relationship: 'mother', hourlyRate: 12,
      paymentMethod: 'bank_transfer',
      spokenLanguages: ['Arabic'],
      totalHours: 5,
      students: [
        {
          firstName: 'Lina', lastName: 'D',
          grade: 'Grade 4', language: 'Arabic',
          subjects: ['Quran'], gender: 'female',
          timezone: TIMEZONE, hoursRemaining: 5,
          dateOfBirth: new Date('2015-01-10')
        }
      ]
    }
  });

  const sLina = guardianD.guardianInfo.students[0];

  // Invoice D1: This month, PAID, 5 hours credit
  const invD1 = await Invoice.create({
    invoiceNumber: 'TEST-D1',
    invoiceName: 'Sara - This Month',
    invoiceSlug: 'test-sara-this-month',
    type: 'guardian_invoice',
    guardian: guardianD._id,
    billingPeriod: {
      startDate: monthStart(0), endDate: monthEnd(0),
      month: curMonth, year: curYear
    },
    items: [],
    subtotal: 60, total: 60, currency: 'USD',
    status: 'paid', paidAmount: 60, paidDate: daysAgo(10),
    dueDate: daysAgo(15),
    creditHours: 5,
    guardianFinancial: { hourlyRate: 12 }
  });

  // Class D1: attended — always confirmed, consumes 1h
  await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianD._id, studentId: sLina._id, studentName: 'Lina D' },
    scheduledDate: daysAgo(12), duration: 60, status: 'attended',
    subject: 'Quran', description: 'Lina - attended (confirmed)'
  }));

  // Class D2: missed_by_student — confirmed, consumes 1h
  await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianD._id, studentId: sLina._id, studentName: 'Lina D' },
    scheduledDate: daysAgo(10), duration: 60, status: 'missed_by_student',
    subject: 'Quran', description: 'Lina - missed by student (confirmed)'
  }));

  // Class D3: past, still "scheduled", report window OPEN (1 day ago → within 72h)
  // → should consume credit as projected
  const d3date = daysAgo(1);
  const d3end = new Date(d3date.getTime() + 60 * 60000);
  const d3deadline = new Date(d3end.getTime() + 72 * 3600000); // 72h after class end
  await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianD._id, studentId: sLina._id, studentName: 'Lina D' },
    scheduledDate: d3date, duration: 60, status: 'scheduled',
    subject: 'Quran', description: 'Lina - past scheduled WINDOW OPEN',
    reportSubmission: {
      status: 'open',
      teacherDeadline: d3deadline,
      adminExtension: { granted: false }
    }
  }));

  // Class D4: past, still "scheduled", report window EXPIRED (5 days ago → >72h)
  // → should NOT consume credit (window closed, teacher didn't report)
  const d4date = daysAgo(5);
  const d4end = new Date(d4date.getTime() + 60 * 60000);
  const d4deadline = new Date(d4end.getTime() + 72 * 3600000); // expired by now
  await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianD._id, studentId: sLina._id, studentName: 'Lina D' },
    scheduledDate: d4date, duration: 60, status: 'scheduled',
    subject: 'Quran', description: 'Lina - past scheduled WINDOW EXPIRED',
    reportSubmission: {
      status: 'expired',
      teacherDeadline: d4deadline,
      adminExtension: { granted: false }
    }
  }));

  // Class D5: past, still "scheduled", window expired BUT admin extended it
  // → should consume credit as projected (admin said "reopen")
  const d5date = daysAgo(6);
  const d5end = new Date(d5date.getTime() + 60 * 60000);
  const d5deadline = new Date(d5end.getTime() + 72 * 3600000); // expired
  await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianD._id, studentId: sLina._id, studentName: 'Lina D' },
    scheduledDate: d5date, duration: 60, status: 'scheduled',
    subject: 'Quran', description: 'Lina - past scheduled ADMIN EXTENDED',
    reportSubmission: {
      status: 'admin_extended',
      teacherDeadline: d5deadline,
      adminExtension: {
        granted: true,
        expiresAt: daysFromNow(1), // extension still active
        grantedAt: daysAgo(1),
        grantedBy: admin._id
      }
    }
  }));

  // Class D6: no_show_both — should NOT consume credit
  await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianD._id, studentId: sLina._id, studentName: 'Lina D' },
    scheduledDate: daysAgo(8), duration: 60, status: 'no_show_both',
    subject: 'Quran', description: 'Lina - no_show_both (excluded)'
  }));

  // Class D7: future scheduled — always projected
  await Class.create(makeClass({
    teacher: teacher1._id,
    student: { guardianId: guardianD._id, studentId: sLina._id, studentName: 'Lina D' },
    scheduledDate: daysFromNow(3), duration: 60, status: 'scheduled',
    subject: 'Quran', description: 'Lina - future scheduled (projected)'
  }));

  console.log(`✅ Guardian D: 7 classes (report-window tests: 2 confirmed, 1 window-open, 1 window-expired, 1 admin-extended, 1 no_show, 1 future)`);

  // ────────────────────────────────────────────
  // 6. SUMMARY
  // ────────────────────────────────────────────
  const totalClasses = await Class.countDocuments();
  const totalInvoices = await Invoice.countDocuments();
  const totalUsers = await User.countDocuments();

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  SEED COMPLETE                                              ║
╠══════════════════════════════════════════════════════════════╣
║  Users:    ${String(totalUsers).padEnd(4)} (1 admin, 2 teachers, 4 guardians)     ║
║  Invoices: ${String(totalInvoices).padEnd(4)} (5 paid, 1 draft, 1 pending)          ║
║  Classes:  ${String(totalClasses).padEnd(4)} (across 3 months, mixed statuses)     ║
║  DB:       ${TEST_DB.padEnd(47)}║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  EXPECTED ALLOCATION AFTER slideAndReMap:                     ║
║                                                              ║
║  Guardian A (Mariam):                                        ║
║    invA1 (4h credit): 4 attended classes last month = 4h ✓  ║
║    invA2 (6h credit): 4 attended this month (4.5h) +        ║
║                       2 scheduled (2h projected)             ║
║                       = 6.5h needed, only 6h credit          ║
║                       → 1 class partially/un-covered!        ║
║                                                              ║
║  Guardian B (Khaled):                                        ║
║    invB1 (3h credit): 2 attended (2h) + 1 scheduled (1h)    ║
║                       = 3h used, 0h remaining               ║
║                       → 4th class UNCOVERED!                 ║
║                                                              ║
║  Guardian C (Fatima):                                        ║
║    invC1 (4h credit): 4 attended 2 months ago = 4h exact ✓  ║
║    invC2 (4h credit): 3.5h last month + 0.5h spillover      ║
║    invC3 (0h credit): unpaid → no allocation                 ║
║                       → 4.5h of this month UNCOVERED         ║
║                                                              ║
║  Guardian D (Sara):                                          ║
║    invD1 (5h credit): 1 attended + 1 missed_by_student +    ║
║                       1 window-open + 1 admin-extended +     ║
║                       1 future = 5h projected+confirmed      ║
║              D4 expired window class NOT allocated!          ║
║              D6 no_show_both NOT allocated!                  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝

Now run:  node backend/scripts/test-payment-links.js
`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
