import { standardizeSubjects } from '../utils/subjectStandardization';

// View key used by GlobalSearchBar + SearchContext.viewFilters to scope the
// Recruitment ("Teacher Operations" > Pipeline) candidate list filters.
export const TEACHER_OPERATIONS_VIEW_KEY = 'teacher-operations';

export const createDefaultTeacherResponsesFilters = () => ({
  gender: 'all',
  subject: 'all',
  degree: 'all',
  faculty: '',
  score: 'all'
});

export const CANDIDATE_GENDER_OPTIONS = [
  { value: 'all', label: 'All genders' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' }
];

export const CANDIDATE_DEGREE_OPTIONS = [
  { value: 'all', label: 'All degrees' },
  { value: 'phd', label: 'PhD / Doctorate' },
  { value: 'masters', label: "Master's" },
  { value: 'bachelors', label: "Bachelor's" },
  { value: 'diploma', label: 'Diploma / Associate' },
  { value: 'highschool', label: 'High school / Other' },
  { value: 'none', label: 'Not specified' }
];

export const CANDIDATE_SCORE_OPTIONS = [
  { value: 'all', label: 'All scores' },
  { value: 'excellent', label: 'Excellent' },
  { value: 'very_good', label: 'Very good' },
  { value: 'good', label: 'Good' },
  { value: 'weak', label: 'Weak' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'not_rated', label: 'Not rated' }
];

// Mirrors the degree-ranking keyword patterns used to sort "Under review"
// candidates in TeacherResponsesPanel.jsx — the `degree` field is free-form
// text synced from the Google Form (no fixed enum), so we bucket it via
// keyword matching rather than an exact value match.
const DEGREE_BUCKET_PATTERNS = [
  { value: 'phd', patterns: [/ph\.?\s?d/i, /doctor/i] },
  { value: 'masters', patterns: [/master/i, /\bm\.?a\.?\b/i, /\bm\.?sc\.?\b/i, /magist(er|ir)/i] },
  { value: 'bachelors', patterns: [/bachelor/i, /\bb\.?a\.?\b/i, /\bb\.?sc\.?\b/i, /licen[cs]e/i, /undergraduate/i] },
  { value: 'diploma', patterns: [/diploma/i, /associate/i] },
  { value: 'highschool', patterns: [/high\s?school/i, /secondary/i] },
];

/** Buckets a free-text degree value into one of CANDIDATE_DEGREE_OPTIONS' values. */
export const bucketDegree = (degreeText) => {
  const text = String(degreeText || '').trim();
  if (!text) return 'none';
  const match = DEGREE_BUCKET_PATTERNS.find(({ patterns }) => patterns.some((re) => re.test(text)));
  return match ? match.value : 'highschool'; // unrecognized-but-present text — bucket with the catch-all
};

/** Buckets the backend's computed overall label ("Very good", etc.) into a filter value. */
export const bucketScoreLabel = (label) => (
  String(label || '').trim().toLowerCase().replace(/\s+/g, '_') || 'not_rated'
);

/** Returns true if `item` (a candidate row) matches the given resolved filters. */
export const candidateMatchesResponsesFilters = (item, filters) => {
  if (!filters) return true;

  if (filters.gender && filters.gender !== 'all') {
    const gender = String(item?.personalInfo?.gender || '').toLowerCase();
    if (gender !== filters.gender) return false;
  }

  if (filters.subject && filters.subject !== 'all') {
    const subjects = standardizeSubjects(item?.application?.teachingProfile?.subjectsCanTeach || []);
    if (!subjects.includes(filters.subject)) return false;
  }

  if (filters.degree && filters.degree !== 'all') {
    if (bucketDegree(item?.application?.education?.degree) !== filters.degree) return false;
  }

  if (filters.faculty && filters.faculty.trim()) {
    const faculty = String(item?.application?.education?.facultyUniversity || '').toLowerCase();
    if (!faculty.includes(filters.faculty.trim().toLowerCase())) return false;
  }

  if (filters.score && filters.score !== 'all') {
    if (bucketScoreLabel(item?.recruitment?.overall?.label) !== filters.score) return false;
  }

  return true;
};
