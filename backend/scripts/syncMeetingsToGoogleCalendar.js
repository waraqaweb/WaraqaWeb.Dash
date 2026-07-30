/*
  Backfill/sync dashboard meetings into Google Calendar.

  Usage:
    node scripts/syncMeetingsToGoogleCalendar.js
    node scripts/syncMeetingsToGoogleCalendar.js --dry-run
    node scripts/syncMeetingsToGoogleCalendar.js --from=2026-01-01T00:00:00.000Z

  Notes:
  - Idempotent: each meeting maps to deterministic Google event id m<meetingId>.
  - Safe to re-run: existing events are patched, missing events are inserted.
*/

const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const Meeting = require('../models/Meeting');
const User = require('../models/User');
const { MEETING_TYPES, MEETING_STATUSES } = require('../constants/meetingConstants');
const googleCalendarService = require('../services/googleCalendarService');

const TARGET_TYPES = new Set([
  MEETING_TYPES.NEW_STUDENT_EVALUATION,
  MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP,
  MEETING_TYPES.TEACHER_SYNC,
  MEETING_TYPES.NEW_TEACHER_INTERVIEW,
]);

function getMongoUri() {
  return process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
}

function parseArgs() {
  const dryRun = process.argv.includes('--dry-run');
  const fromArg = process.argv.find((arg) => arg.startsWith('--from='));
  const from = fromArg ? new Date(fromArg.slice('--from='.length)) : null;
  if (from && Number.isNaN(from.getTime())) {
    throw new Error('Invalid --from date. Use ISO format, e.g. --from=2026-01-01T00:00:00.000Z');
  }
  return { dryRun, from };
}

async function main() {
  const { dryRun, from } = parseArgs();

  if (!googleCalendarService.isConfigured()) {
    throw new Error('Google Calendar credentials are missing. Set GOOGLE_CALENDAR_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  }

  await mongoose.connect(getMongoUri());

  const query = {
    meetingType: { $in: Array.from(TARGET_TYPES) },
    status: { $ne: MEETING_STATUSES.CANCELLED },
  };

  if (from) {
    query.scheduledStart = { $gte: from };
  }

  const cursor = Meeting.find(query)
    .sort({ scheduledStart: 1 })
    .cursor();

  const adminCache = new Map();
  const getAdmin = async (adminId) => {
    const key = String(adminId || '');
    if (!key) return null;
    if (adminCache.has(key)) return adminCache.get(key);
    const admin = await User.findById(adminId).select('email timezone adminSettings teacherInfo');
    adminCache.set(key, admin);
    return admin;
  };

  const stats = {
    scanned: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    dryRun,
  };

  for await (const meeting of cursor) {
    stats.scanned += 1;
    const admin = await getAdmin(meeting.adminId);

    if (dryRun) {
      const eventId = googleCalendarService.getEventIdForMeeting(meeting._id);
      console.log('[dry-run]', String(meeting._id), String(meeting.meetingType), meeting.scheduledStart?.toISOString(), eventId || 'no-event-id');
      stats.skipped += 1;
      continue;
    }

    try {
      const result = await googleCalendarService.syncMeetingEvent({ meeting, admin, mode: 'upsert' });
      if (result?.eventId) {
        await Meeting.updateOne(
          { _id: meeting._id },
          {
            $set: {
              'calendar.googleEventId': result.eventId,
              'calendar.googleSyncedAt': new Date(),
            },
          }
        );
      }

      if (result?.skipped) {
        stats.skipped += 1;
      } else {
        stats.synced += 1;
      }
    } catch (error) {
      stats.failed += 1;
      console.error('[sync-failed]', String(meeting._id), error.message || error);
    }
  }

  console.log('Meeting calendar sync complete:', stats);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('syncMeetingsToGoogleCalendar failed:', error.message || error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error('Failed to disconnect:', disconnectError.message);
  }
  process.exitCode = 1;
});
