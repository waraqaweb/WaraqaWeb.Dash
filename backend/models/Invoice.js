// backend/models/Invoice.js
const mongoose = require('mongoose');
const InvoiceAudit = require('./InvoiceAudit');
const {
  allocateNextSequence,
  computeMajorityMonth,
  buildInvoiceIdentifiers
} = require('../utils/invoiceNaming');

const { Schema, Types } = mongoose;

const roundCurrency = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

const roundHours = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 1000) / 1000;
};

const ensureDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const ACTIVE_DUPLICATE_STATUSES = ['draft', 'pending', 'sent', 'overdue', 'paid', 'partially_paid'];
const MAX_ACTIVITY_LOG_ENTRIES = 200;

const normalizeIdToString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value.toString) return value.toString();
  try {
    return String(value);
  } catch (err) {
    return null;
  }
};

const toObjectId = (value) => {
  if (!value) return null;
  try {
    return new mongoose.Types.ObjectId(value);
  } catch (err) {
    return null;
  }
};

const aggregateDeliveryStatus = (channels = []) => {
  if (!Array.isArray(channels) || channels.length === 0) return 'not_sent';

  const hasSent = channels.some((entry) => entry?.status === 'sent');
  if (hasSent) return 'sent';

  const hasQueued = channels.some((entry) => entry?.status === 'queued');
  if (hasQueued) return 'queued';

  const allFailed = channels.length > 0 && channels.every((entry) => entry?.status === 'failed');
  if (allFailed) return 'failed';

  return channels[channels.length - 1]?.status || 'not_sent';
};

const paymentLogSchema = new Schema({
  amount: { type: Number, required: true },
  paidHours: { type: Number },
  tip: { type: Number, default: 0 },
  method: {
    type: String,
    enum: ['manual', 'credit_card', 'bank_transfer', 'paypal', 'cash', 'check', 'refund', 'tip_distribution'],
    default: 'manual'
  },
  paymentMethod: {
    type: String,
    enum: ['manual', 'credit_card', 'bank_transfer', 'paypal', 'cash', 'check', 'refund', 'tip'],
    default: 'manual'
  },
  transactionId: { type: String, trim: true },
  note: { type: String, trim: true },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  processedAt: { type: Date, default: Date.now },
  snapshot: {
    guardianBalanceBefore: { type: Number },
    guardianBalanceAfter: { type: Number },
    invoiceRemainingBefore: { type: Number },
    invoiceRemainingAfter: { type: Number }
  }
}, { _id: true });

paymentLogSchema.pre('validate', function(next) {
  if (this.method && !this.paymentMethod) {
    this.paymentMethod = this.method;
  } else if (this.paymentMethod && !this.method) {
    this.method = this.paymentMethod;
  }
  next();
});

const refundRecordSchema = new Schema({
  amount: { type: Number, required: true },
  reason: { type: String, trim: true },
  processedDate: { type: Date, default: Date.now },
  refundReference: { type: String, trim: true },
  refundHours: { type: Number },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { _id: true });

/* ------------------------
   Invoice Item Schema
------------------------- */
const invoiceItemSchema = new mongoose.Schema({
  lessonId: { type: String, index: true, sparse: true }, // unique lesson reference
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  studentSnapshot: {
    firstName: String,
    lastName: String,
    email: String
  },
  teacherSnapshot: {
    firstName: String,
    lastName: String,
    email: String
  },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  description: { type: String, required: true },
  date: { type: Date, required: true },
  duration: { type: Number, required: true }, // minutes
  rate: { type: Number, required: true },
  amount: { type: Number, required: true },
  attended: { type: Boolean, default: true },
  status: { 
    type: String, 
    enum: [
      'scheduled',
      'in_progress',
      'completed',
      'attended',
      'missed_by_student',
      'cancelled_by_teacher',
      'cancelled_by_guardian',
      'cancelled_by_admin',
      'no_show_both',
      'absent',
      'cancelled',
      'unreported'
    ],
    default: 'scheduled'
  },
  excludeFromStudentBalance: { type: Boolean, default: false },
  excludeFromTeacherPayment: { type: Boolean, default: false },
  attendanceStatus: {
    type: String,
    enum: ['attended', 'student_absent', 'teacher_absent', 'cancelled', null],
    default: null
  },
  quantityHours: { type: Number }
}, { _id: true });

invoiceItemSchema.path('student').set(function(value) {
  if (value !== undefined) {
    this.$locals = this.$locals || {};
    this.$locals.studentRef = value;
  }
  if (value && typeof value === 'object' && value._id) {
    return value._id;
  }
  return value;
});

// adjustments removed: no longer storing manual adjustment entries on invoices

const transferFeeSchema = new Schema({
  mode: { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
  value: { type: Number, default: 0 },
  amount: { type: Number, default: 0 },
  waived: { type: Boolean, default: false },
  waivedByCoverage: { type: Boolean, default: false },
  source: { type: String, enum: ['guardian_default', 'manual'], default: 'guardian_default' },
  appliedAt: { type: Date },
  notes: { type: String, trim: true }
}, { _id: false });

const guardianFinancialSchema = new Schema({
  hourlyRate: { type: Number, default: 0 },
  transferFee: { type: transferFeeSchema, default: undefined }
}, { _id: false });

const coverageSchema = new Schema({
  strategy: {
    type: String,
    enum: ['full_period', 'cap_hours', 'custom_end', 'custom'],
    default: 'full_period'
  },
  maxHours: { type: Number },
  endDate: { type: Date },
  filters: {
    statuses: [{ type: String }],
    maxDurationMinutes: { type: Number },
    includeStudentIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    excludeStudentIds: [{ type: Schema.Types.ObjectId, ref: 'User' }]
  },
  notes: { type: String, trim: true },
  waiveTransferFee: { type: Boolean, default: false },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedAt: { type: Date }
}, { _id: false });

const deliveryRecordSchema = new Schema({
  channel: { type: String, enum: ['email', 'paypal', 'whatsapp', 'manual'], required: true },
  status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
  sentAt: Date,
  templateId: { type: String, trim: true },
  meta: Schema.Types.Mixed,
  attempt: { type: Number, default: 1 },
  messageHash: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const activityEntrySchema = new Schema({
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  action: {
    type: String,
    enum: ['create', 'update', 'item_update', 'status_change', 'payment', 'refund', 'delivery', 'note', 'delete'],
    required: true
  },
  at: { type: Date, default: Date.now },
  note: { type: String, trim: true },
  diff: Schema.Types.Mixed
}, { _id: true });

/* ------------------------
   Main Invoice Schema
------------------------- */
const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  invoiceSequence: { type: Number, default: null, index: true },
  invoiceName: { type: String, trim: true, default: null },
  invoiceSlug: { type: String, trim: true, unique: true, sparse: true },
  paypalInvoiceNumber: { type: String, trim: true, default: null },
  invoiceNameManual: { type: Boolean, default: false },
  type: { type: String, enum: ['guardian_invoice', 'teacher_payment'], required: true },
  billingType: {
    type: String,
    enum: ['monthly', 'payg', 'manual'],
    default: 'manual'
  },
  generationSource: {
    type: String,
    enum: ['auto-monthly', 'auto-payg', 'manual', 'first-lesson'],
    default: 'manual'
  },

  // Relations
  guardian: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Billing period & metadata
  billingPeriod: {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true }
  },

  firstLessonDate: { type: Date, default: null },
  hoursCovered: { type: Number, default: 0 },
  classIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Class' }],

  // Invoice items
  items: [invoiceItemSchema],

  // ✅ NEW: store excluded class IDs
  excludedClassIds: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'Class' }
  ],

  exchangeRate: { type: Number, default: 1 },

  // Financials
  subtotal: { type: Number, required: true, default: 0 },
  tax: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  discountReason: { type: String, trim: true },
  total: { type: Number, required: true, default: 0 },
  currency: { type: String, default: 'USD' },

  // Adjustments (manual admin corrections, e.g., subtract/undo classes)
  // adjustments removed: no adjustments array stored anymore
  adjustedTotal: { type: Number, default: 0 },

  // Status & payment
  status: {
    type: String,
    enum: ['draft', 'pending', 'sent', 'overdue', 'paid', 'partially_paid', 'cancelled', 'refunded'],
    default: 'draft'
  },
  dueDate: { type: Date, required: true },
  paidDate: Date,
  paidAmount: { type: Number, default: 0 },

  sentVia: { type: String, enum: ['email','paypal','whatsapp','manual','none'], default: 'none' },
  emailSent: { type: Boolean, default: false },
  emailSentDate: Date,

  paymentMethod: {
    type: String,
    enum: ['credit_card', 'bank_transfer', 'paypal', 'cash', 'check'],
    default: 'credit_card'
  },
  paymentReference: { type: String, trim: true },
  transactionId: { type: String, trim: true },
  tip: { type: Number, default: 0 },

  lateFee: { type: Number, default: 0 },
  lateFeeApplied: { type: Boolean, default: false },
  notes: { type: String, trim: true },
  internalNotes: { type: String, trim: true },

  remindersSent: [{
    sentDate: Date,
    type: { type: String, enum: ['first_reminder','second_reminder','final_notice'] }
  }],

  // Payment reminder tracking (Module 10)
  lastReminderSent: { type: Date, default: null },
  upcomingReminderSent: { type: Boolean, default: false },

  emailSentMethod: { type: String, enum: [null, 'email','paypal','whatsapp','manual'], default: null },

  paymentLogs: { type: [paymentLogSchema], default: [] },

  delivery: {
    status: {
      type: String,
      enum: ['not_sent', 'queued', 'sent', 'failed'],
      default: 'not_sent'
    },
    channels: { type: [deliveryRecordSchema], default: [] }
  },

  activityLog: { type: [activityEntrySchema], default: [] },

  refund: {
    amount: Number,
    reason: String,
    processedDate: Date,
    refundReference: String
  },
  refunds: { type: [refundRecordSchema], default: [] },

  isAdvancePayment: { type: Boolean, default: false },
  advancePaymentPeriod: { months: Number, startDate: Date, endDate: Date },

  teacherPayment: {
    classesCount: Number,
    totalHours: Number,
    hourlyRate: Number,
    bonus: { type: Number, default: 0 },
    bonusReason: String,
    deductions: { type: Number, default: 0 },
    deductionReason: String
  },

  guardianFinancial: { type: guardianFinancialSchema, default: undefined },
  coverage: { type: coverageSchema, default: undefined },

  // Audit
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }

  // Soft-delete support: mark drafts as deleted instead of physical removal
  ,deleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }

}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Enable optimistic concurrency control to prevent blind overwrites
invoiceSchema.set('optimisticConcurrency', true);

