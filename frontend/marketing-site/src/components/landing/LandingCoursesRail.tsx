import Link from 'next/link';
import Image from 'next/image';
import type { LandingSection, MarketingCourse } from '@/lib/marketingClient';
import { resolveWaraqaHref } from '@/lib/links';
import { SectionIntro } from './SectionIntro';
import { cardClasses, mutedTextClass, surfaceClasses } from './theme';

type Props = {
  section: LandingSection;
  courses: MarketingCourse[];
};

const LandingCoursesRail = ({ section, courses }: Props) => {
  const limit = section.limit && section.limit > 0 ? section.limit : 4;
  const visibleCourses = courses.slice(0, limit);
  const themeSurface = surfaceClasses(section.theme);
  const mutedText = mutedTextClass(section.theme);

  return (
    <section className={`py-16 ${themeSurface}`}>
      <div className="mx-auto max-w-6xl px-4">
        <SectionIntro
          section={section}
          fallback={{
            kicker: 'Courses',
            headline: 'Programs that sync automatically',
            subheading: 'Courses flagged as featured in the Marketing Hub populate this rail.'
          }}
          align="left"
        />

        {!visibleCourses.length ? (
          <p className={`mt-10 rounded-2xl border border-dashed px-6 py-8 text-sm ${mutedText}`}>
            No courses match this configuration yet.
          </p>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {visibleCourses.map((course) => (
              <article key={course._id} className={`flex h-full flex-col gap-5 rounded-[28px] p-5 shadow-sm ${cardClasses(section.theme)}`}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-white/40">
                  {course.thumbnailMedia || course.heroMedia ? (
                    <Image
                      src={course.thumbnailMedia || course.heroMedia || ''}
                      alt={`${course.title} thumbnail`}
                      fill
                      sizes="(min-width: 768px) 33vw, 100vw"
                      className="rounded-2xl object-cover"
                    />
                  ) : (
                    <div className={`flex h-full w-full items-center justify-center rounded-2xl border border-dashed text-center text-xs ${mutedText}`}>
                      Upload a thumbnail in the Marketing Hub to feature this subject.
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3">
                  <h3 className="text-lg font-semibold text-slate-900">{course.title}</h3>
                  <p className={`text-sm ${mutedText}`}>
                    {course.excerpt || 'Add a short excerpt to complete this thumbnail.'}
                  </p>
                  <div className="mt-auto">
                    <Link
                      href={`/courses/${course.slug || course._id}`}
                      className="inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-slate-800"
                    >
                      View subject
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {section.settings?.primaryCta?.label && section.settings?.primaryCta?.href && (
          <div className="mt-8">
            <Link
              href={resolveWaraqaHref(section.settings.primaryCta.href)}
              className="inline-flex rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800"
            >
              {section.settings.primaryCta.label}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
};

export { LandingCoursesRail };
