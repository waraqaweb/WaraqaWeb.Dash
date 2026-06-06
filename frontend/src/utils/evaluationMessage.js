/**
 * Helpers that turn an evaluation student's results + availability into
 * well-phrased, copy-ready messages.
 *
 *  • buildTeacherSummaryMessage — the full hand-off an admin copies and sends
 *    to a teacher so they know the level, the mistakes and where to start.
 *  • formatAvailability — converts the structured weekly slots into prose,
 *    optionally converting every slot into Africa/Cairo time.
 */
import moment from 'moment-timezone';
import { SURAHS } from '../data/surahs';

export const CAIRO_TZ = 'Africa/Cairo';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n) => String(n).padStart(2, '0');

// Resolve a surah id (number or numeric string) to its English name.
export const surahNameFor = (id) => {
  const s = SURAHS.find((x) => String(x.id) === String(id));
  return s ? s.en : `Surah ${id}`;
};

/**
 * Turn a date into a natural, conversational phrase relative to today:
 *   today · yesterday · on Tuesday · last Tuesday · last week.
 * Used so messages read like a human wrote them instead of a timestamp.
 */
export const naturalDate = (date) => {
  const d = moment(date);
  if (!date || !d.isValid()) return 'today';
  const days = moment().startOf('day').diff(d.clone().startOf('day'), 'days');
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `on ${d.format('dddd')}`;
  if (days < 14) return `last ${d.format('dddd')}`;
  if (days < 28) return 'last week';
  return `on ${d.format('MMMM D')}`;
};

// Add minutes to an "HH:mm" string, returning "HH:mm" (wraps within a day).
export const addMinutesToTime = (time, minutes) => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return '';
  const total = (h * 60 + m + (minutes || 0)) % (24 * 60);
  const norm = (total + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(norm / 60))}:${pad(norm % 60)}`;
};

const to12h = (time) => {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const period = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad(m)} ${period}`;
};

/**
 * Convert one weekly slot (day-of-week + HH:mm in `fromTz`) into the target
 * timezone, returning the (possibly shifted) day index + 12h times.
 */
const convertSlot = (slot, fromTz, toTz, refDate) => {
  const day = Number(slot.day);
  const start = slot.start || '';
  const end = slot.end || addMinutesToTime(start, slot.durationMinutes || 30);
  if (!fromTz || !toTz || fromTz === toTz) {
    return { day, start: to12h(start), end: to12h(end) };
  }
  try {
    const base = refDate ? moment.tz(refDate, fromTz) : moment.tz(fromTz);
    const [sh, sm] = start.split(':').map(Number);
    const ms = base.clone().day(day).hour(sh).minute(sm).second(0);
    const startC = ms.clone().tz(toTz);
    let endC = null;
    if (end) {
      const [eh, em] = end.split(':').map(Number);
      const me = base.clone().day(day).hour(eh).minute(em).second(0);
      endC = me.clone().tz(toTz);
    }
    return {
      day: startC.day(),
      start: startC.format('h:mm A'),
      end: endC ? endC.format('h:mm A') : '',
    };
  } catch {
    return { day, start: to12h(start), end: to12h(end) };
  }
};

/**
 * Produce a readable availability description.
 * @returns {string}
 */
export const formatAvailability = ({
  slots = [],
  timezone = CAIRO_TZ,
  convertToCairo = false,
  expectedStartDate = '',
} = {}) => {
  const targetTz = convertToCairo ? CAIRO_TZ : timezone;
  const valid = (slots || []).filter((s) => s && s.start != null && s.day != null && s.day !== '');
  if (!valid.length) return '';

  const converted = valid.map((s) => convertSlot(s, timezone, targetTz)).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));

  // Are all slots the same time window? If so, collapse to one line listing days.
  const sameWindow = converted.every((c) => c.start === converted[0].start && c.end === converted[0].end);
  const tzLabel = convertToCairo ? 'Cairo time' : (timezone || CAIRO_TZ);

  const lines = [];
  if (sameWindow && converted.length > 1) {
    const days = converted.map((c) => DAY_NAMES[c.day]).join(', ');
    lines.push(`Available on ${days} from ${converted[0].start}${converted[0].end ? ` to ${converted[0].end}` : ''} (${tzLabel}).`);
  } else {
    lines.push(`Available times (${tzLabel}):`);
    converted.forEach((c) => {
      lines.push(`• ${DAY_NAMES[c.day]}: ${c.start}${c.end ? ` – ${c.end}` : ''}`);
    });
  }
  if (expectedStartDate) lines.push(`Expected start date: ${expectedStartDate}`);
  return lines.join('\n');
};

