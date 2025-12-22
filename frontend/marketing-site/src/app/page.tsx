import MarketingHeader from '../components/MarketingHeader';
import MarketingFooter from '../components/MarketingFooter';
import Hero from '../components/Hero';
import {
  getBlogPosts,
  getCourses,
  getHeroCourses,
  getLandingPage,
  getPricingPlans,
  getSiteSettings,
  getTeachers,
  getTestimonials,
  type LandingSection,
  type MarketingBlogPost,
  type MarketingCourse,
  type MarketingTeacher,
  type MarketingTestimonial,
  type PricingPlan,
  type SiteSettings
} from '../lib/marketingClient';
import { getMarketingPreviewOptions } from '../lib/preview';
import { LandingCoursesRail } from '../components/landing/LandingCoursesRail';
import { LandingPricingPeek } from '../components/landing/LandingPricingPeek';
import { LandingTeachersSpotlight } from '../components/landing/LandingTeachersSpotlight';
import { LandingTestimonialsGrid } from '../components/landing/LandingTestimonialsGrid';
import { LandingBlogDigest } from '../components/landing/LandingBlogDigest';
import { LandingContactCTA } from '../components/landing/LandingContactCTA';
import { LandingFallbackSection } from '../components/landing/LandingFallbackSection';

export const dynamic = 'force-dynamic';

const HomePage = async () => {
  const previewOptions = await getMarketingPreviewOptions();
  const [siteSettings, heroCourses, landingPage] = await Promise.all([
    getSiteSettings(previewOptions),
    getHeroCourses(),
    getLandingPage('home', previewOptions)
  ]);

  const activeSections = (landingPage?.sections || []).filter((section) => section.enabled !== false);
  const sectionsBySource = groupSectionsBySource(activeSections);

  const heroSection = sectionsBySource['site-hero']?.[0];
  const courseSection = sectionsBySource.courses?.[0];
  const pricingSection = sectionsBySource.pricing?.[0];
  const teacherSection = sectionsBySource.teachers?.[0];
  const testimonialSection = sectionsBySource.testimonials?.[0];
  const blogSection = sectionsBySource.blog?.[0];

  const [courses, plans, teachers, testimonials, blogPosts] = await Promise.all([
    courseSection ? getCourses(buildCourseQuery(courseSection)) : Promise.resolve<MarketingCourse[]>([]),
    pricingSection ? getPricingPlans() : Promise.resolve<PricingPlan[]>([]),
    teacherSection ? getTeachers() : Promise.resolve<MarketingTeacher[]>([]),
    testimonialSection
      ? getTestimonials(buildTestimonialQuery(testimonialSection))
      : Promise.resolve<MarketingTestimonial[]>([]),
    blogSection
      ? getBlogPosts(buildBlogQuery(blogSection)).then((response) => response.posts || [])
      : Promise.resolve<MarketingBlogPost[]>([])
  ]);

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main>
        {!heroSection && <Hero siteSettings={siteSettings} courses={heroCourses} />}
        {activeSections.length ? (
          activeSections.map((section, index) => (
            <LandingSectionRouter
              // eslint-disable-next-line react/no-array-index-key
              key={`${section.key}-${index}`}
              section={section}
              siteSettings={siteSettings}
              data={{ heroCourses, courses, plans, teachers, testimonials, blogPosts }}
            />
          ))
        ) : (
          <section className="border-t border-slate-100 bg-white/70">
            <div className="mx-auto max-w-4xl px-4 py-16 text-center text-slate-500">
              No landing sections are enabled. Use the Landing Builder inside the dashboard to toggle them on.
            </div>
          </section>
        )}
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default HomePage;

const LandingSectionRouter = ({
  section,
  siteSettings,
  data
}: {
  section: LandingSection;
  siteSettings: SiteSettings;
  data: SectionDataBundle;
}) => {
  switch (section.dataSource) {
    case 'site-hero':
      return <Hero siteSettings={siteSettings} section={section} courses={data.heroCourses} />;
    case 'courses':
      return <LandingCoursesRail section={section} courses={applyCourseFilters(data.courses, section)} />;
    case 'pricing':
      return <LandingPricingPeek section={section} plans={applyPlanFilters(data.plans, section)} />;
    case 'teachers':
      return <LandingTeachersSpotlight section={section} teachers={applyTeacherFilters(data.teachers, section)} />;
    case 'testimonials':
      return <LandingTestimonialsGrid section={section} testimonials={applyTestimonialFilters(data.testimonials, section)} />;
    case 'blog':
      return <LandingBlogDigest section={section} posts={applyBlogFilters(data.blogPosts, section)} />;
    case 'contact':
      return <LandingContactCTA section={section} siteSettings={siteSettings} />;
    default:
      return <LandingFallbackSection section={section} />;
  }
};

type SectionDataBundle = {
  heroCourses: MarketingCourse[];
  courses: MarketingCourse[];
  plans: PricingPlan[];
  teachers: MarketingTeacher[];
  testimonials: MarketingTestimonial[];
  blogPosts: MarketingBlogPost[];
};

const groupSectionsBySource = (sections: LandingSection[]) =>
  sections.reduce<Record<string, LandingSection[]>>((acc, section) => {
    const key = section.dataSource || 'custom';
    if (!acc[key]) acc[key] = [];
    acc[key].push(section);
    return acc;
  }, {});

const buildCourseQuery = (section: LandingSection) => {
  const filters = section.dataFilters || {};
  return {
    level: typeof filters.level === 'string' ? filters.level : undefined,
    tag: typeof filters.tag === 'string' ? filters.tag : undefined,
    featured: parseBoolean(filters.featured)
  };
};

const buildTestimonialQuery = (section: LandingSection) => {
  const filters = section.dataFilters || {};
  const limit = section.limit && section.limit > 0 ? section.limit : 6;
  return {
    locale: typeof filters.locale === 'string' ? filters.locale : undefined,
    featured: parseBoolean(filters.featured),
    limit
  };
};

const buildBlogQuery = (section: LandingSection) => {
  const filters = section.dataFilters || {};
  const limit = section.limit && section.limit > 0 ? section.limit : 3;
  return {
    tag: typeof filters.tag === 'string' ? filters.tag : undefined,
    language: typeof filters.language === 'string' ? filters.language : undefined,
    category: typeof filters.category === 'string' ? filters.category : undefined,
    featured: parseBoolean(filters.featured),
    limit
  };
};

const parseBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return undefined;
};

