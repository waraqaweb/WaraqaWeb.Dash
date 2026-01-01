// backend/jobs/generateTeacherInvoicesJob.js
/**
 * Monthly Teacher Invoice Generation Job
 * Runs automatically on the 1st of each month at 00:05 Africa/Cairo time
 * Generates salary invoices for all active teachers
 */

const cron = require('node-cron');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const CAIRO_TZ = 'Africa/Cairo';

const TeacherSalaryService = require('../services/teacherSalaryService');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
const TeacherSalaryAudit = require('../models/TeacherSalaryAudit');

// Redis-based locking to prevent concurrent execution
let redis = null;
let isJobRunning = false;
const JOB_LOCK_KEY = 'teacher_invoice_generation_lock';
const JOB_LOCK_TTL = 600; // 10 minutes

/**
 * Acquire lock using Redis or in-memory fallback
 */
async function acquireLock() {
  if (redis) {
    try {
      // Try to set lock with NX (only if not exists) and EX (expiration)
      const result = await redis.set(JOB_LOCK_KEY, Date.now(), 'EX', JOB_LOCK_TTL, 'NX');
      return result === 'OK';
    } catch (error) {
      console.error('[acquireLock] Redis error:', error);
      // Fall back to in-memory lock
    }
  }

  // In-memory fallback
  if (isJobRunning) {
    return false;
  }
  isJobRunning = true;
  return true;
}

/**
 * Release lock
 */
async function releaseLock() {
  if (redis) {
    try {
      await redis.del(JOB_LOCK_KEY);
    } catch (error) {
      console.error('[releaseLock] Redis error:', error);
    }
  }
  isJobRunning = false;
}

/**
 * Send notification to admins about job completion
 */
async function notifyAdmins(results) {
  try {
    const notificationService = require('../services/notificationService');
    
    // Prepare summary for admin notification
    const summary = {
      month: results.month,
      year: results.year,
      totalProcessed: results.summary.total,
      created: results.summary.created,
      skipped: results.skippedTeachers || [],
      failed: results.errors || []
    };

    // Use the dedicated admin notification function (sends in-app + email)
    await notificationService.notifyAdminInvoiceGeneration(summary);
    
    console.log('[notifyAdmins] Admin notifications sent successfully');
  } catch (error) {
    console.error('[notifyAdmins] Error:', error);
  }
}

/**
 * Send notifications to teachers about new invoices
 */
async function notifyTeachers(invoices) {
  try {
    const notificationService = require('../services/notificationService');

    for (const invoice of invoices) {
      if (!invoice || !invoice.teacher) continue;

      try {
        await notificationService.createNotification({
          userId: invoice.teacher,
          title: 'New Salary Invoice',
          message: `Your salary invoice for ${invoice.month}/${invoice.year} has been generated. Total hours: ${invoice.totalHours}`,
          type: 'invoice',
          relatedTo: 'teacher_invoice',
          relatedId: invoice._id,
          actionRequired: false
        });
      } catch (error) {
        console.error(`[notifyTeachers] Error notifying teacher ${invoice.teacher}:`, error);
      }
    }
  } catch (error) {
    console.error('[notifyTeachers] Error:', error);
  }
}

/**
 * Main job function
 */
async function generateTeacherInvoices() {
  const startTime = Date.now();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[GenerateTeacherInvoicesJob] Starting at ${new Date().toISOString()}`);
  console.log(`${'='.repeat(80)}\n`);

  // Try to acquire lock
  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    console.log('[GenerateTeacherInvoicesJob] Job already running, skipping');
    return;
  }

  try {
    // Get previous month (invoices are generated on 1st for previous month)
    const now = dayjs().tz(CAIRO_TZ);
    const targetDate = now.subtract(1, 'month');
    const month = targetDate.month() + 1; // dayjs months are 0-indexed
    const year = targetDate.year();

    console.log(`[GenerateTeacherInvoicesJob] Target period: ${year}-${String(month).padStart(2, '0')}`);

    // Check if settings are configured
    const settings = await SalarySettings.getGlobalSettings();
    if (!settings.autoGenerateInvoices) {
      console.log('[GenerateTeacherInvoicesJob] Auto-generation disabled in settings, skipping');
      await releaseLock();
      return;
    }

    // Validate exchange rate exists
    const exchangeRateExists = await MonthlyExchangeRates.hasRateForMonth(month, year);
    if (!exchangeRateExists) {
      console.error(`[GenerateTeacherInvoicesJob] Exchange rate not set for ${year}-${String(month).padStart(2, '0')}`);
      
      // Log failure
      await TeacherSalaryAudit.logAction({
        action: 'job_fail',
        entityType: 'System',
        actorRole: 'system',
        success: false,
        errorMessage: `Exchange rate not set for ${year}-${String(month).padStart(2, '0')}`,
        metadata: { month, year }
      });

      // Notify admins
      await notifyAdmins({
        month,
        year,
        summary: {
          total: 0,
          created: 0,
          skipped: 0,
          failed: 1
        },
        skippedTeachers: [],
        errors: [
          { teacherName: 'System', error: 'Exchange rate not set' }
        ]
      });

      await releaseLock();
      return;
    }

    // Generate invoices
    console.log('[GenerateTeacherInvoicesJob] Starting invoice generation...');
    const results = await TeacherSalaryService.generateMonthlyInvoices(month, year, {
      userId: null, // System-generated
      dryRun: false
    });

    // Ensure month/year are present for downstream notifications/emails
    results.month = month;
    results.year = year;

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n' + '-'.repeat(80));
    console.log('[GenerateTeacherInvoicesJob] Results:');
    console.log(`- Total Teachers: ${results.summary.total}`);
    console.log(`- Invoices Created: ${results.summary.created}`);
    console.log(`- Skipped: ${results.summary.skipped}`);
    console.log(`- Failed: ${results.summary.failed}`);
    console.log(`- Duration: ${duration}s`);
    console.log('-'.repeat(80) + '\n');

    // Log errors if any
    if (results.errors.length > 0) {
      console.error('[GenerateTeacherInvoicesJob] Errors:');
      results.errors.forEach(err => {
        console.error(`  - ${err.teacherName}: ${err.error}`);
      });
    }

    // Notify admins about completion
    if (settings.notifyAdminsOnGeneration) {
      await notifyAdmins(results);
    }

    // Notify teachers about new invoices
    if (settings.notifyTeachersOnPublish && results.invoices.length > 0) {
      // Note: This notifies on generation, but setting says "on publish"
      // In production, you might want to wait until admin publishes
      // For now, we'll skip teacher notifications here
      // await notifyTeachers(results.invoices);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[GenerateTeacherInvoicesJob] Completed at ${new Date().toISOString()}`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error('[GenerateTeacherInvoicesJob] Error:', error);
    console.error(error.stack);

    // Log failure
    await TeacherSalaryAudit.logAction({
      action: 'job_fail',
      entityType: 'System',
      actorRole: 'system',
      success: false,
      errorMessage: error.message,
      metadata: {
        timestamp: new Date(),
        stack: error.stack
      }
    });

  } finally {
    await releaseLock();
  }
}

