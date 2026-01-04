import React, { useState } from 'react';

const DeleteCountdownToast = ({
  isActive,
  countdown,
  onUndo,
  message = "Deleting class",
  error = "",
  className = ""
}) => {
  if (!isActive) return null;

  const [expanded, setExpanded] = useState(false);
  const line1 = error ? error : `${message} in ${countdown}s...`;
  const line2 = error ? 'You can undo or dismiss.' : 'Click undo to cancel';

  return (
    <div
      className={`fixed bottom-6 right-24 z-[60] animate-slide-up ${className}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div
        role="status"
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-4 rounded-lg border px-4 py-2.5 shadow-lg transition-all text-left cursor-pointer bg-blue-50/70 border-blue-200/70 backdrop-blur-sm hover:bg-blue-50/80 ${
          expanded ? 'max-w-[440px]' : 'max-w-[220px]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden />
          <div className="min-w-0">
            <p className={`text-sm font-semibold text-blue-900 ${expanded ? '' : 'truncate'}`}>{line1}</p>
            <p className={`text-xs text-blue-800/80 ${expanded ? '' : 'truncate'}`}>{line2}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUndo();
          }}
          className="shrink-0 rounded-md border border-blue-500 bg-white/90 px-3 py-1.5 text-sm font-semibold text-blue-600 transition hover:bg-white"
        >
          Undo
        </button>
      </div>
    </div>
  );
};

export default DeleteCountdownToast;
