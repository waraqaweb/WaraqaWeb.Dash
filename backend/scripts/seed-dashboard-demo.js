// Seed demo data for dashboard (idempotent)
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');
const Class = require('../models/Class');
const Invoice = require('../models/Invoice');
const { Types } = mongoose;

const MONGO = process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager';

async function main() {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to MongoDB for seeding.');

  // Create or reuse teacher
  let teacher = await User.findOne({ email: 'demo.teacher@example.com' });
  if (!teacher) {
    teacher = new User({
      firstName: 'Demo',
      lastName: 'Teacher',
      email: 'demo.teacher@example.com',
      password: 'password',
      role: 'teacher',
      teacherInfo: { hourlyRate: 15 }
    });
    await teacher.save();
    console.log('Created teacher:', teacher._id);
  } else {
    console.log('Using existing teacher:', teacher._id);
  }

  // Create or reuse guardian
  let guardian = await User.findOne({ email: 'demo.guardian@example.com' });
  if (!guardian) {
    guardian = new User({
      firstName: 'Demo',
      lastName: 'Guardian',
      email: 'demo.guardian@example.com',
      password: 'password',
      role: 'guardian',
      guardianInfo: { students: [] }
    });
    // add an embedded student
    guardian.guardianInfo.students.push({
      firstName: 'Demo',
      lastName: 'Student',
      email: 'demo.student@example.com',
      grade: '1',
      hoursRemaining: 5,
    });
    await guardian.save();
    console.log('Created guardian with student:', guardian._id);
  } else {
    console.log('Using existing guardian:', guardian._id);
    if (!Array.isArray(guardian.guardianInfo?.students) || guardian.guardianInfo.students.length === 0) {
      guardian.guardianInfo = guardian.guardianInfo || {};
      guardian.guardianInfo.students = guardian.guardianInfo.students || [];
      guardian.guardianInfo.students.push({ firstName: 'Demo', lastName: 'Student', email: 'demo.student@example.com', grade: '1', hoursRemaining: 5 });
      await guardian.save();
      console.log('Added embedded student to guardian');
    }
  }

  // Choose a student _id from guardian's students
  const studentDoc = guardian.guardianInfo.students[0];
  const studentId = studentDoc._id || new Types.ObjectId();
  // Ensure it's present in the doc
  if (!studentDoc._id) {
    studentDoc._id = studentId;
    await guardian.save();
  }

  // Create or find a demo upcoming class
  const now = new Date();
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  let demoClass = await mongoose.model('Class').findOne({ title: 'Demo Class for dashboard', 'student.guardianId': guardian._id });
  if (!demoClass) {
    demoClass = await mongoose.model('Class').create({
      title: 'Demo Class for dashboard',
      description: 'Seeded demo class',
      subject: 'Quran',
      teacher: teacher._id,
      student: { guardianId: guardian._id, studentId: studentId, studentName: `${studentDoc.firstName} ${studentDoc.lastName}` },
      scheduledDate: nextDay,
      duration: 60,
      timezone: guardian.timezone || 'UTC',
      createdBy: teacher._id
    });
    console.log('Created demo class:', demoClass._id.toString());
  } else {
    console.log('Using existing demo class:', demoClass._id.toString());
  }

  // Create or find demo invoice for current month
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  let invoice = await Invoice.findOne({ guardian: guardian._id, 'billingPeriod.year': currentYear, 'billingPeriod.month': currentMonth });
  if (!invoice) {
    const startDate = new Date(currentYear, currentMonth - 1, 1);
    const endDate = new Date(currentYear, currentMonth, 0);
    invoice = new Invoice({
      invoiceNumber: `DEMO-${Date.now()}`,
      type: 'guardian_invoice',
      billingType: 'monthly',
      guardian: guardian._id,
      items: [{ description: 'Demo lesson', date: nextDay, duration: 60, rate: 10, amount: 10, student: guardian._id, teacher: teacher._id }],
      billingPeriod: { startDate, endDate, month: currentMonth, year: currentYear },
      subtotal: 10,
      total: 10,
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      status: 'sent',
      createdBy: guardian._id
    });
    await invoice.save();
    console.log('Created demo invoice:', invoice._id.toString());
  } else {
    console.log('Using existing demo invoice:', invoice._id.toString());
  }

  // Compute dashboard-like payload for guardian and print it
  const ClassModel = mongoose.model('Class');
  let upcomingClasses = [];
  try {
    upcomingClasses = await ClassModel.find({ 'student.guardianId': guardian._id, scheduledDate: { $gte: new Date() }, status: { $in: ['scheduled', 'in_progress'] } }).limit(10).lean();
  } catch (e) { upcomingClasses = []; }
  const upcomingClassesCount = Array.isArray(upcomingClasses) ? upcomingClasses.length : 0;

  let pendingInvoices = [];
  try {
    pendingInvoices = await Invoice.aggregate([
      { $match: { guardian: guardian._id, status: { $in: ['draft','sent','overdue','partially_paid'] } } },
      { $limit: 10 }
    ]);
  } catch (e) { pendingInvoices = []; }
  const pendingPaymentsCount = Array.isArray(pendingInvoices) ? pendingInvoices.length : 0;

  let monthlyInvoicesAgg = [];
  try {
    monthlyInvoicesAgg = await Invoice.aggregate([
      { $match: { guardian: guardian._id, 'billingPeriod.year': currentYear, 'billingPeriod.month': currentMonth } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);
  } catch (e) { monthlyInvoicesAgg = []; }
  const monthlyBill = (Array.isArray(monthlyInvoicesAgg) && monthlyInvoicesAgg[0]) ? monthlyInvoicesAgg[0].total : 0;

  const payload = { success: true, role: 'guardian', stats: { upcomingClassesCount, upcomingClasses, pendingPaymentsCount, pendingInvoices, monthlyBill } };

  console.log('\n--- Dashboard payload for demo guardian ---');
  console.log(JSON.stringify(payload, null, 2));

  await mongoose.disconnect();
  console.log('Disconnected. Seed complete.');
}

main().catch(err => { console.error('Seeder error', err); process.exit(1); });
