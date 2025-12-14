import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { PricingSection } from '../../components/PricingSection';
import { getPricingPlans, getSiteSettings } from '../../lib/marketingClient';

const PricingPage = async () => {
  const [siteSettings, plans] = await Promise.all([
    getSiteSettings(),
    getPricingPlans(),
  ]);
  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main>
        <PricingSection plans={plans} />
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default PricingPage;
