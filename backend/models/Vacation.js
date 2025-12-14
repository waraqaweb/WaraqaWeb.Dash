// models/Vacation.js
// Handles both teacher and student vacations for class scheduling

const mongoose = require('mongoose');

const vacationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // teacher or student
  role: { type: String, enum: ['teacher', 'student'], required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  reason: { type: String, required: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String,
    enum: ['pending', 'approved', 'active', 'ended', 'rejected', 'cancelled'],
    default: 'pending'
  },
  actualStartDate: { type: Date },
  actualEndDate: { type: Date },
  endedAt: { type: Date },
  endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  endReason: { type: String },
  lastStatusChangeAt: { type: Date },
  // For teachers: mapping of student to substitute teacher or handling preference
  substitutes: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
    substituteTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    handling: { type: String, enum: ['hold', 'cancel', 'substitute'], required: true, default: 'hold' },
    notes: { type: String }
  }],
  // Approval status (legacy field kept for backward compatibility)
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  approvedAt: { type: Date },
  // Admin who approved/rejected the vacation
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Reason for rejection if applicable
  rejectionReason: { type: String },
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

vacationSchema.pre('save', function(next) {
  if (this.isModified('status')) {
    this.lastStatusChangeAt = new Date();
    // Keep approvalStatus in sync for legacy consumers
    if (['pending', 'approved', 'rejected'].includes(this.status)) {
      this.approvalStatus = this.status === 'pending' ? 'pending' : this.status === 'rejected' ? 'rejected' : 'approved';
    }
    if (this.status === 'approved' && !this.approvedAt) {
      this.approvedAt = new Date();
    }
    if (this.status === 'active' && !this.actualStartDate) {
      this.actualStartDate = new Date();
    }
    if (this.status === 'ended' && !this.actualEndDate) {
      this.actualEndDate = new Date();
    }
  }
  next();
});

module.exports = mongoose.model('Vacation', vacationSchema);
