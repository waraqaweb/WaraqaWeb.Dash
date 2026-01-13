/**
 * Sidebar Component
 * 
 * Navigation sidebar with role-based menu items
 * Responsive design with mobile support
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { 
  Home, 
  Users, 
  GraduationCap, 
  UserCheck, 
  Calendar, 
  FileText, 
  BarChart3, 
  LogOut,
  Shield,
  DollarSign,
  Clock,
  BookOpen,
  X
} from 'lucide-react';

const Sidebar = ({ isOpen, onClose, activeView, onOpenProfileModal }) => {
  const { user, logout, isAdmin } = useAuth();
  const [branding, setBranding] = useState({ logo: null, title: 'Waraqa', slogan: '' });

  // Define navigation items based on user role
  const getNavigationItems = () => {
    // Ordered navigation as requested:
    // Dashboard, Classes, Teachers, Guardians, Students, Vacations, Invoices, Salaries, Feedbacks
    const ordered = [
      { id: 'home', label: 'Dashboard', icon: Home, roles: ['admin', 'teacher', 'guardian', 'student'], link: '/dashboard/home' },
      { id: 'classes', label: 'Classes', icon: Calendar, roles: ['admin', 'teacher', 'guardian', 'student'], link: '/dashboard/classes' },
      { id: 'teachers', label: 'Teachers', icon: GraduationCap, roles: ['admin'], link: '/dashboard/teachers' },
      { id: 'guardians', label: 'Guardians', icon: UserCheck, roles: ['admin'], link: '/dashboard/guardians' },
      { id: 'students', label: 'Students', icon: Users, roles: ['admin', 'teacher', 'guardian', 'student'], link: '/dashboard/students' },
      { id: 'invoices', label: 'Invoices', icon: FileText, roles: ['admin', 'guardian'], link: '/dashboard/invoices' },
      { id: 'salaries', label: 'Salaries', icon: DollarSign, roles: ['admin', 'teacher'], link: '/dashboard/salaries' },
      { id: 'availability', label: isAdmin() ? 'Meetings' : 'My Availability', icon: Clock, roles: ['admin', 'teacher'], link: '/dashboard/availability' },
      { id: 'vacation-management', label: 'Vacations', icon: Clock, roles: ['admin', 'teacher', 'guardian', 'student'], link: '/dashboard/vacation-management' },
      { id: 'feedbacks', label: 'Feedbacks', icon: BarChart3, roles: ['admin'], link: '/dashboard/feedbacks' },
      { id: 'library', label: 'Library', icon: BookOpen, roles: ['admin', 'teacher', 'guardian', 'student'], link: '/dashboard/library' },
    ];

    // Filter by current user's role
    const filtered = ordered.filter(item => item.roles.includes(user?.role));
    return filtered;
  };

  const navigationItems = getNavigationItems();
  const navigate = useNavigate();
  const { socket } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const fetchCount = async () => {
      try {
        const res = await api.get('/feedbacks/count/unread');
        if (mounted && res.data?.success) setUnreadCount(res.data.count || 0);
      } catch (err) {
        console.error('Failed to fetch unread count', err);
      }
    };
    if (isAdmin()) fetchCount();

    // fetch branding (public)
    (async () => {
      try {
        const res = await api.get('/settings/branding');
        if (mounted && res.data && res.data.branding) {
          setBranding(res.data.branding);
        }
      } catch (e) {
        // ignore branding load errors
      }
    })();

    return () => { mounted = false; };
  }, [isAdmin]);

  // Listen for branding updates via socket and refresh branding when changed
  useEffect(() => {
    if (!socket) return;

    const handleBrandingUpdated = async (payload) => {
      try {
        // If payload contains branding, prefer it; otherwise re-fetch public branding
        if (payload && payload.branding) {
          setBranding(payload.branding);
          return;
        }

        const res = await api.get('/settings/branding');
        if (res.data && res.data.branding) setBranding(res.data.branding);
      } catch (e) {
        // ignore
      }
    };

    socket.on('branding:updated', handleBrandingUpdated);

    return () => {
      socket.off('branding:updated', handleBrandingUpdated);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    socket.on('feedback:new', () => {
      setUnreadCount(c => c + 1);
    });
    socket.on('feedback:read', () => {
      // refresh count
      (async () => {
        try { const res = await api.get('/feedbacks/count/unread'); if (res.data?.success) setUnreadCount(res.data.count||0); } catch(e){}
      })();
    });
    socket.on('feedback:archived', () => {
      (async () => {
        try { const res = await api.get('/feedbacks/count/unread'); if (res.data?.success) setUnreadCount(res.data.count||0); } catch(e){}
      })();
    });
    return () => { socket.off('feedback:new'); };
  }, [socket]);

  const handleLogout = async () => {
    await logout();
  };

  return (
    <>
      {/* Sidebar */}
      <div
        className={`
        fixed md:relative inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}
        style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-foreground)' }}
      >
        <div className="flex flex-col h-full">
          {/* Logo/Header */}
          <div className="flex items-center justify-between h-16 px-4 bg-sidebar border-b border-sidebar-border">
            <div className="flex items-center space-x-2">
                {/* Branding: logo (if provided) or fallback icon. Support cloudinary url or base64 dataUri fallback. */}
                {branding?.logo?.url ? (
                  <img src={branding.logo.url} alt="logo" className="h-12 w-12 rounded-lg object-contain bg-white p-1" />
                ) : branding?.logo?.dataUri ? (
                  <img src={branding.logo.dataUri} alt="logo" className="h-12 w-12 rounded-lg object-contain bg-white p-1" />
                ) : (
                  <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center">
                    <GraduationCap className="h-5 w-5 text-primary-foreground" />
                  </div>
                )}
                <div className="text-left">
                  <h1 className="text-lg font-bold text-sidebar-foreground">{branding?.title || 'Waraqa'}</h1>
                  <p className="text-xs text-sidebar-foreground/70">{branding?.slogan || 'Dashboard'}</p>
                </div>
            </div>

            {/* Mobile-only close button (backdrop blocks header toggle while open) */}
            <button
              type="button"
              onClick={() => {
                if (onClose && typeof onClose === 'function') onClose();
              }}
              className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* User Info */}
          <div className="px-4 py-3 bg-sidebar-accent border-b border-sidebar-border">
            <div className="flex items-center space-x-3">
              <div className="h-10 w-10 rounded-full overflow-hidden bg-primary flex items-center justify-center">
                {user?.profilePicture ? (
                  <img src={user.profilePicture} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-medium text-primary-foreground">
                    {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user?.fullName || `${user?.firstName} ${user?.lastName}`}
                </p>
                <div className="flex items-center space-x-1">
                  {isAdmin() && (
                    <Shield className="h-3 w-3 text-black" strokeWidth={1.25} style={{ filter: 'drop-shadow(0 0 10px rgba(245,158,11,0.95)) drop-shadow(0 0 4px rgba(245,158,11,0.6))' }} />
                  )}
                  <p className="text-xs text-sidebar-foreground/70 capitalize">
                    {user?.role}
                  </p>
                </div>
              </div>
            </div>
            {/* View Profile moved to the bottom controls */}
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              // Check if current path matches this item's link
              const currentPath = window.location.pathname;
              const isActive = item.link ? currentPath === item.link : activeView === item.id;
              
              return (
                <button
                  key={item.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Sidebar item clicked:', item.id, item.link);
                    
                    // Always use link property for navigation
                    if (item.link) {
                      console.log('Navigating to:', item.link);
                      navigate(item.link);
                      if (onClose && typeof onClose === 'function') onClose(); // Close mobile sidebar
                    } else {
                      console.warn('No link defined for:', item.id);
                    }
                  }}
                  className={`
                    w-full flex min-h-[44px] items-center space-x-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-200 cursor-pointer
                    ${isActive 
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground' 
                      : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    }
                  `}
                  style={{ pointerEvents: 'auto' }}
                >
                  {/* Icon with black strokes + neon glow highlight (drop-shadow). Keeps icon lines black while adding a neon halo. */}
                  <span className="relative inline-flex items-center">
                    <Icon
                      className={`h-4 w-4 text-black`}
                      strokeWidth={1.25}
                      style={{
                        filter: isActive
                          ? 'drop-shadow(0 0 12px rgba(245,158,11,1)) drop-shadow(0 0 6px rgba(245,158,11,0.9))'
                          : 'drop-shadow(0 0 8px rgba(245,158,11,0.8)) drop-shadow(0 0 3px rgba(245,158,11,0.5))',
                        transition: 'filter 160ms ease'
                      }}
                    />
                  </span>
                  <span>{item.label}</span>
                  {item.id === 'feedbacks' && isAdmin() && unreadCount > 0 && (
                    <span
                      className="ml-auto text-xs bg-red-500 px-2 py-0.5 rounded-full"
                      style={{ color: '#ffffff', textShadow: '0 1px 0 rgba(0,0,0,0.28)', fontWeight: 600 }}
                    >
                      {unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Bottom controls: Settings, View Profile, Sign Out */}
          <div className="px-4 py-4 border-t border-sidebar-border space-y-2">
            <button
              onClick={() => { navigate('/dashboard/settings'); if (onClose) onClose(); }}
              className="w-full text-left text-sm px-2 py-2 rounded hover:bg-sidebar-accent"
            >
              Settings
            </button>

            <button
              onClick={() => {
                if (typeof onOpenProfileModal === 'function') onOpenProfileModal(); else navigate('/dashboard/profile');
                if (onClose) onClose();
              }}
              className="w-full text-left text-sm px-2 py-2 rounded hover:bg-sidebar-accent"
            >
              View Profile
            </button>

            <button
              onClick={handleLogout}
              className="w-full flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors duration-200"
            >
              <LogOut className={`h-4 w-4 text-black`} strokeWidth={1.25} style={{ filter: 'drop-shadow(0 0 10px rgba(245,158,11,0.95)) drop-shadow(0 0 4px rgba(245,158,11,0.6))' }} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
