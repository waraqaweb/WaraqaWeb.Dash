import Link from 'next/link';
import Image from 'next/image';
import type { CSSProperties } from 'react';
import type { HeroCTA, SiteSettings, MarketingCourse, LandingSection } from '../lib/marketingClient';
import HeroArt from './HeroArt';
import { dashboardHref, resolveWaraqaHref } from '@/lib/links';

type Props = {
  siteSettings: SiteSettings;
  courses: MarketingCourse[];
  section?: LandingSection;
};

type HeroAdvancedSettings = NonNullable<LandingSection['settings']> & {
  backgroundMedia?: string;
  media?: string;
  mediaMode?: 'background' | 'card';
  backgroundOpacity?: number | string;
  boxMedia?: string;
  boxOpacity?: number | string;
  textVariant?: string;
  kickerColor?: string;
  headlineColor?: string;
  subheadingColor?: string;
  heroMaxWidth?: number | string;
  verticalPadding?: number | string;
  gridGap?: number | string;
  contentWidthRatio?: number | string;
  kickerSize?: number | string;
  headlineSize?: number | string;
  subheadingSize?: number | string;
  headingSpacing?: number | string;
  subheadingSpacing?: number | string;
  ctaSpacing?: number | string;
  contentAlignment?: string;
  fontFamily?: string;
};

