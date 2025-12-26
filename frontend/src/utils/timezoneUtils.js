/**
 * Comprehensive Timezone Utilities
 * 
 * Handles timezone conversion, formatting, and provides a searchable list
 * of all available timezones with cities and countries
 */

import moment from 'moment-timezone';

/**
 * Get timezone display label with current offset (DST-aware)
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Display label with current offset
 */
export const getTimezoneDisplayLabel = (timezone) => {
  try {
    const now = new Date();
    const offset = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      timeZoneName: 'longOffset'
    }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value;
    
    // Clean up the offset format
    const cleanOffset = offset?.replace('GMT', 'UTC') || 'UTC+0';
    
    // Extract city and country from timezone
    const parts = timezone.split('/');
    const city = parts[parts.length - 1].replace(/_/g, ' ');
    
    // Try to get country from our mapping
    const timezoneInfo = TIMEZONE_LIST.find(tz => tz.value === timezone);
    const country = timezoneInfo?.country || parts[0];
    
    return `${city}, ${country} (${cleanOffset})`;
  } catch (error) {
    console.error('Get timezone display label error:', error);
    return timezone;
  }
};

/**
 * Comprehensive timezone list with cities, countries, and regions
 */
export const TIMEZONE_LIST = [
  // Africa
  { value: 'Africa/Cairo', label: 'Cairo, Egypt (UTC+2)', country: 'Egypt', city: 'Cairo', region: 'Africa' },
  { value: 'Africa/Johannesburg', label: 'Johannesburg, South Africa (UTC+2)', country: 'South Africa', city: 'Johannesburg', region: 'Africa' },
  { value: 'Africa/Lagos', label: 'Lagos, Nigeria (UTC+1)', country: 'Nigeria', city: 'Lagos', region: 'Africa' },
  { value: 'Africa/Casablanca', label: 'Casablanca, Morocco (UTC+1)', country: 'Morocco', city: 'Casablanca', region: 'Africa' },
  { value: 'Africa/Nairobi', label: 'Nairobi, Kenya (UTC+3)', country: 'Kenya', city: 'Nairobi', region: 'Africa' },
  { value: 'Africa/Algiers', label: 'Algiers, Algeria (UTC+1)', country: 'Algeria', city: 'Algiers', region: 'Africa' },
  { value: 'Africa/Tunis', label: 'Tunis, Tunisia (UTC+1)', country: 'Tunisia', city: 'Tunis', region: 'Africa' },
  { value: 'Africa/Addis_Ababa', label: 'Addis Ababa, Ethiopia (UTC+3)', country: 'Ethiopia', city: 'Addis Ababa', region: 'Africa' },

  // Asia
  { value: 'Asia/Dubai', label: 'Dubai, UAE (UTC+4)', country: 'UAE', city: 'Dubai', region: 'Asia' },
  { value: 'Asia/Riyadh', label: 'Riyadh, Saudi Arabia (UTC+3)', country: 'Saudi Arabia', city: 'Riyadh', region: 'Asia' },
  { value: 'Asia/Kuwait', label: 'Kuwait City, Kuwait (UTC+3)', country: 'Kuwait', city: 'Kuwait City', region: 'Asia' },
  { value: 'Asia/Qatar', label: 'Doha, Qatar (UTC+3)', country: 'Qatar', city: 'Doha', region: 'Asia' },
  { value: 'Asia/Bahrain', label: 'Manama, Bahrain (UTC+3)', country: 'Bahrain', city: 'Manama', region: 'Asia' },
  { value: 'Asia/Muscat', label: 'Muscat, Oman (UTC+4)', country: 'Oman', city: 'Muscat', region: 'Asia' },
  { value: 'Asia/Baghdad', label: 'Baghdad, Iraq (UTC+3)', country: 'Iraq', city: 'Baghdad', region: 'Asia' },
  { value: 'Asia/Tehran', label: 'Tehran, Iran (UTC+3:30)', country: 'Iran', city: 'Tehran', region: 'Asia' },
  { value: 'Asia/Beirut', label: 'Beirut, Lebanon (UTC+2)', country: 'Lebanon', city: 'Beirut', region: 'Asia' },
  { value: 'Asia/Damascus', label: 'Damascus, Syria (UTC+2)', country: 'Syria', city: 'Damascus', region: 'Asia' },
  { value: 'Asia/Amman', label: 'Amman, Jordan (UTC+2)', country: 'Jordan', city: 'Amman', region: 'Asia' },
  { value: 'Asia/Jerusalem', label: 'Jerusalem, Israel (UTC+2)', country: 'Israel', city: 'Jerusalem', region: 'Asia' },
  { value: 'Asia/Istanbul', label: 'Istanbul, Turkey (UTC+3)', country: 'Turkey', city: 'Istanbul', region: 'Asia' },
  { value: 'Asia/Kolkata', label: 'Mumbai/Delhi, India (UTC+5:30)', country: 'India', city: 'Mumbai', region: 'Asia' },
  { value: 'Asia/Karachi', label: 'Karachi, Pakistan (UTC+5)', country: 'Pakistan', city: 'Karachi', region: 'Asia' },
  { value: 'Asia/Dhaka', label: 'Dhaka, Bangladesh (UTC+6)', country: 'Bangladesh', city: 'Dhaka', region: 'Asia' },
  { value: 'Asia/Shanghai', label: 'Beijing/Shanghai, China (UTC+8)', country: 'China', city: 'Beijing', region: 'Asia' },
  { value: 'Asia/Tokyo', label: 'Tokyo, Japan (UTC+9)', country: 'Japan', city: 'Tokyo', region: 'Asia' },
  { value: 'Asia/Seoul', label: 'Seoul, South Korea (UTC+9)', country: 'South Korea', city: 'Seoul', region: 'Asia' },
  { value: 'Asia/Bangkok', label: 'Bangkok, Thailand (UTC+7)', country: 'Thailand', city: 'Bangkok', region: 'Asia' },
  { value: 'Asia/Singapore', label: 'Singapore (UTC+8)', country: 'Singapore', city: 'Singapore', region: 'Asia' },
  { value: 'Asia/Manila', label: 'Manila, Philippines (UTC+8)', country: 'Philippines', city: 'Manila', region: 'Asia' },
  { value: 'Asia/Jakarta', label: 'Jakarta, Indonesia (UTC+7)', country: 'Indonesia', city: 'Jakarta', region: 'Asia' },
  { value: 'Asia/Kuala_Lumpur', label: 'Kuala Lumpur, Malaysia (UTC+8)', country: 'Malaysia', city: 'Kuala Lumpur', region: 'Asia' },

  // Europe
  { value: 'Europe/London', label: 'London, UK (UTC+0/+1)', country: 'United Kingdom', city: 'London', region: 'Europe' },
  { value: 'Europe/Paris', label: 'Paris, France (UTC+1/+2)', country: 'France', city: 'Paris', region: 'Europe' },
  { value: 'Europe/Berlin', label: 'Berlin, Germany (UTC+1/+2)', country: 'Germany', city: 'Berlin', region: 'Europe' },
  { value: 'Europe/Rome', label: 'Rome, Italy (UTC+1/+2)', country: 'Italy', city: 'Rome', region: 'Europe' },
  { value: 'Europe/Madrid', label: 'Madrid, Spain (UTC+1/+2)', country: 'Spain', city: 'Madrid', region: 'Europe' },
  { value: 'Europe/Amsterdam', label: 'Amsterdam, Netherlands (UTC+1/+2)', country: 'Netherlands', city: 'Amsterdam', region: 'Europe' },
  { value: 'Europe/Brussels', label: 'Brussels, Belgium (UTC+1/+2)', country: 'Belgium', city: 'Brussels', region: 'Europe' },
  { value: 'Europe/Vienna', label: 'Vienna, Austria (UTC+1/+2)', country: 'Austria', city: 'Vienna', region: 'Europe' },
  { value: 'Europe/Zurich', label: 'Zurich, Switzerland (UTC+1/+2)', country: 'Switzerland', city: 'Zurich', region: 'Europe' },
  { value: 'Europe/Stockholm', label: 'Stockholm, Sweden (UTC+1/+2)', country: 'Sweden', city: 'Stockholm', region: 'Europe' },
  { value: 'Europe/Oslo', label: 'Oslo, Norway (UTC+1/+2)', country: 'Norway', city: 'Oslo', region: 'Europe' },
  { value: 'Europe/Copenhagen', label: 'Copenhagen, Denmark (UTC+1/+2)', country: 'Denmark', city: 'Copenhagen', region: 'Europe' },
  { value: 'Europe/Helsinki', label: 'Helsinki, Finland (UTC+2/+3)', country: 'Finland', city: 'Helsinki', region: 'Europe' },
  { value: 'Europe/Warsaw', label: 'Warsaw, Poland (UTC+1/+2)', country: 'Poland', city: 'Warsaw', region: 'Europe' },
  { value: 'Europe/Prague', label: 'Prague, Czech Republic (UTC+1/+2)', country: 'Czech Republic', city: 'Prague', region: 'Europe' },
  { value: 'Europe/Budapest', label: 'Budapest, Hungary (UTC+1/+2)', country: 'Hungary', city: 'Budapest', region: 'Europe' },
  { value: 'Europe/Bucharest', label: 'Bucharest, Romania (UTC+2/+3)', country: 'Romania', city: 'Bucharest', region: 'Europe' },
  { value: 'Europe/Athens', label: 'Athens, Greece (UTC+2/+3)', country: 'Greece', city: 'Athens', region: 'Europe' },
  { value: 'Europe/Moscow', label: 'Moscow, Russia (UTC+3)', country: 'Russia', city: 'Moscow', region: 'Europe' },

  // North America
  { value: 'America/New_York', label: 'New York, USA (UTC-5/-4)', country: 'USA', city: 'New York', region: 'North America' },
  { value: 'America/Chicago', label: 'Chicago, USA (UTC-6/-5)', country: 'USA', city: 'Chicago', region: 'North America' },
  { value: 'America/Denver', label: 'Denver, USA (UTC-7/-6)', country: 'USA', city: 'Denver', region: 'North America' },
  { value: 'America/Los_Angeles', label: 'Los Angeles, USA (UTC-8/-7)', country: 'USA', city: 'Los Angeles', region: 'North America' },
  { value: 'America/Toronto', label: 'Toronto, Canada (UTC-5/-4)', country: 'Canada', city: 'Toronto', region: 'North America' },
  { value: 'America/Vancouver', label: 'Vancouver, Canada (UTC-8/-7)', country: 'Canada', city: 'Vancouver', region: 'North America' },
  { value: 'America/Mexico_City', label: 'Mexico City, Mexico (UTC-6/-5)', country: 'Mexico', city: 'Mexico City', region: 'North America' },

  // South America
  { value: 'America/Sao_Paulo', label: 'São Paulo, Brazil (UTC-3/-2)', country: 'Brazil', city: 'São Paulo', region: 'South America' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires, Argentina (UTC-3)', country: 'Argentina', city: 'Buenos Aires', region: 'South America' },
  { value: 'America/Santiago', label: 'Santiago, Chile (UTC-4/-3)', country: 'Chile', city: 'Santiago', region: 'South America' },
  { value: 'America/Lima', label: 'Lima, Peru (UTC-5)', country: 'Peru', city: 'Lima', region: 'South America' },
  { value: 'America/Bogota', label: 'Bogotá, Colombia (UTC-5)', country: 'Colombia', city: 'Bogotá', region: 'South America' },

  // Oceania
  { value: 'Australia/Sydney', label: 'Sydney, Australia (UTC+10/+11)', country: 'Australia', city: 'Sydney', region: 'Oceania' },
  { value: 'Australia/Melbourne', label: 'Melbourne, Australia (UTC+10/+11)', country: 'Australia', city: 'Melbourne', region: 'Oceania' },
  { value: 'Australia/Perth', label: 'Perth, Australia (UTC+8)', country: 'Australia', city: 'Perth', region: 'Oceania' },
  { value: 'Pacific/Auckland', label: 'Auckland, New Zealand (UTC+12/+13)', country: 'New Zealand', city: 'Auckland', region: 'Oceania' },
];

// Default timezone (Cairo)
export const DEFAULT_TIMEZONE = 'Africa/Cairo';

/**
 * Get the current UTC offset for a timezone in minutes (DST-aware)
 * @param {string} timezone - Target timezone
 * @returns {number} Offset in minutes relative to UTC
 */
export const getCurrentOffsetMinutes = (timezone = DEFAULT_TIMEZONE) => {
  try {
    return moment.tz(timezone).utcOffset();
  } catch (error) {
    console.error('Get current offset error:', error);
    return moment.tz(DEFAULT_TIMEZONE).utcOffset();
  }
};

/**
 * Get dynamic timezone list with current offsets
 * @returns {Array} Updated timezone list with current offsets
 */
export const getDynamicTimezoneList = () => {
  return TIMEZONE_LIST.map((tz) => {
    const offsetMinutes = getCurrentOffsetMinutes(tz.value);
    return {
      ...tz,
      label: getTimezoneDisplayLabel(tz.value),
      offsetMinutes
    };
  }).sort((a, b) => {
    const offsetDiff = (a.offsetMinutes ?? 0) - (b.offsetMinutes ?? 0);
    if (offsetDiff !== 0) {
      return offsetDiff;
    }
    return a.label.localeCompare(b.label);
  });
};

/**
 * Convert time from one timezone to another
 * @param {string|Date} dateTime - The date/time to convert
 * @param {string} fromTimezone - Source timezone
 * @param {string} toTimezone - Target timezone
 * @returns {Date} Converted date
 */
export const convertTimezone = (dateTime, fromTimezone, toTimezone) => {
  try {
    if (!dateTime) return null;

    const stringInput = typeof dateTime === 'string' ? dateTime : null;
    const hasExplicitOffset = stringInput ? /([zZ]|[+-]\d{2}:?\d{2})$/.test(stringInput) : false;

    let source;

    if (moment.isMoment(dateTime)) {
      source = dateTime.clone();
    } else if (dateTime instanceof Date || typeof dateTime === 'number') {
      source = moment(dateTime);
    } else if (stringInput && !hasExplicitOffset && fromTimezone) {
      source = moment.tz(stringInput, fromTimezone);
    } else {
      source = moment(dateTime);
    }

    if (!source || !source.isValid()) {
      return new Date(dateTime);
    }

    if (fromTimezone && (hasExplicitOffset || !(stringInput && !hasExplicitOffset))) {
      source = source.clone().tz(fromTimezone);
    }

    if (toTimezone) {
      return source.clone().tz(toTimezone).toDate();
    }

    return source.toDate();
  } catch (error) {
    console.error('Timezone conversion error:', error);
    return new Date(dateTime);
  }
};

/**
 * Format time for display in user's timezone
 * @param {string|Date} dateTime - The date/time to format
 * @param {string} userTimezone - User's timezone
 * @param {object} options - Formatting options
 * @returns {string} Formatted time string
 */
export const formatTimeInTimezone = (dateTime, userTimezone = DEFAULT_TIMEZONE, options = {}) => {
  try {
    const date = new Date(dateTime);
    
    const defaultOptions = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    };
    
    const formatOptions = { ...defaultOptions, ...options, timeZone: userTimezone };
    
    return new Intl.DateTimeFormat('en-US', formatOptions).format(date);
  } catch (error) {
    console.error('Time formatting error:', error);
    return new Date(dateTime).toLocaleString();
  }
};

