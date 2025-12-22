import Link from 'next/link';
import Image from 'next/image';
import type { MarketingCourse } from '@/lib/marketingClient';

const CardMedia = ({ course }: { course: MarketingCourse }) => {
  if (course.thumbnailMedia || course.heroMedia) {
    return (
      <Image
        src={course.thumbnailMedia || course.heroMedia || ''}
        alt={`${course.title} thumbnail`}
        fill
        sizes="(min-width: 768px) 33vw, 100vw"
        className="rounded-[24px] object-cover"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center rounded-[24px] bg-slate-100 text-center text-xs font-medium text-slate-500">
      Upload a hero image in the Marketing Hub to showcase this course.
    </div>
  );
};

const CourseCard = ({ course }: { course: MarketingCourse }) => (
  <article className="flex h-full flex-col overflow-hidden rounded-[32px] border border-slate-100 bg-white/90 shadow-sm">
    <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
      <CardMedia course={course} />
    </div>
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-slate-900">{course.title}</h3>
        <p className="text-sm text-slate-600">
          {course.excerpt || 'Add an excerpt in the Marketing Hub to finish this card.'}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap gap-2 text-xs text-slate-500">
        {(course.tags || []).slice(0, 3).map((tag) => (
          <span key={tag} className="rounded-full bg-slate-100 px-3 py-1">
            {tag}
          </span>
        ))}
      </div>
      <Link
        href={`/courses/${course.slug || course._id}`}
        className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-slate-800"
      >
        View subject
      </Link>
    </div>
  </article>
);

const EmptyState = () => (
  <section className="relative isolate py-24">
    <div className="parallax-grid" aria-hidden />
    <div className="mx-auto max-w-4xl rounded-[48px] border border-dashed border-slate-300 bg-white/70 p-12 text-center shadow-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.5em] text-slate-400">Course catalog</p>
      <h2 className="mt-4 font-display text-4xl text-slate-900">Add a course in the Marketing Hub to populate this page.</h2>
      <p className="mt-4 text-base text-slate-600">
        Upload a hero image, excerpt, and level to see the thumbnail cards update instantly on the public site.
      </p>
    </div>
  </section>
);

const CoursesSection = ({ courses }: { courses: MarketingCourse[] }) => {
  if (!courses.length) {
    return <EmptyState />;
  }

  return (
    <section className="relative isolate py-24" id="courses">
      <div className="parallax-grid" aria-hidden />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-emerald-50/30 via-white to-transparent" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.6em] text-emerald-500">Course catalog</p>
          <h1 className="font-display text-4xl text-slate-900 md:text-5xl">Browse subjects we teach</h1>
          <p className="mt-4 text-lg text-slate-600">
            Each subject pulls live data from the Marketing Hub. Set a subject thumbnail, intro, and levels to populate these pages.
          </p>
        </div>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {courses.map((course) => (
            <CourseCard key={course._id} course={course} />
          ))}
        </div>
      </div>
    </section>
  );
};

export { CoursesSection };
