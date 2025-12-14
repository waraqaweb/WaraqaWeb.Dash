const mongoose = require('mongoose');


const notificationSchema = new mongoose.Schema({
  // Recipient: user or role (for broadcast)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // If null, use role or broadcast
  },
  role: {
    type: String,
    enum: ['admin', 'teacher', 'guardian', 'student'],
    required: false
  },
  // Notification content
  title: { type: String, required: true },
  message: { type: String, required: true },
  // Notification type
  type: {
    type: String,
    enum: [
      'user',
      'class',
      'invoice',
      'request',
      'system',
      'feedback',
      'reminder',
      'meeting',
      'info',
      'success',
      'warning',
      'error',
      'teacher_salary', // Added for teacher salary notifications
      'payment' // Added for payment notifications
    ],
    required: true
  },
  relatedTo: {
    type: String,
    enum: [
      'system',
      'class',
      'vacation',
      'invoice',
      'profile',
      'request',
      'feedback',
      'dst_transition',
      'reminder',
      'teacher_invoice', // Added for teacher invoice notifications
      'teacher_payment', // Added for payment notifications
      'teacher_bonus', // Added for bonus notifications
      'meeting',
      'other'
    ],
    default: 'system'
  },
  relatedId: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  // Related entities
  relatedClass: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: false
  },
  relatedInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: false
  },
  relatedTeacherInvoice: { // Added for teacher salary invoices
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TeacherInvoice',
    required: false
  },
  relatedFeedback: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Feedback',
    required: false
  },
  relatedRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    required: false
  },
  // Status
  isRead: { type: Boolean, default: false },
  actionRequired: { type: Boolean, default: false },
  actionLink: { type: String },
}, {
  timestamps: true
});

// Index for quick user lookups
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });

module.exports = mongoose.model('Notification', notificationSchema);