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
  // Half-open interval overlap: unavailableStart < requestedEnd AND unavailableEnd > requestedStart
  // This allows a class to start exactly at unavailableEnd, and to end exactly at unavailableStart.
  return this.findOne({
    teacherId,
    isActive: true,
    status: 'approved',
    startDateTime: { $lt: endDateTime },
    endDateTime: { $gt: startDateTime }
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

function scheduleUnavailableCalendarSync(doc, mode = 'upsert') {
  if (!doc) return;
  setImmediate(async () => {
    try {
      const availabilitySyncService = require('../services/teacherAvailabilityCalendarSyncService');
      if (!availabilitySyncService.isConfigured()) return;
      await availabilitySyncService.syncUnavailablePeriodEvent({ periodDoc: doc, mode });
    } catch (err) {
      console.warn('[UnavailablePeriod calendar sync] failed:', err && err.message);
    }
  });
}

unavailablePeriodSchema.post('save', function(doc) {
  scheduleUnavailableCalendarSync(doc, 'upsert');
});

unavailablePeriodSchema.post('deleteOne', { document: true, query: false }, function(doc) {
  scheduleUnavailableCalendarSync(doc, 'delete');
});

unavailablePeriodSchema.post('findOneAndDelete', function(doc) {
  scheduleUnavailableCalendarSync(doc, 'delete');
});

unavailablePeriodSchema.pre('findOneAndUpdate', async function(next) {
  try {
    this._periodBefore = await this.model.findOne(this.getQuery())
      .select('_id teacherId startDateTime endDateTime reason description status isActive')
      .lean();
  } catch (_) {
    this._periodBefore = null;
  }
  next();
});

unavailablePeriodSchema.post('findOneAndUpdate', async function() {
  try {
    const before = this._periodBefore;
    if (!before?._id) return;
    const fresh = await this.model.findById(before._id)
      .select('_id teacherId startDateTime endDateTime reason description status isActive')
      .lean();
    if (fresh) {
      scheduleUnavailableCalendarSync(fresh, 'upsert');
    }
  } catch (err) {
    console.warn('[UnavailablePeriod calendar sync] findOneAndUpdate post hook failed:', err && err.message);
  }
});

unavailablePeriodSchema.pre('updateMany', async function(next) {
  try {
    const ids = await this.model.find(this.getQuery()).select('_id').lean();
    this._periodSyncIds = ids.map((d) => d._id);
  } catch (_) {
    this._periodSyncIds = [];
  }
  next();
});

unavailablePeriodSchema.post('updateMany', async function() {
  try {
    const ids = Array.isArray(this._periodSyncIds) ? this._periodSyncIds : [];
    if (!ids.length) return;
    const docs = await this.model.find({ _id: { $in: ids } })
      .select('_id teacherId startDateTime endDateTime reason description status isActive')
      .lean();
    docs.forEach((doc) => scheduleUnavailableCalendarSync(doc, 'upsert'));
  } catch (err) {
    console.warn('[UnavailablePeriod calendar sync] updateMany post hook failed:', err && err.message);
  }
});

unavailablePeriodSchema.pre('deleteMany', async function(next) {
  try {
    this._periodDeleteDocs = await this.model.find(this.getQuery())
      .select('_id teacherId startDateTime endDateTime reason description status isActive')
      .lean();
  } catch (_) {
    this._periodDeleteDocs = [];
  }
  next();
});

unavailablePeriodSchema.post('deleteMany', function() {
  try {
    const docs = Array.isArray(this._periodDeleteDocs) ? this._periodDeleteDocs : [];
    docs.forEach((doc) => scheduleUnavailableCalendarSync(doc, 'delete'));
  } catch (err) {
    console.warn('[UnavailablePeriod calendar sync] deleteMany post hook failed:', err && err.message);
  }
});

module.exports = mongoose.model('UnavailablePeriod', unavailablePeriodSchema);