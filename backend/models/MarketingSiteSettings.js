const mongoose = require('mongoose');

const socialLinkSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    url: { type: String, trim: true },
    icon: { type: String, trim: true }
  },
  { _id: false }
);

const ctaSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    href: { type: String, trim: true },
    description: { type: String, trim: true },
    style: { type: String, trim: true }
  },
  { _id: false }
);

const seoDefaultsSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    image: { type: String, trim: true },
    twitterHandle: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true }
  },
  { _id: false }
);

const heroBlockSchema = new mongoose.Schema(
  {
    eyebrow: { type: String, trim: true },
    headline: { type: String, trim: true },
    subheading: { type: String, trim: true },
    media: { type: String, trim: true },
    backgroundMedia: { type: String, trim: true },
    mediaMode: { type: String, trim: true, enum: ['card', 'background'], default: 'card' },
    ctas: [ctaSchema]
  },
  { _id: false }
);

const marketingSiteSettingsSchema = new mongoose.Schema(
  {
    hero: heroBlockSchema,
    primaryNavigation: [
      {
        label: { type: String, trim: true },
        href: { type: String, trim: true }
      }
    ],
    secondaryNavigation: [
      {
        label: { type: String, trim: true },
        href: { type: String, trim: true }
      }
    ],
    contactInfo: {
      email: { type: String, trim: true },
      phone: { type: String, trim: true },
      address: { type: String, trim: true },
      officeHours: { type: String, trim: true }
    },
    socialLinks: [socialLinkSchema],
    seoDefaults: seoDefaultsSchema,
    structuredData: {
      organization: { type: Boolean, default: true },
      courses: { type: Boolean, default: true },
      reviews: { type: Boolean, default: true }
    },
    assetLibrary: {
      logoLight: { type: String, trim: true },
      logoDark: { type: String, trim: true },
      favicon: { type: String, trim: true }
    },
    announcement: {
      message: { type: String, trim: true },
      href: { type: String, trim: true },
      active: { type: Boolean, default: false }
    },
    lastPublishedAt: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('MarketingSiteSettings', marketingSiteSettingsSchema);
