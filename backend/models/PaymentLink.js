// backend/models/PaymentLink.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * PaymentLink — join table between Classes and Invoices.
 *
 * Each record says:
 *   "Invoice X covers Y hours of Class Z for Guardian G."
 *
 * A single class can be covered by multiple invoices (partial coverage),
 * and a single invoice can cover many classes.  The sum of hoursCovered
 * per invoice must never exceed the invoice's creditHours.
 */
const paymentLinkSchema = new Schema({
  guardian: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  student: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  class: {
    type: Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },
  invoice: {
    type: Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true
  },
  hoursCovered: {
    type: Number,
    required: true,
    min: 0
  },
  /**
   * confirmed  = class is attended / completed / missed_by_student
   * projected  = class is scheduled / in_progress (future, not yet consumed)
   */
  type: {
    type: String,
    enum: ['confirmed', 'projected'],
    required: true,
    default: 'projected'
  }
}, {
  timestamps: true
});

// ------------------------------------------------------------------
// Indexes
// ------------------------------------------------------------------
// Fast lookup: all links for a guardian's invoice
paymentLinkSchema.index({ guardian: 1, invoice: 1 });
// Fast lookup: which invoices cover a given class
paymentLinkSchema.index({ guardian: 1, class: 1 });
// Per-class lookup (e.g. "is this class covered?")
paymentLinkSchema.index({ class: 1 });
// Per-invoice + type (summing confirmed vs projected)
paymentLinkSchema.index({ invoice: 1, type: 1 });

module.exports = mongoose.model('PaymentLink', paymentLinkSchema);
