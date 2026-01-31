const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const User = require('../models/User');
const emailService = require('./emailService');
const { formatTimeInTimezone, DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');
const { MEETING_TYPES } = require('../constants/meetingConstants');

const MEETING_TYPE_LABELS = {
  [MEETING_TYPES.NEW_STUDENT_EVALUATION]: 'Evaluation Session',
  [MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]: 'Guardian Follow-up',
  [MEETING_TYPES.TEACHER_SYNC]: 'Teacher Sync'
};

const normalizeObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'object' && value._id) return normalizeObjectId(value._id);
  if (typeof value === 'object' && value.id) return normalizeObjectId(value.id);
  try {
    const str = value.toString();
    if (mongoose.Types.ObjectId.isValid(str)) {
      return new mongoose.Types.ObjectId(str);
    }
  } catch (err) {
    return null;
  }
  return null;
};

/**
 * Send notification to all users of a role (e.g., all admins)
 */
async function notifyRole({ role, title, message, type, related = {} }) {
  const users = await User.find({ role, isActive: true }, '_id');
  if (!users.length) return [];
  const notifications = users.map(u => ({
    user: u._id,
    role,
    title,
    message,
    type,
    ...related
  }));
  return Notification.insertMany(notifications);
}

/**
 * Send a system/broadcast notification (no user, just role or all)
 */
async function notifySystem({ title, message, type, role = null, related = {} }) {
  return Notification.create({
    role,
    title,
    message,
    type,
    ...related
  });
}

// --- USER EVENTS ---
async function notifyNewUser(user) {
  // Notify admin(s)
  await notifyRole({
    role: 'admin',
    title: 'New user registered',
    message: `${user.fullName || user.email} created an account.`,
    type: 'user',
    related: {
      relatedTo: 'user',
      relatedId: user._id,
      metadata: {
        kind: 'new_user',
        userId: String(user._id),
        email: user.email || '',
        role: user.role || ''
      },
      actionLink: user.email
        ? `/dashboard/users?search=${encodeURIComponent(user.email)}`
        : '/dashboard/users'
    }
  });
  // Notify user with onboarding tips
  await module.exports.createNotification({
    userId: user._id,
    title: 'Welcome to Waraqa',
    message: 'To get started, please complete your profile and add your student details.',
    type: 'user',
    relatedTo: 'profile',
    actionRequired: true,
    actionLink: '/profile'
  });
}

async function notifyProfileIncomplete(user) {
  return module.exports.createNotification({
    userId: user._id,
    title: 'Profile incomplete',
    message: 'Please complete your profile so we can coordinate classes and notifications accurately.',
    type: 'user',
    relatedTo: 'profile',
    actionRequired: true,
    actionLink: '/profile'
  });
}

// --- CLASS EVENTS ---
async function notifyClassEvent({
  classObj, eventType, actor, extraMsg = ''
}) {
  // eventType: 'added', 'cancelled', 'rescheduled', 'time_changed'
  const { teacher, student, _id, scheduledDate } = classObj;

  const teacherId = normalizeObjectId(teacher);
  const guardianId = normalizeObjectId(student?.guardianId || student);

  const [teacherUser, guardianUser] = await Promise.all([
    teacherId ? User.findById(teacherId).select('timezone') : null,
    guardianId ? User.findById(guardianId).select('timezone') : null,
  ]);

  const buildCopy = (timeLabel) => {
    const note = extraMsg ? ` ${extraMsg}` : '';
    switch (eventType) {
      case 'added':
        return {
          title: 'Class scheduled',
          message: `Your class is scheduled for ${timeLabel}.${note}`
        };
      case 'cancelled':
        return {
          title: 'Class cancelled',
          message: `Your class scheduled for ${timeLabel} was cancelled.${note}`
        };
      case 'rescheduled':
        return {
          title: 'Class rescheduled',
          message: `Your class has been moved to ${timeLabel}.${note}`
        };
      case 'time_changed':
        return {
          title: 'Class time updated',
          message: `Your class time is now ${timeLabel}.${note}`
        };
      default:
        return {
          title: 'Class updated',
          message: `There’s an update to your class.${note}`
        };
    }
  };

  const formatForUser = (tz) => formatTimeInTimezone(scheduledDate, tz || DEFAULT_TIMEZONE, 'DD MMM YYYY hh:mm A');

  if (teacherId) {
    const tz = teacherUser?.timezone || DEFAULT_TIMEZONE;
    const copy = buildCopy(formatForUser(tz));
    await module.exports.createNotification({
      userId: teacherId,
      title: copy.title,
      message: copy.message,
      type: 'class',
      relatedTo: 'class',
      relatedId: _id,
      metadata: {
        kind: 'class_event',
        eventType,
        classId: String(_id),
        scheduledDate: new Date(scheduledDate).toISOString(),
        recipientTimezone: tz
      }
    });
  }

  if (guardianId) {
    const tz = guardianUser?.timezone || DEFAULT_TIMEZONE;
    const copy = buildCopy(formatForUser(tz));
    await module.exports.createNotification({
      userId: guardianId,
      title: copy.title,
      message: copy.message,
      type: 'class',
      relatedTo: 'class',
      relatedId: _id,
      metadata: {
        kind: 'class_event',
        eventType,
        classId: String(_id),
        scheduledDate: new Date(scheduledDate).toISOString(),
        recipientTimezone: tz
      }
    });
  }
}

