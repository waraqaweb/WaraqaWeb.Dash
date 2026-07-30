/*
  Backfill/repair teacher class calendars from dashboard classes.

  Usage:
    node scripts/syncTeacherClassesToGoogleCalendar.js --dry-run
    node scripts/syncTeacherClassesToGoogleCalendar.js
    node scripts/syncTeacherClassesToGoogleCalendar.js --from=2026-08-01T00:00:00.000Z
*/

const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const Class = require('../models/Class');
const teacherClassCalendarSyncService = require('../services/teacherClassCalendarSyncService');

const getMongoUri = () => process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';

const parseArgs = () => {
  const dryRun = process.argv.includes('--dry-run');
  const fromArg = process.argv.find((a) => a.startsWith('--from='));
  const toArg = process.argv.find((a) => a.startsWith('--to='));
  const from = fromArg ? new Date(fromArg.slice('--from='.length)) : new Date();
  const to = toArg ? new Date(toArg.slice('--to='.length)) : null;
  if (Number.isNaN(from.getTime())) {
    throw new Error('Invalid --from value. Use ISO date format.');
  }
  if (to && Number.isNaN(to.getTime())) {
    throw new Error('Invalid --to value. Use ISO date format.');
  }
  if (to && to < from) {
    throw new Error('--to must be greater than or equal to --from');
  }
  return { dryRun, from, to };
};

async function main() {
  const { dryRun, from, to } = parseArgs();
  if (!teacherClassCalendarSyncService.isConfigured()) {
    throw new Error('Teacher class calendar sync not configured. Check GOOGLE_CLASS_CALENDAR_SYNC_ENABLED and Google credentials.');
  }

  await mongoose.connect(getMongoUri());

  const query = {
    status: { $ne: 'pattern' },
    scheduledDate: {
      $gte: from,
      ...(to ? { $lte: to } : {}),
    },
  };

  const cursor = Class.find(query)
    .sort({ scheduledDate: 1 })
    .select('_id teacher status scheduledDate duration timezone subject title meetingLink student calendar classReport')
    .cursor();

  const stats = {
    dryRun,
    scanned: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
  };

  for await (const classDoc of cursor) {
    stats.scanned += 1;

    if (dryRun) {
      console.log('[dry-run]', String(classDoc._id), classDoc.status, classDoc.scheduledDate?.toISOString());
      stats.skipped += 1;
      continue;
    }

    try {
      const result = await teacherClassCalendarSyncService.syncClassEvent({ classDoc, mode: 'upsert' });
      if (result?.skipped) {
        stats.skipped += 1;
      } else {
        stats.synced += 1;
      }

      if (result?.eventId && result?.teacherCalendarId) {
        await Class.updateOne(
          { _id: classDoc._id },
          {
            $set: {
              'calendar.provider': 'google',
              'calendar.teacherCalendarId': result.teacherCalendarId,
              'calendar.googleEventId': result.eventId,
              'calendar.googleSyncedAt': new Date(),
            },
          }
        );
      }
    } catch (err) {
      stats.failed += 1;
      console.error('[sync-failed]', String(classDoc._id), err.message || err);
    }
  }

  console.log('Teacher class calendar sync complete:', stats);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('syncTeacherClassesToGoogleCalendar failed:', error.message || error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
