require('dotenv').config();

const mongoose = require('mongoose');
const Class = require('../models/Class');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const parseArgs = (argv = []) => {
  const args = {
    dryRun: false,
    source: 'backfill',
    since: '',
  };

  for (const raw of argv) {
    if (raw === '--dry-run') args.dryRun = true;
    if (raw.startsWith('--source=')) args.source = raw.split('=')[1] || args.source;
    if (raw.startsWith('--since=')) args.since = raw.split('=')[1] || '';
  }

  return args;
};

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = toDate(args.since);
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(mongoUri);

  const classes = await Class.find({
    'dstInfo.dstAdjustments.0': { $exists: true },
    anchoredTimezone: 'student',
    status: { $in: ['scheduled', 'in_progress'] },
    hidden: { $ne: true },
  });

  let matched = 0;
  let reverted = 0;

  for (const classDoc of classes) {
    const adjustments = Array.isArray(classDoc?.dstInfo?.dstAdjustments)
      ? classDoc.dstInfo.dstAdjustments
      : [];
    const lastAdjustment = adjustments[adjustments.length - 1];
    if (!lastAdjustment) continue;
    if (args.source && String(lastAdjustment.source || '') !== String(args.source)) continue;
    if (since && (!lastAdjustment.adjustmentDate || new Date(lastAdjustment.adjustmentDate) < since)) continue;
    if (!lastAdjustment.oldTime) continue;

    matched += 1;
    if (args.dryRun) continue;

    classDoc.scheduledDate = new Date(lastAdjustment.oldTime);
    if (classDoc.timezone === lastAdjustment.affectedTimezone) {
      classDoc.timezone = DEFAULT_TIMEZONE;
    }
    classDoc.dstInfo.dstAdjustments = adjustments.slice(0, -1);
    classDoc.dstInfo.lastDSTCheck = new Date();
    await classDoc.save();
    reverted += 1;
  }

  console.log('[rollbackRecentDstBackfill] done', {
    source: args.source,
    dryRun: args.dryRun,
    since: since ? since.toISOString() : null,
    matched,
    reverted: args.dryRun ? 0 : reverted,
  });

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error('[rollbackRecentDstBackfill] fatal', error);
  try {
    await mongoose.connection.close();
  } catch (closeErr) {
    console.error('[rollbackRecentDstBackfill] close error', closeErr);
  }
  process.exitCode = 1;
});