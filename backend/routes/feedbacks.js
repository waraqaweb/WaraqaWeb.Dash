const express = require('express');
const router = express.Router();
const Feedback = require('../models/Feedback');
const Class = require('../models/Class');
const User = require('../models/User');
const { authenticateToken, requireTeacherOrAdmin, requireGuardianOrAdmin, requireAdmin } = require('../middleware/auth');

// Submit feedback (first class or monthly)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const {
      type,
      studentId,
      teacherId,
      classId,
      firstClassRating,
      teacherPerformanceRating,
      attendanceOnTime,
      connectionQuality,
      progressEvaluation,
      notes,
    } = req.body;

    if (!['first_class', 'monthly'].includes(type)) {
      return res.status(400).json({ message: 'Invalid feedback type' });
    }

    if (!teacherId) return res.status(400).json({ message: 'teacherId is required' });

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== 'teacher') return res.status(404).json({ message: 'Teacher not found' });

    const feedback = new Feedback({
      type,
      user: user._id,
      student: studentId || undefined,
      teacher: teacherId,
      classId: classId || undefined,
      firstClassRating,
      teacherPerformanceRating,
      attendanceOnTime,
      connectionQuality,
      progressEvaluation,
      notes,
    });

    await feedback.save();

    // Notification trigger: feedback submitted
    try {
      const notificationService = require('../services/notificationService');
      // Notify the teacher
      notificationService.notifyFeedbackSubmitted({
        feedback,
        toUser: teacherId
      }).catch(console.error);
      // Optionally, notify admin(s) as well
      notificationService.notifyRole({
        role: 'admin',
        title: 'New Feedback Submitted',
        message: `Feedback submitted for teacher ${teacher.firstName} ${teacher.lastName}.`,
        type: 'feedback',
        related: { relatedFeedback: feedback._id }
      }).catch(console.error);
    } catch (e) {
      console.warn('Notification trigger failed', e.message);
    }

    // Emit socket.io notification to admin/teacher rooms
    try {
      const io = req.app.get('io');
      if (io) {
        // notify admins
        io.to('admin').emit('feedback:new', { feedbackId: feedback._id, teacher: teacherId, type });
        // notify the teacher specifically
        io.to(String(teacherId)).emit('feedback:new', { feedbackId: feedback._id, type });
      }
    } catch (e) {
      console.error('Socket notify error', e);
    }

    return res.json({ success: true, feedback });
  } catch (err) {
    console.error('Submit feedback error', err);
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
});

