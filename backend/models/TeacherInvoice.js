// backend/models/TeacherInvoice.js
/**
 * TeacherInvoice Model - Complete salary invoicing system for teachers
 * Separate from guardian invoices to prevent data mixing and allow different workflows
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const roundCurrency = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
};

const roundHours = (value) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num * 1000) / 1000 : 0;
};

// Rate snapshot schema - preserves rate configuration at invoice generation
const rateSnapshotSchema = new Schema({
  partition: { type: String, required: true }, // e.g., "0-50h"
  rate: { type: Number, required: true, min: 0 }, // USD per hour
  effectiveFrom: { type: Date },
  description: { type: String, trim: true }
}, { _id: false });

// Exchange rate snapshot schema
const exchangeRateSnapshotSchema = new Schema({
  rate: { type: Number, required: true, min: 0 }, // EGP per USD
  source: { type: String, required: true }, // "MonthlyExchangeRate Oct 2025" or "Manual Override"
  setBy: { type: Schema.Types.ObjectId, ref: 'User' },
  setAt: { type: Date, default: Date.now }
}, { _id: false });

// Transfer fee snapshot schema
const transferFeeSnapshotSchema = new Schema({
  model: { 
    type: String, 
    enum: ['flat', 'percentage', 'none'],
    required: true 
  },
  value: { type: Number, required: true, min: 0 },
  source: { 
    type: String, 
    enum: ['teacher_custom', 'system_default'],
    required: true 
  }
}, { _id: false });

// Bonus schema
const bonusSchema = new Schema({
  source: {
    type: String,
    enum: ['guardian', 'admin'],
    required: true
  },
  guardianId: { type: Schema.Types.ObjectId, ref: 'User' }, // null if admin bonus
  amountUSD: { type: Number, required: true, min: 0 },
  reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 200 },
  addedAt: { type: Date, default: Date.now },
  addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: true });

// Extra schema (admin-only additions)
const extraSchema = new Schema({
  category: {
    type: String,
    enum: ['reimbursement', 'bonus', 'penalty', 'other'],
    required: true
  },
  amountUSD: { type: Number, required: true }, // can be negative for penalties
  reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 200 },
  addedAt: { type: Date, default: Date.now },
  addedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { _id: true });

// Change history entry
const changeHistorySchema = new Schema({
  changedAt: { type: Date, default: Date.now },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  action: { 
    type: String,
    required: true
  },
  field: { type: String, trim: true },
  oldValue: { type: Schema.Types.Mixed },
  newValue: { type: Schema.Types.Mixed },
  note: { type: String, trim: true }
}, { _id: true });

// Main Teacher Invoice Schema
const teacherInvoiceSchema = new Schema({
  // Teacher Reference
  teacher: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Billing Period
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2020, max: 2100 },
  
  // Compound index for uniqueness
  // Note: Can have multiple invoices for same teacher/month/year if adjustments exist
  
  // Invoice Identifiers
  invoiceNumber: { type: String, unique: true, sparse: true }, // e.g., "TCH-2025-10-001"
  shareToken: { 
    type: String, 
    unique: true, 
    sparse: true,
    index: true 
  }, // UUID v4 for shareable links
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'published', 'paid', 'archived'],
    default: 'draft',
    required: true,
    index: true
  },

  // Adjustment Info (for late submissions or corrections)
  isAdjustment: { type: Boolean, default: false },
  adjustmentFor: { type: Schema.Types.ObjectId, ref: 'TeacherInvoice' }, // original invoice
  adjustmentType: { 
    type: String, 
    enum: ['late_submission', 'correction', 'bonus_only'],
    sparse: true 
  },

  // Hours and Classes
  totalHours: { type: Number, required: true, default: 0, min: 0 },
  lockedMonthlyHours: { type: Number, min: 0 }, // Snapshot of teacherInfo.monthlyHours at creation time
  classIds: [{ type: Schema.Types.ObjectId, ref: 'Class' }], // all classes in this period

  // Rate Snapshot (frozen on publish)
  rateSnapshot: { 
    type: rateSnapshotSchema, 
    required: true 
  },

  // USD Calculations
  grossAmountUSD: { type: Number, required: true, default: 0, min: 0 },
  bonusesUSD: { type: Number, default: 0, min: 0 }, // sum of all bonuses
  extrasUSD: { type: Number, default: 0 }, // sum of all extras (can be negative)
  totalUSD: { type: Number, required: true, default: 0, min: 0 }, // gross + bonuses + extras

  // Exchange Rate Snapshot (frozen on publish)
  exchangeRateSnapshot: {
    type: exchangeRateSnapshotSchema,
    required: true
  },

  // EGP Calculations
  grossAmountEGP: { type: Number, required: true, default: 0, min: 0 },
  bonusesEGP: { type: Number, default: 0, min: 0 },
  extrasEGP: { type: Number, default: 0 },
  totalEGP: { type: Number, required: true, default: 0, min: 0 },

  // Transfer Fee Snapshot (frozen on publish)
  transferFeeSnapshot: {
    type: transferFeeSnapshotSchema,
    required: true
  },
  transferFeeEGP: { type: Number, default: 0, min: 0 },

  // Net Amount (after transfer fee)
  netAmountEGP: { type: Number, required: true, default: 0, min: 0 },

  // Admin Overrides (for manual adjustments)
  overrides: {
    grossAmountUSD: { type: Number, default: null },
    bonusesUSD: { type: Number, default: null },
    extrasUSD: { type: Number, default: null },
    totalUSD: { type: Number, default: null },
    grossAmountEGP: { type: Number, default: null },
    bonusesEGP: { type: Number, default: null },
    extrasEGP: { type: Number, default: null },
    totalEGP: { type: Number, default: null },
    transferFeeEGP: { type: Number, default: null },
    netAmountEGP: { type: Number, default: null },
    exchangeRate: { type: Number, default: null },
    appliedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    appliedAt: { type: Date }
  },

  // Bonuses and Extras
  bonuses: [bonusSchema],
  extras: [extraSchema],

  // Payment Details
  paymentMethod: {
    type: String,
    enum: ['bank_transfer', 'cash', 'vodafone_cash', 'instapay', 'other'],
    sparse: true
  },
  transactionId: { type: String, trim: true, sparse: true },
  paidAt: { type: Date, sparse: true, index: true },
  paidBy: { type: Schema.Types.ObjectId, ref: 'User' },

  // Notes
  notes: { type: String, trim: true, maxlength: 1000 },
  internalNotes: { type: String, trim: true, maxlength: 2000 },

  // Change History
  changeHistory: [changeHistorySchema],

  // Metadata
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  
  // Soft Delete
  deleted: { type: Boolean, default: false, index: true }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
teacherInvoiceSchema.index({ teacher: 1, month: 1, year: 1 });
teacherInvoiceSchema.index({ status: 1, paidAt: 1 });
teacherInvoiceSchema.index({ month: 1, year: 1, status: 1 });
teacherInvoiceSchema.index({ createdAt: -1 });

// Virtuals
teacherInvoiceSchema.virtual('teacherInfo', {
  ref: 'User',
  localField: 'teacher',
  foreignField: '_id',
  justOne: true
});

// Methods

/**
 * Generate unique invoice number
 */
