import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Search, X, Filter } from 'lucide-react';
import { useSearch } from '../../contexts/SearchContext';
import api from '../../api/axios';
import {
  TEACHER_SALARY_VIEW_KEY,
  createDefaultTeacherSalaryFilters,
  TEACHER_SALARY_STATUS_OPTIONS
} from '../../constants/teacherSalaryFilters';

const placeholderMap = {
  home: 'Search dashboard...',
  teachers: 'Search teachers by name, email, or ID...',
  guardians: 'Search guardians by name, email, or student...',
  students: 'Search students by name, guardian, or class...',
  'my-students': 'Search students by name, guardian, or class...',
  classes: 'Search classes by name, teacher, or schedule...',
  invoices: 'Search invoices by number, guardian, or amount...',
  feedbacks: 'Search feedbacks by user, class, or date...',
  salaries: 'Search salaries by teacher or month...',
  'teacher-salaries': 'Search teacher salaries by teacher or month...',
  'teacher-salary': 'Search your salary statements...',
  'vacation-management': 'Search vacation requests...',
  reports: 'Search reports...',
  users: 'Search users...',
  settings: 'Search settings...',
  profile: 'Search profile information...',
  library: 'Search the library by subject, title, or tag...',
  availability: 'Search leads by guardian, student, email, or phone...'
};

const AVAILABILITY_VIEW_KEY = 'availability';
const createDefaultAvailabilityFilters = () => ({
  leadStatus: 'all',
  leadSource: 'all',
  leadTimeView: 'viewer'
});

