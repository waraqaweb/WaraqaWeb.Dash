const SystemVacation = require('../models/SystemVacation');
const Class = require('../models/Class');
const User = require('../models/User');
const notificationService = require('./notificationService');
const { formatTimeInTimezone, DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');

const buildAffectedClassesQuery = (startDate, endDate) => ({
  scheduledDate: {
    $gte: startDate,
    $lte: endDate
  },
  status: { $in: ['scheduled', 'in_progress'] }
});

const buildSystemVacationOverlapQuery = (startDate, endDate) => ({
  isActive: true,
  startDate: { $lt: endDate },
  endDate: { $gt: startDate }
});

/**
 * Apply system vacation effects - put affected classes on hold
 * @param {Object} systemVacation - System vacation document
 */
async function applySystemVacation(systemVacation) {
  try {
    const affectedClasses = await Class.countDocuments(
      buildAffectedClassesQuery(systemVacation.startDate, systemVacation.endDate)
    );

    systemVacation.affectedClasses = affectedClasses;
    await systemVacation.save();

    await putClassesOnHold(systemVacation);

    // Send notifications to all users
    await sendSystemVacationNotifications(systemVacation);

    return systemVacation;
  } catch (error) {
    console.error('Error applying system vacation:', error);
    throw error;
  }
}

/**
 * Create a system-wide vacation (like Eid holidays)
 * @param {Object} vacationData - The vacation data
 * @param {string} vacationData.name - Name of the vacation (e.g., "Eid Al-Fitr 2025")
 * @param {string} vacationData.message - Message to users about the vacation
 * @param {Date} vacationData.startDate - Start date in the specified timezone
 * @param {Date} vacationData.endDate - End date in the specified timezone
 * @param {string} vacationData.timezone - Timezone for the vacation period
 * @param {string} vacationData.createdBy - Admin user ID
 */
async function createSystemVacation(vacationData) {
  try {
    const systemVacation = new SystemVacation({
      name: vacationData.name,
      message: vacationData.message,
      startDate: vacationData.startDate,
      endDate: vacationData.endDate,
      timezone: vacationData.timezone,
      createdBy: vacationData.createdBy
    });

    const affectedClasses = await Class.countDocuments(
      buildAffectedClassesQuery(vacationData.startDate, vacationData.endDate)
    );

    systemVacation.affectedClasses = affectedClasses;
    await systemVacation.save();

    await putClassesOnHold(systemVacation);

    // Send notifications to all users
    await sendSystemVacationNotifications(systemVacation);

    return systemVacation;
  } catch (error) {
    console.error('Error creating system vacation:', error);
    throw error;
  }
}

/**
 * Put classes on hold for system vacation
 * @param {Object} systemVacation - System vacation document
 */
async function putClassesOnHold(systemVacation) {
  try {
    const now = new Date();
    const result = await Class.updateMany(
      buildAffectedClassesQuery(systemVacation.startDate, systemVacation.endDate),
      {
        $set: {
          status: 'on_hold',
          hidden: true,
          'cancellation.reason': `System Vacation: ${systemVacation.name}`,
          'cancellation.cancelledBy': systemVacation.createdBy,
          'cancellation.cancelledByRole': 'admin',
          'cancellation.cancelledAt': now,
          'cancellation.isTemporary': true,
          'cancellation.systemVacationId': systemVacation._id,
        },
      }
    );

    const modifiedCount = result?.modifiedCount ?? result?.nModified ?? 0;
    console.log(`Put ${modifiedCount} classes on hold for system vacation: ${systemVacation.name}`);
  } catch (error) {
    console.error('Error putting classes on hold:', error);
    throw error;
  }
}

/**
 * Send notifications to all users about system vacation
 * @param {Object} systemVacation - System vacation document
 */
async function sendSystemVacationNotifications(systemVacation) {
  try {
    // Get all active users (teachers and guardians)
    const users = await User.find({
      role: { $in: ['teacher', 'guardian'] },
      isActive: true
    });

    for (const user of users) {
      const tz = user?.timezone || DEFAULT_TIMEZONE;
      const startLabel = formatTimeInTimezone(systemVacation.startDate, tz, 'DD MMM YYYY hh:mm A');
      const endLabel = formatTimeInTimezone(systemVacation.endDate, tz, 'DD MMM YYYY hh:mm A');
      const baseMessage = `System vacation “${systemVacation.name}” is active (${startLabel} → ${endLabel}).`;
      const extra = systemVacation.message ? ` ${systemVacation.message}` : '';

      await notificationService.createNotification({
        userId: user._id,
        title: `System vacation: ${systemVacation.name}`,
        message: `${baseMessage}${extra}`.trim(),
        type: 'info',
        relatedTo: 'vacation',
        relatedId: systemVacation._id,
        actionRequired: false,
        metadata: {
          kind: 'system_vacation',
          vacationId: String(systemVacation._id),
          startDate: systemVacation.startDate?.toISOString?.() || systemVacation.startDate,
          endDate: systemVacation.endDate?.toISOString?.() || systemVacation.endDate,
          recipientTimezone: tz
        }
      });
    }

    // Mark notifications as sent
    systemVacation.notificationsSent = true;
    await systemVacation.save();

    console.log(`Sent system vacation notifications to ${users.length} users`);
  } catch (error) {
    console.error('Error sending system vacation notifications:', error);
    throw error;
  }
}

/**
 * Restore classes after system vacation ends
 * @param {string} systemVacationId - System vacation ID
 */
async function restoreClassesAfterSystemVacation(systemVacationId) {
  try {
    const result = await Class.updateMany(
      {
        'cancellation.systemVacationId': systemVacationId,
        status: 'on_hold'
      },
      {
        $set: {
          status: 'scheduled',
          hidden: false,
        },
        $unset: {
          cancellation: '',
        },
      }
    );

    const restoredCount = result?.modifiedCount ?? result?.nModified ?? 0;
    console.log(`Restored ${restoredCount} classes after system vacation`);
    return restoredCount;
  } catch (error) {
    console.error('Error restoring classes after system vacation:', error);
    throw error;
  }
}

/**
 * Get currently active system vacation
 * @returns {Promise<SystemVacation|null>}
 */
async function getCurrentVacation() {
  try {
    const now = new Date();
    return await SystemVacation.findOne({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    }).populate('createdBy', 'firstName lastName email');
  } catch (error) {
    console.error('Error getting current system vacation:', error);
    return null;
  }
}

/**
 * Get the current active system vacation or the next upcoming active vacation.
 * @param {Date} referenceDate
 * @returns {Promise<SystemVacation|null>}
 */
async function getCurrentOrUpcomingVacation(referenceDate = new Date()) {
  try {
    return await SystemVacation.findOne({
      isActive: true,
      endDate: { $gte: referenceDate }
    })
      .populate('createdBy', 'firstName lastName email')
      .sort({ startDate: 1 });
  } catch (error) {
    console.error('Error getting current or upcoming system vacation:', error);
    return null;
  }
}

/**
 * Get active system vacation that affects a given date
 * @param {Date} date - Date to check
 * @returns {Promise<SystemVacation|null>}
 */
async function getActiveSystemVacationForDate(date) {
  try {
    return await SystemVacation.findOne({
      isActive: true,
      startDate: { $lte: date },
      endDate: { $gte: date }
    });
  } catch (error) {
    console.error('Error checking system vacation for date:', error);
    return null;
  }
}

/**
 * Get an overlapping active system vacation for a date range.
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<SystemVacation|null>}
 */
async function getOverlappingSystemVacation(startDate, endDate) {
  try {
    return await SystemVacation.findOne(buildSystemVacationOverlapQuery(startDate, endDate))
      .sort({ startDate: 1 });
  } catch (error) {
    console.error('Error checking overlapping system vacation:', error);
    return null;
  }
}

/**
 * Get all system vacations (for admin panel)
 * @param {Object} filters - Optional filters
 * @returns {Promise<Array>}
 */
async function getAllSystemVacations(filters = {}) {
  try {
    return await SystemVacation.find(filters)
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 });
  } catch (error) {
    console.error('Error getting system vacations:', error);
    throw error;
  }
}

