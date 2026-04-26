/**
 * Email Settings Routes (admin-only)
 * Mounted at /api/settings/email
 */
const express = require('express');
const { body, validationResult } = require('express-validator');
const Setting = require('../models/Setting');
const EmailLog = require('../models/EmailLog');
const EmailQueue = require('../models/EmailQueue');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { encryptSMTPPass, decryptSMTPPass } = require('../utils/emailCrypto');
const { invalidateGlobalSwitchCache } = require('../utils/emailPreferenceCheck');
const {
  sendMail, loadBrandingAndLogo, invalidateBrandingCache, enqueueEmail,
  buildClassCreatedEmail, buildClassCancelledEmail, buildClassRescheduledEmail,
  buildRegistrationWelcomeEmail, buildNewStudentEmail, buildStudentDeletedEmail,
  buildAdminNewUserEmail, buildPoorPerformanceEmail, buildConsecutiveAbsentEmail,
  buildMonthlyStudentReportEmail, buildGuardianInvoiceCreatedEmail, buildAdminNewInvoiceEmail,
  buildMeetingScheduledEmail, buildVacationApprovedEmail, buildVacationGuardianNoticeEmail,
  buildTeacherReassignedEmail, buildSeriesCancelledEmail, buildAvailabilityChangedEmail,
  buildTeacherInvoiceEmail, buildAdminMonthlyReportEmail, buildSystemAlertEmail,
} = require('../services/emailService');

const router = express.Router();
router.use(authenticateToken, requireAdmin);

// ── SMTP config ───────────────────────────────────────────────────────────────

const SMTP_KEYS = ['email.fromName', 'email.fromAddress', 'email.smtpHost', 'email.smtpPort', 'email.smtpUser', 'email.smtpPass'];

