const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');
const User = require('../models/User');
const InvoiceService = require('../services/invoiceService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

const CANCELLED_STATUSES = new Set([
  'cancelled',
  'cancelled_by_teacher',
  'cancelled_by_guardian',
  'cancelled_by_student',
  'cancelled_by_admin',
  'cancelled_by_system',
  'on_hold',
  'pattern',
  'no_show_both'
]);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
};

const normalizeClassId = (value) => {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return value.toString();
  if (typeof value === 'object') {
    if (value._id) return value._id.toString();
    if (typeof value.toString === 'function') {
      const str = value.toString();
      return str && str !== '[object Object]' ? str : null;
    }
  }
  return null;
};

const resolveStudentSnapshot = (cls) => {
  const studentName = cls?.student?.studentName || '';
  const [firstName, ...rest] = String(studentName).trim().split(' ').filter(Boolean);
  const lastName = rest.join(' ');
  return {
    firstName: firstName || studentName || '',
    lastName: lastName || '',
    studentName: studentName || `${firstName || ''} ${lastName || ''}`.trim(),
    email: cls?.student?.email || ''
  };
};

const resolveInvoiceRate = (invoice, guardianDoc) => {
  const rate = guardianDoc?.guardianInfo?.hourlyRate || invoice?.guardianFinancial?.hourlyRate || invoice?.guardianRate;
  return Number.isFinite(Number(rate)) ? Number(rate) : 10;
};

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function run() {
  const args = parseArgs();
  const invoiceId = args.invoiceId || args.invoice || null;
  const guardianId = args.guardianId || args.guardian || null;
  const sinceDays = Number.isFinite(Number(args.sinceDays)) ? Number(args.sinceDays) : 120;
  const dryRun = Boolean(args['dry-run'] || args.dryRun);

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const paidInvoices = await Invoice.find({
    deleted: { $ne: true },
    status: { $in: ['paid', 'refunded'] },
    ...(guardianId ? { guardian: guardianId } : {})
  }).select('items').lean();

  const paidClassIds = new Set();
  (paidInvoices || []).forEach((inv) => {
    (inv.items || []).forEach((it) => {
      const id = it?.class || it?.lessonId;
      if (id) paidClassIds.add(String(id));
    });
  });

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const filter = {
    deleted: { $ne: true },
    status: { $in: ['draft', 'pending', 'sent', 'overdue', 'partially_paid'] },
    ...(guardianId ? { guardian: guardianId } : {}),
    ...(invoiceId ? { _id: invoiceId } : { createdAt: { $gte: sinceDate } })
  };

  const invoices = await Invoice.find(filter).sort({ createdAt: 1 });
  if (!invoices.length) {
    console.log('No unpaid invoices found.');
    await mongoose.connection.close();
    return;
  }

  console.log(`Found ${invoices.length} unpaid invoice(s) to rebuild.`);

  const assignedIds = new Set(paidClassIds);

  for (const invoice of invoices) {
    const guardianDoc = await User.findById(invoice.guardian).lean();
    if (!guardianDoc) continue;

    const classes = await Class.find({
      'student.guardianId': invoice.guardian,
      hidden: { $ne: true },
      paidByGuardian: { $ne: true },
      status: { $nin: Array.from(CANCELLED_STATUSES) }
    })
      .select('scheduledDate duration subject status teacher student timezone anchoredTimezone')
      .lean();

    const eligible = (classes || [])
      .filter((cls) => {
        const cid = cls?._id ? String(cls._id) : null;
        if (!cid) return false;
        if (assignedIds.has(cid)) return false;
        return true;
      })
      .sort((a, b) => {
        const da = toDate(a.scheduledDate) || new Date(0);
        const db = toDate(b.scheduledDate) || new Date(0);
        return da - db;
      });

    const coverage = invoice.coverage || {};
    const maxHours = Number(coverage.maxHours || 0);
    const endDate = toDate(coverage.endDate);
    const billingStart = toDate(invoice?.billingPeriod?.startDate);
    const billingEnd = toDate(invoice?.billingPeriod?.endDate);

    let windowStart = billingStart;
    let windowEnd = null;

    if (endDate && (!maxHours || maxHours <= 0)) {
      windowEnd = new Date(endDate);
      windowEnd.setHours(23, 59, 59, 999);
    } else if (billingStart && billingEnd && (!maxHours || maxHours <= 0)) {
      windowStart = billingStart;
      windowEnd = billingEnd;
    }

    const withinWindow = eligible.filter((cls) => {
      const date = toDate(cls.scheduledDate);
      if (!date) return false;
      if (windowStart && date < windowStart) return false;
      if (windowEnd && date > windowEnd) return false;
      return true;
    });

    const rate = resolveInvoiceRate(invoice, guardianDoc);
    const desired = [];
    let usedHours = 0;

    const source = (maxHours && maxHours > 0) ? eligible : withinWindow;
    for (const cls of source) {
      const minutes = Number(cls.duration || 0) || 0;
      const hours = minutes / 60;
      if (minutes <= 0) continue;
      if (maxHours && maxHours > 0 && usedHours + hours > maxHours + 0.0005) break;

      desired.push({
        lessonId: String(cls._id),
        class: cls._id,
        student: cls.student?.studentId || null,
        studentSnapshot: resolveStudentSnapshot(cls),
        teacher: cls.teacher || null,
        description: cls.subject || 'Class session',
        date: cls.scheduledDate,
        duration: minutes,
        rate,
        amount: Math.round((hours * rate) * 100) / 100,
        attended: cls.status === 'attended',
        status: cls.status || 'scheduled'
      });

      usedHours += hours;
      if (maxHours && maxHours > 0 && usedHours >= maxHours - 0.0005) break;
    }

    const currentItems = Array.isArray(invoice.items) ? invoice.items : [];
    const currentByClass = new Map();
    currentItems.forEach((item) => {
      const key = normalizeClassId(item.class || item.lessonId);
      if (key) currentByClass.set(key, item);
    });

    const desiredByClass = new Map();
    desired.forEach((item) => {
      const key = normalizeClassId(item.class || item.lessonId);
      if (key) desiredByClass.set(key, item);
    });

    const removeItemIds = [];
    currentByClass.forEach((item, key) => {
      if (!desiredByClass.has(key) && item?._id) {
        removeItemIds.push(String(item._id));
      }
    });

    const addItems = [];
    desiredByClass.forEach((item, key) => {
      if (!currentByClass.has(key)) addItems.push(item);
    });

    if (dryRun) {
      console.log(`[dry-run] ${invoice.invoiceNumber || invoice._id} add=${addItems.length} remove=${removeItemIds.length}`);
      continue;
    }

    const result = await InvoiceService.updateInvoiceItems(
      String(invoice._id),
      { addItems, removeItemIds, note: 'Rebuilt unpaid invoice items', transferOnDuplicate: true },
      null
    );

    if (result?.success) {
      console.log(`✅ Rebuilt ${invoice.invoiceNumber || invoice._id} (add ${addItems.length}, remove ${removeItemIds.length})`);
      desired.forEach((item) => assignedIds.add(String(item.class || item.lessonId)));
    } else {
      console.log(`⚠️ Failed to rebuild ${invoice.invoiceNumber || invoice._id}: ${result?.error || 'unknown error'}`);
    }
  }

  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Rebuild failed:', err);
  process.exit(1);
});
