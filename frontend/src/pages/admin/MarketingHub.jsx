import React, { useMemo, useRef, useState } from 'react';
import {
  Megaphone,
  Image as ImageIcon,
  PanelsTopLeft,
  Newspaper,
  Settings2,
  Save,
  Sparkles,
  Target,
  ExternalLink,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import api from '../../api/axios';
import SiteSettingsPanel from '../../components/features/marketing/SiteSettingsPanel';
import ContentLibraryPanel from '../../components/features/marketing/ContentLibraryPanel';
import LandingBuilderPanel from '../../components/features/marketing/LandingBuilderPanel';

const MarketingHub = () => {
  const [activeTab, setActiveTab] = useState('site-settings');
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');
  const [railOpen, setRailOpen] = useState(false);
  const [dirtyByTab, setDirtyByTab] = useState({
    'site-settings': false,
    'content-library': false,
    'landing-builder': false
  });
  const [overview, setOverview] = useState({
    courses: { live: 0, curated: 0 },
    testimonials: { published: 0, pending: 0 },
    blog: { scheduled: 0, nextDropLabel: '—' }
  });

  const siteSettingsRef = useRef(null);
  const landingBuilderRef = useRef(null);
  const previewUrl = process.env.REACT_APP_MARKETING_PREVIEW_URL || 'http://localhost:4000';

  const handlePreview = () => {
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handlePublish = async () => {
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

  const overviewCards = useMemo(() => ([
    {
      id: 'courses',
      label: 'Featured Courses',
      value: `${overview.courses.live} live`,
      trend: `+${overview.courses.curated} curated`,
      icon: Target,
      accent: 'from-slate-900 to-slate-700'
    },
    {
      id: 'testimonials',
      label: 'Testimonials',
      value: `${overview.testimonials.published} published`,
      trend: `+${overview.testimonials.pending} pending`,
      icon: Sparkles,
      accent: 'from-emerald-600 to-teal-500'
    },
    {
      id: 'blog',
      label: 'Blog Posts',
      value: `${overview.blog.scheduled} scheduled`,
      trend: overview.blog.nextDropLabel,
      icon: Newspaper,
      accent: 'from-indigo-600 to-sky-500'
    }
  ]), [overview]);

  const tabs = [
    { id: 'site-settings', label: 'Site System', icon: Settings2, badge: 'Live' },
    { id: 'content-library', label: 'Content Library', icon: ImageIcon, badge: 'New' },
    { id: 'landing-builder', label: 'Landing Builder', icon: PanelsTopLeft, badge: 'Beta' }
  ];

  const activeTabDirty = Boolean(dirtyByTab[activeTab]);
  const anyUnsavedChanges = Object.values(dirtyByTab).some(Boolean);
  const activeSaveDisabled = activeTab === 'content-library' || !activeTabDirty;

  const handleSaveActive = async () => {
    if (activeTab === 'site-settings') {
      await siteSettingsRef.current?.save?.();
      return;
    }
    if (activeTab === 'landing-builder') {
      await landingBuilderRef.current?.save?.();
    }
  };

  const handlePublishActive = async () => {
    if (activeTab === 'landing-builder') {
      await landingBuilderRef.current?.publish?.();
      return;
    }
    await handlePublish();
  };

  const updateDirty = (tabId, isDirty) => {
    setDirtyByTab((prev) => ({ ...prev, [tabId]: Boolean(isDirty) }));
  };

  const RailButton = ({ label, children, onClick }) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-50"
    >
      {children}
    </button>
  );

  return (
    <div className="min-h-full bg-slate-50">
      {/* Fixed right-edge rail that doesn't consume layout width */}
      <div className="fixed right-4 top-24 z-40 hidden flex-col items-center gap-3 lg:flex">
        <RailButton label={railOpen ? 'Close marketing panel' : 'Open marketing panel'} onClick={() => setRailOpen((v) => !v)}>
          {railOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
        </RailButton>
        <RailButton label="Preview site" onClick={handlePreview}>
          <ExternalLink className="h-4 w-4" />
        </RailButton>
        <RailButton label="Publish all" onClick={handlePublish}>
          <Megaphone className="h-4 w-4" />
        </RailButton>
        <RailButton label="Featured courses">
          <Target className="h-4 w-4" />
        </RailButton>
        <RailButton label="Testimonials">
          <Sparkles className="h-4 w-4" />
        </RailButton>
        <RailButton label="Blog posts">
          <Newspaper className="h-4 w-4" />
        </RailButton>
      </div>

      {railOpen && (
        <div className="fixed right-4 top-24 z-40 hidden w-[360px] rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur lg:block">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Phase 3</p>
              <p className="mt-2 text-sm font-semibold text-slate-900">Marketing Operating Hub</p>
              <p className="text-xs text-slate-500">Quick actions & live status.</p>
            </div>
            <button
              type="button"
              onClick={() => setRailOpen(false)}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handlePreview}
                className="flex-1 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Preview site
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing}
                className="flex-1 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-70"
              >
                {publishing ? 'Publishing…' : 'Publish all'}
              </button>
            </div>
            {publishMessage && <p className="text-xs text-slate-500">{publishMessage}</p>}
          </div>

          <div className="mt-4 grid gap-3">
            {overviewCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.id} className={`rounded-2xl bg-gradient-to-br ${card.accent} p-4 text-white shadow-sm`}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs uppercase tracking-[0.25em] text-white/70">{card.label}</p>
                    <Icon className="h-4 w-4 text-white/80" />
                  </div>
                  <p className="mt-3 text-2xl font-semibold">{card.value}</p>
                  <p className="text-xs text-white/70">{card.trend}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-b border-slate-200 bg-white/70 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-8 lg:pr-20">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Phase 3</p>
              <div className="mt-3 flex items-center gap-3">
                <div className="rounded-2xl bg-slate-900/90 p-3 text-white shadow-lg">
                  <Megaphone className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-slate-900">Marketing Operating Hub</h1>
                  <p className="text-sm text-slate-500">Curate the public site experience without leaving the dashboard.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8 lg:pr-20">
        <div className="sticky top-0 z-20 -mx-2 mb-6 rounded-2xl border border-slate-200 bg-white/70 p-2 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition ${
                      isActive
                        ? 'bg-slate-900 text-white shadow'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                    {tab.badge && (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {tab.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveActive}
                disabled={activeSaveDisabled}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-60"
              >
                <span className="relative inline-flex">
                  <Save className="h-4 w-4" />
                  {anyUnsavedChanges && (
                    <span
                      aria-label="Unsaved changes"
                      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white"
                    />
                  )}
                </span>
                Save
              </button>

              <button
                type="button"
                onClick={handlePublishActive}
                disabled={publishing}
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-70"
              >
                <Megaphone className="h-4 w-4" />
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end px-2">
            {anyUnsavedChanges ? (
              <p className="text-xs font-medium text-slate-500">Unsaved changes pending.</p>
            ) : (
              publishMessage && <p className="text-xs text-slate-500">{publishMessage}</p>
            )}
          </div>
        </div>

        {anyUnsavedChanges && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            You have unsaved changes ({Object.entries(dirtyByTab).filter(([, v]) => v).map(([k]) => {
              if (k === 'site-settings') return 'Site System';
              if (k === 'content-library') return 'Content Library';
              return 'Landing Builder';
            }).join(', ')}). Switching tabs will keep your edits until you save.
          </div>
        )}

        {/* Keep panels mounted so tab transitions never drop in-progress edits */}
        <div className="space-y-8">
          <div className={activeTab === 'site-settings' ? 'block' : 'hidden'}>
            <SiteSettingsPanel
              ref={siteSettingsRef}
              onDirtyChange={(dirty) => updateDirty('site-settings', dirty)}
              onSaved={() => updateDirty('site-settings', false)}
            />
          </div>

          <div className={activeTab === 'content-library' ? 'block' : 'hidden'}>
            <ContentLibraryPanel
              onOverviewMetrics={(metrics) => {
                if (!metrics) return;
                setOverview((prev) => ({
                  ...prev,
                  courses: metrics.courses || prev.courses,
                  testimonials: metrics.testimonials || prev.testimonials,
                  blog: metrics.blog || prev.blog
                }));
              }}
            />
          </div>

          <div className={activeTab === 'landing-builder' ? 'block' : 'hidden'}>
            <LandingBuilderPanel
              ref={landingBuilderRef}
              onDirtyChange={(dirty) => updateDirty('landing-builder', dirty)}
              onSaved={() => updateDirty('landing-builder', false)}
              onPublished={() => updateDirty('landing-builder', false)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketingHub;
