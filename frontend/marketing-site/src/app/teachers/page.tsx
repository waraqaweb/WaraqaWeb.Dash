import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { TeachersSection } from '../../components/TeachersSection';
import { getSiteSettings, getTeachers } from '../../lib/marketingClient';
import { getMarketingPreviewOptions } from '../../lib/preview';

const TeachersPage = async () => {
  const previewOptions = await getMarketingPreviewOptions();
  const [siteSettings, teachers] = await Promise.all([
    getSiteSettings(previewOptions),
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