teacherInvoiceSchema.methods.generateInvoiceNumber = function() {
  const monthStr = String(this.month).padStart(2, '0');
  const counter = Math.floor(Math.random() * 9999) + 1; // Temporary - should use sequence
  this.invoiceNumber = `TCH-${this.year}-${monthStr}-${String(counter).padStart(4, '0')}`;
};

/**
 * Generate shareable token (UUID v4 style)
 */
teacherInvoiceSchema.methods.generateShareToken = function() {
  const crypto = require('crypto');
  this.shareToken = crypto.randomUUID();
};

/**
 * Calculate all amounts (respects overrides)
 */
teacherInvoiceSchema.methods.calculateAmounts = function() {
  // Round helpers
  const hrs = roundHours(this.totalHours);
  const rate = Number(this.rateSnapshot?.rate || 0);
  const exchangeRate = Number(this.exchangeRateSnapshot?.rate || 1);
  
  // USD calculations (use overrides if present)
  this.grossAmountUSD = this.overrides?.grossAmountUSD !== null && this.overrides?.grossAmountUSD !== undefined
    ? roundCurrency(this.overrides.grossAmountUSD)
    : roundCurrency(hrs * rate);
    
  this.bonusesUSD = this.overrides?.bonusesUSD !== null && this.overrides?.bonusesUSD !== undefined
    ? roundCurrency(this.overrides.bonusesUSD)
    : roundCurrency((this.bonuses || []).reduce((sum, b) => sum + Number(b.amountUSD || 0), 0));
    
  this.extrasUSD = this.overrides?.extrasUSD !== null && this.overrides?.extrasUSD !== undefined
    ? roundCurrency(this.overrides.extrasUSD)
    : roundCurrency((this.extras || []).reduce((sum, e) => sum + Number(e.amountUSD || 0), 0));
    
  this.totalUSD = this.overrides?.totalUSD !== null && this.overrides?.totalUSD !== undefined
    ? roundCurrency(this.overrides.totalUSD)
    : roundCurrency(this.grossAmountUSD + this.bonusesUSD + this.extrasUSD);

  // EGP calculations (use overrides if present)
  const effectiveExchangeRate = this.overrides?.exchangeRate !== null && this.overrides?.exchangeRate !== undefined
    ? Number(this.overrides.exchangeRate)
    : exchangeRate;

  this.grossAmountEGP = this.overrides?.grossAmountEGP !== null && this.overrides?.grossAmountEGP !== undefined
    ? roundCurrency(this.overrides.grossAmountEGP)
    : roundCurrency(this.grossAmountUSD * effectiveExchangeRate);
    
  this.bonusesEGP = this.overrides?.bonusesEGP !== null && this.overrides?.bonusesEGP !== undefined
    ? roundCurrency(this.overrides.bonusesEGP)
    : roundCurrency(this.bonusesUSD * effectiveExchangeRate);
    
  this.extrasEGP = this.overrides?.extrasEGP !== null && this.overrides?.extrasEGP !== undefined
    ? roundCurrency(this.overrides.extrasEGP)
    : roundCurrency(this.extrasUSD * effectiveExchangeRate);
    
  this.totalEGP = this.overrides?.totalEGP !== null && this.overrides?.totalEGP !== undefined
    ? roundCurrency(this.overrides.totalEGP)
    : roundCurrency(this.totalUSD * effectiveExchangeRate);

  // Transfer fee (use override if present)
  if (this.overrides?.transferFeeEGP !== null && this.overrides?.transferFeeEGP !== undefined) {
    this.transferFeeEGP = roundCurrency(this.overrides.transferFeeEGP);
  } else {
    const feeSnapshot = this.transferFeeSnapshot || {};
    if (feeSnapshot.model === 'flat') {
      this.transferFeeEGP = roundCurrency(feeSnapshot.value || 0);
    } else if (feeSnapshot.model === 'percentage') {
      this.transferFeeEGP = roundCurrency(this.totalEGP * (feeSnapshot.value || 0) / 100);
    } else {
      this.transferFeeEGP = 0;
    }
  }

  // Net amount (use override if present)
  this.netAmountEGP = this.overrides?.netAmountEGP !== null && this.overrides?.netAmountEGP !== undefined
    ? roundCurrency(this.overrides.netAmountEGP)
    : roundCurrency(Math.max(0, this.totalEGP - this.transferFeeEGP));
};

