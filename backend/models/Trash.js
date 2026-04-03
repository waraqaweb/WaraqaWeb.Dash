const mongoose = require('mongoose');

const TrashSchema = new mongoose.Schema({
  itemType: {
    type: String,
    required: true,
    enum: ['invoice', 'class', 'teacher_invoice'],
    index: true,
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  label: { type: String, default: '' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// MongoDB TTL index: auto-purge documents when expiresAt passes
TrashSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Trash', TrashSchema);