const filterOptions = {
  teachers: [
    { value: 'all', label: 'All Teachers' },
    { value: 'active', label: 'Active Only' },
    { value: 'inactive', label: 'Inactive Only' }
  ],
  guardians: [
    { value: 'all', label: 'All Guardians' },
    { value: 'active', label: 'Active Only' },
    { value: 'inactive', label: 'Inactive Only' }
  ],
  students: [
    { value: 'all', label: 'All Students' },
    { value: 'active', label: 'Active Only' },
    { value: 'inactive', label: 'Inactive Only' }
  ],
  'my-students': [
    { value: 'all', label: 'All Students' },
    { value: 'active', label: 'Active Only' },
    { value: 'inactive', label: 'Inactive Only' }
  ],
  invoices: [
    { value: 'all', label: 'All invoices' },
    { heading: 'Segments' },
    { value: 'segment:unpaid', label: 'Unpaid focus' },
    { value: 'segment:paid', label: 'Paid & closed' },
    { heading: 'Status' },
    { value: 'status:draft', label: 'Draft' },
    { value: 'status:sent', label: 'Sent' },
    { value: 'status:paid', label: 'Paid' },
    { value: 'status:overdue', label: 'Overdue' },
    { value: 'status:cancelled', label: 'Cancelled' },
    { value: 'status:refunded', label: 'Refunded' },
    { heading: 'Type' },
    { value: 'type:guardian_invoice', label: 'Guardian invoices' },
    { value: 'type:teacher_payment', label: 'Teacher payouts' }
  ],
  feedbacks: [
    { value: 'all', label: 'All Feedbacks' },
    { value: 'unread', label: 'Unread' },
    { value: 'read', label: 'Read' }
  ],
  classes: [
    { value: 'all', label: 'All Classes' },
    { heading: 'Upcoming' },
    { value: 'scheduled', label: 'Scheduled' },
    { heading: 'Previous' },
    { value: 'completed', label: 'Completed' },
    { value: 'attended', label: 'Attended' },
    { value: 'missed_by_student', label: 'Missed by student' },
    { value: 'absent', label: 'Absent' },
    { value: 'no_show_both', label: 'No show (both)' },
    { value: 'cancelled', label: 'Cancelled' },
    { heading: 'Reports' },
    { value: 'pending_report', label: 'Pending report' },
    { value: 'missed_report', label: 'Missed report' },
    { value: 'admin_extended', label: 'Extended' },
  ],
  profile: [
    { value: 'all', label: 'All Users' },
    { value: 'active', label: 'Active Only' },
    { value: 'inactive', label: 'Inactive Only' }
  ],
  'vacation-management': [
    { value: 'all', label: 'All Vacations' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' }
  ],
  salaries: [
    { value: 'all', label: 'All Salaries' },
    { value: 'draft', label: 'Draft' },
    { value: 'paid', label: 'Paid' },
    { value: 'pending', label: 'Pending' },
    { value: 'overdue', label: 'Overdue' }
  ],
  library: [
    { value: 'all', label: 'All resources' },
    { value: 'downloadable', label: 'Downloads allowed' },
    { value: 'view-only', label: 'View only' },
    { value: 'secret', label: 'Secret only' }
  ]
};

const GlobalSearchBar = ({ activeView = 'default' }) => {
  const {
    searchTerm,
    setSearchTerm,
    clearSearch,
    setIsSearchFocused,
    globalFilter,
    setGlobalFilter,
    viewFilters,
    setFiltersForView,
    updateViewFilters
  } = useSearch();
  const [showFilters, setShowFilters] = useState(false);
  const [salaryTeachers, setSalaryTeachers] = useState([]);
  const [salaryTeachersLoading, setSalaryTeachersLoading] = useState(false);
  const inputRef = useRef(null);
  const placeholder = placeholderMap[activeView] || 'Search...';
  const currentFilters = filterOptions[activeView] || [];
  const actionableFilters = currentFilters.filter((filter) => Boolean(filter.value));
  const isTeacherSalaryView = activeView === TEACHER_SALARY_VIEW_KEY;
  const isAvailabilityView = activeView === AVAILABILITY_VIEW_KEY;
  const salaryFilterState = viewFilters[TEACHER_SALARY_VIEW_KEY];
  const resolvedSalaryFilters = salaryFilterState || createDefaultTeacherSalaryFilters();
  const availabilityFilterState = viewFilters[AVAILABILITY_VIEW_KEY];
  const resolvedAvailabilityFilters = availabilityFilterState || createDefaultAvailabilityFilters();
  const salaryFilterCount = useMemo(() => (
    Object.values(resolvedSalaryFilters).filter(Boolean).length
  ), [resolvedSalaryFilters]);
  const availabilityFilterCount = useMemo(() => (
    Object.entries(resolvedAvailabilityFilters).filter(([key, value]) => value && value !== createDefaultAvailabilityFilters()[key]).length
  ), [resolvedAvailabilityFilters]);
  const hasFilters = actionableFilters.length > 0 || isTeacherSalaryView || isAvailabilityView;
  const filterIndicatorCount = isTeacherSalaryView
    ? salaryFilterCount
    : isAvailabilityView
      ? availabilityFilterCount
    : (globalFilter !== 'all' ? 1 : 0);

  // Reset filter when changing pages
  useEffect(() => {
    setGlobalFilter('all');
  }, [activeView, setGlobalFilter]);

  // Ensure salary filters have defaults when view loads
  useEffect(() => {
    if (!isTeacherSalaryView) return;
    if (salaryFilterState) return;
    setFiltersForView(TEACHER_SALARY_VIEW_KEY, createDefaultTeacherSalaryFilters());
  }, [isTeacherSalaryView, salaryFilterState, setFiltersForView]);

  useEffect(() => {
    if (!isAvailabilityView) return;
    if (availabilityFilterState) return;
    setFiltersForView(AVAILABILITY_VIEW_KEY, createDefaultAvailabilityFilters());
  }, [isAvailabilityView, availabilityFilterState, setFiltersForView]);

  // Fetch teachers for salary filters once
  useEffect(() => {
    if (!isTeacherSalaryView) return;
    if (salaryTeachers.length > 0 || salaryTeachersLoading) return;

    let isMounted = true;
    const fetchTeachers = async () => {
      try {
        setSalaryTeachersLoading(true);
        const response = await api.get('/users', { params: { role: 'teacher', isActive: true } });
        if (!isMounted) return;
        setSalaryTeachers(response.data?.users || []);
      } catch (err) {
        if (isMounted) {
          console.error('[GlobalSearchBar] Failed to load teacher list', err);
        }
      } finally {
        if (isMounted) {
          setSalaryTeachersLoading(false);
        }
      }
    };

    fetchTeachers();
    return () => {
      isMounted = false;
    };
  }, [isTeacherSalaryView, salaryTeachers.length, salaryTeachersLoading]);

  // Close filter dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showFilters && !event.target.closest('.filter-dropdown')) {
        setShowFilters(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilters]);

  // Keyboard shortcut: Ctrl+/ or Cmd+/
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // ESC to clear search
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        clearSearch();
        inputRef.current?.blur();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [clearSearch]);

  // Debounced search (optional for future server-side search)
  useEffect(() => {
    const timer = setTimeout(() => {
      // Future: trigger server-side search here
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  return (
    <div className="relative w-80 max-w-md">
      <div className="flex items-center space-x-2">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder={placeholder}
            className="w-full pl-10 pr-10 py-2 text-sm bg-muted border border-border rounded-md 
                     focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                     placeholder:text-muted-foreground transition-all duration-200"
          />
          {searchTerm && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary/30"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filter Button */}
        {hasFilters && (
          <div className="relative filter-dropdown" padding="true" padding-left="20px">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center gap-1 rounded-md p-2 text-sm font-medium transition-colors ${
                filterIndicatorCount > 0
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
              title="Filter options"
            >
              <Filter className="h-4 w-4" />
              {filterIndicatorCount > 0 && (
                <span className="text-xs font-semibold">{filterIndicatorCount}</span>
              )}
            </button>


            {/* Filter Dropdown */}
            {showFilters && (
              isTeacherSalaryView ? (
                <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-md shadow-lg z-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Filter salaries</p>
                    <button
                      onClick={() => {
                        setFiltersForView(TEACHER_SALARY_VIEW_KEY, createDefaultTeacherSalaryFilters());
                      }}
                      className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Reset
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground">Month</label>
                    <input
                      type="month"
                      value={resolvedSalaryFilters.month || ''}
                      onChange={(e) => updateViewFilters(TEACHER_SALARY_VIEW_KEY, { month: e.target.value })}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground">Teacher</label>
                    <select
                      value={resolvedSalaryFilters.teacherId || ''}
                      onChange={(e) => updateViewFilters(TEACHER_SALARY_VIEW_KEY, { teacherId: e.target.value })}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                      disabled={salaryTeachersLoading}
                    >
                      <option value="">All Teachers</option>
                      {salaryTeachers.map(teacher => (
                        <option key={teacher._id} value={teacher._id}>
                          {teacher.firstName} {teacher.lastName}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground">Status</label>
                    <select
                      value={resolvedSalaryFilters.status || ''}
                      onChange={(e) => updateViewFilters(TEACHER_SALARY_VIEW_KEY, { status: e.target.value })}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    >
                      {TEACHER_SALARY_STATUS_OPTIONS.map(option => (
                        <option key={option.value || 'all-statuses'} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => setShowFilters(false)}
                      className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : isAvailabilityView ? (
                <div className="absolute right-0 top-full mt-1 w-80 bg-card border border-border rounded-md shadow-lg z-50 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">Lead filters</p>
                    <button
                      onClick={() => setFiltersForView(AVAILABILITY_VIEW_KEY, createDefaultAvailabilityFilters())}
                      className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    >
                      Reset
                    </button>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground">Status</label>
                    <select
                      value={resolvedAvailabilityFilters.leadStatus || 'all'}
                      onChange={(e) => updateViewFilters(AVAILABILITY_VIEW_KEY, { leadStatus: e.target.value })}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    >
                      <option value="all">All leads</option>
                      <option value="new">New</option>
                      <option value="converted">Converted</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground">Source</label>
                    <select
                      value={resolvedAvailabilityFilters.leadSource || 'all'}
                      onChange={(e) => updateViewFilters(AVAILABILITY_VIEW_KEY, { leadSource: e.target.value })}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    >
                      <option value="all">All sources</option>
                      <option value="student_registration_form">Registration form</option>
                      <option value="evaluation_booking">Evaluation booking</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-muted-foreground">Time display</label>
                    <select
                      value={resolvedAvailabilityFilters.leadTimeView || 'viewer'}
                      onChange={(e) => updateViewFilters(AVAILABILITY_VIEW_KEY, { leadTimeView: e.target.value })}
                      className="w-full rounded-md border border-border px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                    >
                      <option value="viewer">My timezone</option>
                      <option value="lead">Lead timezone</option>
                    </select>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => setShowFilters(false)}
                      className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <div className="absolute right-0 top-full mt-1 w-48 bg-card border border-border rounded-md shadow-lg z-50">
                  <div className="p-2">
                    <div className="text-xs font-medium text-muted-foreground mb-2">Filter by:</div>
                    {currentFilters.map((filter, index) => {
                      if (filter.heading) {
                        return (
                          <div
                            key={`heading-${filter.heading}-${index}`}
                            className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 first:pt-0"
                          >
                            {filter.heading}
                          </div>
                        );
                      }

                      return (
                        <button
                          key={filter.value}
                          onClick={() => {
                            setGlobalFilter(filter.value);
                            setShowFilters(false);
                          }}
                          className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                            globalFilter === filter.value
                              ? 'bg-primary text-primary-foreground'
                              : 'text-foreground hover:bg-muted'
                          }`}
                        >
                          {filter.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
      
      {/* Search hint */}
      {!searchTerm && currentFilters.length === 0 && (
        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs text-muted-foreground">
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-xs font-mono bg-muted-foreground/10 rounded">
            Ctrl+/
          </kbd>
        </div>
      )}
    </div>
  );
};

export default GlobalSearchBar;