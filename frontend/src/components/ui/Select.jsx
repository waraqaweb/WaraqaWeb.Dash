import React from 'react';

export default function Select({ label, hint, error, className = '', size = 'md', children, ...props }) {
  const sizeCls = size === 'sm' ? 'h-9 text-sm px-3' : size === 'lg' ? 'h-12 text-base px-4' : 'h-10 text-sm px-3';
  return (
    <label className="inline-flex w-full flex-col gap-1">
      {label && <span className="text-xs font-medium text-slate-600">{label}</span>}
      <select
        className={`w-full rounded-xl border bg-white text-slate-800 shadow-inner outline-none transition ${sizeCls} ${
          error ? 'border-rose-300 focus:ring-rose-200' : 'border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-200'
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {hint && !error && <span className="text-[11px] text-slate-500">{hint}</span>}
      {error && <span className="text-[11px] text-rose-600">{error}</span>}
    </label>
  );
}
