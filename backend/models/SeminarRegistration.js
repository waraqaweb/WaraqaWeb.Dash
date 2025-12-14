const mongoose = require('mongoose');

const guardianInfoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    notes: { type: String, trim: true }
  },
  { _id: false }
);

const seminarRegistrationSchema = new mongoose.Schema(
  {
    seminar: { type: mongoose.Schema.Types.ObjectId, ref: 'SeminarSchedule', required: true },
    guardian: guardianInfoSchema,
    answers: { type: Map, of: String },
    source: { type: String, trim: true },
    status: { type: String, enum: ['pending', 'confirmed', 'cancelled'], default: 'pending' },
    bookedSlot: { type: Date },
    confirmationNumber: { type: String, trim: true, unique: true }
  },
  {
    timestamps: true
  }
);

seminarRegistrationSchema.index({ seminar: 1, createdAt: -1 });
seminarRegistrationSchema.index({ confirmationNumber: 1 });

module.exports = mongoose.model('SeminarRegistration', seminarRegistrationSchema);