// Get pending feedback prompts for current user
// - first_class: show if user had a class with this teacher for the first time and class ended
// - monthly: show once per month per teacher
router.get('/pending', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const now = new Date();

    // helper: one week in milliseconds
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    // Find classes that finished recently and require first-class feedback
    // Criteria: class scheduled in the past, status attended or completed, and no existing first_class feedback for that class by this user
    // respect admin-configurable window (hours) for when first-class prompt should appear after class end
    const Setting = require('../models/Setting');
    const setting = await Setting.findOne({ key: 'firstClassWindowHours' });
    const windowHours = (setting && Number(setting.value)) || 24; // default 24 hours

    const recentFirstClasses = await Class.find({
      $or: [ { 'student.guardianId': user._id }, { 'student.studentId': user._id } ],
      scheduledDate: { $lte: now },
      status: { $in: ['attended', 'completed'] }
    }).populate('teacher', 'firstName lastName');

    const firstClassPrompts = [];

    for (const cls of recentFirstClasses) {
      // check if this user already submitted a first_class feedback for this teacher
      // if a dismissed record exists, only treat it as "already" if it was dismissed within the last week
      const already = await Feedback.findOne({
        type: 'first_class',
        user: user._id,
        teacher: cls.teacher._id,
        classId: cls._id,
      });

      if (already) {
        if (already.dismissed) {
          const dismissedAt = already.dismissedAt || already.createdAt || null;
          if (dismissedAt && (now.getTime() - new Date(dismissedAt).getTime() <= ONE_WEEK_MS)) {
            // dismissed recently — skip prompting
            continue;
          }
          // dismissed but older than a week -> allow prompting again
        } else {
          // non-dismissed feedback already submitted -> skip
          continue;
        }
      }

      // Check if there were previous classes between the same teacher and same student (before this class)
      // Consider any scheduled/attended/completed/in-progress classes as prior interaction, but ignore cancelled ones.
      const past = await Class.findOne({
        'student.studentId': cls.student.studentId,
        teacher: cls.teacher._id,
        scheduledDate: { $lt: cls.scheduledDate },
        status: { $nin: ['cancelled', 'cancelled_by_teacher', 'cancelled_by_guardian', 'cancelled_by_admin'] }
      });

      if (past) continue; // if there are past classes - not first interaction

  // Ensure class end time is within the configured window (after scheduledDate + duration)
  const endTime = new Date(cls.scheduledDate.getTime() + (cls.duration || 60) * 60000);
  const hoursSinceEnd = (now.getTime() - endTime.getTime()) / (1000 * 60 * 60);
  if (endTime > now) continue; // class still ongoing or not finished yet
  if (hoursSinceEnd > windowHours) continue; // outside configured first-class feedback window

      firstClassPrompts.push({
        classId: cls._id,
        teacher: cls.teacher,
        scheduledDate: cls.scheduledDate,
      });
    }

    // Monthly prompts: find teachers this user had classes with in the past month and hasn't submitted monthly feedback this month
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // find distinct teachers the user had classes with in the last 90 days (to consider monthly followups)
    const recentTeachers = await Class.aggregate([
      { $match: {
        $or: [ { 'student.guardianId': user._id }, { 'student.studentId': user._id } ],
        scheduledDate: { $gte: oneMonthAgo }
      }},
      { $group: { _id: '$teacher' } },
    ]);

    const monthlyPrompts = [];
    for (const t of recentTeachers) {
      const teacherId = t._id;
      // check if user has submitted monthly feedback for this teacher in the current month
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      // find the most recent monthly feedback (including dismissed) for this user/teacher
      const lastMonthly = await Feedback.findOne({ type: 'monthly', user: user._id, teacher: teacherId }).sort({ createdAt: -1 });

      let hasRecentMonthly = false;
      if (lastMonthly) {
        if (lastMonthly.dismissed) {
          const dismissedAt = lastMonthly.dismissedAt || lastMonthly.createdAt;
          if (dismissedAt && (now.getTime() - new Date(dismissedAt).getTime() <= ONE_WEEK_MS)) {
            // dismissed within a week -> treat as already handled for now
            hasRecentMonthly = true;
          } else {
            // dismissed but older than a week -> not considered recent
            hasRecentMonthly = false;
          }
        } else {
          // a real monthly feedback exists — check if it's in the current month
          if (lastMonthly.createdAt && new Date(lastMonthly.createdAt) >= startOfMonth) hasRecentMonthly = true;
        }
      }

      if (!hasRecentMonthly) {
        const teacher = await User.findById(teacherId).select('firstName lastName');
        if (teacher) {
          monthlyPrompts.push({ teacher, teacherId });
        }
      }
    }

    res.json({ success: true, firstClassPrompts, monthlyPrompts });
  } catch (err) {
    console.error('Get pending feedbacks error', err);
    res.status(500).json({ message: 'Failed to get pending feedbacks' });
  }
});

// Dismiss a prompt (mark as dismissed without submitting) - stores a dismissed feedback record
router.post('/:type/dismiss', authenticateToken, async (req, res) => {
  try {
    const user = req.user;
    const { type } = req.params; // 'first_class' or 'monthly'
    const { teacherId, classId } = req.body;

    if (!['first_class', 'monthly'].includes(type)) return res.status(400).json({ message: 'Invalid type' });
    if (!teacherId) return res.status(400).json({ message: 'teacherId required' });

    const payload = {
      type,
      user: user._id,
      teacher: teacherId,
      classId: classId || undefined,
      dismissed: true,
      dismissedAt: new Date(),
    };

    const f = new Feedback(payload);
    await f.save();

    res.json({ success: true });
  } catch (err) {
    console.error('Dismiss prompt error', err);
    res.status(500).json({ message: 'Failed to dismiss prompt' });
  }
});

