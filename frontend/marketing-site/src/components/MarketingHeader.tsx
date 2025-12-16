import Link from 'next/link';
import type { SiteSettings } from '../lib/marketingClient';

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

const dashboardBaseUrl = (
  process.env.NEXT_PUBLIC_DASHBOARD_BASE_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : 'https://app.waraqa.com')
).replace(/\/$/, '');
const dashboardHref = (path: string) => `${dashboardBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;

const MarketingHeader = ({ siteSettings }: Props) => {
  const navItems = siteSettings?.primaryNavigation?.length ? siteSettings.primaryNavigation : fallbackNav;
  const announcement = siteSettings?.announcement?.active ? siteSettings.announcement : null;

  return (
    <div className="bg-white shadow-sm">
      {announcement && announcement.message && (
        <div className="bg-brand text-white">
          <div className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-sm">
            <span>{announcement.message}</span>
            {announcement.href && (
              <Link href={announcement.href} className="underline decoration-white/60">
                Explore
              </Link>
            )}
          </div>
        </div>
      )}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6">
        <Link href="/" className="text-lg font-semibold text-slate-900">
          Waraqa
        </Link>
        <nav className="hidden gap-6 text-sm font-medium text-slate-600 md:flex">
          {navItems.map((item) => (
            <Link key={`${item.label}-${item.href}`} href={item.href} className="hover:text-slate-900">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={dashboardHref('/dashboard/login')}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
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
      </header>
    </div>
  );
};

export default MarketingHeader;
