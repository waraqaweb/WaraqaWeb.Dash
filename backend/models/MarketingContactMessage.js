const mongoose = require('mongoose');

const marketingContactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    message: { type: String, required: true, trim: true },
    source: { type: String, trim: true },
    meta: { type: Map, of: String },
    handled: { type: Boolean, default: false },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handledAt: { type: Date }
  },
  {
    timestamps: true
  }
);

marketingContactMessageSchema.index({ createdAt: -1 });

module.exports = mongoose.model('MarketingContactMessage', marketingContactMessageSchema);
