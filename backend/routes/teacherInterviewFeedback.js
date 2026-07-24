/**
 * Post-interview feedback for teacher candidates.
 *
 * Admin-only link generation (from the Interview scorecard for a listed
 * candidate, or standalone for any teacher not in the pipeline), plus a
 * tokenised public endpoint for the teacher to submit feedback — mirrors
 * the evaluation feedback flow in routes/evaluations.js.
 */
const express = require('express');
const TeacherInterviewFeedback = require('../models/TeacherInterviewFeedback');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { upsertTeacherInterviewFeedback } = require('../services/teacherInterviewFeedbackService');
const User = require('../models/User');

const router = express.Router();

function resolvePublicAppBaseUrl() {
  const raw =
    process.env.PUBLIC_APP_URL
    || process.env.APP_BASE_URL
    || process.env.FRONTEND_URL
    || 'https://app.waraqaweb.com';
  return String(raw).split(',')[0].trim().replace(/\/$/, '');
}

const buildLink = (token) => `${resolvePublicAppBaseUrl()}/dashboard/teacher-interview/feedback/${token}`;

// ─── Admin: generate (or reuse) a feedback link ──────────────────────────────
// Works for a candidate already on file (pass candidateSource/candidateId,
// e.g. from the Interview scorecard) or for any teacher not listed anywhere
// in the interview tab (just pass teacherName/contactEmail/contactPhone).
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const teacherName = String(req.body?.teacherName || '').trim().slice(0, 200);
    const contactEmail = String(req.body?.contactEmail || '').trim().toLowerCase().slice(0, 200);
    const contactPhone = String(req.body?.contactPhone || '').trim().slice(0, 50);
    const candidateSource = String(req.body?.candidateSource || '').trim().slice(0, 30) || undefined;
    const candidateId = req.body?.candidateId || undefined;

    if (!teacherName && !contactEmail && !contactPhone) {
      return res.status(400).json({ message: 'Provide at least a name, email, or phone number.' });
    }

    let record = null;
    if (candidateSource && candidateId) {
      record = await TeacherInterviewFeedback.findOne({ candidateSource, candidateId, submittedAt: { $exists: false } });
    }

    if (!record) {
      record = new TeacherInterviewFeedback({
        token: TeacherInterviewFeedback.generateToken(),
        candidateSource,
        candidateId,
        createdBy: req.user._id,
      });
    }

    if (teacherName) record.teacherName = teacherName;
    if (contactEmail) record.contactEmail = contactEmail;
    if (contactPhone) record.contactPhone = contactPhone;
    record.sentAt = new Date();

    await record.save();

    return res.json({ link: buildLink(record.token), token: record.token });
  } catch (error) {
    console.error('[teacher-interview-feedback] generate link failed', error);
    return res.status(500).json({ message: 'Failed to generate feedback link.' });
  }
});

// ─── Public: load minimal context for the feedback page by token ────────────
router.get('/:token', async (req, res) => {
  try {
    const record = await TeacherInterviewFeedback.findOne({ token: req.params.token })
      .select('teacherName submittedAt');
    if (!record) return res.status(404).json({ message: 'Invalid or expired link' });
    return res.json({
      teacherName: record.teacherName || '',
      alreadySubmitted: Boolean(record.submittedAt),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load feedback form' });
  }
});

// ─── Public: submit feedback ──────────────────────────────────────────────────
router.post('/:token', async (req, res) => {
  try {
    const record = await TeacherInterviewFeedback.findOne({ token: req.params.token });
    if (!record) return res.status(404).json({ message: 'Invalid or expired link' });
    if (record.submittedAt) return res.status(409).json({ message: 'Feedback already submitted' });

    const clamp = (n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return undefined;
      return Math.max(1, Math.min(5, Math.round(v)));
    };

    const r = req.body?.ratings || {};
    const ratings = {
      communication: clamp(r.communication),
      scheduling: clamp(r.scheduling),
      professionalism: clamp(r.professionalism),
      roleClarity: clamp(r.roleClarity),
      overallExperience: clamp(r.overallExperience),
    };
    if (Object.values(ratings).some((v) => v == null)) {
      return res.status(400).json({ message: 'Please answer all rating questions' });
    }

    record.ratings = ratings;
    record.improvementSuggestions = String(req.body?.improvementSuggestions || '').slice(0, 2000);
    record.submittedAt = new Date();
    await record.save();

    const { feedback: hubFeedback } = await upsertTeacherInterviewFeedback({ record, markUnread: true });

    try {
      const io = req.app.get('io');
      const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
      const summary = `${ratings.overallExperience}/5 overall`;
      await Promise.allSettled((admins || []).map((admin) => notificationService.createNotification({
        userId: admin._id,
        title: `Interview feedback from ${record.teacherName || 'a candidate'}`,
        message: `${summary}${record.improvementSuggestions ? ' — "' + record.improvementSuggestions.slice(0, 120) + '"' : ''}`,
        type: 'feedback',
        relatedTo: 'feedback',
        relatedId: hubFeedback._id,
        actionLink: '/dashboard/feedbacks',
        metadata: { kind: 'teacher_interview_feedback', teacherInterviewFeedbackId: String(record._id) },
      })));
      if (io) {
        io.to('admin').emit('feedback:new', { feedbackId: hubFeedback._id, type: 'teacher_interview' });
      }
    } catch (notifyErr) {
      console.warn('[teacher-interview-feedback] notification failed', notifyErr.message);
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('[teacher-interview-feedback] submit failed', error);
    return res.status(500).json({ message: 'Failed to submit feedback' });
  }
});

module.exports = router;
