/**
 * Timezone Service - Backend timezone utilities
 * 
 * Handles timezone conversion, validation, and time formatting
 * for the backend API
 */

const moment = require('moment-timezone');

// Default timezone for the system (Cairo)
const DEFAULT_TIMEZONE = 'Africa/Cairo';

/**
 * Validate if a timezone is valid
 * @param {string} timezone - Timezone to validate
 * @returns {boolean} Is valid timezone
 */
const isValidTimezone = (timezone) => {
  try {
    return moment.tz.zone(timezone) !== null;
  } catch (error) {
    return false;
  }
};

/**
 * Convert time from one timezone to another
 * @param {Date|string} dateTime - Date/time to convert
 * @param {string} fromTimezone - Source timezone
 * @param {string} toTimezone - Target timezone
 * @returns {Date} Converted date
 */
const convertTimezone = (dateTime, fromTimezone, toTimezone) => {
  try {
    return moment.tz(dateTime, fromTimezone).tz(toTimezone).toDate();
  } catch (error) {
    console.error('Timezone conversion error:', error);
    return new Date(dateTime);
  }
};

/**
 * Get current time in specified timezone
 * @param {string} timezone - Target timezone
 * @returns {Date} Current time in timezone
 */
const getCurrentTimeInTimezone = (timezone = DEFAULT_TIMEZONE) => {
  try {
    return moment.tz(timezone).toDate();
  } catch (error) {
    console.error('Get current time error:', error);
    return new Date();
  }
};

/**
 * Format date/time for display in specific timezone
 * @param {Date|string} dateTime - Date/time to format
 * @param {string} timezone - Target timezone
 * @param {string} format - Moment format string
 * @returns {string} Formatted date/time
 */
const formatTimeInTimezone = (dateTime, timezone = DEFAULT_TIMEZONE, format = 'YYYY-MM-DD HH:mm:ss z') => {
  try {
    return moment.tz(dateTime, timezone).format(format);
  } catch (error) {
    console.error('Time formatting error:', error);
    return moment(dateTime).format(format);
  }
};

/**
 * Convert class time for user's timezone
 * @param {Date|string} classTime - Original class time
 * @param {string} classTimezone - Class timezone
 * @param {string} userTimezone - User's timezone
 * @returns {object} Conversion info
 */
const convertClassTimeForUser = (classTime, classTimezone = DEFAULT_TIMEZONE, userTimezone = DEFAULT_TIMEZONE) => {
  try {
    const originalMoment = moment.tz(classTime, classTimezone);
    const convertedMoment = originalMoment.clone().tz(userTimezone);
    
    return {
      originalTime: originalMoment.toDate(),
      convertedTime: convertedMoment.toDate(),
      originalFormatted: originalMoment.format('YYYY-MM-DD HH:mm:ss z'),
      convertedFormatted: convertedMoment.format('YYYY-MM-DD HH:mm:ss z'),
      originalTimezone: classTimezone,
      userTimezone: userTimezone,
      isConverted: classTimezone !== userTimezone,
      offset: convertedMoment.utcOffset() - originalMoment.utcOffset()
    };
  } catch (error) {
    console.error('Class time conversion error:', error);
    return {
      originalTime: new Date(classTime),
      convertedTime: new Date(classTime),
      originalFormatted: moment(classTime).format('YYYY-MM-DD HH:mm:ss'),
      convertedFormatted: moment(classTime).format('YYYY-MM-DD HH:mm:ss'),
      originalTimezone: classTimezone,
      userTimezone: userTimezone,
      isConverted: false,
      offset: 0
    };
  }
};

/**
 * Get timezone offset in hours
 * @param {string} timezone - Timezone
 * @returns {number} Offset in hours
 */
const getTimezoneOffset = (timezone) => {
  try {
    return moment.tz(timezone).utcOffset() / 60;
  } catch (error) {
    console.error('Get timezone offset error:', error);
    return 0;
  }
};

