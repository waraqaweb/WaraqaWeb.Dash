import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { TestimonialsSection } from '../../components/TestimonialsSection';
import { getSiteSettings, getTestimonials } from '../../lib/marketingClient';
import { getMarketingPreviewOptions } from '../../lib/preview';

const TestimonialsPage = async () => {
  const previewOptions = await getMarketingPreviewOptions();
  const [siteSettings, testimonials] = await Promise.all([
    getSiteSettings(previewOptions),
    getTestimonials({ limit: 50 })
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main>
        <TestimonialsSection testimonials={testimonials} />
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default TestimonialsPage;
