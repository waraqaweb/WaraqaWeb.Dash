import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { TeachersSection } from '../../components/TeachersSection';
import { getSiteSettings, getTeachers } from '../../lib/marketingClient';

const TeachersPage = async () => {
  const [siteSettings, teachers] = await Promise.all([
    getSiteSettings(),
    getTeachers()
  ]);
  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main>
        <TeachersSection teachers={teachers} />
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default TeachersPage;
