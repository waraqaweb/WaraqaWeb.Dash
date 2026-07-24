import api from './axios';

const BASE = '/teacher-interview-feedback';

// Admin: generate (or reuse) a post-interview feedback link. Works for a
// candidate on file (pass candidateSource/candidateId) or any teacher not
// listed in the interview tab (just pass name/email/phone).
export async function generateTeacherInterviewFeedbackLink({ teacherName, contactEmail, contactPhone, candidateSource, candidateId } = {}) {
  const { data } = await api.post(BASE, { teacherName, contactEmail, contactPhone, candidateSource, candidateId });
  return data;
}
