import React from 'react';

/**
 * Lightweight circle spinner for inline loading states
 * (used in class list and invoice list instead of the branded Waraqa loader)
 */
const CircleSpinner = ({ size = 'md', className = '' }) => {
  const sizeMap = { sm: 'h-5 w-5 border-2', md: 'h-8 w-8 border-2', lg: 'h-12 w-12 border-[3px]' };
  return (
    <div
      className={`animate-spin rounded-full border-slate-200 border-t-[#2C736C] ${sizeMap[size] || sizeMap.md} ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
};

export default CircleSpinner;
