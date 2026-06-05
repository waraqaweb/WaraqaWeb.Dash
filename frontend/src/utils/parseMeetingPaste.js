/**
 * parseMeetingPaste
 *
 * Parses the human-readable meeting-summary text that admins paste into the
 * "Create from paste" dialog. The format mirrors the public booking
 * confirmation page (labels on their own line, value on the following line,
 * with a few section headers and multi-line notes blocks).
 *
 * The parser is intentionally tolerant: labels may appear in any order, blank
 * lines are allowed, and unknown lines are ignored. Returns a plain object that
 * the modal can render and submit to /api/meetings/admin-create.
 */

const KNOWN_LABELS = [
  'Full name',
  'Guardian first name',
  'Guardian last name',
  'Email',
  'WhatsApp',
  'Phone',
  'Student timezone',
  'Schedule timezone (ours)',
  'Schedule timezone',
  'Teacher preference',
  'Session',
  'Meeting type',
  'Course (legacy field)',
  'Preferred days (legacy)',
  'Preferred time (legacy)',
  'Starts (student timezone)',
  'Ends (student timezone)',
  'Starts (your timezone)',
  'Ends (your timezone)',
  'Calendar preference',
  'Status',
  'Attendance',
  'Booked on',
  'Notes & messages',
  'Additional notes (booker)',
  'Message (legacy form)',
  'Add to Google Calendar',
  'Email guardian',
  'Open WhatsApp',
  'Students',
  'Student notes',
  'Attribution',
  'Lead source',
  'Referrer',
  'Landing page',
  'Funnel & follow-up',
  'Enrollment status',
  'Record last updated',
  'Meeting link',
];

const LABEL_SET = new Set(KNOWN_LABELS);

const MEETING_TYPE_MAP = {
  evaluation: 'new_student_evaluation',
  'new student evaluation': 'new_student_evaluation',
  follow_up: 'current_student_follow_up',
  'follow up': 'current_student_follow_up',
  'current student follow up': 'current_student_follow_up',
  teacher_sync: 'teacher_sync',
  'teacher sync': 'teacher_sync',
};

const normaliseMeetingType = (raw) => {
  if (!raw) return 'new_student_evaluation';
  const key = String(raw).trim().toLowerCase();
  return MEETING_TYPE_MAP[key] || (key.includes('evaluation') ? 'new_student_evaluation' : key);
};

const findLineIndex = (lines, label) => {
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() === label) return i;
  }
  return -1;
};

const findValue = (lines, label) => {
  const idx = findLineIndex(lines, label);
  if (idx === -1) return '';
  for (let i = idx + 1; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (LABEL_SET.has(trimmed)) return '';
    return trimmed;
  }
  return '';
};

const findBlock = (lines, label, endLabels) => {
  const idx = findLineIndex(lines, label);
  if (idx === -1) return '';
  const stopAt = new Set(endLabels);
  const chunk = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (stopAt.has(trimmed)) break;
    if (LABEL_SET.has(trimmed) && trimmed !== label) break;
    chunk.push(lines[i]);
  }
  return chunk.join('\n').trim();
};

const parseDateLike = (raw) => {
  if (!raw) return null;
  const cleaned = raw
    .replace(/\u00a0/g, ' ')
    .replace(/[,\s]+/g, ' ')
    .trim();
  if (!cleaned) return null;

  // Try native Date first (handles "06 Jun 2026 20:00" etc).
  const tryStrings = [
    cleaned,
    cleaned.replace(/(\d{1,2})(?:st|nd|rd|th)\b/i, '$1'),
  ];
  for (const candidate of tryStrings) {
    const d = new Date(candidate);
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Manual fallback: DD MMM YYYY HH:mm
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  const m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = months[m[2].toLowerCase().slice(0, 4)] ?? months[m[2].toLowerCase().slice(0, 3)];
    const year = parseInt(m[3], 10);
    const hour = m[4] ? parseInt(m[4], 10) : 0;
    const minute = m[5] ? parseInt(m[5], 10) : 0;
    if (Number.isFinite(month)) {
      return new Date(Date.UTC(year, month, day, hour, minute));
    }
  }
  return null;
};

