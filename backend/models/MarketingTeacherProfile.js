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

const achievementSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    year: { type: String, trim: true },
    description: { type: String, trim: true }
  },
  { _id: false }
);

const marketingTeacherProfileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    role: { type: String, trim: true },
    bio: { type: String, trim: true },
    credentials: [{ type: String, trim: true }],
    additionalCertificates: [{ type: String, trim: true }],
    education: [{ type: String, trim: true }],
    yearsExperience: { type: Number, min: 0 },
    languages: [{ type: String, trim: true }],
    teachesCourses: [{ type: String, trim: true }],
    gender: { type: String, trim: true },
    country: { type: String, trim: true },
    avatar: { type: String, trim: true },
    gallery: [{ type: String, trim: true }],
    availabilitySummary: { type: String, trim: true },
    quote: { type: String, trim: true },
    achievements: [achievementSchema],
    featuredCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCourse' }],
    published: { type: Boolean, default: false, index: true },
    seo: seoSchema,
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('MarketingTeacherProfile', marketingTeacherProfileSchema);