const applyCourseFilters = (courses: MarketingCourse[], section: LandingSection) => {
  const filters = section.dataFilters || {};
  const filtered = courses.filter((course) => {
    if (filters.level && course.level !== filters.level) return false;
    if (filters.tag) {
      const tags = (course.tags || []).map((tag) => tag.toLowerCase());
      if (!tags.includes(String(filters.tag).toLowerCase())) return false;
    }
    if (typeof filters.featured !== 'undefined') {
      const target = parseBoolean(filters.featured);
      if (typeof target === 'boolean' && !!course.featured !== target) return false;
    }
    return true;
  });
  const limit = section.limit && section.limit > 0 ? section.limit : filtered.length;
  return filtered.slice(0, limit || 3);
};

const applyPlanFilters = (plans: PricingPlan[], section: LandingSection) => {
  const filters = section.dataFilters || {};
  const filtered = plans.filter((plan) => {
    if (typeof filters.highlight !== 'undefined') {
      const target = parseBoolean(filters.highlight);
      if (typeof target === 'boolean' && !!plan.highlight !== target) return false;
    }
    return true;
  });
  const limit = section.limit && section.limit > 0 ? section.limit : filtered.length;
  return filtered.slice(0, limit || 2);
};

const applyTeacherFilters = (teachers: MarketingTeacher[], section: LandingSection) => {
  const filters = section.dataFilters || {};
  const filtered = teachers.filter((teacher) => {
    if (typeof filters.featured !== 'undefined') {
      const target = parseBoolean(filters.featured);
      if (typeof target === 'boolean' && !!teacher.featured !== target) return false;
    }
    return true;
  });
  const limit = section.limit && section.limit > 0 ? section.limit : filtered.length;
  return filtered.slice(0, limit || 4);
};

const applyTestimonialFilters = (testimonials: MarketingTestimonial[], section: LandingSection) => {
  const filters = section.dataFilters || {};
  const filtered = testimonials.filter((testimonial) => {
    if (filters.locale && testimonial.locale !== filters.locale) return false;
    if (typeof filters.featured !== 'undefined') {
      const target = parseBoolean(filters.featured);
      if (typeof target === 'boolean' && !!testimonial.featured !== target) return false;
    }
    return true;
  });
  const limit = section.limit && section.limit > 0 ? section.limit : filtered.length;
  return filtered.slice(0, limit || 4);
};

const applyBlogFilters = (posts: MarketingBlogPost[], section: LandingSection) => {
  const filters = section.dataFilters || {};
  const filtered = posts.filter((post) => {
    if (filters.tag) {
      const tags = (post.tags || []).map((tag) => tag.toLowerCase());
      if (!tags.includes(String(filters.tag).toLowerCase())) return false;
    }
    if (filters.language && post.language !== filters.language) return false;
    if (filters.category && post.category !== filters.category) return false;
    if (typeof filters.featured !== 'undefined') {
      const target = parseBoolean(filters.featured);
      if (typeof target === 'boolean' && !!post.featured !== target) return false;
    }
    return true;
  });
  const limit = section.limit && section.limit > 0 ? section.limit : filtered.length;
  return filtered.slice(0, limit || 3);
};
