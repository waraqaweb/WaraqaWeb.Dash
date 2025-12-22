import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { CoursesSection } from '../../components/CoursesSection';
import { getCourses, getSiteSettings } from '../../lib/marketingClient';
import { getMarketingPreviewOptions } from '../../lib/preview';

const CoursesPage = async () => {
  const previewOptions = await getMarketingPreviewOptions();
  const [siteSettings, courses] = await Promise.all([getSiteSettings(previewOptions), getCourses()]);
  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <CoursesSection courses={courses} />
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default CoursesPage;