/**
 * Convert user input time to UTC for storage
 * @param {string|Date} inputTime - User input time
 * @param {string} userTimezone - User's timezone
 * @returns {Date} UTC date
 */
const convertToUTC = (inputTime, userTimezone = DEFAULT_TIMEZONE) => {
  try {
    return moment.tz(inputTime, userTimezone).utc().toDate();
  } catch (error) {
    console.error('Convert to UTC error:', error);
    return new Date(inputTime);
  }
};

/**
 * Convert UTC time to user's timezone for display
 * @param {string|Date} utcTime - UTC time
 * @param {string} userTimezone - User's timezone
 * @returns {Date} Time in user's timezone
 */
const convertFromUTC = (utcTime, userTimezone = DEFAULT_TIMEZONE) => {
  try {
    return moment.utc(utcTime).tz(userTimezone).toDate();
  } catch (error) {
    console.error('Convert from UTC error:', error);
    return new Date(utcTime);
  }
};

/**
 * Add timezone info to API response
 * @param {object} data - Response data
 * @param {string} userTimezone - User's timezone
 * @param {Array<string>} timeFields - Fields containing time data
 * @returns {object} Enhanced data with timezone info
 */
const addTimezoneInfo = (data, userTimezone = DEFAULT_TIMEZONE, timeFields = ['scheduledDate', 'createdAt', 'updatedAt']) => {
  try {
    if (!data) return data;
    
    const enhanced = { ...data };
    
    // Add timezone conversion info for time fields
    timeFields.forEach(field => {
      if (enhanced[field]) {
        const timeInfo = convertClassTimeForUser(enhanced[field], enhanced.timezone || DEFAULT_TIMEZONE, userTimezone);
        enhanced[`${field}_user`] = {
          displayTime: timeInfo.convertedTime,
          formatted: timeInfo.convertedFormatted,
          isConverted: timeInfo.isConverted,
          originalTime: timeInfo.originalTime,
          originalFormatted: timeInfo.originalFormatted
        };
      }
    });
    
    // Add user timezone info
    enhanced.userTimezone = userTimezone;
    enhanced.systemTimezone = enhanced.timezone || DEFAULT_TIMEZONE;
    
    return enhanced;
  } catch (error) {
    console.error('Add timezone info error:', error);
    return data;
  }
};

/**
 * Process array of objects with timezone conversion
 * @param {Array} items - Array of items to process
 * @param {string} userTimezone - User's timezone
 * @param {Array<string>} timeFields - Fields containing time data
 * @returns {Array} Processed array with timezone info
 */
const processArrayWithTimezone = (items, userTimezone = DEFAULT_TIMEZONE, timeFields = ['scheduledDate', 'createdAt', 'updatedAt']) => {
  try {
    if (!Array.isArray(items)) return items;
    
    return items.map(item => addTimezoneInfo(item, userTimezone, timeFields));
  } catch (error) {
    console.error('Process array with timezone error:', error);
    return items;
  }
};

/**
 * Get available timezones list
 * @returns {Array} List of timezone objects
 */
const getAvailableTimezones = () => {
  try {
    return moment.tz.names().map(name => ({
      value: name,
      label: name,
      offset: moment.tz(name).format('Z'),
      offsetHours: moment.tz(name).utcOffset() / 60
    }));
  } catch (error) {
    console.error('Get available timezones error:', error);
    return [{ value: DEFAULT_TIMEZONE, label: DEFAULT_TIMEZONE, offset: '+02:00', offsetHours: 2 }];
  }
};

module.exports = {
  DEFAULT_TIMEZONE,
  isValidTimezone,
  convertTimezone,
  getCurrentTimeInTimezone,
  formatTimeInTimezone,
  convertClassTimeForUser,
  getTimezoneOffset,
  convertToUTC,
  convertFromUTC,
  addTimezoneInfo,
  processArrayWithTimezone,
  getAvailableTimezones
};