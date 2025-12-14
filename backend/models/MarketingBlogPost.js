const mongoose = require('mongoose');

const seoSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    image: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true },
    noindex: { type: Boolean, default: false }
  },
  { _id: false }
);

const revisionSchema = new mongoose.Schema(
  {
    snapshot: { type: mongoose.Schema.Types.Mixed },
    updatedAt: { type: Date, default: Date.now },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
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
    accent: { type: String, trim: true, default: 'rose' },
    order: { type: Number, default: 0 }
  },
  { _id: false }
);

const marketingBlogPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    summary: { type: String, trim: true, maxlength: 500 },
    heroImage: { type: String, trim: true },
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    articleIntro: { type: String, trim: true },
    articleSections: [articleSectionSchema],
    tags: [{ type: String, trim: true }],
    category: { type: String, trim: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    language: { type: String, default: 'en', index: true },
    contentDirection: { type: String, enum: ['ltr', 'rtl'], default: 'ltr' },
    featured: { type: Boolean, default: false, index: true },
    readingTime: { type: Number, min: 1 },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'published'],
      default: 'draft'
    },
    publishedAt: { type: Date },
    scheduledAt: { type: Date },
    seo: seoSchema,
    relatedPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MarketingBlogPost' }],
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revisions: [revisionSchema]
  },
  {
    timestamps: true
  }
);

marketingBlogPostSchema.index({ status: 1, publishedAt: -1 });
marketingBlogPostSchema.index({ tags: 1, status: 1 });

module.exports = mongoose.model('MarketingBlogPost', marketingBlogPostSchema);
