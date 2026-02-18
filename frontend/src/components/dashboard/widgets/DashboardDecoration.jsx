import React from 'react';

const DEFAULT_ITEMS = {
  crescents: { count: 2, scale: 1 },
  stars: { count: 4, scale: 1 },
  dots: { count: 6, scale: 1 },
  lanterns: { count: 3, scale: 0.8 },
};

const LANTERN_PALETTE = [
  { metal: '#B87333', metalDark: '#8A4B1F', glow: '#FFD54F', glowStroke: '#E0A24B' },
  { metal: '#D9773C', metalDark: '#9A4E1E', glow: '#FFF2B5', glowStroke: '#E9C46A' },
  { metal: '#8B6F5A', metalDark: '#5F4B3A', glow: '#FDE68A', glowStroke: '#C8A25A' },
  { metal: '#7E5F3B', metalDark: '#4F3821', glow: '#FFE08A', glowStroke: '#C6953C' },
];

const pickPalette = (idx) => LANTERN_PALETTE[idx % LANTERN_PALETTE.length];

const LanternVariantA = ({ palette }) => (
  <>
    <path d="M36,-18 C36,-28 44,-36 54,-36 C64,-36 72,-28 72,-18" fill="none" stroke={palette.metal} strokeWidth="3" />
    <rect x="46" y="-18" width="16" height="8" rx="3" fill={palette.metal} />
    <path d="M20,0 L36,-14 L72,-14 L88,0 Z" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <rect x="20" y="0" width="68" height="86" rx="8" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <rect x="28" y="10" width="52" height="62" rx="10" fill={palette.glow} stroke={palette.glowStroke} strokeWidth="1" />
    <path d="M20,86 L54,110 L88,86" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <path d="M32,72 L32,30 A18,18 0 0,1 76,30 L76,72" fill="none" stroke={palette.metalDark} strokeWidth="1.5" opacity="0.6" />
    <circle cx="54" cy="92" r="4" fill={palette.glowStroke} />
  </>
);

const LanternVariantB = ({ palette }) => (
  <>
    <path d="M54,-36 L64,-22 L44,-22 Z" fill={palette.metal} />
    <rect x="44" y="-22" width="20" height="8" rx="2" fill={palette.metal} />
    <path d="M26,0 L54,-18 L82,0 Z" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <rect x="26" y="0" width="56" height="78" rx="6" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <rect x="34" y="12" width="40" height="54" rx="8" fill={palette.glow} stroke={palette.glowStroke} strokeWidth="1" />
    <path d="M26,78 L54,102 L82,78" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <path d="M40,66 L40,26 A14,14 0 0,1 68,26 L68,66" fill="none" stroke={palette.metalDark} strokeWidth="1.4" opacity="0.6" />
  </>
);

const LanternVariantC = ({ palette }) => (
  <>
    <circle cx="54" cy="-24" r="10" fill="none" stroke={palette.metal} strokeWidth="3" />
    <rect x="46" y="-16" width="16" height="8" rx="2" fill={palette.metal} />
    <path d="M22,0 L54,-14 L86,0 Z" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <rect x="22" y="0" width="64" height="70" rx="12" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <rect x="32" y="10" width="44" height="50" rx="12" fill={palette.glow} stroke={palette.glowStroke} strokeWidth="1" />
    <path d="M22,70 L54,96 L86,70" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <circle cx="54" cy="82" r="3.5" fill={palette.glowStroke} />
  </>
);

const LanternVariantD = ({ palette }) => (
  <>
    <path d="M54,-38 C48,-38 44,-32 44,-26 C44,-20 48,-16 54,-16 C60,-16 64,-20 64,-26 C64,-32 60,-38 54,-38" fill="none" stroke={palette.metal} strokeWidth="3" />
    <rect x="46" y="-16" width="16" height="8" rx="2" fill={palette.metal} />
    <path d="M24,0 L54,-20 L84,0 Z" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <rect x="24" y="0" width="60" height="90" rx="6" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
    <rect x="32" y="12" width="44" height="64" rx="8" fill={palette.glow} stroke={palette.glowStroke} strokeWidth="1" />
    <path d="M24,90 L54,116 L84,90" fill={palette.metal} stroke={palette.metalDark} strokeWidth="2" />
  </>
);

