/**
 * Report Submission Service
 * Manages class report submission windows, deadlines, and admin extensions
 */

const Class = require('../models/Class');
const Setting = require('../models/Setting');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

class ReportSubmissionService {
  /**
   * Get system settings for report submission windows
   */
  static async getSubmissionSettings() {
    try {
      const teacherWindowSetting = await Setting.findOne({ key: 'teacher_report_window_hours' });
      const adminExtensionSetting = await Setting.findOne({ key: 'admin_extension_hours' });
      
      return {
        teacherWindowHours: teacherWindowSetting?.value || 72,
        adminExtensionHours: adminExtensionSetting?.value || 24,
      };
    } catch (err) {
      console.error('Error fetching submission settings:', err);
      return {
        teacherWindowHours: 72,
        adminExtensionHours: 24,
      };
    }
  }

  /**
   * Calculate the teacher deadline for a class (72 hours after class end time)
   */
  static calculateTeacherDeadline(scheduledDate, duration, teacherWindowHours = 72) {
    const classEnd = dayjs(scheduledDate).add(duration, 'minutes');
    return classEnd.add(teacherWindowHours, 'hours').toDate();
  }

  /**
   * Initialize report submission tracking for a class that just ended
   */
  static async initializeReportTracking(classId) {
    try {
      const classDoc = await Class.findById(classId);
      if (!classDoc) {
        return { success: false, error: 'Class not found' };
      }

      // Only initialize for classes that have ended
      const classEndTime = dayjs(classDoc.scheduledDate).add(classDoc.duration, 'minutes');
      if (dayjs().isBefore(classEndTime)) {
        return { success: false, error: 'Class has not ended yet' };
      }

      // Skip if already initialized
      if (classDoc.reportSubmission?.status !== 'pending') {
        return { success: true, message: 'Already initialized' };
      }

      const settings = await this.getSubmissionSettings();
      const teacherDeadline = this.calculateTeacherDeadline(
        classDoc.scheduledDate,
        classDoc.duration,
        settings.teacherWindowHours
      );

      classDoc.reportSubmission = {
        status: 'open',
        teacherDeadline,
        adminExtension: {
          granted: false,
        },
      };

      await classDoc.save();

      return {
        success: true,
        teacherDeadline,
        message: 'Report tracking initialized',
      };
    } catch (err) {
      console.error('Error initializing report tracking:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if a teacher can submit a report for a class
   */
  static async canTeacherSubmit(classId, userId) {
    try {
      const classDoc = await Class.findById(classId).populate('teacher');
      if (!classDoc) {
        return { canSubmit: false, reason: 'Class not found' };
      }

      // Check if user is the teacher
      if (classDoc.teacher._id.toString() !== userId.toString()) {
        return { canSubmit: false, reason: 'Not authorized - you are not the teacher for this class' };
      }

      // Admin bypass - always allow
      const User = require('../models/User');
      const user = await User.findById(userId);
      if (user && user.role === 'admin') {
        return { canSubmit: true, reason: 'Admin override' };
      }

      // Check if report already submitted
      if (classDoc.classReport?.submittedAt) {
        return { canSubmit: false, reason: 'Report already submitted', isSubmitted: true };
      }

      // Check if marked as unreported
      if (classDoc.reportSubmission?.status === 'unreported') {
        return {
          canSubmit: false,
          reason: 'Report submission window has expired and class is marked as unreported. Contact admin for extension.',
          isUnreported: true,
        };
      }

      // Initialize tracking if class has ended and status is still pending
      const classEndTime = dayjs(classDoc.scheduledDate).add(classDoc.duration, 'minutes');
      if (dayjs().isAfter(classEndTime) && classDoc.reportSubmission?.status === 'pending') {
        await this.initializeReportTracking(classId);
        // Re-fetch the class to get updated data
        const updatedClass = await Class.findById(classId);
        return this.canTeacherSubmit(classId, userId);
      }

      // Check if class hasn't ended yet
      if (dayjs().isBefore(classEndTime)) {
        return {
          canSubmit: true,
          reason: 'Class in progress or scheduled',
          timeRemaining: null,
        };
      }

      const now = dayjs();
      
      // Check if admin extension is active
      if (classDoc.reportSubmission?.adminExtension?.granted) {
        const extensionExpiry = dayjs(classDoc.reportSubmission.adminExtension.expiresAt);
        if (now.isBefore(extensionExpiry)) {
          return {
            canSubmit: true,
            reason: 'Admin extension granted',
            timeRemaining: extensionExpiry.diff(now, 'hours', true),
            isExtended: true,
            expiresAt: extensionExpiry.toDate(),
          };
        } else {
          // Extension expired - mark as unreported
          await this.markAsUnreported(classId);
          return {
            canSubmit: false,
            reason: 'Admin extension has expired. Contact admin for another extension.',
            isUnreported: true,
          };
        }
      }

      // Check regular teacher deadline
      const teacherDeadline = dayjs(classDoc.reportSubmission?.teacherDeadline);
      if (now.isBefore(teacherDeadline)) {
        return {
          canSubmit: true,
          reason: 'Within submission window',
          timeRemaining: teacherDeadline.diff(now, 'hours', true),
          deadline: teacherDeadline.toDate(),
        };
      }

      // Deadline passed - mark as unreported
      await this.markAsUnreported(classId);
      return {
        canSubmit: false,
        reason: 'Submission deadline has passed. Contact admin for extension.',
        isUnreported: true,
      };
    } catch (err) {
      console.error('Error checking submission eligibility:', err);
      return { canSubmit: false, reason: 'Server error', error: err.message };
    }
  }

  /**
   * Grant admin extension for report submission
   */
  static async grantAdminExtension(classId, adminUserId, extensionHours = null, reason = '') {
    try {
      const classDoc = await Class.findById(classId);
      if (!classDoc) {
        return { success: false, error: 'Class not found' };
      }

      // Check if report already submitted
      if (classDoc.classReport?.submittedAt) {
        return { success: false, error: 'Report already submitted' };
      }

      const settings = await this.getSubmissionSettings();
      const hours = extensionHours || settings.adminExtensionHours;
      const expiresAt = dayjs().add(hours, 'hours').toDate();

      // Initialize report submission if needed
      if (!classDoc.reportSubmission) {
        const teacherDeadline = this.calculateTeacherDeadline(
          classDoc.scheduledDate,
          classDoc.duration,
          settings.teacherWindowHours
        );
        classDoc.reportSubmission = {
          status: 'admin_extended',
          teacherDeadline,
          adminExtension: {
            granted: false,
          },
        };
      }

      classDoc.reportSubmission.status = 'admin_extended';
      classDoc.reportSubmission.adminExtension = {
        granted: true,
        grantedAt: new Date(),
        grantedBy: adminUserId,
        expiresAt,
        reason: reason || `Extension granted for ${hours} hours`,
      };

      await classDoc.save();

      return {
        success: true,
        expiresAt,
        extensionHours: hours,
        message: `Extension granted until ${dayjs(expiresAt).format('MMM DD, YYYY hh:mm A')}`,
      };
    } catch (err) {
      console.error('Error granting admin extension:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Mark a class as unreported (after deadline expires)
   */
  static async markAsUnreported(classId, markedBy = null) {
    try {
      const classDoc = await Class.findById(classId);
      if (!classDoc) {
        return { success: false, error: 'Class not found' };
      }

      // Skip if already marked
      if (classDoc.reportSubmission?.status === 'unreported') {
        return { success: true, message: 'Already marked as unreported' };
      }

      // Skip if report was submitted
      if (classDoc.classReport?.submittedAt) {
        return { success: false, error: 'Report already submitted' };
      }

      if (!classDoc.reportSubmission) {
        classDoc.reportSubmission = {};
      }

      classDoc.reportSubmission.status = 'unreported';
      classDoc.reportSubmission.markedUnreportedAt = new Date();
      if (markedBy) {
        classDoc.reportSubmission.markedUnreportedBy = markedBy;
      }

      await classDoc.save();

      return {
        success: true,
        message: 'Class marked as unreported',
      };
    } catch (err) {
      console.error('Error marking class as unreported:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Find all classes with expired submission windows and mark them as unreported
   */
  static async processExpiredSubmissions() {
    try {
      const now = new Date();
      
      // Find classes where:
      // 1. Report not submitted
      // 2. Deadline passed OR extension expired
      // 3. Not already marked as unreported
      const expiredClasses = await Class.find({
        'classReport.submittedAt': { $exists: false },
        'reportSubmission.status': { $in: ['open', 'admin_extended'] },
        $or: [
          // Regular deadline expired
          {
            'reportSubmission.adminExtension.granted': { $ne: true },
            'reportSubmission.teacherDeadline': { $lt: now },
          },
          // Extension expired
          {
            'reportSubmission.adminExtension.granted': true,
            'reportSubmission.adminExtension.expiresAt': { $lt: now },
          },
        ],
      });

      let markedCount = 0;
      for (const classDoc of expiredClasses) {
        const result = await this.markAsUnreported(classDoc._id);
        if (result.success) {
          markedCount++;
        }
      }

      return {
        success: true,
        processed: expiredClasses.length,
        marked: markedCount,
        message: `Processed ${expiredClasses.length} expired classes, marked ${markedCount} as unreported`,
      };
    } catch (err) {
      console.error('Error processing expired submissions:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Get report submission status for a class
   */
  static async getSubmissionStatus(classId) {
    try {
      const classDoc = await Class.findById(classId)
        .populate('teacher', 'firstName lastName email')
        .populate('reportSubmission.adminExtension.grantedBy', 'firstName lastName');

      if (!classDoc) {
        return { success: false, error: 'Class not found' };
      }

      const classEndTime = dayjs(classDoc.scheduledDate).add(classDoc.duration, 'minutes');
      const now = dayjs();

      const status = {
        classEnded: now.isAfter(classEndTime),
        classEndTime: classEndTime.toDate(),
        reportSubmitted: !!classDoc.classReport?.submittedAt,
        submittedAt: classDoc.classReport?.submittedAt,
        submittedBy: classDoc.classReport?.submittedBy,
        canSubmit: false,
        timeRemaining: null,
        deadline: null,
        status: classDoc.reportSubmission?.status || 'pending',
        adminExtension: null,
      };

      // If report submitted
      if (status.reportSubmitted) {
        status.status = 'submitted';
        return { success: true, status };
      }

      // If class hasn't ended
      if (!status.classEnded) {
        status.canSubmit = true;
        return { success: true, status };
      }

      // Check admin extension
      if (classDoc.reportSubmission?.adminExtension?.granted) {
        const expiresAt = dayjs(classDoc.reportSubmission.adminExtension.expiresAt);
        status.adminExtension = {
          granted: true,
          grantedAt: classDoc.reportSubmission.adminExtension.grantedAt,
          grantedBy: classDoc.reportSubmission.adminExtension.grantedBy,
          expiresAt: expiresAt.toDate(),
          reason: classDoc.reportSubmission.adminExtension.reason,
          expired: now.isAfter(expiresAt),
        };

        if (now.isBefore(expiresAt)) {
          status.canSubmit = true;
          status.deadline = expiresAt.toDate();
          status.timeRemaining = expiresAt.diff(now, 'hours', true);
        }
      }

      // Check regular deadline
      if (classDoc.reportSubmission?.teacherDeadline && !status.adminExtension) {
        const deadline = dayjs(classDoc.reportSubmission.teacherDeadline);
        status.deadline = deadline.toDate();
        
        if (now.isBefore(deadline)) {
          status.canSubmit = true;
          status.timeRemaining = deadline.diff(now, 'hours', true);
        }
      }

      return { success: true, status };
    } catch (err) {
      console.error('Error getting submission status:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Submit report as admin (bypasses all restrictions)
   */
  static async submitAsAdmin(classId, reportData, adminUserId) {
    try {
      const classDoc = await Class.findById(classId);
      if (!classDoc) {
        return { success: false, error: 'Class not found' };
      }

      // Admin can always submit
      classDoc.classReport = {
        ...reportData,
        submittedAt: new Date(),
        submittedBy: adminUserId,
      };

      // Update status
      if (classDoc.reportSubmission) {
        classDoc.reportSubmission.status = 'submitted';
      } else {
        const settings = await this.getSubmissionSettings();
        const teacherDeadline = this.calculateTeacherDeadline(
          classDoc.scheduledDate,
          classDoc.duration,
          settings.teacherWindowHours
        );
        
        classDoc.reportSubmission = {
          status: 'submitted',
          teacherDeadline,
          adminExtension: {
            granted: false,
          },
        };
      }

      // Update attendance based on report
      classDoc.attendance = classDoc.attendance || {};
      classDoc.attendance.markedAt = new Date();
      classDoc.attendance.markedBy = adminUserId;

      if (reportData.attendance === 'attended') {
        classDoc.attendance.teacherPresent = true;
        classDoc.attendance.studentPresent = true;
        classDoc.status = 'attended';
      } else if (reportData.attendance === 'missed_by_student') {
        classDoc.attendance.teacherPresent = true;
        classDoc.attendance.studentPresent = false;
        classDoc.status = 'missed_by_student';
      } else if (reportData.attendance === 'cancelled_by_teacher') {
        classDoc.attendance.teacherPresent = false;
        classDoc.attendance.studentPresent = true;
        classDoc.status = 'cancelled_by_teacher';
      } else if (reportData.attendance === 'no_show_both') {
        classDoc.attendance.teacherPresent = false;
        classDoc.attendance.studentPresent = false;
        classDoc.status = 'no_show_both';
      }

      await classDoc.save();

      return {
        success: true,
        message: 'Report submitted by admin',
        class: classDoc,
      };
    } catch (err) {
      console.error('Error submitting report as admin:', err);
      return { success: false, error: err.message };
    }
  }
}

module.exports = ReportSubmissionService;