/**
 * Publish invoice (freeze snapshot fields)
 */
teacherInvoiceSchema.methods.publish = async function(userId) {
  if (this.status !== 'draft') {
    throw new Error('Only draft invoices can be published');
  }

  // Recalculate before publishing
  this.calculateAmounts();

  this.status = 'published';
  this.updatedBy = userId;

  // Add change history
  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    action: 'publish',
    note: 'Invoice published and frozen'
  });

  return this.save();
};

/**
 * Unpublish invoice (back to draft)
 */
teacherInvoiceSchema.methods.unpublish = async function(userId) {
  if (this.status !== 'published') {
    throw new Error('Only published invoices can be unpublished');
  }

  if (this.paidAt) {
    throw new Error('Cannot unpublish paid invoices');
  }

  this.status = 'draft';
  this.updatedBy = userId;

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    action: 'unpublish',
    note: 'Invoice reverted to draft'
  });

  return this.save();
};

/**
 * Mark as paid
 */
teacherInvoiceSchema.methods.markAsPaid = async function(paymentDetails, userId) {
  if (this.status !== 'published') {
    throw new Error('Only published invoices can be marked as paid');
  }

  this.status = 'paid';
  this.paidAt = paymentDetails.paidAt || new Date();
  this.paidBy = userId;
  this.paymentMethod = paymentDetails.paymentMethod;
  this.transactionId = paymentDetails.transactionId;
  this.updatedBy = userId;

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    action: 'mark_paid',
    note: paymentDetails.note || 'Payment recorded',
    newValue: {
      method: paymentDetails.paymentMethod,
      transactionId: paymentDetails.transactionId,
      amount: this.netAmountEGP
    }
  });

  // Update teacher YTD totals
  const User = mongoose.model('User');
  const teacher = await User.findById(this.teacher);
  if (teacher && teacher.teacherInfo) {
    teacher.teacherInfo.totalHoursYTD = (teacher.teacherInfo.totalHoursYTD || 0) + this.totalHours;
    teacher.teacherInfo.totalEarningsYTD = (teacher.teacherInfo.totalEarningsYTD || 0) + this.netAmountEGP;
    await teacher.save();
  }

  return this.save();
};

