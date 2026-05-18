import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Map a /dashboard/<view>/... pathname to a human-friendly title segment.
const VIEW_TITLES = {
  '': 'Home',
  home: 'Home',
  classes: 'Classes',
  students: 'Students',
  'my-students': 'My Students',
  teachers: 'Teachers',
  guardians: 'Guardians',
  invoices: 'Invoices',
  'invoice-templates': 'Invoice Templates',
  library: 'Library',
  evaluation: 'Evaluation',
  evaluations: 'Evaluations',
  'interactive-learning': 'Interactive Learning',
  salaries: 'Salaries',
  availability: 'Availability',
  feedbacks: 'Feedbacks',
  vacations: 'Vacations',
  'vacation-management': 'Vacations',
  requests: 'Requests',
  settings: 'Settings',
  profile: 'Profile',
  notifications: 'Notifications',
  reports: 'Reports',
  analytics: 'Analytics',
  meetings: 'Meetings',
  leads: 'Leads',
  trash: 'Trash',
  users: 'Users',
  login: 'Sign in',
  register: 'Register',
  'forgot-password': 'Forgot password',
  'reset-password': 'Reset password',
  'admin/login': 'Admin sign in',
  'admin/dashboard': 'Admin',
};

const titleForPath = (pathname) => {
  const path = (pathname || '/').replace(/\/+$/, '');
  if (path === '' || path === '/') return 'Waraqa';

  // Public marketing/login surface
  if (/^\/dashboard\/admin\/login\b/.test(path)) return 'Admin sign in • Waraqa';
  if (/^\/dashboard\/login\b/.test(path)) return 'Sign in • Waraqa';
  if (/^\/dashboard\/register\b/.test(path)) return 'Register • Waraqa';
  if (/^\/dashboard\/forgot-password\b/.test(path)) return 'Forgot password • Waraqa';
  if (/^\/dashboard\/reset-password\b/.test(path)) return 'Reset password • Waraqa';

  // Invoice public slug page
  const invoiceSlug = path.match(/^\/dashboard\/invoices\/([^/]+)$/);
  if (invoiceSlug && invoiceSlug[1] !== 'create') {
    return `Invoice ${invoiceSlug[1]} • Waraqa`;
  }

  // Admin pages
  const adminMatch = path.match(/^\/admin\/([^/]+)/);
  if (adminMatch) {
    const seg = adminMatch[1];
    const label = VIEW_TITLES[seg] || seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `${label} (Admin) • Waraqa`;
  }

  // Dashboard pages: /dashboard or /dashboard/<view>/...
  const dashMatch = path.match(/^\/dashboard(?:\/([^/]+))?/);
  if (dashMatch) {
    const view = dashMatch[1] || 'home';
    const label = VIEW_TITLES[view] || view.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return `${label} • Waraqa`;
  }

  return 'Waraqa';
};

// Hook: keep document.title in sync with the current route.
export default function useDocumentTitle() {
  const location = useLocation();
  useEffect(() => {
    const next = titleForPath(location.pathname);
    if (typeof document !== 'undefined' && document.title !== next) {
      document.title = next;
    }
  }, [location.pathname]);
}
