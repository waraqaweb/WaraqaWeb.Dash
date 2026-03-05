import React from 'react';

const DeleteCountdownToast = ({
  isActive,
  countdown,
  onUndo,
  message = "Deleting class",
  error = "",
  preDelaySeconds = 0,
  undoSeconds = 0,
  phase = 'pre-delete',
  showUndo = true,
  className = ""
}) => {
  if (!isActive) return null;

  const undoWindow = Number.isFinite(undoSeconds) ? Math.max(0, undoSeconds) : 0;
  const preDelay = Number.isFinite(preDelaySeconds) ? Math.max(0, preDelaySeconds) : 0;
  const preCountdown = Math.max(0, countdown - undoWindow);
  const inPreDelay = preDelay > 0 && preCountdown > 0;
  const isPostDelete = phase === 'post-delete';
  const line1 = error
    ? error
    : isPostDelete
      ? message
      : inPreDelay
        ? `${message} in ${preCountdown}s...`
        : countdown > 0
          ? `${message} in ${countdown}s...`
          : `${message}...`;
  const line2 = error
    ? 'Click undo to cancel.'
    : isPostDelete && countdown > 0
      ? `Undo available for ${countdown}s.`
      : '';
  const shouldShowUndo = showUndo && (isPostDelete || phase === 'pre-delete' || Boolean(error));

  return (
    <div
      className={`fixed bottom-6 right-24 z-[60] animate-slide-up ${className}`}
    >
      <div
        role="status"
        className="flex w-[480px] max-w-[calc(100vw-3rem)] items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 shadow-lg backdrop-blur-sm"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-900 whitespace-normal break-words">{line1}</p>
            {line2 && <p className="text-xs text-emerald-800/80 whitespace-normal break-words">{line2}</p>}
          </div>
        </div>
        {shouldShowUndo && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUndo();
            }}
            className="shrink-0 rounded-md border border-emerald-500 bg-white/90 px-2 py-0.5 text-xs font-semibold text-emerald-700 leading-tight transition hover:bg-white"
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
};

export default DeleteCountdownToast;
