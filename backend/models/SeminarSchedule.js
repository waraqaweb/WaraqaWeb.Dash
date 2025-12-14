const mongoose = require('mongoose');

const formFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['text', 'email', 'phone', 'textarea']
    },
    required: { type: Boolean, default: true }
  },
  { _id: false }
);

const seminarScheduleSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, index: true },
    summary: { type: String, trim: true },
    recurrenceRule: { type: String, required: true },
    capacity: { type: Number, default: 25, min: 1 },
    timezone: { type: String, default: 'Africa/Cairo' },
    meetingLink: { type: String, trim: true },
    locationType: { type: String, enum: ['virtual', 'in_person', 'hybrid'], default: 'virtual' },
    locationDetails: { type: String, trim: true },
    formFields: [formFieldSchema],
    confirmationTemplate: { type: String, trim: true },
    status: { type: String, enum: ['active', 'paused'], default: 'active' },
    published: { type: Boolean, default: false, index: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('SeminarSchedule', seminarScheduleSchema);
