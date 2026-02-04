// backend/services/invoiceService.js
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const Class = require('../models/Class');
const Payment = require('../models/Payment');
require('../models/Student');
const generateInvoiceDoc = require('../utils/generateInvoiceDoc');
const { buildGuardianFinancialSnapshot } = require('../utils/guardianFinancial');
const dayjs = require('dayjs');
const notificationService = require('./notificationService');

const roundCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

const roundHours = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1000) / 1000;
};

const ensureDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const EPSILON_HOURS = 0.0005;
const EPSILON_CURRENCY = 0.05;
const ACTIVE_UNPAID_INVOICE_STATUSES = ['draft', 'pending', 'sent', 'overdue', 'partially_paid'];
const INVOICE_DEBUG = String(process.env.INVOICE_DEBUG || '').toLowerCase() === 'true';

const resolveInvoiceHourlyRate = (invoice) => {
  const doc = invoice || {};
  const fromInvoice = Number(doc?.guardianFinancial?.hourlyRate || 0) || 0;
  if (fromInvoice > 0) return fromInvoice;
  const fromGuardian = Number(doc?.guardian?.guardianInfo?.hourlyRate || 0) || 0;
  if (fromGuardian > 0) return fromGuardian;
  const items = Array.isArray(doc?.items) ? doc.items : [];
  const itemWithRate = items.find((it) => Number(it?.rate || 0) > 0);
  if (itemWithRate) return Number(itemWithRate.rate);
  const hours = items.reduce((sum, it) => sum + ((Number(it?.duration || 0) || 0) / 60), 0);
  const amount = items.reduce((sum, it) => sum + (Number(it?.amount || 0) || 0), 0);
  if (hours > 0 && amount > 0) {
    return Math.round((amount / hours) * 100) / 100;
  }
  return 10;
};

const computeInvoiceItemHours = (invoice) => {
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  return items.reduce((sum, it) => {
    const minutes = Number(it?.duration || 0) || 0;
    return sum + (minutes / 60);
  }, 0);
};

