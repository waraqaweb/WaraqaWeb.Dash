// routes/classChangeRequests.js
// Teacher-initiated, admin-approved requests to change future occurrences of
// a class (subject / description / duration / recurrence).

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { authenticateToken, requireRole } = require('../middleware/auth');
const ClassChangeRequest = require('../models/ClassChangeRequest');
const Class = require('../models/Class');
const Setting = require('../models/Setting');
const User = require('../models/User');
const Guardian = require('../models/Guardian');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');

const FEATURE_KEY = 'teacherClassChangeRequestsEnabled';

async function isFeatureEnabled() {
  try {
    const s = await Setting.findOne({ key: FEATURE_KEY });
    return Boolean(s?.value);
  } catch (_) {
    return false;
  }
}

function snapshotFromClass(cls) {
  return {
    title: cls.title || '',
    subject: cls.subject || '',
    description: cls.description || '',
    duration: cls.duration || 60,
    recurrence: cls.recurrence ? {
      frequency: cls.recurrence.frequency || 'weekly',
      interval: cls.recurrence.interval || 1,
      daysOfWeek: Array.isArray(cls.recurrence.daysOfWeek) ? [...cls.recurrence.daysOfWeek] : [],
    } : undefined,
  };
}

function sanitizeRequestedChanges(input = {}) {
  const out = {};
  if (typeof input.subject === 'string' && input.subject.trim()) {
    out.subject = input.subject.trim().slice(0, 100);
  }
  if (typeof input.description === 'string') {
    out.description = input.description.trim().slice(0, 1000);
  }
  if (input.duration !== undefined && input.duration !== null && input.duration !== '') {
    const d = Number(input.duration);
    if (Number.isFinite(d) && d >= 15 && d <= 180) out.duration = d;
  }
  if (input.recurrence && typeof input.recurrence === 'object') {
    const r = {};
    if (['daily', 'weekly', 'biweekly', 'monthly'].includes(input.recurrence.frequency)) {
      r.frequency = input.recurrence.frequency;
    }
    if (input.recurrence.interval) {
      const n = Number(input.recurrence.interval);
      if (Number.isFinite(n) && n >= 1) r.interval = n;
    }
    if (Array.isArray(input.recurrence.daysOfWeek)) {
      const days = input.recurrence.daysOfWeek
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
      if (days.length) r.daysOfWeek = Array.from(new Set(days)).sort((a, b) => a - b);
    }
    if (Object.keys(r).length) out.recurrence = r;
  }
  return out;
}

function hasAnyChange(changes) {
  if (!changes || typeof changes !== 'object') return false;
  if (changes.subject !== undefined) return true;
  if (changes.description !== undefined) return true;
  if (changes.duration !== undefined) return true;
  if (changes.recurrence && Object.keys(changes.recurrence).length > 0) return true;
  return false;
}

async function resolveSeriesRootId(cls) {
  if (cls.parentRecurringClass) return cls.parentRecurringClass;
  // Otherwise the class itself is the root.
  return cls._id;
}

/**
 * GET /api/class-change-requests/feature-status
 * Anyone authenticated can read whether the feature is enabled.
 */
router.get('/feature-status', authenticateToken, async (req, res) => {
  const enabled = await isFeatureEnabled();
  res.json({ success: true, enabled });
});

/**
 * POST /api/class-change-requests
 * Teacher creates a new pending request for a class they teach.
 */
