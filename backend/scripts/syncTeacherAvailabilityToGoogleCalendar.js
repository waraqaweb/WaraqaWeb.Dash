const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const AvailabilitySlot = require('../models/AvailabilitySlot');
const UnavailablePeriod = require('../models/UnavailablePeriod');
const availabilitySyncService = require('../services/teacherAvailabilityCalendarSyncService');

const getMongoUri = () => process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';

const parseArgs = () => {
  return {
    dryRun: process.argv.includes('--dry-run'),
  };
};

async function syncSlots({ dryRun, stats }) {
  const cursor = AvailabilitySlot.find({})
    .select('_id teacherId dayOfWeek startTime endTime timezone isRecurring effectiveFrom effectiveTo isActive')
    .cursor();

  for await (const slot of cursor) {
    stats.slots.scanned += 1;

    if (dryRun) {
      stats.slots.skipped += 1;
      console.log('[dry-run][slot]', String(slot._id), 'teacher', String(slot.teacherId), 'active', String(slot.isActive));
      continue;
    }

    try {
      const result = await availabilitySyncService.syncAvailabilitySlotEvent({ slotDoc: slot, mode: 'upsert' });
      if (result?.skipped) {
        stats.slots.skipped += 1;
      } else {
        stats.slots.synced += 1;
      }
    } catch (err) {
      stats.slots.failed += 1;
      console.error('[slot-sync-failed]', String(slot._id), err.message || err);
    }
  }
}

async function syncUnavailablePeriods({ dryRun, stats }) {
  const cursor = UnavailablePeriod.find({})
    .select('_id teacherId startDateTime endDateTime reason description status isActive')
    .cursor();

  for await (const period of cursor) {
    stats.unavailable.scanned += 1;

    if (dryRun) {
      stats.unavailable.skipped += 1;
      console.log('[dry-run][unavailable]', String(period._id), 'teacher', String(period.teacherId), 'status', String(period.status));
      continue;
    }

    try {
      const result = await availabilitySyncService.syncUnavailablePeriodEvent({ periodDoc: period, mode: 'upsert' });
      if (result?.skipped) {
        stats.unavailable.skipped += 1;
      } else {
        stats.unavailable.synced += 1;
      }
    } catch (err) {
      stats.unavailable.failed += 1;
      console.error('[unavailable-sync-failed]', String(period._id), err.message || err);
    }
  }
}

async function main() {
  const { dryRun } = parseArgs();
  if (!availabilitySyncService.isConfigured()) {
    throw new Error('Teacher availability calendar sync not configured. Check GOOGLE_CLASS_CALENDAR_SYNC_ENABLED and Google credentials.');
  }

  await mongoose.connect(getMongoUri());

  const stats = {
    dryRun,
    slots: { scanned: 0, synced: 0, skipped: 0, failed: 0 },
    unavailable: { scanned: 0, synced: 0, skipped: 0, failed: 0 },
  };

  await syncSlots({ dryRun, stats });
  await syncUnavailablePeriods({ dryRun, stats });

  console.log('Teacher availability calendar sync complete:', stats);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('syncTeacherAvailabilityToGoogleCalendar failed:', error.message || error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