/**
 * Add bonus
 */
teacherInvoiceSchema.methods.addBonus = function(bonusData, userId) {
  if (this.status === 'paid') {
    throw new Error('Cannot modify paid invoices. Create an adjustment invoice instead.');
  }

  const bonus = {
    source: bonusData.source,
    guardianId: bonusData.guardianId || null,
    amountUSD: bonusData.amountUSD,
    reason: bonusData.reason,
    addedAt: new Date(),
    addedBy: userId
  };

  this.bonuses.push(bonus);
  this.calculateAmounts();

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    action: 'add_bonus',
    newValue: bonus,
    note: `Bonus added: $${bonusData.amountUSD} from ${bonusData.source}`
  });

  this.updatedBy = userId;
};

/**
 * Remove bonus
 */
teacherInvoiceSchema.methods.removeBonus = function(bonusId, userId) {
  if (this.status === 'paid') {
    throw new Error('Cannot modify paid invoices');
  }

  const bonusIndex = this.bonuses.findIndex(b => b._id.toString() === bonusId.toString());
  if (bonusIndex === -1) {
    throw new Error('Bonus not found');
  }

  const removed = this.bonuses.splice(bonusIndex, 1)[0];
  this.calculateAmounts();

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    action: 'remove_bonus',
    oldValue: removed,
    note: `Bonus removed: $${removed.amountUSD}`
  });

  this.updatedBy = userId;
};

/**
 * Add extra
 */
teacherInvoiceSchema.methods.addExtra = function(extraData, userId) {
  if (this.status === 'paid') {
    throw new Error('Cannot modify paid invoices');
  }

  const extra = {
    category: extraData.category,
    amountUSD: extraData.amountUSD,
    reason: extraData.reason,
    addedAt: new Date(),
    addedBy: userId
  };

  this.extras.push(extra);
  this.calculateAmounts();

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    action: 'add_extra',
    newValue: extra,
    note: `Extra added: $${extraData.amountUSD} (${extraData.category})`
  });

  this.updatedBy = userId;
};

