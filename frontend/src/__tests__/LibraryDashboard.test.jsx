import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LibraryDashboard from '../pages/library/LibraryDashboard';

const mockLoadFolder = jest.fn();
const mockSubmitShare = jest.fn();

jest.mock('../api/library', () => ({
  __esModule: true,
  createLibraryFolder: jest.fn(async () => ({ success: true })),
  createLibraryItem: jest.fn(async () => ({ success: true })),
  deleteLibraryFolder: jest.fn(async () => ({ success: true })),
  deleteLibraryItem: jest.fn(async () => ({ success: true })),
  updateLibraryFolder: jest.fn(async () => ({ success: true })),
  updateLibraryItem: jest.fn(async () => ({ success: true })),
}));

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'teacher', firstName: 'Test', lastName: 'User' } })
}));

jest.mock('../hooks/useLibraryData', () => ({
  __esModule: true,
  default: () => ({
    tree: [{ _id: 'math', displayName: 'Mathematics', children: [] }],
    folders: [{ _id: 'algebra', displayName: 'Algebra' }],
    items: [{ _id: 'item1', displayName: 'Sample Book', description: '', allowDownload: true }],
    breadcrumb: [{ folder: 'math', displayName: 'Mathematics' }],
    activeFolder: 'math',
    isLoading: false,
    error: null,
    view: 'grid',
    setView: jest.fn(),
    searchTerm: '',
    setSearchTerm: jest.fn(),
    loadFolder: mockLoadFolder,
    submitShareRequest: mockSubmitShare,
    shareRequests: [],
    isShareSubmitting: false
  })
}));

describe('LibraryDashboard', () => {
  it('renders folders and opens share modal', () => {
    render(<LibraryDashboard />);

    expect(screen.getByText('Mathematics')).toBeInTheDocument();
    expect(screen.getByText('Algebra')).toBeInTheDocument();

    const requestButtons = screen.getAllByText(/Request access/i);
    fireEvent.click(requestButtons[0]);

    expect(screen.getByText('Request Library Access')).toBeInTheDocument();
  });
});
