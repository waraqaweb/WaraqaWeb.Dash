import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { getSiteSettings } from '../../lib/marketingClient';
import { getMarketingPreviewOptions } from '../../lib/preview';

const normalizeTel = (phone?: string) => (phone ? phone.replace(/[^+\d]/g, '') : '');

const ContactPage = async () => {
  const previewOptions = await getMarketingPreviewOptions();
  const siteSettings = await getSiteSettings(previewOptions);
  const contactInfo = siteSettings?.contactInfo || {};
  const socialLinks = siteSettings?.socialLinks || [];

  const email = contactInfo.email || 'hello@waraqa.com';
  const phone = contactInfo.phone || '+1 (800) 555-0199';
  const address = contactInfo.address || 'Remote-first · Serving families worldwide';

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-500">Get in touch</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">A direct line to admissions & support</h1>
          <p className="mt-4 text-lg text-slate-600">
            Reach the team the same way guardians do inside the dashboard—direct email, phone, or schedule a call. We respond within one business day.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Email</p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">{email}</h2>
            <p className="mt-2 text-sm text-slate-500">Ideal for enrollment paperwork, transcripts, and schedule changes.</p>
            <a href={`mailto:${email}`} className="mt-6 inline-flex rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
              Send an email
            </a>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Phone & WhatsApp</p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">{phone}</h2>
            <p className="mt-2 text-sm text-slate-500">Talk with admissions weekdays 9:00–18:00 (GMT+3). After-hours messages receive next-day replies.</p>
            <a href={`tel:${normalizeTel(phone)}`} className="mt-6 inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
              Call now
            </a>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Operations hub</p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-900">{address}</h2>
            <p className="mt-2 text-sm text-slate-500">In-person evaluations available by appointment. Request a slot through admissions.</p>
            <a href="https://maps.google.com" target="_blank" rel="noreferrer" className="mt-6 inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">
              View on maps
            </a>
          </article>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-2">
          <div className="rounded-3xl border border-emerald-200 bg-white/90 p-8 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500">White-glove intake</p>
            <h3 className="mt-3 text-3xl font-semibold text-slate-900">Book a placement call</h3>
            <p className="mt-3 text-slate-600">Choose a 30-minute slot to review readiness, tuition, and onboarding. Scheduling links mirror the internal landing form, so the team sees your request instantly.</p>
            <a
              href={`mailto:${email}?subject=Placement%20Call%20Request`}
              className="mt-6 inline-flex rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-white shadow hover:bg-emerald-600"
            >
              Request a call
            </a>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-slate-900 p-8 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">Follow along</p>
            <h3 className="mt-3 text-3xl font-semibold">Social & live updates</h3>
            {socialLinks.length ? (
              <ul className="mt-4 space-y-3 text-sm">
                {socialLinks.map((link) => (
                  <li key={`${link.label}-${link.url}`}>
                    <a href={link.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-white/80 hover:text-white">
                      <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">{link.label}</span>
                      <span>{link.url}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-white/80">Social profiles publish later this quarter. Check back soon.</p>
            )}
          </div>
        </div>
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default ContactPage;
