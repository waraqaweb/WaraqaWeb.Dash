import React from 'react';

const HeroArt = ({ className = '' }: { className?: string }) => {
  return (
    <div className={className} aria-hidden="true" role="presentation">
      <svg viewBox="0 0 800 600" className="w-full h-full" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g1" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="g2" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.05" />
          </linearGradient>
          <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="30" />
          </filter>
        </defs>

        <g filter="url(#blur)">
          <path d="M120 420C40 340 20 220 140 160C260 100 360 160 460 140C560 120 700 40 740 160C780 280 680 360 600 420C520 480 200 500 120 420Z" fill="url(#g1)" />
          <path d="M60 260C120 200 220 160 320 180C420 200 520 260 600 300C680 340 720 440 640 500C560 560 320 540 220 500C120 460 0 320 60 260Z" fill="url(#g2)" />
        </g>

        <g opacity="0.09">
          <circle cx="640" cy="80" r="18" fill="#fff" />
          <circle cx="700" cy="140" r="10" fill="#fff" />
          <circle cx="580" cy="200" r="6" fill="#fff" />
        </g>

        <g opacity="0.06" transform="translate(40,420) rotate(-25)">
          <rect width="420" height="28" rx="14" fill="#fff" />
        </g>
      </svg>
    </div>
  );
};

export default HeroArt;