router.post('/', authenticateToken, requireRole(['teacher', 'admin']), async (req, res) => {
  try {
    const enabled = await isFeatureEnabled();
    if (!enabled && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Class change requests are disabled by admin' });
    }

    const { classId, changes, reason } = req.body || {};
    if (!classId || !mongoose.isValidObjectId(classId)) {
      return res.status(400).json({ message: 'classId is required' });
    }

    const sanitized = sanitizeRequestedChanges(changes);
    if (!hasAnyChange(sanitized)) {
      return res.status(400).json({ message: 'No valid changes were provided' });
    }

    const cls = await Class.findById(classId);
    if (!cls) return res.status(404).json({ message: 'Class not found' });

    if (req.user.role === 'teacher' && String(cls.teacher) !== String(req.user._id)) {
      return res.status(403).json({ message: 'You can only request changes for your own classes' });
    }

    // Prevent duplicate pending requests for the same class.
    const existing = await ClassChangeRequest.findOne({
      teacher: req.user._id,
      class: classId,
      status: 'pending',
    });
    if (existing) {
      return res.status(409).json({
        message: 'You already have a pending request for this class',
        requestId: existing._id,
      });
    }

    const seriesRoot = await resolveSeriesRootId(cls);

    const doc = await ClassChangeRequest.create({
      teacher: req.user._id,
      class: cls._id,
      seriesRoot,
      currentSnapshot: snapshotFromClass(cls),
      requestedChanges: sanitized,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 1000) : '',
      status: 'pending',
      submittedAt: new Date(),
    });

    // Notify admin(s).
    try {
      await notificationService.notifyRole({
        role: 'admin',
        title: 'New class change request',
        message: `${req.user.fullName || req.user.email} requested changes to "${cls.title || 'a class'}".`,
        type: 'request',
        related: {
          relatedTo: 'request',
          relatedRequest: doc._id,
          actionRequired: true,
          actionLink: `/dashboard/requests?type=class-change&id=${doc._id}`,
        },
      });
    } catch (e) {
      console.warn('[classChangeRequests] admin notify failed:', e.message);
    }

    // Email admin(s).
    try {
      const admins = await User.find({ role: 'admin', isActive: true }, 'email fullName').lean();
      const summary = buildChangeSummaryHtml(doc.currentSnapshot, doc.requestedChanges);
      const html = emailService.baseEmailTemplate({
        title: 'Class change request',
        bodyHtml: `
          <p>Teacher <strong>${escapeHtml(req.user.fullName || req.user.email)}</strong>
          submitted a request to change the future occurrences of class
          <strong>${escapeHtml(cls.title || '')}</strong>.</p>
          ${summary}
          ${doc.reason ? `<p><strong>Reason:</strong> ${escapeHtml(doc.reason)}</p>` : ''}
          <p>Please review it in the dashboard.</p>
        `,
      });
      for (const a of admins) {
        if (a.email) {
          await emailService.enqueueEmail({
            to: a.email,
            subject: `New class change request — ${cls.title || 'class'}`,
            html,
            type: 'class_change_request',
            relatedId: doc._id,
            priority: 2,
          });
        }
      }
    } catch (e) {
      console.warn('[classChangeRequests] admin email failed:', e.message);
    }

    res.status(201).json({ success: true, request: doc });
  } catch (err) {
    console.error('POST /api/class-change-requests error:', err);
    res.status(500).json({ message: 'Failed to create change request' });
  }
});

/**
 * GET /api/class-change-requests
 * Admin: list all. Teacher: list own.
 * Query: ?status=pending&limit=50
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, limit } = req.query;
    const q = {};
    if (req.user.role === 'teacher') q.teacher = req.user._id;
    if (status && ['pending', 'approved', 'rejected', 'cancelled'].includes(status)) q.status = status;

    const cap = Math.min(Number(limit) || 100, 500);
    const items = await ClassChangeRequest.find(q)
      .sort({ submittedAt: -1 })
      .limit(cap)
      .populate('teacher', 'fullName email')
      .populate('class', 'title subject duration recurrence scheduledDate')
      .populate('reviewedBy', 'fullName email')
      .lean();

    res.json({ success: true, items });
  } catch (err) {
    console.error('GET /api/class-change-requests error:', err);
    res.status(500).json({ message: 'Failed to load change requests' });
  }
});

/**
 * GET /api/class-change-requests/:id
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const doc = await ClassChangeRequest.findById(req.params.id)
      .populate('teacher', 'fullName email')
      .populate('class', 'title subject description duration recurrence teacher guardian students')
      .populate('reviewedBy', 'fullName email')
      .lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });

    if (req.user.role === 'teacher' && String(doc.teacher?._id) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    res.json({ success: true, request: doc });
  } catch (err) {
    console.error('GET /api/class-change-requests/:id error:', err);
    res.status(500).json({ message: 'Failed to load change request' });
  }
});

/**
 * POST /api/class-change-requests/:id/approve
 * Admin: apply the requested changes to FUTURE classes in the series, then
 * email guardian + notify teacher.
 */