/**
 * Build the teacher hand-off message: level, mistakes and where to start.
 *
 * @param {object} args
 * @param {object} args.student      evaluation student subdocument
 * @param {Array}  args.majorMistakes grouped major mistakes (with optional surah/verses/words)
 * @param {Array}  args.minorMistakes grouped minor mistakes
 * @param {Array}  args.journey      starting-point recommendation rows
 * @param {Array}  args.memorization humanized memorization rows ({ name, status, note })
 * @param {string} args.sessionDate  ISO date the evaluation happened (for natural phrasing)
 */
export const buildTeacherSummaryMessage = ({
  student = {},
  majorMistakes = [],
  minorMistakes = [],
  journey = [],
  memorization = [],
  sessionDate = '',
} = {}) => {
  const lines = [];
  const name = student.name || 'the student';
  lines.push(`Assalāmu ʿalaykum,`);
  lines.push('');
  lines.push(`We evaluated ${name}${student.age ? ` (age ${student.age})` : ''} ${naturalDate(sessionDate)}. Here is a quick summary so you know exactly where to start.`);

  const subjects = Array.isArray(student.desiredSubjects) ? student.desiredSubjects.filter(Boolean) : [];
  if (subjects.length) lines.push('', `Subjects: ${subjects.join(', ')}`);

  const reco = Array.isArray(student.recommendedLevels) && student.recommendedLevels.length
    ? student.recommendedLevels
    : (student.recommendedLevel ? [student.recommendedLevel] : []);
  if (reco.length) lines.push(`Recommended level: ${reco.join(', ')}`);

  if (journey.length) {
    lines.push('', 'Suggested starting point:');
    journey.forEach((j) => {
      lines.push(`• ${j.label || j.section}: start at ${j.nextPoint}${j.deepest ? ` (reached ${j.deepest})` : ''}`);
    });
  }

  const renderMistakes = (title, list) => {
    if (!list.length) return;
    lines.push('', `${title}:`);
    list.forEach((m) => {
      if (Array.isArray(m.verses) && m.verses.length) {
        lines.push(`• ${m.surah}:`);
        m.verses.forEach((v) => lines.push(`    – Ayah ${v.verse}: ${v.words.join('، ')}`));
      } else if (Array.isArray(m.words)) {
        lines.push(`• ${m.surah}: ${m.words.join('، ')}`);
      } else {
        lines.push(`• ${m.section} — ${m.prompt}${m.detail ? ` (${m.detail})` : ''}`);
      }
    });
  };
  renderMistakes('Clear mistakes to focus on first', majorMistakes);
  renderMistakes('Minor slips to polish', minorMistakes);

  if (Array.isArray(memorization) && memorization.length) {
    lines.push('', 'Qur’an memorization:');
    memorization.forEach((s) => {
      const status = s.status === 'memorized' ? 'memorized well'
        : s.status === 'partial' ? 'partially memorized'
        : s.status || 'reviewed';
      const note = s.note && s.note.trim() ? ` — needs review on: ${s.note.trim()}` : '';
      lines.push(`• ${s.name}: ${status}${note}`);
    });
  }

  if (student.contactNote && student.contactNote.trim()) lines.push('', `Quick note: ${student.contactNote.trim()}`);
  if (student.generalNotes && student.generalNotes.trim()) lines.push('', `General notes: ${student.generalNotes.trim()}`);
  if (student.adminSummary && student.adminSummary.trim()) lines.push('', `Evaluator summary: ${student.adminSummary.trim()}`);

  const studentTz = student.availabilityTimezone || CAIRO_TZ;
  const slots = student.availabilitySlots || [];
  const localText = formatAvailability({
    slots,
    timezone: studentTz,
    convertToCairo: false,
    expectedStartDate: student.expectedStartDate || '',
  });
  if (localText) {
    lines.push('', localText);
    // When the student is not already on Cairo time, also show the Cairo
    // equivalent so the (Cairo-based) teacher can read it at a glance.
    if (studentTz !== CAIRO_TZ) {
      const cairoText = formatAvailability({ slots, timezone: studentTz, convertToCairo: true });
      if (cairoText) lines.push('', cairoText);
    }
  } else if (student.availability && student.availability.trim()) {
    lines.push('', `Availability: ${student.availability.trim()}`);
  }

  lines.push('', 'JazākumAllāhu khayran.');
  return lines.join('\n');
};
