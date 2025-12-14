const mongoose = require('mongoose');

const priceSchema = new mongoose.Schema(
  {
    amount: { type: Number, min: 0, required: true },
    currency: { type: String, default: 'USD' },
    cadence: { type: String, default: 'monthly' }
  },
  { _id: false }
);

const marketingPricingPlanSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    headline: { type: String, required: true, trim: true },
    subheading: { type: String, trim: true },
    price: priceSchema,
    features: [{ type: String, trim: true }],
    audienceTag: { type: String, trim: true },
    highlight: { type: Boolean, default: false },
    trialInfo: { type: String, trim: true },
    depositInfo: { type: String, trim: true },
    ctaLabel: { type: String, trim: true },
    ctaHref: { type: String, trim: true },
    published: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

marketingPricingPlanSchema.index({ published: 1, sortOrder: 1 });

module.exports = mongoose.model('MarketingPricingPlan', marketingPricingPlanSchema);