invoiceSchema.path('guardian').set(function(value) {
  if (value !== undefined) {
    this.$locals = this.$locals || {};
    this.$locals.guardianRef = value;
  }
  if (value && typeof value === 'object' && value._id) {
    return value._id;
  }
  return value;
});

/* ------------------------
   Virtuals
------------------------- */
invoiceSchema.virtual('daysOverdue').get(function() {
  if (!this.dueDate || !['sent','overdue'].includes(this.status)) return 0;
  const diff = new Date() - this.dueDate;
  return diff > 0 ? Math.ceil(diff / (1000*60*60*24)) : 0;
});

invoiceSchema.virtual('remainingBalance').get(function() {
  return this.getDueAmount();
});

/* ------------------------
   Indexes
------------------------- */
invoiceSchema.index({ guardian: 1, 'billingPeriod.year': 1, 'billingPeriod.month': 1 });
invoiceSchema.index({ teacher: 1, 'billingPeriod.year': 1, 'billingPeriod.month': 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ dueDate: 1 });
invoiceSchema.index({ invoiceNumber: 1 });
invoiceSchema.index({ invoiceSlug: 1 }, { unique: true, sparse: true });
invoiceSchema.index({ 'items.lessonId': 1 }, { sparse: true });
invoiceSchema.index({ 'delivery.channels.messageHash': 1 }, { sparse: true });
invoiceSchema.index({ deleted: 1 });

/* ------------------------
   Pre-validate Hooks
------------------------- */
invoiceSchema.pre('validate', async function(next) {
  if (!this || (this.isNew !== true && !this.isModified('items'))) {
    return next();
  }

  try {
    const items = Array.isArray(this.items) ? this.items : [];

    const duplicateKeys = [];
    const seenKeys = new Set();

    items.forEach((item) => {
      if (!item) return;

      const classKey = normalizeIdToString(item.class);
      if (classKey) {
        const key = `class:${classKey}`;
        if (seenKeys.has(key)) {
          duplicateKeys.push(`class ${classKey}`);
        } else {
          seenKeys.add(key);
        }
      }

      if (item.lessonId) {
        const lessonKey = String(item.lessonId);
        const key = `lesson:${lessonKey}`;
        if (seenKeys.has(key)) {
          duplicateKeys.push(`lesson ${lessonKey}`);
        } else {
          seenKeys.add(key);
        }
      }
    });

    if (duplicateKeys.length) {
      return next(new Error(`Invoice items contain duplicates: ${duplicateKeys.join(', ')}. Each class or lesson may only appear once per invoice.`));
    }

    const statusForCheck = this.status || 'draft';
    const shouldCheckConflicts = this.type === 'guardian_invoice' && ACTIVE_DUPLICATE_STATUSES.includes(statusForCheck);

    if (!shouldCheckConflicts) {
      return next();
    }

    const classIds = [...new Set(items.map((it) => normalizeIdToString(it?.class)).filter(Boolean))];
    const lessonIds = [...new Set(items.map((it) => (it?.lessonId ? String(it.lessonId) : null)).filter(Boolean))];

    if (!classIds.length && !lessonIds.length) {
      return next();
    }

    const conflictOr = [];
    if (classIds.length) {
      const objectIds = classIds.map((id) => toObjectId(id)).filter(Boolean);
      if (objectIds.length) {
        conflictOr.push({ 'items.class': { $in: objectIds } });
        conflictOr.push({ classIds: { $in: objectIds } });
      }
      conflictOr.push({ classIds: { $in: classIds } });
    }

    if (lessonIds.length) {
      conflictOr.push({ 'items.lessonId': { $in: lessonIds } });
    }

    if (!conflictOr.length) {
      return next();
    }

    const query = {
      _id: { $ne: this._id },
      type: 'guardian_invoice',
      status: { $in: ACTIVE_DUPLICATE_STATUSES },
      $or: conflictOr
    };

    let conflictQuery = this.constructor.findOne(query).select('invoiceNumber status');
    const session = typeof this.$session === 'function' ? this.$session() : null;
    if (session) {
      conflictQuery = conflictQuery.session(session);
    }

    const conflict = await conflictQuery.lean();

    if (conflict) {
      return next(new Error(`Invoice conflict detected: classes or lessons already invoiced in ${conflict.invoiceNumber}.`));
    }

    return next();
  } catch (err) {
    return next(err);
  }
});

/* ------------------------
   Pre-save Hook
------------------------- */
invoiceSchema.pre('save', async function(next) {
  try {
    // Allow callers to opt-out of automatic recalculation when applying
    // preview/snapshot totals that should be persisted as-is. Set
    // `invoice._skipRecalculate = true` before saving to preserve preview totals.
    if (this._skipRecalculate) {
      // clear the flag so future saves behave normally
      try { delete this._skipRecalculate; } catch (e) { this._skipRecalculate = undefined; }
    } else {
      this.recalculateTotals();
    }

    const remaining = this.getDueAmount();
    const alreadyPaid = roundCurrency(this.paidAmount || 0);

    // status auto-update
    if (remaining <= 0 && alreadyPaid > 0 && this.status !== 'refunded') {
      this.status = 'paid';
      if (!this.paidDate) this.paidDate = new Date();
    } else if (alreadyPaid > 0 && remaining > 0 && this.status !== 'refunded') {
      this.status = 'partially_paid';
    } else if (this.status === 'draft' && this.billingType !== 'manual') {
      this.status = 'pending';
    }

    if (this.dueDate && this.dueDate < new Date() && ['sent', 'pending', 'partially_paid'].includes(this.status)) {
      this.status = 'overdue';
    }

    await this.ensureIdentifiers();

    next();
  } catch (err) {
    next(err);
  }
});

