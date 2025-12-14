import React from 'react';

// Simple Card primitive for consistent surfaces
export default function Card({ as: Tag = 'div', className = '', children, padding = 'md', variant = 'elevated', ...props }) {
  const pad = padding === 'sm' ? 'p-3' : padding === 'lg' ? 'p-6' : 'p-4';
  const base = 'rounded-2xl bg-white border border-slate-200';
  const shadow = variant === 'flat' ? '' : 'shadow-sm';
  return (
    <Tag className={`${base} ${shadow} ${pad} ${className}`} {...props}>
      {children}
    </Tag>
  );
}
