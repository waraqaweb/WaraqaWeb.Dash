/**
 * Class Model - Handles all class scheduling and management
 * 
 * This model manages online classes with comprehen  status: {
    type: String,
    enum: [
      "scheduled",           // Class is scheduled but hasn't happened yet
      "in_progress",         // Class is currently happening
      "completed",          // Class finished normally
      "attended",           // Student attended the class
      "absent",             // Student didn't show up, teacher did
      "cancelled",          // Class is permanently cancelled
      "on_hold",            // Class is temporarily on hold
      "pattern",            // Special status for recurring patterns
    ],
    default: "scheduled",
  },
  
  // Visibility flag for on-hold classes
  hidden: {
    type: Boolean,
    default: false
  },:
 * - Scheduling and recurring classes with rolling 2-month generation
 * - Detailed class reports and attendance tracking
 * - Status management (scheduled, attended, missed, cancelled)
 * - Integration with User model (teachers, students, guardians)
 * - Reschedule history and notifications
 */

const mongoose = require("mongoose");
const {
  extractParticipantIds,
  refreshParticipantsFromSchedule,
} = require("../services/activityStatusService");

const classSchema = new mongoose.Schema({
  // Basic Class Information
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
  },
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  
  // Visibility flag for on-hold/hidden classes (used in queries)
  hidden: {
    type: Boolean,
    default: false
  },
  
  // Participants
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  student: {
    guardianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    studentName: {
      type: String,
      required: true,
      trim: true,
    },
  },
  
  // Scheduling Information
  scheduledDate: {
    type: Date,
    required: true,
  },
  duration: {
    type: Number, // Duration in minutes
    required: true,
    min: 15,
    max: 180,
    default: 60,
  },
  endsAt: {
    type: Date,
    index: true,
  },
  timezone: {
    type: String,
    required: true,
    default: "Africa/Cairo", // Default to Cairo timezone
    validate: {
      validator: function(v) {
        try {
          // Validate timezone using Intl API
          new Intl.DateTimeFormat('en-US', { timeZone: v });
          return true;
        } catch (error) {
          return false;
        }
      },
      message: 'Invalid timezone'
    }
  },
  
  // Timezone anchoring - determines which timezone controls the class time
  anchoredTimezone: {
    type: String,
    enum: ['student', 'teacher', 'system'],
    default: 'student', // Student timezone is the anchor by default
  },
  
  // DST tracking for automatic adjustments
  dstInfo: {
    lastDSTCheck: {
      type: Date,
      default: Date.now
    },
    dstAdjustments: [{
      adjustmentDate: Date,
      reason: String,
      oldTime: Date,
      newTime: Date,
      affectedTimezone: String,
      adjustmentType: {
        type: String,
        enum: ['spring_forward', 'fall_back']
      }
    }]
  },
  
  // Recurring Class Settings
  isRecurring: {
    type: Boolean,
    default: false,
  },
  recurrence: {
    frequency: {
      type: String,
      enum: ["daily", "weekly", "biweekly", "monthly"],
      default: "weekly",
    },
    interval: {
      type: Number,
      default: 1,
      min: 1,
    },
    daysOfWeek: [{
      type: Number, // 0 = Sunday, 1 = Monday, etc.
      min: 0,
      max: 6,
    }],
    endDate: {
      type: Date,
    },
    maxOccurrences: {
      type: Number,
      min: 1,
    },
    generationPeriodMonths: {
      type: Number,
      default: 2,
      min: 1,
      max: 12,
    },
    lastGenerated: {
      type: Date,
    },
  },
  
  // Parent recurring class reference (for individual instances)
  parentRecurringClass: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
  },

  // Detailed recurring slots configuration (day/time per slot)
  recurrenceDetails: [{
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      required: true,
    },
    time: {
      type: String,
      required: true,
      trim: true,
      match: /^\d{2}:\d{2}$/,
    },
    duration: {
      type: Number,
      min: 15,
      max: 180,
    },
    timezone: {
      type: String,
      trim: true,
    },
    raw: {
      type: mongoose.Schema.Types.Mixed,
    },
  }],
  
  // Class Status and Tracking
  status: {
    type: String,
    enum: [
      "scheduled",           // Class is scheduled but hasn't happened yet
      "in_progress",         // Class is currently happening
      "completed",           // Class finished normally
      "attended",            // Student attended the class
      "missed_by_student",   // Student didn't show up, teacher did
  "cancelled_by_teacher", // Teacher cancelled the class
  "cancelled_by_student", // Student cancelled the class
  "cancelled_by_guardian", // Guardian cancelled the class
  "cancelled_by_admin",   // Admin cancelled the class
      "no_show_both",         // Neither teacher nor student attended
      "absent",               // Legacy value
      "cancelled",            // Legacy value
      "pattern",             // Special status for recurring patterns
    ],
    default: "scheduled",
  },
  
  // Attendance Tracking
  attendance: {
    teacherPresent: {
      type: Boolean,
      default: null,
    },
    studentPresent: {
      type: Boolean,
      default: null,
    },
    markedAt: {
      type: Date,
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  
  // Detailed Class Report (for teachers)
  classReport: {
    subjects: [{
      type: String,
      trim: true,
      maxlength: 100,
    }],
    attendance: {
      type: String,
      enum: ["attended", "missed_by_student", "cancelled_by_teacher", "cancelled_by_student", "no_show_both"],
    },
    countAbsentForBilling: {
      type: Boolean,
      default: true,
    },
    absenceExcused: {
      type: Boolean,
      default: false,
    },
    quranRecitation: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    recitedQuran: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    subject: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    lessonTopic: {
      type: String,
      trim: true,
      maxlength: 300,
    },
    surah: {
      name: {
        type: String,
        trim: true,
        maxlength: 100,
      },
      verse: {
        type: Number,
        min: 1,
      },
    },
    verseEnd: {
      type: Number,
      min: 1,
    },
    newAssignment: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    supervisorNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    teacherNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    classScore: {
      type: Number,
      min: 0,
      max: 5,
      default: 5,
    },
    submittedAt: {
      type: Date,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    lastEditedAt: {
      type: Date,
    },
    lastEditedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  
  // Report Submission Time Management
  reportSubmission: {
    // Current status of report submission window
    status: {
      type: String,
      enum: ['pending', 'open', 'expired', 'submitted', 'unreported', 'admin_extended'],
      default: 'pending', // pending = class not yet ended
    },
    // When the teacher submission window expires (72 hours after class end)
    teacherDeadline: {
      type: Date,
    },
    // Admin can grant extension
    adminExtension: {
      granted: {
        type: Boolean,
        default: false,
      },
      grantedAt: {
        type: Date,
      },
      grantedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      expiresAt: {
        type: Date,
      },
      reason: {
        type: String,
        trim: true,
        maxlength: 500,
      },
    },
    // Track when marked as unreported
    markedUnreportedAt: {
      type: Date,
    },
    markedUnreportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },

  classReportHistory: [{
    snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    editedAt: {
      type: Date,
      default: Date.now,
    },
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 300,
    },
  }],
  
  // Google Meet Integration
  meetingLink: {
    type: String,
    trim: true,
  },
  meetingId: {
    type: String,
    trim: true,
  },
  
  // Class Materials and Resources
  materials: [{
    name: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    libraryItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LibraryItem'
    },
    kind: {
      type: String,
      trim: true
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    uploadedByRole: {
      type: String,
      trim: true
    },
    type: {
      type: String,
      enum: ["document", "video", "audio", "link", "other"],
      default: "document",
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  }],
  
  // Homework and Assignments
  homework: {
    assigned: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    dueDate: {
      type: Date,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    completedAt: {
      type: Date,
    },
    grade: {
      type: String,
      trim: true,
    },
    feedback: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  
  // Reschedule History
  rescheduleHistory: [{
    oldDate: {
      type: Date,
      required: true,
    },
    newDate: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    rescheduledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    rescheduledAt: {
      type: Date,
      default: Date.now,
    },
  }],

  pendingReschedule: {
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    requestedByRole: {
      type: String,
      enum: ["admin", "teacher", "guardian", "student"],
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    proposedDate: {
      type: Date,
    },
    proposedDuration: {
      type: Number,
      min: 15,
      max: 180,
    },
    proposedTimezone: {
      type: String,
      trim: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    originalDate: {
      type: Date,
    },
    originalDuration: {
      type: Number,
      min: 15,
      max: 180,
    },
    decisionAt: {
      type: Date,
    },
    decisionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    decisionByRole: {
      type: String,
      enum: ["admin", "teacher", "guardian", "student"],
    },
    decisionNote: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  
  // Administrative Fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  
  // Cancellation Information
  cancellation: {
    reason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    cancelledAt: {
      type: Date,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    cancelledByRole: {
      type: String,
      enum: ["admin", "teacher", "guardian", "student"],
    },
    refundIssued: {
      type: Boolean,
      default: false,
    },
  },
  
  // Notifications
  notifications: {
    reminderSent: {
      type: Boolean,
      default: false,
    },
    reminderSentAt: {
      type: Date,
    },
    followUpSent: {
      type: Boolean,
      default: false,
    },
    followUpSentAt: {
      type: Date,
    },
  },
  
  // Billing linkage: ensure each lesson instance links to a single invoice
  billedInInvoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null,
    index: true
  },
  billedAt: { type: Date, default: null },

  // Dedicated teacher salary billing linkage (separate from guardian invoices)
  billedInTeacherInvoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TeacherInvoice',
    default: null,
    index: true
  },
  teacherInvoiceBilledAt: { type: Date, default: null },
  
  // Mark when a class has been fully covered by a guardian payment
  paidByGuardian: { type: Boolean, default: false },
  paidByGuardianAt: { type: Date, default: null },
  
  // Flag used by audits/UI to highlight lessons that should be invoiced
  flaggedUninvoiced: { type: Boolean, default: false }
  
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for better query performance
classSchema.index({ teacher: 1, scheduledDate: 1 });
classSchema.index({ "student.guardianId": 1, scheduledDate: 1 });
classSchema.index({ "student.studentId": 1, scheduledDate: 1 });
classSchema.index({ status: 1, scheduledDate: 1 });
classSchema.index({ hidden: 1, scheduledDate: 1 });
classSchema.index({ hidden: 1, status: 1, scheduledDate: 1 });
classSchema.index({ scheduledDate: 1 });
classSchema.index({ endsAt: 1 });
// Compound indexes to support upcoming/previous filtering (endsAt) with common entity filters.
classSchema.index({ teacher: 1, endsAt: 1, scheduledDate: 1 });
classSchema.index({ "student.guardianId": 1, endsAt: 1, scheduledDate: 1 });
classSchema.index({ "student.studentId": 1, endsAt: 1, scheduledDate: 1 });
classSchema.index({ hidden: 1, status: 1, endsAt: 1, scheduledDate: 1 });
classSchema.index({ createdAt: 1 });
classSchema.index({ parentRecurringClass: 1 });
classSchema.index({ isRecurring: 1, status: 1 });

// Virtual for formatted date
classSchema.virtual('formattedDate').get(function() {
  return this.scheduledDate ? this.scheduledDate.toLocaleDateString() : '';
});

// Virtual for formatted time
classSchema.virtual('formattedTime').get(function() {
  return this.scheduledDate ? this.scheduledDate.toLocaleTimeString() : '';
});

// Virtual for class end time
classSchema.virtual('endTime').get(function() {
  return this.scheduledDate ? new Date(this.scheduledDate.getTime() + (this.duration * 60000)) : null;
});

// Virtual to check if class is in the past
classSchema.virtual('isPast').get(function() {
  return this.scheduledDate ? this.scheduledDate < new Date() : false;
});

// Virtual to check if class is today
classSchema.virtual('isToday').get(function() {
  if (!this.scheduledDate) return false;
  const today = new Date();
  const classDate = new Date(this.scheduledDate);
  return classDate.toDateString() === today.toDateString();
});

// Virtual to check if class counts for teacher (attended or missed by student)
classSchema.virtual('countsForTeacher').get(function() {
  return ['attended', 'missed_by_student'].includes(this.status);
});

// Virtual to check if class counts for student (only attended)
classSchema.virtual('countsForStudent').get(function() {
  return this.status === 'attended';
});

// 🔒 CAPTURE ORIGINAL STATE when document is loaded from database
classSchema.post('init', function(doc) {
  // Store the original state when document is first loaded
  doc.$locals = doc.$locals || {};
  doc.$locals.originalState = {
    status: doc.status,
    duration: doc.duration,
    billedInInvoiceId: doc.billedInInvoiceId,
    wasReportSubmitted: !!doc.classReport?.submittedAt
  };
});

// Capture previous snapshot for change handling and update lastModifiedBy  
classSchema.pre('save', function(next) {
  try {
    if (this.scheduledDate && Number.isFinite(this.duration)) {
      this.endsAt = new Date(this.scheduledDate.getTime() + (this.duration * 60000));
    }
    if (this.isModified() && !this.isNew) {
      this.lastModifiedBy = this.lastModifiedBy || this.createdBy;
    }
    
    // 🔒 DUPLICATE SUBMISSION PREVENTION
    // Use the original state captured when document was loaded from DB
    this.$locals = this.$locals || {};
    
    // If we have the original state from 'init' hook, use that
    const originalState = this.$locals.originalState || {};
    
    this.$locals.prevSnapshot = {
      status: originalState.status !== undefined ? originalState.status : this.status,
      duration: originalState.duration !== undefined ? originalState.duration : this.duration,
      billedInInvoiceId: originalState.billedInInvoiceId || this.billedInInvoiceId,
      wasReportSubmitted: originalState.wasReportSubmitted || false
    };
    
    if (process.env.DEBUG_CLASS_SAVE === '1') {
      console.log(`🔍 [Class Pre-Save] ID ${this._id}:`, {
        isNew: this.isNew,
        statusModified: this.isModified('status'),
        newStatus: this.status,
        originalStatus: originalState.status,
        capturedPrevStatus: this.$locals.prevSnapshot.status,
        reportWasSubmitted: originalState.wasReportSubmitted,
        currentHasSubmittedAt: !!this.classReport?.submittedAt
      });
    }
  } catch (e) {
    console.warn('[Class Pre-Save] Error:', e.message);
    // Safe fallback
    this.$locals = this.$locals || {};
    this.$locals.prevSnapshot = {
      status: this.status,
      duration: this.duration,
      billedInInvoiceId: this.billedInInvoiceId,
      wasReportSubmitted: false
    };
  }
  next();
});

// Keep endsAt in sync for findOneAndUpdate / findByIdAndUpdate
classSchema.pre('findOneAndUpdate', async function(next) {
  try {
    const update = this.getUpdate() || {};
    const set = update.$set || {};
    const hasScheduled = Object.prototype.hasOwnProperty.call(set, 'scheduledDate')
      || Object.prototype.hasOwnProperty.call(update, 'scheduledDate');
    const hasDuration = Object.prototype.hasOwnProperty.call(set, 'duration')
      || Object.prototype.hasOwnProperty.call(update, 'duration');

    if (!hasScheduled && !hasDuration) return next();

    const existing = await this.model.findOne(this.getQuery()).select('scheduledDate duration').lean();
    const rawScheduled = hasScheduled ? (set.scheduledDate ?? update.scheduledDate) : existing?.scheduledDate;
    const rawDuration = hasDuration ? (set.duration ?? update.duration) : existing?.duration;
    if (rawScheduled) {
      const scheduledDate = new Date(rawScheduled);
      const duration = Number(rawDuration || 0);
      if (Number.isFinite(scheduledDate.getTime())) {
        const endsAt = new Date(scheduledDate.getTime() + (duration * 60000));
        update.$set = { ...set, endsAt };
        this.setUpdate(update);
      }
    }
  } catch (e) {
    // Non-fatal: skip endsAt sync on error
  }
  next();
});

// Post-save: react to status/duration changes by queuing invoice updates
classSchema.post('save', async function(doc) {
  try {
    const prev = (doc && doc.$locals && doc.$locals.prevSnapshot) ? doc.$locals.prevSnapshot : null;
    const statusChanged = prev && typeof prev.status !== 'undefined' && String(prev.status) !== String(doc.status);
    const durationChanged = prev && typeof prev.duration !== 'undefined' && Number(prev.duration) !== Number(doc.duration);

    // 🔒 CRITICAL: Prevent duplicate hour adjustments ONLY when re-submitting same countable status
    // Examples where we SHOULD skip:
    // - attended → attended (teacher just editing notes without changing status)
    // - missed_by_student → missed_by_student (editing report details)
    // 
    // Examples where we SHOULD NOT skip (these are real status changes):
    // - attended → cancelled (reverting a class) ✅ ALLOW
    // - cancelled → attended (un-cancelling a class) ✅ ALLOW
    // - scheduled → attended (first submission) ✅ ALLOW
    // - attended → missed_by_student (changing countable type) ✅ ALLOW
    
    const wasReportSubmitted = prev?.wasReportSubmitted || false;
    const isCountable = (status) => ['attended', 'missed_by_student', 'absent'].includes(status);
    
    // ONLY block if:
    // 1. Report was already submitted before
    // 2. Status didn't actually change (same status resubmission)
    // 3. Both statuses are countable (to catch countable→countable same-status edits)
    const isSameStatusResubmission = wasReportSubmitted && 
                                      !statusChanged &&  // Status DID NOT change
                                      isCountable(prev.status) && 
                                      isCountable(doc.status);
    
    if (isSameStatusResubmission) {
      console.log(`🔒 [Class Post-Save] BLOCKING duplicate hour adjustment for class ${doc._id}`);
      console.log(`🔒 [Class Post-Save] This is a report RE-SUBMISSION with SAME status: ${doc.status}`);
      console.log(`🔒 [Class Post-Save] Previous status: ${prev.status}, Current status: ${doc.status}`);
      console.log(`🔒 [Class Post-Save] Hours were already adjusted during first submission`);
      
      // Still trigger invoice updates (to fix invoice items) but tell the service
      // to skip hour adjustments
      if (doc.billedInInvoiceId) {
        const InvoiceService = require('../services/invoiceService');
        InvoiceService.onClassStateChanged(doc.toObject(), { ...prev, skipHourAdjustment: true }).catch((err) => {
          console.warn('[Class.postSave] onClassStateChanged failed', err && err.message);
        });
      }
      return;
    }
    
    // If status actually changed between different statuses, always allow hour adjustment
    if (statusChanged) {
      console.log(`✅ [Class Post-Save] Status CHANGED from ${prev.status} → ${doc.status}`);
      console.log(`✅ [Class Post-Save] Hour adjustments will be processed`);
    }

    if (!statusChanged && !durationChanged) {
      // Nothing to do
      return;
    }

    console.log(`📊 [Class Post-Save] Detected changes for class ${doc._id}:`, {
      statusChanged,
      durationChanged,
      oldStatus: prev?.status,
      newStatus: doc.status,
      oldDuration: prev?.duration,
      newDuration: doc.duration,
      isFirstSubmission: !wasReportSubmitted
    });

    // Defer requiring the service to avoid circular deps
    const InvoiceService = require('../services/invoiceService');
    
    // ALWAYS call onClassStateChanged for hour adjustments
    // Even if there's no invoice, hours still need to be updated
    InvoiceService.onClassStateChanged(doc.toObject(), prev).catch((err) => {
      console.warn('[Class.postSave] onClassStateChanged failed', err && err.message);
    });
    
    // If not linked to an invoice, mark as uninvoiced for UI surfacing
    if (!doc.billedInInvoiceId) {
      try {
        if (!doc.flaggedUninvoiced) {
          await doc.constructor.updateOne({ _id: doc._id }, { $set: { flaggedUninvoiced: true } }).exec();
        }
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[Class.postSave] handler error', err && err.message);
  }
});

// Method to mark attendance (simplified version)
classSchema.methods.markAttendance = function(teacherPresent, studentPresent, markedBy, notes = '') {
  this.attendance.teacherPresent = teacherPresent;
  this.attendance.studentPresent = studentPresent;
  this.attendance.markedAt = new Date();
  this.attendance.markedBy = markedBy;
  this.attendance.notes = notes;
  
  // Update status based on attendance
  if (teacherPresent && studentPresent) {
    this.status = 'attended';
  } else if (teacherPresent && !studentPresent) {
    this.status = 'missed_by_student';
  } else if (!teacherPresent && studentPresent) {
    this.status = 'cancelled_by_teacher';
  } else {
    this.status = 'no_show_both';
  }
  
  return this.save();
};

// Method to submit detailed class report
classSchema.methods.submitClassReport = function(reportData, submittedBy) {
  this.classReport = {
    ...reportData,
    submittedAt: new Date(),
    submittedBy
  };
  
  // Update attendance based on report
  this.attendance.markedAt = new Date();
  this.attendance.markedBy = submittedBy;
  this.attendance.notes = reportData.supervisorNotes || '';
  
  if (reportData.attendance === 'attended') {
    this.attendance.teacherPresent = true;
    this.attendance.studentPresent = true;
    this.status = 'attended';
  } else if (reportData.attendance === 'missed_by_student') {
    this.attendance.teacherPresent = true;
    this.attendance.studentPresent = false;
    this.status = 'missed_by_student';
  } else if (reportData.attendance === 'cancelled_by_teacher') {
    this.attendance.teacherPresent = false;
    this.attendance.studentPresent = true;
    this.status = 'cancelled_by_teacher';
  } else if (reportData.attendance === 'cancelled_by_student') {
    this.attendance.teacherPresent = true;
    this.attendance.studentPresent = false;
    this.status = 'cancelled_by_student';
  } else if (reportData.attendance === 'no_show_both') {
    this.attendance.teacherPresent = false;
    this.attendance.studentPresent = false;
    this.status = 'no_show_both';
  }
  
  return this.save();
};

// Method to cancel class
classSchema.methods.cancelClass = function(reason, cancelledBy, cancelledByRole = 'admin', refundIssued = false) {
  this.cancellation.reason = reason;
  this.cancellation.cancelledAt = new Date();
  this.cancellation.cancelledBy = cancelledBy;
  this.cancellation.cancelledByRole = cancelledByRole;
  this.cancellation.refundIssued = refundIssued;
  
  if (cancelledByRole === 'teacher') {
    this.status = 'cancelled_by_teacher';
  } else if (cancelledByRole === 'guardian') {
    this.status = 'cancelled_by_guardian';
  } else {
    this.status = 'cancelled_by_admin';
  }
  this.pendingReschedule = undefined;
  this.markModified('pendingReschedule');
  
  return this.save();
};

// Method to reschedule class
classSchema.methods.reschedule = function(newDate, reason, rescheduledBy) {
  const oldDate = this.scheduledDate;
  
  this.scheduledDate = newDate;
  this.lastModifiedBy = rescheduledBy;
  this.status = 'scheduled'; // Reset status when rescheduled
  this.pendingReschedule = undefined;
  this.markModified('pendingReschedule');
  
  // Add to reschedule history
  if (!this.rescheduleHistory) {
    this.rescheduleHistory = [];
  }
  
  this.rescheduleHistory.push({
    oldDate,
    newDate,
    reason,
    rescheduledBy,
    rescheduledAt: new Date()
  });
  
  return this.save();
};

// Static method to find classes by teacher
classSchema.statics.findByTeacher = function(teacherId, filters = {}) {
  const query = { teacher: teacherId, ...filters };
  return this.find(query).populate('teacher', 'firstName lastName email')
                          .populate('student.guardianId', 'firstName lastName email')
                          .sort({ scheduledDate: -1 });
};

// Static method to find classes by guardian
classSchema.statics.findByGuardian = function(guardianId, filters = {}) {
  const query = { 'student.guardianId': guardianId, ...filters };
  return this.find(query).populate('teacher', 'firstName lastName email')
                          .populate('student.guardianId', 'firstName lastName email')
                          .sort({ scheduledDate: -1 });
};

// Static method to find classes by student
classSchema.statics.findByStudent = function(guardianId, studentId, filters = {}) {
  const query = { 
    'student.guardianId': guardianId, 
    'student.studentId': studentId, 
    ...filters 
  };
  return this.find(query).populate('teacher', 'firstName lastName email')
                          .populate('student.guardianId', 'firstName lastName email')
                          .sort({ scheduledDate: -1 });
};

// Static method to find upcoming classes
classSchema.statics.findUpcoming = function(filters = {}) {
  const query = { 
    scheduledDate: { $gte: new Date() }, 
    status: { $in: ['scheduled', 'in_progress'] },
    hidden: { $ne: true }, // Don't show hidden classes
    ...filters 
  };
  return this.find(query).populate('teacher', 'firstName lastName email')
                          .populate('student.guardianId', 'firstName lastName email')
                          .sort({ scheduledDate: 1 });
};

// Static method to find classes for today
classSchema.statics.findToday = function(filters = {}) {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  
  const query = { 
    scheduledDate: { $gte: startOfDay, $lt: endOfDay },
    ...filters 
  };
  return this.find(query).populate('teacher', 'firstName lastName email')
                          .populate('student.guardianId', 'firstName lastName email')
                          .sort({ scheduledDate: 1 });
};

// Static method to get class statistics
classSchema.statics.getStatistics = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalDuration: { $sum: '$duration' }
      }
    }
  ]);
};

// Static method to find recurring patterns that need new classes generated
classSchema.statics.findPatternsNeedingGeneration = function() {
  const now = new Date();
  return this.find({
    isRecurring: true,
    status: 'pattern',
    'recurrence.endDate': { $gte: now },
    $or: [
      { 'recurrence.lastGenerated': { $exists: false } },
      { 
        'recurrence.lastGenerated': { 
          $lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) // 24 hours ago
        } 
      }
    ]
  });
};

// 💰 PRE-DELETE MIDDLEWARE: Handle invoice recalculation when classes are deleted
// This ensures paid classes are automatically replaced with unpaid ones to maintain financial accuracy
classSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  try {
    const InvoiceService = require('../services/invoiceService');
    console.log(`💰 [Class Pre-Delete] Checking if class ${this._id} needs invoice recalculation`);
    
    // Trigger the deletion handler (async, don't wait for completion)
    InvoiceService.handleClassDeletion(this, { adminUserId: null })
      .then(result => {
        if (result.success && result.invoicesProcessed > 0) {
          console.log(`✅ [Class Pre-Delete] Recalculated ${result.invoicesProcessed} invoice(s)`);
        }
      })
      .catch(err => {
        console.error(`❌ [Class Pre-Delete] Failed to recalculate invoices:`, err);
      });
    
    next();
  } catch (err) {
    console.error('Error in class pre-delete middleware:', err);
    next(); // Don't block deletion even if invoice recalc fails
  }
});

classSchema.pre('findOneAndDelete', async function(next) {
  try {
    const InvoiceService = require('../services/invoiceService');
    const doc = await this.model.findOne(this.getQuery());
    
    if (doc) {
      console.log(`💰 [Class Pre-Delete] Checking if class ${doc._id} needs invoice recalculation`);
      
      // Trigger the deletion handler (async, don't wait for completion)
      InvoiceService.handleClassDeletion(doc, { adminUserId: null })
        .then(result => {
          if (result.success && result.invoicesProcessed > 0) {
            console.log(`✅ [Class Pre-Delete] Recalculated ${result.invoicesProcessed} invoice(s)`);
          }
        })
        .catch(err => {
          console.error(`❌ [Class Pre-Delete] Failed to recalculate invoices:`, err);
        });
    }
    
    next();
  } catch (err) {
    console.error('Error in class findOneAndDelete middleware:', err);
    next(); // Don't block deletion even if invoice recalc fails
  }
});

function scheduleActivityRefresh(doc, contextLabel) {
  if (!doc) return;
  const { teacherId, guardianId, studentId } = extractParticipantIds(doc);
  if (!teacherId && !guardianId) return;
  refreshParticipantsFromSchedule(teacherId, guardianId, studentId).catch((err) => {
    console.warn(`[Class:${contextLabel}] Failed to refresh activity flags`, err.message);
  });
}

classSchema.post('save', function(doc) {
  scheduleActivityRefresh(doc, 'save');
});

classSchema.post('deleteOne', { document: true, query: false }, function(doc) {
  scheduleActivityRefresh(doc, 'deleteOne');
});

classSchema.post('findOneAndDelete', function(doc) {
  scheduleActivityRefresh(doc, 'findOneAndDelete');
});

module.exports = mongoose.model("Class", classSchema);

