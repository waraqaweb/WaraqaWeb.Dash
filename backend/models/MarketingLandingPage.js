const mongoose = require('mongoose');

const ctaSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    href: { type: String, trim: true }
  },
  { _id: false }
);

const sectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    enabled: { type: Boolean, default: true },
    layout: { type: String, default: 'full' },
    theme: { type: String, default: 'light' },
    dataSource: { type: String, default: 'custom' },
    dataFilters: { type: mongoose.Schema.Types.Mixed, default: {} },
    limit: { type: Number, default: 0 },
    settings: {
      heroCopySource: { type: String, trim: true, enum: ['site', 'custom'], default: 'site' },
      kicker: { type: String, trim: true },
      headline: { type: String, trim: true },
      subheading: { type: String, trim: true },
      media: { type: String, trim: true },
      backgroundMedia: { type: String, trim: true },
      backgroundOpacity: { type: Number, default: 0.22, min: 0, max: 1 },
      boxMedia: { type: String, trim: true },
      boxOpacity: { type: Number, default: 0.9, min: 0, max: 1 },
      textVariant: { type: String, trim: true, default: 'auto' },
      fontFamily: { type: String, trim: true, default: 'sans' },
      kickerColor: { type: String, trim: true },
      headlineColor: { type: String, trim: true },
      subheadingColor: { type: String, trim: true },
      kickerSize: { type: Number, min: 10, max: 20, default: 14 },
      headlineSize: { type: Number, min: 28, max: 80, default: 48 },
      subheadingSize: { type: Number, min: 14, max: 32, default: 18 },
      headingSpacing: { type: Number, min: 0, max: 80, default: 24 },
      subheadingSpacing: { type: Number, min: 0, max: 64, default: 24 },
      ctaSpacing: { type: Number, min: 12, max: 64, default: 32 },
      heroMaxWidth: { type: Number, min: 48, max: 120, default: 72 },
      verticalPadding: { type: Number, min: 2, max: 12, default: 4 },
      gridGap: { type: Number, min: 1, max: 6, default: 2.5 },
      contentWidthRatio: { type: Number, min: 0.3, max: 0.7, default: 0.55 },
      contentAlignment: { type: String, trim: true, default: 'left' },
      primaryCta: ctaSchema,
      secondaryCta: ctaSchema
    }
  },
  { _id: false }
);

const landingPageSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    description: { type: String, trim: true },
    heroVariant: { type: String, default: 'hero-a' },
    status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true },
    sections: { type: [sectionSchema], default: [] },
    lastPublishedAt: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revisions: [
      {
        snapshot: { type: mongoose.Schema.Types.Mixed },
        updatedAt: { type: Date, default: Date.now },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
      }
    ]
  },
  { timestamps: true }
);

landingPageSchema.index({ slug: 1, status: 1 });

module.exports = mongoose.model('MarketingLandingPage', landingPageSchema);
