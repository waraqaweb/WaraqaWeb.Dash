import type { LandingSection, PricingPlan } from '@/lib/marketingClient';
import { SectionIntro } from './SectionIntro';
import { cardClasses, mutedTextClass, surfaceClasses } from './theme';

const formatPrice = (plan: PricingPlan) => {
  if (!plan.price) return 'Custom';
  const { amount, currency, cadence } = plan.price;
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 0
  });
  const cadenceLabel = cadence ? `/${cadence.replace('per ', '')}` : '';
  return `${formatter.format(amount)}${cadenceLabel}`;
};

type Props = {
  section: LandingSection;
  plans: PricingPlan[];
};

const LandingPricingPeek = ({ section, plans }: Props) => {
  const limit = section.limit && section.limit > 0 ? section.limit : 2;
  const visiblePlans = plans.slice(0, limit);
  const themeSurface = surfaceClasses(section.theme);
  const mutedText = mutedTextClass(section.theme);

  return (
    <section className={`py-16 ${themeSurface}`}>
      <div className="mx-auto max-w-6xl px-4">
        <SectionIntro
          section={section}
          fallback={{
            kicker: 'Pricing',
            headline: 'Transparent tuition snapshot',
            subheading: 'Highlight plans marked in the Marketing Hub.'
          }}
          align="center"
        />

        {!visiblePlans.length ? (
          <p className={`mt-10 rounded-2xl border border-dashed px-6 py-8 text-sm text-center ${mutedText}`}>
            No pricing plans match this configuration yet.
          </p>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {visiblePlans.map((plan) => (
              <article key={plan._id} className={`flex flex-col rounded-2xl p-6 shadow-sm ${cardClasses(section.theme)}`}>
                {plan.audienceTag && (
                  <span className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {plan.audienceTag}
                  </span>
                )}
                <h3 className="mt-4 text-2xl font-semibold">{plan.headline}</h3>
                {plan.subheading && <p className={`mt-2 text-sm ${mutedText}`}>{plan.subheading}</p>}
                <p className="mt-6 text-4xl font-semibold">{formatPrice(plan)}</p>
                {plan.price?.cadence && <p className={`text-sm ${mutedText}`}>Billed {plan.price.cadence}</p>}
                <ul className={`mt-6 space-y-2 text-sm ${mutedText}`}>
                  {(plan.features || []).slice(0, 4).map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-sky-400" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export { LandingPricingPeek };
