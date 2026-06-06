/**
 * Copy-ready WhatsApp / message templates for the onboarding funnel.
 * Each builder returns a plain string the admin can copy, send on WhatsApp,
 * or send by email from the registration management modal.
 *
 * Messages are personalized two ways:
 *  - self-enrollment (the guardian is the learner) vs. enrolling a child/children
 *  - a polite honorific (Mr./Ms.) when we can confidently tell the recipient's
 *    gender (from the student's gender when self-enrolled, or a common-name
 *    heuristic); otherwise we stay generic.
 * Pass a `recipient` object built with `buildRecipient(...)`.
 */
import { formatAvailability, CAIRO_TZ } from './evaluationMessage';

const firstNameOf = (value = '') => String(value || '').trim().split(/\s+/)[0] || '';
const lastNameOf = (value = '') => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
};

const fmtClassTime = (value) => {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TZ,
    }).format(new Date(value));
  } catch { return ''; }
};

// Small, high-confidence name lists for a best-effort gender guess. When a name
// is not listed we stay generic rather than risk an incorrect honorific.
const FEMALE_NAMES = new Set([
  'aisha', 'ayesha', 'aysha', 'fatima', 'fatimah', 'fatma', 'maryam', 'mariam', 'maria', 'mary',
  'khadija', 'khadijah', 'zainab', 'zaynab', 'zeinab', 'sumaya', 'sumayya', 'amina', 'aminah', 'amna',
  'asma', 'asmaa', 'hafsa', 'ruqayya', 'sara', 'sarah', 'sana', 'hana', 'hanaa', 'hina', 'noor', 'nour',
  'noura', 'nora', 'layla', 'laila', 'leila', 'salma', 'huda', 'hoda', 'rania', 'dina', 'dana', 'mona',
  'mouna', 'nada', 'nadia', 'yasmin', 'yasmeen', 'jasmine', 'iman', 'eman', 'malak', 'farah', 'hala',
  'lina', 'lana', 'reem', 'rim', 'shaima', 'shaimaa', 'wafa', 'wafaa', 'zahra', 'zahraa', 'amira',
  'ameera', 'samira', 'nabila', 'jamila', 'latifa', 'habiba', 'sundus', 'israa', 'isra', 'alaa', 'doaa',
  'dua', 'duaa', 'bushra', 'manal', 'ghada', 'hanan', 'najwa', 'suad', 'souad', 'widad', 'fadwa',
  'raghad', 'retaj', 'jana', 'joud', 'lara', 'sila', 'elif', 'zeynep', 'ayse', 'emine', 'hatice',
  'merve', 'esra', 'busra', 'sumeyye', 'rabia', 'kubra', 'betul', 'nisa', 'rahaf', 'jouri', 'lujain',
  'eva', 'emma', 'sophia', 'olivia', 'mia', 'lily', 'grace', 'hannah', 'anna', 'laura', 'sofia',
]);
const MALE_NAMES = new Set([
  'muhammad', 'mohammad', 'mohammed', 'mohamed', 'ahmad', 'ahmed', 'ali', 'omar', 'umar', 'usman',
  'uthman', 'othman', 'osman', 'hassan', 'hasan', 'hussein', 'husain', 'hussain', 'bilal', 'hamza',
  'khalid', 'khaled', 'walid', 'waleed', 'tariq', 'tarek', 'tarik', 'yusuf', 'yousef', 'youssef',
  'ibrahim', 'ismail', 'ismael', 'ishaq', 'yaqub', 'yahya', 'idris', 'dawud', 'dawood', 'sulaiman',
  'suleiman', 'salman', 'saad', 'said', 'sami', 'samir', 'karim', 'kareem', 'rashid', 'mahmoud',
  'mahmood', 'mustafa', 'moustafa', 'anas', 'abdullah', 'abdallah', 'abdulrahman', 'abdelrahman',
  'zaid', 'zayd', 'zaki', 'nabil', 'fadi', 'fares', 'faris', 'ziad', 'ziyad', 'marwan', 'majid',
  'naser', 'nasser', 'adam', 'adem', 'mehmet', 'emre', 'burak', 'kerem', 'baran', 'musa', 'harun',
  'ilyas', 'elias', 'isa', 'john', 'james', 'david', 'michael', 'daniel', 'joseph', 'noah', 'ethan',
  'liam', 'lucas', 'henry', 'jack', 'oliver', 'harry', 'george', 'thomas', 'aaron',
]);

const guessGender = (firstName = '') => {
  const n = String(firstName || '').trim().toLowerCase();
  if (!n) return '';
  if (FEMALE_NAMES.has(n)) return 'female';
  if (MALE_NAMES.has(n)) return 'male';
  return '';
};

/**
 * Build a personalization context from a registration row.
 * @param {{ guardianName?: string, students?: Array<{firstName?:string,lastName?:string,gender?:string}> }} input
 */
