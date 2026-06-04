/*
  Backfill historical evaluation feedback submissions into the shared Feedback hub.

  Usage:
    npm run backfill:evaluation-feedbacks
    npm run backfill:evaluation-feedbacks -- --dry-run

  Notes:
  - Idempotent: keyed by (evaluationSession, evaluationStudentSubId, type=evaluation).
  - Preserves the original submittedAt timestamp as createdAt for newly inserted docs.
*/

const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const EvaluationSession = require('../models/EvaluationSession');
const Feedback = require('../models/Feedback');
const { upsertEvaluationFeedbackFromSessionStudent } = require('../services/evaluationFeedbackService');

function getMongoUri() {
  return process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
}

async function iterateSubmittedEvaluationFeedbacks(visitor) {
  const cursor = EvaluationSession.find({ 'students.feedback.submittedAt': { $type: 'date' } })
    .select('title students._id students.studentUser students.guardianUser students.name students.contactEmail students.feedback')
    .lean()
    .cursor();

  let sessionsScanned = 0;
  let submittedEntries = 0;

  for await (const session of cursor) {
    sessionsScanned += 1;
    for (const student of session.students || []) {
      if (!student?.feedback?.submittedAt) continue;
      submittedEntries += 1;
      await visitor({ session, student });
    }
  }

  return { sessionsScanned, submittedEntries };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = getMongoUri();

  await mongoose.connect(uri);

  const stats = {
    sessionsScanned: 0,
    submittedEntries: 0,
    missingEntries: 0,
    created: 0,
    updated: 0,
  };

  const base = await iterateSubmittedEvaluationFeedbacks(async ({ session, student }) => {
    const existing = await Feedback.exists({
      type: 'evaluation',
      evaluationSession: session._id,
      evaluationStudentSubId: student._id,
    });

    if (!existing) {
      stats.missingEntries += 1;
    }

    if (dryRun) return;

    const result = await upsertEvaluationFeedbackFromSessionStudent({
      session,
      student,
      preserveSubmittedAt: true,
    });

    if (result.created) {
      stats.created += 1;
    } else {
      stats.updated += 1;
    }
  });

  stats.sessionsScanned = base.sessionsScanned;
  stats.submittedEntries = base.submittedEntries;

  let remainingMissing = stats.missingEntries;
  if (!dryRun) {
    remainingMissing = 0;
    await iterateSubmittedEvaluationFeedbacks(async ({ session, student }) => {
      const exists = await Feedback.exists({
        type: 'evaluation',
        evaluationSession: session._id,
        evaluationStudentSubId: student._id,
      });
      if (!exists) remainingMissing += 1;
    });
  }

  console.log(dryRun ? 'Evaluation feedback backfill dry run complete.' : 'Evaluation feedback backfill complete.');
  console.log({
    dryRun,
    sessionsScanned: stats.sessionsScanned,
    submittedEntries: stats.submittedEntries,
    missingEntries: stats.missingEntries,
    created: stats.created,
    updated: stats.updated,
    remainingMissing,
  });

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('backfillEvaluationFeedbacks failed:', error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error('Failed to disconnect after backfill error:', disconnectError.message);
  }
  process.exitCode = 1;
});