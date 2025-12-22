import { PricingPlan } from '../lib/marketingClient';
import { resolveWaraqaHref } from '@/lib/links';

const formatPrice = (plan: PricingPlan) => {
  if (!plan.price) return 'Custom';
  const { amount, currency, cadence } = plan.price;
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0,
  });
  const cadenceLabel = cadence ? `/${cadence.replace('per ', '')}` : '';
  return `${formatter.format(amount)}${cadenceLabel}`;
};

export const PricingSection = ({ plans }: { plans: PricingPlan[] }) => {
  if (!plans.length) {
    return (
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white/30 p-12 text-center shadow-sm">
          <p className="text-lg text-slate-600">Pricing will be published here once plans go live.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 sm:py-24" id="pricing">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-sky-500">Tuition Options</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Pick the plan that matches your teaching goals</h1>
          <p className="mt-4 text-lg text-slate-600">Transparent plans curated in the Marketing Hub automatically flow here, so families always see the latest tuition details.</p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan._id}
              className={`flex flex-col rounded-2xl border bg-white/80 p-6 shadow-sm ${plan.highlight ? 'border-sky-400 shadow-lg ring-1 ring-sky-200' : 'border-slate-200'}`}
            >
              {plan.audienceTag && (
                <span className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {plan.audienceTag}
                </span>
              )}

              <div className="mt-4">
                <h2 className="text-2xl font-semibold text-slate-900">{plan.headline}</h2>
                {plan.subheading && <p className="mt-2 text-sm text-slate-600">{plan.subheading}</p>}
              </div>

              <div className="mt-6">
                <p className="text-4xl font-semibold text-slate-900">{formatPrice(plan)}</p>
                {plan.price?.cadence && <p className="text-sm text-slate-500">Billed {plan.price.cadence}</p>}
              </div>

              <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-700">
                {(plan.features || []).map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-1 h-2 w-2 rounded-full bg-sky-400" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {plan.ctaHref && plan.ctaLabel && (
                <a
                  href={resolveWaraqaHref(plan.ctaHref)}
                  className={`mt-8 inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                    plan.highlight
                      ? 'bg-sky-500 text-white hover:bg-sky-600 focus-visible:outline-sky-500'
                      : 'bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900'
                  }`}
                >
                  {plan.ctaLabel}
                </a>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};
