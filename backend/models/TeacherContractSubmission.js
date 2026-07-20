const mongoose = require('mongoose');

const assetSchema = new mongoose.Schema({
  url: { type: String, default: '' },
  publicId: { type: String, default: '' },
  originalName: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
}, { _id: false });

const recruitmentRatingValues = ['not_available', 'weak', 'good', 'very_good', 'excellent'];
const recruitmentStatusValues = ['new', 'under_review', 'shortlisted', 'interview_pending', 'interviewed', 'accepted', 'rejected', 'archived'];

const recruitmentSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: recruitmentStatusValues,
    default: 'new',
  },
  reviewed: { type: Boolean, default: false },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  adminNotes: { type: String, trim: true, default: '', maxlength: 4000 },
  rejectionCategory: { type: String, trim: true, default: '', maxlength: 120 },
  tags: [{ type: String, trim: true, maxlength: 80 }],
  fit: {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentCampaign', default: null },
    subjects: [{ type: String, trim: true, maxlength: 120 }],
    genderRequirement: { type: String, trim: true, default: '', maxlength: 40 },
    preferredWindow: { type: String, trim: true, default: '', maxlength: 200 },
    timezoneNotes: { type: String, trim: true, default: '', maxlength: 500 },
    requiredHoursPerDay: { type: Number, default: null, min: 0, max: 24 },
  },
  evaluation: {
    english: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    quran: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    arabic: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    islamicStudies: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    readingBasics: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    teachingDemo: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    communication: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    punctuality: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    professionalism: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
    flexibility: { type: String, enum: recruitmentRatingValues, default: 'not_available' },
  },
  overall: {
    score: { type: Number, default: null, min: 0, max: 100 },
    label: { type: String, trim: true, default: '', maxlength: 40 },
    recommendation: { type: String, trim: true, default: '', maxlength: 40 },
  },
  interview: {
    scheduledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    worksElsewhere: { type: Boolean, default: false },
    scores: {
      punctuality: { type: Number, default: null, min: 0, max: 10 },
      english: { type: Number, default: null, min: 0, max: 10 },
      subjectKnowledge: { type: Number, default: null, min: 0, max: 10 },
      teaching: { type: Number, default: null, min: 0, max: 10 },
      flexibility: { type: Number, default: null, min: 0, max: 10 },
      professionalism: { type: Number, default: null, min: 0, max: 10 },
    },
    outcome: {
      type: String,
      enum: ['pending', 'passed', 'passed_not_selected', 'completed_unsuitable', 'failed'],
      default: 'pending',
    },
    notes: { type: String, trim: true, default: '', maxlength: 2000 },
    // Which outcome value we've already emailed the candidate about (so the
    // "send all pending" queue can drop already-notified candidates).
    emailSentForOutcome: { type: String, trim: true, default: '', maxlength: 40 },
    outcomeEmailSentAt: { type: Date, default: null },
  },
  // Post-interview contract acceptance. The token backs a public accept link the
  // admin sends to a candidate after they pass the interview.
  contract: {
    token: { type: String, trim: true, default: '', index: true },
    sentAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    acceptedName: { type: String, trim: true, default: '', maxlength: 200 },
    acceptedIp: { type: String, trim: true, default: '', maxlength: 60 },
    // Recorded manually by an admin when a candidate says they no longer
    // wish to continue after being accepted (no public self-service flow).
    declinedAt: { type: Date, default: null },
    declineNote: { type: String, trim: true, default: '', maxlength: 1000 },
  },
  history: [{
    at: { type: Date, default: Date.now },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    action: { type: String, trim: true, default: 'review_updated', maxlength: 120 },
    fromStatus: { type: String, trim: true, default: '', maxlength: 40 },
    toStatus: { type: String, trim: true, default: '', maxlength: 40 },
    note: { type: String, trim: true, default: '', maxlength: 1000 },
  }],
}, { _id: false });

const teacherApplicationSchema = new mongoose.Schema({
  positionsInterested: [{ type: String, trim: true, maxlength: 120 }],
  education: {
    eligibilityPath: { type: String, trim: true, default: '', maxlength: 120 },
    graduationStatus: { type: String, trim: true, default: '', maxlength: 120 },
    facultyUniversity: { type: String, trim: true, default: '', maxlength: 240 },
    degree: { type: String, trim: true, default: '', maxlength: 180 },
    additionalCertificates: { type: String, trim: true, default: '', maxlength: 3000 },
  },
  experience: {
    teachingExperienceLevel: { type: String, trim: true, default: '', maxlength: 120 },
    currentJob: { type: String, trim: true, default: '', maxlength: 240 },
    profileSummary: { type: String, trim: true, default: '', maxlength: 4000 },
    specialRequests: { type: String, trim: true, default: '', maxlength: 2000 },
  },
  technicalSkills: {
    classTools: { type: String, trim: true, default: '', maxlength: 500 },
    meetingApps: [{ type: String, trim: true, maxlength: 120 }],
    officeProducts: [{ type: String, trim: true, maxlength: 120 }],
  },
  teachingProfile: {
    subjectsCanTeach: [{ type: String, trim: true, maxlength: 120 }],
    preferredAvailability: { type: String, trim: true, default: '', maxlength: 500 },
    alternativeAvailability: { type: String, trim: true, default: '', maxlength: 500 },
  },
  files: {
    resume: { type: assetSchema, default: () => ({}) },
    englishIntroduction: { type: assetSchema, default: () => ({}) },
    quranRecitation: { type: assetSchema, default: () => ({}) },
    teachingTopicExplanation: { type: assetSchema, default: () => ({}) },
  },
}, { _id: false });

const teacherContractSubmissionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  status: {
    type: String,
    enum: ['draft', 'submitted'],
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
    epithet: { type: String, trim: true, default: '', maxlength: 40 },
  },
  recruitment: { type: recruitmentSchema, default: () => ({}) },
  application: { type: teacherApplicationSchema, default: () => ({}) },
  submittedAt: { type: Date, default: null },
  lastSavedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('TeacherContractSubmission', teacherContractSubmissionSchema);
