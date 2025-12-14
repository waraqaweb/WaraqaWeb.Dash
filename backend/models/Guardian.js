/**
 * Guardian Model - Stores guardian-specific information and references to their students.
 * 
 * This model links to a User document (role: 'guardian') and manages a list of associated students.
 */

const mongoose = require("mongoose");

const guardianSchema = new mongoose.Schema({
  // Reference to the User model (the actual guardian user account)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true, // Each User can only be a guardian once
  },

  // Array of references to Student documents managed by this guardian
  students: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
    },
  ],
  paidHours: { type: Number, default: 0 },

  // Total remaining minutes across all students under this guardian
  // This will be a calculated field or updated via triggers/methods
  totalRemainingMinutes: {
    type: Number,
    default: 0,
  },

  // Profile photo for the guardian (if different from User.profilePicture)
  profilePhoto: {
    url: String,
    publicId: String,
  },

  // Emergency contact information
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String,
  },

  // Payment related information (simplified for now)
  paymentMethod: {
    type: String,
    enum: ["credit_card", "bank_transfer", "paypal", "other"],
    default: "other",
  },
  billingAddress: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
  },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual for total remaining hours (convert from minutes)
guardianSchema.virtual("totalRemainingHours").get(function () {
  return Math.round((this.totalRemainingMinutes || 0) / 60 * 100) / 100; // Round to 2 decimal places
});

// Static method to update guardian's total remaining minutes based on their students
guardianSchema.statics.updateTotalRemainingMinutes = async function (guardianUserId) {
  const Student = mongoose.model("Student"); // Get Student model dynamically to avoid circular dependency
  const students = await Student.find({ guardian: guardianUserId });
  const totalMinutes = students.reduce((sum, student) => {
    return sum + (student.remainingMinutes || 0);
  }, 0);

  await this.findOneAndUpdate(
    { user: guardianUserId },
    { totalRemainingMinutes: totalMinutes },
    { new: true, upsert: true } // upsert: true creates the document if it doesn't exist
  );

  return totalMinutes;
};

module.exports = mongoose.model("Guardian", guardianSchema);