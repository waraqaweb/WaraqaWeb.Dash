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

  const parts = normalized.split('/').filter(Boolean);
  const candidate = parts.length ? parts[parts.length - 1] : normalized;
  return cleanText(candidate.replace(/_/g, ' ')) || fallback || normalized;
};

export const getTimezoneHeadingLabel = (timezone, fallback = 'Class') => {
  const location = getTimezoneLocationLabel(timezone, fallback);
  return `${location} timezone`;
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
  return `teacher (${name})`;
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