const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['first_class', 'monthly', 'evaluation'],
    required: true,
  },
  user: { // the user who submitted feedback (guardian or student user)
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function () {
      return this.type !== 'evaluation';
    },
  },
  student: { // if a guardian submitted, which student is the subject
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function () {
      return this.type !== 'evaluation';
    },
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
  metrics: {
    type: Map,
    of: Number,
  },
  heardAboutUs: { type: String, trim: true, maxlength: 500 },
  submitterName: { type: String, trim: true, maxlength: 200 },
  submitterEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
  evaluationTitle: { type: String, trim: true, maxlength: 200 },
  evaluationSession: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EvaluationSession',
  },
  evaluationStudentSubId: { type: mongoose.Schema.Types.ObjectId },
  source: { type: String, trim: true, maxlength: 100 },

  // Whether the prompt was dismissed without submitting (for tracking)
  dismissed: { type: Boolean, default: false },
  dismissedAt: { type: Date },

}, {
  timestamps: true,
});

// Indexes to quickly find feedback for teacher/student and by type
feedbackSchema.index({ teacher: 1, type: 1, createdAt: -1 });
feedbackSchema.index({ user: 1, type: 1, createdAt: -1 });
feedbackSchema.index(
  { evaluationSession: 1, evaluationStudentSubId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'evaluation',
      evaluationSession: { $exists: true },
      evaluationStudentSubId: { $exists: true },
    },
  }
);

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