/**
 * Remove extra
 */
teacherInvoiceSchema.methods.removeExtra = function(extraId, userId) {
  if (this.status === 'paid') {
    throw new Error('Cannot modify paid invoices');
  }

  const extraIndex = this.extras.findIndex(e => e._id.toString() === extraId.toString());
  if (extraIndex === -1) {
    throw new Error('Extra not found');
  }

  const removed = this.extras.splice(extraIndex, 1)[0];
  this.calculateAmounts();

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    action: 'remove_extra',
    oldValue: removed,
    note: `Extra removed: $${removed.amountUSD}`
  });

  this.updatedBy = userId;
};

// Pre-save middleware
teacherInvoiceSchema.pre('save', function(next) {
  // Generate invoice number if not exists
  if (!this.invoiceNumber && this.status !== 'draft') {
    this.generateInvoiceNumber();
  }

  // Generate share token if not exists
  if (!this.shareToken && this.status !== 'draft') {
    this.generateShareToken();
  }

  // Recalculate amounts
  this.calculateAmounts();

  next();
});

// Static methods

/**
 * Find invoice by share token
 */
teacherInvoiceSchema.statics.findByShareToken = function(token) {
  return this.findOne({ shareToken: token, deleted: false });
};

/**
 * Get teacher's invoices for a year
 */
teacherInvoiceSchema.statics.getTeacherInvoicesForYear = function(teacherId, year) {
  return this.find({
    teacher: teacherId,
    year: year,
    deleted: false
  }).sort({ month: 1 });
};

/**
 * Get all invoices for a month
 */
teacherInvoiceSchema.statics.getInvoicesForMonth = function(month, year, status = null) {
  const query = { month, year, deleted: false };
  if (status) {
    query.status = status;
  }
  return this.find(query).populate('teacher', 'firstName lastName email');
};

/**
 * Calculate teacher YTD summary
 */
teacherInvoiceSchema.statics.getTeacherYTDSummary = async function(teacherId, year) {
  const invoices = await this.find({
    teacher: teacherId,
    year: year,
    deleted: false
  });

  const latestInvoice = await this.findOne({
    teacher: teacherId,
    year: year,
    deleted: false
  }).sort({ month: -1, createdAt: -1 });

  const summary = {
    totalHours: 0,
    totalHoursYTD: 0,
    totalEarnedEGP: 0,
    totalEarnedUSD: 0,
    totalEarningsYTD: 0,
    invoicesPaid: 0,
    invoicesPending: 0,
    avgMonthlyHours: 0,
    avgMonthlyEarnings: 0,
    currentRatePartition: latestInvoice?.rateSnapshot?.partition || null,
    effectiveRate: latestInvoice?.rateSnapshot?.rate || 0
  };

  invoices.forEach(inv => {
    summary.totalHours += inv.totalHours || 0;
    if (inv.status === 'paid') {
      summary.totalEarnedEGP += inv.netAmountEGP || 0;
      summary.totalEarnedUSD += inv.totalUSD || 0;
      summary.invoicesPaid++;
    } else if (inv.status === 'published') {
      summary.invoicesPending++;
    }
  });

  summary.totalHoursYTD = summary.totalHours;
  summary.totalEarningsYTD = summary.totalEarnedUSD;

  const monthsWorked = invoices.length;
  if (monthsWorked > 0) {
    summary.avgMonthlyHours = summary.totalHours / monthsWorked;
    summary.avgMonthlyEarnings = summary.totalEarnedEGP / summary.invoicesPaid || 0;
  }

  return summary;
};

const TeacherInvoice = mongoose.model('TeacherInvoice', teacherInvoiceSchema);

module.exports = TeacherInvoice;