const renderLanternVariant = (variantId, palette) => {
  switch (variantId) {
    case 1:
      return <LanternVariantB palette={palette} />;
    case 2:
      return <LanternVariantC palette={palette} />;
    case 3:
      return <LanternVariantD palette={palette} />;
    case 0:
    default:
      return <LanternVariantA palette={palette} />;
  }
};

const buildPositions = (count, width) => {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0));
  if (safeCount === 0) return [];
  const gap = width / (safeCount + 1);
  return Array.from({ length: safeCount }, (_, i) => gap * (i + 1));
};

const jitter = (idx, min, max, seed = 7) => {
  const x = Math.sin((idx + 1) * seed) * 10000;
  const frac = x - Math.floor(x);
  return min + (max - min) * frac;
};

const DashboardDecoration = ({ enabled, offsetX = 0, offsetY = 0, hoverActive = false, items }) => {
  if (!enabled) return null;

  const mergedItems = {
    crescents: { ...DEFAULT_ITEMS.crescents, ...(items?.crescents || {}) },
    stars: { ...DEFAULT_ITEMS.stars, ...(items?.stars || {}) },
    dots: { ...DEFAULT_ITEMS.dots, ...(items?.dots || {}) },
    lanterns: { ...DEFAULT_ITEMS.lanterns, ...(items?.lanterns || {}) },
  };

  const width = 1200;
  const crescentXs = buildPositions(mergedItems.crescents.count, width);
  const starXs = buildPositions(mergedItems.stars.count, width);
  const dotXs = buildPositions(mergedItems.dots.count, width);
  const lanternXs = buildPositions(mergedItems.lanterns.count, width);

  const crescentBaseY = 150;
  const starBaseY = 84;
  const dotBaseY = 44;
  const lanternBaseY = 70;

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-40 w-full"
      style={{ transform: `translate(${Number(offsetX) || 0}px, ${Number(offsetY) || 0}px)` }}
      aria-hidden="true"
    >
      <div className="mx-auto w-full max-w-7xl">
        <svg viewBox="0 0 1200 250" xmlns="http://www.w3.org/2000/svg" className="h-[180px] w-full sm:h-[220px]">
          <defs>
            <radialGradient id="lanternGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFF9C4" />
              <stop offset="100%" stopColor="#FFD54F" />
            </radialGradient>

            <linearGradient id="metalTeal" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#004D40" />
              <stop offset="100%" stopColor="#002420" />
            </linearGradient>

            <linearGradient id="gold" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFD700" />
              <stop offset="100%" stopColor="#B8860B" />
            </linearGradient>
          </defs>

          <g fill="#FFD700" opacity="0.8">
            {crescentXs.map((x, idx) => {
              const ropeLen = jitter(idx, 18, 46, 2.1);
              const ropeBend = jitter(idx, -8, 8, 4.7);
              return (
                <g key={`crescent-${idx}`} transform={`translate(${x}, ${crescentBaseY + jitter(idx, -28, 24, 5.3)})`}>
                  <g
                    className="decor-sway"
                    style={{
                      '--sway-delay': `${jitter(idx, 0, 1.2, 1.9).toFixed(2)}s`,
                      '--sway-duration': `${jitter(idx, 5.2, 9.2, 6.1).toFixed(2)}s`,
                      '--sway-angle': `${jitter(idx, 0.6, 1.6, 3.3).toFixed(2)}deg`,
                    }}
                  >
                    <path d={`M0,${-ropeLen} Q ${ropeBend},${-ropeLen / 2} 0,0`} stroke="#E0A24B" strokeWidth="1" fill="none" opacity="0.7" />
                    <g transform={`scale(${Math.max(0.6, Math.min(1.4, Number(mergedItems.crescents.scale) || 1))})`}>
                      <path d="M0,0 a24,24 0 1,0 0,-48 a18,18 0 1,1 0,48 Z" fill="url(#gold)" />
                    </g>
                  </g>
                </g>
              );
            })}

            {starXs.map((x, idx) => {
              const ropeLen = jitter(idx, 14, 38, 3.4);
              const ropeBend = jitter(idx, -8, 8, 5.9);
              return (
                <g key={`star-${idx}`} transform={`translate(${x}, ${starBaseY + jitter(idx, -26, 22, 8.7)})`}>
                  <g
                    className="decor-sway"
                    style={{
                      '--sway-delay': `${jitter(idx, 0, 1.4, 2.7).toFixed(2)}s`,
                      '--sway-duration': `${jitter(idx, 4.6, 8.6, 5.4).toFixed(2)}s`,
                      '--sway-angle': `${jitter(idx, 0.6, 1.6, 4.1).toFixed(2)}deg`,
                    }}
                  >
                    <path d={`M0,${-ropeLen} Q ${ropeBend},${-ropeLen / 2} 0,0`} stroke="#FFD18A" strokeWidth="1" fill="none" opacity="0.7" />
                    <g transform={`scale(${mergedItems.stars.scale})`}>
                      <polygon points="0,0 4,10 14,10 6,16 9,26 0,20 -9,26 -6,16 -14,10 -4,10" />
                    </g>
                  </g>
                </g>
              );
            })}

            {dotXs.map((x, idx) => {
              const ropeLen = jitter(idx, 10, 30, 4.6);
              const ropeBend = jitter(idx, -6, 6, 7.1);
              return (
                <g key={`dot-${idx}`} transform={`translate(${x}, ${dotBaseY + jitter(idx, -22, 18, 6.1)})`}>
                  <g
                    className="decor-sway"
                    style={{
                      '--sway-delay': `${jitter(idx, 0, 1.1, 2.2).toFixed(2)}s`,
                      '--sway-duration': `${jitter(idx, 4.8, 9.4, 4.9).toFixed(2)}s`,
                      '--sway-angle': `${jitter(idx, 0.6, 1.4, 6.7).toFixed(2)}deg`,
                    }}
                  >
                    <path d={`M0,${-ropeLen} Q ${ropeBend},${-ropeLen / 2} 0,0`} stroke="#FFD18A" strokeWidth="1" fill="none" opacity="0.65" />
                    <g transform={`scale(${mergedItems.dots.scale})`}>
                      <circle cx="0" cy="0" r="3" fill="url(#gold)" />
                    </g>
                  </g>
                </g>
              );
            })}
          </g>

          {lanternXs.map((x, idx) => (
            <g key={`lantern-${idx}`} transform={`translate(${x}, ${lanternBaseY + jitter(idx, -20, 28, 9.2)})`}>
              <g
                className="decor-sway"
                transform="translate(-54, 0)"
                style={{
                  '--sway-delay': `${jitter(idx, 0, 1.6, 3.9).toFixed(2)}s`,
                  '--sway-duration': `${jitter(idx, 3.4, 6.4, 2.7).toFixed(2)}s`,
                  '--sway-angle': `${jitter(idx, 0.8, 2.2, 8.1).toFixed(2)}deg`,
                }}
              >
                <path
                  d={`M54,${-jitter(idx, 24, 64, 7.5)} Q ${54 + jitter(idx, -10, 10, 2.8)},${-jitter(idx, 12, 36, 7.6)} 54,0`}
                  stroke="#8A4B1F"
                  strokeWidth="1.2"
                  fill="none"
                  opacity="0.75"
                />
                <g transform={`scale(${mergedItems.lanterns.scale})`}>
                  {renderLanternVariant(idx % 4, pickPalette(idx))}
                </g>
              </g>
            </g>
          ))}
        </svg>
      </div>
      <style>{`
        .decor-float {
          animation: decorFloat 26s ease-in-out infinite;
        }
        .decor-wave {
          animation: decorWave 12s ease-in-out infinite;
        }
        .decor-sway {
          transform-box: fill-box;
          transform-origin: 50% 0%;
          animation: lanternSway var(--sway-duration, 2.8s) ease-in-out infinite;
          animation-delay: var(--sway-delay, 0s);
          animation-fill-mode: both;
        }
        @keyframes decorFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(6px); }
        }
        @keyframes decorWave {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(4px); }
        }
        @keyframes lanternSway {
          0% { transform: rotate(0deg); }
          20% { transform: rotate(calc(var(--sway-angle, 1.5deg) * -0.6)); }
          50% { transform: rotate(var(--sway-angle, 1.5deg)); }
          80% { transform: rotate(calc(var(--sway-angle, 1.5deg) * -0.6)); }
          100% { transform: rotate(0deg); }
        }
      `}</style>
    </div>
  );
};

export default DashboardDecoration;
