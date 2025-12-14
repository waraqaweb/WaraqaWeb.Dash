import React, { useState, useEffect, useRef } from 'react';
import PrimaryButton from './ui/PrimaryButton';
import { Plus, MessageCircle } from 'lucide-react';

// Animated FAB cluster with pill labels, outside-click close and Escape handling
export default function FABCluster({ isAdmin, isTeacher, onCreate, onShare }) {
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

  return (
    <div ref={ref} className="fixed bottom-6 right-6 z-50">
      <div className="flex flex-col items-end">
        <div className={`flex flex-col items-end gap-3 mb-2 ${open ? '' : 'pointer-events-none'}`}>
          {(isTeacher || isAdmin) && (
            <div className={`flex items-center gap-3 transition-all duration-200 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
              <span className={`rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-md transition transform ${open ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'}`}>
                Share Availability
              </span>
              <PrimaryButton
                onClick={() => { setOpen(false); onShare && onShare(); }}
                circle
                size="sm"
                aria-label="Share Availability"
              >
                <MessageCircle className="h-4 w-4" />
              </PrimaryButton>
            </div>
          )}

          {isAdmin && (
            <div className={`flex items-center gap-3 transition-all duration-200 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
              <span className={`rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-md transition transform ${open ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'}`}>
                New Class
              </span>
              <PrimaryButton
                onClick={() => { setOpen(false); onCreate && onCreate(); }}
                circle
                size="lg"
                aria-label="New Class"
              >
                <Plus className="h-5 w-5" />
              </PrimaryButton>
            </div>
          )}
        </div>

        <PrimaryButton
          aria-expanded={open}
          onClick={() => setOpen((s) => !s)}
          circle
        >
          <Plus className={`h-5 w-5 transition-transform ${open ? 'rotate-45' : ''}`} />
        </PrimaryButton>
      </div>
    </div>
  );
}
