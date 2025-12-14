import Link from 'next/link';
import type { LandingSection, SiteSettings } from '@/lib/marketingClient';
import { SectionIntro } from './SectionIntro';
import { surfaceClasses } from './theme';

type Props = {
  section: LandingSection;
  siteSettings: SiteSettings;
};

const LandingContactCTA = ({ section, siteSettings }: Props) => {
  const themeSurface = surfaceClasses(section.theme);
  const contact = siteSettings.contactInfo || {};
  const email = contact.email || 'hello@waraqa.com';
  const phone = contact.phone || '+1 (800) 555-0199';

  return (
    <section className={`py-16 ${themeSurface}`}>
      <div className="mx-auto max-w-4xl px-4">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-8 shadow-sm">
          <SectionIntro
            section={section}
            fallback={{
              kicker: 'Next step',
              headline: 'Book a placement call',
              subheading: 'Families can reach admissions instantly—this content mirrors the dashboard contact info.'
            }}
            align="center"
          />
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Email</p>
              <p className="mt-2 text-xl font-semibold text-slate-900">{email}</p>
              <p className="mt-2 text-sm text-slate-600">Ideal for paperwork, transcripts, and scheduling questions.</p>
              <Link href={`mailto:${email}`} className="mt-4 inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Email admissions
              </Link>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Phone & WhatsApp</p>
              <p className="mt-2 text-xl font-semibold text-slate-900">{phone}</p>
              <p className="mt-2 text-sm text-slate-600">Weekdays 9:00–18:00 (GMT+3). After-hours replies next day.</p>
              <Link href={`tel:${phone.replace(/[^+\d]/g, '')}`} className="mt-4 inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
                Call now
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export { LandingContactCTA };