/* ------------------------
   Helpers & Methods
------------------------- */

invoiceSchema.methods.ensureIdentifiers = async function(options = {}) {
  const { forceNameRefresh = false } = options;
  const type = this.type || 'guardian_invoice';
  const currentSequence = Number(this.invoiceSequence);
  let sequence = Number.isFinite(currentSequence) && currentSequence > 0
    ? currentSequence
    : await allocateNextSequence(type);

  if (!Number.isFinite(currentSequence) || currentSequence <= 0) {
    this.invoiceSequence = sequence;
  }

  const monthContext = computeMajorityMonth(Array.isArray(this.items) ? this.items : [], this.billingPeriod || {});
  const manualName = (!forceNameRefresh && this.invoiceNameManual && this.invoiceName)
    ? this.invoiceName
    : null;

  const identifiers = buildInvoiceIdentifiers({
    type,
    sequence,
    monthContext,
    manualName,
    paypalInvoiceNumber: this.paypalInvoiceNumber
  });

  this.invoiceNumber = identifiers.invoiceNumber;
  this.paypalInvoiceNumber = identifiers.paypalInvoiceNumber;
  this.invoiceSlug = identifiers.invoiceSlug;

  if (!this.invoiceNameManual || forceNameRefresh || !this.invoiceName) {
    this.invoiceName = identifiers.invoiceName;
    if (forceNameRefresh) {
      this.invoiceNameManual = false;
    }
  }

  return identifiers;
};

invoiceSchema.methods.recalculateTotals = function() {
  const items = Array.isArray(this.items) ? this.items : [];
  const collectedClassIds = new Set();
  const excludedSet = new Set(Array.isArray(this.excludedClassIds) ? this.excludedClassIds.map((id) => id && id.toString()) : []);

  items.forEach((item) => {
    if (item && typeof item.amount === 'undefined') {
      const minutes = Number(item.duration || 0);
      const rate = Number(item.rate || 0);
      item.amount = roundCurrency((minutes / 60) * rate);
    } else if (item) {
      item.amount = roundCurrency(item.amount);
    }
    if (item) {
      item.date = ensureDate(item.date);
      const hours = Number(item.duration || 0) / 60;
      item.quantityHours = Number.isFinite(hours) ? Math.round(hours * 1000) / 1000 : 0;
      const classKey = item.class ? item.class.toString() : (item.lessonId || null);
      if (classKey) {
        collectedClassIds.add(classKey);
      }
    }
  });

  this.classIds = Array.from(collectedClassIds);

  // ✅ Validate and normalize coverage first (before filtering)
  const coverage = this.coverage && typeof this.coverage === 'object' ? this.coverage : null;
  if (coverage) {
    const allowedStrategies = ['full_period', 'cap_hours', 'custom_end', 'custom'];
    if (!allowedStrategies.includes(coverage.strategy)) {
      coverage.strategy = 'custom';
    }

    if (typeof coverage.maxHours !== 'undefined') {
      const parsedMax = Number(coverage.maxHours);
      coverage.maxHours = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : undefined;
    }

    if (typeof coverage?.filters === 'object' && coverage.filters !== null) {
      if (!Array.isArray(coverage.filters.statuses)) {
        coverage.filters.statuses = [];
      } else {
        coverage.filters.statuses = Array.from(new Set(coverage.filters.statuses
          .map((status) => (typeof status === 'string' ? status.trim() : ''))
          .filter(Boolean)));
      }

      if (typeof coverage.filters.maxDurationMinutes !== 'undefined') {
        const parsedDuration = Number(coverage.filters.maxDurationMinutes);
        coverage.filters.maxDurationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0
          ? parsedDuration
          : undefined;
      }
    }

    coverage.endDate = ensureDate(coverage.endDate);
    if (coverage.updatedAt) {
      coverage.updatedAt = ensureDate(coverage.updatedAt) || coverage.updatedAt;
    }
    this.coverage = coverage;
  }

  // Exclude items whose classId is in excludedClassIds when computing totals
  let effectiveItems = items.filter((it) => {
    if (!it) return false;
    const key = it.class ? it.class.toString() : (it.lessonId || null);
    if (key && excludedSet.has(key)) return false;
    return true;
  });

  // ✅ NEW: Apply coverage.maxHours filter to match frontend calculation
  const maxHours = coverage?.maxHours;
  
  if (typeof maxHours === 'number' && Number.isFinite(maxHours) && maxHours > 0) {
    const maxMinutes = Math.round(maxHours * 60);
    let cumulativeMinutes = 0;
    const cappedItems = [];
    
    // Sort items by date (oldest first) before applying cap
    const sortedItems = [...effectiveItems].sort((a, b) => {
      const dateA = ensureDate(a.date);
      const dateB = ensureDate(b.date);
      if (!dateA || !dateB) return 0;
      return dateA.getTime() - dateB.getTime();
    });
    
    for (const item of sortedItems) {
      const duration = Number(item?.duration || 0);
      
      // Stop adding items once we exceed maxHours cap
      if (cumulativeMinutes + duration > maxMinutes) {
        break;
      }
      
      cappedItems.push(item);
      cumulativeMinutes += duration;
    }
    
    effectiveItems = cappedItems;
  }

  this.subtotal = roundCurrency(effectiveItems.reduce((sum, it) => sum + roundCurrency(it?.amount || 0), 0));
  this.tax = roundCurrency((this.subtotal * (this.taxRate || 0)) / 100);
  this.hoursCovered = effectiveItems.reduce((sum, it) => sum + ((Number(it?.duration || 0)) / 60), 0);

  // ✅ Use effectiveItems (filtered) for date calculations
  const dates = effectiveItems.map(i => ensureDate(i?.date)).filter(Boolean);
  this.firstLessonDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;

  const discount = roundCurrency(this.discount || 0);
  const lateFee = roundCurrency(this.lateFee || 0);
  const baseTotal = roundCurrency(this.subtotal + this.tax - discount + lateFee);

  if (this.guardianFinancial && typeof this.guardianFinancial.hourlyRate !== 'undefined') {
    const normalizedRate = Number(this.guardianFinancial.hourlyRate);
    this.guardianFinancial.hourlyRate = Number.isFinite(normalizedRate) ? normalizedRate : 0;
  }

  if (!this.guardianFinancial || typeof this.guardianFinancial !== 'object') {
    this.guardianFinancial = {};
  }

  // Coverage already validated and set earlier in this function

  const transferFee = (this.guardianFinancial.transferFee && typeof this.guardianFinancial.transferFee === 'object')
    ? this.guardianFinancial.transferFee
    : {};

  const allowedModes = ['fixed', 'percent'];
  const normalizedMode = typeof transferFee.mode === 'string' && allowedModes.includes(transferFee.mode)
    ? transferFee.mode
    : 'fixed';
  const valueNumeric = Number(transferFee.value);
  const normalizedValue = Number.isFinite(valueNumeric) ? valueNumeric : 0;
  const coverageWaive = coverage?.waiveTransferFee === true;
  const manualWaive = transferFee.waived === true;
  const isWaived = coverageWaive || manualWaive;

  let computedTransferFee = 0;
  if (!isWaived) {
    if (normalizedMode === 'percent') {
      computedTransferFee = roundCurrency((baseTotal * normalizedValue) / 100);
    } else {
      computedTransferFee = roundCurrency(normalizedValue);
    }
  }

  transferFee.mode = normalizedMode;
  transferFee.value = normalizedValue;
  transferFee.waived = isWaived;
  transferFee.waivedByCoverage = coverageWaive;
  transferFee.amount = computedTransferFee;
  transferFee.source = transferFee.source || 'guardian_default';
  if (computedTransferFee > 0) {
    transferFee.appliedAt = new Date();
  } else if (isWaived && !transferFee.appliedAt) {
    transferFee.appliedAt = new Date();
  }

  this.guardianFinancial.transferFee = transferFee;
  this.markModified('guardianFinancial');
  if (coverage) {
    this.markModified('coverage');
  }

  this.total = roundCurrency(baseTotal + computedTransferFee);

  // Adjustments removed: adjustedTotal mirrors total
  this.adjustedTotal = roundCurrency(this.total || 0);

  this.paidAmount = roundCurrency(this.paidAmount || 0);
  this.tip = roundCurrency(this.tip || 0);

  return this;
};

