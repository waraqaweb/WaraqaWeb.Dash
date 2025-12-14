import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { CoursesSection } from '../../components/CoursesSection';
import { getCourses, getSiteSettings } from '../../lib/marketingClient';

const CoursesPage = async () => {
  const [siteSettings, courses] = await Promise.all([getSiteSettings(), getCourses()]);
  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <CoursesSection courses={courses} />
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default CoursesPage;
