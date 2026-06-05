/**
 * Evaluation routes
 *
 * Admin-only CRUD for live assessment sessions, plus a tokenised public
 * endpoint for the student/guardian to submit feedback after the meeting.
 */
const express = require('express');
const EvaluationSession = require('../models/EvaluationSession');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sendMail, loadBrandingAndLogo, baseEmailTemplate } = require('../services/emailService');
const notificationService = require('../services/notificationService');
const { upsertEvaluationFeedbackFromSessionStudent } = require('../services/evaluationFeedbackService');

const router = express.Router();

function resolvePublicAppBaseUrl() {
  const raw =
    process.env.PUBLIC_APP_URL
    || process.env.APP_BASE_URL
    || process.env.FRONTEND_URL
    || 'https://app.waraqaweb.com';
  return String(raw).split(',')[0].trim().replace(/\/$/, '');
}

// ─── Admin: list my recent sessions ──────────────────────────────────────────
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const filter = { admin: req.user._id };
    if (req.query.status === 'active' || req.query.status === 'completed') {
      filter.status = req.query.status;
    }
    // When `full=true`, return the full doc for the most recent matching
    // session inline so the UI avoids a second list→detail round-trip.
    const wantFull = String(req.query.full || '').toLowerCase() === 'true';
    const projection = wantFull
      ? undefined
      : 'title status students.name students.endedAt students.feedback.submittedAt endedAt createdAt updatedAt';
    const query = EvaluationSession.find(filter).sort({ updatedAt: -1 }).limit(limit);
    if (projection) query.select(projection);
    const sessions = await query.lean();
    res.json({ sessions });
  } catch (err) {
    console.error('[evaluations] list failed', err);
    res.status(500).json({ message: 'Failed to list evaluations' });
  }
});

// ─── Admin: get one ──────────────────────────────────────────────────────────
router.get('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const session = await EvaluationSession.findOne({ _id: req.params.id, admin: req.user._id }).lean();
    if (!session) return res.status(404).json({ message: 'Not found' });
    res.json({ session });
  } catch (err) {
    res.status(400).json({ message: 'Invalid id' });
  }
});

