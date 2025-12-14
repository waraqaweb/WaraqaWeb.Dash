import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DashboardHome from '../../components/dashboard/DashboardHome';
import api from '../../api/axios';

jest.mock('../../api/axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

// Mock useAuth to provide an admin user
jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { firstName: 'Admin', role: 'admin', _id: 'a1' },
    isAdmin: () => true,
    isTeacher: () => false,
    isGuardian: () => false,
    isStudent: () => false,
  })
}));

// Mock feedback prompts hook
jest.mock('../../hooks/useFeedbackPrompts', () => ({ __esModule: true, default: () => ({ loading: false, firstClassPrompts: [], monthlyPrompts: [], refresh: jest.fn() }) }));

describe('DashboardHome (admin)', () => {
  beforeEach(() => {
    const now = new Date();
    const nextAuto = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0).toISOString();
    api.get.mockResolvedValue({ data: {
      success: true,
      role: 'admin',
      cached: true,
      stats: {
        upcomingClasses30: 12,
        expectedClasses: 14,
        timestamps: { computedAt: now.toISOString(), nextAutoGeneration: nextAuto },
        // nested payload compatibility
        nested: { summary: { classes: { upcomingNext30: 12, expectedNext30: 14 } }, timestamps: { nextAutoGeneration: nextAuto } }
      }
    } });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('renders admin recurring class metrics and next auto-generation', async () => {
    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>
    );

  await waitFor(() => expect(screen.getByText(/Upcoming \(30 days\)/i)).toBeTruthy());
  // match exact numbers to avoid colliding with date/time strings
  expect(screen.getByText(/^12$/)).toBeTruthy();
  expect(screen.getByText(/Expected \(30 days\)/i)).toBeTruthy();
  expect(screen.getByText(/^14$/)).toBeTruthy();
    expect(screen.getByText(/Next Auto-Generation/i)).toBeTruthy();
  });
});
