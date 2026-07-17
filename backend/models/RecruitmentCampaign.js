const mongoose = require('mongoose');

const recruitmentCampaignSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 180,
  },
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    maxlength: 80,
    match: /^[a-z0-9-]+$/,
  },
  status: {
    type: String,
    enum: ['draft', 'open', 'closed', 'archived'],
    default: 'draft',
    index: true,
  },
  opensAt: { type: Date, default: null },
  closesAt: { type: Date, default: null },
  targetApplicants: { type: Number, default: 0, min: 0 },
  targetHires: { type: Number, default: 0, min: 0 },
  roles: {
    male: { type: Boolean, default: false },
    female: { type: Boolean, default: false },
  },
  subjects: [{ type: String, trim: true, maxlength: 120 }],
  preferredWindow: { type: String, trim: true, default: '', maxlength: 240 },
  publicHeadline: { type: String, trim: true, default: '', maxlength: 180 },
  publicDescription: { type: String, trim: true, default: '', maxlength: 4000 },
  internalNotes: { type: String, trim: true, default: '', maxlength: 4000 },
  reopenLimit: { type: Number, default: 0, min: 0 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

recruitmentCampaignSchema.index({ status: 1, opensAt: 1, closesAt: 1 });

module.exports = mongoose.model('RecruitmentCampaign', recruitmentCampaignSchema);