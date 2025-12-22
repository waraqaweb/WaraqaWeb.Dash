import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { PricingSection } from '../../components/PricingSection';
import { getPricingPlans, getSiteSettings } from '../../lib/marketingClient';
import { getMarketingPreviewOptions } from '../../lib/preview';

const PricingPage = async () => {
  const previewOptions = await getMarketingPreviewOptions();
  const [siteSettings, plans] = await Promise.all([
    getSiteSettings(previewOptions),
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
