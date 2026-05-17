/**
 * Evaluation routes
 *
 * Admin-only CRUD for live assessment sessions, plus a tokenised public
 * endpoint for the student/guardian to submit feedback after the meeting.
 */
const express = require('express');
const EvaluationSession = require('../models/EvaluationSession');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sendMail } = require('../services/emailService');
const notificationService = require('../services/notificationService');

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
    if (!student.feedback.token) student.feedback.token = EvaluationSession.generateFeedbackToken();
    student.feedback.sentTo = to;
    student.feedback.sentAt = new Date();

    const base = resolvePublicAppBaseUrl();
    const link = `${base}/dashboard/evaluation/feedback/${student.feedback.token}`;
    const subject = `How was your Waraqa evaluation, ${student.name}?`;
    const html = `
      <p>Assalāmu ʿalaykum ${student.name},</p>
      <p>Thank you for joining your Waraqa evaluation today. We'd love a moment of your time to tell us how it went — it takes about 30 seconds.</p>
      <p><a href="${link}" style="display:inline-block;background:#0f766e;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Share your feedback</a></p>
      <p style="font-size:12px;color:#6b7280">Or paste this link in your browser:<br/>${link}</p>
    `;
    const text = `Assalāmu ʿalaykum ${student.name},\n\nThank you for joining your Waraqa evaluation today. Please share quick feedback here:\n${link}`;

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

    const r = req.body?.ratings || {};
    student.feedback.ratings = {
      overall: clamp(r.overall),
      knowledge: clamp(r.knowledge),
      friendliness: clamp(r.friendliness),
      clarity: clamp(r.clarity),
      recommend: clamp(r.recommend),
    };
    student.feedback.comment = String(req.body?.comment || '').slice(0, 2000);
    student.feedback.submittedAt = new Date();

    await session.save();

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
        relatedId: session._id,
        actionLink: `/dashboard/evaluation?session=${session._id}`,
      });
    } catch (e) {
      console.warn('[evaluations] notification persist failed', e?.message || e);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[evaluations] public feedback submit failed', err);
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
});

module.exports = router;
