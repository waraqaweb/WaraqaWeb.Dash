/**
 * AvailabilitySlot Model - Manages teacher availability schedules
 * 
 * This model stores teacher availability slots for scheduling classes.
 * Each slot represents a time period when a teacher is available to teach.
 */

const mongoose = require('mongoose');

const availabilitySlotSchema = new mongoose.Schema({
  // Teacher reference
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  dayOfWeek: {
    type: Number,
    required: true,
    min: 0,
    max: 6,
    index: true
  },
  
  // Time slots in UTC (24-hour format)
  startTime: {
    type: String,
    required: true,
    match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
    index: true
  },
  
  endTime: {
    type: String,
    required: true,
    match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
    index: true
  },
  
  // Teacher's preferred timezone for display purposes
  timezone: {
    type: String,
    default: "Africa/Cairo",
    validate: {
      validator: function(v) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: v });
          return true;
        } catch (error) {
          return false;
        }
      },
      message: 'Invalid timezone'
    }
  },
  
  // Whether this is a recurring weekly slot
  isRecurring: {
    type: Boolean,
    default: true
  },
  
  // Effective date range for temporary schedules
  effectiveFrom: {
    type: Date,
    default: Date.now
  },
  
  effectiveTo: {
    type: Date,
    default: null // null means permanent
  },
  
  // Status for soft deletion
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
availabilitySlotSchema.index({ teacherId: 1, dayOfWeek: 1, startTime: 1, endTime: 1 });
availabilitySlotSchema.index({ teacherId: 1, isActive: 1 });
availabilitySlotSchema.index({ dayOfWeek: 1, startTime: 1, endTime: 1 });

// Virtual to check if slot is currently effective
availabilitySlotSchema.virtual('isCurrentlyEffective').get(function() {
  const now = new Date();
  return this.effectiveFrom <= now && (this.effectiveTo === null || this.effectiveTo >= now);
});

// Virtual for duration in minutes
availabilitySlotSchema.virtual('durationMinutes').get(function() {
  const [startHour, startMin] = this.startTime.split(':').map(Number);
  const [endHour, endMin] = this.endTime.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  return endMinutes - startMinutes;
});

// Static method to find active slots for a teacher
availabilitySlotSchema.statics.findActiveByTeacher = function(teacherId) {
  return this.find({
    teacherId,
    isActive: true,
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gte: new Date() } }
    ]
  }).sort({ dayOfWeek: 1, startTime: 1 });
};

// Static method to find slots for specific day and time
availabilitySlotSchema.statics.findAvailableSlots = function(dayOfWeek, timeRange) {
  const { startTime, endTime } = timeRange;
  
  return this.find({
    dayOfWeek,
    isActive: true,
    startTime: { $lte: startTime },
    endTime: { $gte: endTime },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gte: new Date() } }
    ]
  }).populate('teacherId', 'firstName lastName email teacherInfo');
};

// Method to check if time range conflicts with existing slot
availabilitySlotSchema.methods.hasTimeConflict = function(startTime, endTime) {
  return !(this.endTime <= startTime || this.startTime >= endTime);
};

// Validation: end time must be after start time
availabilitySlotSchema.pre('save', function(next) {
  const [startHour, startMin] = this.startTime.split(':').map(Number);
  const [endHour, endMin] = this.endTime.split(':').map(Number);
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  if (endMinutes <= startMinutes) {
    return next(new Error('End time must be after start time'));
  }
  
  next();
});

function scheduleAvailabilitySlotCalendarSync(doc, mode = 'upsert') {
  if (!doc) return;
  setImmediate(async () => {
    try {
      const availabilitySyncService = require('../services/teacherAvailabilityCalendarSyncService');
      if (!availabilitySyncService.isConfigured()) return;
      await availabilitySyncService.syncAvailabilitySlotEvent({ slotDoc: doc, mode });
    } catch (err) {
      console.warn('[AvailabilitySlot calendar sync] failed:', err && err.message);
    }
  });
}

availabilitySlotSchema.post('save', function(doc) {
  scheduleAvailabilitySlotCalendarSync(doc, 'upsert');
});

availabilitySlotSchema.post('deleteOne', { document: true, query: false }, function(doc) {
  scheduleAvailabilitySlotCalendarSync(doc, 'delete');
});

availabilitySlotSchema.post('findOneAndDelete', function(doc) {
  scheduleAvailabilitySlotCalendarSync(doc, 'delete');
});

availabilitySlotSchema.pre('findOneAndUpdate', async function(next) {
  try {
    this._slotBefore = await this.model.findOne(this.getQuery())
      .select('_id teacherId dayOfWeek startTime endTime timezone isRecurring effectiveFrom effectiveTo isActive')
      .lean();
  } catch (_) {
    this._slotBefore = null;
  }
  next();
});

availabilitySlotSchema.post('findOneAndUpdate', async function() {
  try {
    const before = this._slotBefore;
    if (!before?._id) return;
    const fresh = await this.model.findById(before._id)
      .select('_id teacherId dayOfWeek startTime endTime timezone isRecurring effectiveFrom effectiveTo isActive')
      .lean();
    if (fresh) {
      scheduleAvailabilitySlotCalendarSync(fresh, 'upsert');
    }
  } catch (err) {
    console.warn('[AvailabilitySlot calendar sync] findOneAndUpdate post hook failed:', err && err.message);
  }
});

availabilitySlotSchema.pre('updateMany', async function(next) {
  try {
    const ids = await this.model.find(this.getQuery()).select('_id').lean();
    this._slotSyncIds = ids.map((d) => d._id);
  } catch (_) {
    this._slotSyncIds = [];
  }
  next();
});

availabilitySlotSchema.post('updateMany', async function() {
  try {
    const ids = Array.isArray(this._slotSyncIds) ? this._slotSyncIds : [];
    if (!ids.length) return;
    const docs = await this.model.find({ _id: { $in: ids } })
      .select('_id teacherId dayOfWeek startTime endTime timezone isRecurring effectiveFrom effectiveTo isActive')
      .lean();
    docs.forEach((doc) => scheduleAvailabilitySlotCalendarSync(doc, 'upsert'));
  } catch (err) {
    console.warn('[AvailabilitySlot calendar sync] updateMany post hook failed:', err && err.message);
  }
});

availabilitySlotSchema.pre('deleteMany', async function(next) {
  try {
    this._slotDeleteDocs = await this.model.find(this.getQuery())
      .select('_id teacherId dayOfWeek startTime endTime timezone isRecurring effectiveFrom effectiveTo isActive')
      .lean();
  } catch (_) {
    this._slotDeleteDocs = [];
  }
  next();
});

availabilitySlotSchema.post('deleteMany', function() {
  try {
    const docs = Array.isArray(this._slotDeleteDocs) ? this._slotDeleteDocs : [];
    docs.forEach((doc) => scheduleAvailabilitySlotCalendarSync(doc, 'delete'));
  } catch (err) {
    console.warn('[AvailabilitySlot calendar sync] deleteMany post hook failed:', err && err.message);
  }
});

module.exports = mongoose.model('AvailabilitySlot', availabilitySlotSchema);