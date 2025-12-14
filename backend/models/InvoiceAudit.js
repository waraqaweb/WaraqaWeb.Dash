// backend/models/InvoiceAudit.js
const mongoose = require('mongoose');

const { Schema } = mongoose;

const invoiceAuditSchema = new Schema({
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  action: {
    type: String,
    enum: ['create', 'update', 'item_update', 'status_change', 'payment', 'refund', 'refund_adjustment', 'delivery', 'note', 'delete', 'restore', 'permanent_delete'],
    required: true
  },
  at: { type: Date, default: Date.now },
  diff: Schema.Types.Mixed,
  meta: Schema.Types.Mixed
}, { timestamps: false });

invoiceAuditSchema.index({ invoiceId: 1, at: -1 });
invoiceAuditSchema.index({ action: 1, at: -1 });

module.exports = mongoose.model('InvoiceAudit', invoiceAuditSchema);