// --- INVOICE EVENTS ---
async function notifyInvoiceEvent({ invoice, eventType }) {
  // eventType: 'created', 'paid', 'reminder'
  let title, message;
  switch (eventType) {
    case 'created':
      title = 'Invoice created';
      message = 'A new invoice is available in your account.';
      break;
    case 'paid':
      title = 'Payment received';
      message = 'Thank you—your invoice has been marked as paid.';
      break;
    case 'reminder':
      title = 'Invoice reminder';
      message = 'You have an unpaid invoice. Please review it when you can.';
      break;
    default:
      title = 'Invoice updated';
      message = 'There’s an update to your invoice.';
  }
  await module.exports.createNotification({
    userId: invoice.user,
    title,
    message,
    type: 'invoice',
    relatedTo: 'invoice',
    relatedId: invoice._id
  });
}

// --- FEEDBACK EVENTS ---
async function notifyFeedbackSubmitted({ feedback, toUser }) {
  return module.exports.createNotification({
    userId: toUser,
    title: 'New feedback received',
    message: 'You have new feedback to review.',
    type: 'feedback',
    relatedTo: 'feedback',
    relatedId: feedback._id
  });
}

// --- REQUEST EVENTS ---
async function notifyRequestEvent({ request, eventType, toUser }) {
  let title, message;
  switch (eventType) {
    case 'sent':
      title = 'New request',
      message = 'You have a new request that may require your attention.';
      break;
    case 'approved':
      title = 'Request approved';
      message = 'Your request was approved.';
      break;
    case 'rejected':
      title = 'Request declined';
      message = 'Your request was declined.';
      break;
    default:
      title = 'Request updated';
      message = 'There’s an update to your request.';
  }
  return module.exports.createNotification({
    userId: toUser,
    title,
    message,
    type: 'request',
    relatedTo: 'request',
    relatedId: request._id
  });
}

