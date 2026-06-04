const Feedback = require('../models/Feedback');

function normalizeEvaluationMetrics(ratings = {}) {
  return Object.fromEntries(
    Object.entries(ratings || {})
      .filter(([, value]) => Number.isFinite(Number(value)))
      .map(([key, value]) => [key, Number(value)])
  );
}

function buildEvaluationFeedbackPayload({ session, student }) {
  const metrics = normalizeEvaluationMetrics(student?.feedback?.ratings || {});
  const payload = {
    user: student?.guardianUser || student?.studentUser || undefined,
    student: student?.studentUser || undefined,
    submitterName: String(student?.name || '').trim() || 'Evaluation participant',
    submitterEmail: String(student?.feedback?.sentTo || student?.contactEmail || '').trim().toLowerCase(),
    evaluationTitle: String(session?.title || '').trim() || 'Evaluation feedback',
    source: 'evaluation',
    notes: String(student?.feedback?.comment || '').slice(0, 2000) || undefined,
    heardAboutUs: String(student?.feedback?.heardAboutUs || '').trim().slice(0, 500) || undefined,
    dismissed: false,
  };

  if (Object.keys(metrics).length) {
    payload.metrics = metrics;
  }

  return payload;
}

async function upsertEvaluationFeedbackFromSessionStudent({
  session,
  student,
  markUnread = false,
  preserveSubmittedAt = false,
}) {
  if (!session?._id || !student?._id || !student?.feedback?.submittedAt) {
    throw new Error('Missing evaluation session/student feedback context');
  }

  const filter = {
    type: 'evaluation',
    evaluationSession: session._id,
    evaluationStudentSubId: student._id,
  };

  let feedback = await Feedback.findOne(filter);
  const created = !feedback;

  if (!feedback) {
    feedback = new Feedback(filter);
  }

  Object.assign(feedback, buildEvaluationFeedbackPayload({ session, student }));

  if (created || markUnread) {
    feedback.read = false;
    feedback.readAt = undefined;
    feedback.archived = false;
    feedback.archivedAt = undefined;
  }

  await feedback.save();

  if (created && preserveSubmittedAt && student.feedback?.submittedAt) {
    const submittedAt = new Date(student.feedback.submittedAt);
    await Feedback.collection.updateOne(
      { _id: feedback._id },
      { $set: { createdAt: submittedAt, updatedAt: submittedAt } }
    );
    feedback.createdAt = submittedAt;
    feedback.updatedAt = submittedAt;
  }

  return { feedback, created };
}

module.exports = {
  buildEvaluationFeedbackPayload,
  upsertEvaluationFeedbackFromSessionStudent,
};