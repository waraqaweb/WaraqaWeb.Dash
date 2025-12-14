export const TEACHER_SALARY_VIEW_KEY = 'teacher-salaries';

export const createDefaultTeacherSalaryFilters = () => ({
  month: '',
  teacherId: '',
  status: '',
  currency: ''
});

export const TEACHER_SALARY_STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'paid', label: 'Paid' },
  { value: 'archived', label: 'Archived' }
];

export const TEACHER_SALARY_CURRENCY_OPTIONS = [
  { value: '', label: 'All Currencies' },
  { value: 'EGP', label: 'EGP' },
  { value: 'USD', label: 'USD' }
];
