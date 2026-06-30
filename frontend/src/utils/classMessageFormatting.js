import { TIMEZONE_LIST } from './timezoneUtils';

const HONORIFIC_MAP = {
  mr: 'Mr',
  mister: 'Mr',
  mrs: 'Mrs',
  missus: 'Mrs',
  ms: 'Ms',
  miss: 'Ms',
  brother: 'brother',
  bro: 'brother',
  sister: 'sister',
  sis: 'sister',
};

const cleanText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const resolveRaw = (value) => value?.raw || value || {};

// Region prefixes that mark a string as a plausible IANA timezone (e.g. "America/New_York").
// Anything else (like a stray person name) is treated as "not a timezone".
const IANA_REGION_PREFIXES = new Set([
  'Africa', 'America', 'Antarctica', 'Arctic', 'Asia', 'Atlantic',
  'Australia', 'Europe', 'Indian', 'Pacific', 'Etc',
]);

export const formatMessageEpithet = (epithet) => {
  const normalized = cleanText(epithet).toLowerCase();
  if (!normalized || normalized === 'none') return '';
  return HONORIFIC_MAP[normalized] || cleanText(epithet);
};

export const getMessageFirstName = (value, fallback = '') => {
  const normalized = cleanText(value);
  if (!normalized) return fallback;
  return normalized.split(' ')[0] || fallback;
};

export const getTimezoneLocationLabel = (timezone, fallback = '') => {
  const normalized = cleanText(timezone);
  if (!normalized) return fallback;

  // Prefer a curated, human-friendly city from the shared timezone list.
  const known = TIMEZONE_LIST.find((tz) => tz.value === normalized);
  if (known?.city) return known.city;

  // Otherwise derive the city from a valid IANA identifier (e.g. "America/New_York").
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length >= 2 && IANA_REGION_PREFIXES.has(parts[0])) {
    const candidate = parts[parts.length - 1].replace(/_/g, ' ');
    return cleanText(candidate) || fallback || normalized;
  }

  // Not a recognizable timezone (e.g. a stray name) — fall back gracefully.
  return fallback;
};

export const getTimezoneHeadingLabel = (timezone, fallback = 'Class') => {
  const location = getTimezoneLocationLabel(timezone, fallback);
  return `${location} Timezone`;
};

export const getTeacherMessageName = (teacher, fallback = 'teacher') => {
  const raw = resolveRaw(teacher);
  return getMessageFirstName(
    raw.preferredName
      || raw.nickName
      || raw.firstName
      || raw.label
      || raw.name
      || raw.displayName
      || raw.fullName,
    fallback
  );
};

export const getTeacherMessageLabel = (teacher, fallback = 'teacher') => {
  const name = getTeacherMessageName(teacher, '');
  if (!name) return fallback;
  return `teacher ${name}`;
};

export const getStudentMessageName = ({ student, studentOption, fallback = 'Student' } = {}) => {
  const raw = resolveRaw(studentOption);
  const epithet = formatMessageEpithet(
    raw.epithet
      || raw.studentEpithet
      || student?.epithet
      || student?.studentEpithet
      || ''
  );
  const firstName = getMessageFirstName(
    raw.firstName
      || raw.studentName
      || raw.fullName
      || raw.label
      || student?.studentName
      || student?.name,
    fallback
  );

  return cleanText(`${epithet ? `${epithet} ` : ''}${firstName}`) || fallback;
};