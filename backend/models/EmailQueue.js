const mongoose = require('mongoose');

const emailQueueSchema = new mongoose.Schema({
  to: { type: String, required: true },
  subject: { type: String, required: true },
  html: { type: String },
  text: { type: String },
  type: { type: String, default: 'other' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  relatedId: { type: String },
  // Priority 1 = urgent/immediate, 2 = transactional (2s gap), 3 = bulk (5s gap)
  priority: { type: Number, enum: [1, 2, 3], default: 2 },
  status: {
    type: String,
    enum: ['pending', 'processing', 'sent', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  scheduledAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  error: { type: String },
}, {
  timestamps: true
});

emailQueueSchema.index({ status: 1, priority: 1, scheduledAt: 1 });

module.exports = mongoose.model('EmailQueue', emailQueueSchema);
