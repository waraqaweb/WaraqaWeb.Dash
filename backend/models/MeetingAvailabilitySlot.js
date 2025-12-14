/**
 * MeetingAvailabilitySlot Model
 *
 * Stores admin-managed availability blocks for the different meeting types
 * (new student evaluations, guardian follow-ups, teacher syncs).
 */

const mongoose = require('mongoose');
const { MEETING_TYPES } = require('../constants/meetingConstants');

const meetingAvailabilitySlotSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  meetingType: {
    type: String,
    enum: Object.values(MEETING_TYPES),
    required: true,
    index: true
  },
  dayOfWeek: {
    type: Number,
    min: 0,
    max: 6,
    required: true,
    index: true
  },
  startTime: {
    type: String,
    required: true,
    match: /^([0-1]?\d|2[0-3]):[0-5]\d$/
  },
  endTime: {
    type: String,
    required: true,
    match: /^([0-1]?\d|2[0-3]):[0-5]\d$/
  },
  timezone: {
    type: String,
    default: 'Africa/Cairo',
    validate: {
      validator: (value) => {
        if (!value) return false;
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
          return true;
        } catch (err) {
          return false;
        }
      },
      message: 'Invalid timezone'
    }
  },
  // Optional custom label or description to help admins organize slots
  label: {
    type: String,
    trim: true,
    maxlength: 120
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  capacity: {
    type: Number,
    default: 1,
    min: 1,
    max: 5
  },
  effectiveFrom: {
    type: Date,
    default: Date.now
  },
  effectiveTo: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 5
  },
  slotContext: {
    type: String,
    enum: ['evaluation', 'seminar', 'internal'],
    default: 'evaluation',
    index: true
  },
  visibility: {
    type: String,
    enum: ['internal', 'public'],
    default: 'internal'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

meetingAvailabilitySlotSchema.index({ adminId: 1, meetingType: 1, dayOfWeek: 1, startTime: 1 });
meetingAvailabilitySlotSchema.index({ meetingType: 1, dayOfWeek: 1, isActive: 1 });

meetingAvailabilitySlotSchema.virtual('durationMinutes').get(function getDurationMinutes() {
  const [startHour, startMinute] = this.startTime.split(':').map(Number);
  const [endHour, endMinute] = this.endTime.split(':').map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  return endTotal - startTotal;
});

meetingAvailabilitySlotSchema.methods.hasConflict = function hasConflict(startTime, endTime) {
  const toMinutes = (value) => {
    const [hour, minute] = String(value || '00:00').split(':').map(Number);
    return hour * 60 + minute;
  };
  const slotStart = toMinutes(this.startTime);
  const slotEnd = toMinutes(this.endTime);
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  return !(slotEnd <= start || slotStart >= end);
};

meetingAvailabilitySlotSchema.statics.findActiveByType = function findActiveByType(adminId, meetingType) {
  return this.find({
    adminId,
    meetingType,
    isActive: true,
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gte: new Date() } }
    ]
  }).sort({ dayOfWeek: 1, startTime: 1 });
};

meetingAvailabilitySlotSchema.pre('save', function validateEndAfterStart(next) {
  const [startHour, startMinute] = this.startTime.split(':').map(Number);
  const [endHour, endMinute] = this.endTime.split(':').map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  if (endTotal <= startTotal) {
    return next(new Error('End time must be after start time'));
  }
  return next();
});

module.exports = mongoose.model('MeetingAvailabilitySlot', meetingAvailabilitySlotSchema);
