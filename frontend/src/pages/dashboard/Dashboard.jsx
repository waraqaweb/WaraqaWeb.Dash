/**
 * Dashboard Component
 * 
 * Main dashboard interface with role-based navigation and content
 * Includes sidebar navigation and main content area
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { SearchProvider } from '../../contexts/SearchContext';
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

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState('home');
  const [mountedViews, setMountedViews] = useState(['home']);

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

  const renderView = (viewKey) => {
    switch (viewKey) {
      case 'home':
        return <DashboardHome />;
      case 'profile':
        return <ProfilePage />;
      case 'teachers':
        return <TeachersPage />;
      case 'guardians':
        return <GuardiansPage />;
      case 'students':
      case 'my-students':
        return <MyStudentsPage />;
      case 'classes':
        return <ClassesPage />;
      case 'invoices':
        return <InvoicesPage />;
      case 'salaries':
        return <SalariesPage />;
      case 'availability':
        return user?.role === 'admin'
          ? <MeetingAvailabilityAdminPage />
          : <TeacherAvailabilityPage />;
      case 'feedbacks':
        return <FeedbacksAdmin />;
      case 'class-reports':
        return <ClassReportPage />;
      case 'vacation-management':
        return <VacationManagementPage />;
      /* Removed 'reports' and 'users' pages from the dashboard: these pages are intentionally
         not rendered here so they are not accessible via direct URL anymore. */
      case "settings":
        return <Settings />;
      default:
        return <DashboardHome />;
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
            {renderView(viewKey)}
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
      default:
        return activeView.charAt(0).toUpperCase() + activeView.slice(1);
    }
  };

  return (
    <SearchProvider>
      <DeleteClassCountdownProvider>
      <div className="flex h-screen bg-background">
      {/* Sidebar */}
        <Sidebar 
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeView={activeView}
        onViewChange={handleViewChange}
        onOpenProfileModal={() => setActiveView('profile')}
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
    </DeleteClassCountdownProvider>
    </SearchProvider>
  );
};

export default Dashboard;
