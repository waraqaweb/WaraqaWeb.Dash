import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DashboardHome from '../pages/dashboard/DashboardHome';
import api from '../api/axios';

// Mock feedback modals
jest.mock('../components/feedback/FirstClassFeedbackModal', () => ({
  __esModule: true,
  default: ({ open }) => open ? (<div data-testid="first-modal">First</div>) : null
}));

jest.mock('../components/feedback/MonthlyFeedbackModal', () => ({
  __esModule: true,
  default: ({ open }) => open ? (<div data-testid="monthly-modal">Monthly</div>) : null
}));

// Mock feedback prompts hook
jest.mock('../hooks/useFeedbackPrompts', () => ({
  __esModule: true,
  default: () => ({ loading: false, firstClassPrompts: [], monthlyPrompts: [], refresh: jest.fn() })
}));

// Mock AuthContext as guardian
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { firstName: 'G', role: 'guardian' },
    isAdmin: () => false,
    isTeacher: () => false,
    isGuardian: () => true,
    isStudent: () => false,
  })
}));

jest.mock('../api/axios', () => ({ __esModule: true, default: { get: jest.fn() } }));

describe('DashboardHome (guardian)', () => {
  afterEach(() => jest.resetAllMocks());

  test('renders guardian dashboard with hours overview', async () => {
    api.get.mockResolvedValue({ data: { success: true, role: 'guardian', stats: { myChildren: 2, upcomingClasses: 3, guardianHours: 6, totalHoursLast30: 4, recentStudentHours: [] } } });

    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>
    );

    await screen.findByText(/My Students/i);
    expect(screen.getByText(/Hours \(last 30 days\)/i)).toBeTruthy();
    expect(screen.getByText(/Remaining hours/i)).toBeTruthy();
  });
});