/**
 * Manual trigger function (for testing or admin override)
 */
async function manualTrigger(month, year, userId = null) {
  console.log(`[GenerateTeacherInvoicesJob] Manual trigger for ${year}-${month} by user ${userId}`);

  try {
    const results = await TeacherSalaryService.generateMonthlyInvoices(month, year, {
      userId,
      dryRun: false
    });

    console.log('[GenerateTeacherInvoicesJob] Manual trigger completed:', results.summary);

    return results;
  } catch (error) {
    console.error('[GenerateTeacherInvoicesJob] Manual trigger error:', error);
    throw error;
  }
}

/**
 * Dry run function (for testing without creating invoices)
 */
async function dryRun(month, year) {
  console.log(`[GenerateTeacherInvoicesJob] Dry run for ${year}-${month}`);

  try {
    const results = await TeacherSalaryService.generateMonthlyInvoices(month, year, {
      userId: null,
      dryRun: true
    });

    console.log('[GenerateTeacherInvoicesJob] Dry run completed:', results.summary);

    return results;
  } catch (error) {
    console.error('[GenerateTeacherInvoicesJob] Dry run error:', error);
    throw error;
  }
}

/**
 * Initialize job scheduler
 */
function initializeJob(redisClient = null) {
  redis = redisClient;

  // Schedule job to run on 1st of every month at 00:05 Cairo time
  // Cron format: minute hour day month day-of-week
  const schedule = '5 0 1 * *'; // At 00:05 on day-of-month 1

  console.log('[GenerateTeacherInvoicesJob] Initializing scheduler...');
  console.log(`[GenerateTeacherInvoicesJob] Schedule: ${schedule} (1st of month at 00:05 ${CAIRO_TZ})`);

  const task = cron.schedule(schedule, generateTeacherInvoices, {
    scheduled: true,
    timezone: CAIRO_TZ
  });

  console.log('[GenerateTeacherInvoicesJob] Scheduler initialized successfully');

  return task;
}

/**
 * Cleanup stale locks (run every 10 minutes)
 */
function initializeLockCleanup(redisClient = null) {
  if (!redisClient) return null;

  redis = redisClient;

  const schedule = '*/10 * * * *'; // Every 10 minutes

  const task = cron.schedule(schedule, async () => {
    try {
      // Check if lock exists and is stale (older than TTL)
      const lockValue = await redis.get(JOB_LOCK_KEY);
      if (lockValue) {
        const lockTime = parseInt(lockValue, 10);
        const now = Date.now();
        const age = now - lockTime;

        if (age > JOB_LOCK_TTL * 1000) {
          console.log(`[LockCleanup] Removing stale lock (age: ${(age / 1000).toFixed(0)}s)`);
          await redis.del(JOB_LOCK_KEY);
        }
      }
    } catch (error) {
      console.error('[LockCleanup] Error:', error);
    }
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  console.log('[LockCleanup] Stale lock cleanup initialized');

  return task;
}

/**
 * Start all teacher invoice generation jobs
 */
function startInvoiceGenerationJob() {
  initializeJob();
  initializeLockCleanup();
}

module.exports = {
  initializeJob,
  initializeLockCleanup,
  startInvoiceGenerationJob,
  manualTrigger,
  dryRun,
  generateTeacherInvoices
};
