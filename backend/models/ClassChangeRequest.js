// models/ClassChangeRequest.js
// Teachers submit pending requests to change properties of future occurrences
// of a class (subject, description, duration, recurrence days/frequency).
// Admin must approve; on approval the future-class updates are applied
// and the guardian/student is notified by email + teacher gets an in-app
// notification.

const mongoose = require('mongoose');

const RecurrenceChangeSchema = new mongoose.Schema({
  frequency: { type: String, enum: ['daily', 'weekly', 'biweekly', 'monthly'] },
  interval: { type: Number, min: 1 },
  daysOfWeek: [{ type: Number, min: 0, max: 6 }],
}, { _id: false });

const RequestedChangesSchema = new mongoose.Schema({
  subject: { type: String, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 1000 },
  duration: { type: Number, min: 15, max: 180 },
  recurrence: { type: RecurrenceChangeSchema },
}, { _id: false });

const classChangeRequestSchema = new mongoose.Schema({
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // The class the request originated from. For recurring series this is
  // typically the parent (or any class in the series).
  class: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true, index: true },
  // Resolved series root for fan-out at approval time.
  seriesRoot: { type: mongoose.Schema.Types.ObjectId, ref: 'Class' },
  // Snapshot of current values at submission time so admin can see the diff.
  currentSnapshot: {
    subject: String,
    description: String,
    duration: Number,
    recurrence: {
      frequency: String,
      interval: Number,
      daysOfWeek: [Number],
    },
    title: String,
  },
  requestedChanges: { type: RequestedChangesSchema, required: true },
  reason: { type: String, trim: true, maxlength: 1000 },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true,
  },
  submittedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewerNotes: { type: String, trim: true, maxlength: 1000 },
  // Effective date — changes apply only to classes scheduled at or after this date.
  // Defaults to time of approval.
  effectiveFrom: { type: Date },
  // Diagnostic: how many future class documents we touched at approval time.
  appliedCount: { type: Number, default: 0 },
}, { timestamps: true });

classChangeRequestSchema.index({ status: 1, submittedAt: -1 });
classChangeRequestSchema.index({ teacher: 1, status: 1, submittedAt: -1 });

module.exports = mongoose.model('ClassChangeRequest', classChangeRequestSchema);
