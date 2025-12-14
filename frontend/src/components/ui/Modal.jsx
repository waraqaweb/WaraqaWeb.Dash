import React, { useEffect } from 'react';

// Accessible modal primitive (non-portal for simplicity)
export default function Modal({ open, onClose, title, children, size = 'lg', footer, dismissLabel = 'Close' }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose?.(); };
    if (open) window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  if (!open) return null;
  const width = size === 'sm' ? 'max-w-sm' : size === 'xl' ? 'max-w-5xl' : 'max-w-2xl';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-slate-950/60 backdrop-blur-sm">
      <div className={`w-full ${width} rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden flex flex-col`}>        
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div className="flex-1">
            {title && <h2 className="text-xl font-semibold text-slate-900">{title}</h2>}
          </div>
          <button
            onClick={() => onClose?.()}
            aria-label={dismissLabel}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400"
          >
            <span className="text-lg">×</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {children}
        </div>
        {footer && (
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