/**
 * Get current time in a specific timezone
 * @param {string} timezone - Target timezone
 * @returns {Date} Current time in the specified timezone
 */
export const getCurrentTimeInTimezone = (timezone = DEFAULT_TIMEZONE) => {
  try {
    const now = new Date();
    return convertTimezone(now, 'UTC', timezone);
  } catch (error) {
    console.error('Get current time error:', error);
    return new Date();
  }
};

/**
 * Search timezones by query
 * @param {string} query - Search query
 * @returns {Array} Filtered timezone list
 */
export const searchTimezones = (query) => {
  if (!query || query.length < 1) return TIMEZONE_LIST;
  
  const searchTerm = query.toLowerCase();
  
  return TIMEZONE_LIST.filter(tz => 
    tz.label.toLowerCase().includes(searchTerm) ||
    tz.country.toLowerCase().includes(searchTerm) ||
    tz.city.toLowerCase().includes(searchTerm) ||
    tz.region.toLowerCase().includes(searchTerm) ||
    tz.value.toLowerCase().includes(searchTerm)
  );
};

/**
 * Get timezone info by value
 * @param {string} timezoneValue - Timezone value (e.g., 'Africa/Cairo')
 * @returns {object|null} Timezone info object
 */
export const getTimezoneInfo = (timezoneValue) => {
  return TIMEZONE_LIST.find(tz => tz.value === timezoneValue) || null;
};

