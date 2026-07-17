const mongoose = require('mongoose');

const attendanceRecordSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, required: true },
  candidateSource: { type: String, enum: ['lead', 'submission'], required: true },
  attended: { type: Boolean, default: false },
  grade: {
    type: String,
    enum: ['not_graded', 'weak', 'good', 'very_good', 'excellent'],
    default: 'not_graded',
  },
  trainerNotes: { type: String, trim: true, default: '', maxlength: 2000 },
}, { _id: false });

const sessionSchema = new mongoose.Schema({
  sessionNumber: { type: Number, required: true, min: 1 },
  title: { type: String, trim: true, default: '', maxlength: 200 },
  scheduledAt: { type: Date, default: null },
  durationMinutes: { type: Number, default: 60, min: 15, max: 480 },
  meetingLink: { type: String, trim: true, default: '', maxlength: 500 },
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'cancelled'],
    default: 'scheduled',
  },
  attendance: [attendanceRecordSchema],
  trainerNotes: { type: String, trim: true, default: '', maxlength: 4000 },
  materials: [{ type: String, trim: true, maxlength: 500 }],
});

const candidateRefSchema = new mongoose.Schema({
  candidateId: { type: mongoose.Schema.Types.ObjectId, required: true },
  candidateSource: { type: String, enum: ['lead', 'submission'], required: true },
  // Snapshot for display without extra DB lookups
  displayName: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, default: '' },
  // Pass/fail decision at end of training
  outcome: {
    type: String,
    enum: ['pending', 'passed', 'failed', 'dropped'],
    default: 'pending',
  },
  outcomeNotes: { type: String, trim: true, default: '', maxlength: 2000 },
  convertedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: false });

const trainingBatchSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  status: {
    type: String,
    enum: ['draft', 'active', 'completed', 'cancelled'],
    default: 'draft',
  },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentCampaign', default: null },
  // How many sessions are planned (typically 6)
  totalSessions: { type: Number, default: 6, min: 1, max: 30 },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  trainerNotes: { type: String, trim: true, default: '', maxlength: 4000 },
  candidates: [candidateRefSchema],
  sessions: [sessionSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, {
  timestamps: true,
});

trainingBatchSchema.index({ status: 1 });
trainingBatchSchema.index({ createdAt: -1 });
trainingBatchSchema.index({ campaignId: 1 });

module.exports = mongoose.model('TrainingBatch', trainingBatchSchema);
