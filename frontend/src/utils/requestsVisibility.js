export const REQUESTS_VISIBILITY_KEY = 'requestsVisibility';

export const REQUESTS_VISIBILITY_OPTIONS = [
  { value: 'admin_only', label: 'Admin only' },
  { value: 'admin_teacher', label: 'Admin + Teacher' },
  { value: 'all_users', label: 'All users' },
];

export const normalizeRequestsVisibility = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (REQUESTS_VISIBILITY_OPTIONS.some((option) => option.value === normalized)) {
    return normalized;
  }
  return 'all_users';
};

export const getAllowedRolesForRequestsVisibility = (value) => {
  const normalized = normalizeRequestsVisibility(value);
  if (normalized === 'admin_only') return ['admin'];
  if (normalized === 'admin_teacher') return ['admin', 'teacher'];
  return ['admin', 'teacher', 'guardian', 'student'];
};

export const canRoleAccessRequests = (role, value) => {
  const currentRole = String(role || '').trim().toLowerCase();
  if (!currentRole) return false;
  return getAllowedRolesForRequestsVisibility(value).includes(currentRole);
};
