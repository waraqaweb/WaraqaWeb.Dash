/**
 * Post-interview feedback requested from teacher candidates (or any teacher
 * we'd like to hear from) about their experience with Waraqa's hiring
 * process. Decoupled from TeacherContractLead/TeacherContractSubmission so a
 * link can be generated for a candidate on file OR for any teacher who isn't
 * listed in the interview tab at all.
 */
const mongoose = require('mongoose');
const crypto = require('crypto');

const teacherInterviewFeedbackSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },

  // Whoever the link was generated for — free text, not necessarily tied to
  // an account.
  teacherName: { type: String, trim: true, maxlength: 200 },
  contactEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
  contactPhone: { type: String, trim: true, maxlength: 50 },

  // Optional link back to the candidate record when generated from the
  // Interview scorecard (source: 'public' | 'dashboard', matching the
  // existing TeacherContractLead/TeacherContractSubmission resolution).
  candidateSource: { type: String, trim: true, maxlength: 30 },
  candidateId: { type: mongoose.Schema.Types.ObjectId },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sentAt: { type: Date },

  ratings: {
    communication: { type: Number, min: 1, max: 5 },
    scheduling: { type: Number, min: 1, max: 5 },
    professionalism: { type: Number, min: 1, max: 5 },
    roleClarity: { type: Number, min: 1, max: 5 },
    overallExperience: { type: Number, min: 1, max: 5 },
  },
  improvementSuggestions: { type: String, trim: true, maxlength: 2000 },
  submittedAt: { type: Date },
}, { timestamps: true });

teacherInterviewFeedbackSchema.statics.generateToken = function () {
  return crypto.randomBytes(24).toString('hex');
};

teacherInterviewFeedbackSchema.index({ candidateSource: 1, candidateId: 1 });

module.exports = mongoose.model('TeacherInterviewFeedback', teacherInterviewFeedbackSchema);
