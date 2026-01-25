// backend/models/AccountStatusAudit.js
/**
 * AccountStatusAudit Model - audit trail for user/student status changes.
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const accountStatusAuditSchema = new Schema({
  action: {
    type: String,
    required: true,
    enum: ['user_status_change', 'student_status_change', 'status_undo']
  },
  entityType: {
    type: String,
    required: true,
    enum: ['User', 'Student']
  },
  entityId: { type: Schema.Types.ObjectId, required: true },
  entityName: { type: String, trim: true },
  actor: { type: Schema.Types.ObjectId, ref: 'User' },
  actorRole: { type: String, enum: ['admin', 'system'] },
  actorIP: { type: String, trim: true },
  actorUserAgent: { type: String, trim: true },
  before: { type: Schema.Types.Mixed },
  after: { type: Schema.Types.Mixed },
  reason: { type: String, trim: true, maxlength: 500 },
  metadata: { type: Schema.Types.Mixed },
  success: { type: Boolean, required: true, default: true },
  errorMessage: { type: String, trim: true },
  timestamp: { type: Date, default: Date.now, required: true, index: true }
}, {
  timestamps: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

accountStatusAuditSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
accountStatusAuditSchema.index({ 'metadata.guardianId': 1, timestamp: -1 });
accountStatusAuditSchema.index({ actor: 1, timestamp: -1 });
accountStatusAuditSchema.index({ timestamp: -1 });

accountStatusAuditSchema.statics.logAction = async function (data) {
  const entry = {
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId,
    entityName: data.entityName || null,
    actor: data.actor || null,
    actorRole: data.actorRole || (data.actor ? 'admin' : 'system'),
    actorIP: data.actorIP || null,
    actorUserAgent: data.actorUserAgent || null,
    before: data.before || null,
    after: data.after || null,
    reason: data.reason || null,
    metadata: data.metadata || null,
    success: data.success !== false,
    errorMessage: data.errorMessage || null,
    timestamp: data.timestamp || new Date()
  };

  return this.create(entry);
};

module.exports = mongoose.model('AccountStatusAudit', accountStatusAuditSchema);
