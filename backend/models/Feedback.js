const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['first_class', 'monthly'],
    required: true,
  },
  user: { // the user who submitted feedback (guardian or student user)
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  student: { // if a guardian submitted, which student is the subject
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  classId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
  },
  // Ratings and text fields
  firstClassRating: { type: Number, min: 0, max: 10 },
  teacherPerformanceRating: { type: Number, min: 0, max: 10 },
  attendanceOnTime: { type: Number, min: 0, max: 10 },
  connectionQuality: { type: Number, min: 0, max: 10 },
  progressEvaluation: { type: Number, min: 0, max: 10 },
  notes: { type: String, trim: true, maxlength: 2000 },

  // Whether the prompt was dismissed without submitting (for tracking)
  dismissed: { type: Boolean, default: false },
  dismissedAt: { type: Date },

}, {
  timestamps: true,
});

// Indexes to quickly find feedback for teacher/student and by type
feedbackSchema.index({ teacher: 1, type: 1, createdAt: -1 });
feedbackSchema.index({ user: 1, type: 1, createdAt: -1 });

// Administrative state
feedbackSchema.add({
  read: { type: Boolean, default: false },
  readAt: { type: Date },
  archived: { type: Boolean, default: false },
  archivedAt: { type: Date }
});

feedbackSchema.add({
  featuredOnSite: { type: Boolean, default: false },
  publicQuote: { type: String, trim: true, maxlength: 500 }
});

module.exports = mongoose.model('Feedback', feedbackSchema);