router.post('/:id/approve', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { reviewerNotes } = req.body || {};
    const doc = await ClassChangeRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    if (doc.status !== 'pending') {
      return res.status(409).json({ message: `Request is already ${doc.status}` });
    }

    const cls = await Class.findById(doc.class);
    if (!cls) return res.status(404).json({ message: 'Class no longer exists' });

    const effectiveFrom = new Date();
    const changes = doc.requestedChanges || {};
    const $set = {};
    if (typeof changes.subject === 'string') $set.subject = changes.subject;
    if (typeof changes.description === 'string') $set.description = changes.description;
    if (typeof changes.duration === 'number') $set.duration = changes.duration;
    if (changes.recurrence && typeof changes.recurrence === 'object') {
      if (changes.recurrence.frequency) $set['recurrence.frequency'] = changes.recurrence.frequency;
      if (changes.recurrence.interval) $set['recurrence.interval'] = changes.recurrence.interval;
      if (Array.isArray(changes.recurrence.daysOfWeek)) $set['recurrence.daysOfWeek'] = changes.recurrence.daysOfWeek;
    }

    let appliedCount = 0;
    if (Object.keys($set).length > 0) {
      // Update the series root (parent recurring class) so newly-generated
      // future occurrences inherit the new values.
      const rootId = doc.seriesRoot || cls.parentRecurringClass || cls._id;
      try {
        await Class.updateOne({ _id: rootId }, { $set });
        appliedCount += 1;
      } catch (e) {
        console.warn('[classChangeRequests] root update failed:', e.message);
      }

      // Update all future siblings (and the originating class if it is future).
      const seriesFilter = {
        $or: [
          { _id: rootId },
          { parentRecurringClass: rootId },
        ],
        scheduledDate: { $gte: effectiveFrom },
        status: { $nin: ['attended', 'missed_by_student', 'absent', 'cancelled', 'cancelled_by_teacher', 'cancelled_by_student'] },
      };
      try {
        const result = await Class.updateMany(seriesFilter, { $set });
        appliedCount += result.modifiedCount || 0;
      } catch (e) {
        console.warn('[classChangeRequests] siblings update failed:', e.message);
      }

      // If duration changed we should also recompute endsAt — best-effort.
      if (typeof changes.duration === 'number') {
        try {
          const futureDocs = await Class.find({
            $or: [{ _id: rootId }, { parentRecurringClass: rootId }],
            scheduledDate: { $gte: effectiveFrom },
          }).select('_id scheduledDate duration').lean();
          await Promise.all(futureDocs.map((f) => {
            const ends = new Date(new Date(f.scheduledDate).getTime() + (f.duration || changes.duration) * 60000);
            return Class.updateOne({ _id: f._id }, { $set: { endsAt: ends } });
          }));
        } catch (e) {
          console.warn('[classChangeRequests] endsAt recompute failed:', e.message);
        }
      }
    }

    doc.status = 'approved';
    doc.reviewedAt = new Date();
    doc.reviewedBy = req.user._id;
    doc.reviewerNotes = typeof reviewerNotes === 'string' ? reviewerNotes.trim().slice(0, 1000) : '';
    doc.effectiveFrom = effectiveFrom;
    doc.appliedCount = appliedCount;
    await doc.save();

    // Notify teacher (in-app).
    try {
      await notificationService.createNotification({
        userId: doc.teacher,
        title: 'Your class change request was approved',
        message: `Your request to change "${cls.title || 'class'}" has been approved by an administrator.`,
        type: 'request',
        relatedTo: 'request',
        relatedRequest: doc._id,
        actionLink: `/dashboard/classes`,
      });
    } catch (e) {
      console.warn('[classChangeRequests] teacher notify failed:', e.message);
    }

    // Email guardian + student.
    try {
      await sendApprovalEmails({ doc, cls });
    } catch (e) {
      console.warn('[classChangeRequests] approval email failed:', e.message);
    }

    res.json({ success: true, request: doc, appliedCount });
  } catch (err) {
    console.error('POST /api/class-change-requests/:id/approve error:', err);
    res.status(500).json({ message: 'Failed to approve request' });
  }
});

/**
 * POST /api/class-change-requests/:id/reject
 */
router.post('/:id/reject', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { reviewerNotes } = req.body || {};
    const doc = await ClassChangeRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    if (doc.status !== 'pending') {
      return res.status(409).json({ message: `Request is already ${doc.status}` });
    }

    doc.status = 'rejected';
    doc.reviewedAt = new Date();
    doc.reviewedBy = req.user._id;
    doc.reviewerNotes = typeof reviewerNotes === 'string' ? reviewerNotes.trim().slice(0, 1000) : '';
    await doc.save();

    try {
      await notificationService.createNotification({
        userId: doc.teacher,
        title: 'Your class change request was rejected',
        message: doc.reviewerNotes
          ? `Reason: ${doc.reviewerNotes}`
          : 'An administrator declined your request.',
        type: 'request',
        relatedTo: 'request',
        relatedRequest: doc._id,
      });
    } catch (e) {
      console.warn('[classChangeRequests] teacher reject notify failed:', e.message);
    }

    res.json({ success: true, request: doc });
  } catch (err) {
    console.error('POST /api/class-change-requests/:id/reject error:', err);
    res.status(500).json({ message: 'Failed to reject request' });
  }
});

