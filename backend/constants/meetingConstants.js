/**
 * Meeting constants used across services, models, and routes.
 */

const MEETING_TYPES = Object.freeze({
  NEW_STUDENT_EVALUATION: 'new_student_evaluation',
  CURRENT_STUDENT_FOLLOW_UP: 'current_student_follow_up',
  TEACHER_SYNC: 'teacher_sync'
});

const MEETING_STATUSES = Object.freeze({
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show'
});

const MEETING_SOURCES = Object.freeze({
  PUBLIC: 'public',
  GUARDIAN: 'guardian_portal',
  TEACHER: 'teacher_portal',
  ADMIN: 'admin'
});

const MEETING_DEFAULT_DURATIONS = Object.freeze({
  [MEETING_TYPES.NEW_STUDENT_EVALUATION]: 30,
  [MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]: 30,
  [MEETING_TYPES.TEACHER_SYNC]: 30
});

const MEETING_COLORS = Object.freeze({
  background: '#FEF9C3',
  border: '#FACC15',
  text: '#92400E'
});

const PUBLIC_BOOKABLE_MEETINGS = [MEETING_TYPES.NEW_STUDENT_EVALUATION];

module.exports = {
  MEETING_TYPES,
  MEETING_STATUSES,
  MEETING_SOURCES,
  MEETING_DEFAULT_DURATIONS,
  MEETING_COLORS,
  PUBLIC_BOOKABLE_MEETINGS
};
