const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema({
  url: { type: String, default: '' },
  publicId: { type: String, default: '' },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
}, { _id: false });

const teacherContractLeadSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: ['public'],
    default: 'public',
  },
  status: {
    type: String,
    enum: ['submitted'],
    default: 'submitted',
  },
  contract: {
    accepted: { type: Boolean, default: false },
    fullName: { type: String, trim: true, default: '' },
    agreedAt: { type: Date, default: null },
  },
  verification: {
    identityDocument: { type: assetSchema, default: () => ({}) },
    educationDocuments: { type: assetSchema, default: () => ({}) },
    profilePhoto: { type: assetSchema, default: () => ({}) },
    introEssay: { type: String, trim: true, default: '' },
  },
  personalInfo: {
    fullName: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    birthDate: { type: Date, default: null },
    mobileNumber: { type: String, trim: true, default: '' },
    whatsappNumber: { type: String, trim: true, default: '' },
    meetingLink: { type: String, trim: true, default: '' },
    skypeId: { type: String, trim: true, default: '' },
    address: {
      street: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      country: { type: String, trim: true, default: 'Egypt' },
    },
    gender: { type: String, trim: true, default: '' },
    nationality: { type: String, trim: true, default: '' },
    occupation: { type: String, trim: true, default: '' },
  },
  submittedMeta: {
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  submittedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('TeacherContractLead', teacherContractLeadSchema);
