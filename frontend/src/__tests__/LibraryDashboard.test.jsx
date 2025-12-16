import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

const mockLoadFolder = jest.fn();
const mockSubmitShare = jest.fn();

jest.mock('../components/library/DocumentViewer', () => ({
  __esModule: true,
  default: () => null
}));

jest.mock('../components/layout/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>
}));

jest.mock('../components/library/LibraryGrid', () => ({
  __esModule: true,
  default: ({ folders = [], items = [] }) => (
    <div data-testid="library-grid">
      folders:{folders.length};items:{items.length}
    </div>
  )
}));

jest.mock('../api/library', () => ({
  __esModule: true,
  createLibraryFolder: jest.fn(async () => ({ success: true })),
  createLibraryItem: jest.fn(async () => ({ success: true })),
  deleteLibraryFolder: jest.fn(async () => ({ success: true })),
  deleteLibraryItem: jest.fn(async () => ({ success: true })),
  fetchDocumentPages: jest.fn(async () => ({ pages: [] })),
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

const LibraryDashboard = require('../pages/library/LibraryDashboard').default;

describe('LibraryDashboard', () => {
  it('renders folders and opens share modal', () => {
    render(<LibraryDashboard />);

    expect(screen.getAllByText('Mathematics').length).toBeGreaterThan(0);
    expect(screen.getByTestId('library-grid').textContent).toContain('folders:1;items:1');

    const requestButtons = screen.getAllByText(/Request access/i);
    fireEvent.click(requestButtons[0]);

    expect(screen.getByText('Request Library Access')).toBeTruthy();
  });
});
