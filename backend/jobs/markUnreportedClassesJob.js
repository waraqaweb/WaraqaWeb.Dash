/**
 * Mark Unreported Classes Job
 * Periodically checks for classes with expired report submission windows
 * and marks them as unreported
 * 
 * Should run every hour
 */

const Class = require('../models/Class');
const Setting = require('../models/Setting');
const ReportSubmissionService = require('../services/reportSubmissionService');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

async function markUnreportedClasses() {
  console.log('[MarkUnreportedJob] Starting unreported classes check...');
  
  try {
    const result = await ReportSubmissionService.processExpiredSubmissions();
    
    if (result.success) {
      console.log(`[MarkUnreportedJob] ✅ Success: ${result.message}`);
      console.log(`[MarkUnreportedJob] Processed: ${result.processed}, Marked: ${result.marked}`);
    } else {
      console.error(`[MarkUnreportedJob] ❌ Failed: ${result.error}`);
    }
    
    return result;
  } catch (err) {
    console.error('[MarkUnreportedJob] ❌ Error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Initialize report tracking for classes that recently ended
 * This ensures the tracking starts automatically
 */
async function initializeRecentlyEndedClasses() {
  console.log('[MarkUnreportedJob] Initializing tracking for recently ended classes...');
  
  try {
    const now = new Date();
    const oneHourAgo = dayjs(now).subtract(1, 'hour').toDate();
    
    // Find classes that ended in the last hour and haven't been initialized
    const recentlyEnded = await Class.find({
      scheduledDate: { $lte: now, $gte: oneHourAgo },
      'classReport.submittedAt': { $exists: false },
      $or: [
        { 'reportSubmission.status': { $exists: false } },
        { 'reportSubmission.status': 'pending' }
      ]
    });
    
    let initialized = 0;
    for (const classDoc of recentlyEnded) {
      // Check if class has actually ended (scheduled + duration)
      const classEnd = dayjs(classDoc.scheduledDate).add(classDoc.duration, 'minutes');
      
      if (dayjs().isAfter(classEnd)) {
        const result = await ReportSubmissionService.initializeReportTracking(classDoc._id);
        if (result.success) {
          initialized++;
        }
      }
    }
    
    console.log(`[MarkUnreportedJob] ✅ Initialized tracking for ${initialized} classes`);
    return { success: true, initialized };
  } catch (err) {
    console.error('[MarkUnreportedJob] ❌ Error initializing tracking:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Main job function
 */
async function runJob() {
  console.log(`\n[MarkUnreportedJob] ========== ${dayjs().format('YYYY-MM-DD HH:mm:ss')} ==========`);
  
  // Step 1: Initialize tracking for recently ended classes
  await initializeRecentlyEndedClasses();
  
  // Step 2: Mark expired classes as unreported
  const result = await markUnreportedClasses();

  // Step 3: Cleanup old unreported classes (older than 30 days)
  await cleanupOldUnreportedClasses();
  
  console.log('[MarkUnreportedJob] ========== Job Complete ==========\n');
  
  return result;
}

/**
 * Delete unreported classes older than 30 days (cleanup)
 *
 * Safety guarantees:
 *  - Never deletes a class that was reported (classReport.submittedAt present) — those
 *    consumed guardian/teacher hours and carry financial meaning.
 *  - Only removes classes still at an open-ended class status ('scheduled'/'unreported')
 *    whose report window fully closed ('reportSubmission.status' === 'unreported').
 *  - Never deletes a class referenced by a finalized (paid/refunded) invoice, so paid
 *    invoices and guardian hours are never altered with a minus or addition.
 */
async function cleanupOldUnreportedClasses() {
  console.log('[MarkUnreportedJob] Cleaning old unreported classes...');
  try {
    const Invoice = require('../models/Invoice');
    let days = 30;
    try {
      const setting = await Setting.findOne({ key: 'unreportedClassCleanupDays' }).lean();
      const value = Number(setting?.value);
      if (Number.isFinite(value) && value > 0) days = value;
    } catch (e) {
      // fallback to default
    }
    const cutoff = dayjs().subtract(days, 'day').toDate();

    // Build the protected set: every class/lesson referenced by a finalized invoice.
    // If this lookup fails we abort the deletion rather than risk touching paid data.
    const protectedClassIds = new Set();
    try {
      const finalizedFilter = { status: { $in: ['paid', 'refunded'] } };
      const [byClass, byLesson] = await Promise.all([
        Invoice.distinct('items.class', finalizedFilter),
        Invoice.distinct('items.lessonId', finalizedFilter),
      ]);
      for (const id of [...(byClass || []), ...(byLesson || [])]) {
        if (!id) continue;
        const str = String(id);
        if (str && str !== '[object Object]') protectedClassIds.add(str);
      }
    } catch (protErr) {
      console.warn('[MarkUnreportedJob] ⚠️ Could not build paid-invoice safety set; skipping cleanup this run:', protErr.message);
      return { success: false, error: 'protected_set_failed' };
    }

    // Candidate classes: old, never reported, window fully closed, still open-ended.
    const candidates = await Class.find({
      scheduledDate: { $lt: cutoff },
      'classReport.submittedAt': { $exists: false },
      'reportSubmission.status': 'unreported',
      status: { $in: ['scheduled', 'unreported'] },
    }).select('_id').lean();

    const deletableIds = (candidates || [])
      .filter((c) => c && c._id && !protectedClassIds.has(String(c._id)))
      .map((c) => c._id);

    if (!deletableIds.length) {
      console.log(`[MarkUnreportedJob] ✅ No deletable unreported classes older than ${days} days (protected ${protectedClassIds.size} paid-invoice refs)`);
      return { success: true, deleted: 0, days, protected: protectedClassIds.size };
    }

    const result = await Class.deleteMany({ _id: { $in: deletableIds } });
    console.log(`[MarkUnreportedJob] ✅ Deleted ${result.deletedCount || 0} unreported class(es) older than ${days} days (protected ${protectedClassIds.size} paid-invoice refs)`);
    return { success: true, deleted: result.deletedCount || 0, days, protected: protectedClassIds.size };
  } catch (err) {
    console.error('[MarkUnreportedJob] ❌ Error cleaning old unreported classes:', err.message);
    return { success: false, error: err.message };
  }
}

// If run directly
if (require.main === module) {
  const mongoose = require('mongoose');
  
  const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb';
  
  mongoose.connect(mongoURI)
    .then(() => {
      console.log('[MarkUnreportedJob] Connected to MongoDB');
      return runJob();
    })
    .then(() => {
      console.log('[MarkUnreportedJob] Job finished, disconnecting...');
      return mongoose.disconnect();
    })
    .then(() => {
      console.log('[MarkUnreportedJob] Disconnected');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MarkUnreportedJob] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  runJob,
  markUnreportedClasses,
  initializeRecentlyEndedClasses,
  cleanupOldUnreportedClasses,
};
