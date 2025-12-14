const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  amount: { type: Number, required: true },
  paymentMethod: { type: String, default: 'manual' },
  transactionId: { type: String, index: true },
  idempotencyKey: { type: String },
  adminUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  paidHours: { type: Number },
  tip: { type: Number },
  paidAt: { type: Date },
  status: { type: String, enum: ['created','pending','applied','failed'], default: 'created' },
  appliedAt: { type: Date },
  logSnapshot: { type: mongoose.Schema.Types.Mixed },
  error: { type: String },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() }
}, { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' } });

// Unique idempotency per invoice when idempotencyKey is provided
paymentSchema.index({ invoice: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } });

// Unique transaction per invoice when transactionId is provided
paymentSchema.index({ invoice: 1, transactionId: 1 }, { unique: true, partialFilterExpression: { transactionId: { $exists: true } } });

module.exports = mongoose.model('Payment', paymentSchema);