// Interpret a "wall-clock" date string (e.g. "06 Jun 2026, 20:00") as if it was
// captured in the given IANA timezone, returning the equivalent UTC instant.
// We parse the components manually so the browser's local zone never leaks in.
const parseWallClockInZone = (raw, timezone) => {
  if (!raw) return null;
  const cleaned = raw.replace(/\u00a0/g, ' ').trim();
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  const m = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})[,\s]+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = months[m[2].toLowerCase().slice(0, 4)] ?? months[m[2].toLowerCase().slice(0, 3)];
  const year = parseInt(m[3], 10);
  const hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  if (!Number.isFinite(month)) return null;

  if (!timezone) {
    return new Date(year, month, day, hour, minute);
  }

  // Convert wall-clock -> UTC by computing the timezone offset at a candidate
  // UTC instant via Intl.DateTimeFormat and correcting once.
  const guess = Date.UTC(year, month, day, hour, minute);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date(guess));
    const map = {};
    parts.forEach((p) => { map[p.type] = p.value; });
    const zoneUtcGuess = Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      parseInt(map.hour === '24' ? '0' : map.hour, 10),
      parseInt(map.minute, 10),
      parseInt(map.second, 10),
    );
    const offset = zoneUtcGuess - guess; // diff between what the zone shows and our guess
    return new Date(guess - offset);
  } catch {
    return new Date(guess);
  }
};

const splitName = (full) => {
  const value = String(full || '').trim();
  if (!value) return { firstName: '', lastName: '' };
  const parts = value.split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' '),
  };
};

const parseStudents = (lines) => {
  const startIdx = findLineIndex(lines, 'Students');
  if (startIdx === -1) return [];
  const endLabels = new Set(['Attribution', 'Funnel & follow-up', 'Meeting link']);

  const block = [];
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (endLabels.has(trimmed)) break;
    block.push(lines[i]);
  }

  const students = [];
  let current = null;
  const finishCurrent = () => {
    if (current && current.studentName) students.push(current);
    current = null;
  };

  for (let i = 0; i < block.length; i += 1) {
    const raw = block[i];
    const line = raw.trim();
    if (!line) continue;

    // Section markers inside the students block.
    if (line === 'Student notes') {
      // Capture the next non-empty line(s) until the next blank+non-note pattern.
      let j = i + 1;
      const noteLines = [];
      while (j < block.length) {
        const nextTrim = block[j].trim();
        if (!nextTrim) { j += 1; continue; }
        // Stop if we hit a likely "next student name" pattern: a line followed
        // by "Age:" two lines down.
        if (looksLikeStudentName(block, j)) break;
        noteLines.push(block[j]);
        j += 1;
      }
      if (current) current.notes = noteLines.join('\n').trim();
      i = j - 1;
      continue;
    }

    if (line.toLowerCase().startsWith('age:')) {
      if (current) {
        const ageMatch = line.match(/age\s*:\s*(\d+)/i);
        const genderMatch = line.match(/gender\s*:\s*([^·\n]+)/i);
        if (ageMatch) current.age = parseInt(ageMatch[1], 10);
        if (genderMatch) current.gender = genderMatch[1].trim().toLowerCase();
      }
      continue;
    }

    // Curriculum line: usually contains "—" (em-dash) or "·" separators.
    if ((line.includes('—') || line.includes('·') || line.includes('-')) && current) {
      current.courses = current.courses || [];
      current.courses.push(line);
      continue;
    }

    // Otherwise treat this as a new student name (only if it doesn't look like
    // a stray description).
    if (looksLikeStudentName(block, i)) {
      finishCurrent();
      const { firstName, lastName } = splitName(line);
      current = {
        studentName: line,
        firstName,
        lastName,
        age: undefined,
        gender: '',
        courses: [],
        notes: '',
      };
    } else if (current) {
      // Append to the most recent student as a description line.
      current.courses = current.courses || [];
      current.courses.push(line);
    }
  }
  finishCurrent();
  return students;
};

