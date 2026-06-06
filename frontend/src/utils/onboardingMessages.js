/**
 * Copy-ready WhatsApp / message templates for the onboarding funnel.
 * Each builder returns a plain string the admin can copy, send on WhatsApp,
 * or send by email from the registration management modal.
 */
import { formatAvailability, CAIRO_TZ } from './evaluationMessage';

const firstNameOf = (value = '') => String(value || '').trim().split(/\s+/)[0] || '';

const fmtClassTime = (value) => {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TZ,
    }).format(new Date(value));
  } catch { return ''; }
};

// 1) After the website booking, before the evaluation meeting. Uses the
//    logged-in admin's name so it reads like a personal introduction.
export const introMessage = (adminName = 'Waraqa') => (
`Assalamu Alaikum 😊

This is ${adminName} from Waraqa. I wanted to introduce myself before our upcoming meeting and let you know that I'm available here if you have any questions beforehand.

During our call, we'll talk about your goals and help you identify the best starting point for your Quran, Arabic, or Islamic studies journey. You'll leave with clear recommendations and a practical path forward, in sha' Allah.

If there's anything you'd like to share before we meet, feel free to send me a message here.

I look forward to speaking with you soon, in sha' Allah.`
);

// 2) After the evaluation, to the person who attended — recap + next step.
export const postEvaluationMessage = (name = '') => {
  const who = firstNameOf(name) || 'there';
  return (
`Assalamu alaikum ${who} 😊

It was lovely meeting you. Based on today's evaluation we now have a clear picture of the level and the best starting point, alhamdulillah.

The next step is to create your account and add your student(s) so we can confirm the class times with the teacher and get started, in sha' Allah.

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
export const firstClassReminderMessage = ({ studentName = '', classAt = null } = {}) => {
  const who = firstNameOf(studentName) || 'your child';
  const when = fmtClassTime(classAt);
  const timePart = when ? `today (${when} Cairo time)` : 'today';
  return (
`Assalamu alaikum 🌟

Just a friendly reminder that ${who}'s first class with us is ${timePart}. Please make sure ${who} is ready a few minutes early with a stable internet connection.

May Allah make it a blessed and productive start! If you need anything, we're right here to help.`
  );
};

// 5) Ask the guardian to rate the first class and the teacher out of 10.
export const firstClassFeedbackMessage = (name = '') => {
  const who = firstNameOf(name) || 'there';
  return (
`Assalamu alaikum ${who} 😊

We'd love to hear how the first class went! On a scale of 1 to 10 (10 = excellent), how would you rate:

1) The first class overall?
2) The teacher's performance?

Your honest feedback helps us make sure everything is perfect, in sha' Allah. JazakumAllahu khayran!`
  );
};
