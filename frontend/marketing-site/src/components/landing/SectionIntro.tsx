import type { LandingSection } from '@/lib/marketingClient';

const kickerClass = (theme?: string) => (theme === 'dark' ? 'text-white/60' : 'text-slate-500');
const headlineClass = (theme?: string) => (theme === 'dark' ? 'text-white' : 'text-slate-900');
const subheadingClass = (theme?: string) => (theme === 'dark' ? 'text-white/80' : 'text-slate-600');

type Props = {
  section: LandingSection;
  fallback?: {
    kicker?: string;
    headline?: string;
    subheading?: string;
  };
  align?: 'left' | 'center';
};

const SectionIntro = ({ section, fallback = {}, align = 'center' }: Props) => {
  const settings = section.settings || {};
  const kicker = settings.kicker || fallback.kicker;
  const headline = settings.headline || fallback.headline;
  const subheading = settings.subheading || fallback.subheading;
  const alignmentClass = align === 'center' ? 'text-center mx-auto' : '';

  return (
    <div className={`max-w-3xl ${alignmentClass}`}>
      {kicker && (
        <p className={`text-sm font-semibold uppercase tracking-[0.3em] ${kickerClass(section.theme)}`}>
          {kicker}
        </p>
      )}
      {headline && (
        <h2 className={`mt-4 text-3xl font-semibold tracking-tight ${headlineClass(section.theme)}`}>
          {headline}
        </h2>
      )}
      {subheading && (
        <p className={`mt-4 text-lg ${subheadingClass(section.theme)}`}>
          {subheading}
        </p>
      )}
    </div>
  );
};

export { SectionIntro };
