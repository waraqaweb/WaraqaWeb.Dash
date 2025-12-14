import React from 'react';

// Modern, consistent action button with variants and optional circular style.
export default function PrimaryButton({
  children,
  className = '',
  circle = false,
  size = 'md',
  variant = 'primary', // 'primary' | 'subtle' | 'danger'
  ...props
}) {
  const variantClasses = (() => {
    switch (variant) {
      case 'danger':
        return circle
          ? 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-200'
          : 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-200';
      case 'subtle':
        return circle
          ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-200'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 focus:ring-slate-200';
      case 'primary':
      default:
        return circle
          ? 'bg-[#2C736C] text-white hover:bg-[#245b56] focus:ring-[#2C736C]'
          : 'bg-[#2C736C] text-white hover:bg-[#245b56] focus:ring-[#2C736C]';
    }
  })();

  const base = circle
    ? 'inline-flex items-center justify-center rounded-full shadow-lg transition transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2'
    : 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2';

  const sizeClass = circle
    ? size === 'sm'
      ? 'w-10 h-10'
      : size === 'lg'
        ? 'w-14 h-14'
        : 'w-12 h-12'
    : size === 'sm'
      ? 'text-sm px-3 py-1.5'
      : size === 'lg'
        ? 'text-base px-5 py-2.5'
        : 'text-sm';

  return (
    <button
      className={`${base} ${variantClasses} ${sizeClass} ${className || ''}`}
      {...props}
    >
      {children}
    </button>
  );
}
