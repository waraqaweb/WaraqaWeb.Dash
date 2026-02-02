/**
 * Dashboard Component
 * 
 * Main dashboard interface with role-based navigation and content
 * Includes sidebar navigation and main content area
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { SearchProvider, useSearch } from '../../contexts/SearchContext';
import Sidebar from '../../components/layout/Sidebar';
import GlobalSearchBar from '../../components/ui/GlobalSearchBar';
// Profile modal removed in favor of unified Profile page/modal
import DashboardHome from './DashboardHome';
import ProfilePage from './ProfilePage';
import TeachersPage from './TeachersPage';
import GuardiansPage from './GuardiansPage';
import MyStudentsPage from './MyStudentsPage';
import ClassesPage from './ClassesPage';
import InvoicesPage from './InvoicesPage';
import ClassReportPage from './ClassReportPage';
import SalariesPage from './salaries/SalariesPage';
import LibraryDashboard from '../library/LibraryDashboard';
import TeacherAvailabilityPage from './TeacherAvailabilityPage';
import MeetingAvailabilityAdminPage from './MeetingAvailabilityAdminPage';
import Settings from "./Settings";
import ImpersonationBanner from '../../components/ui/ImpersonationBanner';
import SystemVacationBanner from '../../components/ui/SystemVacationBanner';
import NotificationCenter from '../../components/ui/NotificationCenter';
import FeedbacksAdmin from './FeedbacksAdmin';
import { Menu, X } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import VacationManagementPage from './VacationManagementPage';
import { DeleteClassCountdownProvider, useDeleteClassCountdown } from '../../contexts/DeleteClassCountdownContext';
import DeleteCountdownToast from '../../components/ui/DeleteCountdownToast';
import ToastHost from '../../components/ui/ToastHost';
import { showToast } from '../../utils/toast';

const DeleteCountdownHost = () => {
  const { isActive, secondsLeft, message, error, undo } = useDeleteClassCountdown();
  return (
    <DeleteCountdownToast
      isActive={isActive}
      countdown={secondsLeft}
      message={message}
      error={error}
      onUndo={undo}
    />
  );
};

const DashboardQuerySync = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { searchTerm, setSearchTerm } = useSearch();
  const normalizeSearch = (search) => {
    const params = new URLSearchParams(search || '');
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    return new URLSearchParams(entries).toString();
  };

  // Pull `q` from the URL (supports refresh/back to restore search).
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const q = params.get('q') || '';
      if (q !== searchTerm) {
        setSearchTerm(q);
      }
    } catch (err) {
      // ignore URL parse issues
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Push `q` into the URL (debounced + replace to avoid breaking Back button).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const params = new URLSearchParams(location.search);
        const q = (searchTerm || '').trim();
        if (q) params.set('q', q);
        else params.delete('q');
        const next = params.toString();
        const current = (location.search || '').replace(/^\?/, '');
        if (normalizeSearch(next) === normalizeSearch(current)) return;
        navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true });
      } catch (err) {
        // ignore URL sync errors
      }
    }, 250);

    return () => clearTimeout(t);
  }, [location.pathname, location.search, navigate, searchTerm]);

  return null;
};

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState('home');
  const [mountedViews, setMountedViews] = useState(['home']);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const originalAlert = window.alert;
    window.alert = (message) => {
      showToast(message);
    };
    return () => {
      window.alert = originalAlert;
    };
  }, []);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleViewChange = (view) => {
    // Use proper navigation instead of state management
    navigate(`/dashboard/${view}`);
    
    // Close sidebar on mobile after selection
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  // Determine active view from URL path
  useEffect(() => {
    const path = location.pathname;
    
    // Extract view from path
    if (path === '/dashboard' || path === '/dashboard/') {
      setActiveView('home');
    } else {
      // Extract the last segment after /dashboard/
      const segments = path.split('/').filter(Boolean);
      const viewSegment = segments[segments.length - 1];
      setActiveView(viewSegment);
    }
  }, [location.pathname]);

  // Keep visited views mounted so lists don't reload on every tab switch.
  useEffect(() => {
    if (!activeView) return;
    setMountedViews((prev) => (prev.includes(activeView) ? prev : [...prev, activeView]));
  }, [activeView]);

  const renderView = (viewKey, isActive = false) => {
    switch (viewKey) {
      case 'home':
        return <DashboardHome isActive={isActive} />;
      case 'profile':
        return <ProfilePage isActive={isActive} />;
      case 'teachers':
        return <TeachersPage isActive={isActive} />;
      case 'guardians':
        return <GuardiansPage isActive={isActive} />;
      case 'students':
      case 'my-students':
        return <MyStudentsPage isActive={isActive} />;
      case 'classes':
        return <ClassesPage isActive={isActive} />;
      case 'invoices':
        return <InvoicesPage isActive={isActive} />;
      case 'salaries':
        return <SalariesPage isActive={isActive} />;
      case 'library':
        return <LibraryDashboard isActive={isActive} />;
      case 'availability':
        return user?.role === 'admin'
          ? <MeetingAvailabilityAdminPage isActive={isActive} />
          : <TeacherAvailabilityPage isActive={isActive} />;
      case 'feedbacks':
        return <FeedbacksAdmin isActive={isActive} />;
      case 'class-reports':
        return <ClassReportPage isActive={isActive} />;
      case 'vacation-management':
        return <VacationManagementPage isActive={isActive} />;
      /* Removed 'reports' and 'users' pages from the dashboard: these pages are intentionally
         not rendered here so they are not accessible via direct URL anymore. */
      case "settings":
        return <Settings isActive={isActive} />;
      default:
        return <DashboardHome isActive={isActive} />;
    }
  };

  const renderContent = () => {
    const viewsToRender = mountedViews.includes(activeView)
      ? mountedViews
      : [...mountedViews, activeView];

    return (
      <>
        {viewsToRender.map((viewKey) => (
          <div
            key={viewKey}
            className={viewKey === activeView ? 'block' : 'hidden'}
          >
            {renderView(viewKey, viewKey === activeView)}
          </div>
        ))}
      </>
    );
  };

  const getPageTitle = () => {
    switch (activeView) {
      case 'home':
        return 'Dashboard';
      case 'my-students':
        return 'My Students';
      case 'salaries':
        return 'Salaries';
      case 'availability':
        return user?.role === 'admin' ? 'Meeting Availability' : 'My Availability';
      case 'library':
        return 'Library';
      default:
        return activeView.charAt(0).toUpperCase() + activeView.slice(1);
    }
  };

  return (
    <SearchProvider>
      <DashboardQuerySync />
      <DeleteClassCountdownProvider>
      <div className="flex h-screen bg-background">
      {/* Sidebar */}
        <Sidebar 
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeView={activeView}
        onViewChange={handleViewChange}
        onOpenProfileModal={() => navigate('/dashboard/profile')}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="bg-card border-b border-border px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            {/* Mobile menu button */}
            <button
              onClick={toggleSidebar}
              className="md:hidden icon-button icon-button--muted"
            >
              {sidebarOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>

            {/* Page title */}
            <h1 className="text-lg sm:text-xl font-semibold text-foreground">
              {getPageTitle()}
            </h1>
          </div>

          {/* Search Bar - Center */}
          <div className="hidden md:flex flex-1 justify-center max-w-2xl mx-4">
            <GlobalSearchBar activeView={activeView} />
          </div>

          {/* User info and Notifications */}
          <div className="flex items-center space-x-4">
            <NotificationCenter />
            <div className="flex items-center space-x-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-foreground">
                  {user?.fullName || `${user?.firstName} ${user?.lastName}`}
                </p>
                <p className="text-xs text-muted-foreground capitalize">
                  {user?.role}
                </p>
              </div>
              <div className="h-8 w-8 bg-primary rounded-full flex items-center justify-center">
                <span className="text-sm font-medium text-primary-foreground">
                  {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile Search Bar */}
        <div className="md:hidden px-4 py-2 bg-card border-b border-border">
          <GlobalSearchBar activeView={activeView} />
        </div>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto bg-background">
          <ImpersonationBanner />
          <SystemVacationBanner />
          {renderContent()}
        </main>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
  {/* ProfileModal removed - sidebar now navigates to the Profile page */}
    </div>
    <DeleteCountdownHost />
    <ToastHost />
    </DeleteClassCountdownProvider>
    </SearchProvider>
  );
};

export default Dashboard;