invoiceSchema.methods.getDueAmount = function() {
  const adjusted = roundCurrency(this.adjustedTotal || 0);
  const base = adjusted > 0 ? adjusted : roundCurrency(this.total || 0);
  const paid = roundCurrency(this.paidAmount || 0);
  return roundCurrency(Math.max(0, base - paid));
};

// adjustments removed: setAdjustments no longer supported

invoiceSchema.methods.applyClassExclusions = function(classIds = []) {
  const ids = Array.isArray(classIds) ? classIds.map(id => id && id.toString()).filter(Boolean) : [];
  // Set excluded class ids and recalculate totals. Previously this method
  // added adjustment entries to negate excluded classes; adjustments have
  // been removed so we simply store the excluded IDs and recalc totals.
  this.excludedClassIds = ids;
  this.markModified('excludedClassIds');
  this.recalculateTotals();
  return this;
};

invoiceSchema.methods.pushActivity = function(entry = {}) {
  if (!Array.isArray(this.activityLog)) {
    this.activityLog = [];
  }

  const activityEntry = {
    actor: entry.actor || this.updatedBy || this.createdBy,
    action: entry.action || 'note',
    at: ensureDate(entry.at) || new Date(),
    note: entry.note || null,
    diff: entry.diff || null
  };

  this.activityLog.push(activityEntry);

  if (this.activityLog.length > MAX_ACTIVITY_LOG_ENTRIES) {
    this.activityLog = this.activityLog.slice(-MAX_ACTIVITY_LOG_ENTRIES);
  }

  this.markModified('activityLog');
  return this;
};

invoiceSchema.methods.recordAuditEntry = async function(entry = {}, options = {}) {
  if (!entry || typeof entry !== 'object') {
    return this;
  }

  const resolvedActor = entry.actor || this.updatedBy || this.createdBy || null;
  const normalizedActor = (() => {
    if (!resolvedActor) return null;
    if (resolvedActor instanceof Types.ObjectId) return resolvedActor;
    if (typeof resolvedActor === 'object' && resolvedActor._id) {
      return Types.ObjectId.isValid(resolvedActor._id) ? new Types.ObjectId(resolvedActor._id) : null;
    }
    if (typeof resolvedActor === 'string' && Types.ObjectId.isValid(resolvedActor)) {
      return new Types.ObjectId(resolvedActor);
    }
    return null;
  })();

  const payload = {
    invoiceId: this._id,
    actorId: normalizedActor,
    action: entry.action || 'update',
    at: ensureDate(entry.at) || new Date(),
    diff: entry.diff || null,
    meta: entry.meta || null
  };

  const session = options.session || (typeof this.$session === 'function' ? this.$session() : null);

  const connectionReady = !!(mongoose.connection && [1, 2, 3].includes(mongoose.connection.readyState));

  if (!connectionReady && !session) {
    return this;
  }

  try {
    if (session) {
      await InvoiceAudit.create([payload], { session });
    } else {
      await InvoiceAudit.create(payload);
    }
  } catch (err) {
    console.error('Failed to record invoice audit entry', err.message);
  }

  return this;
};

invoiceSchema.methods.computeDeliveryStatus = function() {
  const channels = Array.isArray(this.delivery?.channels) ? this.delivery.channels : [];
  return aggregateDeliveryStatus(channels);
};

invoiceSchema.methods.recordDelivery = function({ channel, status, templateId, meta, sentAt, messageHash, actor, note } = {}) {
  if (!this.delivery) {
    this.delivery = { status: 'not_sent', channels: [] };
  }

  if (!channel) {
    throw new Error('Delivery channel is required');
  }

  if (!Array.isArray(this.delivery.channels)) {
    this.delivery.channels = [];
  }

  const normalizedStatus = status || 'queued';
  const deliveryTimestamp = sentAt ? ensureDate(sentAt) : (normalizedStatus === 'sent' ? new Date() : undefined);
  const matchingEntries = this.delivery.channels.filter((ch) => {
    if (!ch) return false;
    if (messageHash) {
      return ch.messageHash ? ch.messageHash === messageHash : false;
    }
    const templateMatch = (ch.templateId || null) === (templateId || null);
    return ch.channel === channel && templateMatch && (!ch.messageHash || !messageHash);
  });

  let existingRecord = matchingEntries.find(Boolean);

  if (messageHash && !existingRecord) {
    existingRecord = this.delivery.channels.find((ch) => ch.messageHash === messageHash);
  }

  const previousAttempt = existingRecord?.attempt || matchingEntries.length || 0;

  if (existingRecord) {
    existingRecord.status = normalizedStatus;
    existingRecord.sentAt = deliveryTimestamp;
    existingRecord.meta = meta || existingRecord.meta || null;
    existingRecord.templateId = templateId || existingRecord.templateId || null;
    existingRecord.messageHash = messageHash || existingRecord.messageHash || null;
    existingRecord.createdAt = existingRecord.createdAt || new Date();
    const shouldIncrement = normalizedStatus === 'failed';
    existingRecord.attempt = shouldIncrement ? Math.max(1, previousAttempt) + 1 : Math.max(1, previousAttempt || existingRecord.attempt || 1);
  } else {
    const nextAttempt = Math.max(1, matchingEntries.length + 1);
    const record = {
      channel,
      status: normalizedStatus,
      templateId: templateId || null,
      sentAt: deliveryTimestamp,
      meta: meta || null,
      attempt: nextAttempt,
      messageHash: messageHash || null,
      createdAt: new Date()
    };

    this.delivery.channels.push(record);
    existingRecord = record;
  }

  this.delivery.status = this.computeDeliveryStatus();
  this.markModified('delivery');

  this.pushActivity({
    actor: actor || this.updatedBy || this.createdBy,
    action: 'delivery',
    note: note || `Delivery ${normalizedStatus} via ${channel}`,
    diff: {
      channel,
      status: normalizedStatus,
      attempt: existingRecord?.attempt,
      templateId: existingRecord?.templateId || undefined,
      messageHash: existingRecord?.messageHash || undefined
    }
  });

  return this;
};

