const mongoose = require('mongoose');

const seoSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    image: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true },
    noindex: { type: Boolean, default: false },
    jsonLdType: { type: String, trim: true }
  },
  { _id: false }
);

const curriculumItemSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    order: { type: Number, default: 0 }
  },
  { _id: false }
);

const articleSectionSchema = new mongoose.Schema(
  {
    kicker: { type: String, trim: true },
    heading: { type: String, trim: true },
    body: { type: String, trim: true },
    media: { type: String, trim: true },
    align: { type: String, enum: ['left', 'right'], default: 'right' },
    accent: { type: String, trim: true, default: 'emerald' },
    order: { type: Number, default: 0 }
  },
  { _id: false }
);

const marketingCourseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    excerpt: { type: String, trim: true, maxlength: 400 },
    level: {
      type: String,
      enum: ['beginner', 'intermediate', 'advanced', 'mixed'],
      default: 'mixed'
    },
    tracks: [{ type: String, trim: true }],
    tags: [{ type: String, trim: true }],
    outcomes: [{ type: String, trim: true }],
    curriculum: [curriculumItemSchema],
    durationWeeks: { type: Number, min: 0 },
    lessonsPerWeek: { type: Number, min: 0 },
    scheduleOption: { type: String, trim: true },
    pricingPlan: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingPricingPlan' },
    heroMedia: { type: String, trim: true },
    badge: { type: String, trim: true },
    featured: { type: Boolean, default: false },
    articleIntro: { type: String, trim: true },
    articleSections: [articleSectionSchema],
    published: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
    seo: seoSchema,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revisions: [
      {
        snapshot: { type: mongoose.Schema.Types.Mixed },
        updatedAt: { type: Date, default: Date.now },
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
      }
    ]
  },
  {
    timestamps: true
  }
);

marketingCourseSchema.index({ published: 1, sortOrder: 1 });
marketingCourseSchema.index({ tags: 1, published: 1 });

module.exports = mongoose.model('MarketingCourse', marketingCourseSchema);