async function notifyMeetingScheduled({ meeting, adminUser = null, triggeredBy = null } = {}) {
  if (!meeting) return null;

  try {
    const meetingLabel = MEETING_TYPE_LABELS[meeting.meetingType] || 'Meeting';
    const students = Array.isArray(meeting.bookingPayload?.students) ? meeting.bookingPayload.students : [];
    const studentCount = students.length;
    const studentLabel = studentCount ? `${studentCount} student${studentCount === 1 ? '' : 's'}` : null;
    const guardianName = meeting.bookingPayload?.guardianName || null;
    const teacherName = meeting.attendees?.teacherName || null;
    const metadataBase = {
      meetingType: meeting.meetingType,
      meetingLabel,
      scheduledStart: meeting.scheduledStart,
      studentCount,
      guardianName,
      teacherName,
      bookingSource: meeting.bookingSource
    };

    const [adminUserDoc, guardianUserDoc, teacherUserDoc] = await Promise.all([
      meeting.adminId ? User.findById(meeting.adminId).select('timezone') : null,
      meeting.guardianId ? User.findById(meeting.guardianId).select('timezone') : null,
      meeting.teacherId ? User.findById(meeting.teacherId).select('timezone') : null,
    ]);

    const formatFor = (tz) => formatTimeInTimezone(meeting.scheduledStart, tz || DEFAULT_TIMEZONE, 'DD MMM YYYY hh:mm A');
    const notifications = [];

    if (meeting.adminId) {
      const bookedBy = triggeredBy?.fullName || triggeredBy?.email || null;
      const timeLabel = formatFor(adminUserDoc?.timezone);
      const adminMessageParts = [`${meetingLabel} scheduled for ${timeLabel}${studentLabel ? ` • ${studentLabel}` : ''}`];
      if (guardianName) adminMessageParts.push(`Guardian: ${guardianName}`);
      if (teacherName) adminMessageParts.push(`Teacher: ${teacherName}`);
      if (bookedBy) adminMessageParts.push(`Booked by ${bookedBy}`);
      notifications.push(module.exports.createNotification({
        userId: meeting.adminId,
        title: `${meetingLabel} booked`,
        message: adminMessageParts.join(' | '),
        type: 'meeting',
        relatedTo: 'meeting',
        relatedId: meeting._id,
        metadata: { ...metadataBase, recipientTimezone: adminUserDoc?.timezone || DEFAULT_TIMEZONE }
      }));
    }

    if (meeting.guardianId) {
      const timeLabel = formatFor(guardianUserDoc?.timezone);
      const guardianMessage = `Your ${meetingLabel.toLowerCase()} is scheduled for ${timeLabel}.`;
      notifications.push(module.exports.createNotification({
        userId: meeting.guardianId,
        title: `${meetingLabel} confirmed`,
        message: guardianMessage,
        type: 'meeting',
        relatedTo: 'meeting',
        relatedId: meeting._id,
        metadata: { ...metadataBase, recipientTimezone: guardianUserDoc?.timezone || DEFAULT_TIMEZONE }
      }));
    }

    if (meeting.teacherId) {
      const timeLabel = formatFor(teacherUserDoc?.timezone);
      const teacherMessageParts = [`${meetingLabel} scheduled for ${timeLabel}`];
      if (guardianName) teacherMessageParts.push(`with ${guardianName}`);
      const adminName = adminUser?.fullName || adminUser?.firstName || 'Admin team';
      teacherMessageParts.push(`Coordinated by ${adminName}`);
      notifications.push(module.exports.createNotification({
        userId: meeting.teacherId,
        title: `${meetingLabel} scheduled`,
        message: teacherMessageParts.join(' | '),
        type: 'meeting',
        relatedTo: 'meeting',
        relatedId: meeting._id,
        metadata: { ...metadataBase, recipientTimezone: teacherUserDoc?.timezone || DEFAULT_TIMEZONE }
      }));
    }

    if (!notifications.length) {
      return null;
    }

    await Promise.allSettled(notifications);
    return true;
  } catch (error) {
    console.error('[NotificationService] Failed to notify meeting scheduling:', error.message);
    return null;
  }
}

/**
 * Create a new notification
 * @param {Object} data Notification data
 * @param {string} data.userId The user ID to send the notification to
 * @param {string} data.title The notification title
 * @param {string} data.message The notification message
 * @param {string} data.type The type of notification (info, success, warning, error)
 * @param {string} data.relatedTo The related entity (vacation, class, profile, system)
 * @param {string} data.relatedId The related entity ID
 * @param {boolean} data.actionRequired Whether user action is required
 * @param {string} data.actionLink Link for the required action
 */