/**
 * Get user's browser timezone
 * @returns {string} Browser timezone
 */
export const getBrowserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.error('Get browser timezone error:', error);
    return DEFAULT_TIMEZONE;
  }
};

/**
 * Convert class time to user's timezone for display
 * @param {string|Date} classTime - Original class time (in Cairo timezone by default)
 * @param {string} classTimezone - Timezone the class was created in
 * @param {string} userTimezone - User's display timezone
 * @returns {object} Converted time info
 */
export const convertClassTimeForUser = (classTime, classTimezone = DEFAULT_TIMEZONE, userTimezone = DEFAULT_TIMEZONE) => {
  try {
    const originalDate = new Date(classTime);
    
    // If timezones are the same, no conversion needed
    if (classTimezone === userTimezone) {
      return {
        displayTime: formatTimeInTimezone(originalDate, userTimezone),
        convertedDate: originalDate,
        originalTimezone: classTimezone,
        displayTimezone: userTimezone,
        isConverted: false
      };
    }
    
    // Convert time
    const convertedDate = convertTimezone(originalDate, classTimezone, userTimezone);
    
    return {
      displayTime: formatTimeInTimezone(convertedDate, userTimezone),
      convertedDate,
      originalTime: formatTimeInTimezone(originalDate, classTimezone),
      originalTimezone: classTimezone,
      displayTimezone: userTimezone,
      isConverted: true
    };
  } catch (error) {
    console.error('Class time conversion error:', error);
    return {
      displayTime: formatTimeInTimezone(classTime, userTimezone),
      convertedDate: new Date(classTime),
      originalTimezone: classTimezone,
      displayTimezone: userTimezone,
      isConverted: false
    };
  }
};

