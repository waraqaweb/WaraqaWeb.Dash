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
