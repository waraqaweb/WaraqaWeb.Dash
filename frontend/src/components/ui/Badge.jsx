import React from 'react';

// Badge primitive with friendly tones
export default function Badge({ className = '', tone = 'neutral', children, pill = true, ...props }) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    info: 'bg-sky-50 text-sky-700 border-sky-100',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    danger: 'bg-rose-50 text-rose-700 border-rose-100',
    brand: 'bg-blue-50 text-blue-700 border-blue-100',
  };
  const shape = pill ? 'rounded-full' : 'rounded-md';
  return (
    <span className={`inline-flex items-center gap-1.5 border px-3 py-1 text-xs font-medium ${shape} ${tones[tone] || tones.neutral} ${className}`} {...props}>
      {children}
    </span>
  );
}
