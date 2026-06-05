/**
 * EvaluationSession
 *
 * Stores a live assessment session conducted by an admin (Quran / Arabic
 * reading / Tajweed). One session may contain MULTIPLE students assessed
 * back-to-back; each student has their own answers, summary and an
 * optional tokenised feedback request.
 */

const mongoose = require('mongoose');
const crypto = require('crypto');

const AnswerSchema = new mongoose.Schema({
  // Stable id from the frontend question catalogue (e.g. "reading.letters.easy.alif")
  questionId: { type: String, required: true },
  section: {
    type: String,
    enum: [
      'reading-letters',
      'reading-words',
      'reading-sentences',
      'quran-recitation',
      'quran-memorization',
      'tajweed-theory',
      'tajweed-practical',
      'arabic-grammar',
      'arabic-vocab',
      'arabic-comprehension',
      'arabic-writing',
      'arabic-speaking',
    ],
    required: true,
  },
  level: { type: String, enum: ['easy', 'medium', 'advanced', 'na'], default: 'na' },
  prompt: { type: String, trim: true, maxlength: 4000 },
  // For MCQ: stored array of chosen option ids; for free / expert eval: empty
  chosen: [{ type: String, trim: true }],
  expertVerdict: {
    type: String,
    enum: ['correct', 'partial', 'incorrect', 'skipped', 'na'],
    default: 'na',
  },
  note: { type: String, trim: true, maxlength: 2000 },
  askedAt: { type: Date, default: Date.now },
}, { _id: false });

const WeaknessSchema = new mongoose.Schema({
  area: { type: String, trim: true, required: true },
  detail: { type: String, trim: true, maxlength: 2000 },
}, { _id: false });

const StudentResultSchema = new mongoose.Schema({
  // Optional link to existing student User; otherwise a freeform name/age
  studentUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  guardianUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, trim: true, required: true, maxlength: 200 },
  age: { type: Number, min: 1, max: 120 },
  contactEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
  contactPhone: { type: String, trim: true, maxlength: 60 },
  contactNote: { type: String, trim: true, maxlength: 2000 },

  // What the student is interested in studying & their availability (free text)
  desiredSubjects: [{ type: String, trim: true, maxlength: 120 }],
  availability: { type: String, trim: true, maxlength: 2000 },
  generalNotes: { type: String, trim: true, maxlength: 4000 },

  // Per-section difficulty selected by the admin (last value)
  difficulty: {
    reading: { type: String, enum: ['easy', 'medium', 'advanced'], default: 'easy' },
    quran:   { type: String, enum: ['easy', 'medium', 'advanced'], default: 'easy' },
    tajweed: { type: String, enum: ['easy', 'medium', 'advanced'], default: 'easy' },
  },

  answers: [AnswerSchema],
  weaknesses: [WeaknessSchema],
  strengths: [{ type: String, trim: true, maxlength: 300 }],
  recommendedLevel: { type: String, trim: true, maxlength: 200 },
  recommendedLevels: [{ type: String, trim: true, maxlength: 200 }],
  adminSummary: { type: String, trim: true, maxlength: 4000 },

  endedAt: { type: Date },

  // Feedback request (tokenised, public)
  feedback: {
    token: { type: String, index: true, sparse: true },
    sentTo: { type: String, trim: true, lowercase: true },
    sentAt: { type: Date },
    submittedAt: { type: Date },
    ratings: {
      overall: { type: Number, min: 1, max: 5 },
      knowledge: { type: Number, min: 1, max: 5 },
      friendliness: { type: Number, min: 1, max: 5 },
      clarity: { type: Number, min: 1, max: 5 },
      recommend: { type: Number, min: 1, max: 5 },
    },
    comment: { type: String, trim: true, maxlength: 2000 },
    heardAboutUs: { type: String, trim: true, maxlength: 500 },
    notifiedAdmin: { type: Boolean, default: false },
  },
}, { _id: true, timestamps: true });

const EvaluationSessionSchema = new mongoose.Schema({
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, trim: true, maxlength: 200 },
  status: { type: String, enum: ['active', 'completed'], default: 'active', index: true },
  students: [StudentResultSchema],
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
}, { timestamps: true });

EvaluationSessionSchema.statics.generateFeedbackToken = function () {
  return crypto.randomBytes(24).toString('hex');
};

module.exports = mongoose.model('EvaluationSession', EvaluationSessionSchema);
