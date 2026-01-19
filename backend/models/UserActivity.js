const mongoose = require('mongoose');

const userActivitySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  deviceId: {
    type: String,
    index: true,
    default: null
  },
  auth: {
    isImpersonated: { type: Boolean, default: false },
    impersonatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isAdmin: { type: Boolean, default: false }
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
userActivitySchema.index({ deviceId: 1, date: 1 });

/**
 * Record a user's dashboard visit for today (idempotent)
 * @param {String|ObjectId} userId
 */
userActivitySchema.statics.recordVisit = async function (userId, options = {}) {
  if (!userId) return null;
  try {
    // Normalize to UTC midnight for date-only grouping
    const day = new Date();
    const utcMidnight = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const deviceId = options?.deviceId || null;
    const auth = options?.auth || null;
    const doc = { user: userId, date: utcMidnight, deviceId: deviceId || null };
    const update = { $setOnInsert: doc };
    const setPatch = {};
    if (deviceId) setPatch.deviceId = deviceId;
    if (auth && typeof auth === 'object') {
      if (typeof auth.isImpersonated === 'boolean') setPatch['auth.isImpersonated'] = auth.isImpersonated;
      if (auth.impersonatedBy) setPatch['auth.impersonatedBy'] = auth.impersonatedBy;
      if (typeof auth.isAdmin === 'boolean') setPatch['auth.isAdmin'] = auth.isAdmin;
    }
    if (Object.keys(setPatch).length) {
      update.$set = setPatch;
    }
    // Upsert with no-op when exists
    await this.updateOne({ user: userId, date: utcMidnight }, update, { upsert: true }).exec();
    return true;
  } catch (e) {
    // ignore duplicate key or other transient errors
    return false;
  }
};

module.exports = mongoose.model('UserActivity', userActivitySchema);
