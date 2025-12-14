/**
 * Scheduled Jobs for DST and Timezone Management
 * 
 * Handles periodic tasks for:
 * - DST transition checking and notifications
 * - Class time adjustments
 * - User timezone validation
 */

const cron = require('node-cron');
const dstService = require('../services/dstService');

/**
 * Start all scheduled jobs
 */
const startScheduledJobs = () => {
  console.log('🚀 Starting timezone and DST scheduled jobs...');
  
  // Daily DST check at 6:00 AM
  cron.schedule('0 6 * * *', async () => {
    console.log('📅 Running daily DST check...');
    try {
      await dstService.performDSTCheck();
    } catch (error) {
      console.error('Daily DST check failed:', error);
    }
  }, {
    timezone: 'UTC' // Run in UTC to avoid timezone issues
  });
  
  // Hourly check for immediate DST transitions (during DST transition periods)
  cron.schedule('0 * * * *', async () => {
    try {
      // Only run detailed checks during potential DST transition months
      const now = new Date();
      const month = now.getMonth() + 1; // 1-12
      
      // March, April, October, November are common DST transition months
      if ([3, 4, 10, 11].includes(month)) {
        console.log('🕐 Running hourly DST transition check...');
        await dstService.performDSTCheck();
      }
    } catch (error) {
      console.error('Hourly DST check failed:', error);
    }
  }, {
    timezone: 'UTC'
  });
  
  // Weekly timezone validation check (every Sunday at 2:00 AM)
  cron.schedule('0 2 * * 0', async () => {
    console.log('🔍 Running weekly timezone validation check...');
    try {
      await validateUserTimezones();
    } catch (error) {
      console.error('Weekly timezone validation failed:', error);
    }
  }, {
    timezone: 'UTC'
  });
  
  console.log('✅ Scheduled jobs started successfully');
};

/**
 * Validate all user timezones and log issues
 */
const validateUserTimezones = async () => {
  try {
    const User = require('../models/User');
    const { isValidTimezone } = require('../utils/timezoneUtils');
    
    const users = await User.find({ isActive: true }).select('_id email timezone role');
    let invalidCount = 0;
    
    for (const user of users) {
      if (user.timezone && !isValidTimezone(user.timezone)) {
        console.warn(`⚠️ Invalid timezone for user ${user.email}: ${user.timezone}`);
        invalidCount++;
        
        // Optionally reset to default timezone
        // user.timezone = 'Africa/Cairo';
        // await user.save();
      }
    }
    
    console.log(`📊 Timezone validation completed. ${users.length} users checked, ${invalidCount} invalid timezones found.`);
  } catch (error) {
    console.error('Validate user timezones error:', error);
  }
};

/**
 * Stop all scheduled jobs (for graceful shutdown)
 */
const stopScheduledJobs = () => {
  console.log('🛑 Stopping scheduled jobs...');
  cron.getTasks().forEach(task => task.stop());
  console.log('✅ All scheduled jobs stopped');
};

module.exports = {
  startScheduledJobs,
  stopScheduledJobs,
  validateUserTimezones
};