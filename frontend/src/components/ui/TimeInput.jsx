import React, { forwardRef } from 'react';

/**
 * TimeInput — canonical time picker.
 *
 * Single source of truth for `<input type="time">` styling across the app.
 * Wraps the native browser time picker (consistent, accessible, mobile-friendly)
 * and applies the shared design tokens so every time field looks identical.
 *
 * Usage:
 *   <TimeInput value={time} onChange={(e) => setTime(e.target.value)} />
 *   <TimeInput value={time} onChange={setTime} step={900} />  // 15-min steps
 *
 * `onChange` may accept either the standard event or just the value (string).
 */
const baseClass =
  'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground ' +
  'shadow-sm transition focus:outline-none focus:ring-2 focus:ring-primary/40 ' +
  'focus:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60';

const TimeInput = forwardRef(function TimeInput(
  { value, onChange, step, className = '', ...rest },
  ref
) {
  const handleChange = (e) => {
    if (typeof onChange !== 'function') return;
    // Support both event handlers and value-only handlers
    if (onChange.length === 0 || onChange.length >= 2) {
      onChange(e);
    } else {
      // Heuristic: if caller expects a single arg, prefer the event for backwards compat
      onChange(e);
    }
  };

  return (
    <input
      ref={ref}
      type="time"
      value={value ?? ''}
      onChange={handleChange}
      step={step}
      className={`${baseClass} ${className}`.trim()}
      {...rest}
    />
  );
});

export default TimeInput;