const Hero = ({ siteSettings, courses, section }: Props) => {
  const heroDefaults = siteSettings.hero || {};
  const overrides = section?.settings || {};
  const heroCopySource = overrides.heroCopySource === 'custom' ? 'custom' : 'site';
  const copyOverridesEnabled = heroCopySource === 'custom';
  const normalizedCtas = copyOverridesEnabled
    ? normalizeCtas(overrides, heroDefaults)
    : (heroDefaults?.ctas?.length ? (heroDefaults.ctas as HeroCTA[]) : defaultCtas);
  const kicker = ((copyOverridesEnabled ? overrides.kicker : '') || heroDefaults.eyebrow || defaultCopy.kicker).trim();
  const headline = ((copyOverridesEnabled ? overrides.headline : '') || heroDefaults.headline || defaultCopy.headline).trim();
  const subheading = ((copyOverridesEnabled ? overrides.subheading : '') || heroDefaults.subheading || defaultCopy.subheading).trim();

  // Additional optional settings (can be provided via landing section settings or siteSettings.hero)
  const s = overrides as HeroAdvancedSettings;
  const heroDefaultsExtended = heroDefaults as SiteSettings['hero'] & { backgroundMedia?: string; mediaMode?: 'background' | 'card' };
  const mediaMode = s.mediaMode || heroDefaultsExtended.mediaMode || 'card';
  const backgroundMedia = s.backgroundMedia || heroDefaultsExtended.backgroundMedia || null;
  const cardMedia = s.media || heroDefaults.media || (courses && courses.length ? courses[0].heroMedia : null);
  const heroImage = mediaMode === 'background' ? (backgroundMedia || cardMedia) : cardMedia;
  const backgroundOpacity = typeof s.backgroundOpacity !== 'undefined' ? Number(s.backgroundOpacity) : 0.22; // dark overlay opacity over image
  const boxImage = s.boxMedia || null;
  const boxOpacity = typeof s.boxOpacity !== 'undefined' ? Number(s.boxOpacity) : 0.9; // box background alpha
  const textVariant = s.textVariant || (heroDefaults as { textVariant?: string }).textVariant || 'auto'; // 'auto' | 'light' | 'dark'
  const heroSectionBackground = mediaMode === 'background' ? (heroImage || boxImage) : (backgroundMedia || boxImage);
  const heroFigureMedia = mediaMode === 'card' ? (heroImage || null) : null;
  const kickerColor = typeof s.kickerColor === 'string' && s.kickerColor.trim() ? s.kickerColor : null;
  const headlineColor = typeof s.headlineColor === 'string' && s.headlineColor.trim() ? s.headlineColor : null;
  const subheadingColor = typeof s.subheadingColor === 'string' && s.subheadingColor.trim() ? s.subheadingColor : null;
  const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    if (num < min) return min;
    if (num > max) return max;
    return num;
  };
  const heroMaxWidth = clampNumber(s.heroMaxWidth, 48, 120, 72);
  const verticalPadding = clampNumber(s.verticalPadding, 2, 12, 4);
  const gridGap = clampNumber(s.gridGap, 1, 6, 2.5);
  const contentWidthRatio = clampNumber(s.contentWidthRatio, 0.3, 0.7, 0.55);
  const mediaWidthRatio = Math.max(0.3, Number((1 - contentWidthRatio).toFixed(2)));
  const kickerSize = clampNumber(s.kickerSize, 10, 20, 14);
  const headlineSize = clampNumber(s.headlineSize, 28, 80, 48);
  const subheadingSize = clampNumber(s.subheadingSize, 14, 32, 18);
  const headingSpacing = clampNumber(s.headingSpacing, 0, 80, 24);
  const subheadingSpacing = clampNumber(s.subheadingSpacing, 0, 64, 24);
  const ctaSpacing = clampNumber(s.ctaSpacing, 12, 64, 32);
  const contentAlignment = typeof s.contentAlignment === 'string' ? s.contentAlignment : 'left';
  const heroFontFamily = typeof s.fontFamily === 'string' ? s.fontFamily : 'sans';
  const heroShellStyle = {
    '--hero-max-width': `${heroMaxWidth}rem`,
    '--hero-padding-y': `${verticalPadding}rem`,
    '--hero-grid-gap': `${gridGap}rem`,
    '--hero-content-fr': `${contentWidthRatio}fr`,
    '--hero-media-fr': `${mediaWidthRatio}fr`
  } as CSSProperties & Record<string, string>;
  const fontClass = heroFontFamily === 'serif' ? 'font-hero-serif' : heroFontFamily === 'display' ? 'font-hero-display' : 'font-hero-sans';
  const contentAlignClass = contentAlignment === 'center' ? 'text-center' : contentAlignment === 'right' ? 'text-right' : 'text-left';
  const ctaAlignClass = contentAlignment === 'center' ? 'justify-center' : contentAlignment === 'right' ? 'md:justify-end justify-start' : 'justify-start';
  const kickerStyle: CSSProperties = {
    fontSize: `clamp(0.75rem, 2.6vw, ${kickerSize}px)`,
    color: kickerColor || undefined
  };
  const headlineStyle: CSSProperties = {
    fontSize: `clamp(2rem, 6.5vw, ${headlineSize}px)`,
    marginTop: `${headingSpacing}px`,
    color: headlineColor || undefined
  };
  const subheadingStyle: CSSProperties = {
    fontSize: `clamp(1rem, 3.6vw, ${subheadingSize}px)`,
    marginTop: `${subheadingSpacing}px`,
    color: subheadingColor || undefined
  };
  const ctaStyle: CSSProperties = {
    marginTop: `${ctaSpacing}px`
  };

  const resolvedTextClass = (() => {
    if (textVariant === 'light') return 'text-white';
    if (textVariant === 'dark') return 'text-slate-900';
    // auto: if overlay is heavy, use light text
    return backgroundOpacity >= 0.45 ? 'text-white' : 'text-slate-900';
  })();

  return (
    <section className="relative">
      {/* Background image for the full hero section */}
      {heroSectionBackground ? (
        <div
          className="absolute inset-0 -z-20 bg-cover bg-center"
          style={{ backgroundImage: `url(${heroSectionBackground})` }}
          aria-hidden
        />
      ) : null}
      {/* Overlay to control darkness/contrast */}
      {heroSectionBackground ? (
        <div
          className="absolute inset-0 -z-10"
          style={{ backgroundColor: `rgba(0,0,0,${backgroundOpacity})` }}
          aria-hidden
        />
      ) : (
        <div className="absolute inset-0 -z-20 bg-white/0" aria-hidden />
      )}

      <div
        className={`hero-shell mx-auto grid w-full items-center px-4 ${mediaMode === 'background' ? 'md:[grid-template-columns:1fr]' : ''}`}
        style={heroShellStyle}
      >
        <div className={`relative overflow-visible ${fontClass} ${contentAlignClass}`}>
          <div className="pointer-events-none absolute -inset-y-8 -left-8 -z-10 hidden w-[46rem] opacity-90 md:block animate-float-slow">
            <HeroArt />
          </div>
          <p
            className={`text-sm font-semibold uppercase tracking-[0.4em] ${resolvedTextClass}`}
            style={kickerStyle}
          >
            {kicker}
          </p>
          <h1
            className={`mt-4 text-4xl font-semibold md:text-5xl ${resolvedTextClass}`}
            style={headlineStyle}
          >
            {headline}
          </h1>
          <p
            className={`mt-6 text-lg ${resolvedTextClass === 'text-white' ? 'text-slate-100' : 'text-slate-600'}`}
            style={subheadingStyle}
          >
            {subheading}
          </p>
          <div className={`flex flex-wrap gap-3 ${ctaAlignClass}`} style={ctaStyle}>
            {normalizedCtas.map((cta) => (
              <CTAButton key={`${cta.label}-${cta.href}`} cta={cta} />
            ))}
          </div>
          <div
            className="mt-8 rounded-2xl border p-4 md:mt-10 md:p-6"
            style={{
              background: boxImage
                ? `url(${boxImage}) center/cover no-repeat, rgba(255,255,255,${boxOpacity})`
                : `rgba(255,255,255,${boxOpacity})`,
              borderColor: 'rgba(15,23,42,0.06)'
            }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">Featured tracks</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {courses.slice(0, 4).map((course) => (
                <div key={course._id} className="rounded-xl bg-white px-4 py-3 shadow-sm">
                  <p className="text-sm font-semibold text-slate-900">{course.title}</p>
                  <p className="text-xs text-slate-500">{course.level || 'Mixed level'}</p>
                </div>
              ))}
              {courses.length === 0 && <p className="text-sm text-slate-500">Courses sync in once published.</p>}
            </div>
          </div>
        </div>
        {heroFigureMedia ? (
          <div className="relative">
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-3xl bg-transparent">
              <Image
                src={heroFigureMedia}
                alt={headline}
                fill
                sizes="(min-width: 768px) 40vw, 100vw"
                className="object-contain"
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
};

const CTAButton = ({ cta }: { cta: HeroCTA }) => {
  const style = cta.style === 'secondary' ? 'border border-slate-200 text-slate-700 hover:border-slate-400' : 'bg-brand text-white shadow hover:bg-brand-dark';
  return (
    <Link href={resolveWaraqaHref(cta.href)} className={`rounded-full px-5 py-2 text-sm font-semibold ${style}`}>
      {cta.label}
    </Link>
  );
};

const defaultCtas: HeroCTA[] = [
  { label: 'Book an evaluation', href: dashboardHref('/book/evaluation') },
  { label: 'Explore programs', href: '/courses', style: 'secondary' }
];

const defaultCopy = {
  kicker: 'Learning without limits',
  headline: 'Personalized Quran, Arabic, and Islamic studies',
  subheading: 'Trusted by families worldwide with dedicated teachers and human support.'
};

const normalizeCtas = (
  overrides: LandingSection['settings'] = {},
  heroDefaults: SiteSettings['hero'] = {}
): HeroCTA[] => {
  const overrideCtas = [overrides?.primaryCta, overrides?.secondaryCta].filter(
    (cta): cta is HeroCTA => Boolean(cta?.label && cta?.href)
  );
  if (overrideCtas.length) return overrideCtas;
  if (heroDefaults?.ctas?.length) return heroDefaults.ctas as HeroCTA[];
  return defaultCtas;
};

export default Hero;
