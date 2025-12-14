const mongoose = require('mongoose');

const systemVacationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  timezone: {
    type: String,
    required: true,
    default: 'UTC'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  affectedClasses: {
    type: Number,
    default: 0
  },
  notificationsSent: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for better query performance
systemVacationSchema.index({ startDate: 1, endDate: 1 });
systemVacationSchema.index({ isActive: 1 });

// Virtual to check if vacation is currently active
systemVacationSchema.virtual('isCurrentlyActive').get(function() {
  const now = new Date();
  return this.isActive && this.startDate <= now && this.endDate >= now;
});

// Method to check if a given date falls within this vacation period
systemVacationSchema.methods.includesDate = function(date) {
  return this.isActive && date >= this.startDate && date <= this.endDate;
};

module.exports = mongoose.model('SystemVacation', systemVacationSchema);