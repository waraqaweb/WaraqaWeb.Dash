import { notFound } from 'next/navigation';
import MarketingHeader from '../../../components/MarketingHeader';
import MarketingFooter from '../../../components/MarketingFooter';
import { CourseNarrative } from '../../../components/CourseNarrative';
import Link from 'next/link';
import Image from 'next/image';
import { getCourse, getSiteSettings } from '../../../lib/marketingClient';
import { getMarketingPreviewOptions } from '../../../lib/preview';

type CourseDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const CourseDetailPage = async ({ params }: CourseDetailPageProps) => {
  const { slug } = await params;
  const previewOptions = await getMarketingPreviewOptions();
  const [siteSettings, course] = await Promise.all([getSiteSettings(previewOptions), getCourse(slug)]);

  if (!course) {
    notFound();
  }

  const levels = (course.curriculum || [])
    .filter((level) => Boolean(level?.published))
    .slice()
    .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main className="relative isolate py-16">
        <div className="parallax-grid" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <CourseNarrative course={course} index={0} />

          <section className="mt-12 overflow-hidden rounded-[48px] border border-white/60 bg-white/80 px-6 py-10 shadow-[0_40px_120px_rgba(15,23,42,0.07)] ring-1 ring-slate-100 backdrop-blur">
            <div className="mx-auto max-w-4xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.5em] text-slate-400">Levels</p>
              <h2 className="mt-2 font-display text-3xl text-slate-900 sm:text-4xl">Choose a level</h2>
              <p className="mt-3 text-base text-slate-600">Each level has its own story page with images and sections.</p>
            </div>

            {!levels.length ? (
              <p className="mx-auto mt-8 max-w-3xl rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-6 text-center text-sm text-slate-500">
                No levels are published for this subject yet.
              </p>
            ) : (
              <div className="mx-auto mt-10 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {levels.map((level) => (
                  <article key={level.slug || level.title} className="flex h-full flex-col overflow-hidden rounded-[32px] border border-slate-100 bg-white/90 shadow-sm">
                    <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                      {level.thumbnailMedia || level.heroMedia ? (
                        <Image
                          src={level.thumbnailMedia || level.heroMedia || ''}
                          alt={`${level.title || course.title} level thumbnail`}
                          fill
                          sizes="(min-width: 768px) 33vw, 100vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-center text-xs font-medium text-slate-500">
                          Add a level thumbnail in the Marketing Hub.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-3 p-6">
                      <h3 className="text-xl font-semibold text-slate-900">{level.title || 'Untitled level'}</h3>
                      <p className="text-sm text-slate-600">{level.description || 'Add a short level description to complete this card.'}</p>
                      <div className="mt-auto">
                        <Link
                          href={`/courses/${course.slug}/${level.slug}`}
                          className="inline-flex w-full items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-slate-800"
                        >
                          View level
                        </Link>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default CourseDetailPage;
