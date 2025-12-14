import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock feedback modals so they don't pull in other deps (axios/Esm imports)
jest.mock('../components/feedback/FirstClassFeedbackModal', () => ({
  __esModule: true,
  default: ({ open, onClose }) => open ? (<div data-testid="first-modal">First</div>) : null
}));

jest.mock('../components/feedback/MonthlyFeedbackModal', () => ({
  __esModule: true,
  default: ({ open, onClose }) => open ? (<div data-testid="monthly-modal">Monthly</div>) : null
}));

import DashboardHome from '../components/dashboard/DashboardHome';
import api from '../api/axios';

jest.mock('../api/axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

// Mock useAuth to provide a teacher user
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { firstName: 'Test', role: 'teacher', _id: 't1' },
    isAdmin: () => false,
    isTeacher: () => true,
    isGuardian: () => false,
    isStudent: () => false,
  })
}));

// Mock feedback prompts hook so tests don't import modules that pull in ESM-only packages
jest.mock('../hooks/useFeedbackPrompts', () => ({
  __esModule: true,
  default: () => ({ loading: false, firstClassPrompts: [], monthlyPrompts: [], refresh: jest.fn() })
}));

describe('DashboardHome (teacher)', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({ data: { success: true, role: 'teacher', stats: { hoursThisMonth: 12, pendingReports: [], pendingFirstClassStudents: [] } } });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('renders teacher dashboard with fetched stats', async () => {
    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>
    );

  // Wait for the dashboard to render the teacher greeting from fetched stats
  await waitFor(() => expect(screen.getByText(/Assalamu/i)).toBeTruthy(), { timeout: 2000 });
  expect(screen.getByText(/Hours \(this month\)/i)).toBeTruthy();
  expect(screen.getByText(/12/)).toBeTruthy();
  });
});
