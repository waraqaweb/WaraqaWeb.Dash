// Shared subject standardization.
// Teachers may enter subjects freely, but everywhere the platform DISPLAYS a
// teacher's subjects we normalize them into this canonical taxonomy so the
// presentation is consistent across the app.
//
// IMPORTANT: keep this list in sync with frontend/src/utils/subjectStandardization.js

const STANDARD_SUBJECTS = [
  'Quran (Memorization)',
  'Quran (Recitation/Tajweed)',
  'Arabic Language',
  'Islamic Studies',
  'Reading Basics',
];

// Ordered rules — the first matching rule wins. Order matters:
// recitation/tajweed and memorization are checked before the bare "quran"
// fallback, and "reading" is checked before "arabic" so that
// e.g. "arabic reading" resolves to Reading Basics.
const RULES = [
  { subject: 'Quran (Recitation/Tajweed)', re: /(tajwe?ed|tajwid|recit|tilaw|qira'?a|qiraah|nazra|nazrah|warsh|hafs|قراء|تجويد|تلاوة)/i },
  { subject: 'Quran (Memorization)', re: /(hifz|hifdh|hefz|memor|tahfe?ez|tahfiz|حفظ|تحفيظ)/i },
  { subject: 'Islamic Studies', re: /(islamic|islam\b|fiqh|aqee?dah|aqidah|se?erah|si?rah|hadith|hadee?th|tafse?er|tafsir|tawheed|tawhid|deen|إسلام|فقه|عقيدة|حديث|تفسير)/i },
  { subject: 'Reading Basics', re: /(noorani|noor al|qa'?ida|qa'?idah|iqra|iqro|iqraa|basic|beginner|foundation|alphabet|letters|reading|phonics|نور|قاعدة|اقرأ)/i },
  { subject: 'Arabic Language', re: /(arabic|arab\b|nahw|sarf|grammar|lugha|conversation|عرب|عربية|نحو|لغة)/i },
  { subject: 'Quran (Memorization)', re: /(qur'?an|quraan|coran|kareem|قرآن|قران)/i },
];

/**
 * Map a single free-text subject to its standardized display value.
 * Returns the canonical name, or the trimmed original when nothing matches.
 * @param {string} raw
 * @returns {string|null}
 */
function standardizeSubject(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  for (const rule of RULES) {
    if (rule.re.test(value)) return rule.subject;
  }
  return value; // preserve unknown subjects rather than dropping them
}

/**
 * Map a list of free-text subjects to a de-duplicated list of standardized
 * display values (order preserved by first appearance).
 * @param {Array<string>|string} rawSubjects
 * @returns {string[]}
 */
function standardizeSubjects(rawSubjects) {
  const list = Array.isArray(rawSubjects)
    ? rawSubjects
    : (typeof rawSubjects === 'string' ? rawSubjects.split(',') : []);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const std = standardizeSubject(item);
    if (std && !seen.has(std)) {
      seen.add(std);
      out.push(std);
    }
  }
  return out;
}

module.exports = { STANDARD_SUBJECTS, standardizeSubject, standardizeSubjects };
