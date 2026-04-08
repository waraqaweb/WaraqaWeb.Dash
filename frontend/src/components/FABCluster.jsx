import React, { useState, useEffect, useRef } from 'react';
import PrimaryButton from './ui/PrimaryButton';
import { Plus, MessageCircle, Search, Calendar } from 'lucide-react';

// Animated FAB cluster with pill labels, outside-click close and Escape handling
export default function FABCluster({ isAdmin, isTeacher, onCreate, onShare, onSeriesScanner, onMeetingAvailability }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev) => {
      if (!ref.current) return;
      if (!ref.current.contains(ev.target)) setOpen(false);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items = [
    (isTeacher || isAdmin) && onMeetingAvailability && {
      label: 'Manage Meeting Availability',
      icon: Calendar,
      onClick: onMeetingAvailability,
      size: 'sm',
    },
    (isTeacher || isAdmin) && {
      label: 'Share Availability',
      icon: MessageCircle,
      onClick: onShare,
      size: 'sm',
    },
    isAdmin && {
      label: 'New Class',
      icon: Plus,
      onClick: onCreate,
      size: 'lg',
    },
    isAdmin && {
      label: 'Series Scanner',
      icon: Search,
      onClick: onSeriesScanner,
      size: 'sm',
    },
  ].filter(Boolean);

  return (
    <div ref={ref} className="fixed bottom-8 right-6 z-50">
      <div className="flex flex-col items-end">
        {/* Scrim overlay when open on mobile */}
        {open && (
          <div className="fixed inset-0 bg-black/20 sm:hidden" onClick={() => setOpen(false)} />
        )}

        <div className={`flex flex-col items-end gap-2.5 mb-3 relative z-10 ${open ? '' : 'pointer-events-none'}`}>
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className={`flex items-center gap-3 transition-all duration-200 ${
                  open
                    ? 'opacity-100 translate-y-0'
                    : 'opacity-0 translate-y-2 pointer-events-none'
                }`}
                style={{ transitionDelay: open ? `${i * 40}ms` : '0ms' }}
              >
                <span className="whitespace-nowrap rounded-lg bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-lg border border-border">
                  {item.label}
                </span>
                <PrimaryButton
                  onClick={() => { setOpen(false); item.onClick && item.onClick(); }}
                  circle
                  size={item.size || 'sm'}
                  aria-label={item.label}
                >
                  <Icon className="h-4 w-4" />
                </PrimaryButton>
              </div>
            );
          })}
        </div>

        <PrimaryButton
          aria-expanded={open}
          onClick={() => setOpen((s) => !s)}
          circle
          className="relative z-10"
        >
          <Plus className={`h-5 w-5 transition-transform duration-200 ${open ? 'rotate-45' : ''}`} />
        </PrimaryButton>
      </div>
    </div>
  );
}
