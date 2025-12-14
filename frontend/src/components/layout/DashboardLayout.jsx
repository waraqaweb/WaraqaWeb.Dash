/**
 * Dashboard Layout Component
 * 
 * Reusable layout wrapper that includes sidebar and header
 * Used for pages that need consistent dashboard chrome
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { SearchProvider } from '../../contexts/SearchContext';
import Sidebar from './Sidebar';
import GlobalSearchBar from '../ui/GlobalSearchBar';
import ImpersonationBanner from '../ui/ImpersonationBanner';
import SystemVacationBanner from '../ui/SystemVacationBanner';
import NotificationCenter from '../ui/NotificationCenter';
import { Menu, X } from 'lucide-react';

const VIEW_TITLE_MAP = {
  home: 'Dashboard',
  teachers: 'Teachers',
  guardians: 'Guardians',
  students: 'Students',
  'my-students': 'My Students',
  classes: 'Classes',
  invoices: 'Invoices',
  feedbacks: 'Feedbacks',
  salaries: 'Salaries',
  'teacher-salaries': 'Teacher Salaries',
  'teacher-salary': 'My Salary',
  marketing: 'I want to Marketing Hub',
  'vacation-management': 'Vacations',
  availability: 'My Availability',
  settings: 'Settings',
  library: 'Library'
};

const formatTitleFromView = (value) => {
  if (!value) return 'Dashboard';
  return value
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const DashboardLayoutShell = ({ children, activeView = null, pageTitle }) => {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const resolvedTitle = pageTitle
    ? pageTitle
    : (VIEW_TITLE_MAP[activeView] || formatTitleFromView(activeView));

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        activeView={activeView}
        onViewChange={() => {}}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-card border-b border-border shadow-sm z-10">
          <div className="px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16 gap-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSidebar}
                  className="md:hidden icon-button icon-button--muted"
                  aria-label="Toggle sidebar"
                >
                  {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                </button>
                <h1 className="text-lg font-semibold text-foreground hidden sm:block capitalize">
                  {resolvedTitle}
                </h1>
              </div>

              <div className="flex-1 flex justify-center px-2 sm:px-4">
                <div className="w-full max-w-2xl">
                  <GlobalSearchBar activeView={activeView} />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <NotificationCenter />
              </div>
            </div>
          </div>
        </header>

        {/* Impersonation Banner */}
        <ImpersonationBanner />

        {/* System Vacation Banner */}
        <SystemVacationBanner />

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-background">
          <div className="w-full h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

const DashboardLayout = ({ provideSearchContext = true, ...props }) => {
  const content = <DashboardLayoutShell {...props} />;
  if (provideSearchContext) {
    return <SearchProvider>{content}</SearchProvider>;
  }
  return content;
};

export default DashboardLayout;
