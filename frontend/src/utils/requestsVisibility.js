export const REQUESTS_VISIBILITY_OPTIONS = [
  { value: 'all_users', label: 'All users' },
  { value: 'admin_teacher', label: 'Admins and teachers' },
  { value: 'admin_only', label: 'Admins only' },
];

export const REQUESTS_VISIBILITY_ALLOWED = REQUESTS_VISIBILITY_OPTIONS.map((option) => option.value);

export const normalizeRequestsVisibility = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return REQUESTS_VISIBILITY_ALLOWED.includes(normalized) ? normalized : 'all_users';
};
