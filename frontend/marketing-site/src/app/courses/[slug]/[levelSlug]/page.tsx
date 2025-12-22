import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';

import MarketingHeader from '../../../../components/MarketingHeader';
import MarketingFooter from '../../../../components/MarketingFooter';
import { getCourse, getSiteSettings, type MarketingCourse } from '../../../../lib/marketingClient';
import { getMarketingPreviewOptions } from '../../../../lib/preview';
import { accentThemes, accentOrder, ensureAccent } from '../../../../components/storyThemes';
import { renderRichContent } from '../../../../components/richContent';

type LevelDetailPageProps = {
  params: Promise<{
    slug: string;
    levelSlug: string;
  }>;
};

type CourseLevel = NonNullable<MarketingCourse['curriculum']>[number];

const defaultSectionLabel = (index: number) => `Section ${index + 1}`;

const buildLevelSections = (level: CourseLevel) => {
  if (level.articleSections && level.articleSections.length) {
    return [...level.articleSections]
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((section, index) => ({
        id: `${level.slug || 'level'}-section-${index}`,
        kicker: section.kicker || defaultSectionLabel(index),
        heading: section.heading || level.title || 'Level details',
        body: section.body || '',
        media: section.media || level.heroMedia || level.thumbnailMedia,
        align: section.align === 'left' ? 'left' : 'right',
        accent: ensureAccent(section.accent)
      }));
  }

  if (level.description) {
    return [
      {
        id: `${level.slug || 'level'}-fallback-0`,
        kicker: defaultSectionLabel(0),
        heading: level.title || 'Level details',
        body: level.description,
        media: level.heroMedia || level.thumbnailMedia,
        align: 'right' as const,
        accent: accentOrder[0]
      }
    ];
  }

  return [];
};

const LevelDetailPage = async ({ params }: LevelDetailPageProps) => {
  const { slug, levelSlug } = await params;
  const previewOptions = await getMarketingPreviewOptions();

  const [siteSettings, course] = await Promise.all([getSiteSettings(previewOptions), getCourse(slug)]);

  if (!course) {
    notFound();
  }

  const level = (course.curriculum || []).find((item) => item?.slug === levelSlug && Boolean(item?.published));

  if (!level) {
    notFound();
  }

  const sections = buildLevelSections(level);
  const introContent = renderRichContent(level.articleIntro, 'rich-prose mx-auto mt-8 max-w-4xl text-left text-base text-slate-600');

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main className="relative isolate py-16">
        <div className="parallax-grid" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <article className="relative overflow-hidden rounded-[48px] border border-white/60 bg-white/80 px-6 py-12 shadow-[0_40px_120px_rgba(15,23,42,0.07)] ring-1 ring-slate-100 backdrop-blur">
            <div className="relative z-10 mx-auto max-w-5xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.5em] text-slate-400">
                <Link href={`/courses/${course.slug}`} className="hover:text-slate-700">
                  {course.title}
                </Link>
                <span className="mx-2 text-slate-300">/</span>
                Level
              </p>
              <h1 className="font-display text-3xl text-slate-900 sm:text-4xl md:text-5xl">{level.title || 'Untitled level'}</h1>
              <p className="mt-4 text-lg text-slate-600">{level.description || course.excerpt || ''}</p>
            </div>

            {introContent}

            {(level.heroMedia || level.thumbnailMedia) && (
              <div className="mx-auto mt-10 max-w-5xl">
                <div className="relative overflow-hidden rounded-[36px] border border-slate-100/80 bg-gradient-to-br from-emerald-50/70 via-white to-white p-2 shadow-2xl">
                  <Image
                    src={level.heroMedia || level.thumbnailMedia || ''}
                    alt={`${level.title || course.title} hero`}
                    width={1600}
                    height={900}
                    className="h-full w-full rounded-[32px] object-cover align-middle animate-float-slow"
                  />
                  <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-gradient-to-tr from-white/5 via-transparent to-white/20" />
                </div>
              </div>
            )}

            {sections.length > 0 && (
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
                        <h2 className="font-display text-2xl text-slate-900 sm:text-3xl">{section.heading}</h2>
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
            )}

            <div className="mt-16 flex items-center justify-center border-t border-slate-100 pt-8">
              <Link
                href={`/courses/${course.slug}`}
                className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
              >
                Back to {course.title}
              </Link>
            </div>
          </article>
        </div>
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default LevelDetailPage;