export const buildRecipient = ({ guardianName = '', students = [] } = {}) => {
  const list = (Array.isArray(students) ? students : []).filter(Boolean);
  const guardianFirst = firstNameOf(guardianName);
  const guardianLast = lastNameOf(guardianName);
  const norm = (s) => String(s || '').trim().toLowerCase();

  const matchesGuardian = (s) => {
    const full = `${s.firstName || ''} ${s.lastName || ''}`.trim();
    if (norm(full) && norm(full) === norm(guardianName)) return true;
    return Boolean(norm(guardianFirst))
      && norm(s.firstName) === norm(guardianFirst)
      && (norm(s.lastName) === norm(guardianLast) || !guardianLast);
  };

  // Only treat as self-enrollment with positive evidence (one student whose
  // name matches the guardian); otherwise assume they enrolled a child.
  const isSelf = list.length === 1 && matchesGuardian(list[0]);

  let gender = '';
  if (isSelf && list[0]?.gender) gender = list[0].gender;
  if (!gender) gender = guessGender(guardianFirst);
  const honorific = gender === 'male' ? 'Mr.' : gender === 'female' ? 'Ms.' : '';

  const studentFirsts = list.map((s) => firstNameOf(s.firstName)).filter(Boolean);
  const childWord = list.length > 1 ? 'children' : 'child';
  const studentLabel = isSelf
    ? 'you'
    : studentFirsts.length === 0 ? `your ${childWord}`
      : studentFirsts.length === 1 ? studentFirsts[0]
        : `${studentFirsts.slice(0, -1).join(', ')} and ${studentFirsts.slice(-1)}`;

  return {
    isSelf,
    gender,
    honorific,
    guardianFirst,
    guardianLast,
    studentLabel,
    studentFirsts,
    plural: studentFirsts.length > 1,
  };
};

// Greeting name: "Mr. Smith" / "Ms. Smith" when we know gender, else first name.
const greetName = (recipient = {}) => {
  if (recipient.honorific) {
    return `${recipient.honorific} ${recipient.guardianLast || recipient.guardianFirst}`.trim();
  }
  return recipient.guardianFirst || 'there';
};

// 1) After the website booking, before the evaluation meeting. Uses the
//    logged-in admin's name so it reads like a personal introduction.
export const introMessage = (adminName = 'Waraqa', recipient = {}) => {
  const hi = greetName(recipient);
  const goals = recipient.isSelf
    ? 'your goals'
    : recipient.plural ? "your children's goals" : "your child's goals";
  const journey = recipient.isSelf ? 'your' : 'their';
  return (
`Assalamu Alaikum ${hi} 😊

This is ${adminName} from Waraqa. I wanted to introduce myself before our upcoming meeting and let you know that I'm available here if you have any questions beforehand.

During our call, we'll talk about ${goals} and help identify the best starting point for ${journey} Quran, Arabic, or Islamic studies journey. You'll leave with clear recommendations and a practical path forward, in sha' Allah.

If there's anything you'd like to share before we meet, feel free to send me a message here.

I look forward to speaking with you soon, in sha' Allah.`
  );
};

// 2) After the evaluation, to the person who attended — recap + next step.
export const postEvaluationMessage = (recipient = {}) => {
  const hi = greetName(recipient);
  const level = recipient.isSelf
    ? 'your level'
    : recipient.plural ? `the level of ${recipient.studentLabel}` : `${recipient.studentLabel}'s level`;
  const nextStep = recipient.isSelf
    ? "The next step is to create your account so we can confirm the class times with the teacher and get started, in sha' Allah."
    : "The next step is to create your account and add your student(s) so we can confirm the class times with the teacher and get started, in sha' Allah.";
  return (
`Assalamu alaikum ${hi} 😊

It was lovely meeting you. Based on today's evaluation we now have a clear picture of ${level} and the best starting point, alhamdulillah.

${nextStep}

If you have any questions, I'm right here to help. JazakumAllahu khayran!`
  );
};

// 3) Availability to share with the TEACHER, converted to Cairo time and
//    showing only the times (no personal details).
export const teacherAvailabilityMessage = ({ studentName = '', slots = [], timezone = CAIRO_TZ, expectedStartDate = '' } = {}) => {
  const who = firstNameOf(studentName) || 'the student';
  const cairo = formatAvailability({ slots, timezone: timezone || CAIRO_TZ, convertToCairo: true, expectedStartDate });
  if (!cairo) return '';
  return (
`Assalamu alaikum,

Here are the available times for ${who} (Cairo time):

${cairo}

Please let me know which slots work for you so we can confirm with the family. JazakumAllahu khayran.`
  );
};

// 4) First-class reminder for the WhatsApp group on the day of the first class.
export const firstClassReminderMessage = ({ recipient = {}, classAt = null } = {}) => {
  const whose = recipient.isSelf ? 'your' : `${recipient.studentLabel || 'your child'}'s`;
  const subject = recipient.isSelf ? 'you are' : `${recipient.studentLabel || 'your child'} is`;
  const when = fmtClassTime(classAt);
  const timePart = when ? `today (${when} Cairo time)` : 'today';
  return (
`Assalamu alaikum 🌟

Just a friendly reminder that ${whose} first class with us is ${timePart}. Please make sure ${subject} ready a few minutes early with a stable internet connection.

May Allah make it a blessed and productive start! If you need anything, we're right here to help.`
  );
};

// 5) Ask the guardian to rate the first class and the teacher out of 10.
export const firstClassFeedbackMessage = (recipient = {}) => {
  const hi = greetName(recipient);
  const whose = recipient.isSelf ? 'your first class' : `${recipient.studentLabel || 'your child'}'s first class`;
  return (
`Assalamu alaikum ${hi} 😊

We'd love to hear how ${whose} went! On a scale of 1 to 10 (10 = excellent), how would you rate:

1) The first class overall?
2) The teacher's performance?

Your honest feedback helps us make sure everything is perfect, in sha' Allah. JazakumAllahu khayran!`
  );
};
