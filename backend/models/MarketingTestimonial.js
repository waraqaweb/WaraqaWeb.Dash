const mongoose = require('mongoose');

const publishWindowSchema = new mongoose.Schema(
  {
    start: { type: Date },
    end: { type: Date }
  },
  { _id: false }
);

const marketingTestimonialSchema = new mongoose.Schema(
  {
    guardianName: { type: String, trim: true },
    guardianRelation: { type: String, trim: true },
    quote: { type: String, required: true, trim: true },
    rating: { type: Number, min: 1, max: 5, default: 5 },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketingCourse' },
    studentName: { type: String, trim: true },
    locale: { type: String, trim: true, default: 'en' },
    showOnHomepage: { type: Boolean, default: false },
    publishWindow: publishWindowSchema,
    published: { type: Boolean, default: false, index: true },
    featured: { type: Boolean, default: false },
    sourceFeedback: { type: mongoose.Schema.Types.ObjectId, ref: 'Feedback' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

marketingTestimonialSchema.index({ published: 1, locale: 1, featured: 1 });

module.exports = mongoose.model('MarketingTestimonial', marketingTestimonialSchema);
