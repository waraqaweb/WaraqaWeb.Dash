const mongoose = require('mongoose');

const DashboardCacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  data: { type: mongoose.Schema.Types.Mixed },
  computedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('DashboardCache', DashboardCacheSchema);
