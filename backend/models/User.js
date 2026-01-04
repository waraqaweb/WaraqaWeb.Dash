/**
 * User Model - Handles all user types in the system
 * 
 * This model manages three types of users:
 * - Admin: System administrators with full access
 * - Teacher: Instructors who conduct classes
 * - Guardian: Parents/guardians who manage student accounts (students are embedded as sub-documents)
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const isValidTimezoneValue = (timezone) => {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
};

// Student sub-document schema (embedded within guardian users)
const studentSubSchema = new mongoose.Schema({
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
    default: "Africa/Cairo", // Default to Cairo timezone for students
    validate: {
      validator: isValidTimezoneValue,
      message: 'Invalid timezone'
    }
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
  
  // Creation timestamp for this student
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  _id: true, // Each student sub-document gets its own _id
});

// Virtual for student full name
studentSubSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

const userSchema = new mongoose.Schema({
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
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Please enter a valid email"],
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  
  // User Role and Status
  role: {
    type: String,
    enum: ["admin", "teacher", "guardian"],
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  
  // Vacation tracking (for teachers)
  vacationStartDate: {
    type: Date,
  },
  vacationEndDate: {
    type: Date,
  },
  
  // Contact Information
  phone: {
    type: String,
    trim: true,
  },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
  },
  
  // Profile Information
  profilePicture: {
    type: String, // URL to profile image
    default: null,
  },
  // Cloudinary public id for the profile picture (used for deletion)
  profilePicturePublicId: {
    type: String,
    default: null,
  },
  // Thumbnail (small) version of the profile picture
  profilePictureThumbnail: {
    type: String,
    default: null,
  },
  profilePictureThumbnailPublicId: {
    type: String,
    default: null,
  },
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
    default: "Africa/Cairo", // Default to Cairo timezone for main users
    validate: {
      validator: isValidTimezoneValue,
      message: 'Invalid timezone'
    }
  },
  
  // Teacher-specific Information (only for role: 'teacher')
  teacherInfo: {
    subjects: [
      {
        type: String,
        trim: true,
      },
    ],
    qualifications: [
      {
        degree: String,
        institution: String,
        year: Number,
      },
    ],
    hourlyRate: {
      type: Number,
      default: 0,
    },
    // Monthly rate calculated based on hours taught this month
    monthlyRate: {
      // removed stored monthlyRate (calculated dynamically)
    },
    // Monthly hours taught (resets every month)
    monthlyHours: {
      type: Number,
      default: 0,
    },
    // Bonus field - only admin can update, teachers can only view
    bonus: {
      type: Number,
      default: 0,
    },
    // Instapay name for payment processing
    instapayName: {
      type: String,
      trim: true,
      default: "",
    },
    bankDetails: {
      accountNumber: String,
      bankName: String,
      routingNumber: String,
      iban: String,
      swift: String,
      // When user updates their bank details a pendingApproval flag is set
      pendingApproval: {
        type: Boolean,
        default: false,
      },
      lastUpdated: Date,
    },
    totalClassesTaught: {
      type: Number,
      default: 0,
    },
    monthlyEarnings: {
      type: Number,
      default: 0,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    spokenLanguages: [
      {
        type: String,
        trim: true,
      },
    ],
    idCardImages: [
      {
        type: String, // URLs to ID card images
      },
    ],
    googleMeetLink: {
      type: String,
      trim: true,
    },
    // Last month reset date for tracking monthly calculations
    lastMonthlyReset: {
      type: Date,
      default: Date.now,
    },
    
    // Availability Configuration (admin-set requirements)
    availabilityConfig: {
      minHoursPerDay: {
        type: Number,
        default: 1,
        min: 1,
        max: 24
      },
      minDaysPerWeek: {
        type: Number,
        default: 1,
        min: 1,
        max: 7
      },
      isAvailabilityRequired: {
        type: Boolean,
        default: false
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    },
    
    // Availability Status
    availabilityStatus: {
      type: String,
      enum: ['default_24_7', 'custom_set', 'pending_setup'],
      default: 'default_24_7'
    },
    // Teacher preferences for students (used for filtering and matching)
    preferredStudentAgeRange: {
      min: { type: Number, default: 3, min: 0 },
      max: { type: Number, default: 70, min: 0 }
    },
    preferredFemaleAgeRange: {
      min: { type: Number, default: 3, min: 0 },
      max: { type: Number, default: 70, min: 0 }
    },
    preferredMaleAgeRange: {
      min: { type: Number, default: 3, min: 0 },
      max: { type: Number, default: 70, min: 0 }
    },
    // Optional list of students this teacher currently teaches (admin-managed)
    studentsTaught: [
      {
        firstName: String,
        lastName: String,
        dateOfBirth: Date,
        gender: { type: String, enum: ['male','female'] },
        guardianId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        studentId: String // optional external id or reference
      }
    ],
    
    // ========== TEACHER SALARY SYSTEM FIELDS ==========
    // Current rate partition (based on YTD hours)
    currentRatePartition: {
      type: String,
      trim: true,
      default: '0-50h' // Beginner tier
    },
    
    // Effective rate (current USD/hour based on partition)
    effectiveRate: {
      type: Number,
      default: 12,
      min: 0
    },
    
    // Custom rate override (if admin sets specific rate for this teacher)
    customRateOverride: {
      enabled: { type: Boolean, default: false },
      rateUSD: { type: Number, min: 0 },
      setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      setAt: { type: Date },
      reason: { type: String, trim: true, maxlength: 200 }
    },
    
    // Preferred currency for salary payment
    preferredCurrency: {
      type: String,
      enum: ['USD', 'EGP', 'EUR', 'GBP', 'SAR', 'AED', 'QAR'],
      default: 'USD'
    },
    
    // Custom transfer fee for this teacher
    customTransferFee: {
      enabled: { type: Boolean, default: false },
      model: { 
        type: String, 
        enum: ['flat', 'percentage', 'none'],
        default: 'flat'
      },
      value: { type: Number, default: 50, min: 0 },
      setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      setAt: { type: Date }
    },
    
    // Year-to-Date statistics (resets yearly)
    totalHoursYTD: {
      type: Number,
      default: 0,
      min: 0
    },

    // Cumulative all-time hours for the teacher (never resets)
    cumulativeHoursAllTime: {
      type: Number,
      default: 0,
      min: 0
    },
    
    totalEarningsYTD: {
      type: Number,
      default: 0,
      min: 0
    },
    
    lastYTDReset: {
      type: Date,
      default: null
    },
    
    // Notification preferences
    notificationPreferences: {
      invoicePublished: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true }
      },
      paymentReceived: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true }
      },
      bonusAdded: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true }
      },
      digestMode: { type: Boolean, default: false },
      digestTime: { type: String, default: '18:00' }, // UTC time
      quietHoursStart: { type: String, default: '22:00' },
      quietHoursEnd: { type: String, default: '08:00' }
    },
    // Meeting sync reminder prompts
    syncMeetingPrompt: {
      lastShownAt: { type: Date },
      lastDismissedAt: { type: Date },
      lastBookedMeetingAt: { type: Date }
    }
    // ========== END TEACHER SALARY SYSTEM FIELDS ==========
  },

  // Admin-specific meeting configuration
  adminSettings: {
    meetingLink: {
      type: String,
      trim: true
    },
    meetingLinkUpdatedAt: {
      type: Date
    },
    meetingTimezone: {
      type: String,
      default: 'Africa/Cairo',
      validate: {
        validator: isValidTimezoneValue,
        message: 'Invalid timezone'
      }
    },
    bookingWelcomeMessage: {
      type: String,
      trim: true,
      maxlength: 400,
      default: 'Welcome to Waraqa — please pick a time that works best for you.'
    },
    bookingHeroMessage: {
      type: String,
      trim: true,
      maxlength: 160,
      default: 'We look forward to understanding your goals and building the right study plan.'
    },
    brandAccentColor: {
      type: String,
      trim: true,
      maxlength: 20,
      default: '#FACC15'
    },
    allowPublicEvaluations: {
      type: Boolean,
      default: true
    },
    meetingsEnabled: {
      type: Boolean,
      default: true
    },
    defaultBufferMinutes: {
      type: Number,
      default: 5,
      min: 0,
      max: 180
    },
    evaluationBufferMinutes: {
      type: Number,
      default: 10,
      min: 0,
      max: 240
    },
    guardianBufferMinutes: {
      type: Number,
      default: 10,
      min: 0,
      max: 240
    },
    teacherBufferMinutes: {
      type: Number,
      default: 15,
      min: 0,
      max: 240
    },
    heroImageUrl: {
      type: String,
      trim: true
    },
    calendarIntroVideoUrl: {
      type: String,
      trim: true
    },
    shareableBookingSlug: {
      type: String,
      trim: true,
      maxlength: 60,
      default: 'meet'
    }
  },
  
  // Guardian-specific Information (only for role: 'guardian')
  guardianInfo: {
    relationship: {
      type: String, // parent, guardian, etc.
      default: "parent",
    },
    emergencyContact: {
      name: String,
      phone: String,
      relationship: String,
    },
    paymentMethod: {
      type: String,
      enum: ["credit_card", "bank_transfer", "paypal"],
      default: "credit_card",
    },
    transferFee: {
      mode: {
        type: String,
        enum: ['fixed', 'percent'],
        default: 'fixed'
      },
      value: {
        type: Number,
        default: 5
      }
    },
    hourlyRate: {
      type: Number,
      default: 10, // default hourly rate for new guardians
    },
    billingAddress: {
      street: String,
      city: String,
      state: String,
      country: String,
      // zipCode removed per ISSUES
    },
    bankDetails: {
      accountNumber: String,
      bankName: String,
      iban: String,
      swift: String,
      pendingApproval: {
        type: Boolean,
        default: false,
      },
      lastUpdated: Date,
    },
    // Spoken languages for guardian (added to mirror teacherInfo.spokenLanguages)
    spokenLanguages: [
      {
        type: String,
        trim: true,
      },
    ],
    // Array of students managed by this guardian (embedded sub-documents)
    students: [studentSubSchema],
    // Total hours across all students under this guardian
    totalHours: {
      type: Number,
      default: 0,
    },
    advisorMeetingPrompt: {
      lastPromptedAt: { type: Date },
      lastCompletedMonthKey: { type: String, trim: true }
    },
    // Cumulative hours consumed by this guardian's students (all-time, never decremented)
    cumulativeConsumedHours: {
      type: Number,
      default: 0,
    },
    // Allow admin to opt-out of automatic totalHours calculation and set manually
    autoTotalHours: {
      type: Boolean,
      default: true,
    },
  },

  // System Fields
  lastLogin: {
    type: Date,
  },
  loginAttempts: {
    type: Number,
    default: 0,
  },
  lockUntil: {
    type: Date,
  },
  // Password reset fields for forgot-password flow
  passwordResetToken: {
    type: String,
    default: null,
  },
  passwordResetExpires: {
    type: Date,
    default: null,
  },
  
  // Notification Preferences
  notifications: {
    email: {
      type: Boolean,
      default: true,
    },
    sms: {
      type: Boolean,
      default: false,
    },
    push: {
      type: Boolean,
      default: true,
    },
  },
  // Onboarding tracking for admins
  onboarding: {
    completed: {
      type: Boolean,
      default: false,
    },
    dismissedAt: {
      type: Date,
      default: null,
    },
  },
}, {
  timestamps: true, // Automatically adds createdAt and updatedAt
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Virtual field for full name
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual field to check if account is locked
userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Virtual field to calculate total hours for guardian (sum of all students' hours)
userSchema.virtual("totalStudentHours").get(function () {
  if (this.role !== "guardian") return 0;
  return this.guardianInfo?.students?.reduce((total, student) => {
    return total + (student.hoursRemaining || 0);
  }, 0) || 0;
});

// Index for better query performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ "guardianInfo.students._id": 1 });

// Pre-save middleware to hash password
userSchema.pre("save", async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified("password")) return next();
  
  try {
    // Hash password with cost of 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Validate teacher preference ranges before validation/save
userSchema.pre('validate', function(next) {
  try {
    if (this.role === 'teacher' && this.teacherInfo) {
      const ranges = [
        { key: 'preferredStudentAgeRange', val: this.teacherInfo.preferredStudentAgeRange },
        { key: 'preferredFemaleAgeRange', val: this.teacherInfo.preferredFemaleAgeRange },
        { key: 'preferredMaleAgeRange', val: this.teacherInfo.preferredMaleAgeRange }
      ];
      for (const r of ranges) {
        const v = r.val;
        if (!v) continue;
        const min = Number(v.min ?? 3);
        const max = Number(v.max ?? 70);
        if (isNaN(min) || isNaN(max)) return next(new Error(`${r.key} must contain numeric min and max`));
        if (min < 0 || max < 0 || min > 120 || max > 120) return next(new Error(`${r.key} values must be between 0 and 120`));
        if (min > max) return next(new Error(`${r.key} min cannot be greater than max`));
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Pre-save middleware to update guardian's total hours
// ✅ Always keep guardianInfo.totalHours in sync with student hoursRemaining
userSchema.pre("save", function (next) {
  if (this.role === "guardian") {
    if (!this.guardianInfo || typeof this.guardianInfo !== 'object') {
      this.guardianInfo = {};
    }

    if (!this.guardianInfo.transferFee || typeof this.guardianInfo.transferFee !== 'object') {
      this.guardianInfo.transferFee = { mode: 'fixed', value: 5 };
    } else {
      const allowedModes = ['fixed', 'percent'];
      if (!allowedModes.includes(this.guardianInfo.transferFee.mode)) {
        this.guardianInfo.transferFee.mode = 'fixed';
      }

      const feeValue = Number(this.guardianInfo.transferFee.value);
      this.guardianInfo.transferFee.value = Number.isFinite(feeValue) ? feeValue : 5;
    }

    if (Array.isArray(this.guardianInfo?.students) && this.guardianInfo.autoTotalHours !== false) {
      this.guardianInfo.totalHours = this.guardianInfo.students.reduce((total, student) => {
        const hrs = Number(student.hoursRemaining) || 0;
        return total + hrs;
      }, 0);
    } else if (!Array.isArray(this.guardianInfo?.students)) {
      // fallback if no students
      this.guardianInfo.totalHours = 0;
    }
  }
  
  // Prevent turning off or locking admin accounts via normal save
  if (this.role === 'admin') {
    // ensure admin remains active and not locked unless changed by a super-admin API
    if (this.isModified('isActive') && this.isActive === false) {
      this.isActive = true;
    }
    if (this.lockUntil) {
      this.lockUntil = undefined;
    }
  }
  next();
});


// Method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Method to increment login attempts
userSchema.methods.incLoginAttempts = function () {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }
  
  return this.updateOne(updates);
};

// Method to reset login attempts
userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
  });
};

// Method to add a student to guardian's students array
userSchema.methods.addStudent = function (studentData) {
  if (this.role !== "guardian") {
    throw new Error("Only guardians can add students");
  }
  
  if (!this.guardianInfo) {
    this.guardianInfo = { students: [] };
  }
  
  if (!this.guardianInfo.students) {
    this.guardianInfo.students = [];
  }
  
  // Check for self-enrollment (prevent duplicates)
  if (studentData.selfGuardian) {
    const existingSelfEnrollment = this.guardianInfo.students.find(s => s.selfGuardian === true);
    if (existingSelfEnrollment) {
      throw new Error("Guardian is already enrolled as a student");
    }
  }
  
  this.guardianInfo.students.push(studentData);
  return this.save();
};

// Method to remove a student from guardian's students array
userSchema.methods.removeStudent = function (studentId) {
  if (this.role !== "guardian") {
    throw new Error("Only guardians can remove students");
  }
  
  if (!this.guardianInfo || !this.guardianInfo.students) {
    return this;
  }
  
  this.guardianInfo.students = this.guardianInfo.students.filter(
    student => student._id.toString() !== studentId.toString()
  );
  
  return this.save();
};

// Method to update a specific student
userSchema.methods.updateStudent = function (studentId, updateData) {
  if (this.role !== "guardian") {
    throw new Error("Only guardians can update students");
  }
  
  if (!this.guardianInfo || !this.guardianInfo.students) {
    throw new Error("No students found");
  }
  
  const student = this.guardianInfo.students.id(studentId);
  if (!student) {
    throw new Error("Student not found");
  }
  
  Object.assign(student, updateData);
  return this.save();
};

// Method to calculate teacher's monthly rate based on hours taught
userSchema.methods.calculateMonthlyRate = function () {
  if (this.role !== "teacher") return 0;
  
  const hours = this.teacherInfo?.monthlyHours || 0;
  let rate = 0;
  
  // Rate schedule based on hours taught this month
  if (hours >= 20) {
    rate = 15; // $15 per hour for 20+ hours
  } else if (hours >= 10) {
    rate = 12; // $12 per hour for 10-19 hours
  } else if (hours >= 5) {
    rate = 10; // $10 per hour for 5-9 hours
  } else {
    rate = 8; // $8 per hour for less than 5 hours
  }
  
  return rate;
};

// Method to reset monthly teacher data (called at the end of each month)
userSchema.methods.resetMonthlyTeacherData = function () {
  if (this.role !== "teacher") return;
  
  if (!this.teacherInfo) {
    this.teacherInfo = {};
  }
  
  this.teacherInfo.monthlyHours = 0;
  this.teacherInfo.monthlyRate = 0;
  this.teacherInfo.monthlyEarnings = 0;
  this.teacherInfo.bonus = 0; // Reset bonus monthly
  this.teacherInfo.lastMonthlyReset = new Date();
  
  return this.save();
};

// Method to add hours to teacher's monthly count
userSchema.methods.addTeachingHours = function (hours) {
  if (this.role !== "teacher") return;
  
  if (!this.teacherInfo) {
    this.teacherInfo = {};
  }
  // Keep a cumulative all-time counter that only increases when positive teaching hours are added.
  // Do NOT decrement this field on negative adjustments so it represents historical hours taught.
  if (typeof hours === 'number' && hours > 0) {
    this.teacherInfo.cumulativeHoursAllTime = (this.teacherInfo.cumulativeHoursAllTime || 0) + hours;
  }

  this.teacherInfo.monthlyHours = (this.teacherInfo.monthlyHours || 0) + hours;
  this.teacherInfo.monthlyRate = this.calculateMonthlyRate();
  this.teacherInfo.monthlyEarnings = this.teacherInfo.monthlyHours * this.teacherInfo.monthlyRate + (this.teacherInfo.bonus || 0);

  return this.save();
};

// Static method to find active users by role
userSchema.statics.findActiveByRole = function (role) {
  return this.find({ role, isActive: true });
};

// Static method to check if any guardian has zero total hours (for invoice generation)
userSchema.statics.findGuardiansWithZeroHours = async function (options = {}) {
  const {
    includeInactive = false,
    billingSystems = null,
    includeAnalysis = false,
    syncTotalHours = false
  } = options || {};

  const match = { role: 'guardian' };
  if (!includeInactive) {
    match.isActive = true;
  }

  if (Array.isArray(billingSystems) && billingSystems.length) {
    const normalizedSystems = billingSystems
      .map((value) => {
        if (value === null) return null;
        if (typeof value === 'string') return value.trim();
        return value;
      })
      .filter((value) => value !== undefined);

    if (normalizedSystems.length) {
      if (!normalizedSystems.includes(null)) {
        normalizedSystems.push(null);
      }
      match['guardianInfo.billingSystem'] = { $in: normalizedSystems };
    }
  }

  const guardians = await this.find(match)
    .select('firstName lastName email phone guardianInfo isActive status timezone timeZone createdAt updatedAt')
    .lean();

  const results = [];

  const parseHours = (student) => {
    const raw = student?.hoursRemaining ?? student?.hoursLeft ?? 0;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : 0;
  };

  for (const guardian of guardians) {
    const guardianInfo = guardian.guardianInfo && typeof guardian.guardianInfo === 'object'
      ? guardian.guardianInfo
      : {};

    if (!guardian.guardianInfo || typeof guardian.guardianInfo !== 'object') {
      guardian.guardianInfo = guardianInfo;
    }

    const students = Array.isArray(guardianInfo.students)
      ? guardianInfo.students.filter(Boolean)
      : [];

    const zeroStudents = students.filter((student) => parseHours(student) <= 0);

    const recalculatedTotalHours = students.reduce(
      (sum, student) => sum + parseHours(student),
      0
    );

    const storedTotalRaw = guardianInfo.totalHours;
    const storedTotalNumeric = Number(storedTotalRaw);
    const storedTotalHours = Number.isFinite(storedTotalNumeric) ? storedTotalNumeric : null;
    const effectiveTotalHours = storedTotalHours !== null ? storedTotalHours : recalculatedTotalHours;

    const needsTopUp = zeroStudents.length > 0
      || effectiveTotalHours <= 0
      || (students.length === 0 && effectiveTotalHours <= 0);

    if (!needsTopUp) {
      continue;
    }

    if (syncTotalHours && guardianInfo.autoTotalHours !== false) {
      const normalizedStored = storedTotalHours ?? 0;
      if (Math.abs(normalizedStored - recalculatedTotalHours) > 0.0001) {
        await this.updateOne(
          { _id: guardian._id },
          { $set: { 'guardianInfo.totalHours': recalculatedTotalHours } }
        );
        guardianInfo.totalHours = recalculatedTotalHours;
      }
    }

    if (includeAnalysis) {
      guardian.zeroHourAnalysis = {
        zeroStudents: zeroStudents.map((student) => ({
          _id: student._id,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          hoursRemaining: parseHours(student)
        })),
        zeroStudentCount: zeroStudents.length,
        recalculatedTotalHours,
        storedTotalHours,
        effectiveTotalHours,
        studentCount: students.length
      };
    }

    results.push(guardian);
  }

  return results;
};

module.exports = mongoose.model("User", userSchema);