/**
 * DELETE /api/class-change-requests/:id
 * Owner-teacher can cancel a pending request.
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const doc = await ClassChangeRequest.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Not found' });
    const isOwner = String(doc.teacher) === String(req.user._id);
    if (req.user.role !== 'admin' && !isOwner) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (doc.status !== 'pending') {
      return res.status(409).json({ message: `Request is already ${doc.status}` });
    }
    doc.status = 'cancelled';
    doc.reviewedAt = new Date();
    doc.reviewedBy = req.user._id;
    await doc.save();
    res.json({ success: true, request: doc });
  } catch (err) {
    console.error('DELETE /api/class-change-requests/:id error:', err);
    res.status(500).json({ message: 'Failed to cancel request' });
  }
});

// --- helpers ---

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmtRecurrence(r) {
  if (!r) return '';
  const parts = [];
  if (r.frequency) parts.push(r.frequency);
  if (r.interval && r.interval > 1) parts.push(`every ${r.interval}`);
  if (Array.isArray(r.daysOfWeek) && r.daysOfWeek.length) {
    parts.push(r.daysOfWeek.map((d) => DAY_NAMES[d] || d).join(', '));
  }
  return parts.join(' • ');
}

function buildChangeSummaryHtml(current = {}, changes = {}) {
  const rows = [];
  if (typeof changes.subject === 'string' && changes.subject !== current.subject) {
    rows.push(['Subject', current.subject || '—', changes.subject]);
  }
  if (typeof changes.description === 'string' && changes.description !== (current.description || '')) {
    rows.push(['Description', current.description || '—', changes.description || '—']);
  }
  if (typeof changes.duration === 'number' && changes.duration !== current.duration) {
    rows.push(['Duration', `${current.duration || ''} min`, `${changes.duration} min`]);
  }
  if (changes.recurrence && Object.keys(changes.recurrence).length) {
    const merged = { ...(current.recurrence || {}), ...changes.recurrence };
    rows.push(['Schedule', fmtRecurrence(current.recurrence) || '—', fmtRecurrence(merged)]);
  }
  if (!rows.length) return '<p><em>No effective changes.</em></p>';
  const body = rows.map(([label, before, after]) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;"><strong>${escapeHtml(label)}</strong></td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;color:#6b7280;">${escapeHtml(before)}</td>
      <td style="padding:6px 10px;border:1px solid #e5e7eb;">${escapeHtml(after)}</td>
    </tr>`).join('');
  return `
    <table style="border-collapse:collapse;border:1px solid #e5e7eb;margin:8px 0;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Field</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">Before</th>
          <th style="padding:6px 10px;border:1px solid #e5e7eb;text-align:left;">After</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

async function sendApprovalEmails({ doc, cls }) {
  // Resolve guardian email(s) for this class.
  const recipients = new Set();
  try {
    if (cls.guardian) {
      const guardian = await User.findById(cls.guardian).select('email fullName').lean();
      if (guardian?.email) recipients.add(guardian.email);
    }
  } catch (_) { /* ignore */ }

  if (!recipients.size) return;

  const summary = buildChangeSummaryHtml(doc.currentSnapshot, doc.requestedChanges);
  const html = emailService.baseEmailTemplate({
    title: 'Class schedule update',
    bodyHtml: `
      <p>The teacher of <strong>${escapeHtml(cls.title || 'your class')}</strong>
      has updated the class details for upcoming sessions.</p>
      ${summary}
      <p>These changes apply only to future classes; past sessions are unchanged.</p>
      <p>If you have any questions please contact us.</p>
    `,
  });

  for (const to of recipients) {
    await emailService.enqueueEmail({
      to,
      subject: `Update to your class — ${cls.title || ''}`.trim(),
      html,
      type: 'class_change_approved',
      relatedId: doc._id,
      priority: 2,
    });
  }
}

module.exports = router;
