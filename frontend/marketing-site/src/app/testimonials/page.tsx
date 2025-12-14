import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { TestimonialsSection } from '../../components/TestimonialsSection';
import { getSiteSettings, getTestimonials } from '../../lib/marketingClient';

const TestimonialsPage = async () => {
  const [siteSettings, testimonials] = await Promise.all([
    getSiteSettings(),
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
