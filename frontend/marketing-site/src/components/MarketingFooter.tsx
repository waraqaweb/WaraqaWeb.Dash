import Link from 'next/link';
import type { SiteSettings } from '../lib/marketingClient';

type Props = {
  siteSettings?: SiteSettings;
};

const MarketingFooter = ({ siteSettings }: Props) => {
  const contact = siteSettings?.contactInfo;
  const social = siteSettings?.socialLinks || [];
  const secondaryNav = siteSettings?.secondaryNavigation || [];

  return (
    <footer className="bg-slate-950 text-slate-200">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="text-lg font-semibold">Waraqa</p>
            <p className="mt-3 text-sm text-slate-400">
              Personalized Quran, Arabic, and Islamic studies programs for modern families.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">Connect</p>
            <ul className="mt-3 space-y-1 text-sm">
              {contact?.email && <li>{contact.email}</li>}
              {contact?.phone && <li>{contact.phone}</li>}
              {contact?.address && <li>{contact.address}</li>}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">Follow</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {social.length === 0 && <span className="text-slate-500">Coming soon</span>}
              {social.map((item, index) => (
                <Link key={`${item.url || 'social'}-${index}`} href={item.url} className="hover:text-white">
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
        {secondaryNav.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-4 text-xs text-slate-500">
            {secondaryNav.map((item, index) => (
              <Link key={`${item.href || 'nav'}-${index}`} href={item.href} className="hover:text-white">
                {item.label}
              </Link>
            ))}
          </div>
        )}
        <p className="mt-10 text-xs text-slate-500">© {new Date().getFullYear()} Waraqa</p>
      </div>
    </footer>
  );
};

export default MarketingFooter;
