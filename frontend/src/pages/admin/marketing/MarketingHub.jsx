import React, { useMemo, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  BarChart3,
  BookMarked,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  Megaphone,
  Newspaper,
  PanelsTopLeft,
  Quote,
  Save,
  Settings2,
  Users2
} from 'lucide-react';
import api from '../../../api/axios';
import SiteSettingsPanel from '../../../components/features/marketing/SiteSettingsPanel';
import LandingBuilderPanel from '../../../components/features/marketing/LandingBuilderPanel';
import MarketingOverview from './MarketingOverview';
import MarketingCoursesPage from './MarketingCoursesPage';
import MarketingPricingPage from './MarketingPricingPage';
import MarketingTeachersPage from './MarketingTeachersPage';
import MarketingTestimonialsPage from './MarketingTestimonialsPage';
import MarketingBlogPage from './MarketingBlogPage';
import MarketingMediaPage from './MarketingMediaPage';

const previewUrl = process.env.REACT_APP_MARKETING_PREVIEW_URL || 'http://localhost:4000';
const previewToken = process.env.REACT_APP_MARKETING_PREVIEW_TOKEN || '';

const resolveSectionFromPath = (pathname) => {
  if (pathname.includes('/admin/marketing/pages')) return 'pages';
  if (pathname.includes('/admin/marketing/site')) return 'site';
  if (pathname.includes('/admin/marketing/courses')) return 'courses';
  if (pathname.includes('/admin/marketing/pricing')) return 'pricing';
  if (pathname.includes('/admin/marketing/teachers')) return 'teachers';
  if (pathname.includes('/admin/marketing/testimonials')) return 'testimonials';
  if (pathname.includes('/admin/marketing/blog')) return 'blog';
  if (pathname.includes('/admin/marketing/media')) return 'media';
  return 'overview';
};

const MarketingHub = () => {
  const location = useLocation();
  const activeSection = resolveSectionFromPath(location.pathname);

  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');
  const [dirtyBySection, setDirtyBySection] = useState({
    overview: false,
    courses: false,
    pricing: false,
    teachers: false,
    testimonials: false,
    blog: false,
    media: false,
    pages: false,
    site: false
  });

  const siteSettingsRef = useRef(null);
  const landingBuilderRef = useRef(null);

  const updateDirty = (sectionId, isDirty) => {
    setDirtyBySection((prev) => ({ ...prev, [sectionId]: Boolean(isDirty) }));
  };

  const activeDirty = Boolean(dirtyBySection[activeSection]);
  const canSave = activeSection === 'site' || activeSection === 'pages';
  const saveDisabled = !canSave || !activeDirty;

  const handlePreview = () => {
    try {
      const url = new URL(previewUrl);
      if (activeSection === 'pages') {
        const path = landingBuilderRef.current?.getPreviewPath?.() || '/';
        url.pathname = path;
      }
      url.searchParams.set('preview', '1');
      if (previewToken) url.searchParams.set('token', previewToken);
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    } catch (error) {
      // Fallback: open base URL.
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSaveActive = async () => {
    if (activeSection === 'site') {
      await siteSettingsRef.current?.save?.();
      return;
    }
    if (activeSection === 'pages') {
      await landingBuilderRef.current?.save?.();
    }
  };

  const handlePublishAll = async () => {
    setPublishing(true);
    setPublishMessage('');
    try {
      const { data } = await api.post('/marketing/publish');
      setPublishMessage(data?.message || 'Marketing content marked as published.');
    } catch (error) {
      setPublishMessage(error?.response?.data?.message || 'Failed to publish content.');
    } finally {
      setPublishing(false);
    }
  };

  const handlePublishActive = async () => {
    if (activeSection === 'pages') {
      await landingBuilderRef.current?.publish?.();
      return;
    }
    await handlePublishAll();
  };

  const navItems = useMemo(
    () => [
      { id: 'overview', label: 'Overview', icon: BarChart3, to: '/admin/marketing' },
      { id: 'courses', label: 'Courses', icon: BookMarked, to: '/admin/marketing/courses' },
      { id: 'pricing', label: 'Pricing', icon: Layers, to: '/admin/marketing/pricing' },
      { id: 'teachers', label: 'Teachers', icon: Users2, to: '/admin/marketing/teachers' },
      { id: 'testimonials', label: 'Testimonials', icon: Quote, to: '/admin/marketing/testimonials' },
      { id: 'blog', label: 'Blog', icon: Newspaper, to: '/admin/marketing/blog' },
      { id: 'media', label: 'Media', icon: ImageIcon, to: '/admin/marketing/media' },
      { id: 'pages', label: 'Landing Builder', icon: PanelsTopLeft, to: '/admin/marketing/pages' },
      { id: 'site', label: 'Site Settings', icon: Settings2, to: '/admin/marketing/site' }
    ],
    []
  );

  const linkClass = ({ isActive }) =>
    `flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium transition ` +
    (isActive ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-white hover:text-slate-900');

  return (
    <div className="min-h-full bg-slate-50">
      <div className="border-b border-slate-200 bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="mt-2 text-2xl font-semibold text-slate-900">Marketing Hub</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePreview}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" />
                Preview
              </button>

              <button
                type="button"
                onClick={handleSaveActive}
                disabled={saveDisabled}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Save
              </button>

              <button
                type="button"
                onClick={handlePublishActive}
                disabled={publishing}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60"
              >
                <Megaphone className="h-4 w-4" />
                {publishing ? 'Publishing…' : activeSection === 'pages' ? 'Publish page' : 'Publish all'}
              </button>
            </div>
          </div>
          {publishMessage ? <p className="mt-3 text-xs text-slate-500">{publishMessage}</p> : null}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-6 lg:grid-cols-[240px,1fr]">
          <nav className="lg:sticky lg:top-6">
            <div className="rounded-[28px] border border-slate-200 bg-white/70 p-3 shadow-sm backdrop-blur">
              <div className="flex gap-2 overflow-x-auto lg:flex-col">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.id} to={item.to} end={item.to === '/admin/marketing'} className={linkClass}>
                      <Icon className="h-4 w-4" />
                      <span className="whitespace-nowrap">{item.label}</span>
                      {dirtyBySection[item.id] ? (
                        <span className="ml-auto hidden rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800 lg:inline">
                          Unsaved
                        </span>
                      ) : null}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          </nav>

          <main className="min-w-0">
            <Routes>
              <Route index element={<MarketingOverview />} />
              <Route path="courses" element={<MarketingCoursesPage />} />
              <Route path="pricing" element={<MarketingPricingPage />} />
              <Route path="teachers" element={<MarketingTeachersPage />} />
              <Route path="testimonials" element={<MarketingTestimonialsPage />} />
              <Route path="blog" element={<MarketingBlogPage />} />
              <Route path="media" element={<MarketingMediaPage />} />

              <Route
                path="pages"
                element={
                  <LandingBuilderPanel
                    ref={landingBuilderRef}
                    onDirtyChange={(dirty) => updateDirty('pages', dirty)}
                    onSaved={() => updateDirty('pages', false)}
                    onPublished={() => updateDirty('pages', false)}
                  />
                }
              />
              <Route
                path="site"
                element={
                  <SiteSettingsPanel
                    ref={siteSettingsRef}
                    onDirtyChange={(dirty) => updateDirty('site', dirty)}
                    onSaved={() => updateDirty('site', false)}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/admin/marketing" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
};

export default MarketingHub;
