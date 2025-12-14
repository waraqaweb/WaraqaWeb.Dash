import type { LandingSection, MarketingTestimonial } from '@/lib/marketingClient';
import { SectionIntro } from './SectionIntro';
import { cardClasses, mutedTextClass, surfaceClasses } from './theme';

type Props = {
  section: LandingSection;
  testimonials: MarketingTestimonial[];
};

const stars = (rating = 5) => Array.from({ length: 5 }, (_, index) => index < rating);

const LandingTestimonialsGrid = ({ section, testimonials }: Props) => {
  const limit = section.limit && section.limit > 0 ? section.limit : 4;
  const visible = testimonials.slice(0, limit);
  const themeSurface = surfaceClasses(section.theme);
  const mutedText = mutedTextClass(section.theme);

  return (
    <section className={`py-16 ${themeSurface}`}>
      <div className="mx-auto max-w-6xl px-4">
        <SectionIntro
          section={section}
          fallback={{
            kicker: 'Testimonials',
            headline: 'Proof pulled from real families',
            subheading: 'Quotes, star ratings, and locales update as marketing publishes new stories.'
          }}
        />

        {!visible.length ? (
          <p className={`mt-10 rounded-2xl border border-dashed px-6 py-8 text-sm text-center ${mutedText}`}>
            Publish a testimonial flagged as featured to populate this block.
          </p>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {visible.map((testimonial) => (
              <article key={testimonial._id} className={`rounded-3xl p-6 shadow-sm ${cardClasses(section.theme)}`}>
                <div className="flex items-center gap-2 text-amber-500">
                  {stars(testimonial.rating).map((active, index) => (
                    <span key={`${testimonial._id}-${index}`} className={active ? 'text-amber-500' : `text-slate-300 ${mutedText}`}>
                      ★
                    </span>
                  ))}
                  <span className={`ml-auto text-xs uppercase tracking-[0.3em] ${mutedText}`}>
                    {testimonial.locale?.toUpperCase() || 'EN'}
                  </span>
                </div>
                <p className="mt-4 text-lg font-medium">“{testimonial.quote}”</p>
                <div className={`mt-4 text-sm ${mutedText}`}>
                  <p>
                    {testimonial.guardianName || 'Guardian'}
                    {testimonial.guardianRelation ? ` · ${testimonial.guardianRelation}` : ''}
                  </p>
                  {testimonial.studentName && <p>Student: {testimonial.studentName}</p>}
                  {typeof testimonial.course === 'object' && testimonial.course?.title && (
                    <p className="text-xs uppercase tracking-[0.3em]">Course: {testimonial.course.title}</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export { LandingTestimonialsGrid };
