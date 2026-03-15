require('dotenv').config();

const mongoose = require('mongoose');
const Class = require('../models/Class');
const { DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const parseArgs = (argv = []) => ({
  dryRun: argv.includes('--dry-run'),
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(mongoUri);

  const patterns = await Class.find({
    status: 'pattern',
    anchoredTimezone: 'student',
    hidden: { $ne: true },
  });

  let matched = 0;
  let repaired = 0;

  for (const pattern of patterns) {
    const anchorTimezone = String(pattern?.timeAnchor?.timezone || '').trim();
    if (!anchorTimezone || String(pattern.timezone || '').trim() !== anchorTimezone) continue;

    matched += 1;
    if (args.dryRun) continue;

    pattern.timezone = DEFAULT_TIMEZONE;
    if (Array.isArray(pattern.recurrenceDetails)) {
      pattern.recurrenceDetails = pattern.recurrenceDetails.map((slot) => ({
        ...slot,
        timezone: String(slot?.timezone || '').trim() === anchorTimezone
          ? DEFAULT_TIMEZONE
          : (slot?.timezone || DEFAULT_TIMEZONE),
      }));
    }
    await pattern.save();
    repaired += 1;
  }

  console.log('[repairStudentPatternDisplayTimezones] done', {
    dryRun: args.dryRun,
    matched,
    repaired: args.dryRun ? 0 : repaired,
  });

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error('[repairStudentPatternDisplayTimezones] fatal', error);
  try {
    await mongoose.connection.close();
  } catch (closeErr) {
    console.error('[repairStudentPatternDisplayTimezones] close error', closeErr);
  }
  process.exitCode = 1;
});