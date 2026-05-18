/**
 * Loading indicator.
 *
 * - Inline usage (`<LoadingSpinner />`) renders the lightweight `CircleSpinner`
 *   so list/section loaders feel fast and aren't dominated by a giant SVG.
 * - `fullScreen` usage renders the branded "Waraqa" loader on a translucent
 *   backdrop — keep this for app-level transitions only.
 */

import React from 'react';
import CircleSpinner from './CircleSpinner';

const LoadingSpinner = ({ size = 'md', text = 'Loading...', fullScreen = false, compact = false }) => {
  if (!fullScreen) {
    const inlineSize = size === 'sm' ? 'sm' : size === 'lg' || size === 'xl' ? 'lg' : 'md';
    // Reserve a stable vertical area so the spinner doesn't visually "jump"
    // between renders (e.g. Suspense fallback → page-level loading state).
    // Callers that explicitly want a tight inline indicator can opt out with
    // `compact`.
    const wrapperClasses = compact
      ? 'flex flex-col items-center justify-center gap-3 p-4'
      : 'flex flex-col items-center justify-center gap-3 px-4 py-10 min-h-[320px]';
    return (
      <div className={wrapperClasses}>
        <CircleSpinner size={inlineSize} />
        {text && <span className="text-sm text-muted-foreground font-medium">{text}</span>}
      </div>
    );
  }

  const sizeClasses = {
    sm: 'max-w-[180px]',
    md: 'max-w-[260px]',
    lg: 'max-w-[340px]',
    xl: 'max-w-[420px]'
  };

  const spinner = (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center gap-3 w-full">
        <div className={`w-full ${sizeClasses[size]}`} aria-hidden="true">
          <svg
            viewBox="0 0 800 300"
            className="waraqa-loader"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: '100%', height: 'auto', transform: 'skewX(-4deg)' }}
          >
            <defs>
              <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Merienda:wght@700&display=swap');

                .writing-path {
                  fill: none;
                  stroke: #2C736C;
                  stroke-width: 2.5;
                  stroke-linecap: round;
                  stroke-linejoin: round;
                  stroke-dasharray: 1200;
                  stroke-dashoffset: 1200;
                  animation: writeLetter 5s ease-in-out infinite;
                }

                .solid-text {
                  font-family: 'Merienda', cursive;
                  font-size: 120px;
                  font-weight: 700;
                  fill: #2C736C;
                  opacity: 0;
                  animation: fadeInSolid 5s infinite;
                }

                .orbit-group {
                  transform-origin: center;
                  animation: rotateOrbit 5s linear infinite;
                }

                @keyframes writeLetter {
                  0% { stroke-dashoffset: 1200; opacity: 0; }
                  10% { opacity: 1; }
                  70% { stroke-dashoffset: 0; opacity: 1; }
                  90% { opacity: 1; }
                  100% { opacity: 0; stroke-dashoffset: 0; }
                }

                @keyframes fadeInSolid {
                  0%, 50% { opacity: 0; }
                  70%, 90% { opacity: 1; }
                  100% { opacity: 0; }
                }

                @keyframes rotateOrbit {
                  from { transform: rotate(0deg); }
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </defs>

            <text
              x="50%"
              y="180"
              textAnchor="middle"
              fontFamily="'Merienda', cursive"
              fontSize="120"
              fontWeight="700"
              fill="#2C736C"
              opacity="0.03"
            >
              Waraqa
            </text>

            <g transform="translate(150, 180)">
              <text x="0" y="0" className="writing-path" fontFamily="'Merienda', cursive" fontSize="120" fontWeight="700">
                Waraqa
              </text>
            </g>

            <g transform="translate(150, 180)">
              <text x="0" y="0" className="solid-text">
                Waraqa
              </text>
            </g>

            <g className="orbit-group">
              <circle cx="650" cy="150" r="12" fill="#2C736C">
                <animate attributeName="r" values="10;15;10" dur="1.5s" repeatCount="indefinite" />
              </circle>
              <circle cx="635" cy="110" r="6" fill="#4AA89F" opacity="0.6" />
              <circle cx="642" cy="190" r="4" fill="#2C736C" opacity="0.4" />
            </g>
          </svg>
        </div>
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