// Admin/Teacher: get feedback summary for a teacher
router.get('/teacher/:teacherId', authenticateToken, requireTeacherOrAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;

    // By default exclude dismissed prompt records (they are created when a user dismisses the modal)
    // Admins/teachers can include dismissed items by passing ?includeDismissed=true
    const includeDismissed = String(req.query.includeDismissed || '').toLowerCase() === 'true';
    const filter = { teacher: teacherId };
    if (!includeDismissed) filter.dismissed = { $ne: true };

    const feedbacks = await Feedback.find(filter).sort({ createdAt: -1 }).limit(100);

    // Simple aggregated metrics
    const stats = {
      total: feedbacks.length,
      avgFirstClassRating: null,
      avgTeacherPerformanceRating: null,
      avgAttendanceOnTime: null,
      avgConnectionQuality: null,
      avgProgressEvaluation: null,
    };

    const count = feedbacks.length;
    if (count > 0) {
      let sumFirst = 0, sumPerf = 0, sumAtt = 0, sumConn = 0, sumProg = 0;
      let cFirst=0, cPerf=0, cAtt=0, cConn=0, cProg=0;
      feedbacks.forEach(f => {
        if (typeof f.firstClassRating === 'number') { sumFirst += f.firstClassRating; cFirst++; }
        if (typeof f.teacherPerformanceRating === 'number') { sumPerf += f.teacherPerformanceRating; cPerf++; }
        if (typeof f.attendanceOnTime === 'number') { sumAtt += f.attendanceOnTime; cAtt++; }
        if (typeof f.connectionQuality === 'number') { sumConn += f.connectionQuality; cConn++; }
        if (typeof f.progressEvaluation === 'number') { sumProg += f.progressEvaluation; cProg++; }
      });

      stats.avgFirstClassRating = cFirst ? (sumFirst / cFirst) : null;
      stats.avgTeacherPerformanceRating = cPerf ? (sumPerf / cPerf) : null;
      stats.avgAttendanceOnTime = cAtt ? (sumAtt / cAtt) : null;
      stats.avgConnectionQuality = cConn ? (sumConn / cConn) : null;
      stats.avgProgressEvaluation = cProg ? (sumProg / cProg) : null;
    }

    res.json({ success: true, stats, feedbacks });
  } catch (err) {
    console.error('Get teacher feedbacks error', err);
    res.status(500).json({ message: 'Failed to get feedbacks' });
  }
});

// Admin: list feedbacks with search/filters (pagination)
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { q, type, teacherId, userId, page = 1, limit = 20, archived } = req.query;
    const filter = {};
    // By default, exclude dismissed prompt records (they represent 'Remind me later' actions)
    // If admin explicitly wants to see them, pass ?includeDismissed=true
    const includeDismissed = String(req.query.includeDismissed || '').toLowerCase() === 'true';
    // support read filter
    const { read } = req.query;
    if (type) filter.type = type;
    if (teacherId) filter.teacher = teacherId;
    if (userId) filter.user = userId;
    if (archived === 'true') filter.archived = true;
    if (archived === 'false') filter.archived = false;
  if (!includeDismissed) filter.dismissed = { $ne: true };
    if (read === 'true') filter.read = true;
    if (read === 'false') filter.read = false;

    if (q) {
      const regex = new RegExp(q, 'i');
      // search in notes or match user/teacher names - do a lookup after
      filter.$or = [ { notes: regex } ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Feedback.countDocuments(filter);
    const feedbacks = await Feedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).populate('user', 'firstName lastName email role').populate('teacher', 'firstName lastName email');

    res.json({ success: true, total, page: Number(page), limit: Number(limit), feedbacks });
  } catch (err) {
    console.error('Admin list feedbacks error', err);
    res.status(500).json({ message: 'Failed to list feedbacks' });
  }
});

// Admin: get unread feedback count
router.get('/count/unread', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const count = await Feedback.countDocuments({ read: false, archived: false });
    res.json({ success: true, count });
  } catch (err) {
    console.error('Unread count error', err);
    res.status(500).json({ message: 'Failed to get unread count' });
  }
});

// Mark a feedback as read
router.put('/:id/read', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const f = await Feedback.findById(id);
    if (!f) return res.status(404).json({ message: 'Feedback not found' });
    f.read = true;
    f.readAt = new Date();
    await f.save();
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admin').emit('feedback:read', { id: f._id });
        if (f.teacher) io.to(String(f.teacher)).emit('feedback:read', { id: f._id });
      }
    } catch (e) {
      console.error('Socket notify read error', e);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error', err);
    res.status(500).json({ message: 'Failed to mark as read' });
  }
});

// Soft-delete (archive) a feedback
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const f = await Feedback.findById(id);
    if (!f) return res.status(404).json({ message: 'Feedback not found' });
    f.archived = true;
    f.archivedAt = new Date();
    await f.save();
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admin').emit('feedback:archived', { id: f._id });
        if (f.teacher) io.to(String(f.teacher)).emit('feedback:archived', { id: f._id });
      }
    } catch (e) {
      console.error('Socket notify archive error', e);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Archive feedback error', err);
    res.status(500).json({ message: 'Failed to archive feedback' });
  }
});

module.exports = router;