const looksLikeStudentName = (block, idx) => {
  for (let k = idx + 1; k < block.length; k += 1) {
    const t = block[k].trim();
    if (!t) continue;
    return t.toLowerCase().startsWith('age:');
  }
  return false;
};

export function parseMeetingPaste(text) {
  if (!text || typeof text !== 'string') {
    return { ok: false, error: 'Paste a meeting summary to parse.' };
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const guardianFullName = findValue(lines, 'Full name');
  const guardianFirstName = findValue(lines, 'Guardian first name');
  const guardianLastName = findValue(lines, 'Guardian last name');
  const email = findValue(lines, 'Email');
  const whatsapp = findValue(lines, 'WhatsApp') || findValue(lines, 'Phone');
  const studentTimezone = findValue(lines, 'Student timezone');
  const scheduleTimezone = findValue(lines, 'Schedule timezone (ours)') || findValue(lines, 'Schedule timezone');
  const teacherPreference = findValue(lines, 'Teacher preference');
  const meetingTypeRaw = findValue(lines, 'Meeting type') || 'evaluation';
  const calendarPreference = findValue(lines, 'Calendar preference');
  const status = findValue(lines, 'Status');
  const attendance = findValue(lines, 'Attendance');
  const meetingLink = findValue(lines, 'Meeting link');

  const startsYour = findValue(lines, 'Starts (your timezone)');
  const endsYour = findValue(lines, 'Ends (your timezone)');
  const startsStudent = findValue(lines, 'Starts (student timezone)');
  const endsStudent = findValue(lines, 'Ends (student timezone)');

  const notesBooker = findBlock(lines, 'Additional notes (booker)', [
    'Message (legacy form)',
    'Add to Google Calendar',
    'Email guardian',
    'Open WhatsApp',
    'Students',
    'Attribution',
  ]);
  const messageLegacy = findBlock(lines, 'Message (legacy form)', [
    'Add to Google Calendar',
    'Email guardian',
    'Open WhatsApp',
    'Students',
    'Attribution',
  ]);

  // Prefer "your timezone" (admin) when available, falling back to student.
  const scheduleZone = scheduleTimezone || 'Africa/Cairo';
  const startUtc =
    parseWallClockInZone(startsYour, scheduleZone) ||
    parseWallClockInZone(startsStudent, studentTimezone) ||
    parseDateLike(startsYour) ||
    parseDateLike(startsStudent);
  const endUtc =
    parseWallClockInZone(endsYour, scheduleZone) ||
    parseWallClockInZone(endsStudent, studentTimezone) ||
    parseDateLike(endsYour) ||
    parseDateLike(endsStudent);

  const guardianName = [
    guardianFirstName,
    guardianLastName,
  ].filter(Boolean).join(' ').trim() || guardianFullName || '';

  const result = {
    meetingType: normaliseMeetingType(meetingTypeRaw),
    timezone: scheduleZone,
    studentTimezone: studentTimezone || '',
    guardian: {
      guardianName,
      guardianFirstName,
      guardianLastName,
      guardianEmail: email,
      guardianPhone: whatsapp,
    },
    teacherPreference,
    calendarPreference: calendarPreference || undefined,
    status: status || 'scheduled',
    attendance: attendance || 'pending',
    startTime: startUtc ? startUtc.toISOString() : '',
    endTime: endUtc ? endUtc.toISOString() : '',
    startTimeDisplay: startsYour || startsStudent || '',
    endTimeDisplay: endsYour || endsStudent || '',
    notes: notesBooker || messageLegacy || '',
    meetingLink,
    students: parseStudents(lines),
  };

  if (!result.startTime) {
    return { ok: false, error: 'Could not detect the meeting start time. Make sure "Starts (your timezone)" or "Starts (student timezone)" is included.', value: result };
  }
  return { ok: true, value: result };
}

export default parseMeetingPaste;
