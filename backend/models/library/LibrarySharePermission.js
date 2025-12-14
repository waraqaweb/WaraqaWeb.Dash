const mongoose = require('mongoose');
require('./LibraryFolder');
require('./LibraryItem');
const { shareAuditEntrySchema } = require('./librarySubschemas');
const {
  SHARE_PERMISSION_SCOPES,
  SHARE_PERMISSION_STATUSES
} = require('./libraryConstants');

const { Schema } = mongoose;

const sharePermissionSchema = new Schema(
  {
    scopeType: { type: String, enum: SHARE_PERMISSION_SCOPES, required: true },
    targetFolder: { type: Schema.Types.ObjectId, ref: 'LibraryFolder' },
    targetItem: { type: Schema.Types.ObjectId, ref: 'LibraryItem' },
    includeDescendants: { type: Boolean, default: false },
    requester: { type: Schema.Types.ObjectId, ref: 'User' },
    grantedToUser: { type: Schema.Types.ObjectId, ref: 'User' },
    grantedToEmail: { type: String, trim: true, lowercase: true },
    grantedToName: { type: String, trim: true },
    reason: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: SHARE_PERMISSION_STATUSES, default: 'pending' },
    downloadAllowed: { type: Boolean, default: false },
    downloadLimit: { type: Number, min: 0 },
    usageCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date },
    decisionNote: { type: String, trim: true, maxlength: 1000 },
    auditLog: { type: [shareAuditEntrySchema], default: [] },
    token: { type: String, trim: true, unique: true, sparse: true },
    spaceSlug: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastNotifiedAt: { type: Date },
    invitation: {
      fullName: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true }
    },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

sharePermissionSchema.index({ scopeType: 1, status: 1 });
sharePermissionSchema.index({ grantedToUser: 1, status: 1 });
sharePermissionSchema.index({ grantedToEmail: 1, status: 1 });
sharePermissionSchema.index({ targetFolder: 1 });
sharePermissionSchema.index({ targetItem: 1 });
sharePermissionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

sharePermissionSchema.pre('validate', function sharePermissionPreValidate(next) {
  if (this.scopeType === 'item' && !this.targetItem) {
    this.invalidate('targetItem', 'targetItem is required when scopeType is item');
  }
  if (this.scopeType === 'folder' && !this.targetFolder) {
    this.invalidate('targetFolder', 'targetFolder is required when scopeType is folder');
  }
  next();
});

sharePermissionSchema.methods.isActive = function isActive(now = new Date()) {
  if (this.status !== 'approved') return false;
  if (this.revokedAt) return false;
  if (this.expiresAt && this.expiresAt <= now) return false;
  if (this.downloadLimit && this.usageCount >= this.downloadLimit) return false;
  return true;
};

sharePermissionSchema.methods.recordAudit = function recordAudit(action, actor, note) {
  this.auditLog = this.auditLog || [];
  this.auditLog.push({ action, actor, note });
  return this.auditLog[this.auditLog.length - 1];
};

sharePermissionSchema.methods.applyDecision = function applyDecision({ status, actor, note, downloadAllowed, expiresAt }) {
  if (!SHARE_PERMISSION_STATUSES.includes(status)) {
    throw new Error('Invalid share permission status');
  }
  this.status = status;
  if (status === 'approved') {
    this.approvedBy = actor;
    this.approvedAt = new Date();
    this.downloadAllowed = downloadAllowed ?? this.downloadAllowed;
    this.expiresAt = expiresAt || this.expiresAt;
  }
  if (status === 'revoked') {
    this.revokedBy = actor;
    this.revokedAt = new Date();
  }
  this.decisionNote = note || this.decisionNote;
  this.recordAudit(status, actor, note);
  return this;
};

module.exports = mongoose.model('LibrarySharePermission', sharePermissionSchema);