async function createNotification(data) {
  try {
    const userId = normalizeObjectId(data.userId);
    if (!userId) {
      console.warn('notificationService: skipping notification, invalid userId');
      return null;
    }
    const relatedId = normalizeObjectId(data.relatedId) || data.relatedId;
    // Prevent duplicate notifications: check for same user, title, message, type, relatedTo, relatedId, and unread
    const existing = await Notification.findOne({
      user: userId,
      title: data.title,
      message: data.message,
      type: data.type || 'info',
      relatedTo: data.relatedTo || 'system',
      relatedId,
      isRead: false
    });
    if (existing) {
      return existing;
    }
    const notification = new Notification({
      user: userId,
      title: data.title,
      message: data.message,
      type: data.type || 'info',
      relatedTo: data.relatedTo || 'system',
      relatedId,
      metadata: data.metadata,
      actionRequired: data.actionRequired || false,
      actionLink: data.actionLink
    });
    await notification.save();
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

/**
 * Create a vacation status notification
 * @param {Object} vacation The vacation object
 * @param {Object} approver The admin user who approved/rejected
 */
async function createVacationStatusNotification(vacation, approver) {
  const isApproved = vacation.approvalStatus === 'approved';
  const title = isApproved ? 'Vacation Request Approved' : 'Vacation Request Rejected';
  const endReference = vacation.actualEndDate || vacation.endDate;
  const vacationUser = await User.findById(vacation.user).select('timezone');
  const tz = vacationUser?.timezone || DEFAULT_TIMEZONE;
  const startDate = formatTimeInTimezone(vacation.startDate, tz, 'DD MMM YYYY hh:mm A');
  const endDate = formatTimeInTimezone(endReference, tz, 'DD MMM YYYY hh:mm A');
  
  const message = isApproved
  ? `Your vacation request (${startDate} → ${endDate}) was approved.${vacation.substitutes?.length ? ' Substitute teachers will be assigned.' : ''}`
  : `Your vacation request (${startDate} → ${endDate}) was declined. ${vacation.rejectionReason ? `Reason: ${vacation.rejectionReason}` : ''}`.trim();

  return createNotification({
    userId: vacation.user,
    title,
    message,
    type: isApproved ? 'success' : 'warning',
    relatedTo: 'vacation',
    relatedId: vacation._id,
    actionRequired: isApproved && vacation.role === 'teacher' && !vacation.substitutes?.length,
    actionLink: isApproved ? '/dashboard/vacations' : null
  });
}

/**
 * Mark notifications as read
 * @param {string} userId The user ID
 * @param {Array<string>} notificationIds Array of notification IDs to mark as read
 */
async function markNotificationsAsRead(userId, notificationIds) {
  try {
    await Notification.updateMany(
      { 
        _id: { $in: notificationIds },
        user: userId 
      },
      { $set: { isRead: true } }
    );
  } catch (error) {
    console.error('Error marking notifications as read:', error);
    throw error;
  }
}

/**
 * Get unread notifications count for a user
 * @param {string} userId The user ID
 */
async function getUnreadCount(userId) {
  try {
    return await Notification.countDocuments({ 
      user: userId,
      isRead: false
    });
  } catch (error) {
    console.error('Error getting unread notifications count:', error);
    throw error;
  }
}

/**
 * Get recent notifications for a user
 * @param {string} userId The user ID
 * @param {number} limit Maximum number of notifications to return
 */
async function getRecentNotifications(userId, limit = 10) {
  try {
    return await Notification.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit);
  } catch (error) {
    console.error('Error getting recent notifications:', error);
    throw error;
  }
}

/**
 * Delete a notification belonging to a user
 * @param {string} userId The user ID
 * @param {string} notificationId The notification ID
 */
async function deleteNotification(userId, notificationId) {
  try {
    const result = await Notification.deleteOne({ _id: notificationId, user: userId });
    return { deletedCount: result.deletedCount || 0 };
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
}

// ====================================================================
// TEACHER SALARY NOTIFICATION FUNCTIONS
// ====================================================================

/**
 * Notify teacher that their invoice has been published
 * Sends both in-app and email notification (if enabled in preferences)
 */
async function notifyInvoicePublished(teacherId, invoice) {
  try {
    const teacher = await User.findById(teacherId);
    if (!teacher) {
      console.warn(`[NotificationService] Teacher ${teacherId} not found`);
      return { success: false, reason: 'teacher_not_found' };
    }

    const preferences = teacher.teacherInfo?.notificationPreferences || {};
    const results = { inApp: false, email: false };

    // Create in-app notification (if enabled, default true)
    if (preferences.invoicePublished?.inApp !== false) {
      try {
        await Notification.create({
          user: teacherId,
          role: 'teacher',
          type: 'teacher_salary',
          relatedTo: 'teacher_invoice',
          relatedTeacherInvoice: invoice._id,
          title: `Invoice #${invoice.invoiceNumber} Published`,
          message: `Your salary invoice for ${getMonthName(invoice.month)} ${invoice.year} is now available. Total: ${invoice.netAmountEGP.toFixed(2)} EGP`,
          actionRequired: true,
          actionLink: `/teacher/salary?invoice=${invoice._id}`,
          metadata: {
            invoiceNumber: invoice.invoiceNumber,
            month: invoice.month,
            year: invoice.year,
            totalAmount: invoice.netAmountEGP,
            currency: 'EGP'
          }
        });
        results.inApp = true;
        console.log(`[NotificationService] In-app notification created for invoice ${invoice.invoiceNumber}`);
      } catch (error) {
        console.error('[NotificationService] Failed to create in-app notification:', error.message);
      }
    }

    // Send email notification (if enabled, default true)
    if (preferences.invoicePublished?.email !== false) {
      try {
        const emailResult = await emailService.sendInvoicePublished(teacher, invoice);
        results.email = emailResult.sent;
      } catch (error) {
        console.error('[NotificationService] Failed to send email notification:', error.message);
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('[NotificationService] Error in notifyInvoicePublished:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Notify teacher that payment has been received
 * Sends both in-app and email notification (if enabled in preferences)
 */
async function notifyPaymentReceived(teacherId, invoice) {
  try {
    const teacher = await User.findById(teacherId);
    if (!teacher) {
      console.warn(`[NotificationService] Teacher ${teacherId} not found`);
      return { success: false, reason: 'teacher_not_found' };
    }

    const preferences = teacher.teacherInfo?.notificationPreferences || {};
    const results = { inApp: false, email: false };

    // Create in-app notification (if enabled, default true)
    if (preferences.paymentReceived?.inApp !== false) {
      try {
        await Notification.create({
          user: teacherId,
          role: 'teacher',
          type: 'payment',
          relatedTo: 'teacher_payment',
          relatedTeacherInvoice: invoice._id,
          title: `Payment Received - Invoice #${invoice.invoiceNumber}`,
          message: `Payment of ${invoice.netAmountEGP.toFixed(2)} EGP for ${getMonthName(invoice.month)} ${invoice.year} has been processed successfully.`,
          actionRequired: false,
          actionLink: `/teacher/salary?invoice=${invoice._id}`,
          metadata: {
            invoiceNumber: invoice.invoiceNumber,
            month: invoice.month,
            year: invoice.year,
            amount: invoice.netAmountEGP,
            currency: 'EGP',
            paymentDate: invoice.paidAt,
            paymentMethod: invoice.paymentInfo?.paymentMethod
          }
        });
        results.inApp = true;
        console.log(`[NotificationService] In-app payment notification created for invoice ${invoice.invoiceNumber}`);
      } catch (error) {
        console.error('[NotificationService] Failed to create in-app notification:', error.message);
      }
    }

    // Send email notification (if enabled, default true)
    if (preferences.paymentReceived?.email !== false) {
      try {
        const emailResult = await emailService.sendPaymentReceived(teacher, invoice);
        results.email = emailResult.sent;
      } catch (error) {
        console.error('[NotificationService] Failed to send email notification:', error.message);
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('[NotificationService] Error in notifyPaymentReceived:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Notify teacher that a bonus has been added
 * Sends both in-app and email notification (if enabled in preferences)
 */
async function notifyBonusAdded(teacherId, invoice, bonus) {
  try {
    const teacher = await User.findById(teacherId);
    if (!teacher) {
      console.warn(`[NotificationService] Teacher ${teacherId} not found`);
      return { success: false, reason: 'teacher_not_found' };
    }

    const preferences = teacher.teacherInfo?.notificationPreferences || {};
    const results = { inApp: false, email: false };

    // Create in-app notification (if enabled, default true)
    if (preferences.bonusAdded?.inApp !== false) {
      try {
        await Notification.create({
          user: teacherId,
          role: 'teacher',
          type: 'teacher_salary',
          relatedTo: 'teacher_bonus',
          relatedTeacherInvoice: invoice._id,
          title: `Bonus Added - $${bonus.amountUSD.toFixed(2)} 🎉`,
          message: `A ${bonus.source} bonus of $${bonus.amountUSD.toFixed(2)} has been added to invoice #${invoice.invoiceNumber}. Reason: ${bonus.reason}`,
          actionRequired: false,
          actionLink: `/teacher/salary?invoice=${invoice._id}`,
          metadata: {
            invoiceNumber: invoice.invoiceNumber,
            bonusAmount: bonus.amountUSD,
            bonusSource: bonus.source,
            bonusReason: bonus.reason,
            newTotal: invoice.netAmountEGP
          }
        });
        results.inApp = true;
        console.log(`[NotificationService] In-app bonus notification created for invoice ${invoice.invoiceNumber}`);
      } catch (error) {
        console.error('[NotificationService] Failed to create in-app notification:', error.message);
      }
    }

    // Send email notification (if enabled, default true)
    if (preferences.bonusAdded?.email !== false) {
      try {
        const emailResult = await emailService.sendBonusAdded(teacher, invoice, bonus);
        results.email = emailResult.sent;
      } catch (error) {
        console.error('[NotificationService] Failed to send email notification:', error.message);
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('[NotificationService] Error in notifyBonusAdded:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Notify teacher that an extra has been added
 * Sends both in-app and email notification (if enabled in preferences)
 */
async function notifyExtraAdded(teacherId, invoice, extra) {
  try {
    const teacher = await User.findById(teacherId);
    if (!teacher) {
      console.warn(`[NotificationService] Teacher ${teacherId} not found`);
      return { success: false, reason: 'teacher_not_found' };
    }

    const preferences = teacher.teacherInfo?.notificationPreferences || {};
    const results = { inApp: false, email: false };

    // Create in-app notification (if enabled, default true)
    if (preferences.bonusAdded?.inApp !== false) {
      try {
        await Notification.create({
          user: teacherId,
          role: 'teacher',
          type: 'teacher_salary',
          relatedTo: 'teacher_invoice',
          relatedTeacherInvoice: invoice._id,
          title: `Extra Added - $${extra.amountUSD.toFixed(2)}`,
          message: `An extra payment of $${extra.amountUSD.toFixed(2)} has been added to invoice #${invoice.invoiceNumber}. Description: ${extra.description}`,
          actionRequired: false,
          actionLink: `/teacher/salary?invoice=${invoice._id}`,
          metadata: {
            invoiceNumber: invoice.invoiceNumber,
            extraAmount: extra.amountUSD,
            extraDescription: extra.description,
            newTotal: invoice.netAmountEGP
          }
        });
        results.inApp = true;
        console.log(`[NotificationService] In-app extra notification created for invoice ${invoice.invoiceNumber}`);
      } catch (error) {
        console.error('[NotificationService] Failed to create in-app notification:', error.message);
      }
    }

    // Email notification uses same template as bonus
    if (preferences.bonusAdded?.email !== false) {
      try {
        const bonusLikeExtra = {
          amountUSD: extra.amountUSD,
          source: 'Extra Payment',
          reason: extra.description
        };
        const emailResult = await emailService.sendBonusAdded(teacher, invoice, bonusLikeExtra);
        results.email = emailResult.sent;
      } catch (error) {
        console.error('[NotificationService] Failed to send email notification:', error.message);
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('[NotificationService] Error in notifyExtraAdded:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Notify admins about monthly invoice generation summary
 */
async function notifyAdminInvoiceGeneration(summary) {
  try {
    const admins = await User.find({ role: 'admin', isActive: true });
    
    if (admins.length === 0) {
      console.warn('[NotificationService] No admin users found');
      return { success: false, reason: 'no_admins' };
    }

    const results = [];

    for (const admin of admins) {
      try {
        const hasPeriod = summary && summary.month && summary.year;
        const periodText = hasPeriod ? `${summary.month}/${summary.year}` : null;

        // Create in-app notification
        const totalTeachers = summary.totalProcessed || summary.total || summary.summary?.total || 0;
        const createdCount = summary.created || summary.summary?.created || 0;
        const skippedCount = summary.skipped?.length || summary.summary?.skipped || 0;
        const failedCount = summary.failed?.length || summary.summary?.failed || 0;

        await Notification.create({
          user: admin._id,
          role: 'admin',
          type: 'system',
          relatedTo: 'teacher_invoice',
          title: periodText ? `Teacher Invoices Generated - ${periodText}` : 'Teacher Invoices Generated',
          message: `Processed ${totalTeachers} teachers • Created ${createdCount} invoices • Skipped ${skippedCount} • Failed ${failedCount}.`,
          actionRequired: true,
          actionLink: '/admin/teacher-salaries',
          metadata: summary
        });

        // Send email summary
        const emailResult = await emailService.sendAdminInvoiceGenerationSummary(admin, summary);
        
        results.push({
          adminId: admin._id,
          email: admin.email,
          inApp: true,
          emailSent: emailResult.sent
        });

        console.log(`[NotificationService] Admin notification sent to ${admin.email}`);
      } catch (error) {
        console.error(`[NotificationService] Failed to notify admin ${admin.email}:`, error.message);
        results.push({
          adminId: admin._id,
          email: admin.email,
          error: error.message
        });
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('[NotificationService] Error in notifyAdminInvoiceGeneration:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Notify admins about upcoming monthly invoice generation (24h notice)
 */
async function notifyAdminInvoiceGenerationUpcoming(payload) {
  try {
    const admins = await User.find({ role: 'admin', isActive: true });

    if (admins.length === 0) {
      console.warn('[NotificationService] No admin users found');
      return { success: false, reason: 'no_admins' };
    }

    const results = [];

    for (const admin of admins) {
      try {
        const periodText = payload?.month && payload?.year
          ? `${payload.month}/${payload.year}`
          : 'the upcoming period';

        const steps = Array.isArray(payload?.steps) && payload.steps.length > 0
          ? payload.steps
          : [
            'Check auto-generation setting is enabled',
            'Verify exchange rate is set for the period',
            'Generate draft invoices for teachers with billable hours',
            'Log audit + notify admins with a summary'
          ];

        await Notification.create({
          user: admin._id,
          role: 'admin',
          type: 'system',
          relatedTo: 'teacher_invoice',
          title: `Teacher invoice run in 24h (${periodText})`,
          message: `In 24 hours we will: ${steps.join(' • ')}.`,
          actionRequired: false,
          actionLink: '/admin/teacher-salaries',
          metadata: payload
        });

        results.push({ adminId: admin._id, email: admin.email, inApp: true });
      } catch (error) {
        console.error(`[NotificationService] Failed upcoming notice for admin ${admin.email}:`, error.message);
        results.push({ adminId: admin._id, email: admin.email, error: error.message });
      }
    }

    return { success: true, results };
  } catch (error) {
    console.error('[NotificationService] Error in notifyAdminInvoiceGenerationUpcoming:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Get user's notification preferences for teacher salary events
 */
async function getUserNotificationPreferences(userId) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      return null;
    }

    const preferences = user.teacherInfo?.notificationPreferences || {};
    return {
      invoicePublished: {
        inApp: preferences.invoicePublished?.inApp !== false,
        email: preferences.invoicePublished?.email !== false
      },
      paymentReceived: {
        inApp: preferences.paymentReceived?.inApp !== false,
        email: preferences.paymentReceived?.email !== false
      },
      bonusAdded: {
        inApp: preferences.bonusAdded?.inApp !== false,
        email: preferences.bonusAdded?.email !== false
      }
    };
  } catch (error) {
    console.error('[NotificationService] Error getting preferences:', error.message);
    return null;
  }
}

/**
 * Update user's notification preferences for teacher salary events
 */
async function updateUserNotificationPreferences(userId, preferences) {
  try {
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, reason: 'user_not_found' };
    }

    if (!user.teacherInfo) {
      user.teacherInfo = {};
    }

    user.teacherInfo.notificationPreferences = {
      invoicePublished: {
        inApp: preferences.invoicePublished?.inApp !== false,
        email: preferences.invoicePublished?.email !== false
      },
      paymentReceived: {
        inApp: preferences.paymentReceived?.inApp !== false,
        email: preferences.paymentReceived?.email !== false
      },
      bonusAdded: {
        inApp: preferences.bonusAdded?.inApp !== false,
        email: preferences.bonusAdded?.email !== false
      }
    };

    await user.save();

    console.log(`[NotificationService] Preferences updated for user ${userId}`);
    return { success: true, preferences: user.teacherInfo.notificationPreferences };
  } catch (error) {
    console.error('[NotificationService] Error updating preferences:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Helper: Get month name from month number
 */
function getMonthName(month) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return months[month - 1] || 'Unknown';
}

module.exports = {
  createNotification,
  createVacationStatusNotification,
  markNotificationsAsRead,
  getUnreadCount,
  getRecentNotifications,
  deleteNotification,
  notifyRole,
  notifySystem,
  notifyNewUser,
  notifyProfileIncomplete,
  notifyClassEvent,
  notifyInvoiceEvent,
  notifyFeedbackSubmitted,
  notifyRequestEvent,
  notifyMeetingScheduled,
  // Teacher salary notification functions
  notifyInvoicePublished,
  notifyPaymentReceived,
  notifyBonusAdded,
  notifyExtraAdded,
  notifyAdminInvoiceGeneration,
  notifyAdminInvoiceGenerationUpcoming,
  getUserNotificationPreferences,
  updateUserNotificationPreferences
};