/**
 * Validate timezone
 * @param {string} timezone - Timezone to validate
 * @returns {boolean} Is valid timezone
 */
export const isValidTimezone = (timezone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Get DST transition dates for a timezone in a given year
 * @param {string} timezone - Timezone to check
 * @param {number} year - Year to check
 * @returns {object} DST transition info
 */
export const getDSTTransitions = (timezone, year = new Date().getFullYear()) => {
  try {
    const transitions = [];
    
    // Check each month for DST transitions
    for (let month = 0; month < 12; month++) {
      const date1 = new Date(year, month, 1);
      const date2 = new Date(year, month, 15);
      const date3 = new Date(year, month + 1, 1);
      
      const offset1 = getTimezoneOffsetMinutes(timezone, date1);
      const offset2 = getTimezoneOffsetMinutes(timezone, date2);
      const offset3 = getTimezoneOffsetMinutes(timezone, date3);
      
      // Check for transition in first half of month
      if (offset1 !== offset2) {
        const transition = findExactTransition(timezone, date1, date2);
        if (transition) {
          transitions.push({
            date: transition,
            type: offset2 > offset1 ? 'spring_forward' : 'fall_back',
            offsetBefore: offset1,
            offsetAfter: offset2,
            timeDifference: Math.abs(offset2 - offset1)
          });
        }
      }
      
      // Check for transition in second half of month
      if (offset2 !== offset3) {
        const transition = findExactTransition(timezone, date2, date3);
        if (transition) {
          transitions.push({
            date: transition,
            type: offset3 > offset2 ? 'spring_forward' : 'fall_back',
            offsetBefore: offset2,
            offsetAfter: offset3,
            timeDifference: Math.abs(offset3 - offset2)
          });
        }
      }
    }
    
    return {
      timezone,
      year,
      transitions,
      hasDST: transitions.length > 0,
      nextTransition: getNextTransition(transitions)
    };
  } catch (error) {
    console.error('Get DST transitions error:', error);
    return { timezone, year, transitions: [], hasDST: false, nextTransition: null };
  }
};

/**
 * Get timezone offset in minutes for a specific date
 * @param {string} timezone - Timezone
 * @param {Date} date - Date to check
 * @returns {number} Offset in minutes
 */
const getTimezoneOffsetMinutes = (timezone, date) => {
  try {
    const utc = new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
    const targetTime = new Date(utc.toLocaleString("en-US", { timeZone: timezone }));
    return Math.round((targetTime.getTime() - utc.getTime()) / 60000);
  } catch (error) {
    return 0;
  }
};

/**
 * Find exact DST transition time between two dates
 * @param {string} timezone - Timezone
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Date|null} Exact transition date
 */
const findExactTransition = (timezone, startDate, endDate) => {
  try {
    let start = new Date(startDate);
    let end = new Date(endDate);
    
    // Binary search for exact transition time
    while (end.getTime() - start.getTime() > 60 * 60 * 1000) { // 1 hour precision
      const mid = new Date((start.getTime() + end.getTime()) / 2);
      const startOffset = getTimezoneOffsetMinutes(timezone, start);
      const midOffset = getTimezoneOffsetMinutes(timezone, mid);
      
      if (startOffset === midOffset) {
        start = mid;
      } else {
        end = mid;
      }
    }
    
    return end;
  } catch (error) {
    return null;
  }
};

/**
 * Get next DST transition from current date
 * @param {Array} transitions - Array of transitions
 * @returns {object|null} Next transition info
 */
const getNextTransition = (transitions) => {
  const now = new Date();
  const upcoming = transitions
    .filter(t => t.date > now)
    .sort((a, b) => a.date - b.date);
  
  return upcoming.length > 0 ? upcoming[0] : null;
};

/**
 * Check if DST transition is approaching (within warning days)
 * @param {string} timezone - Timezone to check
 * @param {number} warningDays - Days before transition to warn
 * @returns {object} Warning info
 */
export const checkDSTWarning = (timezone, warningDays = 7) => {
  try {
    const dstInfo = getDSTTransitions(timezone);
    const nextTransition = dstInfo.nextTransition;
    
    if (!nextTransition) {
      return { hasWarning: false, daysUntil: 0, transition: null };
    }
    
    const now = new Date();
    const daysUntil = Math.ceil((nextTransition.date - now) / (1000 * 60 * 60 * 24));
    
    return {
      hasWarning: daysUntil > 0 && daysUntil <= warningDays,
      daysUntil,
      transition: nextTransition,
      timezone,
      message: getDSTWarningMessage(nextTransition, daysUntil)
    };
  } catch (error) {
    console.error('Check DST warning error:', error);
    return { hasWarning: false, daysUntil: 0, transition: null };
  }
};

/**
 * Get DST warning message
 * @param {object} transition - Transition info
 * @param {number} daysUntil - Days until transition
 * @returns {string} Warning message
 */
const getDSTWarningMessage = (transition, daysUntil) => {
  const action = transition.type === 'spring_forward' ? 'spring forward' : 'fall back';
  const timeChange = transition.type === 'spring_forward' ? 'ahead' : 'back';
  const amount = `${transition.timeDifference / 60} hour${transition.timeDifference / 60 !== 1 ? 's' : ''}`;
  
  if (daysUntil === 0) {
    return `Daylight saving time changes today! Clocks ${action} ${amount} ${timeChange}.`;
  } else if (daysUntil === 1) {
    return `Daylight saving time changes tomorrow! Clocks will ${action} ${amount} ${timeChange}.`;
  } else {
    return `Daylight saving time changes in ${daysUntil} days. Clocks will ${action} ${amount} ${timeChange}.`;
  }
};

/**
 * Adjust class time for DST transition (student timezone is anchor)
 * @param {Date} originalClassTime - Original class time
 * @param {string} studentTimezone - Student's timezone (anchor)
 * @param {string} teacherTimezone - Teacher's timezone
 * @returns {object} Adjusted class time info
 */
export const adjustClassTimeForDST = (originalClassTime, studentTimezone, teacherTimezone) => {
  try {
    // Student timezone is the anchor - class time should remain consistent in student's timezone
    const studentLocalTime = convertTimezone(originalClassTime, 'UTC', studentTimezone);
    
    // Convert back to UTC maintaining student's local time
    const adjustedUTCTime = convertTimezone(studentLocalTime, studentTimezone, 'UTC');
    
    // Calculate how this affects teacher's view
    const teacherOriginalTime = convertTimezone(originalClassTime, 'UTC', teacherTimezone);
    const teacherNewTime = convertTimezone(adjustedUTCTime, 'UTC', teacherTimezone);
    
    return {
      originalUTC: originalClassTime,
      adjustedUTC: adjustedUTCTime,
      studentTime: {
        original: convertTimezone(originalClassTime, 'UTC', studentTimezone),
        adjusted: studentLocalTime, // Should be the same
        changed: false
      },
      teacherTime: {
        original: teacherOriginalTime,
        adjusted: teacherNewTime,
        changed: teacherOriginalTime.getTime() !== teacherNewTime.getTime(),
        timeDifference: (teacherNewTime.getTime() - teacherOriginalTime.getTime()) / (1000 * 60) // minutes
      },
      isAdjustmentNeeded: adjustedUTCTime.getTime() !== originalClassTime.getTime()
    };
  } catch (error) {
    console.error('Adjust class time for DST error:', error);
    return {
      originalUTC: originalClassTime,
      adjustedUTC: originalClassTime,
      studentTime: { original: originalClassTime, adjusted: originalClassTime, changed: false },
      teacherTime: { original: originalClassTime, adjusted: originalClassTime, changed: false, timeDifference: 0 },
      isAdjustmentNeeded: false
    };
  }
};

const timezoneUtils = {
  TIMEZONE_LIST,
  DEFAULT_TIMEZONE,
  convertTimezone,
  formatTimeInTimezone,
  getCurrentTimeInTimezone,
  searchTimezones,
  getTimezoneInfo,
  getBrowserTimezone,
  convertClassTimeForUser,
  isValidTimezone,
  getDSTTransitions,
  checkDSTWarning,
  adjustClassTimeForDST,
  getTimezoneDisplayLabel,
  getDynamicTimezoneList,
  getCurrentOffsetMinutes
};

export default timezoneUtils;