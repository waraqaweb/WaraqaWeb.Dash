// backend/models/ClassReport.js
const mongoose = require('mongoose');

const classReportSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher', required: true },
  guardianId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guardian', required: true },
  subject: { type: String },
  notes: { type: String },
  duration: { type: Number, required: true }, // store in hours (e.g. 1 or 1.5)
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('ClassReport', classReportSchema);
