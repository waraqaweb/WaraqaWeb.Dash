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
const utcPlugin = require('dayjs/plugin/utc');
const timezonePlugin = require('dayjs/plugin/timezone');
dayjs.extend(utcPlugin);
dayjs.extend(timezonePlugin);
const notificationService = require('./notificationService');
const TeacherSalaryService = require('./teacherSalaryService');

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

const getCalendarMonthEndExclusive = (value) => {
  const base = ensureDate(value) || new Date();
  return new Date(base.getFullYear(), base.getMonth() + 1, 1);
};

const getCalendarMonthEndInclusive = (value) => {
  const exclusiveEnd = getCalendarMonthEndExclusive(value);
  return new Date(exclusiveEnd.getTime() - 1);
};

const getFixedWindowEndExclusive = (value, days = 30) => {
  const base = ensureDate(value) || new Date();
  return new Date(base.getTime() + (days * 24 * 60 * 60 * 1000));
};

const getFixedWindowEndInclusive = (value, days = 30) => {
  const exclusiveEnd = getFixedWindowEndExclusive(value, days);
  return new Date(exclusiveEnd.getTime() - 1);
};

/** Returns the number of days in the calendar month of the given date. */
const getDaysInMonth = (date) => {
  const d = ensureDate(date) || new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};

/**
 * Compute the billing window (in days) for an invoice.
 * Uses the billing period span if available, otherwise falls back to the
 * calendar month length of the start date.
 */
const deriveBillingWindowDays = (invoice) => {
  const start = ensureDate(invoice?.billingPeriod?.startDate);
  const end = ensureDate(invoice?.billingPeriod?.endDate);
  if (start && end) {
    const diffDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays > 0 && diffDays <= 90) return diffDays;
  }
  if (start) return getDaysInMonth(start);
  return 30;
};

const EPSILON_HOURS = 0.0005;
const EPSILON_CURRENCY = 0.05;
const ACTIVE_UNPAID_INVOICE_STATUSES = ['draft', 'pending', 'sent', 'overdue'];
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
  'cancelled_by_student',
  'cancelled_by_guardian',
  'cancelled_by_admin',
  'cancelled_by_system',
  'on_hold',
  'pattern'
]);

/** Statuses that are never billable (cancelled + teacher-fault + expired) */
const NOT_ELIGIBLE_STATUSES = new Set([
  ...CANCELLED_CLASS_STATUSES,
  'no_show_both',       // Neither party showed up
  'unreported'          // Marked as unreported by admin (report window fully expired)
]);

/** Confirmed = already happened and counted toward hours */
const CONFIRMED_CLASS_STATUSES = new Set(['attended', 'missed_by_student']);

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

/**
 * Classify a class into one of three categories for invoice purposes:
 *   'confirmed'     — already happened and counted (attended, missed_by_student)
 *   'eligible'      — expected to count (scheduled, report window active, future)
 *   'not_eligible'  — won't count (cancelled, no_show_both, expired window, etc.)
 */
const classifyClassStatus = (cls, now = new Date()) => {
  const status = normalizeStatusValue(cls?.status);

  // 1) Confirmed (final outcomes that always count)
  if (CONFIRMED_CLASS_STATUSES.has(status)) return 'confirmed';

  // 2) Hard not-eligible (cancelled, pattern, on_hold, no_show_both, unreported)
  if (NOT_ELIGIBLE_STATUSES.has(status)) return 'not_eligible';

  // 3) Future classes with eligible status → eligible
  const scheduledDate = ensureDate(cls?.scheduledDate || cls?.dateTime);
  if (!scheduledDate) return 'not_eligible';

  if (scheduledDate > now) {
    if (FUTURE_ELIGIBLE_STATUSES.has(status) || !status) return 'eligible';
    return 'not_eligible';
  }

  // 4) Past class: check if report window is still active
  if (cls?.reportSubmission?.adminExtension?.granted) {
    // Admin extension was granted — check if it expired
    const expiresAt = ensureDate(cls.reportSubmission.adminExtension.expiresAt);
    if (!expiresAt || now <= expiresAt) return 'eligible';
    // Extension expired → not eligible (unless reopened by a new extension)
    return 'not_eligible';
  }

  if (isSubmissionWindowActive(cls, now)) return 'eligible';

  // 5) Past class with expired submission window → not eligible
  return 'not_eligible';
};

const isClassEligibleForDynamicInvoice = (cls, now = new Date()) => {
  return classifyClassStatus(cls, now) !== 'not_eligible';
};

class InvoiceService {

  /**
   * Create an adjustment entry on a paid invoice when a class changes post-payment.
   * @param {Object} options
   * @param {string|ObjectId} options.invoiceId - The paid invoice ID
   * @param {string} options.type - 'credit' or 'debit'
   * @param {string} options.reason - 'class_deleted', 'duration_changed', 'class_cancelled', 'manual'
   * @param {Object} options.classDoc - The class document (or snapshot)
   * @param {string} options.description - Human-readable description
   * @param {number} options.hoursDelta - Negative = credit (guardian overpaid)
   * @param {number} options.amountDelta - Negative = credit
   * @param {number} [options.previousDuration] - For duration changes
   * @param {number} [options.newDuration] - For duration changes
   * @param {ObjectId} [options.actorId] - Who triggered this
   */
  static async createPaidInvoiceAdjustment(options) {
    const Invoice = require('../models/Invoice');
    const {
      invoiceId, type, reason, classDoc, description,
      hoursDelta, amountDelta, previousDuration, newDuration, actorId
    } = options;

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      console.warn(`[createPaidInvoiceAdjustment] Invoice ${invoiceId} not found`);
      return null;
    }

    const studentName = classDoc?.student?.studentName
      || [classDoc?.student?.firstName, classDoc?.student?.lastName].filter(Boolean).join(' ')
      || '';

    // Cancelled-class credits are auto-settled: the class was never delivered,
    // so there is nothing to carry forward to future invoices.
    const autoSettle = reason === 'class_cancelled' && type === 'credit';

    const adjustment = {
      type,
      reason,
      classId: classDoc?._id || null,
      classSnapshot: {
        scheduledDate: classDoc?.scheduledDate || classDoc?.dateTime || null,
        duration: previousDuration || Number(classDoc?.duration || 0),
        subject: classDoc?.subject || '',
        studentName
      },
      description,
      hoursDelta,
      amountDelta,
      previousDuration: previousDuration || undefined,
      newDuration: newDuration || undefined,
      settled: autoSettle,
      createdAt: new Date(),
      createdBy: actorId || null
    };

    if (!Array.isArray(invoice.adjustments)) {
      invoice.adjustments = [];
    }
    invoice.adjustments.push(adjustment);
    invoice.markModified('adjustments');
    invoice._skipRecalculate = true;
    await invoice.save();

    await invoice.recordAuditEntry({
      actor: actorId,
      action: 'update',
      diff: {
        adjustmentAdded: {
          type, reason, hoursDelta, amountDelta,
          classId: classDoc?._id?.toString() || null,
          description
        }
      },
      meta: { note: `Post-payment adjustment: ${description}` }
    });

