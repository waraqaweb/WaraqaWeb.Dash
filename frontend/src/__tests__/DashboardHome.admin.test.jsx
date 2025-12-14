import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock feedback modals
jest.mock('../components/feedback/FirstClassFeedbackModal', () => ({
  __esModule: true,
  default: ({ open }) => open ? (<div data-testid="first-modal">First</div>) : null
}));

jest.mock('../components/feedback/MonthlyFeedbackModal', () => ({
  __esModule: true,
  default: ({ open }) => open ? (<div data-testid="monthly-modal">Monthly</div>) : null
}));

// Mock feedback prompts hook to avoid ESM-heavy imports
jest.mock('../hooks/useFeedbackPrompts', () => ({
  __esModule: true,
  default: () => ({ loading: false, firstClassPrompts: [], monthlyPrompts: [], refresh: jest.fn() })
}));

// We'll use a mutable mock object so tests can switch role without resetting module registry
let mockAuth = {
  user: { firstName: 'Admin', role: 'admin' },
  isAdmin: () => true,
  isTeacher: () => false,
  isGuardian: () => false,
  isStudent: () => false,
};

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

import DashboardHome from '../components/dashboard/DashboardHome';
import api from '../api/axios';

jest.mock('../api/axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

describe('DashboardHome (admin & guardian)', () => {
  afterEach(() => {
    jest.resetAllMocks();
    // reset mockAuth to admin by default
    mockAuth = {
      user: { firstName: 'Admin', role: 'admin' },
      isAdmin: () => true,
      isTeacher: () => false,
      isGuardian: () => false,
      isStudent: () => false,
    };
  });

  test('renders admin dashboard and toggles compact mode', async () => {
    // Set admin role
    mockAuth.user = { firstName: 'Admin', role: 'admin' };
    mockAuth.isAdmin = () => true;
    mockAuth.isGuardian = () => false;

  api.get.mockResolvedValue({ data: { success: true, role: 'admin', stats: { users: [{ _id: 'teacher', count: 2 }], revenue: { total: 1000 } } } });

    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>
    );

  await waitFor(() => expect(screen.getByText(/Assalamu/i)).toBeTruthy());
    expect(screen.getByText(/Total Users/i)).toBeTruthy();

    // compact toggle should be present
    const toggle = screen.getByRole('button', { name: /Compact:/i });
    expect(toggle).toBeTruthy();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-pressed')).toBe('true'));
  });

  test('renders guardian dashboard with monthly bill', async () => {
    // Switch to guardian role
    mockAuth.user = { firstName: 'G', role: 'guardian' };
    mockAuth.isAdmin = () => false;
    mockAuth.isGuardian = () => true;

  api.get.mockResolvedValue({ data: { success: true, role: 'guardian', stats: { myChildren: 2, upcomingClasses: 3, guardianHours: 12 } } });

    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>
    );

  await waitFor(() => expect(screen.getByText(/My Students/i)).toBeTruthy());
    expect(screen.getByText(/Hours \(last 30 days\)/i)).toBeTruthy();
    expect(screen.getByText(/Remaining hours/i)).toBeTruthy();
  });
});
