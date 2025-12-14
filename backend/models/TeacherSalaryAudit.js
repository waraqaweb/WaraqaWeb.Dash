// backend/models/TeacherSalaryAudit.js
/**
 * TeacherSalaryAudit Model - Comprehensive audit trail for teacher salary system
 * Immutable log of all CRUD operations with before/after snapshots
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const teacherSalaryAuditSchema = new Schema({
  // Event Information
  action: {
    type: String,
    required: true,
    enum: [
      // Invoice actions
      'invoice_create', 'invoice_publish', 'invoice_unpublish', 'invoice_paid',
      'invoice_delete', 'invoice_archive', 'invoice_recalculate',
      // Bonus/Extra actions
      'bonus_add', 'bonus_remove', 'extra_add', 'extra_remove',
      // Rate actions
      'rate_update', 'rate_partition_add', 'rate_partition_remove',
      // Exchange rate actions
      'exchange_rate_set', 'exchange_rate_update', 'exchange_rate_override',
      // Transfer fee actions
      'transfer_fee_update', 'teacher_transfer_fee_set',
      // Settings actions
      'settings_update',
      // System actions
      'job_run', 'job_fail', 'migration', 'bulk_operation'
    ]
  },

  // Entity Reference
  entityType: {
    type: String,
    required: true,
    enum: ['TeacherInvoice', 'SalarySettings', 'MonthlyExchangeRates', 'User', 'System']
  },
  entityId: { type: Schema.Types.ObjectId }, // null for system-wide actions

  // Actor (who performed the action)
  actor: { type: Schema.Types.ObjectId, ref: 'User' }, // null for system actions
  actorRole: { type: String, enum: ['admin', 'teacher', 'system'] },
  actorIP: { type: String, trim: true },
  actorUserAgent: { type: String, trim: true },

  // Before/After Snapshots
  before: { type: Schema.Types.Mixed }, // State before action
  after: { type: Schema.Types.Mixed }, // State after action
  diff: { type: Schema.Types.Mixed }, // Calculated difference

  // Context
  reason: { type: String, trim: true, maxlength: 500 },
  metadata: { type: Schema.Types.Mixed }, // Additional context

  // Result
  success: { type: Boolean, required: true, default: true },
  errorMessage: { type: String, trim: true },

  // Timestamp
  timestamp: { type: Date, default: Date.now, required: true, index: true }
}, {
  timestamps: false, // We use custom timestamp field
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
teacherSalaryAuditSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
teacherSalaryAuditSchema.index({ actor: 1, timestamp: -1 });
teacherSalaryAuditSchema.index({ action: 1, timestamp: -1 });
teacherSalaryAuditSchema.index({ timestamp: -1 });

// Prevent modifications
teacherSalaryAuditSchema.pre('save', function(next) {
  if (!this.isNew) {
    throw new Error('Audit logs are immutable');
  }
  next();
});

// Static methods

/**
 * Log an action
 */
teacherSalaryAuditSchema.statics.logAction = async function(data) {
  const entry = {
    action: data.action,
    entityType: data.entityType,
    entityId: data.entityId || null,
    actor: data.actor || null,
    actorRole: data.actorRole || (data.actor ? 'admin' : 'system'),
    actorIP: data.actorIP || null,
    actorUserAgent: data.actorUserAgent || null,
    before: data.before || null,
    after: data.after || null,
    diff: data.diff || null,
    reason: data.reason || null,
    metadata: data.metadata || null,
    success: data.success !== false,
    errorMessage: data.errorMessage || null,
    timestamp: data.timestamp || new Date()
  };

  return this.create(entry);
};

/**
 * Get audit trail for an entity
 */
teacherSalaryAuditSchema.statics.getEntityAuditTrail = function(entityType, entityId, options = {}) {
  const query = { entityType, entityId };
  
  if (options.action) {
    query.action = options.action;
  }
  
  if (options.actor) {
    query.actor = options.actor;
  }

  if (options.startDate || options.endDate) {
    query.timestamp = {};
    if (options.startDate) {
      query.timestamp.$gte = new Date(options.startDate);
    }
    if (options.endDate) {
      query.timestamp.$lte = new Date(options.endDate);
    }
  }

  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 100)
    .populate('actor', 'firstName lastName email role');
};