    console.log(`[createPaidInvoiceAdjustment] Created ${type} adjustment on invoice ${invoiceId}: ${description}`);
    return adjustment;
  }

  /**
   * Check guardians according to billing system and create invoices.
   */
  static async checkAndCreateZeroHourInvoices() {
    try {
      console.log('🔍 [InvoiceService] Starting zero-hour invoice check...');

      const skippedByReason = new Map();
      const enqueueSkipped = ({ guardian, reasonCode, reasonLabel, details, actionLink, metadata = {} }) => {
        if (!guardian?._id) return;
        const reasonKey = reasonCode || reasonLabel || 'unknown_reason';
        const existing = skippedByReason.get(reasonKey) || {
          reasonCode,
          reasonLabel,
          details,
          actionLink,
          metadata,
          guardians: []
        };
        existing.guardians.push(guardian);
        if (!existing.reasonLabel && reasonLabel) existing.reasonLabel = reasonLabel;
        if (!existing.details && details) existing.details = details;
        if (!existing.actionLink && actionLink) existing.actionLink = actionLink;
        skippedByReason.set(reasonKey, existing);
      };

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
          enqueueSkipped({
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

      const activeInvoiceStatuses = ['draft', 'pending', 'sent', 'overdue'];

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
          enqueueSkipped({
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
            enqueueSkipped({
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
            enqueueSkipped({
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
          const ceCode = createErr?.code;
          const ceName = createErr?.codeName;
          const ceMsg = createErr?.message || '';
          if (ceCode === 20 || ceName === 'IllegalOperation'
              || ceMsg.includes('Transaction numbers')
              || ceMsg.includes('replica set')
              || ceCode === 263 || ceName === 'OperationNotSupportedInTransaction') {
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
          status: { $nin: [...NOT_ELIGIBLE_STATUSES] },
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
          .select('scheduledDate duration subject status teacher student reportSubmission date')
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

        const targetMonth = new Date(startDate).getMonth() + 1;
        const targetYear = new Date(startDate).getFullYear();
        const existing = await Invoice.findOne({
          guardian: guardian._id,
          type: 'guardian_invoice',
          deleted: { $ne: true },
          'billingPeriod.month': targetMonth,
          'billingPeriod.year': targetYear
        });

        if (existing) continue;

        // Cap auto-generated coverage at the end of the start month
        const endDate = getFixedWindowEndExclusive(startDate, getDaysInMonth(startDate));

        // Filter classes to only include those within the current calendar-month boundary
        // and that pass eligibility checks (expired admin extensions, submission windows, etc.)
        const nowMonthly = new Date();
        const selectedClasses = unpaidClasses.filter(cls => {
          const clsDate = new Date(cls.scheduledDate || cls.date);
          if (clsDate < new Date(startDate) || clsDate >= endDate) return false;
          const enriched = {
            ...cls,
            reportSubmissionAllowance: ensureDate(cls?.reportSubmission?.teacherDeadline),
            reportSubmissionExtendedUntil: ensureDate(cls?.reportSubmission?.adminExtension?.expiresAt)
          };
          return isClassEligibleForDynamicInvoice(enriched, nowMonthly);
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
          billingType: 'monthly',
          generationSource: 'auto-monthly',
          billingPeriod: {
            startDate,
            endDate: endDate, // Use the calculated one month end date
            month: new Date(startDate).getMonth() + 1,
            year: new Date(startDate).getFullYear(),
          },
          items,
          subtotal,
          total: subtotal,
          status: "pending",
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
      const createdDebug = invoicesCreated.map((invoiceDoc) => {
        const linkedClassCount = Array.isArray(invoiceDoc?.items)
          ? invoiceDoc.items.filter((it) => Boolean(it?.class || it?.lessonId)).length
          : 0;
        return {
          id: invoiceDoc?._id ? String(invoiceDoc._id) : null,
          invoiceNumber: invoiceDoc?.invoiceNumber || null,
          invoiceSlug: invoiceDoc?.invoiceSlug || null,
          generationSource: invoiceDoc?.generationSource || null,
          billingStart: invoiceDoc?.billingPeriod?.startDate || null,
          billingEnd: invoiceDoc?.billingPeriod?.endDate || null,
          selectedClassCount: linkedClassCount,
          itemCount: Array.isArray(invoiceDoc?.items) ? invoiceDoc.items.length : 0,
        };
      });

      return {
        success: true,
        invoicesCreated: invoicesCreated.length,
        invoices: invoicesCreated,
        createdDebug,
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
        status: { $in: ['draft', 'pending', 'sent', 'overdue'] }
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
          status: { $nin: [...NOT_ELIGIBLE_STATUSES] }
        })
          .sort({ scheduledDate: 1 })
          .select('scheduledDate')
          .lean();
        
        if (earliestClass && earliestClass.scheduledDate < billingStartDate) {
          billingStartDate = earliestClass.scheduledDate;
          console.log(`[First-Lesson Invoice] Found earlier unbilled class: ${billingStartDate.toISOString()}`);
        }
      }
      
      // Cap auto-generated coverage at the end of the earliest class's calendar month
      let billingWindowDays = getDaysInMonth(billingStartDate);
      let searchEndDate = getFixedWindowEndExclusive(billingStartDate, billingWindowDays);

      // If the triggering class is outside the window derived from the earliest
      // unbilled class (different month), use the triggering class's own month
      // so the coverage window actually includes the class being billed.
      if (firstDate >= searchEndDate) {
        billingStartDate = firstDate;
        billingWindowDays = getDaysInMonth(firstDate);
        searchEndDate = getFixedWindowEndExclusive(firstDate, billingWindowDays);
      }

      // Build initial item from the reported class
      const duration = Number(classDoc.duration || 60);
      const hours = Number(duration) / 60;
      const rate = (Number.isFinite(classDoc.guardianRate) && classDoc.guardianRate > 0) ? classDoc.guardianRate : defaultRate;
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

      // Include ALL classes (attended, missed, scheduled) up to the month boundary of the first unpaid class
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
            status: { $nin: ['cancelled', 'refunded'] }
          });
          
          console.log(`[First-Lesson Invoice] Excluded billed class IDs: ${billedIds.length} classes`);
          
          // Query for ALL classes within the month (attended, missed, scheduled, AND pending report submission)
          // Start from EARLIEST unbilled class, not the triggering class
          let additional = await Class.find({
            'student.guardianId': guardian._id,
            'student.studentId': { $in: studentIds },
            scheduledDate: { $gte: billingStartDate, $lt: searchEndDate },
            // Exclude classes that are in active invoices
            _id: { $nin: billedIds },
            status: { $nin: [...NOT_ELIGIBLE_STATUSES] }
          })
            .select('_id subject scheduledDate duration student teacher status billedInInvoiceId classReport reportSubmission guardianRate')
            .lean();

          // Post-filter: catch expired admin extensions / submission windows
          const nowFirstLesson = new Date();
          additional = additional.filter(cls => {
            const enriched = {
              ...cls,
              reportSubmissionAllowance: ensureDate(cls?.reportSubmission?.teacherDeadline),
              reportSubmissionExtendedUntil: ensureDate(cls?.reportSubmission?.adminExtension?.expiresAt)
            };
            return isClassEligibleForDynamicInvoice(enriched, nowFirstLesson);
          });
          
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
            const clsRate = (Number.isFinite(cls.guardianRate) && cls.guardianRate > 0) ? cls.guardianRate : defaultRate;
            
            items.push({
              lessonId: String(cls._id),
              class: cls._id,
              student: cls.student?.studentId || null,
              studentSnapshot: { firstName: fn || studentFullName || '', lastName: ln || '', email: '' },
              teacher: cls.teacher || null,
              description: `${cls.subject || 'Class'}`,
              date: cls.scheduledDate || firstDate,
              duration: Number(cls.duration || 0) || 0,
              rate: clsRate,
              amount: Math.round((itemHours * clsRate) * 100) / 100,
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

      // Billing period: from earliest unbilled class through one calendar-month window
      const actualStartDate = billingStartDate;
      const billingPeriodEndDate = searchEndDate;

      const resolvedCoverageEnd = (() => {
        const explicitEnd = ensureDate(opts.billingPeriodEnd);
        if (explicitEnd) {
          explicitEnd.setHours(23, 59, 59, 999);
          return explicitEnd;
        }
        return getFixedWindowEndInclusive(actualStartDate, billingWindowDays);
      })();

      const invoice = new Invoice({
        type: 'guardian_invoice',
        guardian: guardian._id,
        billingType: 'payg',
        generationSource: 'first-lesson',
        billingPeriod: {
          startDate: actualStartDate,
          endDate: billingPeriodEndDate,
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
        coverage: { strategy: 'full_period', endDate: resolvedCoverageEnd, waiveTransferFee: false },
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
      const isAutoPayg = triggerSource === 'auto-payg';
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
      } else if (!isAutoPayg) {
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
      if (!dueOnlyHours && !isAutoPayg && (((guardian.guardianInfo?.totalHours || 0) <= 0 && zeroHourStudents.length === 0) || (shouldForceGuardianTopUp && zeroHourStudents.length === 0))) {
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
      // billingWindowDays: caller can override; otherwise derived from the calendar month of the start date
      const billingWindowDays = Number.isFinite(Number(opts.billingWindowDays)) && Number(opts.billingWindowDays) > 0
        ? Number(opts.billingWindowDays)
        : getDaysInMonth(billingStart);
      let billingEnd = opts.billingPeriodEnd instanceof Date ? opts.billingPeriodEnd : getFixedWindowEndExclusive(billingStart, billingWindowDays);

      let resolvedCoverageEnd = null;

      // Predictive coverage: Find ALL unpaid classes first to determine billing start date
      // from the earliest unpaid class, then include classes until that month boundary
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
            _id: { $nin: billedIds },
            status: { $nin: [...NOT_ELIGIBLE_STATUSES] }
          };
          if (trackedStudentIds.length > 0) {
            allUnpaidQuery['student.studentId'] = { $in: trackedStudentIds };
          }
          let allUnpaidClasses = await Class.find(allUnpaidQuery)
            .select('scheduledDate status reportSubmission')
            .sort({ scheduledDate: 1 })
            .lean();

          if (!allUnpaidClasses.length && trackedStudentIds.length > 0) {
            if (INVOICE_DEBUG) {
              console.log('🔎 [Zero-Hour PAYG Invoice] Fallback to guardian-only class lookup (studentId filter yielded 0).');
            }
            allUnpaidClasses = await Class.find({
              'student.guardianId': guardian._id,
              _id: { $nin: billedIds },
              status: { $nin: [...NOT_ELIGIBLE_STATUSES] }
            })
              .select('scheduledDate status reportSubmission')
              .sort({ scheduledDate: 1 })
              .lean();
          }

          // Use the earliest unpaid class date as billing start, or today if no classes
          if (allUnpaidClasses.length > 0 && allUnpaidClasses[0].scheduledDate) {
            billingStart = new Date(allUnpaidClasses[0].scheduledDate);
            billingEnd = getFixedWindowEndExclusive(billingStart, billingWindowDays);
          }

          console.log(`🔍 [Zero-Hour PAYG Invoice] Guardian: ${guardian.firstName} ${guardian.lastName}`);
          console.log(`🔍 [Zero-Hour PAYG Invoice] Total unpaid classes: ${allUnpaidClasses.length}`);
          console.log(`🔍 [Zero-Hour PAYG Invoice] Billing period: ${billingStart.toISOString()} → ${billingEnd.toISOString()}`);
          
          // ✅ Include classes within billing period — use shared NOT_ELIGIBLE filter
          const upcomingQuery = {
            'student.guardianId': guardian._id,
            scheduledDate: { $gte: billingStart, $lt: billingEnd },
            _id: { $nin: billedIds },
            paidByGuardian: { $ne: true },
            status: { $nin: [...NOT_ELIGIBLE_STATUSES] }
          };
          if (trackedStudentIds.length > 0) {
            upcomingQuery['student.studentId'] = { $in: trackedStudentIds };
          }

          let upcoming = await Class.find(upcomingQuery)
            .select('_id subject scheduledDate duration student teacher status reportSubmission guardianRate')
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
              status: upcomingQuery.status
            };
            upcoming = await Class.find(fallbackUpcomingQuery)
              .select('_id subject scheduledDate duration student teacher status reportSubmission guardianRate')
              .lean();
          }

          // Post-filter through classifyClassStatus to catch expired admin extensions
          const now_ = new Date();
          upcoming = upcoming.filter(cls => {
            const enriched = {
              ...cls,
              reportSubmissionAllowance: ensureDate(cls?.reportSubmission?.teacherDeadline),
              reportSubmissionExtendedUntil: ensureDate(cls?.reportSubmission?.adminExtension?.expiresAt)
            };
            return isClassEligibleForDynamicInvoice(enriched, now_);
          });

          console.log(`🔍 [Zero-Hour PAYG Invoice] Found ${upcoming.length} eligible classes in billing period`);

          if (Array.isArray(upcoming) && upcoming.length > 0) {
            const guardianDefaultRate = guardian.guardianInfo?.hourlyRate || defaultRate;
            items = upcoming.map((cls) => {
              const fullName = (cls.student && cls.student.studentName) || '';
              const [firstName, ...rest] = String(fullName).trim().split(' ').filter(Boolean);
              const lastName = rest.join(' ');
              
              // Use the actual class status from database - don't force or derive anything
              const classStatus = cls.status || 'scheduled';
              const attended = cls.status === 'attended';
              const rate = (Number.isFinite(cls.guardianRate) && cls.guardianRate > 0) ? cls.guardianRate : guardianDefaultRate;
              
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

      // For auto-payg zero-trigger invoices, only create invoices from real due classes (or explicit dueOnlyHours).
      // Do not create empty fallback invoices anchored to "today".
      if (isAutoPayg && dueOnlyHours <= 0 && (!Array.isArray(items) || items.length === 0)) {
        console.log(`⏭️ [Zero-Hour PAYG Invoice] Skipping ${guardian.firstName} ${guardian.lastName} - no unpaid classes found in derived ${billingWindowDays}-day window.`);
        return null;
      }

      resolvedCoverageEnd = (() => {
        const explicitEnd = ensureDate(opts.billingPeriodEnd || billingEnd);
        if (explicitEnd) {
          explicitEnd.setHours(23, 59, 59, 999);
          return explicitEnd;
        }
        return getFixedWindowEndInclusive(billingStart, billingWindowDays);
      })();

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
          endDate: resolvedCoverageEnd,
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
   * Record a cross-month teacher hour adjustment.
   *
   * When a class from a past month has its hours changed (duration edit,
   * status flip, deletion) the teacher's running `monthlyHours` counter
   * must NOT be touched — it belongs to the current calendar month.
   *
   * Instead we:
   *  1. Try to add an `extra` line to the nearest upcoming draft teacher
   *     invoice so it shows up on the next pay run.
   *  2. If no draft invoice exists yet, store a pending adjustment on
   *     `teacherInfo.pendingCrossMonthAdjustments` so it is picked up
   *     automatically when the next invoice is generated.
   */
  static async recordTeacherCrossMonthAdjustment({ teacher, classDoc, hoursDelta, reason }) {
    const CAIRO_TZ = 'Africa/Cairo';
    try {
      const TeacherInvoice = require('../models/TeacherInvoice');
      const User = require('../models/User');

      const teacherId = teacher._id || teacher;
      const teacherDoc = teacher._id ? teacher : await User.findById(teacherId);
      if (!teacherDoc) return;

      const classMonth = dayjs(classDoc.scheduledDate).tz(CAIRO_TZ);
      const origMonth = classMonth.month() + 1;   // 1-12
      const origYear  = classMonth.year();

      // Determine the teacher's rate for the adjustment amount
      let rateUSD = 0;
      try {
        const rateInfo = await TeacherSalaryService.getTeacherRate(teacherDoc, 0);
        rateUSD = rateInfo?.rate || teacherDoc.teacherInfo?.hourlyRate || 0;
      } catch (_) {
        rateUSD = teacherDoc.teacherInfo?.hourlyRate || 0;
      }
      const amountUSD = Math.round(hoursDelta * rateUSD * 100) / 100;

      const dateStr = classDoc.scheduledDate
        ? new Date(classDoc.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      const description = reason
        || `Cross-month adjustment for class (${classDoc.subject || 'Class'}) on ${dateStr}: ${hoursDelta > 0 ? '+' : ''}${hoursDelta.toFixed(2)}h`;

      console.log(`\n📆 [Cross-Month Adjustment] Teacher ${teacherDoc.firstName} ${teacherDoc.lastName}`);
      console.log(`   Class month: ${origYear}-${String(origMonth).padStart(2, '0')}`);
      console.log(`   Hours delta: ${hoursDelta > 0 ? '+' : ''}${hoursDelta.toFixed(2)}h`);
      console.log(`   Amount: $${amountUSD} @ $${rateUSD}/h`);

      // Try to find the nearest upcoming draft/published teacher invoice
      const upcomingInvoice = await TeacherInvoice.findOne({
        teacher: teacherId,
        status: { $in: ['draft', 'published'] },
        deleted: { $ne: true }
      }).sort({ year: 1, month: 1 });

      if (upcomingInvoice) {
        const cat = amountUSD < 0 ? 'penalty' : 'reimbursement';
        upcomingInvoice.addExtra({
          category: cat,
          amountUSD,
          reason: description.length >= 5 ? description.slice(0, 200) : `Adj: ${description}`.slice(0, 200)
        }, null);
        upcomingInvoice.calculateAmounts();
        await upcomingInvoice.save();

        console.log(`   ✅ Added extra to invoice ${upcomingInvoice.invoiceNumber} (${upcomingInvoice.year}-${String(upcomingInvoice.month).padStart(2, '0')})`);
        return { applied: true, invoiceId: upcomingInvoice._id };
      }

      // No draft invoice yet — store as a pending adjustment
      if (!teacherDoc.teacherInfo) teacherDoc.teacherInfo = {};
      if (!Array.isArray(teacherDoc.teacherInfo.pendingCrossMonthAdjustments)) {
        teacherDoc.teacherInfo.pendingCrossMonthAdjustments = [];
      }
      teacherDoc.teacherInfo.pendingCrossMonthAdjustments.push({
        classId: classDoc._id,
        classDate: classDoc.scheduledDate,
        classSubject: classDoc.subject || '',
        originalMonth: origMonth,
        originalYear: origYear,
        hoursDelta,
        reason: description.slice(0, 300),
        createdAt: new Date()
      });
      teacherDoc.markModified('teacherInfo.pendingCrossMonthAdjustments');
      await teacherDoc.save();

      console.log(`   📌 Stored as pending adjustment (no draft invoice yet)`);
      return { applied: false, pending: true };
    } catch (err) {
      console.error(`[recordTeacherCrossMonthAdjustment] Error:`, err.message);
      return { applied: false, error: err.message };
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

      // Extract guardian ID at the top level so both status-change and duration-change blocks can use it
      const guardianId = classDoc.student?.guardianId?._id || classDoc.student?.guardianId;

      // ─────────────────────────────────────────────────────────────
      // 💰 UNIFIED HOUR ADJUSTMENT (undo-then-apply pattern)
      //
      // Instead of separate blocks for (non→countable, countable→non,
      // countable→countable, duration-only) this single block computes:
      //   oldContrib = wasCountable ? prevDuration/60 : 0
      //   newContrib = isNowCountable ? currentDuration/60 : 0
      //   net = newContrib − oldContrib
      //
      // • net > 0 → teacher gains hours, guardian loses hours
      // • net < 0 → teacher loses hours, guardian gains hours
      // • net = 0 → no adjustment needed
      //
      // This naturally handles every combination:
      //   scheduled→attended       : 0 → 1h  = +1h
      //   attended→cancelled       : 1h → 0  = −1h  (uses PREVIOUS duration)
      //   attended→missed_by_student: 1h → 1h = 0   (same duration, no change)
      //   attended 60→attended 45  : 1h → 0.75h = −0.25h
      //   attended→missed_by_student + duration 60→45: 1h → 0.75h = −0.25h
      //
      // For teachers the adjustment is split by month:
      //   • Same month as class: addTeachingHours() (running counter)
      //   • Different month: recordTeacherCrossMonthAdjustment()
      //     puts an extra on the nearest upcoming teacher invoice
      //     (or stores a pending adjustment if none exists yet).
      //
      // Guardian hours are always adjusted immediately (running balance,
      // no monthly reset).
      // ─────────────────────────────────────────────────────────────

      const shouldAdjustHours = !skipHourAdjustment && (
        statusChanged ||
        (!statusChanged && durationChanged && isNowCountable)
      );

      if (shouldAdjustHours) {
        // Undo-then-apply: compute net contribution change
        const oldContrib = wasCountable ? prevDuration / 60 : 0;
        const newContrib = isNowCountable ? currentDuration / 60 : 0;
        const netHoursDiff = newContrib - oldContrib;

        const triggerLabel = statusChanged
          ? `Status ${prev.status || 'N/A'} → ${classDoc.status}`
          : `Duration ${prevDuration} → ${currentDuration} min (status unchanged: ${classDoc.status})`;

        console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
        console.log(`║  💰 HOUR ADJUSTMENT (undo-then-apply)                        ║`);
        console.log(`╚════════════════════════════════════════════════════════════════╝`);
        console.log(`📋 Class ID: ${classId}`);
        console.log(`📅 Date: ${classDoc.scheduledDate || 'N/A'}`);
        console.log(`📚 Subject: ${classDoc.subject || 'N/A'}`);
        console.log(`🔄 Trigger: ${triggerLabel}`);
        console.log(`📊 Old contrib: ${oldContrib.toFixed(2)}h (${wasCountable ? 'countable' : 'non-countable'}, ${prevDuration} min)`);
        console.log(`📊 New contrib: ${newContrib.toFixed(2)}h (${isNowCountable ? 'countable' : 'non-countable'}, ${currentDuration} min)`);
        console.log(`📊 Net diff: ${netHoursDiff > 0 ? '+' : ''}${netHoursDiff.toFixed(4)}h`);
        console.log(`════════════════════════════════════════════════════════════════\n`);

        const User = require('../models/User');

        if (netHoursDiff !== 0) {
          // ── Cross-month detection (teacher only) ──────────────────
          const CAIRO_TZ = 'Africa/Cairo';
          const classMonth = classDoc.scheduledDate ? dayjs(classDoc.scheduledDate).tz(CAIRO_TZ) : null;
          const nowCairo = dayjs().tz(CAIRO_TZ);
          const isSameMonth = classMonth
            ? (classMonth.month() === nowCairo.month() && classMonth.year() === nowCairo.year())
            : true; // if no scheduledDate, treat as current month

          // ── TEACHER HOURS ─────────────────────────────────────────
          if (classDoc.teacher) {
            try {
              const teacher = await User.findById(classDoc.teacher);
              if (teacher && teacher.role === 'teacher') {
                const oldHours = Number(teacher.teacherInfo?.monthlyHours || 0);
                console.log(`👨‍🏫 Teacher: ${teacher.firstName} ${teacher.lastName}`);
                console.log(`   Current monthlyHours: ${oldHours.toFixed(2)}h`);
                console.log(`   Adjustment: ${netHoursDiff > 0 ? '+' : ''}${netHoursDiff.toFixed(4)}h`);
                console.log(`   Same month as class: ${isSameMonth ? 'YES' : 'NO'}`);

                if (isSameMonth) {
                  await teacher.addTeachingHours(netHoursDiff);
                  console.log(`   ✅ monthlyHours updated → ${Number(teacher.teacherInfo?.monthlyHours || 0).toFixed(2)}h`);
                } else {
                  // Cross-month: record adjustment on nearest teacher invoice
                  const dateStr = classDoc.scheduledDate
                    ? new Date(classDoc.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '';
                  const reason = statusChanged
                    ? `Class (${classDoc.subject || 'Class'}) on ${dateStr}: status changed ${prev.status}→${classDoc.status} (${netHoursDiff > 0 ? '+' : ''}${netHoursDiff.toFixed(2)}h)`
                    : `Class (${classDoc.subject || 'Class'}) on ${dateStr}: duration ${prevDuration}→${currentDuration} min (${netHoursDiff > 0 ? '+' : ''}${netHoursDiff.toFixed(2)}h)`;
                  await InvoiceService.recordTeacherCrossMonthAdjustment({
                    teacher, classDoc, hoursDelta: netHoursDiff, reason
                  });
                  console.log(`   📆 Cross-month adjustment recorded`);
                }
              } else {
                console.log(`   ⚠️  Teacher not found or invalid role`);
              }
            } catch (err) {
              console.error(`   ❌ Teacher hours failed:`, err.message);
            }
          }

          // ── GUARDIAN HOURS (always immediate) ─────────────────────
          if (guardianId) {
            try {
              const guardian = await User.findById(guardianId);
              if (guardian && guardian.role === 'guardian') {
                const oldTotal = Number(guardian.guardianInfo?.totalHours || 0);
                console.log(`👪 Guardian: ${guardian.firstName} ${guardian.lastName}`);
                console.log(`   Current totalHours: ${oldTotal.toFixed(2)}h`);
                console.log(`   Adjustment: ${netHoursDiff > 0 ? '-' : '+'}${Math.abs(netHoursDiff).toFixed(4)}h`);

                // Update student's hoursRemaining
                const studentId = classDoc.student?.studentId?._id || classDoc.student?.studentId;
                if (studentId && Array.isArray(guardian.guardianInfo?.students)) {
                  const studentIndex = findGuardianStudentIndex(guardian, studentId);
                  if (studentIndex !== -1) {
                    const student = guardian.guardianInfo.students[studentIndex];
                    const oldSH = Number(student.hoursRemaining || 0);
                    guardian.guardianInfo.students[studentIndex].hoursRemaining = oldSH - netHoursDiff;
                    guardian.markModified('guardianInfo.students');
                    console.log(`   Student ${student.firstName}: ${oldSH.toFixed(2)}h → ${(oldSH - netHoursDiff).toFixed(2)}h`);
                  }
                }

                // Cumulative consumed (only increments, never decrements)
                if (netHoursDiff > 0) {
                  try {
                    guardian.guardianInfo.cumulativeConsumedHours = (guardian.guardianInfo.cumulativeConsumedHours || 0) + netHoursDiff;
                  } catch (_) { /* non-fatal */ }
                }

                guardian.guardianInfo.totalHours = oldTotal - netHoursDiff;
                guardian.markModified('guardianInfo');
                await guardian.save();
                console.log(`   ✅ totalHours → ${Number(guardian.guardianInfo?.totalHours || 0).toFixed(2)}h`);
              }
            } catch (err) {
              console.error(`   ❌ Guardian hours failed:`, err.message);
            }
          }
        } else {
          console.log(`📊 Net diff is 0 — no hour adjustment needed`);
        }
      } else if (statusChanged && skipHourAdjustment) {
        console.log(`\n🔒 [Hours Update] SKIPPED - Report re-submission detected`);
        console.log(`🔒 [Hours Update] Hours were already adjusted during first submission\n`);
      }

      // Now handle invoice updates
      // 🔥 NEW: If class is paid in another invoice, remove it from all unpaid invoices
      if (!invoiceId) {
        const eligibleForInvoice = Boolean(classDoc && isClassEligibleForDynamicInvoice(classDoc, new Date()));
        if (eligibleForInvoice) {
          const dominoResult = await InvoiceService.insertClassIntoPaidInvoiceChain(classDoc);
          if (dominoResult && dominoResult.success && dominoResult.handled) {
            return { success: true, reason: 'domino_shifted', dominoResult, hoursUpdated: statusChanged && !skipHourAdjustment };
          }
        }
        // Class not linked to any invoice yet - check if we should add it to an unpaid invoice
        const addResult = await InvoiceService.maybeAddClassToUnpaidInvoice(classDoc);

        // If no unpaid invoice exists or class falls outside billing period,
        // auto-create a new invoice so the class doesn't remain uninvoiced
        if (addResult && !addResult.success && (addResult.reason === 'no_unpaid_invoice' || addResult.reason === 'outside_billing_period')) {
          const guardianId = classDoc.student?.guardianId;
          if (guardianId) {
            try {
              const guardian = await User.findById(guardianId);
              if (guardian && guardian.role === 'guardian' && (guardian.guardianInfo?.totalHours ?? 0) <= 0) {
                console.log(`[onClassStateChanged] No suitable unpaid invoice for class ${classDoc._id} (${addResult.reason}), creating new invoice`);
                await InvoiceService.createInvoiceForFirstLesson(guardian, classDoc);
              }
            } catch (createErr) {
              console.warn('[onClassStateChanged] Failed to auto-create invoice for uninvoiced class:', createErr?.message);
            }
          }
        }

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
      if (inv.status === 'paid' || inv.paidAmount > 0) {
        // PAID INVOICE: Create adjustment entries instead of modifying items directly
        const wasCountableInInvoice = prev.status === 'attended' || prev.status === 'missed_by_student' || prev.status === 'absent' || item.attended === true;
        const becameCancelledNow = String(classDoc.status).startsWith('cancelled') || classDoc.status === 'no_show_both';
        const wasCancelledBefore = String(prev.status || '').startsWith('cancelled') || prev.status === 'no_show_both';
        const isCountableNow = classDoc.status === 'attended' || classDoc.status === 'missed_by_student' || classDoc.status === 'absent';

        const adjRate = Number(item.rate || inv.guardianFinancial?.hourlyRate || 10);

        // Countable → Cancelled: create credit adjustment
        if (statusChanged && wasCountableInInvoice && becameCancelledNow) {
          const dur = Number(classDoc.duration || 60);
          const hrs = dur / 60;
          const amt = Math.round(hrs * adjRate * 100) / 100;
          const dateStr = classDoc.scheduledDate ? new Date(classDoc.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
          try {
            await InvoiceService.createPaidInvoiceAdjustment({
              invoiceId: inv._id, type: 'credit', reason: 'class_cancelled', classDoc,
              description: `Cancelled class on ${dateStr} removed — not delivered`,
              hoursDelta: -hrs, amountDelta: -amt, previousDuration: dur, actorId: null
            });
          } catch (adjErr) { console.error('[onClassStateChanged] adjustment error (cancel):', adjErr.message); }
          // Sync item snapshot
          try { await Invoice.updateOne({ _id: inv._id, 'items.class': classDoc._id || classId }, { $set: { 'items.$.status': classDoc.status, 'items.$.attended': false, 'items.$.attendanceStatus': 'cancelled' } }); } catch (_e) {}
          await InvoiceService.removeClassFromUnpaidInvoices(classId, invoiceId);
          return { success: true, statusChange: 'countable_to_cancelled', adjustmentCreated: true, hoursUpdated: statusChanged && !skipHourAdjustment };
        }

        // Cancelled → Countable: create debit adjustment (class re-activated)
        if (statusChanged && wasCancelledBefore && isCountableNow) {
          const dur = Number(classDoc.duration || 60);
          const hrs = dur / 60;
          const amt = Math.round(hrs * adjRate * 100) / 100;
          const dateStr = classDoc.scheduledDate ? new Date(classDoc.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
          try {
            await InvoiceService.createPaidInvoiceAdjustment({
              invoiceId: inv._id, type: 'debit', reason: 'class_cancelled', classDoc,
              description: `Class on ${dateStr} re-activated — ${hrs.toFixed(2)}h added back`,
              hoursDelta: hrs, amountDelta: amt, previousDuration: 0, newDuration: dur, actorId: null
            });
          } catch (adjErr) { console.error('[onClassStateChanged] adjustment error (reactivate):', adjErr.message); }
          // Sync item snapshot
          try {
            const att2 = classDoc.status === 'attended' ? { attended: true, attendanceStatus: 'attended' } : { attended: false, attendanceStatus: classDoc.status === 'missed_by_student' ? 'student_absent' : null };
            await Invoice.updateOne({ _id: inv._id, 'items.class': classDoc._id || classId }, { $set: { 'items.$.status': classDoc.status, 'items.$.attended': att2.attended, 'items.$.attendanceStatus': att2.attendanceStatus } });
          } catch (_e) {}
          return { success: true, statusChange: 'cancelled_to_countable', adjustmentCreated: true, hoursUpdated: statusChanged && !skipHourAdjustment };
        }

        // Duration changed on paid invoice: create credit or debit adjustment
        if (durationChanged) {
          const oldHrs = prevDuration / 60;
          const newHrs = currentDuration / 60;
          const hrsDiff = newHrs - oldHrs;
          const amtDiff = Math.round(hrsDiff * adjRate * 100) / 100;
          const dateStr = classDoc.scheduledDate ? new Date(classDoc.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
          try {
            await InvoiceService.createPaidInvoiceAdjustment({
              invoiceId: inv._id, type: hrsDiff < 0 ? 'credit' : 'debit', reason: 'duration_changed', classDoc,
              description: `Class on ${dateStr} duration ${prevDuration}→${currentDuration} min — ${Math.abs(hrsDiff).toFixed(2)}h ${hrsDiff < 0 ? 'credit' : 'debit'}`,
              hoursDelta: hrsDiff, amountDelta: amtDiff, previousDuration: prevDuration, newDuration: currentDuration, actorId: null
            });
          } catch (adjErr) { console.error('[onClassStateChanged] adjustment error (duration):', adjErr.message); }

          // Update the invoice item snapshot so the UI reflects the current duration
          try {
            const newAmount = Math.round(((currentDuration / 60) * adjRate) * 100) / 100;
            await Invoice.updateOne(
              { _id: inv._id, 'items.class': classDoc._id || classId },
              { $set: { 'items.$.duration': currentDuration, 'items.$.amount': newAmount } }
            );
            console.log(`[onClassStateChanged] Updated paid invoice item snapshot: duration ${prevDuration}→${currentDuration}, amount→${newAmount}`);
          } catch (snapErr) {
            console.warn('[onClassStateChanged] Failed to update paid invoice item snapshot:', snapErr?.message);
          }

          return { success: true, durationChange: true, adjustmentCreated: true, hoursUpdated: !skipHourAdjustment };
        }

        // No financial adjustment needed, but sync item snapshot status
        if (statusChanged) {
          const toAtt = (s) => {
            if (s === 'attended') return { attended: true, attendanceStatus: 'attended' };
            if (String(s || '').startsWith('cancelled')) return { attended: false, attendanceStatus: 'cancelled' };
            if (s === 'missed_by_student') return { attended: false, attendanceStatus: 'student_absent' };
            return { attended: false, attendanceStatus: null };
          };
          const att = toAtt(classDoc.status);
          try {
            await Invoice.updateOne(
              { _id: inv._id, 'items.class': classDoc._id || classId },
              { $set: { 'items.$.status': classDoc.status, 'items.$.attended': att.attended, 'items.$.attendanceStatus': att.attendanceStatus } }
            );
            console.log(`[onClassStateChanged] Synced paid invoice item status: ${prev.status}→${classDoc.status}`);
          } catch (snapErr) {
            console.warn('[onClassStateChanged] Failed to sync paid invoice item status:', snapErr?.message);
          }
        }
        await InvoiceService.removeClassFromUnpaidInvoices(classId, invoiceId);
        return { success: true, reason: 'paid_invoice_no_change', hoursUpdated: statusChanged && !skipHourAdjustment };
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
      if (!['paid', 'sent', 'overdue'].includes(inv.status)) {
        const updates = { modifyItems: [ { _id: String(item._id), duration: newMinutes, ...toAttendance(classDoc.status) } ], note: 'Auto-update from class change' };
        return await InvoiceService.updateInvoiceItems(String(inv._id), updates, null);
      }

      // Paid/partially/sent/overdue: apply adjustments for other scenarios
      if (statusChanged) {
        // If moved to a non-attended state, refund this lesson's full amount/hours
        const becameCancelled = String(classDoc.status).startsWith('cancelled') || classDoc.status === 'missed_by_student' || classDoc.status === 'no_show_both';
        const wasAttended = prev.status === 'attended' || item.attended === true;
        if (becameCancelled && wasAttended && !['paid'].includes(inv.status)) {
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
      
      // Only add countable or scheduled classes
      const status = String(classDoc.status || '').toLowerCase();
      const allowedStatuses = ['scheduled', 'in_progress', 'attended', 'missed_by_student', 'absent', 'completed'];
      if (!allowedStatuses.includes(status)) {
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
          // Instead of silently rejecting, signal that a new invoice may be needed
          return { success: false, reason: 'outside_billing_period', guardianId };
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

  static async insertClassIntoPaidInvoiceChain(classDoc, opts = {}) {
    try {
      if (!classDoc || !classDoc._id) {
        return { success: false, reason: 'invalid_class' };
      }

      const guardianId = classDoc.student?.guardianId;
      if (!guardianId) {
        return { success: false, reason: 'no_guardian' };
      }

      const classDate = ensureDate(classDoc.scheduledDate || classDoc.date || classDoc.createdAt);
      if (!classDate) {
        return { success: false, reason: 'no_date' };
      }

      const Invoice = require('../models/Invoice');
      const Class = require('../models/Class');

      const invoices = await Invoice.find({
        guardian: guardianId,
        type: 'guardian_invoice',
        deleted: { $ne: true },
        status: { $nin: ['cancelled', 'refunded'] }
      }).sort({ 'billingPeriod.startDate': 1, createdAt: 1 });

      if (!invoices.length) {
        return { success: false, reason: 'no_invoices' };
      }

      const targetIndex = invoices.findIndex((inv) => {
        const start = ensureDate(inv?.billingPeriod?.startDate);
        const end = ensureDate(inv?.billingPeriod?.endDate) || ensureDate(inv?.coverage?.endDate);
        if (!start || !end) return false;
        return classDate >= start && classDate <= end;
      });

      if (targetIndex < 0) {
        return { success: false, reason: 'no_matching_period' };
      }

      const target = invoices[targetIndex];
      if (String(target?.status || '').toLowerCase() !== 'paid') {
        return { success: false, reason: 'target_not_paid', invoiceId: target?._id };
      }

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

      const getItemClassId = (item) => normalizeClassId(item?.class || item?.lessonId || item?.classId);

      const buildItemForClass = (invoiceDoc, cls, existingItem) => {
        if (!cls || !cls._id) return null;
        const minutes = Number(cls.duration || 0) || 0;
        if (minutes <= 0) return null;
        const invoiceDefaultRate = resolveInvoiceHourlyRate(invoiceDoc);
        const rate = (Number.isFinite(cls.guardianRate) && cls.guardianRate > 0) ? cls.guardianRate : invoiceDefaultRate;
        const amount = Math.round(((minutes / 60) * rate) * 100) / 100;
        return {
          lessonId: String(cls._id),
          class: cls._id,
          student: cls.student?.studentId || existingItem?.student || null,
          studentSnapshot: existingItem?.studentSnapshot || resolveStudentSnapshotFromClass(cls),
          teacher: cls.teacher || existingItem?.teacher || null,
          teacherSnapshot: existingItem?.teacherSnapshot || null,
          description: existingItem?.description || cls.subject || 'Class session',
          date: cls.scheduledDate || existingItem?.date || new Date(),
          duration: minutes,
          rate,
          amount,
          attended: cls.status === 'attended',
          status: cls.status || existingItem?.status || 'scheduled'
        };
      };

      let carryClasses = [classDoc];
      const affectedInvoices = [];

      for (let idx = targetIndex; idx < invoices.length && carryClasses.length; idx += 1) {
        const invoice = invoices[idx];
        const isPaid = String(invoice?.status || '').toLowerCase() === 'paid';

        const periodStart = ensureDate(invoice?.billingPeriod?.startDate);
        const periodEnd = ensureDate(invoice?.billingPeriod?.endDate) || ensureDate(invoice?.coverage?.endDate);
        const withinPeriod = (date) => {
          if (!date) return false;
          if (periodStart && date < periodStart) return false;
          if (periodEnd && date > periodEnd) return false;
          return true;
        };

        const coverageHoursRaw = Number(invoice?.coverage?.maxHours);
        const hasCoverageCap = Number.isFinite(coverageHoursRaw) && coverageHoursRaw > EPSILON_HOURS;
        let capMinutes = null;
        if (isPaid) {
          capMinutes = hasCoverageCap
            ? Math.round(coverageHoursRaw * 60)
            : Math.round(Math.max(0, computeInvoiceItemHours(invoice) * 60));
          if (!Number.isFinite(capMinutes) || capMinutes <= 0) capMinutes = null;
        } else if (hasCoverageCap) {
          capMinutes = Math.round(coverageHoursRaw * 60);
        }

        const existingItems = Array.isArray(invoice.items) ? invoice.items : [];
        const existingItemMap = new Map();
        const candidateIds = new Set();

        for (const item of existingItems) {
          const key = getItemClassId(item);
          if (!key) continue;
          if (!existingItemMap.has(key)) {
            existingItemMap.set(key, item);
          }
          candidateIds.add(key);
        }

        for (const cls of carryClasses) {
          const key = normalizeClassId(cls?._id);
          if (!key) continue;
          candidateIds.add(key);
        }

        const candidateObjectIds = Array.from(candidateIds)
          .map((id) => toObjectId(id))
          .filter(Boolean);

        const classDocs = candidateObjectIds.length
          ? await Class.find({ _id: { $in: candidateObjectIds } })
              .select('scheduledDate duration subject status teacher student reportSubmission classReport timezone anchoredTimezone billedInInvoiceId')
              .lean()
          : [];

        const classMap = new Map();
        for (const doc of classDocs) {
          if (doc?._id) {
            classMap.set(doc._id.toString(), doc);
          }
        }

        const candidates = [];
        const seen = new Set();
        const carryBlocked = [];

        const pushCandidate = (clsId, item, clsDoc) => {
          if (!clsId || seen.has(clsId)) return;
          const doc = clsDoc || (clsId ? classMap.get(clsId) : null);
          const minutes = Number((doc?.duration ?? item?.duration) || 0) || 0;
          const date = ensureDate(doc?.scheduledDate || item?.date || doc?.dateTime);
          if (!date || minutes <= 0) return;
          seen.add(clsId);
          candidates.push({ classId: clsId, date, duration: minutes, classDoc: doc, item });
        };

        for (const [clsId, item] of existingItemMap.entries()) {
          pushCandidate(clsId, item, null);
        }

        for (const cls of carryClasses) {
          const clsId = normalizeClassId(cls?._id);
          if (!clsId) continue;
          const allow = isClassEligibleForDynamicInvoice(cls, new Date());
          if (!allow && !existingItemMap.has(clsId)) {
            continue;
          }
          const clsDate = ensureDate(cls?.scheduledDate || cls?.dateTime || cls?.date);
          if (withinPeriod(clsDate)) {
            pushCandidate(clsId, null, cls);
          } else {
            carryBlocked.push(cls);
          }
        }

        candidates.sort((a, b) => a.date - b.date);

        const selectedIds = new Set();
        const overflow = [];
        let usedMinutes = 0;

        for (const entry of candidates) {
          if (capMinutes !== null && usedMinutes + entry.duration > capMinutes + 0.001) {
            overflow.push(entry);
            continue;
          }
          selectedIds.add(entry.classId);
          usedMinutes += entry.duration;
        }

        const removeItemIds = [];
        for (const [clsId, item] of existingItemMap.entries()) {
          if (!selectedIds.has(clsId) && item?._id) {
            removeItemIds.push(String(item._id));
          }
        }

        const addItems = [];
        for (const clsId of selectedIds) {
          if (existingItemMap.has(clsId)) continue;
          const clsDoc = classMap.get(clsId);
          const built = buildItemForClass(invoice, clsDoc, null);
          if (built) addItems.push(built);
        }

        if (addItems.length || removeItemIds.length) {
          const updateResult = await InvoiceService.updateInvoiceItems(
            String(invoice._id),
            {
              addItems,
              removeItemIds,
              note: 'Auto-shifted classes after late insert',
              allowPaidModification: isPaid,
              transferOnDuplicate: true
            },
            null
          );
          if (updateResult?.invoice) {
            const triggerId = classDoc?._id ? String(classDoc._id) : null;
            const triggerInAdded = triggerId
              ? addItems.some((item) => item?.class && String(item.class) === triggerId)
              : false;
            if (isPaid && triggerInAdded) {
              try {
                await updateResult.invoice.recordAuditEntry({
                  actor: null,
                  action: 'domino_shift',
                  diff: {
                    addedClassIds: addItems.map((item) => item?.class).filter(Boolean),
                    removedItemIds: removeItemIds,
                    triggerClassId: triggerId
                  }
                });
                await updateResult.invoice.save();
              } catch (auditErr) {
                console.warn('[insertClassIntoPaidInvoiceChain] audit failed:', auditErr?.message || auditErr);
              }
            }
            await InvoiceService.syncInvoiceCoverageClasses(updateResult.invoice);
          }
          affectedInvoices.push(String(invoice._id));
        }

        const combinedOverflow = overflow
          .map((entry) => entry.classDoc || classMap.get(entry.classId))
          .filter(Boolean)
          .concat(carryBlocked);

        carryClasses = combinedOverflow
          .map((entry) => {
            if (!entry) return null;
            if (entry._id) return entry;
            return entry.classDoc || classMap.get(entry.classId);
          })
          .filter(Boolean)
          .sort((a, b) => {
            const da = ensureDate(a?.scheduledDate || a?.dateTime) || new Date(0);
            const db = ensureDate(b?.scheduledDate || b?.dateTime) || new Date(0);
            return da - db;
          });
      }

      if (carryClasses.length) {
        const ids = carryClasses
          .map((cls) => normalizeClassId(cls?._id))
          .filter(Boolean)
          .map((id) => toObjectId(id))
          .filter(Boolean);
        if (ids.length) {
          await Class.updateMany(
            { _id: { $in: ids } },
            { $set: { billedInInvoiceId: null, billedAt: null, flaggedUninvoiced: true, paidByGuardian: false }, $unset: { paidByGuardianAt: 1 } }
          ).exec();
        }
      }

      return { success: true, handled: true, affectedInvoices };
    } catch (err) {
      console.warn('[insertClassIntoPaidInvoiceChain] failed:', err?.message || err);
      return { success: false, error: err?.message || 'domino_failed' };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  REBALANCE GUARDIAN INVOICES — the "domino-shift" engine
  //
  //  Given a guardian, fetches ALL their invoices (sorted chronologically)
  //  and ALL their classes (sorted by scheduledDate). Assigns classes to
  //  invoices in order, respecting each invoice's hour capacity (paidHours
  //  for paid invoices, coverage.maxHours for unpaid). Overflow classes
  //  shift ("domino") to the next invoice in the chain.
  //
  //  This method is called whenever something changes: class status,
  //  duration, creation, deletion, or manual refresh.
  //
  //  Returns a per-invoice map of assigned classes (for display) without
  //  modifying stored invoice items on paid invoices — those remain as
  //  historical snapshots. The returned data powers the dynamic class list.
  // ─────────────────────────────────────────────────────────────────────────
  static async rebalanceGuardianInvoices(guardianId, opts = {}) {
    const result = { invoices: [], totalClasses: 0, unassignedClasses: [] };
    try {
      const gId = toObjectId(guardianId);
      if (!gId) return result;

      const guardianDoc = await User.findById(gId).lean();
      if (!guardianDoc || guardianDoc.role !== 'guardian') return result;

      // 1. Fetch all non-deleted, non-cancelled invoices for this guardian
      const allInvoices = await Invoice.find({
        guardian: gId,
        type: 'guardian_invoice',
        deleted: { $ne: true },
        status: { $nin: ['cancelled', 'refunded'] }
      })
        .sort({ createdAt: 1 })
        .lean();

      if (!allInvoices.length) return result;

      // 2. Fetch all student IDs for this guardian
      const studentIds = await getGuardianStudentIds(guardianDoc, null);
      if (!studentIds.length) return result;

      // 3. Fetch ALL classes for this guardian's students (non-pattern, non-hidden)
      const allClasses = await Class.find({
        'student.guardianId': gId,
        'student.studentId': { $in: studentIds },
        hidden: { $ne: true },
        status: { $ne: 'pattern' }
      })
        .sort({ scheduledDate: 1, createdAt: 1 })
        .select('scheduledDate duration subject status teacher student reportSubmission classReport timezone anchoredTimezone billedInInvoiceId paidByGuardian')
        .lean();

      // 4. Classify each class and enrich with deadline info
      const now = new Date();
      const classifiedClasses = allClasses.map((cls) => {
        const allowance = ensureDate(cls?.reportSubmission?.teacherDeadline);
        const extendedUntil = ensureDate(cls?.reportSubmission?.adminExtension?.expiresAt);
        const enriched = {
          ...cls,
          reportSubmissionAllowance: allowance,
          reportSubmissionExtendedUntil: extendedUntil
        };
        return {
          cls: enriched,
          category: classifyClassStatus(enriched, now),
          classId: cls._id.toString(),
          date: ensureDate(cls.scheduledDate) || new Date(0),
          duration: Number(cls.duration || 0) || 0
        };
      });

      // 5. Filter to only eligible classes (confirmed + eligible), sorted chronologically
      //    Confirmed first (they're immovable facts), then eligible, all by date
      const eligibleClasses = classifiedClasses
        .filter((c) => c.category !== 'not_eligible' && c.duration > 0)
        .sort((a, b) => {
          // Confirmed before eligible at same date; otherwise chronological
          if (a.date.getTime() === b.date.getTime()) {
            const aConf = a.category === 'confirmed' ? 0 : 1;
            const bConf = b.category === 'confirmed' ? 0 : 1;
            return aConf - bConf;
          }
          return a.date - b.date;
        });

      result.totalClasses = eligibleClasses.length;

      // 6. Build teacher map for snapshots
      const teacherIdSet = new Set();
      for (const item of eligibleClasses) {
        const tid = toObjectId(item.cls.teacher);
        if (tid) teacherIdSet.add(tid.toString());
      }
      let teacherMap = {};
      if (teacherIdSet.size) {
        const teachers = await User.find({
          _id: { $in: Array.from(teacherIdSet).map(id => new mongoose.Types.ObjectId(id)) }
        }).select('firstName lastName').lean();
        teacherMap = teachers.reduce((acc, doc) => {
          if (doc?._id) acc[doc._id.toString()] = doc;
          return acc;
        }, {});
      }

      // 7. Walk through invoices in order, assigning classes
      const assignedClassIds = new Set(); // track globally assigned classes
      const remainderMap = new Map(); // track partial class remainders across invoices

      for (const invoice of allInvoices) {
        const isPaid = String(invoice.status).toLowerCase() === 'paid';

        // Determine capacity for this invoice
        let capacityMinutes = null;
        if (isPaid) {
          // Paid invoice capacity = paid hours (from payment logs or coverage cap)
          const hourlyRate = resolveInvoiceHourlyRate(invoice);
          const paidHours = calculatePaidHoursFromLogs(invoice, hourlyRate);
          const coverageMax = Number(invoice.coverage?.maxHours);
          if (Number.isFinite(coverageMax) && coverageMax > EPSILON_HOURS) {
            capacityMinutes = Math.round(coverageMax * 60);
          } else if (paidHours > EPSILON_HOURS) {
            capacityMinutes = Math.round(paidHours * 60);
          } else {
            // Fallback: use stored item hours
            capacityMinutes = Math.round(computeInvoiceItemHours(invoice) * 60);
          }
        } else {
          // Unpaid: use coverage cap if set, otherwise no cap
          const coverageMax = Number(invoice.coverage?.maxHours);
          if (Number.isFinite(coverageMax) && coverageMax > EPSILON_HOURS) {
            capacityMinutes = Math.round(coverageMax * 60);
          }
          // null = no cap (all eligible classes in the billing window)
        }

        // Fill this invoice with the next unassigned classes (pure chronological order)
        const invoiceClasses = [];
        let usedMinutes = 0;

        for (const entry of eligibleClasses) {
          if (assignedClassIds.has(entry.classId)) continue; // already assigned to earlier invoice

          // Check if this is a remainder from a previously split class
          const remainderKey = entry.classId;
          const remainder = remainderMap.get(remainderKey);
          const effectiveDuration = remainder ? remainder.remaining : entry.duration;
          if (effectiveDuration <= 0) continue;

          // Check capacity
          if (capacityMinutes !== null && usedMinutes >= capacityMinutes - 0.5) {
            // Invoice is full — stop assigning
            break;
          }

          let assignedDuration = effectiveDuration;
          let isPartial = !!remainder; // remainder from a prior split is always partial
          let partialOf = entry.duration; // original full duration

          if (capacityMinutes !== null && usedMinutes + effectiveDuration > capacityMinutes + 0.5) {
            // Class doesn't fully fit — split it: assign what fits, carry remainder
            assignedDuration = Math.round(capacityMinutes - usedMinutes);
            if (assignedDuration <= 0) break;
            isPartial = true;
            // Store remainder for the next invoice(s) to pick up
            remainderMap.set(remainderKey, {
              remaining: effectiveDuration - assignedDuration,
              originalDuration: entry.duration
            });
          } else {
            // Fully assigned — clear any remainder and mark as fully consumed
            remainderMap.delete(remainderKey);
            assignedClassIds.add(entry.classId);
          }

          usedMinutes += assignedDuration;

          const cls = entry.cls;
          const teacherDoc = teacherMap[cls.teacher?.toString?.()] || null;
          const invoiceDefaultRate = resolveInvoiceHourlyRate(invoice);
          const hourlyRate = (Number.isFinite(cls.guardianRate) && cls.guardianRate > 0) ? cls.guardianRate : invoiceDefaultRate;
          const amount = Math.round(((assignedDuration / 60) * hourlyRate) * 100) / 100;

          invoiceClasses.push({
            dynamicSource: 'rebalanced',
            lessonId: entry.classId,
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
              reportSubmissionAllowance: cls.reportSubmissionAllowance,
              reportSubmissionExtendedUntil: cls.reportSubmissionExtendedUntil
            },
            student: cls.student?.studentId || null,
            studentSnapshot: resolveStudentSnapshotFromClass(cls),
            teacher: teacherDoc
              ? { _id: teacherDoc._id, firstName: teacherDoc.firstName, lastName: teacherDoc.lastName }
              : (cls.teacher || null),
            teacherSnapshot: teacherDoc
              ? { firstName: teacherDoc.firstName || '', lastName: teacherDoc.lastName || '' }
              : null,
            description: cls.subject || 'Class session',
            date: cls.scheduledDate,
            duration: assignedDuration,
            fullDuration: entry.duration,
            rate: hourlyRate,
            amount,
            attended: cls.status === 'attended',
            status: cls.status || 'scheduled',
            category: entry.category,    // 'confirmed' or 'eligible'
            reportSubmission: cls.reportSubmission || {},
            reportSubmissionAllowance: cls.reportSubmissionAllowance,
            reportSubmissionExtendedUntil: cls.reportSubmissionExtendedUntil,
            paidByGuardian: Boolean(cls.paidByGuardian),
            isPinned: false,
            isPartial,
            partialMinutes: assignedDuration,
            partialOfMinutes: isPartial ? partialOf : null
          });
        }

        result.invoices.push({
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceSlug: invoice.invoiceSlug,
          invoiceName: invoice.invoiceName,
          status: invoice.status,
          billingPeriod: invoice.billingPeriod,
          capacityMinutes,
          usedMinutes,
          items: invoiceClasses,
          totalMinutes: usedMinutes,
          totalHours: usedMinutes / 60,
          isPaid
        });
      }

      // 8. Collect unassigned eligible classes (overflow beyond all invoices)
      result.unassignedClasses = eligibleClasses
        .filter((c) => !assignedClassIds.has(c.classId) && !remainderMap.has(c.classId))
        .map((c) => ({
          classId: c.classId,
          date: c.date,
          duration: c.duration,
          category: c.category,
          status: c.cls.status,
          subject: c.cls.subject,
          studentName: c.cls.student?.studentName || ''
        }));

      return result;
    } catch (err) {
      console.error('[rebalanceGuardianInvoices] error:', err?.message || err);
      return result;
    }
  }

  /**
   * Get the rebalanced dynamic class list for a SINGLE invoice.
   * This calls rebalanceGuardianInvoices, then returns just the data for
   * the requested invoice. This replaces the old buildDynamicClassList
   * for chain-aware display.
   */
  static async buildDynamicClassListRebalanced(invoiceDoc) {
    const fallback = { items: [], totalMinutes: 0, totalHours: 0, capMinutes: null, coverageHours: null, rebalanced: true };
    try {
      if (!invoiceDoc || invoiceDoc.type !== 'guardian_invoice') return fallback;

      const guardianId = invoiceDoc.guardian?._id || invoiceDoc.guardian;
      if (!guardianId) return fallback;

      const chainResult = await InvoiceService.rebalanceGuardianInvoices(guardianId);
      const invoiceIdStr = String(invoiceDoc._id);
      const entry = chainResult.invoices.find((inv) => String(inv.invoiceId) === invoiceIdStr);

      if (!entry) {
        // Invoice not found in chain (cancelled, manual, etc.) — fallback to legacy
        return await InvoiceService.buildDynamicClassList(invoiceDoc);
      }
      // Note: entry.items may be empty if all classes were assigned to earlier invoices.
      // Do NOT fallback to legacy here — that would duplicate classes across invoices.

      const coverageMax = Number(invoiceDoc.coverage?.maxHours);
      const hasCoverageCap = Number.isFinite(coverageMax) && coverageMax > EPSILON_HOURS;

      // Build chain context: which invoices came before, position in chain
      const entryIndex = chainResult.invoices.indexOf(entry);
      const priorInvoices = chainResult.invoices.slice(0, entryIndex).map((inv) => ({
        invoiceId: inv.invoiceId,
        invoiceName: inv.invoiceName || inv.invoiceNumber || 'Invoice',
        status: inv.status,
        capacityMinutes: inv.capacityMinutes,
        usedMinutes: inv.usedMinutes,
        totalHours: inv.totalHours,
        isPaid: inv.isPaid,
        classCount: inv.items.length,
        firstDate: inv.items.length ? inv.items[0].date : null,
        lastDate: inv.items.length ? inv.items[inv.items.length - 1].date : null
      }));

      return {
        items: entry.items,
        totalMinutes: entry.totalMinutes,
        totalHours: entry.totalHours,
        capMinutes: hasCoverageCap ? Math.round(coverageMax * 60) : null,
        coverageHours: hasCoverageCap ? coverageMax : null,
        rebalanced: true,
        chainPosition: entryIndex + 1,
        chainTotal: chainResult.invoices.length,
        priorInvoices,
        unassignedClasses: chainResult.unassignedClasses
      };
    } catch (err) {
      console.error('[buildDynamicClassListRebalanced] error:', err?.message || err);
      // Fallback to legacy
      return await InvoiceService.buildDynamicClassList(invoiceDoc);
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
      const hasCoverageCap = Number.isFinite(coverageHoursRaw) && coverageHoursRaw > EPSILON_HOURS;
      const coverageHours = hasCoverageCap
        ? coverageHoursRaw
        : Math.max(0, invoiceItemHours);
      const isUnpaid = ACTIVE_UNPAID_INVOICE_STATUSES.includes(String(invoiceDoc?.status || '').toLowerCase());
      const capMinutes = hasCoverageCap ? Math.round(coverageHours * 60) : null;

      const billingStart = ensureDate(invoiceDoc?.billingPeriod?.startDate)
        || ensureDate(invoiceDoc?.createdAt)
        || new Date();
      const billingEnd = ensureDate(invoiceDoc?.billingPeriod?.endDate);
      const hasCoverageHoursCap = hasCoverageCap;
      // Derive the billing window from the invoice's actual period or calendar month
      const invoiceBillingDays = deriveBillingWindowDays(invoiceDoc);
      let coverageEnd = ensureDate(invoiceDoc?.coverage?.endDate) || null;
      if (coverageEnd) {
        coverageEnd.setHours(23, 59, 59, 999);
      } else if (!hasCoverageHoursCap) {
        coverageEnd = billingEnd || null;
        if (coverageEnd) {
          coverageEnd.setHours(23, 59, 59, 999);
        } else if (billingStart) {
          coverageEnd = getFixedWindowEndInclusive(billingStart, invoiceBillingDays);
        }
      }
      if (isUnpaid && billingStart && !hasCoverageHoursCap) {
        const fixedEnd = getFixedWindowEndInclusive(billingStart, invoiceBillingDays);
        if (!coverageEnd || (fixedEnd && coverageEnd > fixedEnd)) {
          coverageEnd = fixedEnd;
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
      const guardianDefaultRate = resolveInvoiceHourlyRate(invoiceDoc);
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

        // Never include cancelled classes regardless of pinning status.
        const normalizedStatus = normalizeStatusValue(cls?.status);
        if (CANCELLED_CLASS_STATUSES.has(normalizedStatus)) continue;

        // Pinned classes (already linked to this invoice) stay visible unless they
        // are past-scheduled with an expired/missing report window.  This ensures
        // stale "scheduled" classes whose report deadline has long passed are removed
        // from the invoice view while reported/attended classes always remain.
        const wasAlreadyLinked = pinnedClassIds.has(classId);
        let rescuedByPin = false;
        if (!isClassEligibleForDynamicInvoice(enrichedClass, now)) {
          if (!wasAlreadyLinked) continue;
          // Previously linked but ineligible — only keep if report was already submitted
          // or the class reached a final status (attended, completed, etc.)
          const hasFinalOutcome = ALWAYS_INCLUDED_CLASS_STATUSES.has(normalizedStatus);
          const hasReport = Boolean(cls?.classReport?.submittedAt);
          if (!hasFinalOutcome && !hasReport) continue;
          rescuedByPin = true;
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

        const hourlyRate = (Number.isFinite(cls.guardianRate) && cls.guardianRate > 0) ? cls.guardianRate : guardianDefaultRate;
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
          paidByGuardian: Boolean(existingItem?.paidByGuardian),
          isPinned: rescuedByPin
        });

        usedMinutes += minutes;
        if (capMinutes !== null && usedMinutes >= capMinutes - 0.001) {
          break;
        }
      }

      if (!dynamicItems.length && existingItems.length) {
        const cleanedItems = existingItems
          .map((item) => (item.toObject ? item.toObject() : item))
          .filter((item) => {
            const st = normalizeStatusValue(item?.status || item?.class?.status);
            return !CANCELLED_CLASS_STATUSES.has(st);
          });
        return {
          items: cleanedItems,
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
      console.error('[buildDynamicClassList] error:', err?.message || err);
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

      // Re-price existing items whose rate has changed (e.g. cls.guardianRate set after invoice creation)
      const rateUpdateItemIds = [];
      const rateUpdateItems = [];
      desiredByClass.forEach((desired, key) => {
        const current = currentByClass.get(key);
        if (!current) return; // will be added below
        const desiredRate = Number(desired.rate || 0);
        const currentRate = Number(current.rate || 0);
        if (desiredRate > 0 && Math.abs(desiredRate - currentRate) > 0.001) {
          // Remove old, re-add with corrected rate
          if (current._id) rateUpdateItemIds.push(String(current._id));
          const cls = desired.class || {};
          const classId = normalizeClassId(cls?._id || desired.class || desired.lessonId || key);
          const classObjectId = toObjectId(classId) || classId;
          const minutes = Number(desired.duration || cls?.duration || 0) || 0;
          const amount = Math.round(((minutes / 60) * desiredRate) * 100) / 100;
          rateUpdateItems.push({
            lessonId: String(classId || ''),
            class: classObjectId,
            student: desired.student || cls?.student?.studentId || current.student || null,
            studentSnapshot: desired.studentSnapshot || current.studentSnapshot || resolveStudentSnapshotFromClass(cls),
            teacher: desired.teacher?._id || desired.teacher || current.teacher || null,
            teacherSnapshot: desired.teacherSnapshot || current.teacherSnapshot || null,
            description: desired.description || current.description || cls?.subject || 'Class session',
            date: desired.date || current.date || cls?.scheduledDate || null,
            duration: minutes,
            rate: desiredRate,
            amount,
            attended: Boolean(desired.attended || current.attended),
            status: desired.status || current.status || 'scheduled'
          });
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

      const allRemoveIds = [...removeItemIds, ...rateUpdateItemIds];
      const allAddItems = [...addItems, ...rateUpdateItems];

      if (!allAddItems.length && !allRemoveIds.length) {
        if (!cleanupDuplicates) {
          return { success: true, noChanges: true, invoice };
        }
      }

      const updateResult = (!allAddItems.length && !allRemoveIds.length)
        ? { success: true, noChanges: true, invoice }
        : await InvoiceService.updateInvoiceItems(
            String(invoice._id),
        { addItems: allAddItems, removeItemIds: allRemoveIds, note, transferOnDuplicate },
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
            status: { $in: ['draft', 'pending', 'sent', 'overdue'] }
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

      const disallowedStatuses = [...NOT_ELIGIBLE_STATUSES];

      let additionalClasses = await Class.find({
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
        .select('scheduledDate duration subject status teacher student reportSubmission guardianRate')
        .lean();

      // Post-filter: catch expired admin extensions / submission windows
      const nowExtend = new Date();
      additionalClasses = additionalClasses.filter(cls => {
        const enriched = {
          ...cls,
          reportSubmissionAllowance: ensureDate(cls?.reportSubmission?.teacherDeadline),
          reportSubmissionExtendedUntil: ensureDate(cls?.reportSubmission?.adminExtension?.expiresAt)
        };
        return isClassEligibleForDynamicInvoice(enriched, nowExtend);
      });

      if (!additionalClasses.length) {
        return { added: 0 };
      }

      const resolvedDefaultRate = (() => {
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
        const resolvedRate = (Number.isFinite(cls.guardianRate) && cls.guardianRate > 0) ? cls.guardianRate : resolvedDefaultRate;
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

      const status = String(invoiceDoc?.status || '').toLowerCase();
      const shouldMarkPaid = status === 'paid';

      if (shouldMarkPaid) {
        const invoiceId = invoiceDoc?._id || null;
        const linkFilter = invoiceId
          ? { $or: [{ billedInInvoiceId: invoiceId }, { billedInInvoiceId: null }, { billedInInvoiceId: { $exists: false } }] }
          : {};
        await Class.updateMany(
          { _id: { $in: allClassIds }, ...linkFilter },
          {
            $set: {
              paidByGuardian: true,
              paidByGuardianAt: new Date(),
              ...(invoiceId ? { billedInInvoiceId: invoiceId, billedAt: new Date() } : {})
            }
          }
        ).exec();
      } else {
        const baseUpdate = { $set: { paidByGuardian: false }, $unset: { paidByGuardianAt: 1 } };
        if (status === 'refunded') {
          baseUpdate.$unset = { ...baseUpdate.$unset, billedInInvoiceId: 1, billedAt: 1 };
        }
        await Class.updateMany(
          { _id: { $in: allClassIds } },
          baseUpdate
        ).exec();
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
      if (!['paid'].includes(invoice.status)) {
        console.log(`💰 [Invoice Recalculation] Invoice ${invoice.invoiceNumber} is ${invoice.status}, skipping (no money involved yet)`);
        return { success: true, skipped: true, reason: 'invoice_not_paid' };
      }

      console.log(`💰 [Invoice Recalculation] Coverage caps disabled; skipping recalculation for ${invoice.invoiceNumber}`);
      return { success: true, skipped: true, reason: 'coverage_caps_disabled' };

      // Get current items sorted chronologically
      const currentItems = Array.isArray(invoice.items) ? invoice.items.filter(it => it && it.class) : [];
      const sortedItems = currentItems.slice().sort((a, b) => {
        const da = new Date(a?.date || 0).getTime();
        const db = new Date(b?.date || 0).getTime();
        return da - db;
      });

      // Calculate which classes should be marked as paid based on coverage hours
      let remaining = 0;
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

      // 1. Remove from all UNPAID invoices (domino: next eligible class takes its place)
      const unpaidInvoices = await Invoice.find({
        $or: [
          { 'items.class': classId },
          { 'items.lessonId': String(classId) }
        ],
        status: { $in: ['draft', 'pending', 'sent', 'overdue'] },
        deleted: { $ne: true }
      });

      for (const invoice of unpaidInvoices) {
        const itemsToRemove = (invoice.items || [])
          .filter(item => String(item.class || item.lessonId) === String(classId))
          .map(item => String(item._id));
        if (itemsToRemove.length) {
          await InvoiceService.updateInvoiceItems(
            String(invoice._id),
            { removeItemIds: itemsToRemove, note: `Class ${classId} deleted — removed from invoice` },
            adminUserId
          );
          console.log(`🗑️ [Class Deletion Handler] Removed class ${classId} from unpaid invoice ${invoice.invoiceNumber}`);
        }
      }

      // 2. For PAID invoices: record note (items stay as historical record).
      //    The rebalanced dynamic class list will automatically exclude deleted
      //    classes and shift the next eligible class into the display.
      const paidInvoices = await Invoice.find({
        $or: [
          { 'items.class': classId },
          { 'items.lessonId': String(classId) }
        ],
        status: { $in: ['paid'] },
        deleted: { $ne: true }
      });

      const results = [];
      for (const invoice of paidInvoices) {
        try {
          if (!Array.isArray(invoice.changeHistory)) invoice.changeHistory = [];
          invoice.changeHistory.push({
            changedAt: new Date(),
            changedBy: adminUserId || null,
            action: 'info',
            changes: `Class ${classId} was deleted. Dynamic class list will shift next eligible class into this slot.`,
            note: 'Class deletion — domino shift via dynamic rebalance'
          });
          invoice.markModified('changeHistory');
          invoice._skipRecalculate = true;
          await invoice.save();
        } catch (noteErr) {
          console.warn(`🗑️ [Class Deletion Handler] Failed to record note on invoice ${invoice._id}:`, noteErr.message);
        }

        results.push({
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          action: 'noted_for_dynamic_rebalance'
        });
      }

      return {
        success: true,
        invoicesProcessed: unpaidInvoices.length + paidInvoices.length,
        unpaidRemoved: unpaidInvoices.length,
        paidNoted: paidInvoices.length,
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
      const activeInvoiceStatuses = ['draft', 'pending', 'sent', 'overdue'];

      // load guardian
      const guardian = typeof guardianOrId === 'object' && guardianOrId.guardianInfo
        ? guardianOrId
        : await User.findById(guardianOrId);
      if (!guardian || guardian.role !== 'guardian') return { created: false };

      const guardianTotalHours = Number(guardian.guardianInfo?.totalHours ?? 0);
      if (!Number.isFinite(guardianTotalHours)) {
        return { created: false, reason: 'invalid_total' };
      }

      // Only create follow-up invoice when guardian hours are zero or negative
      if (guardianTotalHours > 0) {
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

      // Match the billing period duration of the previous invoice,
      // or use the calendar month length of the new billing start
      const billingWindowDays = deriveBillingWindowDays(prevInvoice) || getDaysInMonth(prevEnd);

      const created = await this.createZeroHourInvoice(guardian, zeroHourTargets, {
        reason: 'threshold_followup',
        triggeredBy: 'auto-payg',
        billingPeriodStart: prevEnd,
        billingWindowDays,
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
          // Ensure billing period end is never before start (can happen when items
          // were added outside the original coverage window).
          const finalEndDate = (endDate < minDate) ? maxDateBase : endDate;
          if (!invoice.billingPeriod || typeof invoice.billingPeriod !== 'object') {
            invoice.billingPeriod = {};
          }
          invoice.billingPeriod.startDate = minDate;
          invoice.billingPeriod.endDate = finalEndDate;
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
        const txCode = transactionErr?.code;
        const txName = transactionErr?.codeName;
        const txMsg = transactionErr?.message || '';
        if (txCode === 20 || txName === 'IllegalOperation'
            || txMsg.includes('Transaction numbers')
            || txMsg.includes('replica set')
            || txCode === 263 || txName === 'OperationNotSupportedInTransaction') {
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
      if (invoice.status !== 'paid' && invoice.status !== 'sent' && invoice.status !== 'overdue') {
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

      const isInvoiceSettled = (candidate) => {
        if (!candidate) return false;
        const status = String(candidate.status || '').toLowerCase();
        if (status === 'paid' || status === 'refunded') return true;

        const total = Number(candidate.adjustedTotal ?? candidate.total ?? 0);
        const paid = Number(candidate.paidAmount || 0);
        const remainingAmount = typeof candidate.getDueAmount === 'function'
          ? Number(candidate.getDueAmount() || 0)
          : Math.max(0, total - paid);

        if (Number.isFinite(remainingAmount) && remainingAmount <= 0) return true;
        if (Number.isFinite(total) && total > 0 && Number.isFinite(paid) && paid >= (total - 0.01)) return true;
        return false;
      };

      // If invoice is already paid / settled, return idempotent success and do not apply another payment
      try {
        if (isInvoiceSettled(invoice)) {
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
              const existing = await Payment.findOne(query).exec();
              if (existing) {
                let freshInv = null;
                try {
                  freshInv = await Invoice.findById(invoiceId).populate('guardian').exec();
                } catch (freshErr) {
                  freshInv = null;
                }
                const invoiceSnapshot = freshInv || invoice;

                // If already applied, return existing invoice snapshot
                if (existing.status === 'applied' && isInvoiceSettled(invoiceSnapshot)) {
                  return { success: true, invoice: invoiceSnapshot, duplicate: true, message: 'Duplicate payment (already applied)' };
                }

                if (isInvoiceSettled(invoiceSnapshot)) {
                  return { success: true, invoice: invoiceSnapshot, duplicate: true, message: 'Invoice already settled' };
                }

                console.warn('[InvoiceService] Existing payment record found for unpaid invoice; retrying payment apply', {
                  invoiceId,
                  paymentId: existing._id,
                  paymentStatus: existing.status
                });

                createdPayment = await Payment.findByIdAndUpdate(
                  existing._id,
                  {
                    $set: {
                      amount: Number(paymentData.amount || 0),
                      paymentMethod: paymentData.paymentMethod || paymentData.method || 'manual',
                      transactionId: tx,
                      adminUser: adminUserId || undefined,
                      paidHours: typeof paidHoursVal === 'number' ? paidHoursVal : undefined,
                      tip: typeof tipVal === 'number' ? tipVal : undefined,
                      paidAt: paidAtVal || undefined,
                      status: 'pending'
                    },
                    $unset: { error: 1 }
                  },
                  { new: true }
                ).exec();
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
            const freshInvoice = await Invoice.findById(invoiceId).populate('guardian').exec().catch(() => null);
            if (isInvoiceSettled(freshInvoice || invoice)) {
              console.log('🔔 [InvoiceService] Duplicate payment detected — ignoring re-apply', { invoiceId, incomingAmount, incomingMethod, incomingTx });
              return { success: true, invoice: freshInvoice || invoice, duplicate: true, message: 'Duplicate payment ignored' };
            }
            console.warn('[InvoiceService] Duplicate-like payment log found on unpaid invoice; continuing with recovery apply', { invoiceId, incomingAmount, incomingMethod, incomingTx });
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

      // If paidHours is provided, treat it as the authoritative cap for this invoice.
      const paidHoursCap = Number.isFinite(Number(paymentData.paidHours)) && Number(paymentData.paidHours) > 0
        ? roundHours(Number(paymentData.paidHours))
        : null;

      // 2) Allow any payment amount - removed class boundary restriction
      // Admin can enter actual hours paid by guardian, which may not align to class boundaries

      // Sync invoice items from the rebalance engine so partial classes (domino splits)
      // are materialised before the cap/validation logic runs. The rebalance engine is the
      // source of truth for which classes belong to this invoice (including partial allocations
      // from the boundary of the billing period).
      if (invoice.type === 'guardian_invoice' && invoice.guardian) {
        try {
          const rebalanceResult = await InvoiceService.buildDynamicClassListRebalanced(invoice);
          if (rebalanceResult && rebalanceResult.rebalanced && Array.isArray(rebalanceResult.items) && rebalanceResult.items.length) {
            // Convert rebalanced items to the format stored on invoice.items
            const syncedItems = rebalanceResult.items.map((ri) => {
              const classId = ri.lessonId || (ri.class && (ri.class._id || ri.class));
              return {
                lessonId: classId ? String(classId) : null,
                class: classId || null,
                student: ri.student || null,
                studentSnapshot: ri.studentSnapshot || null,
                teacher: ri.teacher || null,
                teacherSnapshot: ri.teacherSnapshot || null,
                description: ri.description || '',
                date: ri.date || null,
                duration: Number(ri.duration || 0) || 0,
                fullDuration: ri.fullDuration || ri.duration || 0,
                rate: Number(ri.rate || 0) || 0,
                amount: Number(ri.amount || 0) || 0,
                attended: Boolean(ri.attended),
                status: ri.status || 'scheduled',
                category: ri.category || null,
                isPartial: Boolean(ri.isPartial),
                partialMinutes: ri.partialMinutes || null,
                partialOfMinutes: ri.partialOfMinutes || null,
                paidByGuardian: Boolean(ri.paidByGuardian),
                excludeFromStudentBalance: Boolean(ri.excludeFromStudentBalance),
                exemptFromGuardian: Boolean(ri.exemptFromGuardian),
                flags: ri.flags || {}
              };
            });
            invoice.items = syncedItems;
            invoice.markModified('items');
          }
        } catch (rebalErr) {
          console.warn('[processInvoicePayment] rebalance sync failed, continuing with stored items', rebalErr?.message);
        }
      }

      const itemsAsc = Array.isArray(invoice.items) ? [...invoice.items].sort((a, b) => {
        const da = new Date(a?.date || 0).getTime();
        const db = new Date(b?.date || 0).getTime();
        return da - db;
      }) : [];

  const hasClassLinkedItems = itemsAsc.some((it) => Boolean(it?.class) || Boolean(it?.lessonId));
  let eligibleCoverageIncrementHours = 0;
      if (hasClassLinkedItems) {
        if (paidHoursCap) {
          let capMinutes = Math.round(paidHoursCap * 60);
          let running = 0;
          const cappedItems = [];
          const removedItems = [];
          let hadSplit = false;

          for (const item of itemsAsc) {
            const minutes = Number(item?.duration || 0) || 0;
            if (running + minutes > capMinutes) {
              const remaining = capMinutes - running;
              if (remaining > 0) {
                // Split: take only the portion that fits (domino-style partial coverage)
                item.fullDuration = item.fullDuration || minutes;
                item.isPartial = true;
                item.partialMinutes = remaining;
                item.partialOfMinutes = minutes;
                item.duration = remaining;
                item.amount = Math.round(((remaining / 60) * (Number(item?.rate || 0) || hourlyRate)) * 100) / 100;
                cappedItems.push(item);
                running += remaining;
                hadSplit = true;
              } else {
                // No room at all — fully remove this item
                removedItems.push(item);
              }
              continue;
            }
            cappedItems.push(item);
            running += minutes;
          }

          invoice.coverage = invoice.coverage && typeof invoice.coverage === 'object'
            ? invoice.coverage
            : {};
          invoice.coverage.strategy = 'cap_hours';
          invoice.coverage.maxHours = paidHoursCap;
          const lastKept = cappedItems.length ? cappedItems[cappedItems.length - 1] : null;
          const lastDate = lastKept?.date ? new Date(lastKept.date) : null;
          if (lastDate && !Number.isNaN(lastDate.getTime())) {
            invoice.coverage.endDate = lastDate;
          }
          invoice.coverage.updatedAt = new Date();
          invoice.coverage.updatedBy = adminUserId || invoice.coverage.updatedBy;
          invoice.markModified('coverage');

          if (cappedItems.length !== itemsAsc.length || hadSplit) {
            invoice.items = cappedItems;
            invoice.markModified('items');

            const removedClassIds = removedItems
              .map((it) => it?.class || it?.lessonId)
              .filter(Boolean);
            if (removedClassIds.length) {
              try {
                const Class = require('../models/Class');
                await Class.updateMany(
                  { _id: { $in: removedClassIds } },
                  { $set: { billedInInvoiceId: null, billedAt: null, flaggedUninvoiced: true, paidByGuardian: false }, $unset: { paidByGuardianAt: 1 } }
                ).exec();
              } catch (unlinkErr) {
                console.warn('Failed to unlink classes after paid-hours cap', unlinkErr && unlinkErr.message);
              }
            }
          }

          // Refresh itemsAsc so downstream calculations use the capped set.
          itemsAsc.length = 0;
          for (const item of (invoice.items || [])) {
            itemsAsc.push(item);
          }
          itemsAsc.sort((a, b) => {
            const da = new Date(a?.date || 0).getTime();
            const db = new Date(b?.date || 0).getTime();
            return da - db;
          });
        }

        const hourList = itemsAsc.map((it) => (Number(it?.duration || 0) || 0) / 60);
        const totalSchedHours = hourList.reduce((sum, h) => sum + h, 0);
        if (paidHoursCap && totalSchedHours > EPSILON_HOURS && paidHoursCap > (totalSchedHours + EPSILON_HOURS)) {
          return {
            success: false,
            error: 'validation_error',
            message: `Paid hours (${paidHoursCap}) exceed available class hours (${roundHours(totalSchedHours)}).`
          };
        }
        const eligibleItems = itemsAsc.filter((it) => it && !it.excludeFromStudentBalance && !it.exemptFromGuardian && !(it.flags && (it.flags.notCountForBoth || it.flags.exemptFromGuardian)));
        const eligibleHoursTotal = eligibleItems.reduce((sum, item) => sum + ((Number(item?.duration || 0) || 0) / 60), 0);

        let currentCovered = 0;
        try {
          currentCovered = calculatePaidHoursFromLogs(invoice, hourlyRate);
        } catch (_) {
          currentCovered = 0;
        }
        currentCovered = Math.round(currentCovered * 1000) / 1000;

        const incrementHours = Number(paymentData.paidHours || paidHours || 0) || 0;
        if (incrementHours <= 0) {
          return { success: false, error: 'validation_error', message: 'Paid hours must be greater than zero' };
        }

            const targetTotalHours = Math.round((currentCovered + incrementHours) * 1000) / 1000;
            const coverageIncrement = Math.max(0, roundHours(incrementHours));
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
            const invoiceId = invoice?._id || null;
            const classIdsToMark = itemsAsc
              .map((it) => it.class)
              .filter(Boolean);
            if (classIdsToMark.length) {
              await Class.updateMany(
                {
                  _id: { $in: classIdsToMark },
                  ...(invoiceId
                    ? { $or: [{ billedInInvoiceId: invoiceId }, { billedInInvoiceId: null }, { billedInInvoiceId: { $exists: false } }] }
                    : {})
                },
                {
                  $set: {
                    paidByGuardian: true,
                    paidByGuardianAt: new Date(),
                    ...(invoiceId ? { billedInInvoiceId: invoiceId, billedAt: new Date() } : {})
                  }
                }
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
        paidAt: paymentData.paidAt,
        teacherBonusAllocations: Array.isArray(paymentData.teacherBonusAllocations)
          ? paymentData.teacherBonusAllocations
          : undefined
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
            const freshInvoice = await Invoice.findById(invoiceId).populate('guardian').exec().catch(() => null);
            if (isInvoiceSettled(freshInvoice || invoice)) {
              console.log('🔔 [InvoiceService] Duplicate payment detected on fresh DB re-check — ignoring', { invoiceId, incomingAmount, incomingMethod, incomingTx });
              return { success: true, invoice: freshInvoice || invoice, duplicate: true, message: 'Duplicate payment ignored (concurrent)' };
            }
            console.warn('[InvoiceService] Duplicate-like payment log found during fresh DB check on unpaid invoice; continuing with recovery apply', { invoiceId, incomingAmount, incomingMethod, incomingTx });
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

        // Sync transactionId → invoiceReferenceLink so a single "Reference" field is shown
        try {
          const tx = String(paymentData.transactionId || '').trim();
          if (tx && !updatedInvoice.invoiceReferenceLink) {
            updatedInvoice.invoiceReferenceLink = tx;
            await Invoice.updateOne({ _id: updatedInvoice._id }, { $set: { invoiceReferenceLink: tx } });
          }
        } catch (_syncErr) { /* best-effort */ }

        // Enforce strict DB rule: once settled, coverage cap metadata should not persist.
        // Keep coverage caps as-is after payment so invoices reflect paid-hours decisions.
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

      try {
        const tipDistributionTeacherIds = Array.from(
          new Set(
            (updatedInvoice?.paymentLogs || [])
              .filter((log) => log?.method === 'tip_distribution')
              .map((log) => String(log?.teacher || ''))
              .filter(Boolean)
          )
        );

        for (const teacherId of tipDistributionTeacherIds) {
          await TeacherSalaryService.applyPendingGuardianPayoutsToInvoice(
            teacherId,
            null,
            null,
            adminUserId
          );
        }
      } catch (bonusApplyErr) {
        console.warn('Failed to apply pending guardian payouts to nearest teacher invoice', bonusApplyErr?.message || bonusApplyErr);
      }
  
  // Credit hours to guardian and keep student subdoc balances consistent when possible
  try {
    const paidHrs = Number(paymentData.paidHours || paidHours || 0);
    if (paidHrs > 0) {
      const guardianIdForCredit = (updatedInvoice.guardian && updatedInvoice.guardian._id) || updatedInvoice.guardian;
      if (guardianIdForCredit) {
        const guardian = await User.findById(guardianIdForCredit);
        if (guardian) {
          guardian.guardianInfo = guardian.guardianInfo || {};
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
            const studentsArray = Array.isArray(guardian.guardianInfo.students)
              ? guardian.guardianInfo.students
              : [];

            const resolveStudentKey = (value) => {
              if (!value) return null;
              if (typeof value === 'object' && value._id) return String(value._id);
              return String(value);
            };

            let distributedHours = 0;
            if (studentsArray.length && itemsAsc.length) {
              const creditableItems = itemsAsc.filter((item) => (
                item
                && !item.excludeFromStudentBalance
                && !item.exemptFromGuardian
                && !(item.flags && (item.flags.notCountForBoth || item.flags.exemptFromGuardian))
                && item.student
              ));

              let remaining = hoursToCredit;
              const hoursByStudent = new Map();

              for (const item of creditableItems) {
                if (remaining <= EPSILON_HOURS) break;
                const itemHours = roundHours((Number(item.duration || 0) || 0) / 60);
                if (itemHours <= 0) continue;
                const slice = Math.min(itemHours, remaining);
                const studentKey = resolveStudentKey(item.student);
                if (!studentKey) continue;
                hoursByStudent.set(studentKey, roundHours((hoursByStudent.get(studentKey) || 0) + slice));
                distributedHours = roundHours(distributedHours + slice);
                remaining = roundHours(remaining - slice);
              }

              if (hoursByStudent.size) {
                for (const student of studentsArray) {
                  const candidateKeys = [
                    resolveStudentKey(student._id),
                    resolveStudentKey(student.studentId),
                    resolveStudentKey(student.standaloneStudentId)
                  ].filter(Boolean);
                  const key = candidateKeys.find((candidate) => hoursByStudent.has(candidate));
                  if (!key) continue;
                  const increment = hoursByStudent.get(key) || 0;
                  const current = Number(student.hoursRemaining || 0) || 0;
                  student.hoursRemaining = roundHours(current + increment);
                }
                guardian.markModified('guardianInfo.students');
              }
            }

            const canRecalculate = studentsArray.length
              && distributedHours >= roundHours(hoursToCredit - EPSILON_HOURS);
            if (canRecalculate) {
              const recalculatedTotal = studentsArray.reduce((sum, student) => sum + (Number(student.hoursRemaining || 0) || 0), 0);
              guardian.guardianInfo.totalHours = roundHours(recalculatedTotal);
            } else {
              const existingTotal = Number(guardian.guardianInfo.totalHours || 0) || 0;
              guardian.guardianInfo.totalHours = roundHours(existingTotal + hoursToCredit);
              guardian.guardianInfo.autoTotalHours = false;
            }

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
        
        // Student subdoc hours are kept in sync when payments are applied.
        // Guardian totalHours remains the authoritative balance for payments.

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

      if (!invoice.coverage || typeof invoice.coverage !== 'object') {
        invoice.coverage = {};
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

      if (!['paid', 'sent', 'overdue'].includes(invoice.status)) {
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

      const hasCoverageCap = false;

      const hourlyRate = resolveInvoiceHourlyRate(invoice);
      const transferFeeAmount = extractTransferFeeAmount(invoice);

      const baseAmount = roundCurrency(normalizedHours * hourlyRate);
      let expectedAmount = baseAmount;

      // ✅ SIMPLE APPROACH: Calculate transfer fee proportion based on HOURS, not class count
      // When refunding hours (not specific classes), the transfer fee should be proportional to hours
      // Example: Refund 5 out of 5 hours = 100% of transfer fee
      //          Refund 2 out of 5 hours = 40% of transfer fee
      const feeCoverageHours = computeInvoiceItemHours(invoice);
      
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

      const totalItemHours = computeInvoiceItemHours(updatedInvoice);

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

      const rangeLabel = `${invoiceStartDate ? dayjs(invoiceStartDate).format('MMM D, YYYY') : 'N/A'} to ${invoiceEndDate ? dayjs(invoiceEndDate).format('MMM D, YYYY') : 'N/A'}`;
      summaryMessageParts.push(`Invoice period spans ${rangeLabel}.`);

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
          expectedAmount,
          refundAmount: normalizedAmount
        },
        meta: {
          reason: refundData.reason || null,
          refundReference: refundData.refundReference || null
        }
      });

      // ─── After refund, rebalance invoice items to match new paid hours ───
      // The net paid hours after refund determines which classes stay on this invoice.
      // Classes beyond the new cap are unlinked so they can be picked up by future invoices.
      const netPaidHours = calculatePaidHoursFromLogs(updatedInvoice, hourlyRate);
      if (netPaidHours > 0) {
        updatedInvoice.coverage = updatedInvoice.coverage && typeof updatedInvoice.coverage === 'object'
          ? updatedInvoice.coverage
          : {};
        updatedInvoice.coverage.maxHours = netPaidHours;
        updatedInvoice.coverage.strategy = 'cap_hours';
        updatedInvoice.coverage.updatedAt = new Date();
        updatedInvoice.coverage.updatedBy = adminUserId || updatedInvoice.coverage.updatedBy;
        updatedInvoice.markModified('coverage');

        // Trim items beyond the new paid-hours cap (same split logic as payment)
        const capMinutes = Math.round(netPaidHours * 60);
        const refundItemsAsc = Array.isArray(updatedInvoice.items)
          ? [...updatedInvoice.items].sort((a, b) => {
              const da = new Date(a?.date || 0).getTime();
              const db = new Date(b?.date || 0).getTime();
              return da - db;
            })
          : [];
        let running = 0;
        const keptItems = [];
        const droppedItems = [];
        for (const item of refundItemsAsc) {
          const minutes = Number(item?.duration || 0) || 0;
          if (running + minutes > capMinutes) {
            const remaining = capMinutes - running;
            if (remaining > 0) {
              item.fullDuration = item.fullDuration || minutes;
              item.isPartial = true;
              item.partialMinutes = remaining;
              item.partialOfMinutes = minutes;
              item.duration = remaining;
              item.amount = roundCurrency((remaining / 60) * (Number(item?.rate || 0) || hourlyRate));
              keptItems.push(item);
              running += remaining;
            } else {
              droppedItems.push(item);
            }
            continue;
          }
          keptItems.push(item);
          running += minutes;
        }

        if (keptItems.length !== refundItemsAsc.length || droppedItems.length > 0) {
          updatedInvoice.items = keptItems;
          updatedInvoice.markModified('items');

          // Unlink dropped classes so they're available for future invoices
          const droppedClassIds = droppedItems
            .map((it) => it?.class || it?.lessonId)
            .filter(Boolean);
          if (droppedClassIds.length) {
            try {
              const Class = require('../models/Class');
              await Class.updateMany(
                { _id: { $in: droppedClassIds } },
                { $set: { billedInInvoiceId: null, billedAt: null, flaggedUninvoiced: true, paidByGuardian: false }, $unset: { paidByGuardianAt: 1 } }
              ).exec();
              console.log(`🔓 [Refund] Unlinked ${droppedClassIds.length} classes beyond new ${netPaidHours}h cap`);
            } catch (unlinkErr) {
              console.warn('Failed to unlink classes after refund cap', unlinkErr?.message);
            }
          }
        }

        // Update the last-kept item's date as coverage end
        const lastKept = keptItems.length ? keptItems[keptItems.length - 1] : null;
        const lastDate = lastKept?.date ? new Date(lastKept.date) : null;
        if (lastDate && !Number.isNaN(lastDate.getTime())) {
          updatedInvoice.coverage.endDate = lastDate;
          updatedInvoice.markModified('coverage');
        }

        updatedInvoice.recalculateTotals();
      }

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
          normalizedHours,
          totalItemHours
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
   * Undo the last refund on an invoice.
   * Reverses: paidAmount, guardian hours, student hours, coverage, items, status.
   */
  static async undoLastRefund(invoiceId, adminUserId) {
    try {
      const invoice = await Invoice.findById(invoiceId).populate('guardian').exec();
      if (!invoice) return { success: false, message: 'Invoice not found' };

      const refunds = Array.isArray(invoice.refunds) ? invoice.refunds : [];
      if (!refunds.length) {
        return { success: false, message: 'No refunds to undo on this invoice' };
      }

      // Take the last refund entry
      const lastRefund = refunds[refunds.length - 1];
      const refundAmount = roundCurrency(Number(lastRefund.amount || 0));
      const refundHours = roundHours(Number(lastRefund.refundHours || 0));
      const transferFeeRefunded = roundCurrency(Number(lastRefund.transferFeeRefunded || 0));

      if (refundAmount <= 0) {
        return { success: false, message: 'Last refund has no amount to reverse' };
      }

      console.log('🔄 [undoLastRefund] START', {
        invoiceId, refundAmount, refundHours, transferFeeRefunded
      });

      const statusBefore = invoice.status;

      // 1) Restore paidAmount
      invoice.paidAmount = roundCurrency((Number(invoice.paidAmount) || 0) + refundAmount);

      // 2) Restore transfer fee if it was reduced
      if (transferFeeRefunded > 0 && invoice.guardianFinancial?.transferFee) {
        const currentFee = roundCurrency(Number(invoice.guardianFinancial.transferFee.amount || 0));
        invoice.guardianFinancial.transferFee.amount = roundCurrency(currentFee + transferFeeRefunded);
        invoice.markModified('guardianFinancial.transferFee');
      }

      // 3) Remove the last refund entry
      invoice.refunds.pop();
      invoice.markModified('refunds');

      // 4) Remove the corresponding refund log from paymentLogs
      const logs = Array.isArray(invoice.paymentLogs) ? invoice.paymentLogs : [];
      for (let i = logs.length - 1; i >= 0; i--) {
        const log = logs[i];
        if (log && (log.method === 'refund' || log.paymentMethod === 'refund') && Number(log.amount) < 0) {
          logs.splice(i, 1);
          break;
        }
      }
      invoice.markModified('paymentLogs');

      // 5) Recalculate status
      invoice.recalculateTotals();
      const dueAmount = invoice.getDueAmount();
      if (invoice.paidAmount > 0 && dueAmount <= 0.01) {
        invoice.status = 'paid';
      } else if (invoice.paidAmount > 0) {
        invoice.status = 'paid'; // partially paid still shows as paid
      } else {
        invoice.status = statusBefore === 'refunded' ? 'pending' : statusBefore;
      }

      // 6) Restore guardian hours
      const guardianRef = invoice.guardian;
      const resolveId = (value) => {
        if (!value) return null;
        if (typeof value === 'object' && value._id) return value._id;
        return value;
      };
      const guardianIdValue = resolveId(guardianRef);
      let guardianBefore = null;
      let guardianAfter = null;

      if (guardianIdValue && refundHours > 0) {
        const guardianUser = await User.findById(guardianIdValue);
        if (guardianUser && guardianUser.guardianInfo) {
          guardianBefore = roundHours(Number(guardianUser.guardianInfo.totalHours || 0));
          guardianUser.guardianInfo.totalHours = roundHours(guardianBefore + refundHours);
          guardianUser.guardianInfo.autoTotalHours = false;
          guardianUser.markModified('guardianInfo');
          guardianAfter = guardianUser.guardianInfo.totalHours;
          await guardianUser.save();

          // Also update the Guardian model
          try {
            const GuardianModel = require('../models/Guardian');
            const guardianModel = await GuardianModel.findOne({ user: guardianUser._id });
            if (guardianModel) {
              guardianModel.totalRemainingMinutes = Math.max(0, Math.round(guardianAfter * 60));
              await guardianModel.save();
            }
          } catch (e) {
            console.warn('[undoLastRefund] Guardian model update failed', e?.message);
          }

          console.log('✅ [undoLastRefund] Guardian hours restored', {
            before: guardianBefore, after: guardianAfter, delta: refundHours
          });
        }
      }

      // 7) Restore coverage.maxHours from net payment logs
      const hourlyRate = resolveInvoiceHourlyRate(invoice);
      const netPaidHours = calculatePaidHoursFromLogs(invoice, hourlyRate);
      if (netPaidHours > 0) {
        invoice.coverage = invoice.coverage && typeof invoice.coverage === 'object'
          ? invoice.coverage : {};
        invoice.coverage.maxHours = netPaidHours;
        invoice.coverage.strategy = 'cap_hours';
        invoice.coverage.updatedAt = new Date();
        invoice.coverage.updatedBy = adminUserId;
        invoice.markModified('coverage');
      }

      // 8) Re-sync items from rebalance engine (restores dropped classes)
      if (invoice.type === 'guardian_invoice' && invoice.guardian) {
        try {
          const rebalanceResult = await InvoiceService.buildDynamicClassListRebalanced(invoice);
          if (rebalanceResult && rebalanceResult.rebalanced && Array.isArray(rebalanceResult.items) && rebalanceResult.items.length) {
            const syncedItems = rebalanceResult.items.map((ri) => {
              const classId = ri.lessonId || (ri.class && (ri.class._id || ri.class));
              return {
                lessonId: classId ? String(classId) : null,
                class: classId || null,
                student: ri.student || null,
                studentSnapshot: ri.studentSnapshot || null,
                teacher: ri.teacher || null,
                teacherSnapshot: ri.teacherSnapshot || null,
                description: ri.description || '',
                date: ri.date || null,
                duration: Number(ri.duration || 0) || 0,
                fullDuration: ri.fullDuration || ri.duration || 0,
                rate: Number(ri.rate || 0) || 0,
                amount: Number(ri.amount || 0) || 0,
                attended: Boolean(ri.attended),
                status: ri.status || 'scheduled',
                category: ri.category || null,
                isPartial: Boolean(ri.isPartial),
                partialMinutes: ri.partialMinutes || null,
                partialOfMinutes: ri.partialOfMinutes || null,
                paidByGuardian: Boolean(ri.paidByGuardian),
                excludeFromStudentBalance: Boolean(ri.excludeFromStudentBalance),
                exemptFromGuardian: Boolean(ri.exemptFromGuardian),
                flags: ri.flags || {}
              };
            });
            invoice.items = syncedItems;
            invoice.markModified('items');
          }
        } catch (rebalErr) {
          console.warn('[undoLastRefund] rebalance sync failed', rebalErr?.message);
        }
      }

      invoice.recalculateTotals();

      // 9) Audit
      await invoice.recordAuditEntry({
        actor: adminUserId,
        action: 'undo_refund',
        diff: {
          restoredAmount: refundAmount,
          restoredHours: refundHours,
          restoredTransferFee: transferFeeRefunded
        },
        meta: {
          statusBefore,
          statusAfter: invoice.status,
          guardianHoursBefore: guardianBefore,
          guardianHoursAfter: guardianAfter
        }
      });

      await invoice.save();
      await InvoiceService.syncInvoiceCoverageClasses(invoice);

      await invoice.populate([
        { path: 'guardian', select: 'firstName lastName email guardianInfo' },
        { path: 'teacher', select: 'firstName lastName email' },
        { path: 'items.student', select: 'firstName lastName email' }
      ]);

      const statusAfter = invoice.status;
      console.log('✅ [undoLastRefund] COMPLETE', {
        invoiceId, statusBefore, statusAfter,
        paidAmount: invoice.paidAmount,
        guardianBefore, guardianAfter
      });

      return {
        success: true,
        invoice,
        message: `Undo refund: restored $${refundAmount.toFixed(2)} (${refundHours}h). Guardian hours: ${guardianBefore} → ${guardianAfter}. Status: ${statusBefore} → ${statusAfter}.`
      };
    } catch (err) {
      console.error('[undoLastRefund] error:', err);
      return { success: false, message: err.message || 'Failed to undo refund' };
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

      const viaChannel = String(via || info?.delivery?.channel || '').trim().toLowerCase();
      if (sent === true && viaChannel === 'whatsapp') {
        const refLink = String(invoice.invoiceReferenceLink || '').trim();
        if (!refLink) {
          return { success: false, error: 'Invoice reference link is required before sending via WhatsApp.' };
        }
      }

      const alreadySent = Boolean(invoice.emailSent && invoice.emailSentDate);
      if (sent === true && alreadySent && !force) {
        await invoice.populate([
          { path: 'guardian', select: 'firstName lastName email phone guardianInfo.epithet' },
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
        { path: 'guardian', select: 'firstName lastName email phone guardianInfo.epithet' },
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
