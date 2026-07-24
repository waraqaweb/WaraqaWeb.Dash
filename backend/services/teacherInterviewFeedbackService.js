const Feedback = require('../models/Feedback');

function normalizeMetrics(ratings = {}) {
  return Object.fromEntries(
    Object.entries(ratings || {})
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Number(value)])
  );
}

function buildTeacherInterviewFeedbackPayload({ record }) {
  const metrics = normalizeMetrics(record?.ratings || {});
  const payload = {
    submitterName: String(record?.teacherName || '').trim() || 'Interview candidate',
    submitterEmail: String(record?.contactEmail || '').trim().toLowerCase(),
    evaluationTitle: 'Teacher interview feedback',
    source: 'teacher_interview',
    notes: String(record?.improvementSuggestions || '').slice(0, 2000) || undefined,
    dismissed: false,
  };

  if (Object.keys(metrics).length) {
    payload.metrics = metrics;
  }

  return payload;
}

// Mirrors evaluationFeedbackService.upsertEvaluationFeedbackFromSessionStudent
// so post-interview feedback also shows up in the shared /dashboard/feedbacks
// hub, alongside first-class/monthly/evaluation feedback.
async function upsertTeacherInterviewFeedback({ record, markUnread = false }) {
  if (!record?._id || !record?.submittedAt) {
    throw new Error('Missing teacher interview feedback context');
  }

  const filter = { type: 'teacher_interview', teacherInterviewFeedback: record._id };

  let feedback = await Feedback.findOne(filter);
  const created = !feedback;

  if (!feedback) {
    feedback = new Feedback(filter);
  }

  Object.assign(feedback, buildTeacherInterviewFeedbackPayload({ record }));

  if (created || markUnread) {
    feedback.read = false;
    feedback.readAt = undefined;
    feedback.archived = false;
    feedback.archivedAt = undefined;
  }

  await feedback.save();

  return { feedback, created };
}

module.exports = {
  buildTeacherInterviewFeedbackPayload,
  upsertTeacherInterviewFeedback,
};
