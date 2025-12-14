import React, { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  Quote,
  Users2,
  Layers,
  Image as ImageIcon,
  RefreshCcw,
  Loader2,
  CalendarClock,
  Plus,
  PencilLine
} from 'lucide-react';
import {
  getAdminCourses,
  getAdminPricingPlans,
  getAdminTeachers,
  getAdminTestimonials,
  getAdminBlogPosts,
  getMediaAssets
} from '../../../api/marketing';
import CourseEditorModal from './CourseEditorModal';
import PricingPlanModal from './PricingPlanModal';
import TeacherProfileModal from './TeacherProfileModal';
import TestimonialModal from './TestimonialModal';
import BlogPostModal from './BlogPostModal';

const initialState = {
  courses: [],
  pricing: [],
  teachers: [],
  testimonials: [],
  posts: [],
  assets: []
};

const badgeClass = 'text-[0.7rem] font-semibold uppercase tracking-[0.3em]';
const panelShellClass = 'rounded-[28px] border border-slate-200 bg-white/80 p-6 shadow-sm';
const pillButtonClass = 'inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-white';
const microButtonClass = 'inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-white';
const fieldGridClass = 'mt-3 grid gap-3 text-xs text-slate-500 sm:grid-cols-2 lg:grid-cols-3';

const ContentLibraryPanel = ({ onOverviewMetrics }) => {
  const [data, setData] = useState(initialState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [courseModalOpen, setCourseModalOpen] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [teacherModalOpen, setTeacherModalOpen] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState(null);
  const [testimonialModalOpen, setTestimonialModalOpen] = useState(false);
  const [selectedTestimonial, setSelectedTestimonial] = useState(null);
  const [blogModalOpen, setBlogModalOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      setLoading(true);
      setError('');
      try {
        const [courses, pricing, teachers, testimonials, posts, assets] = await Promise.all([
          getAdminCourses(),
          getAdminPricingPlans(),
          getAdminTeachers(),
          getAdminTestimonials(),
          getAdminBlogPosts(),
          getMediaAssets({ limit: 12 })
        ]);
        if (mounted) {
          setData({ courses, pricing, teachers, testimonials, posts, assets });

          try {
            const isFeaturedCourse = (course) => Boolean(course?.featured || course?.isFeatured || course?.highlighted);
            const featured = courses.filter(isFeaturedCourse);
            const featuredLive = featured.filter((course) => Boolean(course?.published)).length;
            const featuredCurated = featured.filter((course) => !course?.published).length;

            const testimonialPublished = testimonials.filter((item) => Boolean(item?.published)).length;
            const testimonialPending = testimonials.length - testimonialPublished;

            const scheduledPosts = posts.filter((post) => post?.status === 'scheduled');
            const now = Date.now();
            const nextScheduledAt = scheduledPosts
              .map((post) => (post?.scheduledAt ? new Date(post.scheduledAt).getTime() : null))
              .filter((ts) => typeof ts === 'number' && !Number.isNaN(ts))
              .sort((a, b) => a - b)[0];

            const nextDropLabel = nextScheduledAt
              ? `Next drop in ${Math.max(0, Math.ceil((nextScheduledAt - now) / (1000 * 60 * 60 * 24)))}d`
              : 'No drop scheduled';

            onOverviewMetrics?.({
              courses: {
                live: featured.length ? featuredLive : courses.filter((course) => Boolean(course?.published)).length,
                curated: featured.length ? featuredCurated : Math.max(0, courses.length - courses.filter((course) => Boolean(course?.published)).length)
              },
              testimonials: {
                published: testimonialPublished,
                pending: testimonialPending
              },
              blog: {
                scheduled: scheduledPosts.length,
                nextDropLabel
              }
            });
          } catch (e) {
            // metrics are optional; ignore failures
          }
        }
      } catch (err) {
        if (mounted) setError('Failed to load content inventory.');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const metricCards = useMemo(() => {
    const coursePublished = data.courses.filter((course) => course.published).length;
    const pricingPublished = data.pricing.filter((plan) => plan.published).length;
    const teacherPublished = data.teachers.filter((teacher) => teacher.published).length;
    const testimonialsPublished = data.testimonials.filter((item) => item.published).length;
    const blogPublished = data.posts.filter((post) => post.status === 'published').length;

    return [
      {
        label: 'Courses',
        value: data.courses.length,
        meta: `${coursePublished} published`,
        icon: BookMarked,
        accent: 'from-emerald-500 to-teal-500'
      },
      {
        label: 'Pricing Plans',
        value: data.pricing.length,
        meta: `${pricingPublished} live`,
        icon: Layers,
        accent: 'from-indigo-500 to-blue-500'
      },
      {
        label: 'Teacher Profiles',
        value: data.teachers.length,
        meta: `${teacherPublished} public`,
        icon: Users2,
        accent: 'from-amber-500 to-orange-500'
      },
      {
        label: 'Testimonials',
        value: data.testimonials.length,
        meta: `${testimonialsPublished} staged`,
        icon: Quote,
        accent: 'from-rose-500 to-pink-500'
      },
      {
        label: 'Blog Posts',
        value: data.posts.length,
        meta: `${blogPublished} published`,
        icon: CalendarClock,
        accent: 'from-slate-800 to-slate-600'
      },
      {
        label: 'Media Assets',
        value: data.assets.length,
        meta: 'Latest uploads',
        icon: ImageIcon,
        accent: 'from-fuchsia-500 to-purple-500'
      }
    ];
  }, [data]);

  const scheduledPosts = useMemo(
    () => data.posts.filter((post) => post.status === 'scheduled').sort((a, b) => new Date(a.scheduledAt || 0) - new Date(b.scheduledAt || 0)),
    [data.posts]
  );

  const formatTeacherName = (teacher) => {
    if (!teacher) return 'Untitled';
    if (teacher.firstName) {
      const lastInitial = teacher.lastName ? `${teacher.lastName.charAt(0).toUpperCase()}.` : '';
      return `${teacher.firstName} ${lastInitial}`.trim();
    }
    return teacher.name || 'Untitled';
  };

  const listSections = [
    {
      key: 'courses',
      title: 'Courses',
      description: 'Track every offering and see which levels still need coverage.',
      items: data.courses,
      icon: BookMarked,
      fields: [
        { label: 'Level', render: (item) => item.level },
        { label: 'Status', render: (item) => (item.published ? 'Published' : 'Draft') },
        { label: 'Updated', render: (item) => (item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '—') }
      ]
    },
    {
      key: 'pricing',
      title: 'Pricing Plans',
      description: 'Align paywall messaging with live tuition plans.',
      items: data.pricing,
      icon: Layers,
      fields: [
        { label: 'Cadence', render: (item) => item.price?.cadence },
        { label: 'Amount', render: (item) => (item.price ? `${item.price.currency} ${item.price.amount}` : '--') },
        { label: 'Status', render: (item) => (item.published ? 'Live' : 'Hidden') }
      ]
    },
    {
      key: 'teachers',
      title: 'Teacher Profiles',
      description: 'Spotlight the educators anchoring each program.',
      items: data.teachers,
      icon: Users2,
      fields: [
        { label: 'Country', render: (item) => item.country || '—' },
        { label: 'Courses', render: (item) => (item.teachesCourses || []).slice(0, 2).join(', ') || '—' },
        { label: 'Status', render: (item) => (item.published ? 'Public' : 'Hidden') }
      ]
    },
    {
      key: 'testimonials',
      title: 'Testimonials',
      description: 'Keep social proof fresh across locales.',
      items: data.testimonials,
      icon: Quote,
      fields: [
        { label: 'Locale', render: (item) => item.locale || 'en' },
        { label: 'Rating', render: (item) => `${item.rating || 5}/5` },
        { label: 'Status', render: (item) => (item.published ? 'Live' : 'Review') }
      ]
    },
    {
      key: 'blog',
      title: 'Blog posts',
      description: 'Long-form articles, announcements, and product updates.',
      items: data.posts,
      icon: CalendarClock,
      fields: [
        { label: 'Language', render: (item) => item.language?.toUpperCase() || 'EN' },
        { label: 'Category', render: (item) => item.category || '—' },
        { label: 'Status', render: (item) => item.status }
      ]
    }
  ];

  const handleRefresh = () => setRefreshKey((key) => key + 1);

  const openNewCourse = () => {
    setSelectedCourse(null);
    setCourseModalOpen(true);
  };

  const openEditCourse = (course) => {
    setSelectedCourse(course);
    setCourseModalOpen(true);
  };

  const handleCourseChange = () => {
    handleRefresh();
  };

  const openNewPlan = () => {
    setSelectedPlan(null);
    setPlanModalOpen(true);
  };

  const openEditPlan = (plan) => {
    setSelectedPlan(plan);
    setPlanModalOpen(true);
  };

  const handlePlanChange = () => {
    handleRefresh();
  };

  const openNewTeacher = () => {
    setSelectedTeacher(null);
    setTeacherModalOpen(true);
  };

  const openEditTeacher = (teacher) => {
    setSelectedTeacher(teacher);
    setTeacherModalOpen(true);
  };

  const handleTeacherChange = () => {
    handleRefresh();
  };

  const openNewTestimonial = () => {
    setSelectedTestimonial(null);
    setTestimonialModalOpen(true);
  };

  const openEditTestimonial = (testimonial) => {
    setSelectedTestimonial(testimonial);
    setTestimonialModalOpen(true);
  };

  const handleTestimonialChange = () => {
    handleRefresh();
  };

  const openNewPost = () => {
    setSelectedPost(null);
    setBlogModalOpen(true);
  };

  const openEditPost = (blogPost) => {
    setSelectedPost(blogPost);
    setBlogModalOpen(true);
  };

  const handlePostChange = () => {
    handleRefresh();
  };

  const creationConfigs = {
    courses: { label: 'New course', handler: openNewCourse },
    pricing: { label: 'New plan', handler: openNewPlan },
    teachers: { label: 'New teacher', handler: openNewTeacher },
    testimonials: { label: 'New testimonial', handler: openNewTestimonial },
    blog: { label: 'New post', handler: openNewPost }
  };

  const quickEditHandlers = {
    courses: openEditCourse,
    pricing: openEditPlan,
    teachers: openEditTeacher,
    testimonials: openEditTestimonial,
    blog: openEditPost
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading marketing content…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-[32px] border border-slate-900/10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className={`${badgeClass} text-white/60`}>Content Library</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Every asset that powers the marketing site</h2>
            <p className="mt-2 text-sm text-white/70">
              Monitor course copy, pricing stories, editorial assets, and testimonials without leaving this dashboard.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/70 hover:text-white"
          >
            <RefreshCcw className="h-4 w-4" /> Refresh data
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={`rounded-[24px] border border-slate-100 bg-gradient-to-br ${card.accent} p-4 text-white shadow-md`}>
              <div className="flex items-center justify-between text-white/80">
                <p className={`${badgeClass} text-white/70`}>{card.label}</p>
                <Icon className="h-4 w-4" />
              </div>
              <p className="mt-4 text-3xl font-semibold">{card.value}</p>
              <p className="text-xs text-white/80">{card.meta}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-2 2xl:grid-cols-3">
        {listSections.map((section) => {
          const Icon = section.icon;
          const items = section.items.slice(0, 5);
          const creation = creationConfigs[section.key];
          return (
            <section key={section.key} className={panelShellClass}>
              <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2 text-slate-500">
                    <Icon className="h-4 w-4 text-slate-400" />
                    <p className={`${badgeClass} text-slate-400`}>{section.title}</p>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{section.description}</p>
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <span className="text-xs font-medium text-slate-500">{section.items.length} records</span>
                  {creation && (
                    <button type="button" onClick={creation.handler} className={microButtonClass}>
                      <Plus className="h-3 w-3" /> {creation.label}
                    </button>
                  )}
                </div>
              </header>
              <div className="divide-y divide-slate-100">
                {items.length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400">Nothing here yet.</p>
                )}
                {items.map((item) => {
                  const quickEdit = quickEditHandlers[section.key];
                  const itemKey = item._id || item.slug || item.key;
                  return (
                    <div key={itemKey} className="py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">
                          {section.key === 'teachers' ? formatTeacherName(item) : item.title || item.headline || item.guardianName || 'Untitled'}
                        </p>
                        {quickEdit && (
                          <button type="button" onClick={() => quickEdit(item)} className={microButtonClass}>
                            <PencilLine className="h-3 w-3" /> Quick edit
                          </button>
                        )}
                      </div>
                      <div className={fieldGridClass}>
                        {section.fields.map((field) => (
                          <div key={field.label}>
                            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.15em] text-slate-400">{field.label}</p>
                            <p className="mt-0.5 text-slate-700">{field.render(item)}</p>
                          </div>
                        ))}
                      </div>
                      {section.key === 'teachers' && (
                        <div className="mt-3 grid gap-2 rounded-2xl bg-slate-50/80 p-3 text-xs text-slate-600 md:grid-cols-3">
                          <p><span className="font-semibold text-slate-500">Certificates:</span> {(item.credentials || []).join(', ') || '—'}</p>
                          <p><span className="font-semibold text-slate-500">Additional:</span> {(item.additionalCertificates || []).join(', ') || '—'}</p>
                          <p><span className="font-semibold text-slate-500">Education:</span> {(item.education || []).join(', ') || '—'}</p>
                        </div>
                      )}
                      {section.key === 'testimonials' && (
                        <div className="mt-3 rounded-2xl bg-slate-50/80 p-3 text-sm text-slate-600">
                          <p className="italic text-slate-600">“{item.quote}”</p>
                          <p className="mt-2 text-xs text-slate-500">
                            {item.guardianName || 'Guardian'} · {item.guardianRelation || 'Family member'}
                            {item.studentName ? ` · Student: ${item.studentName}` : ''}
                          </p>
                        </div>
                      )}
                      {section.key === 'blog' && (
                        <div className="mt-3 space-y-2 rounded-2xl bg-slate-50/80 p-3">
                          {item.heroImage && (
                            <img src={item.heroImage} alt={item.title} className="h-32 w-full rounded-2xl object-cover" />
                          )}
                          <p className="text-sm text-slate-600">{item.summary || 'No summary yet. Preview pulls from the first paragraph.'}</p>
                          <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                            {(item.tags || []).map((tag) => (
                              <span key={tag} className="rounded-full bg-white px-2 py-0.5 text-slate-500">{tag}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <section className={panelShellClass}>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`${badgeClass} text-slate-400`}>Editorial Calendar</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">Scheduled blog drops</h3>
            <p className="text-sm text-slate-500">Know exactly what’s queued before a campaign launches.</p>
          </div>
          <span className="text-xs font-medium text-slate-500">{scheduledPosts.length} scheduled</span>
        </header>
        <div className="mt-4 divide-y divide-slate-100">
          {scheduledPosts.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400">No scheduled posts. Draft something new!</p>
          )}
          {scheduledPosts.map((post) => (
            <div key={post._id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{post.title}</p>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">{post.status}</span>
              </div>
              <p className="text-xs text-slate-500">{post.scheduledAt || post.publishedAt ? new Date(post.scheduledAt || post.publishedAt).toLocaleString() : 'TBD'}</p>
              <p className="mt-1 text-xs text-slate-500">Tags: {(post.tags || []).join(', ') || '—'}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={panelShellClass}>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className={`${badgeClass} text-slate-400`}>Asset Rack</p>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">Latest uploads</h3>
            <p className="text-sm text-slate-500">Thumbnails, hero imagery, and supporting art.</p>
          </div>
          <span className="text-xs font-medium text-slate-500">{data.assets.length} items</span>
        </header>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {data.assets.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-400 sm:col-span-2">No media uploaded yet.</p>
          )}
          {data.assets.map((asset) => (
            <div key={asset._id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3 shadow-inner">
              <div className="flex items-center gap-3">
                {asset.thumbnailUrl || asset.url ? (
                  <img src={asset.thumbnailUrl || asset.url} alt={asset.altText || 'asset preview'} className="h-12 w-12 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-400">
                    <ImageIcon className="h-5 w-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{asset.originalName || 'Untitled asset'}</p>
                  <p className="text-xs text-slate-500">{(asset.tags || []).slice(0, 2).join(', ') || 'No tags'}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">{asset.createdAt ? new Date(asset.createdAt).toLocaleDateString() : '—'}</p>
            </div>
          ))}
        </div>
      </section>

      <CourseEditorModal
        open={courseModalOpen}
        onClose={() => setCourseModalOpen(false)}
        course={selectedCourse}
        onSaved={handleCourseChange}
        onDeleted={handleCourseChange}
      />
      <PricingPlanModal
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        plan={selectedPlan}
        onSaved={handlePlanChange}
        onDeleted={handlePlanChange}
      />
      <TeacherProfileModal
        open={teacherModalOpen}
        onClose={() => setTeacherModalOpen(false)}
        teacher={selectedTeacher}
        onSaved={handleTeacherChange}
        onDeleted={handleTeacherChange}
      />
      <TestimonialModal
        open={testimonialModalOpen}
        onClose={() => setTestimonialModalOpen(false)}
        testimonial={selectedTestimonial}
        onSaved={handleTestimonialChange}
        onDeleted={handleTestimonialChange}
        courses={data.courses}
      />
      <BlogPostModal
        open={blogModalOpen}
        onClose={() => setBlogModalOpen(false)}
        post={selectedPost}
        onSaved={handlePostChange}
        onDeleted={handlePostChange}
      />
    </div>
  );
};

export default ContentLibraryPanel;
