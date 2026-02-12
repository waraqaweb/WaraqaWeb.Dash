/*
  Diagnose `endsAt` health for Class documents.

  Reports:
  - how many docs are missing endsAt
  - how many have endsAt that doesn't match scheduledDate + duration (stale)

  Usage:
    MONGODB_URI="mongodb://..." node scripts/diagnoseClassEndsAt.js
*/

const mongoose = require('mongoose');

function computeExpectedEndsAt(scheduledDate, duration) {
  const scheduled = scheduledDate instanceof Date ? scheduledDate : new Date(scheduledDate);
  const dur = Number(duration || 0);
  if (!Number.isFinite(scheduled.getTime())) return null;
  if (!Number.isFinite(dur)) return null;
  return new Date(scheduled.getTime() + dur * 60_000);
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  const Class = require('../models/Class');

  const total = await Class.estimatedDocumentCount();
  const missingEndsAt = await Class.countDocuments({ $or: [{ endsAt: { $exists: false } }, { endsAt: null }] });

  // Sample a bounded set to detect staleness without scanning everything.
  const sample = await Class.find({ endsAt: { $type: 'date' }, scheduledDate: { $type: 'date' } })
    .select('scheduledDate duration endsAt')
    .limit(5000)
    .lean();

  let stale = 0;
  for (const row of sample) {
    const expected = computeExpectedEndsAt(row.scheduledDate, row.duration);
    if (!expected) continue;
    const endsAt = row.endsAt instanceof Date ? row.endsAt : new Date(row.endsAt);
    if (!Number.isFinite(endsAt.getTime())) continue;

    // allow a small tolerance (ms differences) just in case
    const diffMs = Math.abs(endsAt.getTime() - expected.getTime());
    if (diffMs > 1000) stale += 1;
  }

  console.log('Class endsAt diagnostics:', {
    totalEstimated: total,
    missingEndsAt,
    sampledForStaleCheck: sample.length,
    staleInSample: stale,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ diagnoseClassEndsAt failed:', err);
  process.exitCode = 1;
});
