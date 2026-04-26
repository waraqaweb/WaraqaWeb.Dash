const mongoose = require('mongoose');

const EMAIL_TYPES = [
  'classCreated', 'classCancelled', 'classRescheduled',
  'poorPerformance', 'monthlyStudentReport', 'consecutiveAbsent',
  'invoiceCreated', 'invoiceSend', 'invoicePublished', 'paymentReceived',
  'bonusAdded', 'extraAdded',
  'registrationWelcome', 'studentCreated', 'studentDeleted',
  'vacationApproved', 'vacationGuardianNotice', 'vacationResumed',
  'teacherReassigned', 'seriesCancelled',
  'meetingScheduled',
  'teacherAvailabilityChanged',
  'monthlyAdminReport', 'invoiceGenerationSummary',
  'systemAlert', 'testEmail', 'other'
];

const emailLogSchema = new mongoose.Schema({
  to: { type: String, required: true },
  subject: { type: String, required: true },
  type: { type: String, enum: EMAIL_TYPES, default: 'other' },
  status: {
    type: String,
    enum: ['queued', 'sent', 'failed', 'skipped'],
    default: 'queued',
    index: true
  },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  relatedId: { type: String }, // related document id (invoice, class, etc.)
  metadata: { type: mongoose.Schema.Types.Mixed },
  error: { type: String },
  sentAt: { type: Date },
}, {
  timestamps: true
});

emailLogSchema.index({ createdAt: -1 });
emailLogSchema.index({ userId: 1, type: 1 });
emailLogSchema.index({ relatedId: 1, type: 1 }); // for dedup checks

module.exports = mongoose.model('EmailLog', emailLogSchema);
module.exports.EMAIL_TYPES = EMAIL_TYPES;
