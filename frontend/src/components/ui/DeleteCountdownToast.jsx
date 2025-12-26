import React from 'react';

const DeleteCountdownToast = ({ 
  isActive, 
  countdown, 
  onUndo, 
  message = "Deleting class",
  className = "" 
}) => {
  if (!isActive) return null;

  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] animate-slide-up ${className}`}>
      <div className="flex items-center gap-4 rounded-lg border border-blue-200 bg-blue-50 px-5 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-blue-900">
              {message} in {countdown}s...
            </p>
            <p className="text-xs text-blue-800/80">Click undo to cancel</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onUndo}
          className="rounded-md border border-blue-500 bg-white px-4 py-1.5 text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
        >
          Undo
        </button>
      </div>
    </div>
  );
};

export default DeleteCountdownToast;
