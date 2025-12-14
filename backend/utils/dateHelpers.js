/**
 * Date Helper Utilities
 * 
 * Shared date formatting functions for backend services
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format date as DD MMM YYYY (e.g., "15 Jan 2025")
 * @param {Date|string} value - Date to format
 * @param {Object} options - Formatting options
 * @returns {string} Formatted date string
 */
function formatDateDDMMMYYYY(value, options = {}) {
  const { utc = true } = options;
  
  if (!value) return '—';
  
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '—';
  
  const day = String(utc ? d.getUTCDate() : d.getDate()).padStart(2, '0');
  const mon = MONTHS_SHORT[utc ? d.getUTCMonth() : d.getMonth()];
  const yr = utc ? d.getUTCFullYear() : d.getFullYear();
  
  return `${day} ${mon} ${yr}`;
}

/**
 * Format date range as "DD MMM YYYY → DD MMM YYYY"
 * @param {Date|string} from - Start date
 * @param {Date|string} to - End date
 * @param {Object} options - Formatting options
 * @returns {string} Formatted date range
 */
function formatDateRangeDDMMMYYYY(from, to, options) {
  const start = formatDateDDMMMYYYY(from, options);
  const end = formatDateDDMMMYYYY(to, options);
  
  if (start === '—' && end === '—') return '—';
  
  return `${start} → ${end}`;
}

/**
 * Get first and last day of month
 * @param {number} year - Year
 * @param {number} month - Month (0-11)
 * @returns {Object} Object with firstDay and lastDay dates
 */
function getMonthBounds(year, month) {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  
  return { firstDay, lastDay };
}

/**
 * Parse YYYY-MM string to month bounds
 * @param {string} monthString - Month in YYYY-MM format
 * @returns {Object} Object with firstDay and lastDay dates
 */
function parseMonthString(monthString) {
  const [year, month] = monthString.split('-').map(Number);
  return getMonthBounds(year, month - 1);
}

module.exports = {
  formatDateDDMMMYYYY,
  formatDateRangeDDMMMYYYY,
  getMonthBounds,
  parseMonthString
};
