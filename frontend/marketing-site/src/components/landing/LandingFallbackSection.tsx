import type { LandingSection } from '@/lib/marketingClient';
import { surfaceClasses } from './theme';

type Props = {
  section: LandingSection;
};

const LandingFallbackSection = ({ section }: Props) => (
  <section className={`py-16 ${surfaceClasses(section.theme)}`}>
    <div className="mx-auto max-w-4xl px-4">
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-8 text-sm text-slate-600">
        {section.label || 'Untitled section'} will appear here once its data source is implemented.
      </div>
    </div>
  </section>
);

export { LandingFallbackSection };
