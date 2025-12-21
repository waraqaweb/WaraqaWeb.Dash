/**
 * Student Model - Standalone entity for students (no login required)
 * 
 * Students are managed by guardians and don't have separate user accounts.
 * They are entities for class enrollment and hour tracking.
 */

const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  // Basic Information
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Please enter a valid email"],
  },
  
  // Guardian Reference (required)
  guardian: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // References the Guardian user (User model with role: 'guardian')
    required: true
  },
  
  // Student-specific Information
  grade: {
    type: String,
    trim: true,
  },
  school: {
    type: String,
    trim: true,
  },
  language: {
    type: String,
    default: "English",
    trim: true,
  },
  subjects: [{
    type: String,
    trim: true,
  }],
  
  // Contact Information
  phone: {
    type: String,
    trim: true,
  },
  whatsapp: {
    type: String,
    trim: true,
  },
  
  // Academic Information
  learningPreferences: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  evaluation: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  
  // Admin-only field for evaluation summary
  evaluationSummary: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: "",
  },
  
  // Profile Information
  dateOfBirth: {
    type: Date,
  },
  gender: {
    type: String,
    enum: ["male", "female"],
    default: "male",
  },
  timezone: {
    type: String,
    default: "UTC",
  },
  
  // Profile Photo
  profilePicture: {
    url: String,
    publicId: String
  },
  
  // Status and Hours
  isActive: {
    type: Boolean,
    default: true,
  },
  
  // Hours remaining in student's account (can be negative for due invoices)
  hoursRemaining: {
    type: Number,
    default: 0,
  },
  
  // Self-enrollment flag (if guardian enrolled themselves as a student)
  selfGuardian: {
    type: Boolean,
    default: false,
  },
  
  // Class and Academic Tracking
  totalClassesAttended: {
    type: Number,
    default: 0,
  },
  currentTeachers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // References Teacher users (User model with role: 'teacher')
  }],
  
  // Notes and Comments
  notes: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for full name
studentSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Indexes for better query performance
studentSchema.index({ guardian: 1 });
studentSchema.index({ email: 1 });
studentSchema.index({ isActive: 1 });
studentSchema.index({ 'currentTeachers': 1 });

// Static method to find students by guardian
studentSchema.statics.findByGuardian = function(guardianId) {
  return this.find({ guardian: guardianId }).populate('currentTeachers', 'firstName lastName email');
};

// Static method to find active students
studentSchema.statics.findActive = function() {
  return this.find({ isActive: true });
};

// Method to add hours to student account
studentSchema.methods.addHours = function(hours) {
  this.hoursRemaining = (this.hoursRemaining || 0) + hours;
  return this.save();
};

// Method to subtract hours from student account
studentSchema.methods.subtractHours = function(hours) {
  this.hoursRemaining = (this.hoursRemaining || 0) - hours;
  return this.save();
};

// Method to set hours for student account
studentSchema.methods.setHours = function(hours) {
  this.hoursRemaining = hours;
  return this.save();
};

module.exports = mongoose.model('Student', studentSchema);