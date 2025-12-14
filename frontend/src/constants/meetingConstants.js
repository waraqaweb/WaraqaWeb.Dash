export const MEETING_TYPES = Object.freeze({
  NEW_STUDENT_EVALUATION: 'new_student_evaluation',
  CURRENT_STUDENT_FOLLOW_UP: 'current_student_follow_up',
  TEACHER_SYNC: 'teacher_sync',
});

export const MEETING_DEFAULT_DURATIONS = Object.freeze({
  [MEETING_TYPES.NEW_STUDENT_EVALUATION]: 30,
  [MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]: 30,
  [MEETING_TYPES.TEACHER_SYNC]: 30,
});

export const MEETING_COLORS = Object.freeze({
  background: '#FEF9C3',
  border: '#FACC15',
  text: '#92400E',
});

export const MEETING_TYPE_LABELS = Object.freeze({
  [MEETING_TYPES.NEW_STUDENT_EVALUATION]: 'Evaluation Session',
  [MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]: 'Guardian Follow-up',
  [MEETING_TYPES.TEACHER_SYNC]: 'Teacher Sync',
});

export const PUBLIC_BOOKABLE_MEETING_TYPES = Object.freeze([
  MEETING_TYPES.NEW_STUDENT_EVALUATION,
]);

export const MEETING_TYPE_DESCRIPTIONS = Object.freeze({
  [MEETING_TYPES.NEW_STUDENT_EVALUATION]: 'Welcome call to learn about your learner and match the right teacher.',
  [MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]: 'Quick check-in to review progress and adjust class plans for existing students.',
  [MEETING_TYPES.TEACHER_SYNC]: 'Monthly teacher sync focused on progress updates and blockers.',
});

export const getMeetingLabel = (type) => MEETING_TYPE_LABELS[type] || 'Meeting';
