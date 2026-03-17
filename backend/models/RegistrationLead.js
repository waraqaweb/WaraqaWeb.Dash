const mongoose = require('mongoose');

const leadStudentSchema = new mongoose.Schema({
  firstName: { type: String, trim: true, required: true, maxlength: 80 },
  lastName: { type: String, trim: true, required: true, maxlength: 80 },
  gender: { type: String, trim: true, enum: ['male', 'female', ''] },
  birthDate: { type: Date },
  courses: [{ type: String, trim: true, maxlength: 120 }],
  classDuration: { type: Number, min: 15, max: 240 },
  classesPerWeek: { type: Number, min: 1, max: 9 },
  notes: { type: String, trim: true, maxlength: 2000 },
}, { _id: false });

const availabilitySlotSchema = new mongoose.Schema({
  studentIndex: { type: Number, min: 0 },
  day: { type: String, trim: true, maxlength: 20, required: true },
  startTime: { type: String, trim: true, maxlength: 10, required: true },
  endTime: { type: String, trim: true, maxlength: 10, required: true },
  duration: { type: Number, min: 15, max: 240 },
}, { _id: false });

const registrationLeadSchema = new mongoose.Schema({
  source: {
    type: String,
    trim: true,
    default: 'student_registration_form',
    index: true,
  },
  status: {
    type: String,
    enum: ['new', 'converted', 'archived'],
    default: 'new',
    index: true,
  },
  personalInfo: {
    fullName: { type: String, trim: true, maxlength: 160 },
    firstName: { type: String, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80 },
    guardianName: { type: String, trim: true, maxlength: 160 },
    email: { type: String, trim: true, required: true, lowercase: true, maxlength: 160, index: true },
    phone: { type: String, trim: true, maxlength: 80 },
    timezone: { type: String, trim: true, required: true, default: 'Africa/Cairo' },
  },
  address: {
    city: { type: String, trim: true, maxlength: 120 },
    state: { type: String, trim: true, maxlength: 120 },
    country: { type: String, trim: true, maxlength: 120 },
  },
  preferences: {
    classPreferences: [{ type: String, trim: true, maxlength: 120 }],
    teacherPreferences: [{ type: String, trim: true, maxlength: 120 }],
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  students: {
    type: [leadStudentSchema],
    default: [],
  },
  availability: {
    weekdays: [{ type: String, trim: true, maxlength: 20 }],
    preferredStartingDate: { type: Date },
    schedulingMode: { type: String, enum: ['consecutive', 'separate'], default: 'consecutive' },
    allDurationsSame: { type: Boolean, default: true },
    sharedDuration: { type: Number, min: 15, max: 240 },
    slots: { type: [availabilitySlotSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 4000 },
  },
  submittedMeta: {
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  conversion: {
    convertedAt: { type: Date },
    convertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    guardianUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  archive: {
    archivedAt: { type: Date },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, maxlength: 500 },
  },
}, {
  timestamps: true,
});

registrationLeadSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('RegistrationLead', registrationLeadSchema);