import { notFound } from 'next/navigation';
import MarketingHeader from '../../../components/MarketingHeader';
import MarketingFooter from '../../../components/MarketingFooter';
import { CourseNarrative } from '../../../components/CourseNarrative';
import { getCourses, getSiteSettings } from '../../../lib/marketingClient';

type CourseDetailPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

const CourseDetailPage = async ({ params }: CourseDetailPageProps) => {
  const { slug } = await params;
  const [siteSettings, courses] = await Promise.all([getSiteSettings(), getCourses()]);
  const course = courses.find((item) => item.slug === slug || item._id === slug);

  if (!course) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main className="relative isolate py-16">
        <div className="parallax-grid" aria-hidden />
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <CourseNarrative course={course} index={0} />
        </div>
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default CourseDetailPage;
