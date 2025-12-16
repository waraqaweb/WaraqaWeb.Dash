import Link from 'next/link';
const dashboardBaseUrl = (
  process.env.NEXT_PUBLIC_DASHBOARD_BASE_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'https://app.waraqa.com')
).replace(/\/$/, '');
const dashboardHref = (path: string) => `${dashboardBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
import clsx from 'clsx';
import Image from 'next/image';
import type { MarketingCourse } from '@/lib/marketingClient';
import { accentThemes, accentOrder, ensureAccent } from './storyThemes';
import { renderRichContent } from './richContent';

export const levelLabel = (level?: string) => {
  if (!level) return 'Multi level';
  switch (level.toLowerCase()) {
    case 'beginner':
      return 'Beginner friendly';
    case 'intermediate':
      return 'Intermediate pace';
    case 'advanced':
      return 'Advanced cohort';
    case 'mixed':
      return 'Mixed experience';
    default:
      return level;
  }
};

const defaultSectionLabel = (index: number) => `Section ${index + 1}`;

const buildNarrativeSections = (course: MarketingCourse) => {
  if (course.articleSections && course.articleSections.length) {
    return [...course.articleSections]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((section, index) => ({
        id: `${course._id}-section-${index}`,
        kicker: section.kicker || defaultSectionLabel(index),
        heading: section.heading || course.title,
        body: section.body || course.excerpt || '',
        media: section.media || course.heroMedia,
        align: section.align === 'left' ? 'left' : 'right',
        accent: ensureAccent(section.accent)
      }));
  }

  const source = course.curriculum?.length
    ? course.curriculum.map((item) => ({ title: item.title, description: item.description }))
    : (course.outcomes || []).map((text, idx) => ({ title: `Outcome ${idx + 1}`, description: text }));

  if (!source.length && course.excerpt) {
    source.push({ title: course.title, description: course.excerpt });
  }

  return source.slice(0, 3).map((item, index) => ({
    id: `${course._id}-fallback-${index}`,
    kicker: defaultSectionLabel(index),
    heading: item.title || course.title,
    body: item.description || course.excerpt || 'Details coming soon from admissions.',
    media: course.heroMedia,
    align: index % 2 === 0 ? 'right' : 'left',
    accent: accentOrder[index % accentOrder.length]
  }));
};

const buildMetaChips = (course: MarketingCourse) => {
  const chips = [
    { label: 'Level', value: levelLabel(course.level) },
    course.durationWeeks ? { label: 'Program length', value: `${course.durationWeeks} weeks` } : null,
    course.lessonsPerWeek ? { label: 'Weekly cadence', value: `${course.lessonsPerWeek} sessions` } : null,
    course.scheduleOption ? { label: 'Schedule', value: course.scheduleOption } : null
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  return chips;
};

const metaDotClass = 'h-2 w-2 rounded-full bg-emerald-400';

const CourseNarrative = ({ course, index = 0 }: { course: MarketingCourse; index?: number }) => {
  const sections = buildNarrativeSections(course);
  const chips = buildMetaChips(course);
  const introContent = renderRichContent(
    course.articleIntro,
    'rich-prose mx-auto mt-10 max-w-4xl text-left text-base text-slate-600'
  );

  return (
    <article
      key={course._id}
      className="course-glow relative overflow-hidden rounded-[48px] border border-white/60 bg-white/80 px-6 py-12 shadow-[0_40px_120px_rgba(15,23,42,0.07)] ring-1 ring-slate-100 backdrop-blur"
    >
      <div className="relative z-10 mx-auto max-w-5xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.5em] text-slate-400">Course {index + 1}</p>
        <h1 className="font-display text-4xl text-slate-900 md:text-5xl">{course.title}</h1>
        <p className="mt-4 text-lg text-slate-600">
          {course.excerpt || 'This course description will appear once the marketing team completes it.'}
        </p>
      </div>

      {introContent}

      {course.heroMedia && (
        <div className="mx-auto mt-10 max-w-5xl">
          <div className="relative overflow-hidden rounded-[36px] border border-slate-100/80 bg-gradient-to-br from-emerald-50/70 via-white to-white p-2 shadow-2xl">
            <Image
              src={course.heroMedia}
              alt={`${course.title} hero`}
              width={1600}
              height={900}
              className="h-full w-full rounded-[32px] object-cover align-middle animate-float-slow"
            />
            <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-gradient-to-tr from-white/5 via-transparent to-white/20" />
          </div>
        </div>
      )}

      {chips.length > 0 && (
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/80 px-4 py-2 text-sm font-medium text-slate-600 shadow-sm"
            >
              <span className={metaDotClass} />
              {chip.label}: {chip.value}
            </span>
          ))}
        </div>
      )}

      <div className="mt-14 space-y-16">
        {sections.map((section, sectionIndex) => {
          const accent = accentThemes[section.accent];
          const imageLeft = section.align === 'left';
          return (
            <div key={section.id} className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <div className={clsx('space-y-4', imageLeft ? 'lg:order-2' : 'lg:order-1')}>
                <div className="inline-flex items-center gap-2">
                  <span className={clsx('rounded-full border px-3 py-1 text-xs font-semibold tracking-[0.3em]', accent.badge)}>
                    {section.kicker || defaultSectionLabel(sectionIndex)}
                  </span>
                  <span className={clsx('h-1.5 w-1.5 rounded-full', accent.dot)} />
                </div>
                <h2 className="font-display text-3xl text-slate-900">{section.heading}</h2>
                {renderRichContent(section.body || '', 'space-y-3')}
              </div>
              <div className={clsx('relative', imageLeft ? 'lg:order-1' : 'lg:order-2')}>
                <div
                  className={clsx(
                    'group relative overflow-hidden rounded-[32px] border bg-gradient-to-br p-4 shadow-2xl ring-1 transition hover:-translate-y-1 hover:shadow-emerald-200/60',
                    accent.ring,
                    accent.gradient
                  )}
                >
                  {section.media ? (
                    <Image
                      src={section.media}
                      alt={section.heading}
                      width={1400}
                      height={900}
                      className="h-full w-full rounded-[24px] object-cover align-middle transition duration-700 group-hover:scale-[1.02] animate-float-slow"
                    />
                  ) : (
                    <div className="flex min-h-[260px] items-center justify-center rounded-[24px] bg-white/40 text-sm text-slate-400">
                      Add a section image to complete the story
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-4 rounded-[28px] border border-white/30" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-16 flex flex-col gap-4 border-t border-slate-100 pt-8 text-center md:flex-row md:items-center md:justify-between md:text-left">
        <div>
          <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Next step</p>
          <p className="text-base text-slate-600">Schedule a call with admissions and map the first lesson for {course.title}.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3 md:justify-end">
          <Link
            href={`/contact?course=${course.slug}`}
            className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-800"
          >
            Talk to admissions
          </Link>
          <Link
            href={dashboardHref(`/book/evaluation?course=${course.slug}`)}
            className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
          >
            Preview evaluation
          </Link>
        </div>
      </div>
    </article>
  );
};

export { CourseNarrative };
