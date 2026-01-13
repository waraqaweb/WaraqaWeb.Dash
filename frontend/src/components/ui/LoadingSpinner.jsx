/**
 * Loading Spinner Component
 * 
 * A reusable loading spinner for the application
 */

import React from 'react';

const LoadingSpinner = ({ size = 'md', text = 'Loading...', fullScreen = false }) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
    xl: 'w-16 h-16'
  };

  const spinner = (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center gap-3">
        <div
          aria-hidden="true"
          className={`${sizeClasses[size]} border-4 border-border border-t-primary rounded-full animate-spin`}
        />
        {text && <span className="text-sm text-muted-foreground font-medium">{text}</span>}
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
        {spinner}
      </div>
    );
  }

  return spinner;
};

export default LoadingSpinner;

