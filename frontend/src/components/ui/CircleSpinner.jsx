import React from 'react';

/**
 * Lightweight circle spinner for inline loading states.
 * Color comes from the current text color (defaults to `text-primary`),
 * so the spinner inherits the surrounding theme. Pass `className` to override.
 */
const CircleSpinner = ({ size = 'md', className = '' }) => {
  const sizeMap = {
    xs: 'h-3.5 w-3.5 border-2',
    sm: 'h-5 w-5 border-2',
    md: 'h-8 w-8 border-2',
    lg: 'h-12 w-12 border-[3px]',
  };
  return (
    <div
      className={`inline-block animate-spin rounded-full border-current border-t-transparent text-primary ${sizeMap[size] || sizeMap.md} ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
};

export default CircleSpinner;