router.get('/config', async (req, res) => {
  try {
    const settings = await Setting.find({ key: { $in: SMTP_KEYS } }).lean();
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    res.json({
      fromName:    map['email.fromName']    || '',
      fromAddress: map['email.fromAddress'] || '',
      smtpHost:    map['email.smtpHost']    || '',
      smtpPort:    map['email.smtpPort']    || '587',
      smtpUser:    map['email.smtpUser']    || '',
      smtpPassSet: !!(map['email.smtpPass']),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/config', [
  body('fromName').trim().notEmpty().withMessage('From name required'),
  body('fromAddress').isEmail().withMessage('Valid from address required'),
  body('smtpHost').trim().notEmpty().withMessage('SMTP host required'),
  body('smtpPort').isInt({ min: 1, max: 65535 }).withMessage('Valid port required'),
  body('smtpUser').trim().notEmpty().withMessage('SMTP user required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

  try {
    const { fromName, fromAddress, smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
    const updates = [
      { key: 'email.fromName',    value: fromName },
      { key: 'email.fromAddress', value: fromAddress },
      { key: 'email.smtpHost',    value: smtpHost },
      { key: 'email.smtpPort',    value: String(smtpPort) },
      { key: 'email.smtpUser',    value: smtpUser },
    ];
    if (smtpPass && smtpPass.trim()) {
      updates.push({ key: 'email.smtpPass', value: encryptSMTPPass(smtpPass.trim()) });
    }
    await Promise.all(updates.map(u =>
      Setting.findOneAndUpdate({ key: u.key }, { value: u.value }, { upsert: true, new: true })
    ));
    res.json({ message: 'SMTP config saved' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Send test email ───────────────────────────────────────────────────────────

const PRIORITY_GAP_MS = { 1: 0, 2: 2000, 3: 5000 };

/**
 * Build a demo template by type.
 * Returns { subject, html, text } from the actual builder with fake data.
 */
async function buildTestTemplate(type, adminUser, branding) {
  const now  = new Date();
  const soon = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const tz   = adminUser.timezone || 'Africa/Cairo';

  const recipient = { firstName: adminUser.firstName || 'Admin', timezone: tz };
  const teacher   = { firstName: 'Sara', lastName: 'Hassan', timezone: tz };
  const guardian  = { firstName: adminUser.firstName || 'Guardian', timezone: tz };
  const student   = { firstName: 'Ahmed', lastName: 'Ali', grade: 'Grade 5' };
  const classObj  = { courseName: 'Quran Recitation', scheduledDate: soon, durationMinutes: 45, recurrence: { type: 'weekly' }, meetingLink: 'https://meet.google.com/demo-test' };
  const invoice   = { invoiceNumber: 'INV-2025-001', billingPeriodLabel: 'April 2025', totalAmountDue: 150, currency: 'USD', month: 4, year: 2025 };
  const meeting   = { startTime: soon, durationMinutes: 30, type: 'Parent Meeting', meetingLink: 'https://meet.google.com/demo-meeting' };
  const vacation  = { startDate: soon, endDate: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000) };
  const teacherInv = { invoiceNumber: 'TINV-2025-001', month: 4, year: 2025, totalHours: 32, netAmountEGP: 4800 };
  const reportData = { month: 4, year: 2025, students: [{ studentName: 'Ahmed Ali', attendedCount: 12, absentCount: 1, totalHours: 9.0, avgPerformance: 4.2 }] };
  const monthlyStats = { month: 4, year: 2025, stats: { classesHeld: 140, attendanceRate: 94, newRegistrations: 8, activeStudents: 62, activeTeachers: 14, reportRate: 97 }, prevStats: { classesHeld: 125, attendanceRate: 91, newRegistrations: 5, activeStudents: 58, activeTeachers: 13, reportRate: 94 }, topTeachers: [{ name: 'Sara Hassan', classesReported: 22, hoursReported: 18.5 }], topStudents: [{ name: 'Ahmed Ali', attendedCount: 12, avgPerformance: 4.2 }] };

  const map = {
    classCreated:          () => buildClassCreatedEmail({ recipient, classObj, student, role: 'guardian', branding }),
    classCancelled:        () => buildClassCancelledEmail({ recipient, classObj, reason: 'Teacher unavailable', branding }),
    classRescheduled:      () => buildClassRescheduledEmail({ recipient, classObj, oldDate: now, branding }),
    registration:          () => buildRegistrationWelcomeEmail({ user: { ...adminUser, role: 'guardian' }, branding }),
    newStudent:            () => buildNewStudentEmail({ guardian, student, branding }),
    studentDeleted:        () => buildStudentDeletedEmail({ guardian, student, branding }),
    adminNewUser:          () => buildAdminNewUserEmail({ admin: recipient, newUser: { ...adminUser, role: 'guardian', createdAt: now }, branding }),
    poorPerformance:       () => buildPoorPerformanceEmail({ guardian, student, classObj, teacherNote: 'Student needs extra practice on tajweed rules.', performanceRating: 3, branding }),
    consecutiveAbsent:     () => buildConsecutiveAbsentEmail({ guardian, student, teacher, branding }),
    monthlyStudentReport:  () => buildMonthlyStudentReportEmail({ guardian, reportData, branding }),
    invoiceCreated:        () => buildGuardianInvoiceCreatedEmail({ guardian, invoice, branding }),
    adminNewInvoice:       () => buildAdminNewInvoiceEmail({ admin: recipient, invoice, guardian, branding }),
    meetingScheduled:      () => buildMeetingScheduledEmail({ recipient, meeting, calendarLink: 'https://calendar.google.com/demo', branding }),
    vacationApproved:      () => buildVacationApprovedEmail({ teacher, vacation, branding }),
    vacationGuardianNotice:() => buildVacationGuardianNoticeEmail({ guardian, teacher, vacation, branding }),
    teacherReassigned:     () => buildTeacherReassignedEmail({ teacher, classObj, student, lastTopic: 'Surah Al-Baqarah verse 1–10', branding }),
    seriesCancelled:       () => buildSeriesCancelledEmail({ recipient, teacher, student, subject: 'Quran Recitation', branding }),
    availabilityChanged:   () => buildAvailabilityChangedEmail({ admin: recipient, teacher, branding }),
    teacherInvoice:        () => buildTeacherInvoiceEmail({ teacher, invoice: teacherInv, isMonthly: true, branding }),
    adminMonthlyReport:    () => buildAdminMonthlyReportEmail({ admin: recipient, reportData: monthlyStats, branding }),
    systemAlert:           () => buildSystemAlertEmail({ admin: recipient, message: 'This is a test system alert from the email test panel.', branding }),
  };

  const fn = map[type];
  if (!fn) return null;
  return fn();
}

router.post('/test', async (req, res) => {
  try {
    const admin = await User.findById(req.user.id).select('email firstName timezone').lean();
    if (!admin?.email) return res.status(400).json({ message: 'Admin email not found' });

    const to       = (req.body.to || admin.email).trim();
    const types    = Array.isArray(req.body.types) && req.body.types.length > 0
      ? req.body.types
      : (req.body.type ? [req.body.type] : ['classCreated']);

    const branding = await loadBrandingAndLogo();
    const results  = [];
    const allTypes = Object.keys({
      classCreated:1,classCancelled:1,classRescheduled:1,registration:1,newStudent:1,studentDeleted:1,
      adminNewUser:1,poorPerformance:1,consecutiveAbsent:1,monthlyStudentReport:1,invoiceCreated:1,
      adminNewInvoice:1,meetingScheduled:1,vacationApproved:1,vacationGuardianNotice:1,
      teacherReassigned:1,seriesCancelled:1,availabilityChanged:1,teacherInvoice:1,adminMonthlyReport:1,systemAlert:1,
    });

    const resolvedTypes = types[0] === 'all' ? allTypes : types;

    for (const type of resolvedTypes) {
      const t0  = Date.now();
      let status = 'sent', error = null;
      try {
        const tpl = await buildTestTemplate(type, admin, branding);
        if (!tpl) { results.push({ type, status: 'skipped', error: 'Unknown type', durationMs: 0, throttleMs: 0 }); continue; }

        // Determine throttle gap (priority 2 = transactional = 2000ms gap)
        const priority  = 2;
        const throttleMs = PRIORITY_GAP_MS[priority];

        await sendMail({ to, subject: `[TEST] ${tpl.subject}`, html: tpl.html, text: tpl.text });
        // EmailLog.create is best-effort — test type keys don't always match enum values
        EmailLog.create({ to, subject: `[TEST] ${tpl.subject}`, type: 'other', status: 'sent', userId: admin._id, sentAt: new Date() }).catch(() => {});

        const durationMs = Date.now() - t0;
        results.push({ type, status: 'sent', durationMs, throttleMs, subject: tpl.subject });

        // Respect throttle between batch sends
        if (resolvedTypes.length > 1 && throttleMs > 0) {
          await new Promise(r => setTimeout(r, throttleMs));
        }
      } catch (err) {
        results.push({ type, status: 'failed', error: err.message, durationMs: Date.now() - t0, throttleMs: 0 });
      }
    }

    const allSent   = results.every(r => r.status === 'sent');
    const sentCount = results.filter(r => r.status === 'sent').length;
    res.json({
      message: allSent ? `${sentCount} test email${sentCount !== 1 ? 's' : ''} sent to ${to}` : `${sentCount}/${results.length} sent to ${to}`,
      to,
      results,
      totalDurationMs: results.reduce((s, r) => s + (r.durationMs || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Global switches ───────────────────────────────────────────────────────────

const SWITCH_KEYS = ['email.masterEnabled', 'email.enableTeachers', 'email.enableGuardians', 'email.enableAdmins'];

router.get('/global-switches', async (req, res) => {
  try {
    const settings = await Setting.find({ key: { $in: SWITCH_KEYS } }).lean();
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    res.json({
      masterEnabled:  map['email.masterEnabled']  !== 'false',
      enableTeachers: map['email.enableTeachers'] !== 'false',
      enableGuardians:map['email.enableGuardians']!== 'false',
      enableAdmins:   map['email.enableAdmins']   !== 'false',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/global-switches', async (req, res) => {
  try {
    const { masterEnabled, enableTeachers, enableGuardians, enableAdmins } = req.body;
    const updates = [
      { key: 'email.masterEnabled',   value: String(!!masterEnabled) },
      { key: 'email.enableTeachers',  value: String(!!enableTeachers) },
      { key: 'email.enableGuardians', value: String(!!enableGuardians) },
      { key: 'email.enableAdmins',    value: String(!!enableAdmins) },
    ];
    await Promise.all(updates.map(u =>
      Setting.findOneAndUpdate({ key: u.key }, { value: u.value }, { upsert: true, new: true })
    ));
    invalidateGlobalSwitchCache();
    res.json({ message: 'Global switches updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Email log ─────────────────────────────────────────────────────────────────

router.get('/logs', async (req, res) => {
  try {
    const { page = 1, limit = 50, type, status, userId, from, to: toDate } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (userId) filter.userId = userId;
    if (from || toDate) {
      filter.createdAt = {};
      if (from)   filter.createdAt.$gte = new Date(from);
      if (toDate) filter.createdAt.$lte = new Date(toDate);
    }
    const [logs, total] = await Promise.all([
      EmailLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((+page - 1) * +limit)
        .limit(+limit)
        .populate('userId', 'firstName lastName email')
        .lean(),
      EmailLog.countDocuments(filter),
    ]);
    res.json({ logs, total, page: +page, pages: Math.ceil(total / +limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Resend failed email ───────────────────────────────────────────────────────

router.post('/resend/:logId', async (req, res) => {
  try {
    const log = await EmailLog.findById(req.params.logId);
    if (!log) return res.status(404).json({ message: 'Log entry not found' });
    if (log.status !== 'failed') return res.status(400).json({ message: 'Only failed emails can be retried' });

    await enqueueEmail({
      to: log.to,
      subject: log.subject,
      html: log.metadata?.html || '',
      text: log.metadata?.text || '',
      type: log.type,
      userId: log.userId,
      relatedId: log.relatedId,
      priority: 2,
    });
    res.json({ message: 'Re-queued for delivery' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
