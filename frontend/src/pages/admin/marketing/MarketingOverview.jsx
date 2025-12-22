import React, { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { BarChart3, BookMarked, CalendarClock, Image as ImageIcon, Layers, Quote, RefreshCcw, Users2 } from 'lucide-react';
import {
  getAdminBlogPosts,
  getAdminCourses,
  getAdminPricingPlans,
  getAdminTeachers,
  getAdminTestimonials,
  getMediaAssets
} from '../../../api/marketing';

const cardShell = 'rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-sm';
const pillLink = 'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50';

const MarketingOverview = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState({
    courses: [],
    pricing: [],
    teachers: [],
    testimonials: [],
    posts: [],
    assets: []
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
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
        if (!mounted) return;
        setData({ courses, pricing, teachers, testimonials, posts, assets });
      } catch (e) {
        if (mounted) setError('Failed to load marketing overview.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const stats = useMemo(() => {
    const coursePublished = data.courses.filter((c) => Boolean(c?.published)).length;
    const pricingPublished = data.pricing.filter((p) => Boolean(p?.published)).length;
    const teacherPublished = data.teachers.filter((t) => Boolean(t?.published)).length;
    const testimonialPublished = data.testimonials.filter((t) => Boolean(t?.published)).length;
    const postsPublished = data.posts.filter((p) => p?.status === 'published').length;
    const postsScheduled = data.posts.filter((p) => p?.status === 'scheduled').length;

    return {
      courses: { total: data.courses.length, published: coursePublished },
      pricing: { total: data.pricing.length, published: pricingPublished },
      teachers: { total: data.teachers.length, published: teacherPublished },
      testimonials: { total: data.testimonials.length, published: testimonialPublished },
      posts: { total: data.posts.length, published: postsPublished, scheduled: postsScheduled },
      assets: { total: data.assets.length }
    };
  }, [data]);

  const tiles = [
    { id: 'courses', label: 'Courses', to: '/admin/marketing/courses', icon: BookMarked, meta: `${stats.courses.published}/${stats.courses.total} published` },
    { id: 'pricing', label: 'Pricing', to: '/admin/marketing/pricing', icon: Layers, meta: `${stats.pricing.published}/${stats.pricing.total} live` },
    { id: 'teachers', label: 'Teachers', to: '/admin/marketing/teachers', icon: Users2, meta: `${stats.teachers.published}/${stats.teachers.total} public` },
    { id: 'testimonials', label: 'Testimonials', to: '/admin/marketing/testimonials', icon: Quote, meta: `${stats.testimonials.published}/${stats.testimonials.total} published` },
    { id: 'blog', label: 'Blog', to: '/admin/marketing/blog', icon: CalendarClock, meta: `${stats.posts.published} published • ${stats.posts.scheduled} scheduled` },
    { id: 'media', label: 'Media', to: '/admin/marketing/media', icon: ImageIcon, meta: `${stats.assets.total} recent` }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Overview</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-900">Marketing status</h2>
          <p className="text-sm text-slate-500">Jump into content types and keep publishing aligned.</p>
        </div>
        <button type="button" onClick={() => setRefreshKey((k) => k + 1)} className={pillLink}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <NavLink key={tile.id} to={tile.to} className={`${cardShell} transition hover:border-slate-300 hover:bg-white`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">{tile.label}</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-900">{tile.meta}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
              {loading ? <p className="mt-3 text-xs text-slate-400">Loading…</p> : <p className="mt-3 text-xs text-slate-500">Open {tile.label}</p>}
            </NavLink>
          );
        })}
      </div>

      <div className={`${cardShell} flex items-start gap-3`}> 
        <div className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-700">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">Phase 1</p>
          <p className="text-sm text-slate-500">Dedicated screens per content type + consistent navigation.</p>
        </div>
      </div>
    </div>
  );
};

export default MarketingOverview;
