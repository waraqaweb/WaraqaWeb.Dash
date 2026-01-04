/**
 * MeetingUnavailablePeriod Model
 *
 * Temporary admin time-off windows that override meeting availability.
 * These are used only for meetings (evaluations / follow-ups / teacher syncs).
 */

const mongoose = require('mongoose');

const meetingUnavailablePeriodSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  startDateTime: {
    type: Date,
    required: true,
    index: true
  },

  endDateTime: {
    type: Date,
    required: true,
    index: true
  },

  timezone: {
    type: String,
    default: 'UTC'
  },

  description: {
    type: String,
    trim: true,
    maxlength: 500
  },

  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

meetingUnavailablePeriodSchema.index({ adminId: 1, startDateTime: 1, endDateTime: 1 });

meetingUnavailablePeriodSchema.pre('save', function preSave(next) {
  if (this.endDateTime <= this.startDateTime) {
    return next(new Error('End date/time must be after start date/time'));
  }
  return next();
});

module.exports = mongoose.model('MeetingUnavailablePeriod', meetingUnavailablePeriodSchema);
