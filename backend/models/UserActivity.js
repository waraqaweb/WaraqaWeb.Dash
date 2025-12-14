const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // date only (normalized to midnight UTC)
  date: {
    type: Date,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Ensure one record per user per day
userActivitySchema.index({ user: 1, date: 1 }, { unique: true });

/**
 * Record a user's dashboard visit for today (idempotent)
 * @param {String|ObjectId} userId
 */
userActivitySchema.statics.recordVisit = async function (userId) {
  if (!userId) return null;
  try {
    // Normalize to UTC midnight for date-only grouping
    const day = new Date();
    const utcMidnight = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const doc = { user: userId, date: utcMidnight };
    // Upsert with no-op when exists
    await this.updateOne({ user: userId, date: utcMidnight }, { $setOnInsert: doc }, { upsert: true }).exec();
    return true;
  } catch (e) {
    // ignore duplicate key or other transient errors
    return false;
  }
};

module.exports = mongoose.model('UserActivity', userActivitySchema);