const extractTransferFeeAmount = (invoice) => {
  const transferFee = invoice?.guardianFinancial?.transferFee;
  if (!transferFee || transferFee.waived) return 0;
  const amount = Number(transferFee.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return roundCurrency(amount);
};

const calculatePaidHoursFromLogs = (invoice, hourlyRate) => {
  const logs = Array.isArray(invoice?.paymentLogs) ? invoice.paymentLogs : [];
  if (!logs.length) return 0;
  const rate = Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : resolveInvoiceHourlyRate(invoice);
  let total = 0;
  for (const log of logs) {
    if (!log) continue;
    if (log.method === 'tip_distribution') continue;
    const amount = Number(log.amount || 0) || 0;
    const loggedHours = Number.isFinite(log.paidHours) ? Number(log.paidHours) : (rate > 0 ? Math.abs(amount) / rate : 0);
    if (!Number.isFinite(loggedHours) || loggedHours <= 0) continue;
    if (amount < 0 || log.method === 'refund') {
      total -= loggedHours;
    } else {
      total += loggedHours;
    }
  }
  return Math.max(0, roundHours(total));
};

const CANCELLED_CLASS_STATUSES = new Set([
  'cancelled',
  'cancelled_by_teacher',
  'cancelled_by_guardian',
  'cancelled_by_admin',
  'cancelled_by_system',
  'on_hold',
  'pattern'
]);

const ALWAYS_INCLUDED_CLASS_STATUSES = new Set(['attended', 'missed_by_student']);
const FUTURE_ELIGIBLE_STATUSES = new Set(['scheduled', 'in_progress', 'completed']);
const DEFAULT_DYNAMIC_LOOKAHEAD_MONTHS = 6;
const MAX_DYNAMIC_CLASS_RESULTS = 400;

const normalizeStatusValue = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const toObjectId = (value) => {
  if (!value) return null;
  try {
    const str = value.toString();
    if (!mongoose.Types.ObjectId.isValid(str)) return null;
    return new mongoose.Types.ObjectId(str);
  } catch (err) {
    return null;
  }
};

const collectGuardianStudentIds = (guardianDoc, fallbackStudents = []) => {
  const ids = new Set();
  const add = (val) => {
    if (!val) return;
    try {
      ids.add(String(val));
    } catch (_) {
      // ignore
    }
  };

  const embedded = Array.isArray(guardianDoc?.guardianInfo?.students)
    ? guardianDoc.guardianInfo.students
    : [];

  embedded.forEach((s) => {
    add(s?._id || s?.id || s?.studentId);
    add(s?.standaloneStudentId);
    add(s?.studentInfo?.standaloneStudentId);
    add(s?.studentInfo?.studentId);
  });

  (Array.isArray(fallbackStudents) ? fallbackStudents : []).forEach((s) => {
    add(s?._id || s?.id || s?.studentId);
    add(s?.standaloneStudentId);
    add(s?.studentInfo?.standaloneStudentId);
    add(s?.studentInfo?.studentId);
  });

  return Array.from(ids)
    .map((id) => toObjectId(id))
    .filter(Boolean);
};

const getAdminRecipientIds = async () => {
  try {
    const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
    return (admins || []).map((admin) => admin?._id).filter(Boolean);
  } catch (err) {
    console.warn('[InvoiceService] Failed to load admin recipients:', err?.message || err);
    return [];
  }
};

const getGuardianLabel = (guardian) => {
  if (!guardian) return 'Guardian';
  const fullName = [guardian.firstName, guardian.lastName].filter(Boolean).join(' ').trim();
  return fullName || guardian.fullName || guardian.email || 'Guardian';
};

const notifyInvoiceSkipped = async ({ guardian, reasonCode, reasonLabel, details, actionLink, metadata = {} }) => {
  if (!guardian?._id) return;
  const adminIds = await getAdminRecipientIds();
  if (!adminIds.length) return;

  const guardianLabel = getGuardianLabel(guardian);
  const baseReason = reasonLabel || 'Invoice was skipped.';
  const infoLine = details ? ` ${details}` : '';
  const message = `Invoice skipped for ${guardianLabel}. Reason: ${baseReason}.${infoLine} Open invoices to create one, or mark this as read to keep it skipped.`;

  await Promise.allSettled(
    adminIds.map((adminId) => notificationService.createNotification({
      userId: adminId,
      title: 'Invoice skipped',
      message,
      type: 'warning',
      relatedTo: 'invoice',
      relatedId: guardian._id,
      metadata: {
        kind: 'invoice_skipped',
        guardianId: String(guardian._id),
        guardianName: guardianLabel,
        reasonCode,
        reasonLabel,
        ...metadata
      },
      actionRequired: false,
      actionLink: actionLink || '/dashboard/invoices'
    }))
  );
};

const collectBilledClassIds = async (baseFilter = {}) => {
  const [classIds, lessonIds] = await Promise.all([
    Invoice.distinct('items.class', baseFilter),
    Invoice.distinct('items.lessonId', baseFilter)
  ]);

  const merged = new Set();
  for (const id of [...(classIds || []), ...(lessonIds || [])]) {
    if (!id) continue;
    try {
      const str = id.toString();
      if (str && str !== '[object Object]') merged.add(str);
    } catch (_) {
      // ignore
    }
  }

  return Array.from(merged).map((id) => toObjectId(id)).filter(Boolean);
};

const getGuardianStudentIds = async (guardianDoc, invoiceDoc) => {
  const collected = new Set();
  const studentEntries = Array.isArray(guardianDoc?.guardianInfo?.students)
    ? guardianDoc.guardianInfo.students
    : [];
  for (const entry of studentEntries) {
    const candidates = [
      entry?.studentId,
      entry?._id,
      entry?.id,
      entry?.standaloneStudentId,
      entry?.studentInfo?.standaloneStudentId
    ];
    candidates.forEach((candidate) => {
      const objId = toObjectId(candidate);
      if (objId) collected.add(objId.toString());
    });
  }

  if (guardianDoc?._id) {
    try {
      const standalone = await Student.find({ guardian: guardianDoc._id }).select('_id').lean();
      (standalone || []).forEach((s) => {
        const objId = toObjectId(s?._id);
        if (objId) collected.add(objId.toString());
      });
    } catch (e) {
      // ignore
    }
  }

  if (!collected.size && Array.isArray(invoiceDoc?.items)) {
    for (const item of invoiceDoc.items) {
      const objId = toObjectId(item?.student);
      if (objId) collected.add(objId.toString());
    }
  }

  return Array.from(collected).map((id) => new mongoose.Types.ObjectId(id));
};

const findGuardianStudentIndex = (guardianDoc, studentId) => {
  if (!guardianDoc || !studentId) return -1;
  const students = Array.isArray(guardianDoc.guardianInfo?.students)
    ? guardianDoc.guardianInfo.students
    : [];
  if (!students.length) return -1;
  const target = String(studentId);
  return students.findIndex((s) => {
    const candidates = [
      s?._id,
      s?.id,
      s?.studentId,
      s?.standaloneStudentId,
      s?.studentInfo?.standaloneStudentId
    ]
      .filter(Boolean)
      .map((v) => String(v));
    return candidates.includes(target);
  });
};

const resolveStudentSnapshotFromClass = (cls) => {
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

const isAdminExtensionActive = (reportSubmission = {}, now = new Date()) => {
  const extension = reportSubmission?.adminExtension || {};
  if (!extension?.granted) return false;
  const expiresAt = ensureDate(extension.expiresAt);
  if (!expiresAt) return true;
  return now <= expiresAt;
};

const isSubmissionWindowActive = (cls, now) => {
  const allowance = ensureDate(cls?.reportSubmissionAllowance || cls?.reportSubmission?.teacherDeadline);
  if (allowance && now <= allowance) {
    return true;
  }
  if (cls?.reportSubmissionExtendedUntil) {
    const extended = ensureDate(cls.reportSubmissionExtendedUntil);
    if (extended && now <= extended) return true;
  }
  return isAdminExtensionActive(cls?.reportSubmission, now);
};

const isClassEligibleForDynamicInvoice = (cls, now = new Date()) => {
  const status = normalizeStatusValue(cls?.status);
  if (CANCELLED_CLASS_STATUSES.has(status)) return false;
  if (ALWAYS_INCLUDED_CLASS_STATUSES.has(status)) return true;

  const scheduledDate = ensureDate(cls?.scheduledDate || cls?.dateTime);
  if (!scheduledDate) return false;

  if (scheduledDate > now) {
    return FUTURE_ELIGIBLE_STATUSES.has(status) || !status;
  }

  if (isSubmissionWindowActive(cls, now)) {
    return true;
  }

  return false;
};

class InvoiceService {

  /**
   * Check guardians according to billing system and create invoices.
   */
  static async checkAndCreateZeroHourInvoices() {
    try {
      console.log('🔍 [InvoiceService] Starting zero-hour invoice check...');

      const analyzeGuardianHours = (guardianDoc) => {
        const students = Array.isArray(guardianDoc.guardianInfo?.students)
          ? guardianDoc.guardianInfo.students
          : [];

        // respect guardian-configured minimum lesson duration (minutes) as a top-up threshold
        const minLessonMinutes = Number(guardianDoc.guardianInfo?.minLessonDurationMinutes ?? guardianDoc.guardianInfo?.minLessonMinutes ?? 30);
        const minLessonHours = Number.isFinite(minLessonMinutes) ? (minLessonMinutes / 60) : 0.5;

        const zeroStudents = students.filter((student) => {
          const remaining = Number(student?.hoursRemaining ?? student?.hoursLeft ?? 0);
          // trigger when remaining is zero or below, or when it falls below the minimum lesson duration
          return Number.isFinite(remaining) && (remaining <= 0 || remaining <= minLessonHours);
        });

        const recalculatedTotalHours = students.reduce((sum, student) => {
          const hours = Number(student?.hoursRemaining ?? student?.hoursLeft ?? 0);
          return sum + (Number.isFinite(hours) ? hours : 0);
        }, 0);

        const storedTotalHoursRaw = guardianDoc.guardianInfo ? guardianDoc.guardianInfo.totalHours : undefined;
        const storedTotalHoursValue = Number(storedTotalHoursRaw);
        const storedTotalHours = Number.isFinite(storedTotalHoursValue) ? storedTotalHoursValue : null;
        const effectiveTotalHours = storedTotalHours !== null ? storedTotalHours : recalculatedTotalHours;

        return {
          zeroStudents,
          recalculatedTotalHours,
          storedTotalHours,
          effectiveTotalHours
        };
      };

      const normalizeBillingSystem = (value) => {
        if (value === null || value === undefined) return null;
        if (typeof value === 'string') {
          return value.trim().toLowerCase();
        }
        return value;
      };

      const ZERO_HOUR_BILLING_SYSTEMS = new Set([
        null,
        '',
        'on_zero',
        'onzero',
        'auto_payg',
        'autopayg',
        'payg',
        'payg_auto',
        'top_up',
        'topup'
      ]);

      // 1) Guardians identified as zero-hour candidates (sync totals first)
      const zeroHourGuardians = await User.findGuardiansWithZeroHours({
        includeAnalysis: true,
        syncTotalHours: true
      });

      const guardiansForOnZero = [];
      const now = new Date();
      for (const guardian of zeroHourGuardians) {
        const billingSystem = normalizeBillingSystem(guardian?.guardianInfo?.billingSystem);
        if (billingSystem === 'monthly') continue;
        if (billingSystem === 'manual' && guardian?.guardianInfo?.autoTotalHours === false) continue;
        if (!ZERO_HOUR_BILLING_SYSTEMS.has(billingSystem)) continue;

        const analysis = analyzeGuardianHours(guardian);

        // Check if guardian has any future scheduled classes for their students
        let hasFutureClasses = false;
        try {
          const studentIds = collectGuardianStudentIds(guardian);
          const futureQuery = {
            'student.guardianId': guardian._id,
            scheduledDate: { $gt: now },
            status: { $ne: 'cancelled' }
          };
          if (studentIds.length > 0) {
            futureQuery['student.studentId'] = { $in: studentIds };
          }
          const futureCount = await Class.countDocuments(futureQuery).exec();
          hasFutureClasses = futureCount > 0;
        } catch (fErr) {
          console.warn('Failed to check future classes for guardian', guardian._id, fErr && fErr.message);
        }

        // If guardian has no future classes and has zero hours exactly, skip creating invoice
        // Use the effective total (stored override if present, otherwise recalculated)
        const effectiveTotal = Number.isFinite(Number(analysis.effectiveTotalHours))
          ? Number(analysis.effectiveTotalHours)
          : Number.isFinite(Number(analysis.recalculatedTotalHours))
            ? Number(analysis.recalculatedTotalHours)
            : 0;

        const shouldTriggerBase = analysis.zeroStudents.length > 0 || effectiveTotal <= 0;
        if (!shouldTriggerBase) continue;

        // If guardian has no future classes AND the effective total hours is exactly zero, skip creating an invoice.
        // If effective total is negative (guardian owes hours) and no future classes exist, create a due-only invoice.
        if (!hasFutureClasses && effectiveTotal === 0) {
          // Do not create invoices for guardians with ZERO balance and NO future classes
          await notifyInvoiceSkipped({
            guardian,
            reasonCode: 'no_future_classes_zero_balance',
            reasonLabel: 'No future classes and zero balance',
            details: 'There are no upcoming lessons and the balance is 0.'
          });
          continue;
        }

        const entry = {
          guardian,
          ...analysis,
          effectiveTotalHours: effectiveTotal,
          shouldTrigger: true,
          hasFutureClasses
        };

        // If guardian has negative hours (owes hours) and no future classes, mark dueOnlyHours
        if (!hasFutureClasses && effectiveTotal < 0) {
          entry.dueOnlyHours = Math.abs(effectiveTotal);
        }

        guardiansForOnZero.push(entry);
      }

      console.log(`📊 Found ${guardiansForOnZero.length} guardians (zero-hour) needing invoices`);

      const activeInvoiceStatuses = ['draft', 'pending', 'sent', 'overdue', 'partially_paid'];

      // 2) Monthly billing guardians
      const today = new Date();
      const currentMonth = today.getMonth() + 1;
      const currentYear = today.getFullYear();

      const guardiansMonthly = await User.find({
        role: 'guardian',
        isActive: true,
        'guardianInfo.billingSystem': 'monthly'
      });

      const invoicesCreated = [];

      // Handle on-zero guardians (create top-up invoices)
      for (const entry of guardiansForOnZero) {
        const { guardian } = entry;

        const existingUnpaidInvoice = await Invoice.findOne({
          guardian: guardian._id,
          type: 'guardian_invoice',
          deleted: { $ne: true },
          status: { $in: activeInvoiceStatuses }
        }).sort({ createdAt: 1 });

        if (existingUnpaidInvoice) {
          await InvoiceService.syncUnpaidInvoiceItems(existingUnpaidInvoice, {
            note: 'Synced unpaid invoice (auto-payg)'
          });
          await notifyInvoiceSkipped({
            guardian,
            reasonCode: 'existing_unpaid_invoice',
            reasonLabel: 'An unpaid invoice already exists',
            details: existingUnpaidInvoice.invoiceNumber
              ? `Existing invoice ${existingUnpaidInvoice.invoiceNumber} is still active.`
              : 'An existing unpaid invoice is still active.'
          });
          continue;
        }

        const outstandingAutoInvoice = await Invoice.findOne({
          guardian: guardian._id,
          type: 'guardian_invoice',
          generationSource: 'auto-payg',
          status: { $in: activeInvoiceStatuses }
        }).sort({ createdAt: -1 });

        if (outstandingAutoInvoice) {
          outstandingAutoInvoice.recalculateTotals();
          const remaining = outstandingAutoInvoice.getDueAmount();
          const createdWithin48h = dayjs(outstandingAutoInvoice.createdAt).isAfter(dayjs().subtract(48, 'hour'));

          if (remaining > 0.01 || createdWithin48h) {
            console.log(`⏭️  Skipping guardian ${guardian._id} — existing auto-payg invoice ${outstandingAutoInvoice.invoiceNumber} still active (remaining=${remaining})`);
            await notifyInvoiceSkipped({
              guardian,
              reasonCode: 'existing_auto_payg_invoice',
              reasonLabel: 'An auto-payg invoice is still active',
              details: `${outstandingAutoInvoice.invoiceNumber ? `Invoice ${outstandingAutoInvoice.invoiceNumber} ` : ''}remaining ${roundCurrency(remaining)}${createdWithin48h ? '; created within 48 hours.' : '.'}`.trim()
            });
            continue;
          }
        }

        const session = await mongoose.startSession();
        let createdInvoice = null;

        const performCreation = async (sessionArg = null) => {
          const query = sessionArg ? User.findById(guardian._id).session(sessionArg) : User.findById(guardian._id);
          const guardianDoc = await query;
          if (!guardianDoc) return null;
          const { zeroStudents, recalculatedTotalHours, effectiveTotalHours: analysisEffective } = analyzeGuardianHours(guardianDoc);

          // Persist updated totals if guardian expects syncing
          if (guardianDoc.guardianInfo?.autoTotalHours !== false) {
            const stored = Number(guardianDoc.guardianInfo?.totalHours ?? 0);
            if (Math.abs(stored - recalculatedTotalHours) > 0.0001) {
              guardianDoc.guardianInfo.totalHours = recalculatedTotalHours;
              if (sessionArg) {
                await guardianDoc.save({ session: sessionArg });
              } else {
                await guardianDoc.save();
              }
            }
          }

          // Re-evaluate effective total (use stored override if present)
          const effectiveTotal = Number.isFinite(Number(analysisEffective))
            ? Number(analysisEffective)
            : Number.isFinite(Number(recalculatedTotalHours)) ? Number(recalculatedTotalHours) : 0;

          // Re-check for future classes inside the transaction to avoid race
          let hasFuture = false;
          try {
            const studentIds = collectGuardianStudentIds(guardianDoc, zeroStudents);
            const futureCountQuery = {
              'student.guardianId': guardianDoc._id,
              scheduledDate: { $gt: new Date() },
              status: { $ne: 'cancelled' }
            };
            if (studentIds.length > 0) {
              futureCountQuery['student.studentId'] = { $in: studentIds };
            }
            const futureCount = sessionArg
              ? await Class.countDocuments(futureCountQuery).session(sessionArg).exec()
              : await Class.countDocuments(futureCountQuery).exec();
            hasFuture = futureCount > 0;
          } catch (err) {
            console.warn('Failed to check future classes inside transaction for guardian', guardianDoc._id, err && err.message);
          }

          const shouldCreate = zeroStudents.length > 0 || effectiveTotal <= 0;
          if (!shouldCreate) return null;

          // If no future classes and effective total is exactly zero -> skip
          if (!hasFuture && effectiveTotal === 0) {
            await notifyInvoiceSkipped({
              guardian: guardianDoc,
              reasonCode: 'no_future_classes_zero_balance',
              reasonLabel: 'No future classes and zero balance',
              details: 'There are no upcoming lessons and the balance is 0.'
            });
            return null;
          }

          const createOpts = {
            reason: 'on_zero_trigger',
            session: sessionArg || undefined,
            triggeredBy: 'auto-payg'
          };

          // If guardian owes hours and there are no future classes, create due-only invoice
          if (!hasFuture && effectiveTotal < 0) {
            createOpts.dueOnlyHours = Math.abs(effectiveTotal);
          }

          return this.createZeroHourInvoice(guardianDoc, zeroStudents, createOpts);
        };

        let fallbackToNonTransactional = false;
        try {
          await session.withTransaction(async () => {
            createdInvoice = await performCreation(session);
          }, {
            readPreference: 'primary',
            readConcern: { level: 'local' },
            writeConcern: { w: 'majority' }
          });
        } catch (createErr) {
          if (createErr?.code === 20 || createErr?.codeName === 'IllegalOperation') {
            console.warn('⚠️ Transactions unsupported on current MongoDB deployment; falling back to non-transactional zero-hour invoice creation.');
            fallbackToNonTransactional = true;
          } else {
            console.error('Error creating zero hour invoice:', createErr);
          }
        } finally {
          session.endSession().catch(() => {});
        }

        if (fallbackToNonTransactional) {
          try {
            createdInvoice = await performCreation(null);
          } catch (fallbackErr) {
            console.error('Fallback zero hour invoice creation failed:', fallbackErr);
          }
        }

        if (createdInvoice) {
          invoicesCreated.push(createdInvoice);
        }
      }

      // Handle monthly guardians
      for (const guardian of guardiansMonthly) {
        const existing = await Invoice.findOne({
          guardian: guardian._id,
          type: 'guardian_invoice',
          'billingPeriod.month': currentMonth,
          'billingPeriod.year': currentYear
        });

        if (existing) continue;

        // Get classes that haven't been paid/invoiced (exclude classes already referenced in paid invoices)
        // ✅ Exclude classes that are already in ANY invoice (not just paid ones)
        // A class should only appear in one invoice, whether draft, sent, or paid
        const invoicedClassIds = await collectBilledClassIds({
          deleted: { $ne: true },
          status: { $nin: ['cancelled', 'refunded'] }
        });
        const studentIds = await getGuardianStudentIds(guardian, null);

        // ✅ Query classes by guardian id (studentId filter only when available)
        const unpaidQuery = {
          'student.guardianId': guardian._id,
          hidden: { $ne: true },
          status: { $ne: 'pattern' },
          paidByGuardian: { $ne: true },
          // Exclude classes that are in active invoices
          _id: { $nin: invoicedClassIds }
        };
        if (studentIds.length > 0) {
          unpaidQuery['student.studentId'] = { $in: studentIds };
        }

        let unpaidClasses = await Class.find(unpaidQuery)
          .populate("student.guardianId", "firstName lastName email")
          .populate("teacher")
          .lean();

        console.log(`🔍 [Zero-Hour Invoice] Processing guardian: ${guardian.firstName} ${guardian.lastName}`);
        console.log(`🔍 [Zero-Hour Invoice] Found ${unpaidClasses.length} total unpaid classes`);

        // sort earliest → latest
        unpaidClasses.sort((a, b) => {
          const dateA = new Date(a.scheduledDate || a.date || 0);
          const dateB = new Date(b.scheduledDate || b.date || 0);
          return dateA - dateB;
        });

        const startDate = unpaidClasses.length
          ? (unpaidClasses[0].scheduledDate || unpaidClasses[0].date)
          : today;

        // Calculate one calendar month from the first unpaid class
        const endDate = dayjs(startDate).add(1, 'month').toDate();

        // Filter classes to only include those within the one month period
        const selectedClasses = unpaidClasses.filter(cls => {
          const clsDate = new Date(cls.scheduledDate || cls.date);
          return clsDate >= new Date(startDate) && clsDate < endDate;
        });

        // Debug logging
        console.log(`[Zero-Hour Invoice] Guardian: ${guardian.firstName} ${guardian.lastName}`);
        console.log(`[Zero-Hour Invoice] Total unpaid classes found: ${unpaidClasses.length}`);
        console.log(`[Zero-Hour Invoice] Billing period: ${startDate.toISOString()} → ${endDate.toISOString()}`);
        console.log(`[Zero-Hour Invoice] Classes within period: ${selectedClasses.length}`);
        console.log(`[Zero-Hour Invoice] Selected class dates:`, selectedClasses.map(c => ({
          date: c.scheduledDate || c.date,
          status: c.status,
          duration: c.duration,
          subject: c.subject
        })));

        // Skip if no classes in this period
        if (selectedClasses.length === 0) continue;

        const items = selectedClasses.map(cls => {
          const duration = cls.duration || 60;
          const rate = guardian.guardianInfo?.hourlyRate || 10;
          const amount = (duration / 60) * rate;
          return {
            lessonId: cls._id.toString(),
            class: cls._id,
            student: cls.student?.studentId,
            studentSnapshot: resolveStudentSnapshotFromClass(cls),
            teacher: cls.teacher?._id,
            description: `${cls.subject || "Class"} with ${cls.teacher?.firstName || ""}`,
            date: cls.scheduledDate || cls.date,
            duration, // minutes
            rate,
            amount,
            attended: cls.status === "attended"
          };
        });

        // Calculate subtotal from all items
        const subtotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);

        console.log(`💰 [Zero-Hour Invoice] Items count: ${items.length}, Subtotal: $${subtotal.toFixed(2)}`);

        const invoice = new Invoice({
          type: "guardian_invoice",
          guardian: guardian._id,
          billingPeriod: {
            startDate,
            endDate: endDate, // Use the calculated one month end date
            month: new Date(startDate).getMonth() + 1,
            year: new Date(startDate).getFullYear(),
          },
          items,
          subtotal,
          total: subtotal,
          status: "draft",
          dueDate: new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000),
          paymentMethod: guardian.guardianInfo?.preferredPaymentMethod || "credit_card",
          notes: "Automatic monthly invoice",
          guardianFinancial: buildGuardianFinancialSnapshot(guardian),
          coverage: {
            strategy: 'full_period',
            waiveTransferFee: false
          }
        });

        await invoice.ensureIdentifiers({ forceNameRefresh: false });
        await invoice.save();
        
        // ✅ Mark all classes in this invoice as billed
        try {
          const Class = require('../models/Class');
          const classIdsToMark = items
            .map(it => it.class || it.lessonId)
            .filter(Boolean);
          
          if (classIdsToMark.length > 0) {
            await Class.updateMany(
              { _id: { $in: classIdsToMark } },
              { $set: { billedInInvoiceId: invoice._id, billedAt: today, flaggedUninvoiced: false } }
            );
          }
        } catch (markErr) {
          console.error('Failed to mark classes as billed in checkAndCreateZeroHourInvoices:', markErr);
        }
        
        invoicesCreated.push(invoice);
      }

      console.log(`🎉 Finished. Total invoices created: ${invoicesCreated.length}`);
      return {
        success: true,
        invoicesCreated: invoicesCreated.length,
        invoices: invoicesCreated,
        guardiansConsidered: guardiansForOnZero.length,
        zeroHourGuardians: zeroHourGuardians.length
      };

    } catch (err) {
      console.error("💥 Error in checkAndCreateZeroHourInvoices:", err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create an initial invoice containing a single lesson when the teacher records the student's first lesson
   * guardian: User document
   * classDoc: Class document (the class that was just reported)
   */
  static async createInvoiceForFirstLesson(guardian, classDoc, opts = {}) {
    try {
      if (!guardian || !classDoc) throw new Error('Guardian and class are required');
      const now = new Date();
      const session = opts.session || null;
      const createdBy = opts.createdBy || null;

      const existingUnpaid = await Invoice.findOne({
        guardian: guardian._id,
        type: 'guardian_invoice',
        deleted: { $ne: true },
        status: { $in: ['draft', 'pending', 'sent', 'overdue', 'partially_paid'] }
      }).sort({ createdAt: 1 });

      if (existingUnpaid) {
        await InvoiceService.syncUnpaidInvoiceItems(existingUnpaid, {
          adminUserId: createdBy || null,
          note: 'Synced unpaid invoice (first-lesson)'
        });
        return existingUnpaid;
      }

      const firstDate = classDoc.scheduledDate || now;
      const defaultRate = guardian.guardianInfo?.hourlyRate || 10;
      
      // 🔍 Find the EARLIEST unbilled class to determine the billing start date
      const studentIds = Array.isArray(guardian.guardianInfo?.students)
        ? guardian.guardianInfo.students.map((s) => s && (s._id || s.id)).filter(Boolean)
        : [];
      
      let billingStartDate = firstDate;
      if (studentIds.length > 0) {
        // Find earliest unbilled class for this guardian
        const earliestClass = await Class.findOne({
          'student.guardianId': guardian._id,
          'student.studentId': { $in: studentIds },
          billedInInvoiceId: null,
          status: { $ne: 'cancelled' }
        })
          .sort({ scheduledDate: 1 })
          .select('scheduledDate')
          .lean();
        
        if (earliestClass && earliestClass.scheduledDate < billingStartDate) {
          billingStartDate = earliestClass.scheduledDate;
          console.log(`[First-Lesson Invoice] Found earlier unbilled class: ${billingStartDate.toISOString()}`);
        }
      }
      
      // Calculate one calendar month from the EARLIEST unbilled class date
      const searchEndDate = dayjs(billingStartDate).add(1, 'month').toDate();

      // Build initial item from the reported class
      const duration = Number(classDoc.duration || 60);
      const hours = Number(duration) / 60;
      const rate = defaultRate;
      const amount = Math.round((hours * rate) * 100) / 100;

      const studentId = classDoc.student?.studentId || (classDoc.student && classDoc.student.studentId) || null;
      const studentName = classDoc.student?.studentName || (classDoc.studentSnapshot && `${classDoc.studentSnapshot.firstName || ''} ${classDoc.studentSnapshot.lastName || ''}`) || '';

      const firstItem = {
        lessonId: classDoc._id ? classDoc._id.toString() : null,
        class: classDoc._id || null,
        student: studentId,
        studentSnapshot: {
          firstName: studentName ? studentName.split(' ')[0] : '',
          lastName: studentName ? studentName.split(' ').slice(1).join(' ') : '',
          email: ''
        },
        teacher: classDoc.teacher || null,
        description: `${classDoc.subject || 'Class'} with ${classDoc.teacherName || ''}`,
        date: firstDate,
        duration: duration,
        rate,
        amount,
        attended: classDoc.status === 'attended'
      };

      // Include ALL classes (attended, missed, scheduled) within one calendar month from the first unpaid class
      let items = [firstItem];
      let lastClassDate = firstDate;
      
      try {
        const studentIds = Array.isArray(guardian.guardianInfo?.students)
          ? guardian.guardianInfo.students.map((s) => s && (s._id || s.id)).filter(Boolean)
          : [];
        if (studentIds.length > 0) {
          // ✅ Exclude classes already in any invoice (not just paid ones)
          const billedIds = await collectBilledClassIds({
            deleted: { $ne: true },
            status: { $in: ACTIVE_UNPAID_INVOICE_STATUSES }
          });
          
          console.log(`[First-Lesson Invoice] Excluded billed class IDs: ${billedIds.length} classes`);
          
          // Query for ALL classes within the month (attended, missed, scheduled, AND pending report submission)
          // Start from EARLIEST unbilled class, not the triggering class
          const additional = await Class.find({
            'student.guardianId': guardian._id,
            'student.studentId': { $in: studentIds },
            scheduledDate: { $gte: billingStartDate, $lt: searchEndDate },
            // Exclude classes that are in active invoices
            _id: { $nin: billedIds },
            // Include classes that are:
            // - Attended/absent (has report)
            // - Scheduled and within submission window (reportSubmission.status: 'open' or 'admin_extended')
            // - Scheduled with no submission status yet (class just ended)
            $or: [
              // Classes with reports submitted
              { 'classReport.submittedAt': { $exists: true } },
              // Scheduled classes within 72-hour window or with admin extension
              { 
                status: 'scheduled',
                $or: [
                  { 'reportSubmission.status': 'open' },
                  { 'reportSubmission.status': 'admin_extended' },
                  { 'reportSubmission.status': { $exists: false } }, // No tracking yet
                  { 'reportSubmission.status': 'pending' }
                ]
              },
              // Attended/absent classes
              { status: 'attended' },
              { status: 'missed_by_student' }
            ]
          })
            .select('_id subject scheduledDate duration student teacher status billedInInvoiceId classReport reportSubmission')
            .lean();
          
          console.log(`[First-Lesson Invoice] Additional classes found: ${additional.length}`);

          for (const cls of additional) {
            // Skip the first class if already included
            if (String(cls._id) === String(classDoc._id || '')) continue;
            const studentFullName = (cls.student && cls.student.studentName) || '';
            const [fn, ...rest] = String(studentFullName).trim().split(' ').filter(Boolean);
            const ln = rest.join(' ');
            const itemHours = (Number(cls.duration || 0) || 0) / 60;
            
            // Track the last class date
            const clsDate = cls.scheduledDate || firstDate;
            if (clsDate > lastClassDate) {
              lastClassDate = clsDate;
            }
            
            // Use the actual class status from database - don't force or derive anything
            const classStatus = cls.status || 'scheduled';
            const attended = cls.status === 'attended';
            
            items.push({
              lessonId: String(cls._id),
              class: cls._id,
              student: cls.student?.studentId || null,
              studentSnapshot: { firstName: fn || studentFullName || '', lastName: ln || '', email: '' },
              teacher: cls.teacher || null,
              description: `${cls.subject || 'Class'}`,
              date: cls.scheduledDate || firstDate,
              duration: Number(cls.duration || 0) || 0,
              rate: defaultRate,
              amount: Math.round((itemHours * defaultRate) * 100) / 100,
              attended: attended,
              status: classStatus
            });
          }
        }
      } catch (e) {
        console.warn('First-lesson invoice: failed to append additional classes:', e && e.message);
      }

      // Debug logging
      console.log(`[First-Lesson Invoice] Guardian: ${guardian.firstName} ${guardian.lastName}`);
      console.log(`[First-Lesson Invoice] Triggering class date: ${firstDate.toISOString()}`);
      console.log(`[First-Lesson Invoice] Billing start (earliest unbilled): ${billingStartDate.toISOString()}`);
      console.log(`[First-Lesson Invoice] Search end date (1 month from start): ${searchEndDate.toISOString()}`);
      console.log(`[First-Lesson Invoice] Total items: ${items.length}`);
      console.log(`[First-Lesson Invoice] Item details:`, items.map(it => ({
        date: it.date,
        duration: it.duration,
        amount: it.amount,
        description: it.description
      })));

      const subtotal = items.reduce((s, it) => s + (Number(it.amount || 0) || 0), 0);
      console.log(`[First-Lesson Invoice] Calculated subtotal: $${subtotal}`);

      // Calculate actual billing period from items (earliest to latest)
      const itemDates = items.map(it => new Date(it.date)).sort((a, b) => a - b);
      const actualStartDate = itemDates[0] || billingStartDate;
      const actualEndDate = itemDates[itemDates.length - 1] || searchEndDate;

      const invoice = new Invoice({
        type: 'guardian_invoice',
        guardian: guardian._id,
        billingType: 'payg',
        generationSource: 'first-lesson',
        billingPeriod: {
          startDate: actualStartDate,
          endDate: actualEndDate,
          month: actualStartDate.getMonth() + 1,
          year: actualStartDate.getFullYear()
        },
        items,
        subtotal,
        total: subtotal,
        status: 'pending',
        dueDate: dayjs(actualStartDate).add(7, 'day').toDate(),
        paymentMethod: guardian.guardianInfo?.preferredPaymentMethod || 'paypal',
        notes: `Auto-generated for lesson on **${dayjs(classDoc.scheduledDate).format('MMM D, YYYY')}**.`,
        guardianFinancial: buildGuardianFinancialSnapshot(guardian),
        coverage: { strategy: 'full_period', waiveTransferFee: false },
        internalNotes: `First lesson • ${dayjs(now).format('MMM D, h:mm A')} • Class ${classDoc._id}`
      });

      if (createdBy) {
        invoice.createdBy = createdBy;
        invoice.updatedBy = createdBy;
      }

      invoice.pushActivity({
        actor: createdBy,
        action: 'create',
        note: 'Auto-generated invoice for first recorded lesson',
        diff: { classId: classDoc._id ? classDoc._id.toString() : null }
      });

      await invoice.ensureIdentifiers({ forceNameRefresh: false });

      if (session) {
        await invoice.save({ session });
      } else {
        await invoice.save();
      }

      // ✅ CRITICAL: Mark all classes in this invoice as billed to prevent duplicates
      try {
        const Class = require('../models/Class');
        const classIdsToMark = items
          .map(it => it.class || it.lessonId)
          .filter(Boolean);
        
        if (classIdsToMark.length > 0) {
          const updateOps = classIdsToMark.map(classId => ({
            updateOne: {
              filter: { _id: classId },
              update: { $set: { billedInInvoiceId: invoice._id, billedAt: now, flaggedUninvoiced: false } }
            }
          }));
          
          if (session) {
            await Class.bulkWrite(updateOps, { session });
          } else {
            await Class.bulkWrite(updateOps);
          }
        }
      } catch (markErr) {
        console.error('Failed to mark classes as billed:', markErr);
        // Don't throw - invoice is already created
      }

      await invoice.populate([
        { path: 'guardian', select: 'firstName lastName email' },
        { path: 'items.student', select: 'firstName lastName email' }
      ]);

      await invoice.recordAuditEntry({
        actor: createdBy,
        action: 'create',
        diff: { generationSource: 'first-lesson', classId: classDoc._id, subtotal },
        meta: { classId: classDoc._id }
      }, { session });

      try {
        const notificationService = require('../services/notificationService');
        notificationService.notifyInvoiceEvent({ invoice, eventType: 'created' }).catch(console.error);
        // create a user-visible notification with actionLink if payment method is paypal
        if (invoice.paymentMethod === 'paypal') {
          const paypalBase = process.env.PAYPAL_PAYMENT_URL || 'https://www.paypal.com/invoice/paying/?invoice=';
          const payLink = `${paypalBase}${encodeURIComponent(invoice.paypalInvoiceNumber || invoice.invoiceNumber || invoice._id)}`;
          notificationService.createNotification({
            userId: invoice.guardian,
            title: 'Invoice ready to pay',
            message: 'A new invoice is ready. Open it to review and pay securely via PayPal.',
            type: 'invoice',
            relatedTo: 'invoice',
            relatedId: invoice._id,
            actionRequired: true,
            actionLink: payLink
          }).catch(console.error);
        }
      } catch (notifyErr) {
        console.warn('Failed to notify guardian about first-lesson invoice', notifyErr.message);
      }

      console.log(`✅ [InvoiceService] First-lesson invoice ${invoice.invoiceNumber || invoice._id} created for guardian ${guardian._id}`);
      return invoice;
    } catch (err) {
      console.error('Error creating first-lesson invoice:', err);
      throw err;
    }
  }

  /**
   * Create a guardian invoice for given zero-hour students.
   */
  static async createZeroHourInvoice(guardian, zeroHourStudents = [], opts = {}) {
    try {
  const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const defaultPackageHours = guardian.guardianInfo?.defaultPackageHours || 10;
      const defaultRate = guardian.guardianInfo?.hourlyRate || 10;
      const session = opts.session || null;
      const createdBy = opts.createdBy || null;
      const triggerSource = opts.triggeredBy === 'auto-payg' ? 'auto-payg' : 'manual';
      // If caller requested to invoice only due hours (guardian has negative balance)
      const dueOnlyHours = Number.isFinite(Number(opts.dueOnlyHours)) && Number(opts.dueOnlyHours) > 0 ? Number(opts.dueOnlyHours) : 0;
      let items = [];
      if (dueOnlyHours > 0) {
        const amount = Math.round((dueOnlyHours * defaultRate) * 100) / 100;
        items.push({
          lessonId: null,
          class: null,
          student: null,
          studentSnapshot: {},
          teacher: null,
          description: `Owed hours invoice: ${dueOnlyHours} hour${dueOnlyHours === 1 ? '' : 's'}`,
          date: now,
          duration: Math.round(dueOnlyHours * 60),
          rate: defaultRate,
          amount,
          attended: false
        });
      } else {
        items = zeroHourStudents.map(s => {
          const amount = defaultPackageHours * defaultRate;
          return {
            lessonId: null,
            class: null,
            student: s._id,
            studentSnapshot: { firstName: s.firstName, lastName: s.lastName, email: s.email || '' },
            teacher: null,
            description: `Refill ${defaultPackageHours} hours for ${s.firstName} ${s.lastName}`,
            date: now,
            duration: defaultPackageHours * 60,
            rate: defaultRate,
            amount,
            attended: false
          };
        });
      }

      const shouldForceGuardianTopUp = opts.reason === 'threshold_followup';

      // Guardian-level top-up if guardian totalHours <= 0 and no students listed
      if (!dueOnlyHours && (((guardian.guardianInfo?.totalHours || 0) <= 0 && zeroHourStudents.length === 0) || (shouldForceGuardianTopUp && zeroHourStudents.length === 0))) {
        const amount = defaultPackageHours * defaultRate;
        items.push({
          lessonId: null,
          class: null,
          student: null,
          studentSnapshot: {},
          teacher: null,
          description: `Guardian top-up ${defaultPackageHours} hours`,
          date: now,
          duration: defaultPackageHours * 60,
          rate: defaultRate,
          amount,
          attended: false
        });
      }

      let subtotal = items.reduce((sum, i) => sum + (i.amount || 0), 0);
      const dueDate = dayjs(now).add(7, 'day').toDate();

      // Initialize billing period - will be updated based on unpaid classes
      let billingStart = opts.billingPeriodStart instanceof Date ? opts.billingPeriodStart : now;
      let billingEnd = opts.billingPeriodEnd instanceof Date ? opts.billingPeriodEnd : dayjs(billingStart).add(1, 'month').toDate();

      // Predictive coverage: Find ALL unpaid classes first to determine billing start date
      // from the earliest unpaid class, then include all classes within one month from that date
      try {
        const trackedStudentIds = collectGuardianStudentIds(guardian, zeroHourStudents);

        if (trackedStudentIds.length >= 0) {
          // ✅ Exclude classes already in any active invoice
          const billedIds = await collectBilledClassIds({
            deleted: { $ne: true },
            status: { $nin: ['cancelled', 'refunded'] }
          });

          // ✅ FIRST: Find ALL unpaid classes to determine the billing start date
          const allUnpaidQuery = {
            'student.guardianId': guardian._id,
            _id: { $nin: billedIds }
          };
          if (trackedStudentIds.length > 0) {
            allUnpaidQuery['student.studentId'] = { $in: trackedStudentIds };
          }
          let allUnpaidClasses = await Class.find(allUnpaidQuery)
            .select('scheduledDate')
            .sort({ scheduledDate: 1 })
            .lean();

          if (!allUnpaidClasses.length && trackedStudentIds.length > 0) {
            if (INVOICE_DEBUG) {
              console.log('🔎 [Zero-Hour PAYG Invoice] Fallback to guardian-only class lookup (studentId filter yielded 0).');
            }
            allUnpaidClasses = await Class.find({
              'student.guardianId': guardian._id,
              _id: { $nin: billedIds }
            })
              .select('scheduledDate')
              .sort({ scheduledDate: 1 })
              .lean();
          }

          // Use the earliest unpaid class date as billing start, or today if no classes
          if (allUnpaidClasses.length > 0 && allUnpaidClasses[0].scheduledDate) {
            billingStart = new Date(allUnpaidClasses[0].scheduledDate);
            billingEnd = dayjs(billingStart).add(1, 'month').toDate();
          }

          console.log(`🔍 [Zero-Hour PAYG Invoice] Guardian: ${guardian.firstName} ${guardian.lastName}`);
          console.log(`🔍 [Zero-Hour PAYG Invoice] Total unpaid classes: ${allUnpaidClasses.length}`);
          console.log(`🔍 [Zero-Hour PAYG Invoice] Billing period: ${billingStart.toISOString()} → ${billingEnd.toISOString()}`);
          
          // ✅ Include ALL classes (scheduled, attended, missed, AND pending report submission) within billing period
          const upcomingQuery = {
            'student.guardianId': guardian._id,
            scheduledDate: { $gte: billingStart, $lt: billingEnd },
            // Exclude classes in active invoices
            _id: { $nin: billedIds },
            paidByGuardian: { $ne: true },
            // Include classes that are:
            // - Attended/absent (has report)
            // - Scheduled and within submission window (reportSubmission.status: 'open' or 'admin_extended')
            // - Scheduled with no submission status yet (class just ended)
            $or: [
              // Classes with reports submitted
              { 'classReport.submittedAt': { $exists: true } },
              // Scheduled classes within 72-hour window or with admin extension
              { 
                status: 'scheduled',
                $or: [
                  { 'reportSubmission.status': 'open' },
                  { 'reportSubmission.status': 'admin_extended' },
                  { 'reportSubmission.status': { $exists: false } }, // No tracking yet
                  { 'reportSubmission.status': 'pending' }
                ]
              },
              // Attended/absent classes
              { status: 'attended' },
              { status: 'missed_by_student' }
            ]
          };
          if (trackedStudentIds.length > 0) {
            upcomingQuery['student.studentId'] = { $in: trackedStudentIds };
          }

          let upcoming = await Class.find(upcomingQuery)
            .select('_id subject scheduledDate duration student teacher status reportSubmission')
            .lean();

          if (!upcoming.length && trackedStudentIds.length > 0) {
            if (INVOICE_DEBUG) {
              console.log('🔎 [Zero-Hour PAYG Invoice] Fallback upcoming lookup without studentId filter.');
            }
            const fallbackUpcomingQuery = {
              'student.guardianId': guardian._id,
              scheduledDate: { $gte: billingStart, $lt: billingEnd },
              _id: { $nin: billedIds },
              paidByGuardian: { $ne: true },
              $or: upcomingQuery.$or
            };
            upcoming = await Class.find(fallbackUpcomingQuery)
              .select('_id subject scheduledDate duration student teacher status reportSubmission')
              .lean();
          }

          console.log(`🔍 [Zero-Hour PAYG Invoice] Found ${upcoming.length} classes in billing period`);

          if (Array.isArray(upcoming) && upcoming.length > 0) {
            const rate = guardian.guardianInfo?.hourlyRate || defaultRate;
            items = upcoming.map((cls) => {
              const fullName = (cls.student && cls.student.studentName) || '';
              const [firstName, ...rest] = String(fullName).trim().split(' ').filter(Boolean);
              const lastName = rest.join(' ');
              
              // Use the actual class status from database - don't force or derive anything
              const classStatus = cls.status || 'scheduled';
              const attended = cls.status === 'attended';
              
              return {
                lessonId: cls._id ? String(cls._id) : null,
                class: cls._id || null,
                student: cls.student?.studentId || null,
                studentSnapshot: { firstName: firstName || fullName || '', lastName: lastName || '', email: '' },
                teacher: cls.teacher || null,
                description: `${cls.subject || 'Class'}`,
                date: cls.scheduledDate || billingStart,
                duration: Number(cls.duration || 0) || 0,
                rate: rate,
                amount: Math.round(((Number(cls.duration || 0) / 60) * rate) * 100) / 100,
                attended: attended,
                status: classStatus
              };
            });
            subtotal = items.reduce((sum, i) => sum + (Number(i.amount || 0)), 0);
            console.log(`💰 [Zero-Hour PAYG Invoice] Created ${items.length} items, Subtotal: $${subtotal.toFixed(2)}`);
          }
        }
      } catch (predictErr) {
        console.warn('Predictive coverage fallback (using top-up items):', predictErr && predictErr.message);
      }

      const invoice = new Invoice({
        type: 'guardian_invoice',
        guardian: guardian._id,
        billingType: 'payg',
        generationSource: triggerSource,
        billingPeriod: {
          startDate: billingStart,
          endDate: billingEnd,
          month: (billingStart.getMonth ? billingStart.getMonth() + 1 : month),
          year: (billingStart.getFullYear ? billingStart.getFullYear() : year)
        },
        items,
        subtotal,
        total: subtotal,
        status: 'pending',
        dueDate,
        paymentMethod: guardian.guardianInfo?.preferredPaymentMethod || 'paypal',
        notes: opts.reason 
          ? opts.reason
          : `Account balance low. Invoice created for upcoming classes.`,
        guardianFinancial: buildGuardianFinancialSnapshot(guardian),
        coverage: {
          strategy: 'full_period',
          waiveTransferFee: false
        },
        internalNotes: `${triggerSource} • ${dayjs(now).format('MMM D, h:mm A')} • ${guardian.firstName} ${guardian.lastName}`
      });

      if (createdBy) {
        invoice.createdBy = createdBy;
        invoice.updatedBy = createdBy;
      }

      invoice.pushActivity({
        actor: createdBy,
        action: 'create',
        note: `Auto-generated zero-hour top-up (${triggerSource})`,
        diff: {
          students: zeroHourStudents.map((s) => ({
            id: s._id ? s._id.toString() : undefined,
            hoursRemaining: Number(s.hoursRemaining || 0)
          })),
          trigger: triggerSource
        }
      });

      await invoice.ensureIdentifiers({ forceNameRefresh: false });

      if (session) {
        await invoice.save({ session });
      } else {
        await invoice.save();
      }

      const populateSpec = [
        { path: 'guardian', select: 'firstName lastName email' },
        { path: 'items.student', select: 'firstName lastName email' }
      ];

      if (session) {
        populateSpec.forEach((spec) => {
          spec.options = { session };
        });
      }

      await invoice.populate(populateSpec);

      // Link classes to this invoice so future audits won't flag them, and UI shows linkage
      try {
        const classIds = items.map((it) => it.class).filter(Boolean);
        if (classIds.length) {
          const updateQuery = { _id: { $in: classIds } };
          const updateDoc = { $set: { billedInInvoiceId: invoice._id, billedAt: new Date(), flaggedUninvoiced: false } };
          if (session) {
            await Class.updateMany(updateQuery, updateDoc).session(session);
          } else {
            await Class.updateMany(updateQuery, updateDoc);
          }
        }
      } catch (linkErr) {
        console.warn('Failed to link classes to invoice during creation:', linkErr && linkErr.message);
      }

      await invoice.recordAuditEntry({
        actor: createdBy,
        action: 'create',
        diff: {
          billingType: invoice.billingType,
          generationSource: triggerSource,
          subtotal,
          itemCount: items.length,
          students: zeroHourStudents.map((s) => ({
            id: s._id ? s._id.toString() : undefined,
            hoursRemaining: Number(s.hoursRemaining || 0)
          }))
        },
        meta: {
          reason: opts.reason || null,
          trigger: triggerSource
        }
      }, { session });

      console.log(`✅ [InvoiceService] Invoice ${invoice.invoiceNumber} created (guardian ${guardian.firstName} ${guardian.lastName})`);
      return invoice;
    } catch (err) {
      console.error('Error creating zero hour invoice:', err);
      throw err;
    }
  }

  /**
   * Handle class state changes and reflect them on the linked invoice.
   * - If invoice is unpaid: directly modify the item (duration/attendance) and recalc.
   * - If invoice is paid/partially: apply adjustments (increase or refund/remove) with audit and notifications.
   * 
   * 💰 ALSO UPDATES TEACHER AND GUARDIAN HOURS when status changes affect billing
   * 🔒 PREVENTS DUPLICATE ADJUSTMENTS on report re-submissions
   */
  static async onClassStateChanged(classDoc, prev = {}) {
    try {
      const classId = classDoc && (classDoc._id || classDoc.id);
      const invoiceId = classDoc && classDoc.billedInInvoiceId;
      
      // Helper to check if status is "countable" (affects hours)
      const isCountableStatus = (status) => {
        return ['attended', 'missed_by_student', 'absent'].includes(status);
      };

      const wasCountable = prev.status && isCountableStatus(prev.status);
      const isNowCountable = classDoc.status && isCountableStatus(classDoc.status);
      const statusChanged = prev && typeof prev.status !== 'undefined' && String(prev.status) !== String(classDoc.status);
      const skipHourAdjustment = prev?.skipHourAdjustment === true;
      
      // Check if duration changed for a reported class
      const prevDuration = Number(prev.duration || 0);
      const currentDuration = Number(classDoc.duration || 0);
      const durationChanged = prevDuration !== currentDuration && prevDuration > 0;

      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📊 [Class State Change] Class ID: ${classId}`);
      console.log(`📊 [Class State Change] Invoice ID: ${invoiceId || 'None'}`);
      console.log(`📊 [Class State Change] Status: ${prev.status || 'N/A'} → ${classDoc.status}`);
      console.log(`📊 [Class State Change] Duration: ${prev.duration || 'N/A'} min → ${classDoc.duration} min`);
      console.log(`📊 [Class State Change] Duration Changed: ${durationChanged}`);
      console.log(`📊 [Class State Change] Status Changed: ${statusChanged}`);
      console.log(`📊 [Class State Change] Was Countable: ${wasCountable}, Now Countable: ${isNowCountable}`);
      console.log(`📊 [Class State Change] Skip Hour Adjustment: ${skipHourAdjustment}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      // 💰 UPDATE TEACHER AND GUARDIAN HOURS based on status change
      // 🔒 SKIP if this is a report re-submission (already adjusted hours before)
      if (statusChanged && !skipHourAdjustment) {
        console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
        console.log(`║  💰 HOUR ADJUSTMENT PROCESS - CLASS STATUS CHANGE            ║`);
        console.log(`╚════════════════════════════════════════════════════════════════╝`);
        console.log(`📋 Class ID: ${classId}`);
        console.log(`📅 Date: ${classDoc.scheduledDate || 'N/A'}`);
        console.log(`📚 Subject: ${classDoc.subject || 'N/A'}`);
        console.log(`⏱️  Duration: ${classDoc.duration || 60} minutes`);
        console.log(`🔄 Status Change: ${prev.status || 'N/A'} → ${classDoc.status}`);
        console.log(`📊 Was Countable: ${wasCountable ? 'YES ✅' : 'NO ❌'}`);
        console.log(`📊 Now Countable: ${isNowCountable ? 'YES ✅' : 'NO ❌'}`);
        console.log(`════════════════════════════════════════════════════════════════\n`);

        const classDuration = Number(classDoc.duration || 60);
        const classHours = classDuration / 60;
        const User = require('../models/User');
        
        // Extract guardian ID - handle both populated and unpopulated cases
        const guardianId = classDoc.student?.guardianId?._id || classDoc.student?.guardianId;
        
        console.log(`🔍 [Debug] Class student structure:`, {
          hasStudent: !!classDoc.student,
          hasGuardianId: !!guardianId,
          guardianId: guardianId?.toString(),
          studentStructure: classDoc.student
        });

        // Scenario: Was NOT countable → NOW countable (e.g., scheduled → attended, cancelled → attended)
        // Action: ADD hours to teacher, SUBTRACT from guardian
        if (!wasCountable && isNowCountable) {
          console.log(`┌─────────────────────────────────────────────────────────────┐`);
          console.log(`│  📈 NON-COUNTABLE → COUNTABLE (Class Now Counts for Billing) │`);
          console.log(`└─────────────────────────────────────────────────────────────┘`);
          console.log(`💡 Action Plan:`);
          console.log(`   ✓ ADD ${classHours.toFixed(2)}h to teacher (they worked)`);
          console.log(`   ✓ SUBTRACT ${classHours.toFixed(2)}h from guardian (they used hours)\n`);

          // Add hours to teacher
          if (classDoc.teacher) {
            console.log(`👨‍🏫 UPDATING TEACHER HOURS...`);
            console.log(`─────────────────────────────────────────────────────────────`);
            try {
              const teacher = await User.findById(classDoc.teacher);
              if (teacher && teacher.role === 'teacher') {
                const oldHours = Number(teacher.teacherInfo?.monthlyHours || 0);
                console.log(`📌 Teacher: ${teacher.firstName} ${teacher.lastName} (${teacher._id})`);
                console.log(`📉 Current Hours: ${oldHours.toFixed(2)}h`);
                console.log(`➕ Adding: +${classHours.toFixed(2)}h`);
                
                await teacher.addTeachingHours(classHours);
                const newHours = Number(teacher.teacherInfo?.monthlyHours || 0);
                
                console.log(`📈 New Hours: ${newHours.toFixed(2)}h`);
                console.log(`✅ Teacher hours updated successfully!`);
                console.log(`─────────────────────────────────────────────────────────────\n`);
              } else {
                console.log(`⚠️  Teacher not found or invalid role`);
                console.log(`─────────────────────────────────────────────────────────────\n`);
              }
            } catch (err) {
              console.error(`❌ [Teacher Hours] Failed to update:`, err.message);
              console.error(`Stack:`, err.stack);
              console.log(`─────────────────────────────────────────────────────────────\n`);
            }
          } else {
            console.log(`⚠️  No teacher assigned to this class - skipping teacher hours`);
            console.log(`─────────────────────────────────────────────────────────────\n`);
          }

          // Subtract hours from guardian (ONLY guardian total, not individual students)
          if (guardianId) {
            console.log(`\n👪 UPDATING GUARDIAN HOURS...`);
            console.log(`─────────────────────────────────────────────────────────────`);
            try {
              const guardian = await User.findById(guardianId);
              if (guardian && guardian.role === 'guardian') {
                const oldTotalHours = Number(guardian.guardianInfo?.totalHours || 0);
                
                console.log(`📌 Guardian: ${guardian.firstName} ${guardian.lastName} (${guardian._id})`);
                console.log(`📈 Current Total Hours: ${oldTotalHours.toFixed(2)}h`);
                console.log(`➖ Subtracting: -${classHours.toFixed(2)}h`);
                
                // Find the student in guardian's students array
                const studentId = classDoc.student?.studentId?._id || classDoc.student?.studentId;
                if (studentId && Array.isArray(guardian.guardianInfo?.students)) {
                  const studentIndex = findGuardianStudentIndex(guardian, studentId);
                  
                  if (studentIndex !== -1) {
                    const student = guardian.guardianInfo.students[studentIndex];
                    const oldStudentHours = Number(student.hoursRemaining || 0);
                    
                    // Update student's hours (can go negative)
                    guardian.guardianInfo.students[studentIndex].hoursRemaining = oldStudentHours - classHours;
                    // Record cumulative consumed hours for this guardian (all-time counter)
                    try {
                      guardian.guardianInfo.cumulativeConsumedHours = (guardian.guardianInfo.cumulativeConsumedHours || 0) + classHours;
                    } catch (incErr) {
                      console.warn('Failed to increment guardian cumulativeConsumedHours', incErr && incErr.message);
                    }
                    guardian.markModified('guardianInfo.students');
                    
                    console.log(`👦 Student: ${student.firstName} ${student.lastName}`);
                    console.log(`   📉 Old Hours: ${oldStudentHours.toFixed(2)}h`);
                    console.log(`   📈 New Hours: ${(oldStudentHours - classHours).toFixed(2)}h`);
                  } else {
                    console.log(`⚠️  Student not found in guardian's students array`);
                  }
                }
                
                const newTotalHoursValue = oldTotalHours - classHours;
                guardian.guardianInfo.totalHours = newTotalHoursValue;
                guardian.markModified('guardianInfo');

                await guardian.save();
                const newTotalHours = Number(guardian.guardianInfo?.totalHours || 0);
                
                console.log(`📉 New Total Hours: ${newTotalHours.toFixed(2)}h`);
                console.log(`✅ Guardian hours updated successfully!`);
                console.log(`─────────────────────────────────────────────────────────────\n`);
              } else {
                console.log(`⚠️  Guardian not found or invalid role`);
                console.log(`─────────────────────────────────────────────────────────────\n`);
              }
            } catch (err) {
              console.error(`❌ [Guardian Hours] Failed to update:`, err.message);
              console.error(`Stack:`, err.stack);
              console.log(`─────────────────────────────────────────────────────────────\n`);
            }
          } else {
            console.log(`⚠️  No guardian assigned to this class - skipping guardian hours`);
            console.log(`─────────────────────────────────────────────────────────────\n`);
          }
        }

        // Scenario: WAS countable → NOW NOT countable (e.g., attended → cancelled, attended → scheduled)
        // Action: SUBTRACT hours from teacher, ADD to guardian
        if (wasCountable && !isNowCountable) {
          console.log(`\n💰 [Hours Update] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
          console.log(`💰 [Hours Update] Class ${classId}: Status changed to NON-COUNTABLE (${classDoc.status})`);
          console.log(`💰 [Hours Update] Action: SUBTRACT ${classHours}h from teacher, ADD to guardian`);
          console.log(`💰 [Hours Update] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

          // Subtract hours from teacher
          if (classDoc.teacher) {
            try {
              const teacher = await User.findById(classDoc.teacher);
              if (teacher && teacher.role === 'teacher') {
                const oldHours = Number(teacher.teacherInfo?.monthlyHours || 0);
                await teacher.addTeachingHours(-classHours); // Negative to subtract
                const newHours = Number(teacher.teacherInfo?.monthlyHours || 0);
                
                console.log(`✅ [Teacher Hours] Updated ${teacher._id} (${teacher.firstName} ${teacher.lastName})`);
                console.log(`   📉 OLD: ${oldHours.toFixed(2)}h`);
                console.log(`   📈 NEW: ${newHours.toFixed(2)}h`);
                console.log(`   ➖ CHANGE: -${classHours.toFixed(2)}h\n`);
              }
            } catch (err) {
              console.error(`❌ [Hours Update] Failed to update teacher hours:`, err);
            }
          }

          // Add hours to guardian (ONLY guardian total, not individual students)
          if (guardianId) {
            console.log(`\n👪 UPDATING GUARDIAN HOURS...`);
            console.log(`─────────────────────────────────────────────────────────────`);
            try {
              const guardian = await User.findById(guardianId);
              if (guardian && guardian.role === 'guardian') {
                const oldTotalHours = Number(guardian.guardianInfo?.totalHours || 0);
                
                console.log(`📌 Guardian: ${guardian.firstName} ${guardian.lastName} (${guardian._id})`);
                console.log(`📉 Current Total Hours: ${oldTotalHours.toFixed(2)}h`);
                console.log(`➕ Adding: +${classHours.toFixed(2)}h`);
                
                // Find the student in guardian's students array
                const studentId = classDoc.student?.studentId?._id || classDoc.student?.studentId;
                if (studentId && Array.isArray(guardian.guardianInfo?.students)) {
                  const studentIndex = findGuardianStudentIndex(guardian, studentId);
                  
                  if (studentIndex !== -1) {
                    const student = guardian.guardianInfo.students[studentIndex];
                    const oldStudentHours = Number(student.hoursRemaining || 0);
                    
                    // Update student's hours (add back)
                    guardian.guardianInfo.students[studentIndex].hoursRemaining = oldStudentHours + classHours;
                    // Note: Do NOT decrement cumulativeConsumedHours when hours are added back. Cumulative tracks historical consumption.
                    guardian.markModified('guardianInfo.students');
                    
                    console.log(`👦 Student: ${student.firstName} ${student.lastName}`);
                    console.log(`   📉 Old Hours: ${oldStudentHours.toFixed(2)}h`);
                    console.log(`   📈 New Hours: ${(oldStudentHours + classHours).toFixed(2)}h`);
                  } else {
                    console.log(`⚠️  Student not found in guardian's students array`);
                  }
                }
                
                const newTotalHoursValue = oldTotalHours + classHours;
                guardian.guardianInfo.totalHours = newTotalHoursValue;
                guardian.markModified('guardianInfo');

                await guardian.save();
                const newTotalHours = Number(guardian.guardianInfo?.totalHours || 0);
                
                console.log(`📈 New Total Hours: ${newTotalHours.toFixed(2)}h`);
                console.log(`✅ Guardian hours updated successfully!`);
                console.log(`─────────────────────────────────────────────────────────────\n`);
              } else {
                console.log(`⚠️  Guardian not found or invalid role`);
                console.log(`─────────────────────────────────────────────────────────────\n`);
              }
            } catch (err) {
              console.error(`❌ [Guardian Hours] Failed to update:`, err.message);
              console.error(`Stack:`, err.stack);
              console.log(`─────────────────────────────────────────────────────────────\n`);
            }
          } else {
            console.log(`⚠️  No guardian assigned to this class - skipping guardian hours`);
            console.log(`─────────────────────────────────────────────────────────────\n`);
          }
        }
      } else if (statusChanged && skipHourAdjustment) {
        console.log(`\n🔒 [Hours Update] SKIPPED - Report re-submission detected`);
        console.log(`🔒 [Hours Update] Hours were already adjusted during first submission\n`);
      }

      // 🕐 HANDLE DURATION CHANGES for reported classes
      // If duration changed for a countable (reported) class, adjust hours
      if (durationChanged && isNowCountable && !skipHourAdjustment) {
        console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
        console.log(`║  ⏱️  DURATION CHANGE DETECTED - ADJUSTING HOURS              ║`);
        console.log(`╚════════════════════════════════════════════════════════════════╝`);
        console.log(`📋 Class ID: ${classId}`);
        console.log(`📅 Date: ${classDoc.scheduledDate || 'N/A'}`);
        console.log(`📚 Subject: ${classDoc.subject || 'N/A'}`);
        console.log(`⏱️  Duration Change: ${prevDuration} min → ${currentDuration} min`);
        console.log(`📊 Status: ${classDoc.status} (Countable)`);
        console.log(`════════════════════════════════════════════════════════════════\n`);

        const oldHours = prevDuration / 60;
        const newHours = currentDuration / 60;
        const hoursDiff = newHours - oldHours;
        
        console.log(`💡 Calculation:`);
        console.log(`   📉 Old Hours: ${oldHours.toFixed(2)}h (${prevDuration} min ÷ 60)`);
        console.log(`   📈 New Hours: ${newHours.toFixed(2)}h (${currentDuration} min ÷ 60)`);
        console.log(`   🔄 Difference: ${hoursDiff > 0 ? '+' : ''}${hoursDiff.toFixed(2)}h\n`);

        const User = require('../models/User');

        // Adjust teacher hours
        if (classDoc.teacher && hoursDiff !== 0) {
          console.log(`👨‍🏫 UPDATING TEACHER HOURS...`);
          console.log(`─────────────────────────────────────────────────────────────`);
          try {
            const teacher = await User.findById(classDoc.teacher);
            if (teacher && teacher.role === 'teacher') {
              const oldTeacherHours = Number(teacher.teacherInfo?.monthlyHours || 0);
              console.log(`📌 Teacher: ${teacher.firstName} ${teacher.lastName} (${teacher._id})`);
              console.log(`📉 Current Monthly Hours: ${oldTeacherHours.toFixed(2)}h`);
              console.log(`${hoursDiff > 0 ? '➕' : '➖'} Adjustment: ${hoursDiff > 0 ? '+' : ''}${hoursDiff.toFixed(2)}h`);
              
              await teacher.addTeachingHours(hoursDiff);
              const newTeacherHours = Number(teacher.teacherInfo?.monthlyHours || 0);
              
              console.log(`📈 New Monthly Hours: ${newTeacherHours.toFixed(2)}h`);
              console.log(`✅ Teacher hours updated successfully!`);
              console.log(`─────────────────────────────────────────────────────────────\n`);
            } else {
              console.log(`⚠️  Teacher not found or invalid role`);
              console.log(`─────────────────────────────────────────────────────────────\n`);
            }
          } catch (err) {
            console.error(`❌ [Teacher Hours] Failed to update:`, err.message);
            console.error(`Stack:`, err.stack);
            console.log(`─────────────────────────────────────────────────────────────\n`);
          }
        } else if (!classDoc.teacher) {
          console.log(`⚠️  No teacher assigned - skipping teacher hours update`);
          console.log(`─────────────────────────────────────────────────────────────\n`);
        }

        // Adjust guardian hours (opposite direction - if teacher gets more, guardian uses more)
        if (guardianId && hoursDiff !== 0) {
          console.log(`👨‍👩‍👧 UPDATING GUARDIAN HOURS...`);
          console.log(`─────────────────────────────────────────────────────────────`);
          try {
            const guardian = await User.findById(guardianId);
            if (guardian && guardian.role === 'guardian') {
              const oldGuardianHours = Number(guardian.guardianInfo?.totalHours || 0);
              console.log(`📌 Guardian: ${guardian.firstName} ${guardian.lastName} (${guardian._id})`);
              console.log(`📉 Current Total Hours: ${oldGuardianHours.toFixed(2)}h`);
              console.log(`${hoursDiff > 0 ? '➖' : '➕'} Adjustment: ${hoursDiff > 0 ? '-' : '+'}${Math.abs(hoursDiff).toFixed(2)}h`);
              
              // Find the student in guardian's students array
              const studentId = classDoc.student?.studentId?._id || classDoc.student?.studentId;
              if (studentId && Array.isArray(guardian.guardianInfo?.students)) {
                const studentIndex = findGuardianStudentIndex(guardian, studentId);

                if (studentIndex !== -1) {
                  const student = guardian.guardianInfo.students[studentIndex];
                  const oldStudentHours = Number(student.hoursRemaining || 0);
                  
                  // Opposite direction: if class duration increases, guardian loses hours
                  guardian.guardianInfo.students[studentIndex].hoursRemaining = oldStudentHours - hoursDiff;
                  // Increment cumulative consumed hours for the guardian when net hours are consumed
                  try {
                    if (typeof hoursDiff === 'number' && hoursDiff > 0) {
                      guardian.guardianInfo.cumulativeConsumedHours = (guardian.guardianInfo.cumulativeConsumedHours || 0) + hoursDiff;
                    }
                  } catch (incErr) {
                    console.warn('Failed to increment guardian cumulativeConsumedHours on duration change', incErr && incErr.message);
                  }
                  guardian.markModified('guardianInfo.students');
                  
                  console.log(`👦 Student: ${student.firstName} ${student.lastName}`);
                  console.log(`   📉 Old Hours: ${oldStudentHours.toFixed(2)}h`);
                  console.log(`   📈 New Hours: ${(oldStudentHours - hoursDiff).toFixed(2)}h`);
                } else {
                  console.log(`⚠️  Student not found in guardian's students array`);
                }
              }
              
              await guardian.save();
              
              const newGuardianHours = Number(guardian.guardianInfo?.totalHours || 0);
              console.log(`📈 New Total Hours: ${newGuardianHours.toFixed(2)}h`);
              console.log(`✅ Guardian hours updated successfully!`);
              console.log(`─────────────────────────────────────────────────────────────\n`);
            } else {
              console.log(`⚠️  Guardian not found or invalid role`);
              console.log(`─────────────────────────────────────────────────────────────\n`);
            }
          } catch (err) {
            console.error(`❌ [Guardian Hours] Failed to update:`, err.message);
            console.error(`Stack:`, err.stack);
            console.log(`─────────────────────────────────────────────────────────────\n`);
          }
        } else if (!guardianId) {
          console.log(`⚠️  No guardian assigned - skipping guardian hours update`);
          console.log(`─────────────────────────────────────────────────────────────\n`);
        }
      }

      // Now handle invoice updates
      // 🔥 NEW: If class is paid in another invoice, remove it from all unpaid invoices
      if (!invoiceId) {
        // Class not linked to any invoice yet - check if we should add it to an unpaid invoice
        await InvoiceService.maybeAddClassToUnpaidInvoice(classDoc);
        return { success: true, reason: 'not_linked', hoursUpdated: statusChanged && !skipHourAdjustment };
      }

      if (!classId) return { success: false, reason: 'no_class_id' };

      const Invoice = require('../models/Invoice');
      const User = require('../models/User');
      const inv = await Invoice.findById(invoiceId).populate('guardian').exec();
      if (!inv) return { success: false, reason: 'invoice_not_found' };

      const item = (inv.items || []).find((it) => {
        const c = it.class ? String(it.class) : null;
        const lid = it.lessonId ? String(it.lessonId) : null;
        const key = String(classId);
        return c === key || lid === key;
      });
      if (!item) return { success: false, reason: 'item_not_found' };

      // 🔥 NEW: If the class's linked invoice is paid, check if we need to recalculate
      if (inv.status === 'paid') {
        // Check for status changes that require recalculation even for paid invoices
        // "Was attended" means any countable status (attended, missed_by_student, absent)
        const wasCountableInInvoice = prev.status === 'attended' || prev.status === 'missed_by_student' || prev.status === 'absent' || item.attended === true;
        const becameCancelledNow = String(classDoc.status).startsWith('cancelled') || classDoc.status === 'no_show_both';
        const wasCancelledBefore = String(prev.status || '').startsWith('cancelled') || prev.status === 'no_show_both';
        const isCountableNow = classDoc.status === 'attended' || classDoc.status === 'missed_by_student' || classDoc.status === 'absent';

        // Scenario: Countable → Cancelled (attended/absent → cancelled)
        // Remove from invoice, replace with unpaid class
        if (statusChanged && wasCountableInInvoice && becameCancelledNow) {
          console.log(`🔄 [Invoice Recalculation] Paid invoice - Countable → Cancelled`);
          console.log(`🔄 [Invoice Recalculation] Previous status: ${prev.status}, New status: ${classDoc.status}`);
          console.log(`🔄 [Invoice Recalculation] Class ${classId} will be removed from invoice ${inv.invoiceNumber}`);
          console.log(`🔄 [Invoice Recalculation] Item ID to remove: ${item._id}`);
          
          // Remove this class from the invoice
          const itemsToRemove = [String(item._id)];
          const removeResult = await InvoiceService.updateInvoiceItems(
            String(inv._id),
            {
              removeItemIds: itemsToRemove,
              note: `Class cancelled: ${classDoc.subject || 'Class'} on ${classDoc.scheduledDate}`,
              allowPaidModification: true
            },
            null
          );
          
          console.log(`✅ [Invoice Recalculation] Remove result:`, removeResult);

          // Trigger recalculation to replace with next unpaid class
          const recalcResult = await InvoiceService.recalculateInvoiceCoverage(
            inv._id,
            {
              trigger: 'status_change_cancelled',
              deletedClassId: classId,
              adminUserId: null
            }
          );

          console.log(`✅ [Invoice Recalculation] Recalc result:`, recalcResult);
          
          return {
            success: true,
            statusChange: 'countable_to_cancelled',
            removedFromInvoice: true,
            recalcResult,
            hoursUpdated: statusChanged && !skipHourAdjustment
          };
        }

        // Scenario: Cancelled → Countable (cancelled → attended/absent)
        // Re-add to invoice
        if (statusChanged && wasCancelledBefore && isCountableNow) {
          console.log(`🔄 [Invoice Recalculation] Paid invoice - Cancelled → Attended, re-adding class`);
          
          const rate = Number(item.rate || inv.guardianFinancial?.hourlyRate || 10);
          const duration = Number(classDoc.duration || 60);
          const hours = duration / 60;
          const amount = Math.round(hours * rate * 100) / 100;

          const studentName = classDoc.student?.studentName || item.studentSnapshot?.firstName || '';
          const [firstName, ...rest] = String(studentName).trim().split(' ').filter(Boolean);
          const lastName = rest.join(' ');

          await InvoiceService.updateInvoiceItems(
            String(inv._id),
            {
              addItems: [{
                lessonId: String(classId),
                class: classId,
                student: item.student || classDoc.student?.studentId,
                studentSnapshot: {
                  firstName: firstName || studentName,
                  lastName: lastName || '',
                  email: ''
                },
                teacher: item.teacher || classDoc.teacher,
                description: `${classDoc.subject || 'Class'} (Re-added after status change)`,
                date: classDoc.scheduledDate,
                duration: duration,
                rate: rate,
                amount: amount,
                attended: true
              }],
              note: `Class re-added: changed from cancelled to attended`,
              allowPaidModification: true
            },
            null
          );

          console.log(`✅ [Invoice Recalculation] Successfully re-added attended class`);
          
          return {
            success: true,
            statusChange: 'cancelled_to_attended',
            addedToInvoice: true,
            hoursUpdated: statusChanged && !skipHourAdjustment
          };
        }

        // No status change requiring recalculation - just remove from unpaid invoices
        await InvoiceService.removeClassFromUnpaidInvoices(classId, invoiceId);
        return { success: true, reason: 'paid_invoice_no_recalc_needed', hoursUpdated: statusChanged && !skipHourAdjustment };
      }

      const newMinutes = Number(classDoc.duration || 0) || 0;
      const oldMinutes = Number(prev && prev.duration !== undefined ? prev.duration : item.duration || 0) || 0;
      const deltaMinutes = newMinutes - oldMinutes;
      const deltaHours = deltaMinutes / 60;
      const rate = Number(item.rate || inv.guardianFinancial?.hourlyRate || 0) || 0;
      const deltaAmount = Math.round(deltaHours * rate * 100) / 100;

      const toAttendance = (status) => {
        if (status === 'attended') return { attended: true, attendanceStatus: 'attended' };
        if (String(status || '')?.startsWith('cancelled')) return { attended: false, attendanceStatus: 'cancelled' };
        if (status === 'missed_by_student') return { attended: false, attendanceStatus: 'student_absent' };
        return { attended: false, attendanceStatus: null };
      };

      // If invoice is not fully settled yet, modify item directly
      if (!['paid', 'partially_paid', 'sent', 'overdue'].includes(inv.status)) {
        const updates = { modifyItems: [ { _id: String(item._id), duration: newMinutes, ...toAttendance(classDoc.status) } ], note: 'Auto-update from class change' };
        return await InvoiceService.updateInvoiceItems(String(inv._id), updates, null);
      }

      // Paid/partially/sent/overdue: apply adjustments for other scenarios
      if (statusChanged) {
        // If moved to a non-attended state, refund this lesson's full amount/hours
        const becameCancelled = String(classDoc.status).startsWith('cancelled') || classDoc.status === 'missed_by_student' || classDoc.status === 'no_show_both';
        const wasAttended = prev.status === 'attended' || item.attended === true;
        if (becameCancelled && wasAttended && !['paid', 'partially_paid'].includes(inv.status)) {
          return await InvoiceService.applyPostPaymentAdjustment(String(inv._id), {
            type: 'removeLessons',
            itemIds: [ String(item._id) ],
            mode: 'refund'
          }, null);
        }
      }

      if (deltaMinutes !== 0) {
        if (deltaMinutes > 0) {
          // Increase: add an adjustment item
          return await InvoiceService.applyPostPaymentAdjustment(String(inv._id), {
            type: 'increase',
            addItems: [ {
              lessonId: `${String(classId)}:adj:${Date.now()}`,
              class: classId,
              student: item.student,
              description: 'Adjustment: class duration increased',
              date: new Date(),
              duration: deltaMinutes,
              rate: rate,
              amount: deltaAmount,
              attended: toAttendance(classDoc.status).attended
            } ]
          }, null);
        } else {
          // Reduction: refund delta hours
          return await InvoiceService.applyPostPaymentAdjustment(String(inv._id), {
            type: 'reduction',
            amount: Math.abs(deltaAmount),
            refundHours: Math.abs(deltaHours),
            reason: 'Adjustment: class duration decreased'
          }, null);
        }
      }

      return { success: true, noChange: true, hoursUpdated: statusChanged && !skipHourAdjustment };
    } catch (err) {
      console.warn('[onClassStateChanged] failed:', err && err.message);
      return { success: false, error: err && err.message };
    }
  }

  /**
   * 🔥 NEW: Remove a paid class from all unpaid invoices
   * When a class is paid in one invoice, it should not appear in any other invoices
   */
  static async removeClassFromUnpaidInvoices(classId, paidInvoiceId) {
    try {
      const Invoice = require('../models/Invoice');
      const Class = require('../models/Class');
      
      // Find all unpaid invoices containing this class
      const unpaidInvoices = await Invoice.find({
        _id: { $ne: paidInvoiceId },
        $or: [
          { 'items.class': classId },
          { 'items.lessonId': String(classId) }
        ],
        status: { $in: ['draft', 'pending'] }, // Only modify draft/pending invoices
        deleted: { $ne: true }
      });

      for (const invoice of unpaidInvoices) {
        console.log(`[removeClassFromUnpaidInvoices] Removing class ${classId} from invoice ${invoice.invoiceNumber}`);
        
        // Find the item ID(s) for this class in this invoice
        const itemsToRemove = invoice.items
          .filter(item => String(item.class || item.lessonId) === String(classId))
          .map(item => String(item._id));
        
        if (itemsToRemove.length > 0) {
          // Remove the item from this invoice
          await InvoiceService.updateInvoiceItems(
            String(invoice._id),
            {
              removeItemIds: itemsToRemove,
              note: `Auto-removed: class paid in another invoice`
            },
            null
          );
        }
      }

      return { success: true, removed: unpaidInvoices.length };
    } catch (err) {
      console.warn('[removeClassFromUnpaidInvoices] failed:', err && err.message);
      return { success: false, error: err && err.message };
    }
  }

  /**
   * 🔥 NEW: Add a scheduled class to an unpaid invoice if appropriate
   * When a new class is scheduled, add it to the guardian's active unpaid invoice
   */
  static async maybeAddClassToUnpaidInvoice(classDoc) {
    try {
      const Invoice = require('../models/Invoice');
      const User = require('../models/User');
      
      // Only add scheduled or in-progress classes
      if (!['scheduled', 'in_progress'].includes(classDoc.status)) {
        return { success: false, reason: 'not_scheduled' };
      }

      const guardianId = classDoc.student?.guardianId;
      if (!guardianId) {
        return { success: false, reason: 'no_guardian' };
      }

      // Find the guardian's most recent unpaid invoice
      const unpaidInvoice = await Invoice.findOne({
        guardian: guardianId,
        type: 'guardian_invoice',
        status: { $in: ['draft', 'pending'] }, // Only add to draft/pending invoices
        deleted: { $ne: true }
      }).sort({ createdAt: -1 });

      if (!unpaidInvoice) {
        return { success: false, reason: 'no_unpaid_invoice' };
      }

      // 🔥 CRITICAL: Check if this class is already in ANY invoice (not just this one)
      // A class should only appear in ONE invoice, period
      const alreadyInAnyInvoice = await Invoice.findOne({
        $or: [
          { 'items.class': classDoc._id },
          { 'items.lessonId': String(classDoc._id) }
        ],
        deleted: { $ne: true },
        status: { $nin: ['cancelled', 'refunded'] }
      });

      if (alreadyInAnyInvoice) {
        console.log(`[maybeAddClassToUnpaidInvoice] Class ${classDoc._id} already in invoice ${alreadyInAnyInvoice.invoiceNumber}, skipping`);
        return { success: false, reason: 'already_in_another_invoice', invoiceId: alreadyInAnyInvoice._id };
      }

      // Check if the class date is within the invoice billing period
      const classDate = classDoc.scheduledDate || new Date();
      const billingStart = unpaidInvoice.billingPeriod?.startDate;
      const billingEnd = unpaidInvoice.billingPeriod?.endDate;
      
      if (billingStart && billingEnd) {
        if (classDate < billingStart || classDate >= billingEnd) {
          return { success: false, reason: 'outside_billing_period' };
        }
      }

      console.log(`[maybeAddClassToUnpaidInvoice] Adding class ${classDoc._id} to invoice ${unpaidInvoice.invoiceNumber}`);

      // Get guardian for rate
      const guardian = await User.findById(guardianId);
      const rate = guardian?.guardianInfo?.hourlyRate || 10;
      const duration = Number(classDoc.duration || 60);
      const hours = duration / 60;
      const amount = Math.round(hours * rate * 100) / 100;

      const studentName = classDoc.student?.studentName || '';
      const [firstName, ...rest] = String(studentName).trim().split(' ').filter(Boolean);
      const lastName = rest.join(' ');

      // Add the class to the invoice
      await InvoiceService.updateInvoiceItems(
        String(unpaidInvoice._id),
        {
          addItems: [{
            lessonId: String(classDoc._id),
            class: classDoc._id,
            student: classDoc.student?.studentId,
            studentSnapshot: { firstName: firstName || studentName, lastName: lastName || '', email: '' },
            teacher: classDoc.teacher,
            description: `${classDoc.subject || 'Class'}`,
            date: classDate,
            duration: duration,
            rate: rate,
            amount: amount,
            attended: false
          }],
          note: 'Auto-added: new scheduled class'
        },
        null
      );

      return { success: true, invoiceId: unpaidInvoice._id };
    } catch (err) {
      console.warn('[maybeAddClassToUnpaidInvoice] failed:', err && err.message);
      return { success: false, error: err && err.message };
    }
  }

  static async buildDynamicClassList(invoiceDoc, options = {}) {
    const resultFallback = { items: [], totalMinutes: 0, totalHours: 0, capMinutes: null, coverageHours: null };
    try {
      if (!invoiceDoc || invoiceDoc.type !== 'guardian_invoice') {
        return resultFallback;
      }

      const guardianIdValue = invoiceDoc.guardian && invoiceDoc.guardian._id
        ? invoiceDoc.guardian._id
        : invoiceDoc.guardian;
      const guardianId = toObjectId(guardianIdValue);
      if (!guardianId) {
        return resultFallback;
      }

      const guardianDoc = await User.findById(guardianId).lean();
      if (!guardianDoc) {
        return resultFallback;
      }

      const studentIds = await getGuardianStudentIds(guardianDoc, invoiceDoc);
      if (!studentIds.length) {
        return resultFallback;
      }

      const invoiceItemHours = computeInvoiceItemHours(invoiceDoc);
      const coverageHoursRaw = Number(invoiceDoc?.coverage?.maxHours);
      const coverageHours = Number.isFinite(coverageHoursRaw) && coverageHoursRaw > EPSILON_HOURS
        ? coverageHoursRaw
        : Math.max(0, invoiceItemHours);
      const isUnpaid = ACTIVE_UNPAID_INVOICE_STATUSES.includes(String(invoiceDoc?.status || '').toLowerCase());
      const capMinutes = (!isUnpaid && coverageHours > EPSILON_HOURS) ? Math.round(coverageHours * 60) : null;

      const billingStart = ensureDate(invoiceDoc?.billingPeriod?.startDate)
        || ensureDate(invoiceDoc?.createdAt)
        || new Date();
      const billingEnd = ensureDate(invoiceDoc?.billingPeriod?.endDate);
      let coverageEnd = ensureDate(invoiceDoc?.coverage?.endDate) || billingEnd || null;
      if (coverageEnd) {
        coverageEnd.setHours(23, 59, 59, 999);
      } else if (billingStart) {
        coverageEnd = dayjs(billingStart).add(1, 'month').toDate();
      }
      if (isUnpaid && billingStart) {
        const minEnd = dayjs(billingStart).add(1, 'month').endOf('day').toDate();
        if (!coverageEnd || coverageEnd < minEnd) {
          coverageEnd = minEnd;
        }
      }

      const existingItems = Array.isArray(invoiceDoc.items) ? invoiceDoc.items : [];
      const existingItemMap = new Map();
      const pinnedClassIds = new Set();
      const normalizeClassId = (value) => {
        if (!value) return null;
        if (typeof value === 'string' || typeof value === 'number') {
          return value.toString();
        }
        if (typeof value === 'object') {
          if (value._id) return value._id.toString();
          if (typeof value.toString === 'function') {
            const asString = value.toString();
            if (asString && asString !== '[object Object]') return asString;
          }
        }
        return null;
      };

      for (const item of existingItems) {
        if (!item) continue;
        const classIdValue = item.class || item.lessonId || item.classId || null;
        const key = normalizeClassId(classIdValue);
        if (!key) continue;
        if (!existingItemMap.has(key) && item) {
          existingItemMap.set(key, item.toObject ? item.toObject() : item);
        }
        pinnedClassIds.add(key);
      }

      const excludedIds = new Set(
        (invoiceDoc.excludedClassIds || [])
          .map((id) => toObjectId(id))
          .filter(Boolean)
          .map((id) => id.toString())
      );

      const billedElsewhere = await collectBilledClassIds({
        guardian: guardianId,
        _id: { $ne: invoiceDoc._id },
        deleted: { $ne: true },
        status: { $nin: ['cancelled', 'refunded'] }
      });
      for (const cid of billedElsewhere) {
        if (cid) excludedIds.add(String(cid));
      }

      const excludedObjectIds = Array.from(excludedIds)
        .map((id) => toObjectId(id))
        .filter(Boolean);

      const scheduledFilter = {};
      if (billingStart) {
        scheduledFilter.$gte = billingStart;
      }
      if (coverageEnd) {
        scheduledFilter.$lte = coverageEnd;
      }

      const classQuery = {
        'student.guardianId': guardianId,
        'student.studentId': { $in: studentIds },
        hidden: { $ne: true },
        status: { $ne: 'pattern' },
        paidByGuardian: { $ne: true }
      };

      if (Object.keys(scheduledFilter).length) {
        classQuery.scheduledDate = scheduledFilter;
      }
      if (excludedObjectIds.length) {
        classQuery._id = { $nin: excludedObjectIds };
      }

      let classDocs = await Class.find(classQuery)
        .sort({ scheduledDate: 1, createdAt: 1 })
        .limit(MAX_DYNAMIC_CLASS_RESULTS)
        .select('scheduledDate duration subject status teacher student reportSubmission classReport timezone anchoredTimezone billedInInvoiceId')
        .lean();

      if (!classDocs.length && studentIds.length > 0) {
        if (INVOICE_DEBUG) {
          console.log('🔎 [Invoice dynamic] Fallback to guardian-only class query (studentId filter yielded 0).', {
            guardianId: guardianId.toString(),
            invoiceId: invoiceDoc?._id?.toString()
          });
        }
        const fallbackQuery = {
          'student.guardianId': guardianId,
          hidden: { $ne: true },
          status: { $ne: 'pattern' },
          paidByGuardian: { $ne: true }
        };
        if (Object.keys(scheduledFilter).length) {
          fallbackQuery.scheduledDate = scheduledFilter;
        }
        if (excludedObjectIds.length) {
          fallbackQuery._id = { $nin: excludedObjectIds };
        }
        classDocs = await Class.find(fallbackQuery)
          .sort({ scheduledDate: 1, createdAt: 1 })
          .limit(MAX_DYNAMIC_CLASS_RESULTS)
          .select('scheduledDate duration subject status teacher student reportSubmission classReport timezone anchoredTimezone billedInInvoiceId')
          .lean();
      }

      // Ensure classes already present on the invoice remain candidates even if they
      // fall outside the default scheduling window (e.g., rescheduled earlier).
      const pinnedObjectIds = Array.from(pinnedClassIds)
        .filter((id) => !excludedIds.has(id))
        .map((id) => toObjectId(id))
        .filter(Boolean);

      if (pinnedObjectIds.length) {
        const pinnedDocs = await Class.find({ _id: { $in: pinnedObjectIds } })
          .select('scheduledDate duration subject status teacher student reportSubmission classReport timezone anchoredTimezone billedInInvoiceId')
          .lean();

        if (Array.isArray(pinnedDocs) && pinnedDocs.length) {
          const seen = new Set((classDocs || []).map((cls) => cls?._id && cls._id.toString()).filter(Boolean));
          for (const cls of pinnedDocs) {
            if (!cls || !cls._id) continue;
            const strId = cls._id.toString();
            if (seen.has(strId)) continue;
            seen.add(strId);
            classDocs.push(cls);
          }
        }
      }

      classDocs.sort((a, b) => {
        const aDate = ensureDate(a?.scheduledDate) || ensureDate(a?.dateTime) || new Date(0);
        const bDate = ensureDate(b?.scheduledDate) || ensureDate(b?.dateTime) || new Date(0);
        return aDate - bDate;
      });

      if (classDocs.length > MAX_DYNAMIC_CLASS_RESULTS) {
        classDocs = classDocs.slice(0, MAX_DYNAMIC_CLASS_RESULTS);
      }

      if (!classDocs.length) {
        return existingItems.length
          ? {
              items: existingItems.map((item) => (item.toObject ? item.toObject() : item)),
              totalMinutes: invoiceItemHours * 60,
              totalHours: invoiceItemHours,
              capMinutes,
              coverageHours: coverageHours || null
            }
          : resultFallback;
      }

      const teacherIds = new Set();
      for (const cls of classDocs) {
        const teacherId = toObjectId(cls.teacher);
        if (teacherId) teacherIds.add(teacherId.toString());
      }

      let teacherMap = {};
      if (teacherIds.size) {
        const teachers = await User.find({ _id: { $in: Array.from(teacherIds).map((id) => new mongoose.Types.ObjectId(id)) } })
          .select('firstName lastName')
          .lean();
        teacherMap = teachers.reduce((acc, doc) => {
          if (doc?._id) {
            acc[doc._id.toString()] = doc;
          }
          return acc;
        }, {});
      }

      const now = new Date();
      const hourlyRate = resolveInvoiceHourlyRate(invoiceDoc);
      const dynamicItems = [];
      const seenClassIds = new Set();
      let usedMinutes = 0;

      for (const cls of classDocs) {
        if (!cls?._id) continue;
        const classId = cls._id.toString();
        if (seenClassIds.has(classId)) continue;
        seenClassIds.add(classId);

        const allowance = ensureDate(cls?.reportSubmission?.teacherDeadline);
        const extendedUntil = ensureDate(cls?.reportSubmission?.adminExtension?.expiresAt);
        const enrichedClass = {
          ...cls,
          reportSubmissionAllowance: allowance,
          reportSubmissionExtendedUntil: extendedUntil
        };

        if (!isClassEligibleForDynamicInvoice(enrichedClass, now)) {
          continue;
        }

        const minutes = Number(cls.duration || 0) || 0;
        if (minutes <= 0) continue;

        if (capMinutes !== null && usedMinutes + minutes > capMinutes + 0.001) {
          break;
        }

        const existingItem = existingItemMap.get(classId);
        const studentSnapshot = existingItem?.studentSnapshot || resolveStudentSnapshotFromClass(cls);
        const teacherDoc = teacherMap[cls.teacher?.toString?.()] || null;
        const teacherSnapshot = existingItem?.teacherSnapshot || (teacherDoc
          ? { firstName: teacherDoc.firstName || '', lastName: teacherDoc.lastName || '' }
          : null);

        const amount = Math.round(((minutes / 60) * hourlyRate) * 100) / 100;
        dynamicItems.push({
          dynamicSource: 'live_class',
          lessonId: classId,
          class: {
            _id: cls._id,
            status: cls.status,
            scheduledDate: cls.scheduledDate,
            duration: cls.duration,
            subject: cls.subject,
            timezone: cls.timezone,
            anchoredTimezone: cls.anchoredTimezone,
            reportSubmission: cls.reportSubmission || {},
            classReport: { submittedAt: cls.classReport?.submittedAt || null },
            dateTime: cls.scheduledDate,
            reportSubmissionAllowance: allowance,
            reportSubmissionExtendedUntil: extendedUntil
          },
          student: cls.student?.studentId || existingItem?.student || null,
          studentSnapshot,
          teacher: teacherDoc
            ? { _id: teacherDoc._id, firstName: teacherDoc.firstName, lastName: teacherDoc.lastName }
            : (existingItem?.teacher || cls.teacher || null),
          teacherSnapshot,
          description: existingItem?.description || cls.subject || 'Class session',
          date: cls.scheduledDate || existingItem?.date,
          duration: minutes,
          rate: hourlyRate,
          amount,
          attended: cls.status === 'attended',
          status: cls.status || existingItem?.status || 'scheduled',
          reportSubmission: cls.reportSubmission || existingItem?.reportSubmission || {},
          reportSubmissionAllowance: allowance,
          reportSubmissionExtendedUntil: extendedUntil,
          paidByGuardian: Boolean(existingItem?.paidByGuardian)
        });

        usedMinutes += minutes;
        if (capMinutes !== null && usedMinutes >= capMinutes - 0.001) {
          break;
        }
      }

      if (!dynamicItems.length && existingItems.length) {
        return {
          items: existingItems.map((item) => (item.toObject ? item.toObject() : item)),
          totalMinutes: invoiceItemHours * 60,
          totalHours: invoiceItemHours,
          capMinutes,
          coverageHours: coverageHours || null
        };
      }

      return {
        items: dynamicItems,
        totalMinutes: usedMinutes,
        totalHours: usedMinutes / 60,
        capMinutes,
        coverageHours: coverageHours || null
      };
    } catch (err) {
      console.warn('buildDynamicClassList failed:', err?.message || err);
      return resultFallback;
    }
  }

  static async syncUnpaidInvoiceItems(invoiceDocOrId, opts = {}) {
    try {
      const { adminUserId = null, note = 'Synced unpaid invoice classes', cleanupDuplicates = true, transferOnDuplicate = true } = opts || {};
      const invoice = invoiceDocOrId && invoiceDocOrId._id
        ? invoiceDocOrId
        : await Invoice.findById(invoiceDocOrId);

      if (!invoice) {
        return { success: false, error: 'Invoice not found' };
      }

      if (invoice.status === 'paid') {
        return { success: false, error: 'Cannot sync paid invoice' };
      }

      const dynamic = await InvoiceService.buildDynamicClassList(invoice);
      const desiredItems = Array.isArray(dynamic?.items) ? dynamic.items : [];
      const currentItems = Array.isArray(invoice.items) ? invoice.items : [];

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

      const currentByClass = new Map();
      for (const item of currentItems) {
        if (!item) continue;
        const key = normalizeClassId(item.class || item.lessonId);
        if (!key) continue;
        currentByClass.set(key, item);
      }

      const desiredByClass = new Map();
      for (const item of desiredItems) {
        if (!item) continue;
        const key = normalizeClassId(item.class || item.lessonId);
        if (!key) continue;
        desiredByClass.set(key, item);
      }

      const removeItemIds = [];
      currentByClass.forEach((item, key) => {
        if (!desiredByClass.has(key)) {
          if (item?._id) removeItemIds.push(String(item._id));
        }
      });

      const addItems = [];
      const hourlyRate = resolveInvoiceHourlyRate(invoice);
      desiredByClass.forEach((item, key) => {
        if (currentByClass.has(key)) return;
        const cls = item.class || {};
        const classId = normalizeClassId(cls?._id || item.class || item.lessonId || key);
        const classObjectId = toObjectId(classId) || classId;
        const minutes = Number(item.duration || cls?.duration || 0) || 0;
        const rate = Number(item.rate || 0) || hourlyRate;
        const amount = Number(item.amount || 0) || Math.round(((minutes / 60) * rate) * 100) / 100;
        const date = item.date || cls?.scheduledDate || cls?.dateTime || null;
        const studentId = item.student || cls?.student?.studentId || null;
        const teacherId = item.teacher?._id || item.teacher || cls?.teacher || null;

        addItems.push({
          lessonId: String(classId || ''),
          class: classObjectId,
          student: studentId,
          studentSnapshot: item.studentSnapshot || resolveStudentSnapshotFromClass(cls),
          teacher: teacherId,
          teacherSnapshot: item.teacherSnapshot || null,
          description: item.description || cls?.subject || 'Class session',
          date,
          duration: minutes,
          rate,
          amount,
          attended: Boolean(item.attended || cls?.status === 'attended'),
          status: item.status || cls?.status || 'scheduled'
        });
      });

      if (!addItems.length && !removeItemIds.length) {
        if (!cleanupDuplicates) {
          return { success: true, noChanges: true, invoice };
        }
      }

      const updateResult = (!addItems.length && !removeItemIds.length)
        ? { success: true, noChanges: true, invoice }
        : await InvoiceService.updateInvoiceItems(
            String(invoice._id),
        { addItems, removeItemIds, note, transferOnDuplicate },
            adminUserId
          );

      if (cleanupDuplicates) {
        const guardianId = invoice.guardian?._id || invoice.guardian;
        const desiredIds = new Set(Array.from(desiredByClass.keys()));
        if (guardianId && desiredIds.size) {
          const otherInvoices = await Invoice.find({
            guardian: guardianId,
            _id: { $ne: invoice._id },
            deleted: { $ne: true },
            status: { $in: ['draft', 'pending', 'sent', 'overdue', 'partially_paid'] }
          });

          for (const other of otherInvoices) {
            const toRemove = [];
            (other.items || []).forEach((item) => {
              const key = normalizeClassId(item?.class || item?.lessonId);
              if (key && desiredIds.has(key) && item?._id) {
                toRemove.push(String(item._id));
              }
            });
            if (toRemove.length) {
              await InvoiceService.updateInvoiceItems(
                String(other._id),
                { removeItemIds: toRemove, note: 'Removed duplicate classes (synced to oldest unpaid invoice)' },
                adminUserId
              );
            }
          }
        }
      }

      return updateResult;
    } catch (err) {
      console.warn('syncUnpaidInvoiceItems failed:', err?.message || err);
      return { success: false, error: err?.message || 'Failed to sync invoice' };
    }
  }

  static async extendInvoiceWithScheduledClasses(invoiceDoc, options = {}) {
    try {
      if (!invoiceDoc || invoiceDoc.type !== 'guardian_invoice') {
        return { added: 0 };
      }

      const guardianIdValue = invoiceDoc.guardian && invoiceDoc.guardian._id ? invoiceDoc.guardian._id : invoiceDoc.guardian;
      if (!guardianIdValue || !mongoose.Types.ObjectId.isValid(guardianIdValue)) {
        return { added: 0 };
      }
      const guardianId = new mongoose.Types.ObjectId(guardianIdValue);

      const guardianDoc = await User.findById(guardianId).lean();
      if (!guardianDoc) {
        return { added: 0 };
      }

      const studentIdsRaw = Array.isArray(guardianDoc?.guardianInfo?.students)
        ? guardianDoc.guardianInfo.students.map((s) => s && (s._id || s.id || s.studentId)).filter(Boolean)
        : [];
      const studentIds = studentIdsRaw
        .map((id) => {
          const str = id.toString();
          return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
        })
        .filter(Boolean);

      if (!studentIds.length) {
        return { added: 0 };
      }

      const existingItems = Array.isArray(invoiceDoc.items) ? invoiceDoc.items : [];
      const existingClassStrings = new Set(
        existingItems
          .map((it) => {
            if (it?.class) return it.class.toString();
            if (it?.lessonId) return it.lessonId.toString();
            return null;
          })
          .filter(Boolean)
      );

      if (Array.isArray(invoiceDoc.classIds)) {
        invoiceDoc.classIds.forEach((cid) => {
          if (cid) existingClassStrings.add(cid.toString());
        });
      }

      const billedElsewhere = await collectBilledClassIds({
        guardian: guardianId,
        _id: { $ne: invoiceDoc._id },
        deleted: { $ne: true },
        status: { $nin: ['cancelled', 'refunded'] }
      });
      for (const cid of billedElsewhere) {
        if (cid) existingClassStrings.add(cid.toString());
      }

      const lastExistingDate = existingItems.reduce((max, item) => {
        const candidate = ensureDate(item?.date || item?.scheduledDate);
        if (candidate && candidate > max) return candidate;
        return max;
      }, ensureDate(invoiceDoc.billingPeriod?.endDate) || ensureDate(invoiceDoc.billingPeriod?.startDate) || new Date(0));

      let desiredEndDate = ensureDate(options.targetEndDate);
      if (desiredEndDate) {
        desiredEndDate.setHours(23, 59, 59, 999);
      }

      if (!desiredEndDate || (lastExistingDate && desiredEndDate <= lastExistingDate)) {
        const latestClass = await Class.findOne({
          'student.guardianId': guardianId,
          'student.studentId': { $in: studentIds },
          status: { $nin: ['pattern'] }
        })
          .sort({ scheduledDate: -1 })
          .select('scheduledDate')
          .lean();

        if (!latestClass?.scheduledDate) {
          return { added: 0 };
        }
        desiredEndDate = new Date(latestClass.scheduledDate);
        desiredEndDate.setHours(23, 59, 59, 999);
      }

      if (lastExistingDate && desiredEndDate <= lastExistingDate) {
        return { added: 0 };
      }

      const exclusionIds = Array.from(existingClassStrings)
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      const disallowedStatuses = [
        'pattern',
        'cancelled',
        'cancelled_by_teacher',
        'cancelled_by_guardian',
        'cancelled_by_admin',
        'cancelled_by_system'
      ];

      const additionalClasses = await Class.find({
        'student.guardianId': guardianId,
        'student.studentId': { $in: studentIds },
        status: { $nin: disallowedStatuses },
        scheduledDate: {
          $gt: lastExistingDate || new Date(0),
          $lte: desiredEndDate
        },
        _id: { $nin: exclusionIds },
        $or: [
          { billedInInvoiceId: null },
          { billedInInvoiceId: { $exists: false } },
          { billedInInvoiceId: invoiceDoc._id }
        ]
      })
        .sort({ scheduledDate: 1 })
        .lean();

      if (!additionalClasses.length) {
        return { added: 0 };
      }

      const resolvedRate = (() => {
        const fromInvoice = Number(invoiceDoc.guardianFinancial?.hourlyRate);
        if (Number.isFinite(fromInvoice) && fromInvoice > 0) return fromInvoice;
        const fromGuardian = Number(guardianDoc?.guardianInfo?.hourlyRate);
        if (Number.isFinite(fromGuardian) && fromGuardian > 0) return fromGuardian;
        return 10;
      })();

      const newItems = additionalClasses.map((cls) => {
        const studentName = cls.student?.studentName || '';
        const [firstName, ...rest] = studentName.trim().split(' ').filter(Boolean);
        const lastName = rest.join(' ');
        const duration = Number(cls.duration || 0) || 0;
        const hours = duration / 60;
        const amount = Math.round(hours * resolvedRate * 100) / 100;
        return {
          lessonId: cls._id?.toString(),
          class: cls._id,
          student: cls.student?.studentId || null,
          studentSnapshot: {
            firstName: firstName || studentName || '',
            lastName: lastName || '',
            email: cls.student?.email || ''
          },
          teacher: cls.teacher || null,
          description: cls.subject || 'Class session',
          date: cls.scheduledDate || cls.date || new Date(),
          duration,
          rate: resolvedRate,
          amount,
          attended: cls.status === 'attended',
          status: cls.status || 'scheduled'
        };
      });

      if (!Array.isArray(invoiceDoc.items)) {
        invoiceDoc.items = [];
      }
      invoiceDoc.items = invoiceDoc.items.concat(newItems);
      invoiceDoc.markModified('items');

      if (!invoiceDoc.billingPeriod || typeof invoiceDoc.billingPeriod !== 'object') {
        invoiceDoc.billingPeriod = {};
      }
      const newEndDate = newItems.reduce((max, item) => {
        const candidate = ensureDate(item.date);
        if (candidate && candidate > max) return candidate;
        return max;
      }, ensureDate(invoiceDoc.billingPeriod.endDate) || desiredEndDate);

      if (newEndDate && (!invoiceDoc.billingPeriod.endDate || newEndDate > invoiceDoc.billingPeriod.endDate)) {
        invoiceDoc.billingPeriod.endDate = newEndDate;
        invoiceDoc.markModified('billingPeriod');
      }

      const now = new Date();
      await Promise.allSettled(
        additionalClasses.map((cls) =>
          Class.updateOne(
            { _id: cls._id },
            { $set: { billedInInvoiceId: invoiceDoc._id, billedAt: now, flaggedUninvoiced: false } }
          ).exec()
        )
      );

      return { added: newItems.length, lastDate: newEndDate };
    } catch (err) {
      console.warn('extendInvoiceWithScheduledClasses failed:', err?.message || err);
      return { added: 0, error: err?.message };
    }
  }

  static async syncInvoiceCoverageClasses(invoiceDoc) {
    try {
      if (!invoiceDoc) return;
      const items = Array.isArray(invoiceDoc.items) ? invoiceDoc.items.filter((it) => it && it.class) : [];
      if (!items.length) return;

      const sorted = items
        .slice()
        .sort((a, b) => {
          const da = new Date(a?.date || a?.scheduledDate || 0).getTime();
          const db = new Date(b?.date || b?.scheduledDate || 0).getTime();
          return da - db;
        });

      const normalizeId = (value) => {
        if (!value) return null;
        const str = value.toString ? value.toString() : String(value);
        if (!mongoose.Types.ObjectId.isValid(str)) return null;
        return new mongoose.Types.ObjectId(str);
      };

      const allClassIds = [];
      const classIdSet = new Set();
      for (const item of sorted) {
        const normalized = normalizeId(item.class);
        if (!normalized) continue;
        const key = normalized.toString();
        if (!classIdSet.has(key)) {
          classIdSet.add(key);
          allClassIds.push(normalized);
        }
      }
      if (!allClassIds.length) return;

      const coverageHours = Number(invoiceDoc.coverage?.maxHours || 0) || 0;

      if (coverageHours <= EPSILON_HOURS) {
        await Class.updateMany(
          { _id: { $in: allClassIds } },
          { $set: { paidByGuardian: false }, $unset: { paidByGuardianAt: 1 } }
        ).exec();
        return;
      }

      let remaining = coverageHours;
      const paidSet = new Set();

      for (const item of sorted) {
        const normalized = normalizeId(item.class);
        if (!normalized) continue;
        const itemHours = Math.max(0, Number(item.duration || 0) / 60);
        if (itemHours <= 0) continue;
        if (remaining >= itemHours - EPSILON_HOURS) {
          paidSet.add(normalized.toString());
          remaining = Math.max(0, roundHours(remaining - itemHours));
        }
      }

      const paidIds = allClassIds.filter((id) => paidSet.has(id.toString()));
      const unpaidIds = allClassIds.filter((id) => !paidSet.has(id.toString()));

      const ops = [];
      if (paidIds.length) {
        ops.push(
          Class.updateMany(
            { _id: { $in: paidIds } },
            { $set: { paidByGuardian: true, paidByGuardianAt: new Date() } }
          ).exec()
        );
      }

      if (unpaidIds.length) {
        const baseUpdate = { $set: { paidByGuardian: false }, $unset: { paidByGuardianAt: 1 } };
        const status = String(invoiceDoc?.status || '').toLowerCase();
        if (status === 'paid' || status === 'refunded') {
          baseUpdate.$unset = { ...baseUpdate.$unset, billedInInvoiceId: 1, billedAt: 1 };
        }
        ops.push(
          Class.updateMany(
            { _id: { $in: unpaidIds }, billedInInvoiceId: invoiceDoc._id },
            baseUpdate
          ).exec()
        );
      }

      if (ops.length) {
        await Promise.all(ops);
      }
    } catch (err) {
      console.warn('Failed to sync class paid flags after coverage change', err?.message || err);
    }
  }

  /**
   * 💰 CENTRALIZED INVOICE RECALCULATION UTILITY
   * 
   * Handles critical money-related scenarios:
   * 1. When a paid class is deleted → automatically replace with next unpaid class
   * 2. When class status changes (Attended ↔ Cancelled) → rebalance invoice items
   * 
   * This ensures invoices always have the correct paid/unpaid class allocation
   * based on coverage hours, maintaining financial accuracy.
   * 
   * @param {String|ObjectId} invoiceId - The invoice to recalculate
   * @param {Object} opts - Options: { trigger, deletedClassId, changedClassId, session, adminUserId }
   * @returns {Promise<Object>} - { success, changes, audit }
   */
  static async recalculateInvoiceCoverage(invoiceId, opts = {}) {
    const { trigger = 'manual', deletedClassId = null, changedClassId = null, session = null, adminUserId = null } = opts;
    
    try {
      console.log(`💰 [Invoice Recalculation] Starting for invoice ${invoiceId}, trigger: ${trigger}`);
      
      const Invoice = require('../models/Invoice');
      const Class = require('../models/Class');
      const User = require('../models/User');
      
      // Load invoice with session support
      const query = session ? Invoice.findById(invoiceId).session(session) : Invoice.findById(invoiceId);
      const invoice = await query.populate('guardian');
      
      if (!invoice) {
        return { success: false, error: 'Invoice not found' };
      }

      // Only recalculate for paid or partially-paid invoices (money is involved)
      if (!['paid', 'partially_paid'].includes(invoice.status)) {
        console.log(`💰 [Invoice Recalculation] Invoice ${invoice.invoiceNumber} is ${invoice.status}, skipping (no money involved yet)`);
        return { success: true, skipped: true, reason: 'invoice_not_paid' };
      }

      const coverageHours = Number(invoice.coverage?.maxHours || 0) || 0;
      if (coverageHours <= 0) {
        console.log(`💰 [Invoice Recalculation] Invoice ${invoice.invoiceNumber} has no coverage, skipping`);
        return { success: true, skipped: true, reason: 'no_coverage' };
      }

      // Get current items sorted chronologically
      const currentItems = Array.isArray(invoice.items) ? invoice.items.filter(it => it && it.class) : [];
      const sortedItems = currentItems.slice().sort((a, b) => {
        const da = new Date(a?.date || 0).getTime();
        const db = new Date(b?.date || 0).getTime();
        return da - db;
      });

      // Calculate which classes should be marked as paid based on coverage hours
      let remaining = coverageHours;
      const shouldBePaidSet = new Set();
      const paidClassDetails = [];

      for (const item of sortedItems) {
        if (!item.class) continue;
        const itemHours = Math.max(0, Number(item.duration || 0) / 60);
        if (itemHours <= 0) continue;
        
        if (remaining >= itemHours - 0.001) { // EPSILON for float comparison
          shouldBePaidSet.add(String(item.class));
          paidClassDetails.push({
            classId: item.class,
            hours: itemHours,
            date: item.date,
            description: item.description
          });
          remaining = Math.max(0, remaining - itemHours);
        }
      }

      // Check if a paid class was deleted
      if (deletedClassId && shouldBePaidSet.has(String(deletedClassId))) {
        console.log(`💰 [Invoice Recalculation] Deleted class ${deletedClassId} was PAID - need to replace it`);
        
        // Find guardian's unpaid classes that could replace it
        const guardianId = invoice.guardian?._id;
        if (!guardianId) {
          return { success: false, error: 'No guardian found for invoice' };
        }

        // Get all student IDs for this guardian
        const guardian = await User.findById(guardianId);
        const studentIds = Array.isArray(guardian?.guardianInfo?.students)
          ? guardian.guardianInfo.students.map(s => s._id).filter(Boolean)
          : [];

        if (studentIds.length === 0) {
          console.log(`💰 [Invoice Recalculation] No students found for guardian`);
          return { success: true, noReplacementAvailable: true };
        }

        // Find unpaid classes (not in any active invoice, within billing period)
        const billingStart = invoice.billingPeriod?.startDate;
        const billingEnd = invoice.billingPeriod?.endDate;
        
        // Get all classes already in active invoices
        const billedClassIds = await collectBilledClassIds({
          deleted: { $ne: true },
          status: { $nin: ['cancelled', 'refunded'] }
        });

        const unpaidClassesQuery = {
          'student.guardianId': guardianId,
          'student.studentId': { $in: studentIds },
          _id: { $nin: billedClassIds },
          // ✅ ONLY include billable statuses - EXPLICITLY EXCLUDE CANCELLED
          status: { 
            $in: ['attended', 'scheduled', 'missed_by_student', 'absent'],
            $nin: ['cancelled', 'cancelled_by_teacher', 'cancelled_by_guardian', 'no_show_both']
          }
        };

        if (billingStart && billingEnd) {
          unpaidClassesQuery.scheduledDate = { $gte: billingStart, $lt: billingEnd };
        }

        const unpaidClasses = await Class.find(unpaidClassesQuery)
          .sort({ scheduledDate: 1 }) // Chronological order
          .limit(1) // Just need the next one
          .lean();

        if (unpaidClasses.length === 0) {
          console.log(`💰 [Invoice Recalculation] No unpaid classes available to replace deleted paid class`);
          
          // Log this critical issue for manual review
          await invoice.recordAuditEntry({
            actor: adminUserId,
            action: 'recalculation_warning',
            diff: {
              trigger,
              deletedClassId: String(deletedClassId),
              issue: 'No replacement class available',
              coverageHours,
              paidClassesCount: paidClassDetails.length
            },
            meta: {
              severity: 'high',
              requiresManualReview: true
            }
          }, { session });

          return { success: true, noReplacementAvailable: true, warningLogged: true };
        }

        // Add the replacement class to the invoice
        const replacementClass = unpaidClasses[0];
        const rate = guardian?.guardianInfo?.hourlyRate || 10;
        const duration = Number(replacementClass.duration || 60);
        const hours = duration / 60;
        const amount = Math.round(hours * rate * 100) / 100;

        const studentName = replacementClass.student?.studentName || '';
        const [firstName, ...rest] = String(studentName).trim().split(' ').filter(Boolean);
        const lastName = rest.join(' ');

        console.log(`💰 [Invoice Recalculation] Adding replacement class ${replacementClass._id} to invoice`);

        // Use updateInvoiceItems to add the replacement
        const updateResult = await InvoiceService.updateInvoiceItems(
          String(invoice._id),
          {
            addItems: [{
              lessonId: String(replacementClass._id),
              class: replacementClass._id,
              student: replacementClass.student?.studentId,
              studentSnapshot: { firstName: firstName || studentName, lastName: lastName || '', email: '' },
              teacher: replacementClass.teacher,
              description: `${replacementClass.subject || 'Class'} (Auto-replaced deleted class)`,
              date: replacementClass.scheduledDate,
              duration: duration,
              rate: rate,
              amount: amount,
              attended: replacementClass.status === 'attended'
            }],
            note: `Auto-replacement: deleted paid class ${deletedClassId}`,
            allowPaidModification: true // Special flag to allow modifying paid invoices
          },
          adminUserId
        );

        if (!updateResult.success) {
          console.error(`💰 [Invoice Recalculation] Failed to add replacement class:`, updateResult.error);
          return { success: false, error: updateResult.error };
        }

        // Mark the new class as billed
        await Class.updateOne(
          { _id: replacementClass._id },
          { $set: { billedInInvoiceId: invoice._id, billedAt: new Date() } }
        );

        // Log successful replacement
        await invoice.recordAuditEntry({
          actor: adminUserId,
          action: 'class_replaced',
          diff: {
            trigger,
            deletedClassId: String(deletedClassId),
            replacementClassId: String(replacementClass._id),
            replacementDate: replacementClass.scheduledDate,
            replacementAmount: amount
          },
          meta: {
            automaticReplacement: true,
            financialImpact: 'neutral'
          }
        }, { session });

        console.log(`✅ [Invoice Recalculation] Successfully replaced deleted paid class`);
        
        return {
          success: true,
          replaced: true,
          deletedClassId: String(deletedClassId),
          replacementClassId: String(replacementClass._id),
          replacementAmount: amount
        };
      }

      // Sync the paidByGuardian flags on all classes
      await InvoiceService.syncInvoiceCoverageClasses(invoice);

      console.log(`✅ [Invoice Recalculation] Completed for invoice ${invoice.invoiceNumber}`);
      
      return {
        success: true,
        paidClassesCount: paidClassDetails.length,
        coverageHours,
        remainingHours: remaining
      };

    } catch (err) {
      console.error(`💰 [Invoice Recalculation] Failed:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * 🔄 HANDLE CLASS DELETION - Replace paid classes automatically
   * 
   * Called when a class is deleted from the system.
   * If the class was marked as paid in an invoice, trigger recalculation
   * to replace it with the next unpaid class.
   * 
   * @param {Object} classDoc - The deleted class document
   * @param {Object} opts - Options: { session, adminUserId }
   * @returns {Promise<Object>} - { success, invoiceRecalculated }
   */
  static async handleClassDeletion(classDoc, opts = {}) {
    try {
      const { session = null, adminUserId = null } = opts;
      
      if (!classDoc || !classDoc._id) {
        return { success: false, error: 'Invalid class document' };
      }

      const classId = classDoc._id;
      const Invoice = require('../models/Invoice');

      console.log(`🗑️ [Class Deletion Handler] Processing deletion of class ${classId}`);

      // Find if this class was in any paid/partially-paid invoice
      const affectedInvoices = await Invoice.find({
        $or: [
          { 'items.class': classId },
          { 'items.lessonId': String(classId) }
        ],
        status: { $in: ['paid', 'partially_paid'] },
        deleted: { $ne: true }
      });

      if (affectedInvoices.length === 0) {
        console.log(`🗑️ [Class Deletion Handler] Class ${classId} was not in any paid invoice, no action needed`);
        return { success: true, noActionNeeded: true };
      }

      console.log(`🗑️ [Class Deletion Handler] Class ${classId} was in ${affectedInvoices.length} paid invoice(s)`);

      const results = [];
      for (const invoice of affectedInvoices) {
        console.log(`🗑️ [Class Deletion Handler] Recalculating invoice ${invoice.invoiceNumber}`);
        
        // First, remove the deleted class from the invoice
        const itemsToRemove = invoice.items
          .filter(item => String(item.class) === String(classId))
          .map(item => String(item._id));

        if (itemsToRemove.length > 0) {
          await InvoiceService.updateInvoiceItems(
            String(invoice._id),
            {
              removeItemIds: itemsToRemove,
              note: `Removed deleted class ${classId}`,
              allowPaidModification: true
            },
            adminUserId
          );
        }

        // Then trigger recalculation to find replacement
        const recalcResult = await InvoiceService.recalculateInvoiceCoverage(
          invoice._id,
          {
            trigger: 'class_deleted',
            deletedClassId: classId,
            session,
            adminUserId
          }
        );

        results.push({
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          recalcResult
        });
      }

      return {
        success: true,
        invoicesProcessed: affectedInvoices.length,
        results
      };

    } catch (err) {
      console.error(`🗑️ [Class Deletion Handler] Failed:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Ensure a follow-up invoice is created when the smallest student's remaining hours
   * fall below or equal to the guardian's minimum lesson duration. Align the new
   * invoice billing start with the previous invoice end to avoid any gap.
   * @param {Object|String} guardianOrId - Guardian doc or id
   * @param {Object} prevInvoice - The invoice that just completed/was paid (used for alignment)
   */
  static async ensureNextInvoiceIfBelowThreshold(guardianOrId, prevInvoice = null) {
    try {
      const activeInvoiceStatuses = ['draft', 'pending', 'sent', 'overdue', 'partially_paid'];

      // load guardian
      const guardian = typeof guardianOrId === 'object' && guardianOrId.guardianInfo
        ? guardianOrId
        : await User.findById(guardianOrId);
      if (!guardian || guardian.role !== 'guardian') return { created: false };

      const minLessonMinutes = Number(guardian.guardianInfo?.minLessonDurationMinutes ?? guardian.guardianInfo?.minLessonMinutes ?? 30);
      const minLessonHours = Number.isFinite(minLessonMinutes) ? (minLessonMinutes / 60) : 0.5;

      const guardianTotalHours = Number(guardian.guardianInfo?.totalHours ?? 0);
      if (!Number.isFinite(guardianTotalHours)) {
        return { created: false, reason: 'invalid_total' };
      }

      if (guardianTotalHours > minLessonHours) {
        return { created: false, reason: 'above_threshold' };
      }

      // do not duplicate if an active auto-payg invoice exists
      const existing = await Invoice.findOne({
        guardian: guardian._id,
        type: 'guardian_invoice',
        generationSource: { $in: ['auto-payg', 'manual'] },
        status: { $in: activeInvoiceStatuses }
      }).sort({ createdAt: -1 });
      if (existing) {
        // if still has balance or created recently, skip
        const hasBalance = typeof existing.getDueAmount === 'function' ? (existing.getDueAmount() > 0.01) : true;
        const recent = dayjs(existing.createdAt).isAfter(dayjs().subtract(24, 'hour'));
        if (hasBalance || recent) return { created: false, reason: 'existing_active' };
      }

      const students = Array.isArray(guardian.guardianInfo?.students) ? guardian.guardianInfo.students : [];
      const selectLowestHoursStudent = () => {
        if (!students.length) return null;
        let candidate = null;
        let minHours = Number.POSITIVE_INFINITY;
        for (const student of students) {
          const remaining = Number(student?.hoursRemaining ?? student?.hoursLeft ?? Number.POSITIVE_INFINITY);
          if (!Number.isFinite(remaining)) continue;
          if (remaining < minHours) {
            minHours = remaining;
            candidate = student;
          }
        }
        return candidate || students[0];
      };
      const targetStudent = selectLowestHoursStudent();
      const zeroHourTargets = targetStudent ? [targetStudent] : [];

      // align start with previous invoice end if provided
      const prevEnd = prevInvoice && prevInvoice.billingPeriod && prevInvoice.billingPeriod.endDate
        ? new Date(prevInvoice.billingPeriod.endDate)
        : new Date();

      const created = await this.createZeroHourInvoice(guardian, zeroHourTargets, {
        reason: 'threshold_followup',
        triggeredBy: 'auto-payg',
        billingPeriodStart: prevEnd,
      });

      // Notify guardian about the newly created follow-up invoice (similar to first-lesson flow)
      try {
        const notificationService = require('../services/notificationService');
        // generic invoice-created notification
        notificationService
          .notifyInvoiceEvent({ invoice: created, eventType: 'created' })
          .catch(console.error);

        // small actionable notification with PayPal link (if applicable)
        const method = created?.paymentMethod || guardian?.guardianInfo?.preferredPaymentMethod || 'paypal';
        const guardianUserId = created?.guardian || guardian?._id;
        if (guardianUserId && String(method).toLowerCase() === 'paypal') {
          try {
            const paypalBase = process.env.PAYPAL_PAYMENT_URL || 'https://www.paypal.com/invoice/paying/?invoice=';
            const ref = created?.paypalInvoiceNumber || created?.invoiceNumber || String(created?._id || '');
            if (ref) {
              const payLink = `${paypalBase}${encodeURIComponent(ref)}`;
              await notificationService.createNotification({
                userId: guardianUserId,
                title: 'Invoice ready to pay',
                message: 'A new invoice is ready. Open it to review and pay securely via PayPal.',
                type: 'invoice',
                relatedTo: 'invoice',
                relatedId: created?._id,
                actionRequired: true,
                actionLink: payLink
              });
            }
          } catch (notifyErr) {
            console.warn('Failed to create PayPal follow-up notification:', notifyErr?.message || notifyErr);
          }
        }
      } catch (outerNotifyErr) {
        console.warn('Follow-up invoice creation notification failed:', outerNotifyErr?.message || outerNotifyErr);
      }

      return { created: true, invoice: created };
    } catch (err) {
      console.warn('ensureNextInvoiceIfBelowThreshold failed:', err && err.message);
      return { created: false, error: err && err.message };
    }
  }

  /**
   * Update invoice items (add/remove/modify).
   */
  static async updateInvoiceItems(invoiceId, updates, adminUserId) {
    const session = await mongoose.startSession();
    let resultInvoice = null;
    const didPreview = Boolean(updates && updates.preview === true);
    let useFallback = false;

    try {
      const { addItems = [], removeItemIds = [], modifyItems = [], note, preview } = updates || {};
      const hasChanges = Boolean((addItems && addItems.length) || (removeItemIds && removeItemIds.length) || (modifyItems && modifyItems.length));

      if (!hasChanges) {
        const invoice = await Invoice.findById(invoiceId)
          .populate('guardian', 'firstName lastName email')
          .populate('teacher', 'firstName lastName email')
          .populate('items.student', 'firstName lastName email');
        await session.endSession();
        if (!invoice) return { success: false, error: 'Invoice not found' };
        return { success: true, invoice, noChanges: true };
      }

      // Define the update logic that can be executed with or without transactions
      const executeUpdate = async (sessionArg) => {
        const invoice = sessionArg 
          ? await Invoice.findById(invoiceId).session(sessionArg)
          : await Invoice.findById(invoiceId);
        
        if (!invoice) {
          throw new Error('Invoice not found');
        }

        // 🔥 NEW: Prevent modifications to paid invoices (except via post-payment adjustments)
        // This ensures the items list is locked once payment is made
        if (invoice.status === 'paid' && !updates.allowPaidModification) {
          throw new Error('Cannot modify items in a paid invoice. Items are locked after payment.');
        }

        const toPlainId = (value) => {
          if (!value) return null;
          if (typeof value === 'string') return value;
          if (typeof value === 'object' && value.toString) return value.toString();
          try { return String(value); } catch { return null; }
        };

        const summarizeItem = (item, fallbackId) => {
          if (!item) return null;
          return {
            id: toPlainId(item._id || fallbackId),
            lessonId: item.lessonId || null,
            classId: toPlainId(item.class) || null,
            studentId: toPlainId(item.student) || null,
            amount: Number(item.amount || 0),
            description: item.description || null
          };
        };

        const beforeItemsMap = new Map();
        invoice.items.forEach((existing) => {
          beforeItemsMap.set(toPlainId(existing._id), summarizeItem(existing));
        });

        const newLessonIds = addItems.map((it) => it.lessonId).filter(Boolean);
        const newClassIds = addItems.map((it) => it.class).filter(Boolean);
        
        // Check for conflicts using either lessonId or class field
        if (newLessonIds.length || newClassIds.length) {
          const conflictQuery = {
            _id: { $ne: invoice._id },
            deleted: { $ne: true },
            status: { $nin: ['cancelled', 'refunded'] },
            $or: []
          };
          
          if (newLessonIds.length) {
            conflictQuery.$or.push({ 'items.lessonId': { $in: newLessonIds } });
          }
          if (newClassIds.length) {
            conflictQuery.$or.push({ 'items.class': { $in: newClassIds } });
            conflictQuery.$or.push({ 'items.lessonId': { $in: newClassIds.map((id) => String(id)) } });
          }
          
          let conflict = sessionArg
            ? await Invoice.findOne(conflictQuery).session(sessionArg)
            : await Invoice.findOne(conflictQuery);

          if (conflict) {
            const conflictStatus = String(conflict.status || '').toLowerCase();
            const isLocked = conflictStatus === 'paid' || conflictStatus === 'refunded';
            // If client allows transfer, remove from conflicting invoice and proceed
            if (updates.transferOnDuplicate === true && !isLocked) {
              const conflictingLessonIds = new Set(newLessonIds);
              const conflictingClassIds = new Set(newClassIds.map(id => String(id)));
              const beforeCount = conflict.items?.length || 0;
              conflict.items = (conflict.items || []).filter((it) => {
                const lessonMatch = it.lessonId && conflictingLessonIds.has(String(it.lessonId));
                const classMatch = it.class && conflictingClassIds.has(String(it.class));
                return !lessonMatch && !classMatch;
              });
              conflict.markModified('items');
              conflict.recalculateTotals();
              await conflict.recordAuditEntry({
                actor: adminUserId,
                action: 'item_update',
                diff: { transfer_out_lessons: Array.from(conflictingLessonIds), transfer_out_classes: Array.from(conflictingClassIds), toInvoice: String(invoice._id) }
              }, { session: sessionArg });
              if (sessionArg) {
                await conflict.save({ session: sessionArg });
              } else {
                await conflict.save();
              }
            } else {
              const idStr = String(conflict._id);
              const num = conflict.invoiceNumber || idStr;
              throw new Error(`lesson_already_invoiced:${idStr}:${num}`);
            }
          }
        }

        const normalizeFlags = (item) => {
          if (!item) return item;
          const flags = item.flags || {};
          const exempt = item.exemptFromGuardian === true || flags.exemptFromGuardian === true || flags.notCountForBoth === true || item.notCountForBoth === true;
          if (exempt) item.excludeFromStudentBalance = true;
          return item;
        };

        for (const ai of addItems) {
          invoice.items.push(normalizeFlags(ai));
          // Mark class as billed if lessonId or class present
          try {
            const Class = require('../models/Class');
            const classId = ai.class || null;
            const lessonId = ai.lessonId || null;
            if (classId || lessonId) {
              const query = classId ? { _id: classId } : { _id: lessonId };
              const updateOp = sessionArg
                ? Class.updateOne(query, { $set: { billedInInvoiceId: invoice._id, billedAt: new Date(), flaggedUninvoiced: false } }).session(sessionArg)
                : Class.updateOne(query, { $set: { billedInInvoiceId: invoice._id, billedAt: new Date(), flaggedUninvoiced: false } });
              await updateOp;
            }
          } catch (_) {}
        }

        for (const mi of modifyItems) {
          if (!mi || !mi._id) continue;
          const existing = invoice.items.id(mi._id);
          if (existing) {
            const clone = { ...mi };
            delete clone._id;
            Object.assign(existing, clone);
          }
        }

        if (removeItemIds.length) {
          const removalSet = new Set(removeItemIds.map((id) => toPlainId(id)).filter(Boolean));
          const remaining = [];
          for (const it of invoice.items) {
            const idStr = toPlainId(it._id);
            if (!removalSet.has(idStr)) {
              remaining.push(it);
            } else {
              try {
                const Class = require('../models/Class');
                const classId = it.class || null;
                const lessonId = it.lessonId || null;
                const query = classId ? { _id: classId, billedInInvoiceId: invoice._id } : { _id: lessonId, billedInInvoiceId: invoice._id };
                const updateOp = sessionArg
                  ? Class.updateOne(query, { $set: { billedInInvoiceId: null, billedAt: null } }).session(sessionArg)
                  : Class.updateOne(query, { $set: { billedInInvoiceId: null, billedAt: null } });
                await updateOp;
              } catch (_) {}
            }
          }
          invoice.items = remaining;
        }

        const addedSummary = addItems.map((item) => summarizeItem(item)).filter(Boolean);
        const removedSummary = (removeItemIds || []).map((id) => beforeItemsMap.get(toPlainId(id))).filter(Boolean);
        const modifiedSummary = (modifyItems || [])
          .map((mi) => {
            const id = toPlainId(mi?._id);
            if (!id) return null;
            const before = beforeItemsMap.get(id);
            const afterDoc = invoice.items.id(mi._id);
            const after = afterDoc ? summarizeItem(afterDoc) : null;
            if (!before && !after) return null;
            return { id, before, after };
          })
          .filter(Boolean);

        invoice.markModified('items');
        invoice.recalculateTotals();
        invoice.updatedBy = adminUserId || invoice.updatedBy;
        invoice.$locals = invoice.$locals || {};
        invoice.$locals.addedSummary = addedSummary;
        invoice.$locals.removedSummary = removedSummary;
        invoice.$locals.modifiedSummary = modifiedSummary;

        if (preview === true) {
          return invoice; // do not save in preview mode
        }

        invoice.pushActivity({
          actor: adminUserId,
          action: 'item_update',
          note: note || 'Invoice items updated',
          diff: { added: addedSummary, removed: removedSummary, modified: modifiedSummary }
        });

        await invoice.recordAuditEntry({
          actor: adminUserId,
          action: 'item_update',
          diff: {
            added: addedSummary,
            removed: removedSummary,
            modified: modifiedSummary,
            subtotal: invoice.subtotal,
            total: invoice.total,
          },
          meta: {
            note: note || null,
            addedCount: addedSummary.length,
            removedCount: removedSummary.length,
            modifiedCount: modifiedSummary.length
          }
        }, { session: sessionArg });

        const populateSpec = [
          { path: 'guardian', select: 'firstName lastName email' },
          { path: 'teacher', select: 'firstName lastName email' },
          { path: 'items.student', select: 'firstName lastName email' }
        ];
        
        if (sessionArg) {
          populateSpec.forEach(spec => spec.options = { session: sessionArg });
        }

        // Update billing window from items and coverage before saving
        try {
          const dates = Array.isArray(invoice.items)
            ? invoice.items
                .map((it) => (it && it.date ? new Date(it.date) : null))
                .filter((d) => d && !Number.isNaN(d.getTime()))
            : [];
          const minDate = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : (invoice.billingPeriod?.startDate || invoice.createdAt || new Date());
          const maxDateBase = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : (invoice.billingPeriod?.endDate || invoice.dueDate || minDate);
          const coverageEnd = invoice.coverage && invoice.coverage.endDate ? new Date(invoice.coverage.endDate) : null;
          const endDate = coverageEnd && !Number.isNaN(coverageEnd.getTime()) ? coverageEnd : maxDateBase;
          if (!invoice.billingPeriod || typeof invoice.billingPeriod !== 'object') {
            invoice.billingPeriod = {};
          }
          invoice.billingPeriod.startDate = minDate;
          invoice.billingPeriod.endDate = endDate;
          invoice.markModified('billingPeriod');
        } catch (_) {}

        if (sessionArg) {
          await invoice.save({ session: sessionArg });
        } else {
          await invoice.save();
        }
        await invoice.populate(populateSpec);
        return invoice;
      };

      // Try with transactions first
      try {
        await session.withTransaction(async () => {
          resultInvoice = await executeUpdate(session);
        }, {
          readPreference: 'primary',
          readConcern: { level: 'local' },
          writeConcern: { w: 'majority' }
        });
      } catch (transactionErr) {
        // Check if error is due to unsupported transactions (standalone MongoDB)
        if (transactionErr?.code === 20 || transactionErr?.codeName === 'IllegalOperation') {
          console.warn('⚠️ Transactions unsupported - falling back to non-transactional update');
          useFallback = true;
        } else {
          throw transactionErr;
        }
      }

      // Fallback: Execute without transactions
      if (useFallback) {
        resultInvoice = await executeUpdate(null);
      }

      await session.endSession();

      if (preview === true && resultInvoice) {
        return {
          success: true,
          preview: true,
          invoice: resultInvoice,
          unsavedChanges: {
            added: resultInvoice.$locals?.addedSummary,
            removed: resultInvoice.$locals?.removedSummary,
            modified: resultInvoice.$locals?.modifiedSummary,
            subtotal: resultInvoice.subtotal,
            total: resultInvoice.total,
            dueDate: resultInvoice.dueDate
          }
        };
      }

      if (!resultInvoice) return { success: false, error: 'Invoice not found' };
      return { success: true, invoice: resultInvoice };
    } catch (err) {
      console.error('Error updating invoice items:', err);
      if (err && err.name === 'VersionError') {
        return { success: false, error: 'conflict', message: 'Invoice was modified by another user. Please refresh and retry.' };
      }
      if (err && typeof err.message === 'string' && err.message.startsWith('lesson_already_invoiced:')) {
        const parts = err.message.split(':');
        return { success: false, error: 'lesson_already_invoiced', existingInvoiceId: parts[1], existingInvoiceNumber: parts[2] };
      }
      try { await session.endSession(); } catch {}
      return { success: false, error: err.message };
    }
  }

  /**
   * Preview invoice changes without persisting; wrapper around updateInvoiceItems with preview flag.
   */
  static async previewInvoiceChanges(invoiceId, updates, adminUserId) {
    const payload = { ...(updates || {}), preview: true };
    // Delegate to updateInvoiceItems which now supports preview mode
    return this.updateInvoiceItems(invoiceId, payload, adminUserId);
  }

  /**
   * Roll back an invoice change based on a specific audit entry.
   * Currently supports action 'item_update' by reversing added/removed/modified.
   */
  static async rollbackInvoiceChange(invoiceId, auditId, adminUserId) {
    try {
      const InvoiceAudit = require('../models/InvoiceAudit');
      const audit = await InvoiceAudit.findOne({ _id: auditId, invoiceId });
      if (!audit) return { success: false, error: 'Audit entry not found' };
      if (audit.action !== 'item_update') {
        return { success: false, error: 'Rollback not supported for this action' };
      }

      const diff = audit.diff || {};
      const added = Array.isArray(diff.added) ? diff.added : [];
      const removed = Array.isArray(diff.removed) ? diff.removed : [];
      const modified = Array.isArray(diff.modified) ? diff.modified : [];

      // Reverse operation: remove previously added, re-add previously removed, restore modified before state
      const removeItemIds = added.map((a) => a && (a.id || a._id)).filter(Boolean);
      const addItems = removed.map((r) => ({
        _id: r?.id,
        lessonId: r?.lessonId || null,
        class: r?.classId || null,
        student: r?.studentId || null,
        description: r?.description || 'Restored item',
        duration: (r?.hours ? Number(r.hours) * 60 : undefined),
        amount: r?.amount || undefined,
        date: new Date()
      })).filter(Boolean);

      const modifyItems = modified.map((m) => ({ _id: m.id, ...m.before })).filter(Boolean);

      const updates = { addItems, removeItemIds, modifyItems, note: `Rollback audit ${auditId}` };
      const res = await this.updateInvoiceItems(invoiceId, updates, adminUserId);
      if (!res.success) return res;

      const inv = res.invoice;
      await inv.recordAuditEntry({
        actor: adminUserId,
        action: 'update',
        diff: { rollbackFromAuditId: String(auditId) },
        meta: { reason: 'rollback' }
      });
      await inv.save();
      return { success: true, invoice: inv };
    } catch (err) {
      console.error('Rollback error:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Apply post-payment adjustments.
   * - type: 'reduction' | 'increase' | 'removeLessons'
   * For 'reduction': uses recordInvoiceRefund with amount/refundHours, updates balances, notifies.
   * For 'increase': appends items; if paymentData is provided, processes payment; updates notifications.
   * For 'removeLessons': admin decides mode: 'refund' | 'compensate' | 'both'.
   */
  static async applyPostPaymentAdjustment(invoiceId, payload, adminUserId) {
    try {
      const invoice = await Invoice.findById(invoiceId).populate('guardian').exec();
      if (!invoice) return { success: false, error: 'Invoice not found' };
      if (invoice.status !== 'paid' && invoice.status !== 'partially_paid' && invoice.status !== 'sent' && invoice.status !== 'overdue') {
        return { success: false, error: 'Invoice must be paid/partially paid/sent/overdue for post-payment adjustments' };
      }

      const type = payload?.type;
      if (!type) return { success: false, error: 'Adjustment type required' };

      if (type === 'reduction') {
        // use existing refund path
        const amount = Number(payload.amount || 0);
        const refundHours = typeof payload.refundHours === 'number' ? payload.refundHours : undefined;
        const reason = payload.reason || 'post_payment_reduction';
        const res = await InvoiceService.recordInvoiceRefund(invoiceId, { amount, refundHours, reason }, adminUserId);
        // notify admin if negative guardian balance
        try {
          const guardianId = (invoice.guardian && invoice.guardian._id) || invoice.guardian;
          if (guardianId) {
            const guardianDoc = await User.findById(guardianId);
            const total = Number(guardianDoc?.guardianInfo?.totalHours || 0);
            if (total < 0) {
              const notificationService = require('../services/notificationService');
              await notificationService.notifySystem({
                title: 'Guardian balance below zero',
                message: `Guardian ${guardianDoc?.firstName || guardianId} now has negative hours after a refund. Please review.`,
                type: 'invoice',
                role: 'admin',
                related: { invoice: invoice._id, guardian: guardianId }
              });
            }
            // notify guardian
            try {
              const notificationService = require('../services/notificationService');
              await notificationService.createNotification({
                userId: guardianId,
                title: 'Invoice adjusted',
                message: 'A refund or adjustment was applied to your invoice. Your remaining hours have been updated.',
                type: 'invoice',
                relatedTo: 'invoice',
                relatedId: invoice._id
              });
            } catch (_) {}
          }
        } catch (_) {}
        return res;
      }

      if (type === 'increase') {
        // append items and optionally process additional payment
        const addItems = (payload.addItems || []).map((it) => ({ ...it }));
        const updateRes = await InvoiceService.updateInvoiceItems(invoiceId, { addItems, note: payload.note || 'Post-payment increase', allowPaidModification: true }, adminUserId);
        if (!updateRes?.success) return updateRes;

        if (payload.paymentData && Number(payload.paymentData.amount || 0) > 0) {
          await InvoiceService.processInvoicePayment(invoiceId, payload.paymentData, adminUserId);
        }

        // attach unbilled lessons if requested
        // (caller should supply as addItems with lessonId populated)

        try {
          const notificationService = require('../services/notificationService');
          const guardianId = (invoice.guardian && invoice.guardian._id) || invoice.guardian;
          if (guardianId) {
            await notificationService.createNotification({
              userId: guardianId,
              title: 'Invoice updated',
              message: 'Additional hours or lessons were added to your invoice.',
              type: 'invoice',
              relatedTo: 'invoice',
              relatedId: invoice._id
            });
          }
          await notificationService.notifySystem({
            title: 'Invoice updated after payment',
            message: `Invoice ${invoice.invoiceNumber || invoice._id} was updated after payment.`,
            type: 'invoice',
            role: 'admin',
            related: { invoice: invoice._id }
          });
        } catch(_) {}

        return { success: true, invoice: updateRes.invoice };
      }

      if (type === 'removeLessons') {
        const itemIds = payload.itemIds || [];
        const mode = payload.mode || 'refund'; // 'refund' | 'compensate' | 'both'

        // Build summaries and totals for removed items
        const before = await Invoice.findById(invoiceId).populate('items.student','firstName lastName').exec();
        if (!before) return { success: false, error: 'Invoice not found' };
        const removing = before.items.filter((it) => itemIds.includes(String(it._id)) || itemIds.includes(it._id));
        const totalAmount = removing.reduce((s, it) => s + Number(it.amount || 0), 0);
        const totalHours = removing.reduce((s, it) => s + Number(it.duration || 0) / 60, 0);

        // Remove items
        await InvoiceService.updateInvoiceItems(invoiceId, { removeItemIds: itemIds, note: `Post-payment removal (${mode})`, allowPaidModification: true }, adminUserId);

        if (mode === 'refund' || mode === 'both') {
          await InvoiceService.recordInvoiceRefund(invoiceId, { amount: totalAmount, refundHours: totalHours, reason: 'remove_lessons_refund' }, adminUserId);
        }
        if (mode === 'compensate' || mode === 'both') {
          // Keep hours consumed: no refund of hours; optionally log activity
          const inv = await Invoice.findById(invoiceId);
          if (inv) {
            await inv.recordAuditEntry({
              actor: adminUserId,
              action: 'compensate_hours',
              diff: { removedItemIds: itemIds, hoursKept: totalHours, amountKept: totalAmount }
            });
          }
        }

        try {
          const notificationService = require('../services/notificationService');
          await notificationService.notifySystem({
            title: 'Lessons removed from paid invoice',
            message: `Invoice ${invoice.invoiceNumber || invoice._id}: ${removing.length} lessons removed (mode: ${mode})`,
            type: 'invoice',
            role: 'admin',
            related: { invoice: invoice._id }
          });
        } catch(_) {}

        return { success: true };
      }

      return { success: false, error: 'Unknown adjustment type' };
    } catch (err) {
      console.error('Error applying post-payment adjustment:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Process payment: record payment and adjust student/guardian balances if needed
   */
  static async processInvoicePayment(invoiceId, paymentData, adminUserId) {
    try {
      console.log('🔔 [InvoiceService] processInvoicePayment START', { invoiceId, paymentData, adminUserId });
      const invoice = await Invoice.findById(invoiceId).populate('guardian').exec();
      if (!invoice) throw new Error('Invoice not found');

      // If invoice is already paid / settled, return idempotent success and do not apply another payment
      try {
        const remainingAmount = typeof invoice.getDueAmount === 'function' ? invoice.getDueAmount() : (Number(invoice.total || 0) - Number(invoice.paidAmount || 0));
        const isSettled = (Number(remainingAmount || 0) <= 0) || String(invoice.status || '').toLowerCase() === 'paid';
        if (isSettled) {
          console.log('[InvoiceService] Invoice already settled - ignoring payment attempt', { invoiceId });
          // Return fresh invoice snapshot where possible
          try {
            const fresh = await Invoice.findById(invoiceId).populate('guardian').exec();
            return { success: true, invoice: fresh, duplicate: true, message: 'Invoice already settled' };
          } catch (freshErr) {
            return { success: true, invoice, duplicate: true, message: 'Invoice already settled' };
          }
        }
      } catch (settleCheckErr) {
        console.warn('Failed to determine invoice settlement state, proceeding with caution', settleCheckErr && settleCheckErr.message);
      }

      // Persist a Payment record first to provide DB-backed idempotency
      let createdPayment = null;
      try {
        const incomingIdempotency = paymentData.idempotencyKey || paymentData.idempotency_key || null;
        const tx = paymentData.transactionId ? String(paymentData.transactionId) : undefined;
        const paidHoursVal = paymentData.paidHours !== undefined ? Number(paymentData.paidHours) : undefined;
        const tipVal = paymentData.tip !== undefined ? Number(paymentData.tip) : undefined;
        const paidAtVal = paymentData.paidAt ? new Date(paymentData.paidAt) : undefined;

        const paymentRecord = {
          invoice: invoice._id,
          amount: Number(paymentData.amount || 0),
          paymentMethod: paymentData.paymentMethod || paymentData.method || 'manual',
          transactionId: tx,
          idempotencyKey: incomingIdempotency || undefined,
          adminUser: adminUserId || undefined,
          paidHours: typeof paidHoursVal === 'number' ? paidHoursVal : undefined,
          tip: typeof tipVal === 'number' ? tipVal : undefined,
          paidAt: paidAtVal || undefined,
          status: 'pending'
        };

        try {
          createdPayment = await Payment.create(paymentRecord);
          console.log('[InvoiceService] Created Payment record', { paymentId: createdPayment._id, invoice: invoiceId, idempotency: incomingIdempotency, tx });
        } catch (pErr) {
          // Duplicate insert detected (unique index on invoice+idempotencyKey or invoice+transactionId)
          if (pErr && pErr.code === 11000) {
            console.log('[InvoiceService] Duplicate Payment insertion blocked by unique index', { invoice: invoiceId, idempotency: incomingIdempotency, tx });
            // Try to load existing payment record
            const query = {};
            if (incomingIdempotency) query.idempotencyKey = incomingIdempotency;
            if (tx && !query.idempotencyKey) query.transactionId = tx;
            query.invoice = invoice._id;
            try {
              const existing = await Payment.findOne(query).lean().exec();
              if (existing) {
                // If already applied, return existing invoice snapshot
                if (existing.status === 'applied') {
                  const freshInv = await Invoice.findById(invoiceId).populate('guardian').exec();
                  return { success: true, invoice: freshInv, duplicate: true, message: 'Duplicate payment (already applied)' };
                }
                // In-flight or created: treat as duplicate-in-progress
                return { success: true, invoice, duplicate: true, message: 'Payment already in progress' };
              }
            } catch (loadErr) {
              console.warn('Failed to load existing Payment after duplicate key', loadErr && loadErr.message);
            }
          }
          console.warn('Failed to create Payment record, continuing without persistent idempotency', pErr && pErr.message);
        }
      } catch (outerP) {
        console.warn('Payment persistence preparation failed unexpectedly', outerP && outerP.message);
      }

      // Idempotency / duplicate-click protection
      // If a payment log already exists that looks identical (amount, method, tip, paidHours)
      // and either shares a transactionId or was recorded within a short window, treat
      // this as a duplicate and return the existing invoice without applying hours again.
      try {
        const incomingAmount = Math.round((Number(paymentData.amount || 0) + Number.EPSILON) * 100) / 100;
        const incomingMethod = String(paymentData.paymentMethod || '').trim();
        const incomingTip = Math.round((Number(paymentData.tip || 0) + Number.EPSILON) * 100) / 100;
        const incomingPaidHours = Number.isFinite(Number(paymentData.paidHours)) ? Number(paymentData.paidHours) : null;
        const incomingTx = paymentData.transactionId ? String(paymentData.transactionId) : null;
        const incomingPaidAt = paymentData.paidAt ? new Date(paymentData.paidAt) : new Date();

        if (Array.isArray(invoice.paymentLogs) && invoice.paymentLogs.length) {
          const found = invoice.paymentLogs.some((log) => {
            try {
              const logAmount = Math.round((Number(log.amount || 0) + Number.EPSILON) * 100) / 100;
              if (logAmount !== incomingAmount) return false;
              const logMethod = String(log.paymentMethod || log.method || '').trim();
              if (logMethod !== incomingMethod) return false;
              const logTip = Math.round((Number(log.tip || 0) + Number.EPSILON) * 100) / 100;
              if (logTip !== incomingTip) return false;
              const logPaidHours = Number.isFinite(Number(log.paidHours)) ? Number(log.paidHours) : null;
              if ((logPaidHours === null ? null : logPaidHours) !== (incomingPaidHours === null ? null : incomingPaidHours)) return false;

              // If both have a transaction id and they match -> duplicate
              if (incomingTx && log.transactionId && String(log.transactionId) === incomingTx) return true;

              // If neither has a transaction id, consider timestamps within 30s and identical payload a duplicate
              const logPaidAt = log.paidAt ? new Date(log.paidAt) : null;
              if (!incomingTx && !log.transactionId && logPaidAt) {
                const delta = Math.abs(logPaidAt.getTime() - incomingPaidAt.getTime());
                if (delta < 30000) return true;
              }

              return false;
            } catch (e) {
              return false;
            }
          });

          if (found) {
            console.log('🔔 [InvoiceService] Duplicate payment detected — ignoring re-apply', { invoiceId, incomingAmount, incomingMethod, incomingTx });
            return { success: true, invoice, duplicate: true, message: 'Duplicate payment ignored' };
          }
        }
      } catch (dupErr) {
        console.warn('Duplicate detection failed unexpectedly', dupErr && dupErr.message);
      }

      // 1) Determine hourly rate and normalize amount/hours inputs
      let hourlyRate = resolveInvoiceHourlyRate(invoice);
      if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
        hourlyRate = 10;
      }

      const hasHours = paymentData && paymentData.paidHours !== undefined && paymentData.paidHours !== null && paymentData.paidHours !== '';
      const hasAmount = paymentData && paymentData.amount !== undefined && paymentData.amount !== null && paymentData.amount !== '';
      let paidHours = hasHours ? Number(paymentData.paidHours) : undefined;
      let amount = hasAmount ? Number(paymentData.amount) : undefined;

      if (!hasHours && hasAmount) {
        // derive hours from amount
        paidHours = Math.round((Number(amount) / hourlyRate) * 1000) / 1000; // hours to 3 decimals
        paymentData.paidHours = paidHours;
      } else if (hasHours && !hasAmount) {
        // derive amount from hours
        amount = Math.round((Number(paidHours) * hourlyRate) * 100) / 100; // money cents
        paymentData.amount = amount;
      }

      if (!hasHours && !hasAmount) {
        throw new Error('Provide either amount or paidHours');
      }

      // Ensure consistency between amount and hours (accounting for transfer fee if applicable)
      const baseAmount = Math.round((Number(paymentData.paidHours || paidHours || 0) * hourlyRate) * 100) / 100;
      const transferFee = (invoice.guardianFinancial?.transferFee?.amount && !invoice.guardianFinancial?.transferFee?.waived) 
        ? Number(invoice.guardianFinancial.transferFee.amount) 
        : 0;
      const expectedAmount = Math.round((baseAmount + transferFee) * 100) / 100;
      const providedAmount = Math.round((Number(paymentData.amount || amount || 0)) * 100) / 100;
      
      if (Math.abs(expectedAmount - providedAmount) > 0.01) {
        console.warn('[processInvoicePayment] Amount/hour mismatch', {
          hourlyRate,
          paidHours: paymentData.paidHours ?? paidHours,
          expectedAmount,
          providedAmount,
          baseAmount,
          transferFee
        });
        return { success: false, error: 'validation_error', message: `Mismatch between hours and amount at $${hourlyRate}/hr. Expected $${expectedAmount.toFixed(2)} (base: $${baseAmount.toFixed(2)} + fee: $${transferFee.toFixed(2)}), got $${providedAmount.toFixed(2)}.` };
      }

      // 2) Allow any payment amount - removed class boundary restriction
      // Admin can enter actual hours paid by guardian, which may not align to class boundaries
      const itemsAsc = Array.isArray(invoice.items) ? [...invoice.items].sort((a, b) => {
        const da = new Date(a?.date || 0).getTime();
        const db = new Date(b?.date || 0).getTime();
        return da - db;
      }) : [];

  const hasClassLinkedItems = itemsAsc.some((it) => Boolean(it?.class) || Boolean(it?.lessonId));
  let eligibleCoverageIncrementHours = 0;
      if (hasClassLinkedItems) {
  const hourList = itemsAsc.map((it) => (Number(it?.duration || 0) || 0) / 60);
  const totalSchedHours = hourList.reduce((sum, h) => sum + h, 0);
  const eligibleItems = itemsAsc.filter((it) => it && !it.excludeFromStudentBalance && !it.exemptFromGuardian && !(it.flags && (it.flags.notCountForBoth || it.flags.exemptFromGuardian)));
  const eligibleHoursTotal = eligibleItems.reduce((sum, item) => sum + ((Number(item?.duration || 0) || 0) / 60), 0);

        // Determine "already covered" hours
        let currentCovered = 0;
        try {
          const paymentsPositive = Array.isArray(invoice.paymentLogs)
            ? invoice.paymentLogs.filter(l => l && typeof l.amount === 'number' && l.amount > 0 && l.method !== 'refund' && l.method !== 'tip_distribution')
            : [];
          const sumPaid = paymentsPositive.reduce((s, l) => s + Number(l.amount || 0), 0);
          const hasAnyPaid = sumPaid > 0.01;
          if (hasAnyPaid) {
            if (invoice.coverage && typeof invoice.coverage.maxHours === 'number' && Number.isFinite(invoice.coverage.maxHours) && invoice.coverage.maxHours >= 0) {
              currentCovered = Math.min(totalSchedHours, Math.max(0, Number(invoice.coverage.maxHours)));
            } else {
              const excludedSet = new Set((invoice.excludedClassIds || []).map((id) => id && id.toString()));
              const classIdsList = itemsAsc.map((it) => (it?.class ? it.class.toString() : null));
              let included = 0;
              for (let i = 0; i < hourList.length; i++) {
                const cid = classIdsList[i];
                if (cid && excludedSet.has(cid)) continue;
                included += Number(hourList[i] || 0);
              }
              currentCovered = Math.min(totalSchedHours, Math.max(0, included));
            }
          } else {
            currentCovered = 0;
          }
        } catch (_) {
          currentCovered = 0;
        }
        currentCovered = Math.round(currentCovered * 1000) / 1000;

        const incrementHours = Number(paymentData.paidHours || paidHours || 0) || 0;
        if (incrementHours <= 0) {
          return { success: false, error: 'validation_error', message: 'Paid hours must be greater than zero' };
        }

        const targetTotalHours = Math.round((currentCovered + incrementHours) * 1000) / 1000;
        const coverageHours = Math.min(targetTotalHours, totalSchedHours);

        // 3) Update invoice coverage with actual paid hours (no boundary enforcement)
        invoice.coverage = invoice.coverage && typeof invoice.coverage === 'object' ? invoice.coverage : {};
  invoice.coverage.maxHours = coverageHours;
        invoice.coverage.updatedAt = new Date();
        invoice.coverage.updatedBy = adminUserId || invoice.updatedBy;
        invoice.markModified('coverage');
  const coverageIncrement = Math.max(0, roundHours(coverageHours - currentCovered));
  const eligibleRatio = totalSchedHours > EPSILON_HOURS ? Math.min(1, eligibleHoursTotal / totalSchedHours) : 0;
  eligibleCoverageIncrementHours = roundHours(coverageIncrement * eligibleRatio);
        
        // Update billing period to reflect all included items
        try {
          const firstIncludedDate = itemsAsc[0]?.date ? new Date(itemsAsc[0].date) : (invoice.billingPeriod?.startDate || new Date());
          const lastIncludedDate = itemsAsc[itemsAsc.length - 1]?.date ? new Date(itemsAsc[itemsAsc.length - 1].date) : new Date();
          if (!invoice.billingPeriod || typeof invoice.billingPeriod !== 'object') invoice.billingPeriod = {};
          invoice.billingPeriod.startDate = firstIncludedDate;
          invoice.billingPeriod.endDate = lastIncludedDate;
          invoice.markModified('billingPeriod');
          // Stretch dueDate to last included date if later
          if (!invoice.dueDate || (lastIncludedDate && invoice.dueDate < lastIncludedDate)) {
            invoice.dueDate = lastIncludedDate;
          }
        } catch (_) {}
        // Recalculate totals based on new exclusions/coverage
        invoice.recalculateTotals();

        // Mark included classes as paidByGuardian only when the invoice is fully covered
        try {
          const EPS = 0.0005;
          const isFullyCovered = Math.abs(targetTotalHours - totalSchedHours) <= EPS;
          if (isFullyCovered) {
            const Class = require('../models/Class');
            const classIdsToMark = itemsAsc
              .map((it) => it.class)
              .filter(Boolean);
            if (classIdsToMark.length) {
              await Class.updateMany(
                { _id: { $in: classIdsToMark } },
                { $set: { paidByGuardian: true, paidByGuardianAt: new Date() } }
              ).exec();
            }
          }
        } catch (markErr) {
          console.warn('Failed to mark classes paidByGuardian:', markErr && markErr.message);
        }
      } // if hasClassLinkedItems

      const paymentOptions = {
        paidHours: paymentData.paidHours,
        note: paymentData.note,
        tip: paymentData.tip,
        paidAt: paymentData.paidAt
      };

      // Re-check persisted payment logs to avoid a race where two concurrent
      // requests both pass the in-memory duplicate check above. If another
      // request already saved an identical payment log, treat this as duplicate.
      try {
        const fresh = await Invoice.findById(invoiceId).select('paymentLogs').lean();
        if (fresh && Array.isArray(fresh.paymentLogs) && fresh.paymentLogs.length) {
          const incomingAmount = Math.round((Number(paymentData.amount || 0) + Number.EPSILON) * 100) / 100;
          const incomingMethod = String(paymentData.paymentMethod || '').trim();
          const incomingTip = Math.round((Number(paymentData.tip || 0) + Number.EPSILON) * 100) / 100;
          const incomingPaidHours = Number.isFinite(Number(paymentData.paidHours)) ? Number(paymentData.paidHours) : null;
          const incomingTx = paymentData.transactionId ? String(paymentData.transactionId) : null;
          const incomingPaidAt = paymentData.paidAt ? new Date(paymentData.paidAt) : new Date();

          const exists = fresh.paymentLogs.some((log) => {
            try {
              const logAmount = Math.round((Number(log.amount || 0) + Number.EPSILON) * 100) / 100;
              if (logAmount !== incomingAmount) return false;
              const logMethod = String(log.paymentMethod || log.method || '').trim();
              if (logMethod !== incomingMethod) return false;
              const logTip = Math.round((Number(log.tip || 0) + Number.EPSILON) * 100) / 100;
              if (logTip !== incomingTip) return false;
              const logPaidHours = Number.isFinite(Number(log.paidHours)) ? Number(log.paidHours) : null;
              if ((logPaidHours === null ? null : logPaidHours) !== (incomingPaidHours === null ? null : incomingPaidHours)) return false;

              if (incomingTx && log.transactionId && String(log.transactionId) === incomingTx) return true;
              const logPaidAt = log.paidAt ? new Date(log.paidAt) : null;
              if (!incomingTx && !log.transactionId && logPaidAt) {
                const delta = Math.abs(logPaidAt.getTime() - incomingPaidAt.getTime());
                if (delta < 30000) return true;
              }
              return false;
            } catch (e) {
              return false;
            }
          });

          if (exists) {
            console.log('🔔 [InvoiceService] Duplicate payment detected on fresh DB re-check — ignoring', { invoiceId, incomingAmount, incomingMethod, incomingTx });
            return { success: true, invoice, duplicate: true, message: 'Duplicate payment ignored (concurrent)' };
          }
        }
      } catch (freshErr) {
        console.warn('Failed to perform fresh DB duplicate check', freshErr && freshErr.message);
      }

      let updatedInvoice, appliedAmount, remainingBefore;
      try {
        const result = await invoice.processPayment(
          paymentData.amount,
          paymentData.paymentMethod,
          paymentData.transactionId,
          adminUserId,
          paymentOptions
        );
        updatedInvoice = result.invoice;
        appliedAmount = result.appliedAmount;
        remainingBefore = result.remainingBefore;

        console.log('🔔 [InvoiceService] processInvoicePayment - payment applied', { invoiceId: updatedInvoice._id, status: updatedInvoice.status, paidAmount: updatedInvoice.paidAmount });

        // Mark payment record as applied if we created one
        try {
          if (createdPayment) {
            createdPayment.status = 'applied';
            createdPayment.appliedAt = new Date();
            createdPayment.logSnapshot = result.logEntry || null;
            await Payment.findByIdAndUpdate(createdPayment._id, { $set: { status: 'applied', appliedAt: createdPayment.appliedAt, logSnapshot: createdPayment.logSnapshot } }).exec();
          }
        } catch (markErr) {
          console.warn('Failed to update Payment status to applied', markErr && markErr.message);
        }
      } catch (procErr) {
        // Handle already-settled invoice gracefully: mark payment failed and return duplicate-like response
        try {
          if (createdPayment) {
            await Payment.findByIdAndUpdate(createdPayment._id, { $set: { status: 'failed', error: (procErr && procErr.message) || 'processing_failed' } }).exec();
          }
        } catch (markFailErr) {
          console.warn('Failed to mark Payment as failed after process error', markFailErr && markFailErr.message);
        }

        if (procErr && String(procErr.message || '').toLowerCase().includes('invoice is already settled')) {
          // Return idempotent success indicating invoice already settled
          try {
            const freshInv = await Invoice.findById(invoiceId).populate('guardian').exec();
            return { success: true, invoice: freshInv, duplicate: true, message: 'Invoice already settled' };
          } catch (freshErr) {
            return { success: false, error: 'already_settled', message: 'Invoice already settled and fresh read failed' };
          }
        }

        // rethrow to be handled by the outer catch
        throw procErr;
      }
  
  // Credit hours directly to guardian account (students tracking is separate for academic purposes)
  try {
    const paidHrs = Number(paymentData.paidHours || paidHours || 0);
    if (paidHrs > 0) {
      const guardianIdForCredit = (updatedInvoice.guardian && updatedInvoice.guardian._id) || updatedInvoice.guardian;
      if (guardianIdForCredit) {
        const guardian = await User.findById(guardianIdForCredit);
        if (guardian) {
          guardian.guardianInfo = guardian.guardianInfo || {};
          guardian.guardianInfo.autoTotalHours = false;
          let hoursToCredit = paidHrs;
          if (hasClassLinkedItems) {
            hoursToCredit = Math.min(paidHrs, eligibleCoverageIncrementHours);
          } else if (itemsAsc.length) {
            const hasCreditableItem = itemsAsc.some((item) => item && !item.excludeFromStudentBalance && !item.exemptFromGuardian && !(item.flags && (item.flags.notCountForBoth || item.flags.exemptFromGuardian)));
            if (!hasCreditableItem) {
              hoursToCredit = 0;
            }
          }
          hoursToCredit = roundHours(Math.max(0, hoursToCredit));

          if (hoursToCredit > EPSILON_HOURS) {
            const existingTotal = Number(guardian.guardianInfo.totalHours || 0) || 0;
            guardian.guardianInfo.totalHours = roundHours(existingTotal + hoursToCredit);

            await guardian.save();
            try {
              const GuardianModel = require('../models/Guardian');
              await GuardianModel.updateTotalRemainingMinutes(guardian._id);
            } catch (gErr) {
              console.warn('Failed to sync guardian remaining minutes after payment', gErr?.message || gErr);
            }
            console.log(`✅ Credited ${hoursToCredit} hours to guardian ${guardian._id}, new total: ${guardian.guardianInfo.totalHours}`);
          }
        }
      }
    }
  } catch (creditErr) {
    console.warn('Failed hour credit on payment', creditErr && creditErr.message);
  }

  if (updatedInvoice.status === 'paid') {
        // 🔥 CRITICAL: When invoice is paid, remove all its classes from other unpaid invoices
        try {
          const classIds = (updatedInvoice.items || [])
            .map(item => item.class || item.lessonId)
            .filter(Boolean);
          
          if (classIds.length > 0) {
            console.log(`[processInvoicePayment] Invoice ${updatedInvoice.invoiceNumber} paid, removing ${classIds.length} classes from other unpaid invoices`);
            
            for (const classId of classIds) {
              await InvoiceService.removeClassFromUnpaidInvoices(classId, updatedInvoice._id);
            }
          }
        } catch (cleanupErr) {
          console.warn('Failed to clean up classes from other invoices after payment:', cleanupErr && cleanupErr.message);
        }

        try {
          const notificationService = require('../services/notificationService');
          notificationService.notifyInvoiceEvent({
            invoice: updatedInvoice,
            eventType: 'paid'
          }).catch(console.error);
        } catch (notifyErr) {
          console.warn('Invoice paid notification failed', notifyErr.message);
        }

        // Ensure we have a fresh populated invoice so guardian reference is predictable
        let freshInvoice = updatedInvoice;
        try {
          freshInvoice = await Invoice.findById(String(updatedInvoice._id)).populate('guardian').exec();
        } catch (popErr) {
          // ignore - fall back to returned updatedInvoice
        }

        // resolve guardian id robustly (support populated doc or raw id)
        const resolveId = (value) => {
          if (!value) return null;
          if (typeof value === 'object' && value._id) return value._id;
          return value;
        };

        const guardianId = resolveId(freshInvoice.guardian || updatedInvoice.guardian);
        
        // ✅ Student hours are tracked separately for academic purposes only
        // They do not affect invoice/payment calculations
        // Guardian totalHours is the only balance tracked for payments

        // update guardian totalHours
        try {
          const guardianDocId = resolveId(freshInvoice.guardian || updatedInvoice.guardian);
          if (guardianDocId) {
            const guardianDoc = await User.findById(guardianDocId);
            if (guardianDoc && guardianDoc.role === 'guardian') {
              // Guardian total is already updated in processInvoicePayment
              // Just sync to Guardian model if needed
              try {
                const GuardianModel = require('../models/Guardian');
                const guardianModel = await GuardianModel.findOne({ user: guardianDoc._id });
                if (guardianModel) {
                  guardianModel.totalRemainingMinutes = Math.max(0, Math.round((guardianDoc.guardianInfo.totalHours || 0) * 60));
                  await guardianModel.save();
                }
              } catch (guardianUpdateErr) {
                console.warn('Failed to update Guardian minutes after payment', guardianUpdateErr.message);
              }
            }
          }
        } catch (e) {
          console.warn('Failed to recalculate guardian total hours after payment', e && e.message);
        }
      }

      // After successful payment, proactively create the next invoice if the smallest student's
      // remaining hours are at/below the minimum lesson duration to prevent any zero-period.
      try {
        if (updatedInvoice.status === 'paid') {
          const guardianId = (updatedInvoice.guardian && updatedInvoice.guardian._id) || updatedInvoice.guardian;
          if (guardianId) {
            await InvoiceService.ensureNextInvoiceIfBelowThreshold(guardianId, updatedInvoice);
          }
        }
      } catch (followErr) {
        console.warn('Post-payment follow-up invoice generation failed:', followErr && followErr.message);
      }
  return { success: true, invoice: updatedInvoice };
    } catch (err) {
      console.error('Error processing payment in service:', err);
      if (err && err.name === 'VersionError') {
        return { success: false, error: 'conflict', message: 'Invoice was modified by another user. Please refresh and retry.' };
      }
      return { success: false, error: err.message };
    }
  }

  static async revertInvoiceToUnpaid(invoiceId, adminUserId, options = {}) {
    try {
      console.log('🔁 [InvoiceService] revertInvoiceToUnpaid START', { invoiceId, adminUserId });
      const invoice = await Invoice.findById(invoiceId).populate('guardian').exec();
      if (!invoice) throw new Error('Invoice not found');

      const currentPaid = roundCurrency(invoice.paidAmount || 0);
      if (currentPaid <= 0.009) {
        return { success: false, error: 'no_payments', message: 'Invoice has no recorded payments to revert.' };
      }

      const paymentLogs = Array.isArray(invoice.paymentLogs) ? invoice.paymentLogs : [];
      const positiveLogs = paymentLogs.filter((log) => log && Number(log.amount || 0) > 0 && log.method !== 'tip_distribution');
      const tipDistributionLogs = paymentLogs.filter((log) => log && log.method === 'tip_distribution');

      const amountReverted = roundCurrency(positiveLogs.reduce((sum, log) => sum + (Number(log.amount || 0) || 0), 0));
      let hoursReverted = roundHours(positiveLogs.reduce((sum, log) => sum + (Number(log.paidHours || 0) || 0), 0));
      const tipReverted = roundCurrency(positiveLogs.reduce((sum, log) => sum + (Number(log.tip || 0) || 0), 0));

      if (hoursReverted <= 0 && amountReverted > 0) {
        const rate = Number(invoice.guardianFinancial?.hourlyRate || invoice.guardian?.guardianInfo?.hourlyRate || 0);
        if (rate > 0) {
          hoursReverted = roundHours(amountReverted / rate);
        }
      }

      if (amountReverted <= 0 && hoursReverted <= 0) {
        return { success: false, error: 'no_payments', message: 'Could not identify payments to revert.' };
      }

      const dueBefore = invoice.getDueAmount();
      const previousStatus = invoice.status;

      const retainedLogs = paymentLogs.filter((log) => {
        if (!log) return false;
        if (log.method === 'tip_distribution') return false;
        const amt = Number(log.amount || 0) || 0;
        return !(amt > 0);
      });

      invoice.paymentLogs = retainedLogs;
      invoice.markModified('paymentLogs');

  invoice.paidAmount = 0;
  invoice.paidDate = null;
  invoice.transactionId = null;
      if (tipReverted > 0) {
        const tipBefore = Number(invoice.tip || 0) || 0;
        invoice.tip = Math.max(0, roundCurrency(tipBefore - tipReverted));
      }

      const now = new Date();
      if (invoice.dueDate && invoice.dueDate < now) {
        invoice.status = 'overdue';
      } else if (['draft', 'pending'].includes(invoice.status)) {
        invoice.status = invoice.status;
      } else {
        invoice.status = 'sent';
      }

      const coverage = invoice.coverage && typeof invoice.coverage === 'object' ? invoice.coverage : {};
      if (hoursReverted > 0) {
        const previousMax = Number(coverage.maxHours || 0) || 0;
        coverage.maxHours = Math.max(0, roundHours(previousMax - hoursReverted));
        coverage.updatedAt = new Date();
        coverage.updatedBy = adminUserId || coverage.updatedBy;
        invoice.coverage = coverage;
        invoice.markModified('coverage');
      } else if (!invoice.coverage) {
        invoice.coverage = coverage;
      }

      invoice.recalculateTotals();
      invoice.updatedBy = adminUserId || invoice.updatedBy;

      invoice.pushActivity({
        actor: adminUserId,
        action: 'status_change',
        note: options.reason || 'Invoice marked unpaid by admin',
        diff: {
          amountReverted,
          hoursReverted,
          tipReverted,
          statusBefore: previousStatus,
          statusAfter: invoice.status,
          changeType: 'payment_reverted'
        }
      });

      await invoice.recordAuditEntry({
        actor: adminUserId,
        action: 'status_change',
        diff: {
          previousStatus,
          newStatus: invoice.status,
          previousPaidAmount: currentPaid,
          amountReverted,
          hoursReverted,
          tipReverted,
          paymentLogCountRemoved: positiveLogs.length
        },
        meta: {
          dueBefore,
          reason: options.reason || null
        }
      });

      await invoice.save();

      // Revert guardian hour credits
      const guardianId = invoice.guardian && invoice.guardian._id ? invoice.guardian._id : invoice.guardian;
      let guardianSnapshot = null;
      if (guardianId && hoursReverted > 0) {
        try {
          const guardianDoc = await User.findById(guardianId);
          if (guardianDoc) {
            guardianDoc.guardianInfo = guardianDoc.guardianInfo || {};
            guardianDoc.guardianInfo.autoTotalHours = false;
            const existingHours = Number(guardianDoc.guardianInfo.totalHours || 0) || 0;
            const adjustedHours = roundHours(existingHours - hoursReverted);
            guardianDoc.guardianInfo.totalHours = adjustedHours;
            await guardianDoc.save();
            guardianSnapshot = guardianDoc.toObject();
            try {
              const GuardianModel = require('../models/Guardian');
              const guardianModel = await GuardianModel.findOne({ user: guardianDoc._id });
              if (guardianModel) {
                guardianModel.totalRemainingMinutes = Math.round(adjustedHours * 60);
                await guardianModel.save();
              }
            } catch (guardianSyncErr) {
              console.warn('Guardian minutes sync failed after payment reversal', guardianSyncErr && guardianSyncErr.message);
            }
          }
        } catch (guardianErr) {
          console.warn('Guardian adjustment failed during payment reversal', guardianErr && guardianErr.message);
        }
      }

      // Revert teacher tip earnings if they were distributed
      if (tipDistributionLogs.length > 0) {
        const teacherAdjustments = {};
        for (const log of tipDistributionLogs) {
          const teacherId = log?.snapshot?.teacherId;
          if (!teacherId) continue;
          if (!mongoose.Types.ObjectId.isValid(String(teacherId))) continue;
          const amount = roundCurrency(Number(log.amount || 0) || 0);
          if (amount <= 0) continue;
          const key = String(teacherId);
          teacherAdjustments[key] = roundCurrency((teacherAdjustments[key] || 0) + amount);
        }

        for (const [teacherId, amount] of Object.entries(teacherAdjustments)) {
          if (amount <= 0) continue;
          try {
            await User.findByIdAndUpdate(teacherId, { $inc: { 'teacherInfo.monthlyEarnings': -amount } }).exec();
          } catch (teacherErr) {
            console.warn('Failed to revert teacher tip earnings', { teacherId, error: teacherErr && teacherErr.message });
          }
        }
      }

      // Reset class payment status flags
      try {
        const classIds = (invoice.items || [])
          .map((item) => {
            if (!item) return null;
            const candidate = item.class || item.lessonId || null;
            if (!candidate) return null;
            const asString = String(candidate);
            return mongoose.Types.ObjectId.isValid(asString) ? asString : null;
          })
          .filter(Boolean);
        if (classIds.length > 0) {
          await Class.updateMany(
            { _id: { $in: classIds } },
            { $set: { paidByGuardian: false }, $unset: { paidByGuardianAt: 1 } }
          ).exec();
        }
      } catch (classErr) {
        console.warn('Failed to reset class payment flags after reversal', classErr && classErr.message);
      }

      await invoice.populate([
        { path: 'guardian', select: 'firstName lastName email guardianInfo' },
        { path: 'teacher', select: 'firstName lastName email' },
        { path: 'items.student', select: 'firstName lastName email' }
      ]);

      console.log('🔁 [InvoiceService] revertInvoiceToUnpaid SUCCESS', { invoiceId, amountReverted, hoursReverted });
      return {
        success: true,
        invoice,
        amountReverted,
        hoursReverted,
        tipReverted,
        guardianSnapshot,
        guardianId: guardianId ? guardianId.toString() : null
      };
    } catch (err) {
      console.error('Error reverting invoice to unpaid:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Record a refund against an invoice and adjust guardian balances
   */
  static async recordInvoiceRefund(invoiceId, refundData, adminUserId) {
    try {
      const invoice = await Invoice.findById(invoiceId).populate('guardian').exec();
      if (!invoice) throw new Error('Invoice not found');

      console.log('🧾 [InvoiceService] recordInvoiceRefund START', {
        invoiceId,
        refundAmount: refundData?.amount,
        refundHours: refundData?.refundHours,
        adminUserId: adminUserId ? adminUserId.toString() : null
      });

      const statusBefore = invoice.status;

      const guardianRef = invoice.guardian || (invoice.$locals ? invoice.$locals.guardianRef : null);

      if (!['paid', 'partially_paid', 'sent', 'overdue'].includes(invoice.status)) {
        throw new Error('Only invoices with recorded payments can be refunded');
      }

      const paidTotal = Number(invoice.paidAmount || 0);
      if (!Number.isFinite(paidTotal) || paidTotal <= 0) {
        throw new Error('No payments available to refund for this invoice');
      }

      const normalizedAmount = roundCurrency(refundData.amount);
      const normalizedHours = roundHours(refundData.refundHours);

      if (normalizedAmount <= 0) {
        throw new Error('Refund amount must be greater than zero');
      }
      if (normalizedHours <= 0) {
        throw new Error('Refund hours must be greater than zero');
      }

      const rawCoverageBefore = Number(invoice.coverage?.maxHours ?? 0);
      const coverageBefore = Number.isFinite(rawCoverageBefore) ? rawCoverageBefore : 0;
      const hasCoverageCap = coverageBefore > EPSILON_HOURS;

      if (hasCoverageCap && normalizedHours - EPSILON_HOURS > coverageBefore) {
        throw new Error('Refund hours exceed the covered hours on this invoice');
      }

      const hourlyRate = resolveInvoiceHourlyRate(invoice);
      const transferFeeAmount = extractTransferFeeAmount(invoice);

      const baseAmount = roundCurrency(normalizedHours * hourlyRate);
      let expectedAmount = baseAmount;

      // ✅ SIMPLE APPROACH: Calculate transfer fee proportion based on HOURS, not class count
      // When refunding hours (not specific classes), the transfer fee should be proportional to hours
      // Example: Refund 5 out of 5 hours = 100% of transfer fee
      //          Refund 2 out of 5 hours = 40% of transfer fee
      const feeCoverageHours = hasCoverageCap ? coverageBefore : computeInvoiceItemHours(invoice);
      
      let proportionalFee = 0;
      if (transferFeeAmount > 0 && feeCoverageHours > EPSILON_HOURS) {
        // Simple hours-based proportion
        const hoursRatio = Math.min(1, normalizedHours / feeCoverageHours);
        proportionalFee = roundCurrency(transferFeeAmount * hoursRatio);
        expectedAmount = roundCurrency(baseAmount + proportionalFee);
      } else {
        // No transfer fee or waived - only expect base amount
        expectedAmount = baseAmount;
      }

      console.log('💰 [InvoiceService] Transfer fee calculation', {
        transferFeeAmount,
        feeCoverageHours: roundHours(feeCoverageHours),
        normalizedHours,
        hoursRatio: feeCoverageHours > 0 ? Math.round((normalizedHours / feeCoverageHours) * 10000) / 10000 : 0,
        proportionalFee,
        baseAmount,
        expectedAmount,
        normalizedAmount
      });

      // Validate refund amount matches expected calculation
      // If transfer fee exists, validate against expectedAmount (base + proportional fee)
      // If no transfer fee, validate against baseAmount only
      if (Math.abs(expectedAmount - normalizedAmount) > EPSILON_CURRENCY) {
        const feeNote = transferFeeAmount > 0 
          ? ` (including $${proportionalFee.toFixed(2)} proportional transfer fee)`
          : '';
        throw new Error(`Mismatch between refund amount and hours at $${hourlyRate}/hr. Expected $${expectedAmount.toFixed(2)}${feeNote}, received $${normalizedAmount.toFixed(2)}.`);
      }

      const processedAt = refundData.processedAt ? new Date(refundData.processedAt) : new Date();

      // ✅ Pass the proportional fee to recordRefund so it can adjust the transfer fee
      const { invoice: updatedInvoice } = await invoice.recordRefund(
        normalizedAmount,
        {
          reason: refundData.reason,
          refundReference: refundData.refundReference,
          refundHours: normalizedHours,
          processedAt,
          proportionalTransferFee: proportionalFee  // ✅ NEW: Tell invoice how much transfer fee to deduct
        },
        adminUserId
      );

      const resolveStudentId = (item) => {
        if (!item) return null;
        const direct = item.student?._id || item.student;
        if (direct) {
          return direct.toString ? direct.toString() : String(direct);
        }
        const localsRef = item.$locals ? item.$locals.studentRef : null;
        if (localsRef) {
          const idValue = localsRef._id || localsRef;
          if (idValue) {
            return idValue.toString ? idValue.toString() : String(idValue);
          }
        }
        return null;
      };

      const refundableItems = (updatedInvoice.items || [])
        .filter((it) => it && !it.excludeFromStudentBalance && !it.exemptFromGuardian && !(it.flags && (it.flags.notCountForBoth || it.flags.exemptFromGuardian)))
        .map((it) => ({
          studentId: resolveStudentId(it),
          duration: Number(it.duration || 0)
        }))
        .filter((it) => it.studentId && it.duration > 0);

      const hoursFromItems = refundableItems.reduce((sum, it) => sum + (it.duration / 60), 0);
      if (refundableItems.length > 0 && normalizedHours > hoursFromItems + EPSILON_HOURS) {
        throw new Error('Refund hours exceed the invoiced class hours');
      }

      if (!updatedInvoice.guardian && guardianRef) {
        updatedInvoice.guardian = guardianRef;
      }

      const resolveId = (value) => {
        if (!value) return null;
        if (typeof value === 'object' && value._id) return value._id;
        return value;
      };

      const guardianIdValue = resolveId(updatedInvoice.guardian) || resolveId(guardianRef);
      const studentAdjustmentsDetails = [];
      let guardianSummary = null;
      let guardianBeforeHours = null;
      let guardianAfterHours = null;
      let leftoverAppliedToGuardian = 0;

      if (guardianIdValue && normalizedHours > 0) {
        const guardianUser = await User.findById(guardianIdValue);
        if (guardianUser && guardianUser.guardianInfo) {
          guardianUser.guardianInfo = guardianUser.guardianInfo || {};
          guardianUser.guardianInfo.autoTotalHours = false;

          const initialTotalHours = Number(guardianUser.guardianInfo.totalHours || 0);
          guardianBeforeHours = Number.isFinite(initialTotalHours) ? roundHours(initialTotalHours) : 0;

          if (refundableItems.length === 0 && normalizedHours > initialTotalHours + EPSILON_HOURS) {
            throw new Error('Refund hours exceed guardian balance');
          }

          const studentsArray = Array.isArray(guardianUser.guardianInfo.students)
            ? guardianUser.guardianInfo.students
            : [];

          const hoursByStudent = new Map();
          let totalItemHours = 0;
          for (const item of refundableItems) {
            const hours = roundHours(item.duration / 60);
            totalItemHours += hours;
            const current = hoursByStudent.get(item.studentId) || 0;
            hoursByStudent.set(item.studentId, current + hours);
          }

          let hoursDistributed = 0;
          const buildStudentName = (student) => {
            if (!student) return null;
            const first = student.firstName || student.studentFirstName || '';
            const last = student.lastName || student.studentLastName || '';
            const combined = [first, last].filter(Boolean).join(' ').trim();
            if (combined) return combined;
            return student.name || student.studentName || student.fullName || null;
          };

          if (studentsArray.length && hoursByStudent.size && totalItemHours > EPSILON_HOURS) {
            const ratio = Math.min(1, normalizedHours / totalItemHours);

            const applyToSubdoc = (studentId, hoursToRemove) => {
              let subdoc = null;
              if (typeof studentsArray.id === 'function') {
                subdoc = studentsArray.id(studentId);
              }
              if (!subdoc) {
                subdoc = studentsArray.find((student) => {
                  const idValue = student && (student._id || student.id || student.studentId);
                  return idValue && String(idValue) === String(studentId);
                });
              }
              if (!subdoc) return false;

              const current = Number(subdoc.hoursRemaining ?? subdoc.hoursLeft ?? 0) || 0;
              const beforeValue = roundHours(current);
              const updated = Math.max(0, roundHours(current - hoursToRemove));
              const actualRemoved = Math.max(0, roundHours(beforeValue - updated));
              if (Object.prototype.hasOwnProperty.call(subdoc, 'hoursRemaining')) {
                subdoc.hoursRemaining = updated;
              }
              if (Object.prototype.hasOwnProperty.call(subdoc, 'hoursLeft')) {
                subdoc.hoursLeft = updated;
              }
              studentAdjustmentsDetails.push({
                studentId: String(studentId),
                name: buildStudentName(subdoc),
                hoursBefore: beforeValue,
                hoursAfter: updated,
                hoursRemoved: actualRemoved
              });
              return true;
            };

            for (const [studentId, studentHours] of hoursByStudent.entries()) {
              const hoursToRemove = roundHours(studentHours * ratio);
              if (hoursToRemove <= 0) continue;
              const applied = applyToSubdoc(studentId, hoursToRemove);
              if (applied) {
                const detail = studentAdjustmentsDetails[studentAdjustmentsDetails.length - 1];
                const appliedHours = detail ? detail.hoursRemoved : hoursToRemove;
                hoursDistributed = roundHours(hoursDistributed + appliedHours);
              }
            }

            if (studentAdjustmentsDetails.length) {
              guardianUser.markModified?.('guardianInfo.students');
            }
          }

          const leftover = Math.max(0, roundHours(normalizedHours - hoursDistributed));
          leftoverAppliedToGuardian = leftover;

          // ✅ FIX: Always subtract normalizedHours from initialTotalHours
          // Don't recalculate from students after adjustment (that causes double-subtraction)
          const finalTotalHours = Math.max(0, roundHours(initialTotalHours - normalizedHours));

          guardianUser.guardianInfo.totalHours = finalTotalHours;
          guardianUser.markModified?.('guardianInfo.totalHours');
          guardianAfterHours = roundHours(finalTotalHours);

          if (studentAdjustmentsDetails.length) {
            console.log('🧮 [InvoiceService] Student hour adjustments (guardian subdocs)', studentAdjustmentsDetails);
            await Promise.all(studentAdjustmentsDetails.map(async ({ studentId, hoursRemoved, name, hoursBefore, hoursAfter }) => {
              try {
                const studentDoc = await User.findById(studentId);
                if (!studentDoc || !studentDoc.studentInfo) return;
                const current = Number(studentDoc.studentInfo.hoursLeft ?? studentDoc.studentInfo.hoursRemaining ?? 0) || 0;
                const updated = Math.max(0, roundHours(current - hoursRemoved));
                if (Object.prototype.hasOwnProperty.call(studentDoc.studentInfo, 'hoursLeft')) {
                  studentDoc.studentInfo.hoursLeft = updated;
                }
                if (Object.prototype.hasOwnProperty.call(studentDoc.studentInfo, 'hoursRemaining')) {
                  studentDoc.studentInfo.hoursRemaining = updated;
                }
                studentDoc.markModified?.('studentInfo');
                await studentDoc.save();
                console.log('   ↳ [InvoiceService] Student hours persisted', {
                  studentId: String(studentId),
                  name,
                  beforeInvoice: hoursBefore,
                  afterInvoice: hoursAfter,
                  studentDocBefore: roundHours(current),
                  studentDocAfter: updated
                });
              } catch (studentUpdateErr) {
                console.warn('Failed to update student minutes after refund', studentUpdateErr?.message || studentUpdateErr);
              }
            }));
          }

          await guardianUser.save();
          guardianSummary = {
            before: guardianBeforeHours,
            after: guardianAfterHours,
            delta: roundHours(guardianAfterHours - guardianBeforeHours),
            leftoverApplied: leftoverAppliedToGuardian,
            students: studentAdjustmentsDetails
          };
          console.log('✅ [InvoiceService] Guardian hours adjustment', guardianSummary);

          try {
            const GuardianModel = require('../models/Guardian');
            const guardianModel = await GuardianModel.findOne({ user: guardianUser._id });
            if (guardianModel) {
              guardianModel.totalRemainingMinutes = Math.max(0, Math.round(finalTotalHours * 60));
              await guardianModel.save();
            }
          } catch (guardianUpdateErr) {
            console.warn('Failed to update Guardian minutes after refund', guardianUpdateErr.message);
          }
        }
      }

      const recalculatedCoverageHours = calculatePaidHoursFromLogs(updatedInvoice, hourlyRate);
      const totalItemHours = computeInvoiceItemHours(updatedInvoice);
      const effectiveCoverage = Math.min(recalculatedCoverageHours, totalItemHours);

      const coverage = updatedInvoice.coverage && typeof updatedInvoice.coverage === 'object' ? updatedInvoice.coverage : {};
      coverage.maxHours = roundHours(Math.max(0, effectiveCoverage));
      coverage.updatedAt = new Date();
      coverage.updatedBy = adminUserId || coverage.updatedBy;
      updatedInvoice.coverage = coverage;
      updatedInvoice.markModified('coverage');

      console.log('🛡️ [InvoiceService] Coverage hours recalculated', {
        coverageBefore,
        coverageAfter: coverage.maxHours,
        normalizedHours,
        totalItemHours,
        recalculatedCoverageHours
      });

      updatedInvoice.recalculateTotals();

      const itemDates = Array.isArray(updatedInvoice.items)
        ? updatedInvoice.items
          .map((item) => {
            if (!item) return null;
            const raw = item.date || item.scheduledDate || null;
            if (!raw) return null;
            const parsed = raw instanceof Date ? raw : new Date(raw);
            return Number.isNaN(parsed?.getTime?.()) ? null : parsed;
          })
          .filter(Boolean)
          .sort((a, b) => a.getTime() - b.getTime())
        : [];
      const invoiceStartDate = itemDates.length ? itemDates[0] : null;
      const invoiceEndDate = itemDates.length ? itemDates[itemDates.length - 1] : null;

      const statusAfter = updatedInvoice.status;

      const formatHoursValue = (value) => {
        if (!Number.isFinite(value)) return '0';
        const normalized = Math.round(value * 100) / 100;
        return Number.isInteger(normalized) ? normalized.toString() : normalized.toFixed(2);
      };
      const formatHourLabel = (value) => {
        if (!Number.isFinite(value)) return '0 hours';
        const normalized = Math.round(value * 100) / 100;
        const label = Number.isInteger(normalized) ? normalized.toString() : normalized.toFixed(2);
        const singular = Math.abs(normalized - 1) < 1e-9;
        return `${label} hour${singular ? '' : 's'}`;
      };
      const formatCurrency = (value) => (Number.isFinite(value) ? value.toFixed(2) : '0.00');

      const summaryMessageParts = [];
      summaryMessageParts.push(`Refunded ${formatHourLabel(normalizedHours)} ($${formatCurrency(normalizedAmount)}).`);

      if (guardianSummary) {
        summaryMessageParts.push(`Guardian paid hours were ${formatHoursValue(guardianSummary.before)} and became ${formatHoursValue(guardianSummary.after)}.`);
      }

      const coverageChanged = Math.abs((coverage.maxHours || 0) - (coverageBefore || 0)) > EPSILON_HOURS;
      const rangeLabel = `${invoiceStartDate ? dayjs(invoiceStartDate).format('MMM D, YYYY') : 'N/A'} to ${invoiceEndDate ? dayjs(invoiceEndDate).format('MMM D, YYYY') : 'N/A'}`;
      summaryMessageParts.push(
        coverageChanged
          ? `Invoice coverage now ${formatHourLabel(coverage.maxHours)} (was ${formatHourLabel(coverageBefore)}), spanning ${rangeLabel}.`
          : `Invoice coverage remains ${formatHourLabel(coverage.maxHours)}, spanning ${rangeLabel}.`
      );

      if (transferFeeAmount > EPSILON_CURRENCY) {
        const remainingTransferFee = roundCurrency(transferFeeAmount - proportionalFee);
        summaryMessageParts.push(
          proportionalFee > EPSILON_CURRENCY
            ? `Transfer fees: $${formatCurrency(transferFeeAmount)} → $${formatCurrency(remainingTransferFee)} (refunded $${formatCurrency(proportionalFee)}).`
            : `Transfer fees remain $${formatCurrency(transferFeeAmount)} (no fee refund).`
        );
      }

      summaryMessageParts.push(`Invoice status changed from ${statusBefore} to ${statusAfter}.`);

      const summaryMessage = summaryMessageParts.filter(Boolean).join(' ');

      await updatedInvoice.recordAuditEntry({
        actor: adminUserId,
        action: 'refund_adjustment',
        diff: {
          refundHours: normalizedHours,
          coverageBefore,
          coverageAfter: coverage.maxHours,
          expectedAmount,
          refundAmount: normalizedAmount
        },
        meta: {
          reason: refundData.reason || null,
          refundReference: refundData.refundReference || null
        }
      });

      await updatedInvoice.save();

      await InvoiceService.syncInvoiceCoverageClasses(updatedInvoice);

      await updatedInvoice.populate([
        { path: 'guardian', select: 'firstName lastName email guardianInfo' },
        { path: 'teacher', select: 'firstName lastName email' },
        { path: 'items.student', select: 'firstName lastName email' }
      ]);

      try {
        const notificationService = require('../services/notificationService');
        notificationService.notifyInvoiceEvent({
          invoice: updatedInvoice,
          eventType: 'refunded'
        }).catch(console.error);
      } catch (notifyErr) {
        console.warn('Invoice refund notification failed', notifyErr.message);
      }

      const refundSummary = {
        guardianHours: guardianSummary,
        studentAdjustments: studentAdjustmentsDetails,
        transferFee: {
          totalOnInvoice: transferFeeAmount,
          refundedPortion: proportionalFee,
          refunded: proportionalFee > EPSILON_CURRENCY
        },
        coverage: {
          before: coverageBefore,
          after: coverage.maxHours,
          normalizedHours,
          totalItemHours,
          recalculatedCoverageHours
        },
        invoiceDates: {
          start: invoiceStartDate ? invoiceStartDate.toISOString() : null,
          end: invoiceEndDate ? invoiceEndDate.toISOString() : null
        },
        status: {
          before: statusBefore,
          after: statusAfter
        },
        refund: {
          amount: normalizedAmount,
          expectedAmount,
          baseAmount,
          hours: normalizedHours,
          processedAt
        },
        message: summaryMessage
      };

      console.log('📬 [InvoiceService] Refund summary', refundSummary);
      console.log('✅ [InvoiceService] recordInvoiceRefund COMPLETE', { invoiceId, statusBefore, statusAfter });

      return { success: true, invoice: updatedInvoice, summary: refundSummary };
    } catch (err) {
      console.error('Error processing invoice refund:', err);
      if (err && err.name === 'VersionError') {
        return { success: false, error: 'conflict', message: 'Invoice was modified by another user. Please refresh and retry.' };
      }
      return { success: false, error: err.message };
    }
  }

  /**
   * Generate invoice docx buffer
   */
  static async generateInvoiceDocx(invoiceId) {
    try {
      const invoice = await Invoice.findById(invoiceId)
        .populate('guardian', 'firstName lastName email phone timezone timeZone')
        .populate('teacher', 'firstName lastName email')
        .populate('items.student', 'firstName lastName email');

      if (!invoice) throw new Error('Invoice not found');

      const guardianTimezone = invoice.guardian?.timezone
        || invoice.guardian?.timeZone
        || invoice.metadata?.timezone
        || 'UTC';

      const locale = 'en-US';

      let snapshot;
      try {
        snapshot = typeof invoice.getExportSnapshot === 'function'
          ? invoice.getExportSnapshot({ timezone: guardianTimezone, locale })
          : null;
      } catch (snapshotErr) {
        console.error('Failed to build invoice export snapshot', snapshotErr.message);
        snapshot = null;
      }

      if (!snapshot) {
        throw new Error('Unable to generate export snapshot for invoice');
      }

      let previousSnapshot = null;
      if (invoice.guardian) {
        try {
          const previousInvoice = await Invoice.findOne({
            _id: { $ne: invoice._id },
            guardian: invoice.guardian._id || invoice.guardian,
            type: invoice.type,
            status: { $nin: ['cancelled'] },
            createdAt: { $lt: invoice.createdAt || new Date() }
          })
            .sort({ createdAt: -1 })
            .select('-activityLog -delivery.channels');

          if (previousInvoice && typeof previousInvoice.getExportSnapshot === 'function') {
            previousSnapshot = previousInvoice.getExportSnapshot({
              timezone: guardianTimezone,
              locale,
              includeItems: false,
              includePayments: false,
              includeActivity: false
            });
          }
        } catch (prevErr) {
          console.warn('Unable to load previous invoice snapshot', prevErr.message);
        }
      }

      const buffer = await generateInvoiceDoc(invoice, {
        snapshot,
        previousSnapshot,
        timezone: guardianTimezone,
        locale
      });

      return { success: true, buffer, snapshot };
    } catch (err) {
      console.error('Error generating invoice docx:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Toggle invoice sent state
   */
  static async toggleInvoiceSent(invoiceId, sendInfo) {
    try {
      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) throw new Error('Invoice not found');

      const info = sendInfo || {};
      const {
        sent,
        via,
        sentAt,
        templateId,
        meta,
        messageHash,
        note,
        deliveryStatus,
        reminderType,
        force,
        adminUserId
      } = info;

      const alreadySent = Boolean(invoice.emailSent && invoice.emailSentDate);
      if (sent === true && alreadySent && !force) {
        await invoice.populate([
          { path: 'guardian', select: 'firstName lastName email' },
          { path: 'teacher', select: 'firstName lastName email' },
          { path: 'items.student', select: 'firstName lastName email' }
        ]);
        return { success: true, invoice, alreadySent: true };
      }

      const VALID_REMINDER_TYPES = ['first_reminder', 'second_reminder', 'final_notice'];

      if (typeof sent === 'boolean') {
        invoice.emailSent = sent;
        invoice.emailSentDate = sent ? (sentAt ? new Date(sentAt) : new Date()) : null;
        invoice.emailSentMethod = sent ? (via || invoice.emailSentMethod || 'email') : null;

        if (sent) {
          invoice.status = invoice.status === 'draft' ? 'sent' : invoice.status;
          if (reminderType && VALID_REMINDER_TYPES.includes(reminderType)) {
            invoice.remindersSent = Array.isArray(invoice.remindersSent) ? invoice.remindersSent : [];
            invoice.remindersSent.push({
              sentDate: invoice.emailSentDate,
              type: reminderType
            });
          }
        }
      }

  const deliveryPayload = info.delivery || {};
  const channel = deliveryPayload.channel || via;
  const resolvedStatus = deliveryPayload.status || deliveryStatus || (sent === false ? 'queued' : 'sent');
      const resolvedTemplateId = deliveryPayload.templateId ?? templateId ?? null;
      const resolvedMeta = deliveryPayload.meta ?? meta ?? null;
      const resolvedSentAt = deliveryPayload.sentAt ?? sentAt ?? null;
      const resolvedMessageHash = deliveryPayload.messageHash ?? messageHash ?? null;
      const normalizedSentAt = (() => {
        if (!resolvedSentAt) return null;
        if (resolvedSentAt instanceof Date) return resolvedSentAt;
        const parsed = new Date(resolvedSentAt);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      })();
      const sentAtIso = normalizedSentAt ? normalizedSentAt.toISOString() : null;

      if (channel) {
        invoice.recordDelivery({
          channel,
          status: resolvedStatus,
          templateId: resolvedTemplateId,
          meta: resolvedMeta,
          sentAt: normalizedSentAt || resolvedSentAt,
          messageHash: resolvedMessageHash,
          actor: adminUserId,
          note
        });

        await invoice.recordAuditEntry({
          actor: adminUserId,
          action: 'delivery',
          diff: {
            channel,
            status: resolvedStatus,
            templateId: resolvedTemplateId,
            messageHash: resolvedMessageHash,
            emailSent: invoice.emailSent,
            emailSentMethod: invoice.emailSentMethod,
            emailSentDate: invoice.emailSentDate ? invoice.emailSentDate.toISOString() : null
          },
          meta: {
            force: Boolean(force),
            route: 'toggleInvoiceSent',
            sentAt: sentAtIso
          }
        });
      }

      invoice.updatedBy = adminUserId || invoice.updatedBy;

      await invoice.save();
      await invoice.populate([
        { path: 'guardian', select: 'firstName lastName email' },
        { path: 'teacher', select: 'firstName lastName email' },
        { path: 'items.student', select: 'firstName lastName email' }
      ]);

      // If we just sent the invoice and the resolved channel or invoice prefers PayPal,
      // create a simple PayPal payment link notification for the guardian.
      try {
        const shouldNotifyPaypal = Boolean(sent && (channel === 'paypal' || invoice.paymentMethod === 'paypal' || invoice.emailSentMethod === 'paypal'));
        if (shouldNotifyPaypal && invoice.guardian) {
          try {
            // ensure we have some paypal reference
            if (!invoice.paypalInvoiceNumber) {
              invoice.paypalInvoiceNumber = invoice.invoiceNumber || String(invoice._id);
              await invoice.save();
            }

            const notificationService = require('../services/notificationService');
            const paypalBase = process.env.PAYPAL_PAYMENT_URL || 'https://www.paypal.com/invoice/paying/?invoice=';
            const ref = invoice.paypalInvoiceNumber || invoice.invoiceNumber || String(invoice._id);
            const payLink = `${paypalBase}${encodeURIComponent(ref)}`;

            await notificationService.createNotification({
              userId: invoice.guardian,
              title: 'Invoice sent',
              message: 'Your invoice has been sent. Open it to review and pay via PayPal.',
              type: 'invoice',
              relatedTo: 'invoice',
              relatedId: invoice._id,
              actionRequired: true,
              actionLink: payLink
            });
          } catch (notifyErr) {
            console.warn('Failed to create PayPal notification for invoice:', notifyErr.message);
          }
        }
      } catch (outerNotifyErr) {
        console.warn('PayPal notification flow errored:', outerNotifyErr.message);
      }

      return { success: true, invoice };
    } catch (err) {
      console.error('Error toggling invoice sent state:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Pending for guardian
   */
  static async getPendingInvoicesForGuardian(guardianId) {
    try {
      const invoices = await Invoice.find({ guardian: guardianId, status: { $in: ['draft','sent'] } })
        .populate('items.student','firstName lastName')
        .lean();
      return { success: true, invoices };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Invoice stats
   */
  static async getInvoiceStats() {
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // Faceted aggregation to compute main counters
      const stats = await Invoice.aggregate([
        {
          $facet: {
            totalInvoices: [
              { $match: { type: 'guardian_invoice' } },
              { $count: 'count' }
            ],
            paidInvoices: [
              { $match: { type: 'guardian_invoice', status: 'paid' } },
              { $count: 'count' }
            ],
            pendingInvoices: [
              { $match: { type: 'guardian_invoice', status: { $in: ['draft','sent'] } } },
              { $count: 'count' }
            ],
            monthlyRevenue: [
              { $match: { type: 'guardian_invoice', status: 'paid', 'billingPeriod.year': year, 'billingPeriod.month': month } },
              { $group: { _id: null, total: { $sum: '$total' } } }
            ],
            // zeroHourStudents: count distinct students across guardians with hoursRemaining <= 0
            // To avoid brittle invoice->users lookup, compute from users collection
            dummy: [ { $match: { _id: null } } ]
          }
        }
      ]);

      // safe extraction
      const top = stats[0] || {};
      const result = {
        totalInvoices: top.totalInvoices?.[0]?.count || 0,
        paidInvoices: top.paidInvoices?.[0]?.count || 0,
        pendingInvoices: top.pendingInvoices?.[0]?.count || 0,
        monthlyRevenue: top.monthlyRevenue?.[0]?.total || 0,
        zeroHourStudents: 0
      };

      // Compute zero-hour guardians (count guardians who have at least one student with <= 0 hours)
      const zeroGuardiansAgg = await User.aggregate([
        { $match: { role: 'guardian', isActive: true } },
        { $project: { students: '$guardianInfo.students' } },
        { $unwind: { path: '$students', preserveNullAndEmptyArrays: false } },
        { $match: { 'students.hoursRemaining': { $lte: 0 } } },
        { $group: { _id: '$_id' } }, // Group by guardian ID, not student ID
        { $count: 'count' }
      ]);

      result.zeroHourStudents = zeroGuardiansAgg[0]?.count || 0;

      return { success: true, stats: result };
    } catch (err) {
      console.error('Error getting invoice stats:', err);
      return { success: false, error: err.message };
    }
  }

}

module.exports = InvoiceService;
