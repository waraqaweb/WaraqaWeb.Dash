/**
 * Meeting Model - represents scheduled evaluation/follow-up/sync meetings.
 */

const mongoose = require('mongoose');
const { MEETING_TYPES, MEETING_STATUSES, MEETING_SOURCES } = require('../constants/meetingConstants');

const participantStudentSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId
  },
  guardianSubdocumentId: {
    type: String
  },
  studentName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  isExistingStudent: {
    type: Boolean,
    default: false
  },
  isGuardianSelf: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 500
  }
}, { _id: false });

const evaluationStudentReportSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId
  },
  studentName: {
    type: String,
    trim: true,
    required: true
  },
  curricula: [
    {
      type: String,
      trim: true,
      maxlength: 120
    }
  ],
  studyPlan: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  learningPreferences: {
    type: String,
    trim: true,
    maxlength: 1000
  }
}, { _id: false });

const guardianFollowUpReportSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId
  },
  studentName: {
    type: String,
    trim: true,
    required: true
  },
  currentLevel: {
    type: String,
    trim: true,
    maxlength: 500
  },
  assessmentNotes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  nextPlan: {
    type: String,
    trim: true,
    maxlength: 1000
  }
}, { _id: false });

const teacherSyncStudentReportSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId
  },
  studentName: {
    type: String,
    trim: true,
    required: true
  },
  currentLevelNotes: {
    type: String,
    trim: true,
    maxlength: 800
  },
  futurePlan: {
    type: String,
    trim: true,
    maxlength: 800
  }
}, { _id: false });

const meetingReportSchema = new mongoose.Schema({
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  submittedAt: {
    type: Date
  },
  visibility: {
    admin: { type: Boolean, default: true },
    guardians: { type: Boolean, default: false },
    teachers: { type: Boolean, default: false }
  },
  evaluation: {
    students: [evaluationStudentReportSchema]
  },
  guardianFollowUp: guardianFollowUpReportSchema,
  teacherSync: {
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    teacherName: { type: String, trim: true },
    students: [teacherSyncStudentReportSchema]
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 2000
  }
}, { _id: false });

const meetingSchema = new mongoose.Schema({
  meetingType: {
    type: String,
    enum: Object.values(MEETING_TYPES),
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: Object.values(MEETING_STATUSES),
    default: MEETING_STATUSES.SCHEDULED,
    index: true
  },
  scheduledStart: {
    type: Date,
    required: true,
    index: true
  },
  scheduledEnd: {
    type: Date,
    required: true
  },
  durationMinutes: {
    type: Number,
    required: true,
    min: 15,
    max: 240
  },
  timezone: {
    type: String,
    default: 'Africa/Cairo'
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  guardianId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  bookingSource: {
    type: String,
    enum: Object.values(MEETING_SOURCES),
    default: MEETING_SOURCES.ADMIN
  },
  bookingPayload: {
    guardianName: { type: String, trim: true },
    guardianEmail: { type: String, trim: true, lowercase: true },
    guardianPhone: { type: String, trim: true },
    timezone: { type: String, trim: true },
    students: [participantStudentSchema],
    notes: { type: String, trim: true, maxlength: 2000 }
  },
  attendees: {
    teacherName: { type: String, trim: true },
    guardianName: { type: String, trim: true },
    additionalEmails: [{ type: String, trim: true, lowercase: true }]
  },
  meetingLinkSnapshot: {
    type: String,
    trim: true
  },
  calendar: {
    icsUid: { type: String, trim: true },
    googleCalendarLink: { type: String, trim: true },
    outlookCalendarLink: { type: String, trim: true }
  },
  quotaKeys: {
    monthKey: { type: String, trim: true, index: true },
    guardianMonthKey: { type: String, trim: true },
    teacherMonthKey: { type: String, trim: true }
  },
  buffers: {
    beforeMinutes: { type: Number, default: 5 },
    afterMinutes: { type: Number, default: 5 }
  },
  report: meetingReportSchema,
  reminders: {
    lastSentAt: { type: Date },
    followUpSentAt: { type: Date }
  },
  cancellation: {
    reason: { type: String, trim: true },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: { type: Date }
  },
  visibility: {
    showInCalendar: { type: Boolean, default: true },
    displayColor: { type: String, default: '#FEF9C3' }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

meetingSchema.index({ meetingType: 1, scheduledStart: 1 });
meetingSchema.index({ guardianId: 1, 'quotaKeys.monthKey': 1 });
meetingSchema.index({ teacherId: 1, 'quotaKeys.monthKey': 1 });

meetingSchema.pre('validate', function ensureDuration(next) {
  if (this.scheduledStart && this.scheduledEnd) {
    const diffMinutes = Math.round((this.scheduledEnd - this.scheduledStart) / 60000);
    this.durationMinutes = diffMinutes;
  } else if (this.scheduledStart && this.durationMinutes && !this.scheduledEnd) {
    this.scheduledEnd = new Date(this.scheduledStart.getTime() + this.durationMinutes * 60000);
  }
  if (this.durationMinutes <= 0) {
    return next(new Error('Meeting duration must be positive'));
  }
  return next();
});

meetingSchema.methods.isEvaluation = function isEvaluation() {
  return this.meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION;
};

meetingSchema.methods.isGuardianFollowUp = function isGuardianFollowUp() {
  return this.meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP;
};

meetingSchema.methods.isTeacherSync = function isTeacherSync() {
  return this.meetingType === MEETING_TYPES.TEACHER_SYNC;
};

module.exports = mongoose.model('Meeting', meetingSchema);
