/**
 * UnavailablePeriod Model - Manages temporary teacher unavailability
 * 
 * This model handles temporary overrides to teacher availability,
 * such as sick days, vacations, or personal time off.
 */

const mongoose = require('mongoose');

const unavailablePeriodSchema = new mongoose.Schema({
  // Teacher reference
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Optional reference to originating vacation
  vacationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vacation',
    index: true
  },
  
  // Time period (specific date/time range)
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
  
  // Reason for unavailability
  reason: {
    type: String,
    enum: ['vacation', 'sick', 'personal', 'emergency', 'system_maintenance'],
    default: 'personal'
  },
  
  // Optional description
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  
  // Whether this affects existing scheduled classes
  affectsScheduledClasses: {
    type: Boolean,
    default: true
  },
  
  // Status for approval workflow (if needed)
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'
  },
  
  // Who approved this unavailability
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Auto-calculated field for quick queries
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for efficient querying
unavailablePeriodSchema.index({ teacherId: 1, startDateTime: 1, endDateTime: 1 });
unavailablePeriodSchema.index({ startDateTime: 1, endDateTime: 1 });
unavailablePeriodSchema.index({ teacherId: 1, vacationId: 1 });

// Virtual to check if period is currently active
unavailablePeriodSchema.virtual('isCurrentlyActive').get(function() {
  const now = new Date();
  return this.startDateTime <= now && this.endDateTime >= now && this.isActive;
});

// Virtual for duration in hours
unavailablePeriodSchema.virtual('durationHours').get(function() {
  return (this.endDateTime - this.startDateTime) / (1000 * 60 * 60);
});

// Static method to find active periods for a teacher
unavailablePeriodSchema.statics.findActiveByTeacher = function(teacherId, dateRange = null) {
  const query = {
    teacherId,
    isActive: true,
    status: 'approved'
  };
  
  if (dateRange) {
    query.$or = [
      // Period starts within range
      { startDateTime: { $gte: dateRange.start, $lte: dateRange.end } },
      // Period ends within range
      { endDateTime: { $gte: dateRange.start, $lte: dateRange.end } },
      // Period encompasses entire range
      { startDateTime: { $lte: dateRange.start }, endDateTime: { $gte: dateRange.end } }
    ];
  }
  
  return this.find(query).sort({ startDateTime: 1 });
};

// Static method to check if a specific time conflicts with unavailable periods
unavailablePeriodSchema.statics.hasConflictForTeacher = function(teacherId, startDateTime, endDateTime) {
  return this.findOne({
    teacherId,
    isActive: true,
    status: 'approved',
    $or: [
      // Period starts before requested time and ends after start
      { startDateTime: { $lte: startDateTime }, endDateTime: { $gt: startDateTime } },
      // Period starts before requested end and ends after end
      { startDateTime: { $lt: endDateTime }, endDateTime: { $gte: endDateTime } },
      // Period is completely within requested time
      { startDateTime: { $gte: startDateTime }, endDateTime: { $lte: endDateTime } }
    ]
  });
};

// Method to check if this period conflicts with a given time range
unavailablePeriodSchema.methods.conflictsWith = function(startDateTime, endDateTime) {
  return !(this.endDateTime <= startDateTime || this.startDateTime >= endDateTime);
};

// Pre-save validation
unavailablePeriodSchema.pre('save', function(next) {
  if (this.endDateTime <= this.startDateTime) {
    return next(new Error('End date/time must be after start date/time'));
  }
  
  // Auto-deactivate if period is in the past
  const now = new Date();
  if (this.endDateTime < now) {
    this.isActive = false;
  }
  
  next();
});

// Cleanup expired periods (static method)
unavailablePeriodSchema.statics.cleanupExpired = function() {
  const now = new Date();
  return this.updateMany(
    { endDateTime: { $lt: now }, isActive: true },
    { isActive: false }
  );
};

module.exports = mongoose.model('UnavailablePeriod', unavailablePeriodSchema);