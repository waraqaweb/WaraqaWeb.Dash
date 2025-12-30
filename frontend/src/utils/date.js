// Shared date formatting utility for dashboard
// Format: DD MMM YYYY, default in UTC

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function formatDateDDMMMYYYY(value, { utc = true } = {}) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const day = String(utc ? d.getUTCDate() : d.getDate()).padStart(2, '0');
  const mon = MONTHS_SHORT[utc ? d.getUTCMonth() : d.getMonth()];
  const yr = utc ? d.getUTCFullYear() : d.getFullYear();
  return `${day} ${mon} ${yr}`;
}

export function formatDateRangeDDMMMYYYY(from, to, opts) {
  const start = formatDateDDMMMYYYY(from, opts);
  const end = formatDateDDMMMYYYY(to, opts);
  if (start === '—' && end === '—') return '—';
  return `${start} → ${end}`;
}

// Format: 11 Jan 2025 06:00 PM
// Uses an explicit IANA timezone when provided.
export function formatDateTimeDDMMMYYYYhhmmA(value, { timeZone } = {}) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
    const parts = formatter.formatToParts(d);
    const get = (type) => parts.find(p => p.type === type)?.value;

    const day = get('day');
    const month = get('month');
    const year = get('year');
    const hour = get('hour');
    const minute = get('minute');
    const dayPeriod = (get('dayPeriod') || '').toUpperCase();

    if (!day || !month || !year || !hour || !minute) {
      // Fallback, but keep roughly the same shape.
      const fallback = formatter.format(d).replace(',', '');
      return fallback;
    }

    return `${day} ${month} ${year} ${hour}:${minute} ${dayPeriod}`.trim();
  } catch (err) {
    // If timeZone is invalid or Intl throws, fallback to local time.
    const day = String(d.getDate()).padStart(2, '0');
    const month = MONTHS_SHORT[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hh = String(hours).padStart(2, '0');
    return `${day} ${month} ${year} ${hh}:${minutes} ${ampm}`;
  }
}