/**
 * End a system vacation early
 * @param {string} systemVacationId - System vacation ID
 * @param {string} adminId - Admin user ID
 */
async function endSystemVacation(systemVacationId, adminId) {
  try {
    const systemVacation = await SystemVacation.findById(systemVacationId);
    if (!systemVacation) {
      throw new Error('System vacation not found');
    }

    // Mark as inactive
    systemVacation.isActive = false;
    systemVacation.endDate = new Date();
    await systemVacation.save();

    // Restore affected classes
    const restoredCount = await restoreClassesAfterSystemVacation(systemVacationId);

    // Send notifications about early end
    const users = await User.find({
      role: { $in: ['teacher', 'guardian'] },
      isActive: true
    });

    for (const user of users) {
      await notificationService.createNotification({
        userId: user._id,
        title: `System Vacation Ended: ${systemVacation.name}`,
        message: `The system vacation "${systemVacation.name}" has been ended early. Normal class schedule has resumed.`,
        type: 'success',
        relatedTo: 'vacation',
        relatedId: systemVacation._id,
        actionRequired: false
      });
    }

    return { systemVacation, restoredCount };
  } catch (error) {
    console.error('Error ending system vacation:', error);
    throw error;
  }
}

/**
 * Check and automatically restore classes after system vacations end
 * Should be called periodically
 */
async function checkAndRestoreExpiredSystemVacations() {
  try {
    const now = new Date();
    const expiredVacations = await SystemVacation.find({
      isActive: true,
      endDate: { $lt: now }
    });

    for (const vacation of expiredVacations) {
      vacation.isActive = false;
      await vacation.save();
      
      await restoreClassesAfterSystemVacation(vacation._id);
      
      // Send notifications about vacation end
      const users = await User.find({
        role: { $in: ['teacher', 'guardian'] },
        isActive: true
      });

      for (const user of users) {
        await notificationService.createNotification({
          userId: user._id,
          title: `System Vacation Ended: ${vacation.name}`,
          message: `The system vacation "${vacation.name}" has ended. Normal class schedule has resumed.`,
          type: 'success',
          relatedTo: 'vacation',
          relatedId: vacation._id,
          actionRequired: false
        });
      }
    }

    console.log(`Processed ${expiredVacations.length} expired system vacations`);
  } catch (error) {
    console.error('Error checking expired system vacations:', error);
  }
}

module.exports = {
  createSystemVacation,
  applySystemVacation,
  putClassesOnHold,
  sendSystemVacationNotifications,
  restoreClassesAfterSystemVacation,
  getCurrentVacation,
  getCurrentOrUpcomingVacation,
  getActiveSystemVacationForDate,
  getOverlappingSystemVacation,
  getAllSystemVacations,
  endSystemVacation,
  checkAndRestoreExpiredSystemVacations
};