// ─── Admin: create new session ───────────────────────────────────────────────
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title } = req.body || {};
    const session = await EvaluationSession.create({
      admin: req.user._id,
      title: (title || '').trim() || `Evaluation ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      students: [],
    });
    res.status(201).json({ session });
  } catch (err) {
    console.error('[evaluations] create failed', err);
    res.status(500).json({ message: 'Failed to create evaluation' });
  }
});

// ─── Admin: update full session (debounced save from the UI) ─────────────────
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const session = await EvaluationSession.findOne({ _id: req.params.id, admin: req.user._id });
    if (!session) return res.status(404).json({ message: 'Not found' });

    const { title, status, students } = req.body || {};
    if (typeof title === 'string') session.title = title.trim().slice(0, 200);
    if (status === 'active' || status === 'completed') {
      session.status = status;
      if (status === 'completed' && !session.endedAt) session.endedAt = new Date();
    }
    if (Array.isArray(students)) {
      // Replace the students array wholesale; the UI is the source of truth.
      session.students = students.map((s) => ({
        ...s,
        // Preserve existing _id when supplied so subdoc identity is stable.
        _id: s._id || undefined,
      }));
    }
    await session.save();
    res.json({ session });
  } catch (err) {
    console.error('[evaluations] update failed', err);
    res.status(500).json({ message: 'Failed to save evaluation' });
  }
});

// ─── Admin: delete ───────────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const deleted = await EvaluationSession.findOneAndDelete({ _id: req.params.id, admin: req.user._id });
    if (!deleted) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: 'Invalid id' });
  }
});

// ─── Admin: send feedback request email for a specific student ───────────────
router.post('/:id/students/:studentSubId/send-feedback', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const session = await EvaluationSession.findOne({ _id: req.params.id, admin: req.user._id });
    if (!session) return res.status(404).json({ message: 'Not found' });
    const student = session.students.id(req.params.studentSubId);
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const to = (req.body?.email || student.contactEmail || '').trim().toLowerCase();
    if (!to) return res.status(400).json({ message: 'A recipient email is required' });

    if (!student.feedback) student.feedback = {};
    if (student.feedback.submittedAt) {
      return res.status(409).json({ message: 'Feedback has already been submitted for this student' });
    }
    student.feedback.token = EvaluationSession.generateFeedbackToken();
    student.feedback.sentTo = to;
    student.feedback.sentAt = new Date();

    const base = resolvePublicAppBaseUrl();
    const link = `${base}/dashboard/evaluation/feedback/${student.feedback.token}`;
    const registerLink = `${base}/dashboard/register-student`;
    const subject = `How was your Waraqa evaluation, ${student.name}?`;
    const branding = await loadBrandingAndLogo();
    const sessionLabel = session.title ? `<strong>${session.title}</strong>` : 'your recent evaluation';

    // Optional curated list of important links from the closing-tab UI.
    const rawLinks = Array.isArray(req.body?.links) ? req.body.links : [];
    const curatedLinks = rawLinks
      .map((l) => l && typeof l === 'object' ? {
        label: String(l.label || '').trim().slice(0, 120),
        url: String(l.url || '').trim().slice(0, 500),
        description: String(l.description || '').trim().slice(0, 500),
      } : null)
      .filter((l) => l && l.label && l.url);

    const linksBlock = curatedLinks.length ? `
      <div style="background:#ffffff;border:1px solid #d1e0de;border-radius:8px;padding:18px 20px;margin:14px 0;">
        <p style="margin:0 0 12px;color:#111827;font-size:14px;font-weight:600;">Helpful links from your evaluator</p>
        <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.7;">
          ${curatedLinks.map((l) => `
            <li style="margin-bottom:6px;">
              <a href="${l.url}" style="color:#0f766e;text-decoration:none;font-weight:600;">${l.label}</a>
              ${l.description ? `<div style="color:#6b7280;font-size:12px;">${l.description}</div>` : ''}
            </li>`).join('')}
        </ul>
      </div>
    ` : '';

    const ctaBlock = `
      <div style="background:linear-gradient(135deg,#ecfdf5,#f0fdfa);border:1px solid #99f6e4;border-radius:10px;padding:18px 20px;margin:14px 0;text-align:center;">
        <p style="margin:0 0 8px;color:#064e3b;font-size:14px;font-weight:700;">Ready to begin your journey with Waraqa?</p>
        <p style="margin:0 0 14px;color:#065f46;font-size:13px;">Register a student account in seconds and book your first lesson.</p>
        <a href="${registerLink}" style="display:inline-block;background:#0f766e;color:white;text-decoration:none;padding:10px 24px;border-radius:6px;font-size:13px;font-weight:600;">Register a Student</a>
      </div>
    `;

    const body = `
      <p style="margin:0 0 14px;font-size:15px;">Assalāmu ʿalaykum <strong>${student.name}</strong>,</p>
      <p style="margin:0 0 14px;color:#374151;">Thank you for joining ${sessionLabel}. It was a pleasure meeting you. We'd love a quick note on how the session went — it should take less than a minute.</p>
      <div style="text-align:center;margin:18px 0;"><a href="${link}" style="display:inline-block;background:#2C736C;color:white;text-decoration:none;padding:11px 30px;border-radius:6px;font-size:14px;font-weight:600;">Open Feedback Form</a></div>
      ${linksBlock}
      ${ctaBlock}
      <p style="font-size:12px;color:#6b7280;margin:12px 0 0;">If the button does not work, copy and paste this link into your browser:</p>
      <p style="font-size:12px;color:#0f766e;word-break:break-all;margin:6px 0 0;">${link}</p>
    `;
    const html = baseEmailTemplate({
      preheader: `Share feedback for ${student.name}`,
      body,
      branding,
    });
    const linksText = curatedLinks.length ? `\n\nHelpful links:\n${curatedLinks.map((l) => `  · ${l.label}: ${l.url}`).join('\n')}` : '';
    const text = `Assalāmu ʿalaykum ${student.name},\n\nThank you for joining your Waraqa evaluation today. Please share quick feedback here:\n${link}${linksText}\n\nRegister a student: ${registerLink}`;

    try {
      await sendMail({ to, subject, html, text });
    } catch (mailErr) {
      console.error('[evaluations] feedback email failed', mailErr);
      // Still save the token so admin can copy the link manually.
      await session.save();
      return res.status(502).json({ message: `Email failed: ${mailErr.message}`, link });
    }

    await session.save();
    res.json({ ok: true, link });
  } catch (err) {
    console.error('[evaluations] send-feedback failed', err);
    res.status(500).json({ message: 'Failed to send feedback request' });
  }
});

// ─── Public: load minimal context for a feedback page by token ───────────────
router.get('/feedback/:token', async (req, res) => {
  try {
    const session = await EvaluationSession.findOne({ 'students.feedback.token': req.params.token })
      .select('title students.feedback students.name students._id')
      .lean();
    if (!session) return res.status(404).json({ message: 'Invalid or expired link' });
    const student = (session.students || []).find((s) => s.feedback?.token === req.params.token);
    if (!student) return res.status(404).json({ message: 'Invalid or expired link' });
    res.json({
      studentName: student.name,
      alreadySubmitted: Boolean(student.feedback?.submittedAt),
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to load feedback form' });
  }
});

// ─── Public: submit feedback ─────────────────────────────────────────────────
router.post('/feedback/:token', async (req, res) => {
  try {
    const session = await EvaluationSession.findOne({ 'students.feedback.token': req.params.token });
    if (!session) return res.status(404).json({ message: 'Invalid or expired link' });
    const student = session.students.find((s) => s.feedback?.token === req.params.token);
    if (!student) return res.status(404).json({ message: 'Invalid or expired link' });
    if (student.feedback.submittedAt) {
      return res.status(409).json({ message: 'Feedback already submitted' });
    }

    const clamp = (n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return undefined;
      return Math.max(1, Math.min(5, Math.round(v)));
    };

    const heardAboutUs = String(req.body?.heardAboutUs || '').trim().slice(0, 500);
    if (!heardAboutUs) {
      return res.status(400).json({ message: 'Please tell us how you heard about Waraqa' });
    }

    const r = req.body?.ratings || {};
    student.feedback.ratings = {
      overall: clamp(r.overall),
      knowledge: clamp(r.knowledge),
      friendliness: clamp(r.friendliness),
      clarity: clamp(r.clarity),
      recommend: clamp(r.recommend),
    };
    student.feedback.comment = String(req.body?.comment || '').slice(0, 2000);
    student.feedback.heardAboutUs = heardAboutUs;
    student.feedback.submittedAt = new Date();

    await session.save();

    const { feedback: hubFeedback } = await upsertEvaluationFeedbackFromSessionStudent({
      session,
      student,
      markUnread: true,
    });

    // Notify admin via socket (best effort).
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(String(session.admin)).emit('evaluation-feedback-received', {
          sessionId: String(session._id),
          studentName: student.name,
          ratings: student.feedback.ratings,
          comment: student.feedback.comment,
        });
        io.to('admin').emit('feedback:new', { feedbackId: hubFeedback._id, type: 'evaluation' });
      }
    } catch (e) { /* noop */ }

    // Persist a Notification for the admin so it appears in the bell menu.
    try {
      const overall = student.feedback.ratings?.overall;
      const summary = overall ? `${overall}/5 overall` : 'New feedback';
      await notificationService.createNotification({
        userId: session.admin,
        title: `Evaluation feedback from ${student.name}`,
        message: `${summary}${student.feedback.comment ? ' — "' + student.feedback.comment.slice(0, 120) + '"' : ''}`,
        type: 'feedback',
        relatedTo: 'feedback',
        relatedId: hubFeedback._id,
        actionLink: '/dashboard/feedbacks',
        metadata: {
          kind: 'evaluation_feedback_submitted',
          feedbackId: String(hubFeedback._id),
          evaluationSessionId: String(session._id),
          evaluationStudentSubId: String(student._id),
        },
      });
    } catch (e) {
      console.warn('[evaluations] notification persist failed', e?.message || e);
    }

    res.json({ ok: true, feedbackId: hubFeedback._id });
  } catch (err) {
    console.error('[evaluations] public feedback submit failed', err);
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
});

module.exports = router;
