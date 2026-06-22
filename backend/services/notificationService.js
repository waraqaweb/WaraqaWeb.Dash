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

const formatDisplayName = (person, fallback = 'User') => {
  if (!person) return fallback;
  const fullName = `${person?.firstName || ''} ${person?.lastName || ''}`.trim();
  return fullName || person?.fullName || person?.email || fallback;
};

const buildAdminUserActionLink = (user) => {
  const search = user?.email ? `?search=${encodeURIComponent(user.email)}` : '';
  if (user?.role === 'guardian') return `/dashboard/guardians${search}`;
  if (user?.role === 'teacher') return `/dashboard/teachers${search}`;
  if (user?.role === 'student') return `/dashboard/students${search}`;
  return '/dashboard';
};

const buildAdminStudentActionLink = (student, guardian) => {
  const searchValue = student?.email || `${student?.firstName || ''} ${student?.lastName || ''}`.trim() || guardian?.email || '';
  return searchValue ? `/dashboard/students?search=${encodeURIComponent(searchValue)}` : '/dashboard/students';
};

async function notifyAdminsLifecycle({
  title,
  message,
  type = 'info',
  relatedTo = 'profile',
  relatedId = null,
  metadata,
  actionLink,
  emailPreferenceKey = null,
  emailType = 'systemAlert',
  emailBuilder = null,
}) {
  const admins = await User.find({ role: 'admin', isActive: true })
    .select('firstName lastName email role timezone guardianInfo.epithet emailPreferences')
    .lean();
  if (!admins.length) return { success: false, reason: 'no_admins', results: [] };

  const branding = emailBuilder ? await emailService.loadBrandingAndLogo() : null;
  const { shouldSendEmail } = emailPreferenceKey ? require('../utils/emailPreferenceCheck') : { shouldSendEmail: null };
  const results = [];

  for (const admin of admins) {
    try {
      await createNotification({
        userId: admin._id,
        title,
        message,
        type,
        relatedTo,
        relatedId,
        metadata,
        actionLink,
      });

      let emailQueued = false;
      if (emailBuilder && admin.email) {
        // Respect the admin's email preference for this lifecycle event before queueing a branded email.
        const canSend = emailPreferenceKey ? await shouldSendEmail(admin._id, emailPreferenceKey) : true;
        if (canSend) {
          const tpl = emailBuilder({ admin, branding });
          await emailService.enqueueEmail({
            to: admin.email,
            subject: tpl.subject,
            html: tpl.html,
            text: tpl.text,
            type: emailType,
            userId: admin._id,
            relatedId: relatedId ? String(relatedId) : undefined,
            priority: 2,
          });
          emailQueued = true;
        }
      }

      results.push({ adminId: admin._id, email: admin.email, inApp: true, emailQueued });
    } catch (error) {
      console.error(`[NotificationService] Failed lifecycle notify for admin ${admin.email || admin._id}:`, error.message);
      results.push({ adminId: admin._id, email: admin.email, inApp: false, emailQueued: false, error: error.message });
    }
  }

  return { success: true, results };
}

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
  const userName = formatDisplayName(user, 'New user');
  await notifyAdminsLifecycle({
    title: 'New user registered',
    message: `${userName} created a ${user.role || 'user'} account.`,
    type: 'user',
    relatedTo: 'profile',
    relatedId: user._id,
    metadata: {
      kind: 'new_user',
      userId: String(user._id),
      email: user.email || '',
      role: user.role || '',
    },
    actionLink: buildAdminUserActionLink(user),
    emailPreferenceKey: 'registration',
    emailType: 'systemAlert',
    emailBuilder: ({ admin, branding }) => emailService.buildAdminNewUserEmail({ admin, newUser: user, branding }),
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

async function notifyUserDeleted(user, deletedBy = null) {
  if (!user?._id) return { success: false, reason: 'invalid_user' };

  const userName = formatDisplayName(user, 'User');
  return notifyAdminsLifecycle({
    title: 'User deleted',
    message: `${userName} (${user.role || 'user'}) was deleted from the platform.`,
    type: 'warning',
    relatedTo: 'profile',
    relatedId: user._id,
    metadata: {
      kind: 'user_deleted',
      userId: String(user._id),
      email: user.email || '',
      role: user.role || '',
    },
    actionLink: buildAdminUserActionLink(user),
    emailPreferenceKey: 'systemAlert',
    emailType: 'systemAlert',
    emailBuilder: ({ admin, branding }) => emailService.buildAdminUserDeletedEmail({ admin, deletedUser: user, deletedBy, branding }),
  });
}

async function notifyStudentCreated({ student, guardian, createdBy = null }) {
  if (!student || !guardian?._id) return { success: false, reason: 'invalid_student_or_guardian' };

  const guardianName = formatDisplayName(guardian, 'Guardian');
  const studentName = `${student?.firstName || ''} ${student?.lastName || ''}`.trim() || 'Student';
  const relatedId = student?._id || guardian?._id;
  const actionLink = buildAdminStudentActionLink(student, guardian);

  await createNotification({
    userId: guardian._id,
    title: 'Student added',
    message: `${studentName} has been added to your account.`,
    type: 'success',
    relatedTo: 'profile',
    relatedId,
    actionLink: '/dashboard/students',
    metadata: {
      kind: 'student_created',
      studentId: student?._id ? String(student._id) : null,
      guardianId: String(guardian._id),
    },
  });

  try {
    const { shouldSendEmail } = require('../utils/emailPreferenceCheck');
    if (guardian.email && await shouldSendEmail(guardian._id, 'studentCreated')) {
      const branding = await emailService.loadBrandingAndLogo();
      const tpl = emailService.buildNewStudentEmail({ guardian, student, branding });
      await emailService.enqueueEmail({
        to: guardian.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        type: 'studentCreated',
        userId: guardian._id,
        relatedId: relatedId ? String(relatedId) : undefined,
        priority: 2,
      });
    }
  } catch (error) {
    console.warn('[NotificationService] Failed to queue guardian new-student email:', error.message);
  }

  return notifyAdminsLifecycle({
    title: 'New student added',
    message: `${studentName} was added under guardian ${guardianName}.`,
    type: 'user',
    relatedTo: 'profile',
    relatedId,
    metadata: {
      kind: 'student_created',
      studentId: student?._id ? String(student._id) : null,
      guardianId: String(guardian._id),
      guardianEmail: guardian.email || '',
      studentEmail: student.email || '',
      grade: student.grade || '',
      school: student.school || '',
      language: student.language || '',
      timezone: student.timezone || '',
      subjects: Array.isArray(student.subjects) ? student.subjects : [],
    },
    actionLink,
    emailPreferenceKey: 'studentCreated',
    emailType: 'studentCreated',
    emailBuilder: ({ admin, branding }) => emailService.buildAdminStudentCreatedEmail({ admin, guardian, student, createdBy, branding }),
  });
}

// --- CLASS EVENTS ---
async function notifyClassEvent({
  classObj, eventType, actor, extraMsg = '', oldDate = null
}) {
  // eventType: 'added', 'cancelled', 'rescheduled', 'time_changed'
  const { teacher, student, _id, scheduledDate } = classObj;
  const isRecurringSeries = Boolean(
    classObj?.isRecurring
    || classObj?.status === 'pattern'
    || (Array.isArray(classObj?.recurrenceDetails) && classObj.recurrenceDetails.length)
  );

  const teacherId = normalizeObjectId(teacher);
  const guardianId = normalizeObjectId(student?.guardianId || student);

  const [teacherUser, guardianUser] = await Promise.all([
    teacherId ? User.findById(teacherId).select('timezone') : null,
    guardianId ? User.findById(guardianId).select('timezone') : null,
  ]);

  const buildCopy = (timeLabel) => {
    const note = extraMsg ? ` ${extraMsg}` : '';
    const subjectLabel = classObj?.subject ? `${classObj.subject}` : 'Class';
    const studentLabel = classObj?.student?.studentName
      || classObj?.studentSnapshot?.studentName
      || classObj?.studentSnapshot?.firstName
      || '';
    const studentText = studentLabel ? ` for ${studentLabel}` : '';
    const baseLine = `${subjectLabel}${studentText}`;
    switch (eventType) {
      case 'added':
        return {
          title: 'Class scheduled',
          message: `${baseLine} is scheduled for ${timeLabel}.${note}`
        };
      case 'cancelled':
        return {
          title: 'Class cancelled',
          message: `${baseLine} scheduled for ${timeLabel} was cancelled.${note}`
        };
      case 'rescheduled':
        return {
          title: 'Class rescheduled',
          message: `${baseLine}${note ? `. ${note.trim()}` : '.'}`
        };
      case 'time_changed':
        return {
          title: 'Class time updated',
          message: `${baseLine}${note ? `. ${note.trim()}` : '.'}`
        };
      default:
        return {
          title: 'Class updated',
          message: `There’s an update to ${baseLine}.${note}`
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
        ...(oldDate ? { oldDate: new Date(oldDate).toISOString() } : {}),
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
        ...(oldDate ? { oldDate: new Date(oldDate).toISOString() } : {}),
        recipientTimezone: tz
      }
    });
  }

  // ── Email hooks for class events ──────────────────────────────────────────
  try {
    const {
      enqueueEmail,
      enqueueCoalescedEmail,
      buildClassCreatedEmail,
      buildClassCancelledEmail,
      buildClassRescheduledEmail,
      loadBrandingAndLogo,
    } = require('./emailService');
    const { shouldSendEmail } = require('../utils/emailPreferenceCheck');
    const eventEmailType = eventType === 'added' ? 'classCreated' : eventType === 'cancelled' ? 'classCancelled' : eventType === 'rescheduled' ? 'classRescheduled' : null;
    if (!eventEmailType) return; // time_changed: no dedicated email
    if (eventType === 'added' && !isRecurringSeries) return;
    const buildFn = eventType === 'added' ? buildClassCreatedEmail : eventType === 'cancelled' ? buildClassCancelledEmail : buildClassRescheduledEmail;

    const teacherUserFull = teacherId ? await User.findById(teacherId).select('email firstName lastName timezone guardianInfo.epithet').lean() : null;
    const guardianUserFull = guardianId ? await User.findById(guardianId).select('email firstName lastName timezone guardianInfo.epithet').lean() : null;

    const branding = await loadBrandingAndLogo();
    const normalizedReason = String(extraMsg || '').replace(/^Note:\s*/i, '').trim();
    const classPayload = {
      subject: classObj.subject,
      scheduledDate: classObj.scheduledDate,
      durationMinutes: classObj.duration,
      meetingLink: classObj.meetingLink,
      recurrence: classObj.recurrence || { type: 'none' },
      recurrenceDetails: Array.isArray(classObj.recurrenceDetails) ? classObj.recurrenceDetails : [],
      isRecurring: isRecurringSeries,
    };
    // Resolve a real student name. Callers usually pass classObj.student as
    // an ObjectId — look it up if so, falling back to any embedded snapshot
    // so the email never shows a blank "Student:" row.
    let studentPayload = {
      firstName: classObj?.student?.firstName
        || classObj?.student?.studentName
        || classObj?.studentSnapshot?.studentName
        || classObj?.studentSnapshot?.firstName
        || '',
      lastName: classObj?.student?.lastName || classObj?.studentSnapshot?.lastName || '',
    };
    if (!studentPayload.firstName) {
      try {
        const studentRef = classObj?.student;
        const studentRefId = studentRef && typeof studentRef === 'object' && studentRef._id ? studentRef._id : studentRef;
        if (studentRefId) {
          const Student = require('../models/Student');
          const sDoc = await Student.findById(studentRefId).select('firstName lastName').lean();
          if (sDoc) {
            studentPayload.firstName = sDoc.firstName || '';
            studentPayload.lastName  = sDoc.lastName  || '';
          }
        }
      } catch (e) { /* non-fatal */ }
    }

    // For reschedules we coalesce per (recipient, classFamily) so that
    // rescheduling 3 occurrences of the same recurring class back-to-back
    // produces ONE consolidated email after a short delay instead of three
    // separate ones. Inbox-friendly + protects sender reputation on free
    // Gmail SMTP.
    const classFamilyKey = String(
      classObj.parentRecurringClass
      || classObj.recurringSeriesId
      || classObj._id
      || _id
    );

    const sendOrCoalesce = async ({ to, tpl, userIdForRow }) => {
      const baseArgs = {
        to,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        type: eventEmailType,
        userId: userIdForRow,
        relatedId: _id,
        priority: 2,
      };
      if (eventEmailType !== 'classRescheduled') {
        return enqueueEmail(baseArgs);
      }
      // Build a date stamp that the merge step can append to the existing
      // body so the consolidated email lists every affected date.
      const tzForUser = (userIdForRow === teacherId ? teacherUserFull?.timezone : guardianUserFull?.timezone) || DEFAULT_TIMEZONE;
      const newWhen = scheduledDate ? formatTimeInTimezone(scheduledDate, tzForUser, 'DD MMM YYYY hh:mm A') : 'TBD';
      const subj = classObj?.subject ? classObj.subject : 'Class';
      return enqueueCoalescedEmail({
        ...baseArgs,
        coalesceKey: `${String(userIdForRow)}:classRescheduled:${classFamilyKey}`,
        delayMs: 90 * 1000,
        maxWindowMs: 5 * 60 * 1000,
        merge: ({ existing, incoming }) => {
          const count = (existing.coalesceCount || 1) + 1;
          // Append a small list row inside the existing HTML body, just
          // before the closing card so the email stays one tidy table.
          const extraLineHtml = `<div style="margin:6px 0 0;padding:8px 12px;border-left:3px solid #d1d5db;color:#374151;font-size:13px;">+ Also rescheduled to <strong>${newWhen}</strong></div>`;
          const mergedHtml = existing.html.includes('</body>')
            ? existing.html.replace('</body>', `${extraLineHtml}</body>`)
            : `${existing.html}${extraLineHtml}`;
          const mergedText = `${existing.text}\n+ Also rescheduled to ${newWhen}`;
          const mergedSubject = `Class rescheduled — ${subj} (${count} updates)`;
          return { subject: mergedSubject, html: mergedHtml, text: mergedText };
        },
      });
    };

    if (teacherUserFull?.email && await shouldSendEmail(teacherId, eventEmailType)) {
      const tpl = await buildFn({
        recipient: teacherUserFull,
        classObj: classPayload,
        student: studentPayload,
        teacher: teacherUserFull,
        role: 'teacher',
        oldDate,
        reason: normalizedReason || undefined,
        branding,
      });
      await sendOrCoalesce({ to: teacherUserFull.email, tpl, userIdForRow: teacherId });
    }
    if (guardianUserFull?.email && await shouldSendEmail(guardianId, eventEmailType)) {
      const tpl = await buildFn({
        recipient: guardianUserFull,
        classObj: classPayload,
        student: studentPayload,
        teacher: teacherUserFull,
        role: 'guardian',
        oldDate,
        reason: normalizedReason || undefined,
        branding,
      });
      await sendOrCoalesce({ to: guardianUserFull.email, tpl, userIdForRow: guardianId });
    }
  } catch (e) {
    console.warn('[Email] class event email failed:', e.message);
  }
}

/**
 * Consolidated notification for a bulk class cancellation.
 * Instead of one message per class, every affected teacher and guardian gets
 * a SINGLE in-app notification (and a single email) summarizing all of the
 * classes that were cancelled in the batch.
 */
async function notifyBulkClassCancellation({ classes = [], actor = null, reason = '' }) {
  if (!Array.isArray(classes) || classes.length === 0) return { success: true, recipients: 0 };

  // Group cancelled classes by recipient (teacher + guardian).
  const groups = new Map(); // userId string -> { userId, role, items: [] }
  const addItem = (userRef, role, item) => {
    const uid = normalizeObjectId(userRef);
    if (!uid) return;
    const key = String(uid);
    if (!groups.has(key)) groups.set(key, { userId: uid, role, items: [] });
    groups.get(key).items.push(item);
  };

  for (const cls of classes) {
    const item = {
      subject: cls.subject || 'Class',
      scheduledDate: cls.scheduledDate || cls.dateTime || null,
      duration: cls.duration || null,
      studentName: cls?.student?.studentName || cls?.studentSnapshot?.studentName || cls?.student?.firstName || '',
      classId: cls._id,
    };
    if (cls.teacher) addItem(cls.teacher, 'teacher', item);
    if (cls?.student?.guardianId) addItem(cls.student.guardianId, 'guardian', item);
  }

  if (groups.size === 0) return { success: true, recipients: 0 };

  let branding = null;
  try { branding = await require('./emailService').loadBrandingAndLogo(); } catch (_) {}
  const reasonClean = String(reason || '').replace(/^Reason:\s*/i, '').trim();

  for (const grp of groups.values()) {
    try {
      const userDoc = await User.findById(grp.userId).select('email firstName lastName timezone').lean();
      const tz = userDoc?.timezone || DEFAULT_TIMEZONE;
      const count = grp.items.length;
      grp.items.sort((a, b) => new Date(a.scheduledDate || 0) - new Date(b.scheduledDate || 0));

      const lines = grp.items.slice(0, 5).map((it) => {
        const when = it.scheduledDate ? formatTimeInTimezone(it.scheduledDate, tz, 'DD MMM YYYY hh:mm A') : 'TBD';
        const who = it.studentName ? ` (${it.studentName})` : '';
        return `• ${it.subject}${who} — ${when}`;
      });
      const more = count > 5 ? `\n…and ${count - 5} more.` : '';
      const title = `${count} ${count === 1 ? 'class' : 'classes'} cancelled`;
      const message = `${count} ${count === 1 ? 'class has' : 'classes have'} been cancelled.${reasonClean ? ` Reason: ${reasonClean}.` : ''}\n${lines.join('\n')}${more}`;

      await module.exports.createNotification({
        userId: grp.userId,
        title,
        message,
        type: 'class',
        relatedTo: 'class',
        relatedId: grp.items[0].classId,
        metadata: { kind: 'bulk_class_cancelled', eventType: 'cancelled', count },
      });

      if (userDoc?.email) {
        try {
          const { enqueueEmail, buildBulkClassCancelledEmail } = require('./emailService');
          const { shouldSendEmail } = require('../utils/emailPreferenceCheck');
          const canSend = await shouldSendEmail(grp.userId, 'classCancelled').catch(() => true);
          if (canSend) {
            const tpl = buildBulkClassCancelledEmail({
              recipient: { firstName: userDoc.firstName, lastName: userDoc.lastName, email: userDoc.email, timezone: tz },
              role: grp.role,
              classes: grp.items,
              reason: reasonClean,
              branding,
            });
            await enqueueEmail({
              to: userDoc.email,
              subject: tpl.subject,
              html: tpl.html,
              text: tpl.text,
              type: 'classCancelled',
              userId: grp.userId,
              priority: 2,
            });
          }
        } catch (mailErr) {
          console.warn('[notifyBulkClassCancellation] email failed:', mailErr.message);
        }
      }
    } catch (grpErr) {
      console.error('[notifyBulkClassCancellation] recipient failed:', grpErr.message);
    }
  }

  return { success: true, recipients: groups.size };
}

// --- INVOICE EVENTS ---
async function notifyInvoiceEvent({ invoice, eventType }) {
  // eventType: 'created', 'paid', 'reminder'
  let title, message;
  const guardianId = normalizeObjectId(invoice?.guardian || invoice?.user);
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

  if (guardianId) {
    await module.exports.createNotification({
      userId: guardianId,
      title,
      message,
      type: 'invoice',
      relatedTo: 'invoice',
      relatedId: invoice._id
    });
  }

  if (eventType === 'created' && guardianId) {
    try {
      const { shouldSendEmail } = require('../utils/emailPreferenceCheck');
      const guardian = await User.findById(guardianId).select('email firstName lastName timezone guardianInfo.epithet').lean();
      if (guardian?.email && await shouldSendEmail(guardianId, 'invoiceCreated')) {
        const branding = await emailService.loadBrandingAndLogo();
        const tpl = emailService.buildGuardianInvoiceCreatedEmail({ guardian, invoice, branding });
        await emailService.enqueueEmail({
          to: guardian.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
          type: 'invoiceCreated',
          userId: guardianId,
          relatedId: invoice._id,
          priority: 2,
        });
      }
    } catch (error) {
      console.warn('[NotificationService] Failed to enqueue invoice created email:', error.message);
    }
  }
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
          title: `Payment Sent - Invoice #${invoice.invoiceNumber}`,
          message: `Payment of ${invoice.netAmountEGP.toFixed(2)} EGP for ${getMonthName(invoice.month)} ${invoice.year} has been sent successfully.`,
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
        const totalTeachers = summary.totalProcessed ?? summary.total ?? summary.summary?.total ?? 0;
        const createdCount = summary.created ?? summary.summary?.created ?? 0;
        const skippedCount = summary.skipped?.length ?? summary.summary?.skipped ?? 0;
        const failedCount = summary.failed?.length ?? summary.summary?.failed ?? 0;

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
  notifyUserDeleted,
  notifyStudentCreated,
  notifyProfileIncomplete,
  notifyClassEvent,
  notifyBulkClassCancellation,
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