/**
 * Get audit trail for an actor
 */
teacherSalaryAuditSchema.statics.getActorAuditTrail = function(actorId, options = {}) {
  const query = { actor: actorId };
  
  if (options.action) {
    query.action = options.action;
  }

  if (options.entityType) {
    query.entityType = options.entityType;
  }

  if (options.startDate || options.endDate) {
    query.timestamp = {};
    if (options.startDate) {
      query.timestamp.$gte = new Date(options.startDate);
    }
    if (options.endDate) {
      query.timestamp.$lte = new Date(options.endDate);
    }
  }

  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 100);
};

/**
 * Search audit logs
 */
teacherSalaryAuditSchema.statics.searchAuditLogs = function(filters = {}, options = {}) {
  const query = {};

  if (filters.action) {
    query.action = Array.isArray(filters.action) ? { $in: filters.action } : filters.action;
  }

  if (filters.entityType) {
    query.entityType = filters.entityType;
  }

  if (filters.entityId) {
    query.entityId = filters.entityId;
  }

  if (filters.actor) {
    query.actor = filters.actor;
  }

  if (filters.success !== undefined) {
    query.success = filters.success;
  }

  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) {
      query.timestamp.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.timestamp.$lte = new Date(filters.endDate);
    }
  }

  const skip = options.skip || 0;
  const limit = options.limit || 50;

  return this.find(query)
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .populate('actor', 'firstName lastName email role');
};

/**
 * Get statistics
 */
teacherSalaryAuditSchema.statics.getStatistics = async function(startDate, endDate) {
  const match = {};
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) {
      match.timestamp.$gte = new Date(startDate);
    }
    if (endDate) {
      match.timestamp.$lte = new Date(endDate);
    }
  }

  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 },
        successCount: {
          $sum: { $cond: ['$success', 1, 0] }
        },
        failureCount: {
          $sum: { $cond: ['$success', 0, 1] }
        }
      }
    },
    { $sort: { count: -1 } }
  ]);

  return stats;
};

/**
 * Archive old logs (soft delete or move to archive collection)
 */
teacherSalaryAuditSchema.statics.archiveOldLogs = async function(beforeDate, batchSize = 1000) {
  // This is a placeholder for archival logic
  // In production, you might move to a separate archive collection
  // or mark with an 'archived' flag
  const count = await this.countDocuments({
    timestamp: { $lt: new Date(beforeDate) }
  });

  return {
    eligible: count,
    message: `${count} logs eligible for archival (before ${beforeDate})`
  };
};

/**
 * Get failed actions
 */
teacherSalaryAuditSchema.statics.getFailedActions = function(options = {}) {
  const query = { success: false };

  if (options.action) {
    query.action = options.action;
  }

  if (options.startDate || options.endDate) {
    query.timestamp = {};
    if (options.startDate) {
      query.timestamp.$gte = new Date(options.startDate);
    }
    if (options.endDate) {
      query.timestamp.$lte = new Date(options.endDate);
    }
  }

  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(options.limit || 100)
    .populate('actor', 'firstName lastName email');
};

/**
 * Export logs to CSV format (returns data, not file)
 */
teacherSalaryAuditSchema.statics.exportToCSV = async function(filters = {}) {
  const logs = await this.searchAuditLogs(filters, { limit: 10000 });
  
  const csvData = logs.map(log => ({
    timestamp: log.timestamp.toISOString(),
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId ? log.entityId.toString() : '',
    actor: log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : 'System',
    actorRole: log.actorRole,
    success: log.success,
    reason: log.reason || '',
    errorMessage: log.errorMessage || ''
  }));

  return csvData;
};

const TeacherSalaryAudit = mongoose.model('TeacherSalaryAudit', teacherSalaryAuditSchema);

module.exports = TeacherSalaryAudit;
