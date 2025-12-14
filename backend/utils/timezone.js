const moment = require('moment-timezone');

/** Convert a local wall time string (or Date/ISO) in tz to a UTC Date */
function toUtc(dateLike, tz = 'UTC') {
  // Accepts '2025-09-05T18:00' or Date/ISO. moment.tz handles DST correctly.
  return moment.tz(dateLike, tz).utc().toDate();
}

/** Build a UTC Date from Y-M-D + HH:mm in tz */
function buildUtcFromParts({ year, month /* 0-11 */, day, hour, minute }, tz = 'UTC') {
  return moment.tz({ year, month, day, hour, minute, second: 0, millisecond: 0 }, tz).utc().toDate();
}

module.exports = { toUtc, buildUtcFromParts };
