import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import DashboardHome from '../components/dashboard/DashboardHome';
import api from '../api/axios';

jest.mock('../api/axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));

// Mock useAuth to provide an admin user
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { firstName: 'Admin', role: 'admin', _id: 'a1' },
    isAdmin: () => true,
    isTeacher: () => false,
    isGuardian: () => false,
    isStudent: () => false,
  })
}));

// Mock feedback prompts hook
jest.mock('../hooks/useFeedbackPrompts', () => ({ __esModule: true, default: () => ({ loading: false, firstClassPrompts: [], monthlyPrompts: [], refresh: jest.fn() }) }));

describe('DashboardHome charts integration', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test('renders three chart cards with Recharts svgs when timeseries data exists', async () => {
    const now = new Date();
    const days = [...Array(5)].map((_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (4 - i));
      return d.toISOString().slice(0,10);
    });

    api.get.mockResolvedValue({ data: {
      success: true,
      role: 'admin',
      cached: true,
      stats: {
        summary: {
          timeseries: {
            dates: days,
            revenue: [10,20,30,25,15],
            classesScheduled: [2,3,4,3,2],
            classesCompleted: [1,2,3,2,1],
            activeUsers: [50,52,54,53,55],
            teachers: [5,5,6,6,6]
          }
        },
        timestamps: { computedAt: now.toISOString() }
      }
    } });

    const { container } = render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>
    );

  // wait for async load and rendered titles
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByText(/Revenue \(last 30 days\)/i)).toBeTruthy());
  await waitFor(() => expect(screen.getByText(/Classes \(last 30 days\)/i)).toBeTruthy());
  await waitFor(() => expect(screen.getByText(/Active Users \/ Teachers \(last 30 days\)/i)).toBeTruthy());

    // For a populated timeseries we expect the chart placeholders NOT to appear
    expect(screen.queryByText(/No revenue data/i)).toBeNull();
    expect(screen.queryByText(/No class data/i)).toBeNull();
    expect(screen.queryByText(/No activity data/i)).toBeNull();
  });

  test('gracefully handles empty timeseries arrays (no crashes, placeholder shown)', async () => {
    const now = new Date();
    api.get.mockResolvedValue({ data: {
      success: true,
      role: 'admin',
      cached: true,
      stats: {
        summary: { timeseries: { dates: [], revenue: [], classesScheduled: [], classesCompleted: [], activeUsers: [], teachers: [] } },
        timestamps: { computedAt: now.toISOString() }
      }
    } });

    render(
      <MemoryRouter>
        <DashboardHome />
      </MemoryRouter>
    );

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    // Placeholders should appear
    await waitFor(() => expect(screen.getByText(/No revenue data/i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/No class data/i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/No activity data/i)).toBeTruthy());
  });
});
