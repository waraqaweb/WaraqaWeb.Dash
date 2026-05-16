import React from 'react';
import { Home, Calendar, FileText, Users, MoreHorizontal } from 'lucide-react';

/**
 * MobileBottomNav
 *
 * App-like bottom navigation strip, visible only on small screens (md:hidden).
 * Shows the most-used routes for the user's role + a "More" button that opens
 * the existing sidebar drawer for full navigation access.
 *
 * The strip is keyboard-friendly and uses theme tokens (bg-card, text-foreground,
 * text-primary) so it adapts to light/dark themes.
 */
const PRIMARY_ITEMS_BY_ROLE = {
  admin: [
    { id: 'home', label: 'Home', Icon: Home, path: '/dashboard/home' },
    { id: 'classes', label: 'Classes', Icon: Calendar, path: '/dashboard/classes' },
    { id: 'students', label: 'Students', Icon: Users, path: '/dashboard/students' },
    { id: 'invoices', label: 'Invoices', Icon: FileText, path: '/dashboard/invoices' },
  ],
  teacher: [
    { id: 'home', label: 'Home', Icon: Home, path: '/dashboard/home' },
    { id: 'classes', label: 'Classes', Icon: Calendar, path: '/dashboard/classes' },
    { id: 'students', label: 'Students', Icon: Users, path: '/dashboard/students' },
    { id: 'salary', label: 'Salary', Icon: FileText, path: '/teacher/salary' },
  ],
  guardian: [
    { id: 'home', label: 'Home', Icon: Home, path: '/dashboard/home' },
    { id: 'classes', label: 'Classes', Icon: Calendar, path: '/dashboard/classes' },
    { id: 'students', label: 'Students', Icon: Users, path: '/dashboard/students' },
    { id: 'invoices', label: 'Invoices', Icon: FileText, path: '/dashboard/invoices' },
  ],
  student: [
    { id: 'home', label: 'Home', Icon: Home, path: '/dashboard/home' },
    { id: 'classes', label: 'Classes', Icon: Calendar, path: '/dashboard/classes' },
    { id: 'students', label: 'Students', Icon: Users, path: '/dashboard/students' },
  ],
};

const MobileBottomNav = ({ role, currentPath, onNavigate, onOpenMore }) => {
  const items = PRIMARY_ITEMS_BY_ROLE[role] || PRIMARY_ITEMS_BY_ROLE.guardian;

  const isActive = (path) => {
    if (!currentPath) return false;
    if (currentPath === path) return true;
    // treat /dashboard and /dashboard/home as the same root
    if (path === '/dashboard/home' && (currentPath === '/dashboard' || currentPath.startsWith('/dashboard/home'))) {
      return true;
    }
    return currentPath.startsWith(`${path}/`);
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur border-t border-border shadow-[0_-2px_8px_rgba(0,0,0,0.04)] pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary navigation"
    >
      <ul className="flex items-stretch justify-around">
        {items.map(({ id, label, Icon, path }) => {
          const active = isActive(path);
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                onClick={() => onNavigate?.(path)}
                className={`w-full flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[11px] font-medium transition-colors ${
                  active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className={`h-5 w-5 ${active ? '' : 'opacity-80'}`} />
                <span className="truncate max-w-full">{label}</span>
              </button>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            type="button"
            onClick={onOpenMore}
            className="w-full flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            aria-label="More navigation options"
          >
            <MoreHorizontal className="h-5 w-5 opacity-80" />
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default MobileBottomNav;