invoiceSchema.methods.getExportSnapshot = function(options = {}) {
  const includeItems = options.includeItems !== false;
  const includePayments = options.includePayments !== false;
  const includeActivity = options.includeActivity === true;
  const timezone = typeof options.timezone === 'string' && options.timezone.trim() ? options.timezone.trim() : 'UTC';
  const locale = typeof options.locale === 'string' && options.locale.trim() ? options.locale.trim() : 'en-US';

  const buildFormatter = (formatOptions, fallbackTimezone) => {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: timezone, ...formatOptions });
    } catch (err) {
      const safeTimezone = fallbackTimezone || 'UTC';
      try {
        return new Intl.DateTimeFormat(locale, { timeZone: safeTimezone, ...formatOptions });
      } catch (fallbackErr) {
        return new Intl.DateTimeFormat('en-US', formatOptions);
      }
    }
  };

  const dateTimeFormatter = buildFormatter({ year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const dateFormatter = buildFormatter({ year: 'numeric', month: 'short', day: '2-digit' });

  const items = [];
  const studentMap = new Map();
  const teacherMap = new Map();
  const daySet = new Set();

  let totalMinutes = 0;
  let totalAmount = 0;
  let firstLesson = null;
  let lastLesson = null;

  const buildName = (source) => {
    if (!source) return null;
    if (typeof source === 'string') return source;
    if (source.fullName) return source.fullName;
    if (source.name) return source.name;
    const parts = [source.firstName, source.lastName].filter(Boolean).join(' ').trim();
    return parts || null;
  };

  const resolvePerson = (primary, fallback) => {
    const hasIdentity = (obj) => obj && (obj.firstName !== undefined || obj.fullName || obj.name || obj.email || obj.phone);

    const candidate = (primary && typeof primary === 'object') ? primary : null;
    if (candidate instanceof Types.ObjectId) {
      return { name: candidate.toString(), _id: candidate };
    }
    if (hasIdentity(candidate)) {
      return candidate;
    }

    const fallbackCandidate = (fallback && typeof fallback === 'object') ? fallback : null;
    if (fallbackCandidate instanceof Types.ObjectId) {
      return { name: fallbackCandidate.toString(), _id: fallbackCandidate };
    }
    if (hasIdentity(fallbackCandidate)) {
      return fallbackCandidate;
    }

    if (typeof primary === 'string' && primary.trim()) {
      return { name: primary.trim() };
    }

    if (candidate && typeof candidate?.toString === 'function') {
      const asString = candidate.toString();
      if (asString && asString !== '[object Object]') {
        return { name: asString };
      }
    }

    if (typeof fallback === 'string' && fallback.trim()) {
      return { name: fallback.trim() };
    }

    if (fallbackCandidate && typeof fallbackCandidate?.toString === 'function') {
      const asString = fallbackCandidate.toString();
      if (asString && asString !== '[object Object]') {
        return { name: asString };
      }
    }

    return {};
  };

  const normalizeString = (value) => {
    if (!value || typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  (Array.isArray(this.items) ? this.items : []).forEach((entry, index) => {
    if (!entry) return;
    const item = entry.toObject ? entry.toObject() : entry;

    const durationMinutes = Number(item.duration || 0) || 0;
    const amountValue = roundCurrency(item.amount || 0);
    const dateValue = ensureDate(item.date);
    const hoursValue = durationMinutes / 60;

    if (durationMinutes > 0) {
      totalMinutes += durationMinutes;
    }
    totalAmount += amountValue;

    if (dateValue) {
      if (!firstLesson || dateValue < firstLesson) firstLesson = dateValue;
      if (!lastLesson || dateValue > lastLesson) lastLesson = dateValue;
      daySet.add(dateValue.toISOString().slice(0, 10));
    }

    const studentFallback = entry?.$locals?.studentRef;
    const studentSource = resolvePerson(item.studentSnapshot || item.student, studentFallback);
    const teacherFallback = entry?.$locals?.teacherRef;
    const teacherSource = resolvePerson(
      (item.teacher && typeof item.teacher === 'object' && item.teacher.firstName !== undefined) ? item.teacher : item.teacher,
      teacherFallback
    );

    const studentName = buildName(studentSource);
    const teacherName = buildName(teacherSource);

    const studentId = normalizeIdToString(
      studentSource?._id
      || (studentFallback?._id)
      || (item.student && item.student._id)
      || item.student
    );
    const teacherId = normalizeIdToString(
      teacherSource?._id
      || (teacherFallback?._id)
      || (item.teacher && item.teacher._id)
      || item.teacher
    );

    const studentKey = studentId || studentName || `student-${index}`;
    if (!studentMap.has(studentKey)) {
      studentMap.set(studentKey, {
        id: studentId,
        name: studentName,
        email: normalizeString(studentSource?.email),
        lessons: 0,
        totalMinutes: 0,
        totalAmount: 0
      });
    }
    const studentStats = studentMap.get(studentKey);
    studentStats.lessons += 1;
    studentStats.totalMinutes += durationMinutes;
    studentStats.totalAmount += amountValue;

    const teacherKey = teacherId || teacherName || `teacher-${index}`;
    if (!teacherMap.has(teacherKey)) {
      teacherMap.set(teacherKey, {
        id: teacherId,
        name: teacherName,
        email: normalizeString(teacherSource?.email),
        lessons: 0,
        totalMinutes: 0,
        totalAmount: 0
      });
    }
    const teacherStats = teacherMap.get(teacherKey);
    teacherStats.lessons += 1;
    teacherStats.totalMinutes += durationMinutes;
    teacherStats.totalAmount += amountValue;

    if (includeItems) {
      items.push({
        id: normalizeIdToString(item._id) || null,
        lessonId: item.lessonId ? String(item.lessonId) : null,
        classId: normalizeIdToString(item.class),
        date: dateValue ? {
          iso: dateValue.toISOString(),
          formatted: dateTimeFormatter.format(dateValue),
          day: dateFormatter.format(dateValue)
        } : null,
        student: {
          id: studentId,
          name: studentName,
          email: normalizeString(studentSource?.email)
        },
        teacher: {
          id: teacherId,
          name: teacherName,
          email: normalizeString(teacherSource?.email)
        },
        description: item.description || '',
        durationMinutes,
        hours: Math.round(hoursValue * 1000) / 1000,
        rate: Number(item.rate || 0) || 0,
        amount: amountValue,
        attended: typeof item.attended === 'boolean' ? item.attended : null,
        attendanceStatus: item.attendanceStatus || null,
        excludeFromStudentBalance: Boolean(item.excludeFromStudentBalance),
        excludeFromTeacherPayment: Boolean(item.excludeFromTeacherPayment)
      });
    }
  });

  if (includeItems) {
    items.sort((a, b) => {
      const aIso = a?.date?.iso || '';
      const bIso = b?.date?.iso || '';
      if (aIso < bIso) return -1;
      if (aIso > bIso) return 1;
      return 0;
    });
  }

  const mapToTotals = (map) => Array.from(map.values()).map((entry) => ({
    id: entry.id || null,
    name: entry.name || null,
    email: entry.email || null,
    lessons: entry.lessons,
    minutes: entry.totalMinutes,
    hours: Math.round((entry.totalMinutes / 60) * 1000) / 1000,
    amount: roundCurrency(entry.totalAmount)
  })).sort((a, b) => (b.minutes || 0) - (a.minutes || 0));

  const studentTotals = mapToTotals(studentMap);
  const teacherTotals = mapToTotals(teacherMap);

  // adjustments removed: no adjustments array or total
  const adjustmentsTotal = 0;

  const dueAmount = roundCurrency(this.getDueAmount());
  const dueDate = ensureDate(this.dueDate);

  const guardianRefCandidate = resolvePerson(
    this.guardian,
    this.$locals?.guardianRef
  );

  const guardianObj = Object.keys(guardianRefCandidate || {}).length ? guardianRefCandidate : null;

  const guardianName = guardianObj
    ? [guardianObj.firstName, guardianObj.lastName].filter(Boolean).join(' ').trim() || null
    : null;

  const guardianId = guardianObj
    ? normalizeIdToString(guardianObj._id || this.guardian || this.$locals?.guardianRef?._id)
    : normalizeIdToString(this.guardian || this.$locals?.guardianRef?._id);

  const teacherRefCandidate = resolvePerson(
    this.teacher,
    this.$locals?.teacherRef
  );

  const billingStart = ensureDate(this.billingPeriod?.startDate);
  const billingEnd = ensureDate(this.billingPeriod?.endDate);
  const billingLabelParts = [];
  if (billingStart) billingLabelParts.push(dateFormatter.format(billingStart));
  if (billingEnd) billingLabelParts.push(dateFormatter.format(billingEnd));

  const uniqueDayEntries = Array.from(daySet).sort().map((value) => {
    const parsed = ensureDate(value);
    const formatted = parsed ? dateFormatter.format(parsed) : value;
    return { iso: value, formatted };
  });

  const toActivityEntry = (entry) => {
    const timestamp = ensureDate(entry?.at);
    return {
      action: entry?.action || null,
      note: entry?.note || null,
      diff: entry?.diff || null,
      at: timestamp ? {
        iso: timestamp.toISOString(),
        formatted: dateTimeFormatter.format(timestamp)
      } : null,
      actor: normalizeIdToString(entry?.actor)
    };
  };

  const activityEntries = Array.isArray(this.activityLog) ? this.activityLog.slice(-5).map(toActivityEntry) : [];

  const deliveryChannels = Array.isArray(this.delivery?.channels) ? this.delivery.channels.map((ch) => {
    const sentAtDate = ensureDate(ch?.sentAt);
    const createdAtDate = ensureDate(ch?.createdAt);
    return {
      channel: ch?.channel || null,
      status: ch?.status || null,
      attempt: Number(ch?.attempt || 1),
      templateId: ch?.templateId || null,
      messageHash: ch?.messageHash || null,
      meta: ch?.meta || null,
      createdAt: createdAtDate ? {
        iso: createdAtDate.toISOString(),
        formatted: dateTimeFormatter.format(createdAtDate)
      } : null,
      sentAt: sentAtDate ? {
        iso: sentAtDate.toISOString(),
        formatted: dateTimeFormatter.format(sentAtDate)
      } : null
    };
  }) : [];

  const paymentEntries = includePayments && Array.isArray(this.paymentLogs) ? this.paymentLogs.map((log) => {
    const processedAt = ensureDate(log?.processedAt);
    return {
      amount: roundCurrency(log?.amount || 0),
      method: log?.method || log?.paymentMethod || null,
      transactionId: log?.transactionId || null,
      note: log?.note || null,
      processedAt: processedAt ? {
        iso: processedAt.toISOString(),
        formatted: dateTimeFormatter.format(processedAt)
      } : null,
      tip: Number.isFinite(log?.tip) ? roundCurrency(log.tip) : 0,
      snapshot: log?.snapshot || null,
      processedBy: normalizeIdToString(log?.processedBy)
    };
  }) : [];

  const transferFeeSource = this.guardianFinancial?.transferFee || null;
  const transferAppliedAt = ensureDate(transferFeeSource?.appliedAt);
  const transferFeeAmount = roundCurrency(transferFeeSource?.amount || 0);
  const transferFeeSnapshot = transferFeeSource ? {
    mode: transferFeeSource.mode || 'fixed',
    value: Number(transferFeeSource.value || 0) || 0,
    amount: transferFeeAmount,
    waived: Boolean(transferFeeSource.waived),
    waivedByCoverage: Boolean(transferFeeSource.waivedByCoverage),
    source: transferFeeSource.source || 'guardian_default',
    notes: transferFeeSource.notes || null,
    appliedAt: transferAppliedAt ? {
      iso: transferAppliedAt.toISOString(),
      formatted: dateTimeFormatter.format(transferAppliedAt)
    } : null
  } : null;

  const guardianHourlyRate = Number(this.guardianFinancial?.hourlyRate || 0) || 0;
  const guardianFinancialSnapshot = this.guardianFinancial ? {
    hourlyRate: guardianHourlyRate,
    transferFee: transferFeeSnapshot
  } : null;

  const coverageEndDate = ensureDate(this.coverage?.endDate);
  const coverageUpdatedAt = ensureDate(this.coverage?.updatedAt);
  const coverageFilters = this.coverage?.filters && typeof this.coverage.filters === 'object'
    ? this.coverage.filters
    : {};
  const coverageSnapshot = this.coverage ? {
    strategy: this.coverage.strategy || 'custom',
    maxHours: typeof this.coverage.maxHours === 'number' ? this.coverage.maxHours : null,
    endDate: coverageEndDate ? {
      iso: coverageEndDate.toISOString(),
      formatted: dateFormatter.format(coverageEndDate)
    } : null,
    filters: {
      statuses: Array.isArray(coverageFilters.statuses) ? coverageFilters.statuses : [],
      maxDurationMinutes: typeof coverageFilters.maxDurationMinutes === 'number'
        ? coverageFilters.maxDurationMinutes
        : null,
      includeStudentIds: Array.isArray(coverageFilters.includeStudentIds)
        ? coverageFilters.includeStudentIds.map((id) => normalizeIdToString(id)).filter(Boolean)
        : [],
      excludeStudentIds: Array.isArray(coverageFilters.excludeStudentIds)
        ? coverageFilters.excludeStudentIds.map((id) => normalizeIdToString(id)).filter(Boolean)
        : []
    },
    notes: this.coverage.notes || null,
    waiveTransferFee: Boolean(this.coverage.waiveTransferFee),
    updatedBy: normalizeIdToString(this.coverage.updatedBy),
    updatedAt: coverageUpdatedAt ? {
      iso: coverageUpdatedAt.toISOString(),
      formatted: dateTimeFormatter.format(coverageUpdatedAt)
    } : null
  } : null;

  const now = new Date();
  const metadataGeneratedAt = dateTimeFormatter.format(now);
  const createdAtDate = ensureDate(this.createdAt);
  const updatedAtDate = ensureDate(this.updatedAt);

  return {
    invoiceId: this._id ? this._id.toString() : null,
    invoiceNumber: this.invoiceNumber || null,
    type: this.type || null,
    status: this.status || null,
    billingPeriod: {
      start: billingStart ? billingStart.toISOString() : null,
      end: billingEnd ? billingEnd.toISOString() : null,
      label: billingLabelParts.join(' → ') || null,
      month: this.billingPeriod?.month || null,
      year: this.billingPeriod?.year || null
    },
    dueDate: dueDate ? {
      iso: dueDate.toISOString(),
      formatted: dateFormatter.format(dueDate)
    } : null,
    dateRange: {
      firstLesson: firstLesson ? {
        iso: firstLesson.toISOString(),
        formatted: dateFormatter.format(firstLesson)
      } : null,
      lastLesson: lastLesson ? {
        iso: lastLesson.toISOString(),
        formatted: dateFormatter.format(lastLesson)
      } : null,
      uniqueDays: uniqueDayEntries
    },
    counts: {
      lessonCount: Array.isArray(this.items) ? this.items.length : 0,
      studentCount: studentTotals.length,
      teacherCount: teacherTotals.length,
      dayCount: uniqueDayEntries.length
    },
    hours: {
      totalMinutes,
      totalHours: Math.round((totalMinutes / 60) * 1000) / 1000,
      totalHoursRounded2: Math.round((totalMinutes / 60) * 100) / 100
    },
    financials: {
      currency: this.currency || 'USD',
      subtotal: roundCurrency(this.subtotal || totalAmount),
      tax: roundCurrency(this.tax || 0),
      taxRate: Number(this.taxRate || 0) || 0,
      discount: roundCurrency(this.discount || 0),
      discountReason: this.discountReason || null,
      total: roundCurrency(this.total || totalAmount),
      transferFee: transferFeeSnapshot || {
        mode: 'fixed',
        value: 0,
        amount: 0,
        waived: false,
        waivedByCoverage: false,
        source: 'guardian_default',
        notes: null,
        appliedAt: null
      },
      transferFeeAmount,
  // adjustedTotal kept for compatibility (now mirrors total)
  adjustedTotal: roundCurrency(this.adjustedTotal || (this.total || totalAmount)),
      paidAmount: roundCurrency(this.paidAmount || 0),
      remainingBalance: dueAmount,
      tip: roundCurrency(this.tip || 0),
      lateFee: roundCurrency(this.lateFee || 0),
      lateFeeApplied: Boolean(this.lateFeeApplied)
    },
    guardian: guardianObj ? {
      id: guardianId,
      name: guardianName,
      email: normalizeString(guardianObj.email),
      phone: normalizeString(guardianObj.phone),
      timezone: guardianObj.timezone || guardianObj.timeZone || null
    } : null,
    teacher: Object.keys(teacherRefCandidate || {}).length ? {
      id: normalizeIdToString(teacherRefCandidate._id || this.teacher),
      name: buildName(teacherRefCandidate),
      email: normalizeString(teacherRefCandidate.email)
    } : null,
    delivery: {
      status: typeof this.computeDeliveryStatus === 'function' ? this.computeDeliveryStatus() : (this.delivery?.status || 'not_sent'),
      channels: deliveryChannels
    },
    remindersSent: Array.isArray(this.remindersSent) ? this.remindersSent.map((reminder) => {
      const sentDate = ensureDate(reminder?.sentDate);
      return {
        type: reminder?.type || null,
        sentDate: sentDate ? {
          iso: sentDate.toISOString(),
          formatted: dateFormatter.format(sentDate)
        } : null
      };
    }) : [],
    items: includeItems ? items : [],
    students: studentTotals,
    teachers: teacherTotals,
    // adjustments removed
    notes: {
      public: this.notes || null,
      internal: this.internalNotes || null
    },
    paymentLogs: paymentEntries,
    activity: includeActivity ? activityEntries : [],
    guardianFinancial: guardianFinancialSnapshot,
    coverage: coverageSnapshot,
    metadata: {
      generatedAt: now.toISOString(),
      generatedAtFormatted: metadataGeneratedAt,
      createdAt: createdAtDate ? {
        iso: createdAtDate.toISOString(),
        formatted: dateTimeFormatter.format(createdAtDate)
      } : null,
      updatedAt: updatedAtDate ? {
        iso: updatedAtDate.toISOString(),
        formatted: dateTimeFormatter.format(updatedAtDate)
      } : null,
      timezone,
      locale
    }
  };
};

invoiceSchema.methods.processPayment = async function(amount, paymentMethod = 'manual', transactionId, adminUserId, options = {}) {
  this.recalculateTotals();

  const sanitizedAmount = roundCurrency(amount);
  if (sanitizedAmount <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }

  const totalDue = this.getDueAmount();
  const alreadyPaid = roundCurrency(this.paidAmount || 0);
  const remaining = roundCurrency(Math.max(0, totalDue));

  if (remaining <= 0) {
    throw new Error('Invoice is already settled');
  }

  const appliedAmount = sanitizedAmount > remaining ? remaining : sanitizedAmount;

  this.paidAmount = roundCurrency(alreadyPaid + appliedAmount);
  const normalizedMethod = paymentMethod || this.paymentMethod || 'manual';
  this.paymentMethod = normalizedMethod;
  if (transactionId) {
    this.transactionId = transactionId;
  }

  const paymentDate = options.paidAt ? ensureDate(options.paidAt) : new Date();
  if ((!this.paidDate || this.paidAmount >= totalDue) && remaining - appliedAmount <= 0) {
    this.paidDate = paymentDate;
  }

  if (Number.isFinite(options.tip) && options.tip > 0) {
    this.tip = roundCurrency((this.tip || 0) + roundCurrency(options.tip));
  }

  const invoiceRemainingAfter = this.getDueAmount();

  const logEntry = {
    amount: appliedAmount,
    method: normalizedMethod,
    paymentMethod: normalizedMethod,
    transactionId: transactionId || undefined,
    processedBy: adminUserId || undefined,
    processedAt: paymentDate,
    note: options.note || undefined,
    paidHours: Number.isFinite(options.paidHours) ? Number(options.paidHours) : undefined,
    tip: Number.isFinite(options.tip) && options.tip > 0 ? roundCurrency(options.tip) : 0,
    snapshot: {
      guardianBalanceBefore: Number.isFinite(options.guardianBalanceBefore) ? roundCurrency(options.guardianBalanceBefore) : undefined,
      guardianBalanceAfter: Number.isFinite(options.guardianBalanceAfter) ? roundCurrency(options.guardianBalanceAfter) : undefined,
      invoiceRemainingBefore: remaining,
      invoiceRemainingAfter
    }
  };

  if (!Array.isArray(this.paymentLogs)) {
    this.paymentLogs = [];
  }
  this.paymentLogs.push(logEntry);
  this.markModified('paymentLogs');

  this.updatedBy = adminUserId || this.updatedBy;
  this.pushActivity({ actor: adminUserId, action: 'payment', note: options.note, diff: { amount: appliedAmount, method: normalizedMethod } });

  await this.recordAuditEntry({
    actor: adminUserId,
    action: 'payment',
    diff: {
      amount: appliedAmount,
      method: normalizedMethod,
      transactionId: transactionId || null,
      paidAmount: this.paidAmount,
      remainingBalance: invoiceRemainingAfter,
      tip: logEntry.tip || 0
    },
    meta: {
      note: options.note || null,
      paidHours: logEntry.paidHours || null
    }
  });

  if (invoiceRemainingAfter <= 0) {
    this.status = 'paid';
    if (!this.paidDate) {
      this.paidDate = paymentDate;
    }
  } else if (['draft', 'pending', 'paid', 'partially_paid'].includes(this.status)) {
    this.status = 'sent';
  }

  await this.save();
  // After saving payment, distribute tip among teachers (exclude items marked excludeFromTeacherPayment)
  try {
    const tipAmount = roundCurrency(logEntry.tip || 0);
    if (tipAmount > 0) {
      // compute transfer fee 5% of tip
      const transferFee = roundCurrency(tipAmount * 0.05);
      const netTip = roundCurrency(tipAmount - transferFee);

      // collect unique teacher ids from items that are eligible
      // fallback to teacherSnapshot name if teacher id is not present (tests may supply snapshots)
      const teacherIds = [];
      (this.items || []).forEach((it) => {
        if (it && it.excludeFromTeacherPayment) return;
        let t = null;
        if (it && it.teacher) {
          try {
            t = it.teacher._id ? it.teacher._id : it.teacher;
          } catch (e) {
            t = it.teacher;
          }
        }
        // fallback: use teacherSnapshot name as a stable identifier when teacher field is missing
        if (!t && it && it.teacherSnapshot) {
          const first = (it.teacherSnapshot.firstName || '').toString().trim();
          const last = (it.teacherSnapshot.lastName || '').toString().trim();
          const nameKey = (first || last) ? `${first}:${last}` : null;
          if (nameKey) t = nameKey;
        }

        if (t) {
          const idStr = typeof t === 'string' ? t : (t && typeof t.toString === 'function' ? t.toString() : String(t));
          if (!teacherIds.includes(idStr)) teacherIds.push(idStr);
        }
      });

      const count = teacherIds.length;
  console.info('[Invoice.processPayment] teacherIds for distribution:', teacherIds);
      if (count > 0) {
        // distribute netTip evenly, adjust last teacher for rounding remainder
        const base = Math.floor((netTip / count) * 100) / 100;
        let distributedSum = Math.round(base * 100) / 100 * count;
        // due to rounding, compute remainder
        let remainder = Math.round((netTip - distributedSum) * 100) / 100;

        for (let i = 0; i < teacherIds.length; i++) {
          let amount = base;
          // give remainder to last one
          if (i === teacherIds.length - 1) {
            amount = roundCurrency(amount + remainder);
          }

          const teacherLog = {
            amount: roundCurrency(amount),
            method: 'tip_distribution',
            paymentMethod: 'tip',
            transactionId: undefined,
            processedBy: logEntry.processedBy,
            processedAt: new Date(),
            note: `Tip distribution to teacher ${teacherIds[i]}`,
            snapshot: {
              invoiceId: this._id,
              teacherId: teacherIds[i],
              invoiceRemainingBefore: logEntry.snapshot?.invoiceRemainingBefore,
              invoiceRemainingAfter: logEntry.snapshot?.invoiceRemainingAfter
            }
          };

          this.paymentLogs.push(teacherLog);
        }
        this.markModified('paymentLogs');
        await this.save();
        // Now that teacher tip logs are persisted, update each teacher's monthlyEarnings so the tip is tracked for payouts
        try {
          const User = require('./User');
          for (let j = 0; j < teacherIds.length; j++) {
            const tId = teacherIds[j];
            try {
              if (!tId) continue;
              // If tId is an ObjectId string, update the teacher record; otherwise skip (snapshot-only)
              if (typeof tId === 'string' && mongoose.Types.ObjectId.isValid(tId)) {
                const logs = Array.isArray(this.paymentLogs)
                  ? this.paymentLogs.filter(l => l && l.method === 'tip_distribution' && l.snapshot && String(l.snapshot.teacherId) === String(tId))
                  : [];
                const sum = logs.reduce((s, l) => s + (Number(l.amount || 0) || 0), 0);
                if (sum > 0) {
                  await User.findByIdAndUpdate(tId, { $inc: { 'teacherInfo.monthlyEarnings': sum } }).exec();
                }
              }
            } catch (innerU) {
              console.warn('Failed to update teacher monthlyEarnings for', tId, innerU && innerU.message);
            }
          }
        } catch (uErr) {
          console.warn('Failed to perform teacher earnings distribution update:', uErr && uErr.message);
        }
      }
    }
  } catch (distErr) {
    console.error('Failed to distribute tip to teachers:', distErr);
  }

  await this.populate([
    { path: 'guardian', select: 'firstName lastName email' },
    { path: 'teacher', select: 'firstName lastName email' },
    { path: 'items.student', select: 'firstName lastName email' }
  ]);

  return { invoice: this, logEntry, appliedAmount, remainingBefore: remaining };
};

invoiceSchema.methods.recordRefund = async function(amount, options = {}, adminUserId) {
  const refundAmount = roundCurrency(amount);
  if (refundAmount <= 0) {
    throw new Error('Refund amount must be greater than zero');
  }

  const paidTotal = roundCurrency(this.paidAmount || 0);
  if (refundAmount > paidTotal + 0.009) {
    throw new Error('Refund amount cannot exceed paid amount');
  }

  const processedAt = options.processedAt ? ensureDate(options.processedAt) : new Date();
  const normalizedRefundHours = Number.isFinite(options.refundHours)
    ? roundHours(options.refundHours)
    : undefined;

  this.recalculateTotals();
  const dueBefore = this.getDueAmount();

  this.paidAmount = roundCurrency(paidTotal - refundAmount);

  // ✅ NEW: Reduce transfer fee proportionally if specified
  const proportionalTransferFee = options.proportionalTransferFee || 0;
  if (proportionalTransferFee > 0 && this.guardianFinancial?.transferFee) {
    const currentFeeAmount = roundCurrency(this.guardianFinancial.transferFee.amount || 0);
    const newFeeAmount = roundCurrency(Math.max(0, currentFeeAmount - proportionalTransferFee));
    
    console.log('💳 [Invoice.recordRefund] Reducing transfer fee', {
      before: currentFeeAmount,
      refunded: proportionalTransferFee,
      after: newFeeAmount
    });
    
    this.guardianFinancial.transferFee.amount = newFeeAmount;
    this.markModified('guardianFinancial.transferFee');
    
    // Recalculate total with new transfer fee
    this.recalculateTotals();
  }

  const refundEntry = {
    amount: refundAmount,
    reason: options.reason || undefined,
    processedDate: processedAt,
    refundReference: options.refundReference || undefined,
    refundHours: normalizedRefundHours,
    processedBy: adminUserId || undefined,
    transferFeeRefunded: proportionalTransferFee || undefined
  };

  if (!Array.isArray(this.refunds)) {
    this.refunds = [];
  }
  this.refunds.push(refundEntry);
  this.refund = { ...refundEntry };
  this.markModified('refund');
  this.markModified('refunds');

  if (!Array.isArray(this.paymentLogs)) {
    this.paymentLogs = [];
  }

  const refundLog = {
    amount: -refundAmount,
    method: 'refund',
    paymentMethod: 'refund',
    transactionId: options.refundReference || undefined,
    processedBy: adminUserId || undefined,
    processedAt,
    note: options.reason ? `Refund: ${options.reason}` : 'Refund issued',
    paidHours: normalizedRefundHours,
    tip: 0,
    snapshot: {
      invoiceRemainingBefore: roundCurrency(dueBefore),
      invoiceRemainingAfter: roundCurrency(this.getDueAmount())
    }
  };

  this.paymentLogs.push(refundLog);
  this.markModified('paymentLogs');

  const dueAfter = this.getDueAmount();
  
  // ✅ Status logic after refund:
  // - Fully refunded (paidAmount = 0): 'refunded'
  // - Still has balance due: 'partially_paid' (some money paid but not full amount)
  // - Fully paid after refund: 'paid' (edge case: refund was tip-only or adjustment)
  if (this.paidAmount <= 0.009) {
    this.status = 'refunded';
    console.log('🔄 [Invoice.recordRefund] Status → refunded (fully refunded)');
  } else if (dueAfter > 0.009) {
    this.status = 'partially_paid';
    console.log('🔄 [Invoice.recordRefund] Status → partially_paid', {
      paidAmount: this.paidAmount,
      totalDue: this.total,
      remaining: dueAfter
    });
  } else {
    this.status = 'paid';
    console.log('🔄 [Invoice.recordRefund] Status → paid (still fully covered)');
  }

  this.updatedBy = adminUserId || this.updatedBy;
  this.pushActivity({ actor: adminUserId, action: 'refund', note: options.reason, diff: { amount: refundAmount } });

  await this.recordAuditEntry({
    actor: adminUserId,
    action: 'refund',
    diff: {
      amount: refundAmount,
      paidAmountBefore: paidTotal,
      paidAmountAfter: this.paidAmount,
      refundReference: options.refundReference || null
    },
    meta: {
      reason: options.reason || null,
      refundHours: normalizedRefundHours || null,
      processedAt
    }
  });

  await this.save();
  await this.populate([
    { path: 'guardian', select: 'firstName lastName email' },
    { path: 'teacher', select: 'firstName lastName email' },
    { path: 'items.student', select: 'firstName lastName email' }
  ]);

  return { invoice: this, refundAmount };
};

/* ------------------------
   Statics
------------------------- */
invoiceSchema.statics.generateInvoiceNumber = async function(type, year, month) {
  const prefix = type === 'guardian_invoice' ? 'INV' : 'PAY';
  const yearMonth = `${year}${month.toString().padStart(2,'0')}`;

  const last = await this.findOne({ type, 'billingPeriod.year': year, 'billingPeriod.month': month }).sort({ invoiceNumber: -1 });
  let seq = 1;
  if (last && last.invoiceNumber) {
    const match = last.invoiceNumber.match(/(\d{4})$/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}-${yearMonth}-${seq.toString().padStart(4,'0')}`;
};

invoiceSchema.statics.findOverdue = function() {
  return this.find({ status: { $in: ['sent','overdue'] }, dueDate: { $lt: new Date() } }).populate('guardian','firstName lastName email');
};

/* ------------------------
   Methods
------------------------- */
invoiceSchema.methods.revertPayment = async function(adminUserId) {
  this.status = 'draft';
  this.paidAmount = 0;
  this.paidDate = null;
  this.transactionId = null;
  if (adminUserId) this.updatedBy = adminUserId;

  if (this.type === 'teacher_payment' && this.items?.length > 0) {
    const classIds = this.items.map(it => it.class).filter(Boolean);
    if (classIds.length > 0) {
      const Class = require('./Class');
      await Class.updateMany(
        { _id: { $in: classIds } },
        { $set: { paid: false } }
      );
    }
  }

  return this.save();
};

invoiceSchema.methods.addLateFee = function(feeAmount, reason) {
  if (!this.lateFeeApplied) {
    this.lateFee = feeAmount;
    this.lateFeeApplied = true;
    this.internalNotes = (this.internalNotes || '') + `\nLate fee applied: ${reason || ''}`;
    return this.save();
  }
  return Promise.resolve(this);
};

invoiceSchema.methods.sendReminder = function(reminderType) {
  this.remindersSent = this.remindersSent || [];
  this.remindersSent.push({ sentDate: new Date(), type: reminderType });
  return this.save();
};

module.exports = mongoose.model('Invoice', invoiceSchema);
