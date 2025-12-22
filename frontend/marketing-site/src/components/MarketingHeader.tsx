import Link from 'next/link';
import type { MarketingCourse, SiteSettings } from '../lib/marketingClient';
import { dashboardHref, resolveWaraqaHref } from '@/lib/links';
import { getCourses } from '../lib/marketingClient';

const fallbackNav = [
  { label: 'Home', href: '/' },
  { label: 'Courses', href: '/courses' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Teachers', href: '/teachers' },
  { label: 'Testimonials', href: '/testimonials' },
  { label: 'Blog', href: '/blog' },
  { label: 'Contact', href: '/contact' }
];

type Props = {
  siteSettings?: SiteSettings;
};

const isCoursesNavItem = (item: { label?: string; href?: string }) => {
  const label = (item.label || '').trim().toLowerCase();
  const href = (item.href || '').trim().toLowerCase();
  return label === 'courses' || href === '/courses' || href.startsWith('/courses#') || href.startsWith('/courses/');
};

const getPublishedLevels = (course: MarketingCourse) =>
  (course.curriculum || [])
    .filter((level) => Boolean(level?.published) && typeof level?.slug === 'string' && level.slug)
    .slice()
    .sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));

const MarketingHeader = async ({ siteSettings }: Props) => {
  const navItems = siteSettings?.primaryNavigation?.length ? siteSettings.primaryNavigation : fallbackNav;
  const announcement = siteSettings?.announcement?.active ? siteSettings.announcement : null;
  const courses = await getCourses();
  const sortedCourses = courses.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const hasCoursesDropdown = sortedCourses.length > 0 && navItems.some(isCoursesNavItem);

  return (
    <div className="bg-white shadow-sm">
      {announcement && announcement.message && (
        <div className="bg-brand text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-sm">
            <span>{announcement.message}</span>
            {announcement.href && (
              <Link href={resolveWaraqaHref(announcement.href)} className="underline decoration-white/60">
                Explore
              </Link>
            )}
          </div>
        </div>
      )}
      <header className="mx-auto max-w-6xl px-4 py-4 md:py-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="shrink-0 text-lg font-semibold text-slate-900">
            Waraqa
          </Link>

          <nav className="hidden gap-6 text-sm font-medium text-slate-600 md:flex">
            {navItems.map((item) => {
              if (hasCoursesDropdown && isCoursesNavItem(item)) {
                return (
                  <div key={`${item.label}-${item.href}`} className="relative group">
                    <Link href="/courses" className="hover:text-slate-900">
                      {item.label || 'Courses'}
                    </Link>
                    <div className="invisible absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg opacity-0 transition group-hover:visible group-hover:opacity-100">
                      {sortedCourses.map((course) => {
                        const levels = getPublishedLevels(course);
                        return (
                          <div key={course._id} className="relative group/course">
                            <Link
                              href={`/courses/${course.slug}`}
                              className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {course.title}
                            </Link>

                            {levels.length > 0 && (
                              <div className="invisible absolute left-full top-0 z-50 ml-2 w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg opacity-0 transition group-hover/course:visible group-hover/course:opacity-100">
                                {levels.map((level) => (
                                  <Link
                                    key={level.slug}
                                    href={`/courses/${course.slug}/${level.slug}`}
                                    className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    {level.title || 'Untitled level'}
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              return (
                <Link key={`${item.label}-${item.href}`} href={resolveWaraqaHref(item.href)} className="hover:text-slate-900">
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <details className="relative z-50 md:hidden">
              <summary className="cursor-pointer list-none rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
                Menu
              </summary>
              <div className="pointer-events-auto absolute left-1/2 z-50 mt-2 w-[calc(100vw-2rem)] max-w-xs -translate-x-1/2 overflow-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-lg [max-height:calc(100vh-8rem)]">
                <Link
                  href={dashboardHref('/dashboard/login')}
                  className="block rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Sign in
                </Link>
                <div className="my-2 h-px bg-slate-100" />
                {navItems.map((item) => {
                  if (hasCoursesDropdown && isCoursesNavItem(item)) {
                    return (
                      <details key={`mobile-${item.label}-${item.href}`} className="rounded-xl">
                        <summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                          {item.label || 'Courses'}
                        </summary>
                        <div className="mt-1 space-y-1 pl-2">
                          {sortedCourses.map((course) => {
                            const levels = getPublishedLevels(course);
                            return (
                              <details key={course._id} className="rounded-xl">
                                <summary className="cursor-pointer list-none rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                                  {course.title}
                                </summary>
                                <div className="mt-1 space-y-1 pl-3">
                                  <Link
                                    href={`/courses/${course.slug}`}
                                    className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                  >
                                    View subject
                                  </Link>
                                  {levels.map((level) => (
                                    <Link
                                      key={level.slug}
                                      href={`/courses/${course.slug}/${level.slug}`}
                                      className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                      {level.title || 'Untitled level'}
                                    </Link>
                                  ))}
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      </details>
                    );
                  }

                  return (
                    <Link
                      key={`mobile-${item.label}-${item.href}`}
                      href={resolveWaraqaHref(item.href)}
                      className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </details>

            <Link
              href={dashboardHref('/dashboard/login')}
              className="hidden rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 sm:inline-flex"
            >
              Sign in
            </Link>
            <Link
              href={dashboardHref('/book/evaluation')}
              className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-dark"
            >
              Book free evaluation
            </Link>
          </div>
        </div>
      </header>
    </div>
  );
};

export default MarketingHeader;
