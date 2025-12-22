import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, LayoutPanelLeft, Loader2, Plus, Sparkles, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { getLandingPages, getSiteSettings, publishLandingPage, updateLandingPage, updateSiteSettings, uploadMediaAsset } from '../../../api/marketing';
import MediaUploadInput from './MediaUploadInput';

const layoutOptions = [
  { value: 'full', label: 'Full width' },
  { value: 'grid', label: 'Grid' },
  { value: 'split', label: 'Split' },
  { value: 'carousel', label: 'Carousel' }
];

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'warm', label: 'Warm' },
  { value: 'slate', label: 'Slate' }
];

const dataSourceOptions = [
  { value: 'site-hero', label: 'Site hero' },
  { value: 'courses', label: 'Courses' },
  { value: 'pricing', label: 'Pricing plans' },
  { value: 'teachers', label: 'Teachers' },
  { value: 'testimonials', label: 'Testimonials' },
  { value: 'blog', label: 'Blog posts' },
  { value: 'contact', label: 'Contact info' },
  { value: 'custom', label: 'Custom content' }
];

const fontFamilyOptions = [
  { value: 'sans', label: 'Sans (clean default)' },
  { value: 'serif', label: 'Serif (editorial)' },
  { value: 'display', label: 'Display (bold caps)' }
];

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' }
];

const blockLibrary = [
  { key: 'hero', label: 'Hero spotlight', description: 'Hero headline and CTA stitched to site settings.', dataSource: 'site-hero', layout: 'full', theme: 'light' },
  { key: 'courses', label: 'Courses rail', description: 'Grid of featured courses.', dataSource: 'courses', layout: 'grid', theme: 'light' },
  { key: 'pricing', label: 'Tuition snapshot', description: 'Highlight up to two pricing plans.', dataSource: 'pricing', layout: 'split', theme: 'light' },
  { key: 'teachers', label: 'Teacher carousel', description: 'Rotating teacher highlights.', dataSource: 'teachers', layout: 'carousel', theme: 'light' },
  { key: 'testimonials', label: 'Testimonial wall', description: 'Quotes pulled from published testimonials.', dataSource: 'testimonials', layout: 'grid', theme: 'warm' },
  { key: 'blog', label: 'Blog digest', description: 'Latest entries from the blog.', dataSource: 'blog', layout: 'grid', theme: 'slate' },
  { key: 'contact', label: 'Contact + booking', description: 'CTA block for admissions.', dataSource: 'contact', layout: 'split', theme: 'dark' }
];

const filterFields = [
  { key: 'featured', label: 'Featured only', type: 'boolean' },
  { key: 'tag', label: 'Tag', type: 'text' },
  { key: 'locale', label: 'Locale', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' }
];

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const formatWhen = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString();
};

const labelClass = 'block text-xs font-semibold text-slate-600';
const inputClass = 'mt-1 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const inputClassNoTop = 'w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const selectClass = 'mt-1 w-full rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const textareaClass = `${inputClass} min-h-[86px]`;
const sectionShellClass = 'rounded-[26px] border border-slate-200 p-4 shadow-sm';
const asideShellClass = 'rounded-[24px] border border-slate-200 bg-white/80 p-4 shadow-sm';
const iconButtonClass = 'rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 disabled:opacity-30';
const chipButtonClass = 'inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-40';
const colorSwatchClass = 'h-10 w-12 cursor-pointer rounded-2xl border border-slate-200 bg-white/80 shadow-inner focus:outline-none';

const LandingBuilderPanel = forwardRef(({ onDirtyChange, onSaved, onPublished }, ref) => {
  const [pages, setPages] = useState([]);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [formState, setFormState] = useState(null);
  const [activePanel, setActivePanel] = useState('editor');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [dirty, setDirty] = useState(false);
  const [expandedSections, setExpandedSections] = useState({});

  const [siteSettingsDraft, setSiteSettingsDraft] = useState(null);
  const [siteHeroStatus, setSiteHeroStatus] = useState({ type: '', message: '' });
  const [siteHeroDirty, setSiteHeroDirty] = useState(false);
  const [savingSiteHero, setSavingSiteHero] = useState(false);
  const [uploadingSiteHero, setUploadingSiteHero] = useState({ card: false, background: false });
  const siteHeroCardInputRef = useRef(null);
  const siteHeroBackgroundInputRef = useRef(null);

  const initExpanded = (nextSections) => {
    const initial = {};
    if (Array.isArray(nextSections) && nextSections.length) {
      initial[nextSections[0].key] = true;
    }
    return initial;
  };

  useEffect(() => {
    let mounted = true;
    const bootstrap = async () => {
      setLoading(true);
      setStatus({ type: '', message: '' });
      try {
        const landingPages = await getLandingPages();
        if (!mounted) return;
        setPages(landingPages);
        if (landingPages.length) {
          const preferred = landingPages.find((page) => page.slug === 'home') || landingPages[0];
          setSelectedPageId(preferred._id);
          setFormState(deepClone(preferred));
          setExpandedSections(initExpanded(preferred.sections || []));
          setDirty(false);
          onDirtyChange?.(false);
        } else {
          setFormState(null);
        }
      } catch (error) {
        if (mounted) setStatus({ type: 'error', message: 'Failed to load landing builder data.' });
      } finally {
        if (mounted) setLoading(false);
      }
    };
    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getSiteSettings();
        if (!mounted) return;
        const next = {
          ...data,
          hero: {
            eyebrow: '',
            headline: '',
            subheading: '',
            media: '',
            backgroundMedia: '',
            mediaMode: 'card',
            ctas: [],
            ...(data?.hero || {})
          }
        };
        setSiteSettingsDraft(next);
        setSiteHeroDirty(false);
        setSiteHeroStatus({ type: '', message: '' });
      } catch (error) {
        if (!mounted) return;
        setSiteHeroStatus({ type: 'error', message: 'Failed to load Site Settings hero fields.' });
      }
    })();
    return () => { mounted = false; };
  }, []);

  const currentPage = useMemo(() => pages.find((page) => page._id === selectedPageId), [pages, selectedPageId]);
  const sections = formState?.sections || [];
  const disabledSingletonBlocks = useMemo(() => {
    const disabled = new Set();
    if (sections.some((section) => section.key === 'hero')) disabled.add('hero');
    if (sections.some((section) => section.key === 'contact')) disabled.add('contact');
    return disabled;
  }, [sections]);

  const selectPage = (pageId) => {
    if (!pageId || pageId === selectedPageId) return;
    const next = pages.find((page) => page._id === pageId);
    if (!next) return;
    setSelectedPageId(pageId);
    setFormState(deepClone(next));
    setExpandedSections(initExpanded(next.sections || []));
    setStatus({ type: '', message: '' });
    setDirty(false);
    onDirtyChange?.(false);
    setActivePanel('editor');
  };

  const toggleExpanded = (sectionKey) => {
    if (!sectionKey) return;
    setExpandedSections((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  };

  const updateSiteHeroField = (field, value) => {
    if (!siteHeroDirty) setSiteHeroDirty(true);
    setSiteSettingsDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hero: {
          eyebrow: '',
          headline: '',
          subheading: '',
          media: '',
          backgroundMedia: '',
          mediaMode: 'card',
          ctas: [],
          ...(prev.hero || {}),
          [field]: value
        }
      };
    });
  };

  const saveSiteHero = async () => {
    if (!siteSettingsDraft) return;
    setSavingSiteHero(true);
    setSiteHeroStatus({ type: '', message: '' });
    try {
      const saved = await updateSiteSettings(siteSettingsDraft);
      setSiteSettingsDraft(saved);
      setSiteHeroDirty(false);
      setSiteHeroStatus({ type: 'success', message: 'Site Settings hero saved (draft). Publish to apply publicly.' });
    } catch (error) {
      setSiteHeroStatus({
        type: 'error',
        message: error?.response?.data?.message || error?.message || 'Failed to save Site Settings hero.'
      });
    } finally {
      setSavingSiteHero(false);
    }
  };

  const handleSiteHeroImageUpload = async ({ file, targetField, kind }) => {
    if (!file) return;
    setSiteHeroStatus({ type: '', message: '' });
    setUploadingSiteHero((prev) => ({ ...prev, [kind]: true }));
    try {
      const uploaded = await uploadMediaAsset({ file, tags: ['hero', kind] });
      if (!uploaded?.url) throw new Error('Upload succeeded but no URL returned');
      updateSiteHeroField(targetField, uploaded.url);
    } catch (error) {
      setSiteHeroStatus({
        type: 'error',
        message: error?.response?.data?.message || error?.message || 'Failed to upload image.'
      });
    } finally {
      setUploadingSiteHero((prev) => ({ ...prev, [kind]: false }));
    }
  };

  const mutateSections = (updater) => {
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
    setFormState((prev) => {
      if (!prev) return prev;
      const nextSections = typeof updater === 'function' ? updater(prev.sections || []) : updater;
      return { ...prev, sections: nextSections };
    });
  };

  const updatePageField = (field, value) => {
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
    setFormState((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const updateSectionField = (index, field, value) => {
    mutateSections((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const updateSectionSetting = (index, field, value) => {
    mutateSections((prev) => {
      const next = [...prev];
      const settings = { ...(next[index]?.settings || {}) };
      settings[field] = value;
      next[index] = { ...next[index], settings };
      return next;
    });
  };

  const updateSectionCta = (index, slot, field, value) => {
    mutateSections((prev) => {
      const next = [...prev];
      const settings = { ...(next[index]?.settings || {}) };
      const cta = { ...(settings[slot] || {}) };
      cta[field] = value;
      settings[slot] = cta;
      next[index] = { ...next[index], settings };
      return next;
    });
  };

  const updateFilter = (index, key, value) => {
    mutateSections((prev) => {
      const next = [...prev];
      const filters = { ...(next[index]?.dataFilters || {}) };
      if (value === '' || value === null || value === undefined) {
        delete filters[key];
      } else {
        filters[key] = value;
      }
      next[index] = { ...next[index], dataFilters: filters };
      return next;
    });
  };

  const toggleSection = (index) => {
    const enabled = !(sections[index]?.enabled ?? true);
    updateSectionField(index, 'enabled', enabled);
  };

  const moveSection = (index, direction) => {
    mutateSections((prev) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return next;
    });
  };

  const removeSection = (index) => {
    const keyToRemove = sections[index]?.key;
    mutateSections((prev) => prev.filter((_, idx) => idx !== index));
    if (keyToRemove) {
      setExpandedSections((prev) => {
        const next = { ...prev };
        delete next[keyToRemove];
        return next;
      });
    }
  };

  const addBlock = (key) => {
    const template = blockLibrary.find((block) => block.key === key);
    if (!template) return;
    // Keep singleton blocks singleton.
    if ((key === 'hero' || key === 'contact') && sections.some((section) => section.key === key)) return;

    // Allow multiple blocks for repeatable templates by making keys unique.
    const buildUniqueKey = (baseKey) => {
      if (!sections.some((section) => section.key === baseKey)) return baseKey;
      let index = 2;
      while (sections.some((section) => section.key === `${baseKey}-${index}`)) index += 1;
      return `${baseKey}-${index}`;
    };

    const defaultFilters = () => {
      if (['courses', 'teachers', 'testimonials'].includes(key)) return { featured: true };
      if (key === 'pricing') return { highlight: true };
      if (key === 'blog') return { status: 'published' };
      return {};
    };
    const limitByKey = () => {
      if (key === 'hero' || key === 'contact') return 1;
      if (key === 'courses') return 4;
      if (key === 'pricing') return 2;
      if (key === 'teachers') return 6;
      if (key === 'testimonials') return 4;
      if (key === 'blog') return 3;
      return 0;
    };
    const heroCopySource = key === 'hero' ? 'site' : 'custom';
    const uniqueKey = buildUniqueKey(template.key);
    mutateSections((prev) => [...prev, deepClone({
      key: uniqueKey,
      label: template.label,
      description: template.description,
      enabled: true,
      layout: template.layout,
      theme: template.theme,
      dataSource: template.dataSource,
      dataFilters: defaultFilters(),
      limit: limitByKey(),
      settings: {
        heroCopySource,
        kicker: key === 'hero' ? '' : template.label,
        headline: key === 'hero' ? '' : template.description,
        subheading: '',
        primaryCta: { label: '', href: '' },
        secondaryCta: { label: '', href: '' }
      }
    })]);

    setExpandedSections((prev) => ({ ...prev, [uniqueKey]: true }));

    setActivePanel('editor');
  };

  const addCustomBlock = () => {
    const key = `custom-${sections.length + 1}`;
    mutateSections((prev) => [...prev, {
      key,
      label: 'Custom section',
      description: 'Describe what this block should cover.',
      enabled: true,
      layout: 'full',
      theme: 'light',
      dataSource: 'custom',
      dataFilters: {},
      limit: 0,
      settings: {
        kicker: '',
        headline: '',
        subheading: '',
        primaryCta: { label: '', href: '' },
        secondaryCta: { label: '', href: '' }
      }
    }]);

    setExpandedSections((prev) => ({ ...prev, [key]: true }));
  };

  const handleSave = async () => {
    if (!formState?._id) return;
    setSaving(true);
    setStatus({ type: '', message: '' });
    try {
      const payload = {
        title: formState.title,
        description: formState.description,
        heroVariant: formState.heroVariant,
        status: formState.status,
        sections: formState.sections
      };
      const saved = await updateLandingPage(formState._id, payload);
      setStatus({ type: 'success', message: 'Landing layout saved.' });
      setFormState(deepClone(saved));
      setPages((prev) => prev.map((page) => (page._id === saved._id ? saved : page)));
      setDirty(false);
      onDirtyChange?.(false);
      onSaved?.();
    } catch (error) {
      setStatus({ type: 'error', message: error?.response?.data?.message || 'Failed to save landing layout.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!formState?._id) return;
    setPublishing(true);
    setStatus({ type: '', message: '' });
    try {
      const published = await publishLandingPage(formState._id);
      setStatus({ type: 'success', message: 'Landing page published live.' });
      setFormState(deepClone(published));
      setPages((prev) => prev.map((page) => (page._id === published._id ? published : page)));
      setDirty(false);
      onDirtyChange?.(false);
      onPublished?.();
    } catch (error) {
      setStatus({ type: 'error', message: error?.response?.data?.message || 'Failed to publish landing page.' });
    } finally {
      setPublishing(false);
    }
  };

  const restoreRevision = (revision) => {
    const snapshot = revision?.snapshot;
    if (!snapshot || !formState?._id) return;
    const next = {
      ...deepClone(formState),
      ...deepClone(snapshot),
      _id: formState._id,
      slug: formState.slug,
      revisions: formState.revisions
    };
    setFormState(next);
    setStatus({ type: 'success', message: 'Revision restored into the editor. Click Save to keep it.' });
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
  };

  useImperativeHandle(ref, () => ({
    save: handleSave,
    publish: handlePublish,
    isDirty: () => dirty,
    isSaving: () => saving,
    isPublishing: () => publishing,
    getSelectedSlug: () => currentPage?.slug || '',
    getPreviewPath: () => {
      const slug = currentPage?.slug;
      if (!slug || slug === 'home') return '/';
      // Marketing site currently renders the builder only on home; keep preview safe.
      return '/';
    }
  }), [dirty, saving, publishing, formState]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparing landing builder…
      </div>
    );
  }

  if (!formState) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-12 text-center text-slate-500">
        No landing pages found yet. Create one from the API to get started.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {status.message && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${status.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {status.message}
        </div>
      )}

      <div className="rounded-[28px] border border-slate-200 bg-white/80 p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {pages.map((page) => (
              <button
                key={page._id}
                type="button"
                onClick={() => selectPage(page._id)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  page._id === selectedPageId && activePanel === 'editor'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="max-w-[220px] truncate">{page.title}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.25em] ${
                    page.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {page.status === 'published' ? 'Live' : page.status}
                </span>
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setActivePanel('blocks')}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                activePanel === 'blocks' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Blocks
            </button>
            <button
              type="button"
              onClick={() => setActivePanel('history')}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                activePanel === 'history' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              History
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 px-1 text-xs text-slate-500">
          {currentPage?.updatedAt ? <span>Updated {new Date(currentPage.updatedAt).toLocaleString()}</span> : null}
          {currentPage?.lastPublishedAt ? <span>Published {new Date(currentPage.lastPublishedAt).toLocaleString()}</span> : null}
        </div>
      </div>

      {activePanel === 'blocks' ? (
        <div className="rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Block library</p>
              <p className="mt-1 text-sm text-slate-600">Add sections to the selected page.</p>
            </div>
            <button
              type="button"
              onClick={addCustomBlock}
              className="inline-flex items-center gap-2 rounded-full border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
            >
              <Plus className="h-4 w-4" /> Custom block
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {blockLibrary.map((block) => (
              <div key={block.key} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                <p className="text-sm font-semibold text-slate-900">{block.label}</p>
                <p className="mt-1 text-xs text-slate-500">{block.description}</p>
                <button
                  type="button"
                  onClick={() => addBlock(block.key)}
                  disabled={disabledSingletonBlocks.has(block.key)}
                  className={`${chipButtonClass} mt-3 ${disabledSingletonBlocks.has(block.key) ? 'opacity-50' : ''}`}
                >
                  <Plus className="h-3 w-3" /> Add block
                </button>
                {disabledSingletonBlocks.has(block.key) ? (
                  <p className="mt-2 text-[0.7rem] text-slate-500">Only one allowed per page.</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activePanel === 'history' ? (
        <div className="rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-sm">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">History</p>
            <p className="mt-1 text-sm text-slate-600">Restore a previous version into the editor.</p>
            <p className="mt-2 text-xs text-slate-500">Restoring does not change the live site until you Save/Publish.</p>
          </div>
          <div className="mt-4 space-y-2">
            {Array.isArray(formState?.revisions) && formState.revisions.length ? (
              [...formState.revisions]
                .slice(-12)
                .reverse()
                .map((rev, idx) => (
                  <div key={`${rev.updatedAt || idx}`} className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{formatWhen(rev.updatedAt)}</p>
                        <p className="truncate text-xs text-slate-500">{rev.snapshot?.status ? `Status: ${rev.snapshot.status}` : 'Snapshot'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          restoreRevision(rev);
                          setActivePanel('editor');
                        }}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Restore
                      </button>
                    </div>
                  </div>
                ))
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 px-4 py-4 text-sm text-slate-500">
                No revisions yet. Revisions are captured on Save and Publish.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activePanel === 'editor' ? (
        <section className="space-y-6">
          <article className={sectionShellClass}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className={labelClass}>
                Page title
                <input
                  type="text"
                  className={inputClass}
                  value={formState.title}
                  onChange={(e) => updatePageField('title', e.target.value)}
                />
              </label>
              <label className={labelClass}>
                Hero variant
                <input
                  type="text"
                  className={inputClass}
                  value={formState.heroVariant || ''}
                  onChange={(e) => updatePageField('heroVariant', e.target.value)}
                />
              </label>
              <label className={labelClass}>
                Status
                <select
                  className={selectClass}
                  value={formState.status || 'draft'}
                  onChange={(e) => updatePageField('status', e.target.value)}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Slug
                <input
                  type="text"
                  disabled
                  className={`${inputClass} bg-slate-50 text-slate-500`}
                  value={formState.slug}
                  readOnly
                />
              </label>
              <label className={`${labelClass} sm:col-span-2 xl:col-span-4`}>
                Description
                <textarea
                  rows={2}
                  className={textareaClass}
                  value={formState.description || ''}
                  onChange={(e) => updatePageField('description', e.target.value)}
                />
              </label>
            </div>
            {formState.lastPublishedAt && (
              <p className="mt-4 text-xs text-slate-400">Last published {new Date(formState.lastPublishedAt).toLocaleString()}</p>
            )}
          </article>

          {sections.length === 0 && (
            <div className="rounded-[28px] border border-dashed border-slate-200 bg-white/60 p-12 text-center text-slate-500">
              No sections yet—add blocks from the library to define this landing page.
            </div>
          )}

          {sections.map((section, index) => {
            const textColorControls = [
              { key: 'kickerColor', label: 'Kicker text color', fallback: '#ffffff' },
              { key: 'headlineColor', label: 'Headline text color', fallback: '#ffffff' },
              { key: 'subheadingColor', label: 'Subheading text color', fallback: '#cbd5f5' }
            ];
            const readNumberSetting = (key, fallback) => (typeof section.settings?.[key] === 'number' ? section.settings[key] : fallback);
            const isHeroSection = (section.dataSource || '') === 'site-hero';
            const heroControls = {
              contentWidthRatio: readNumberSetting('contentWidthRatio', 0.55),
              heroMaxWidth: readNumberSetting('heroMaxWidth', 72),
              verticalPadding: readNumberSetting('verticalPadding', 4),
              gridGap: readNumberSetting('gridGap', 2.5),
              kickerSize: readNumberSetting('kickerSize', 12),
              headlineSize: readNumberSetting('headlineSize', 48),
              subheadingSize: readNumberSetting('subheadingSize', 18),
              headingSpacing: readNumberSetting('headingSpacing', 24),
              subheadingSpacing: readNumberSetting('subheadingSpacing', 24),
              ctaSpacing: readNumberSetting('ctaSpacing', 32)
            };
            const contentAlignmentValue = section.settings?.contentAlignment || 'left';
            const fontFamilyValue = section.settings?.fontFamily || 'sans';
            const expanded = expandedSections[section.key] ?? index === 0;
            const dataSourceLabel = dataSourceOptions.find((opt) => opt.value === (section.dataSource || 'custom'))?.label || (section.dataSource || 'Custom');
            const themeLabel = themeOptions.find((opt) => opt.value === (section.theme || 'light'))?.label || (section.theme || 'Light');

            const editorTonePalette = [
              { bg: 'bg-white/80', title: 'text-slate-900' },
              { bg: 'bg-slate-50/80', title: 'text-slate-900' },
              { bg: 'bg-amber-50/70', title: 'text-amber-900' },
              { bg: 'bg-emerald-50/60', title: 'text-emerald-900' },
              { bg: 'bg-slate-100/70', title: 'text-slate-900' },
              { bg: 'bg-amber-100/40', title: 'text-amber-900' }
            ];
            const editorTone = editorTonePalette[index % editorTonePalette.length];
            return (
            <article key={section.key} className={`${sectionShellClass} ${editorTone.bg}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => toggleExpanded(section.key)}
                  className="flex min-w-[240px] flex-1 items-start gap-3 text-left"
                >
                  <span className="mt-0.5 text-slate-400">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Section {index + 1}</p>
                      <span className="rounded-full border border-slate-200 bg-white/70 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-600">{dataSourceLabel}</span>
                      <span className="rounded-full border border-slate-200 bg-white/70 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-600">{themeLabel}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${section.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                      >
                        {section.enabled ? 'Enabled' : 'Hidden'}
                      </span>
                    </div>
                    <h3 className={`mt-1 text-base font-semibold ${editorTone.title}`}>{section.label}</h3>
                    {section.description ? <p className="mt-0.5 text-sm text-slate-500">{section.description}</p> : null}
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => moveSection(index, -1)}
                    disabled={index === 0}
                    className={iconButtonClass}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(index, 1)}
                    disabled={index === sections.length - 1}
                    className={iconButtonClass}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => toggleSection(index)} className={iconButtonClass}>
                    {section.enabled ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSection(index)}
                    className={`${iconButtonClass} text-red-500 hover:border-red-300 hover:text-red-600`}
                    title="Remove section"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {expanded ? (
                <>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Admin (not on website)</p>
                      <label className={`${labelClass} mt-3`}>
                        Admin label
                        <input
                          type="text"
                          className={inputClass}
                          value={section.label}
                          onChange={(e) => updateSectionField(index, 'label', e.target.value)}
                        />
                      </label>
                      <label className={`${labelClass} mt-3`}>
                        Admin note
                        <textarea
                          rows={2}
                          className={textareaClass}
                          value={section.description || ''}
                          onChange={(e) => updateSectionField(index, 'description', e.target.value)}
                        />
                      </label>
                    </div>

                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Behavior</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className={labelClass}>
                          Theme
                          <select
                            className={selectClass}
                            value={section.theme || 'light'}
                            onChange={(e) => updateSectionField(index, 'theme', e.target.value)}
                          >
                            {themeOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={labelClass}>
                          Data source
                          <select
                            className={selectClass}
                            value={section.dataSource || 'custom'}
                            onChange={(e) => updateSectionField(index, 'dataSource', e.target.value)}
                          >
                            {dataSourceOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={labelClass}>
                          Limit
                          <input
                            type="number"
                            min="0"
                            className={inputClass}
                            value={section.limit || 0}
                            onChange={(e) => updateSectionField(index, 'limit', Number(e.target.value) || 0)}
                          />
                        </label>
                        <label className={labelClass}>
                          Layout (stored)
                          <select
                            className={`${selectClass} opacity-60`}
                            value={section.layout || 'full'}
                            onChange={(e) => updateSectionField(index, 'layout', e.target.value)}
                            disabled
                            title="Layout is stored but not currently used by the website renderer."
                          >
                            {layoutOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="mt-3 text-xs text-slate-500">Theme, data source, and limit affect the website. Layout is saved but not used yet.</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {section.dataSource === 'site-hero' ? (
                      <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Hero copy source</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => updateSectionSetting(index, 'heroCopySource', 'site')}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                          (section.settings?.heroCopySource || 'site') !== 'custom'
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Use Site Settings
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSectionSetting(index, 'heroCopySource', 'custom')}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                          (section.settings?.heroCopySource || 'site') === 'custom'
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        Custom for this page
                      </button>
                    </div>
                    {(section.settings?.heroCopySource || 'site') === 'custom' ? (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        This page is overriding the hero copy. Updates in <span className="font-semibold">Site Settings → Hero Banner</span> will not change the kicker/headline/subheading or CTAs for this page.
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
                        This page is using the hero copy from <span className="font-semibold">Site Settings → Hero Banner</span>. Changing Site Settings will update this page (and any other pages using Site Settings) after publishing.
                      </div>
                    )}
                    <p className="mt-3 text-xs text-slate-500">
                      Appearance controls (backgrounds, opacity, alignment) are always per-page.
                    </p>
                      </div>
                    ) : null}

                    {section.dataSource === 'site-hero' ? (
                      <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-white/70 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">Hero Banner</h4>
                            <p className="text-xs text-slate-500">Control the headline, media, and hero image layout.</p>
                          </div>
                          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Homepage hero (Site Settings)</span>
                        </div>

                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
                          These values are the default hero copy for landing pages set to <span className="font-semibold">Use Site Settings</span>. Pages set to <span className="font-semibold">Custom for this page</span> will not change.
                        </div>

                        {siteHeroStatus.message ? (
                          <div className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${siteHeroStatus.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
                            {siteHeroStatus.message}
                          </div>
                        ) : null}

                        <div className="mt-4 grid gap-4 lg:grid-cols-3">
                          <label className={labelClass}>
                            Eyebrow
                            <input
                              type="text"
                              value={siteSettingsDraft?.hero?.eyebrow || ''}
                              onChange={(e) => updateSiteHeroField('eyebrow', e.target.value)}
                              className={inputClass}
                            />
                          </label>
                          <label className={labelClass}>
                            Headline
                            <input
                              type="text"
                              value={siteSettingsDraft?.hero?.headline || ''}
                              onChange={(e) => updateSiteHeroField('headline', e.target.value)}
                              className={inputClass}
                            />
                          </label>
                          <label className={labelClass}>
                            Subheading
                            <input
                              type="text"
                              value={siteSettingsDraft?.hero?.subheading || ''}
                              onChange={(e) => updateSiteHeroField('subheading', e.target.value)}
                              className={inputClass}
                            />
                          </label>

                          <label className={labelClass}>
                            Hero image mode
                            <select
                              value={siteSettingsDraft?.hero?.mediaMode || 'card'}
                              onChange={(e) => updateSiteHeroField('mediaMode', e.target.value)}
                              className={selectClass}
                            >
                              <option value="card">Card beside the text</option>
                              <option value="background">Full-width background behind text</option>
                            </select>
                          </label>

                          <label className={labelClass}>
                            Hero card image URL
                            <div className="mt-1 flex items-start gap-2">
                              <input
                                type="text"
                                value={siteSettingsDraft?.hero?.media || ''}
                                onChange={(e) => updateSiteHeroField('media', e.target.value)}
                                className={`${inputClassNoTop} flex-1`}
                                placeholder="Upload an image (or paste a URL)"
                              />
                              <input
                                ref={siteHeroCardInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files && e.target.files[0];
                                  e.target.value = '';
                                  handleSiteHeroImageUpload({ file, targetField: 'media', kind: 'card' });
                                }}
                              />
                              <button
                                type="button"
                                className={`${chipButtonClass} normal-case mt-2.5`}
                                onClick={() => siteHeroCardInputRef.current?.click()}
                                disabled={uploadingSiteHero.card}
                              >
                                {uploadingSiteHero.card ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                Upload image
                              </button>
                            </div>
                          </label>

                          <label className={labelClass}>
                            Hero background image URL
                            <div className="mt-1 flex items-start gap-2">
                              <input
                                type="text"
                                value={siteSettingsDraft?.hero?.backgroundMedia || ''}
                                onChange={(e) => updateSiteHeroField('backgroundMedia', e.target.value)}
                                className={`${inputClassNoTop} flex-1`}
                                placeholder="Upload an image (or paste a URL)"
                              />
                              <input
                                ref={siteHeroBackgroundInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files && e.target.files[0];
                                  e.target.value = '';
                                  handleSiteHeroImageUpload({ file, targetField: 'backgroundMedia', kind: 'background' });
                                }}
                              />
                              <button
                                type="button"
                                className={`${chipButtonClass} normal-case mt-2.5`}
                                onClick={() => siteHeroBackgroundInputRef.current?.click()}
                                disabled={uploadingSiteHero.background}
                              >
                                {uploadingSiteHero.background ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                Upload image
                              </button>
                            </div>
                          </label>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={saveSiteHero}
                            disabled={!siteHeroDirty || savingSiteHero || !siteSettingsDraft}
                            className={`${chipButtonClass} ${siteHeroDirty ? 'border-slate-300' : ''}`}
                          >
                            {savingSiteHero ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            Save homepage hero
                          </button>
                          <p className="text-xs text-slate-500">Saved as draft. Use Publish (top bar) to apply publicly.</p>
                        </div>
                      </div>
                    ) : null}

                    <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-white/80 p-4">
                      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Website copy</p>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <label className={labelClass}>
                          Kicker
                  <input
                    type="text"
                    disabled={section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom'}
                    className={`${inputClass} ${section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom' ? 'opacity-60' : ''}`}
                    value={section.settings?.kicker || ''}
                    onChange={(e) => updateSectionSetting(index, 'kicker', e.target.value)}
                  />
                        </label>
                        <label className={labelClass}>
                          Headline
                  <input
                    type="text"
                    disabled={section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom'}
                    className={`${inputClass} ${section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom' ? 'opacity-60' : ''}`}
                    value={section.settings?.headline || ''}
                    onChange={(e) => updateSectionSetting(index, 'headline', e.target.value)}
                  />
                        </label>
                        <label className={`${labelClass} sm:col-span-2`}>
                          Subheading
                  <textarea
                    rows={2}
                    disabled={section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom'}
                    className={`${textareaClass} ${section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom' ? 'opacity-60' : ''}`}
                    value={section.settings?.subheading || ''}
                    onChange={(e) => updateSectionSetting(index, 'subheading', e.target.value)}
                  />
                        </label>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {(['primaryCta', 'secondaryCta']).map((slot) => (
                          <div key={slot} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">{slot === 'primaryCta' ? 'Primary CTA' : 'Secondary CTA'}</p>
                            <input
                              type="text"
                              placeholder="Label"
                              disabled={section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom'}
                              className={`${inputClass} mt-3 ${section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom' ? 'opacity-60' : ''}`}
                              value={section.settings?.[slot]?.label || ''}
                              onChange={(e) => updateSectionCta(index, slot, 'label', e.target.value)}
                            />
                            <input
                              type="text"
                              placeholder="/contact"
                              disabled={section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom'}
                              className={`${inputClass} mt-2 ${section.dataSource === 'site-hero' && (section.settings?.heroCopySource || 'site') !== 'custom' ? 'opacity-60' : ''}`}
                              value={section.settings?.[slot]?.href || ''}
                              onChange={(e) => updateSectionCta(index, slot, 'href', e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {isHeroSection ? (
                    <>
                      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Hero appearance</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <MediaUploadInput
                            label="Section background"
                            value={section.settings?.backgroundMedia || ''}
                            onChange={(val) => updateSectionSetting(index, 'backgroundMedia', val)}
                            helperText="Spans the entire hero banner edge-to-edge."
                          />
                          <div>
                            <p className={labelClass}>Background overlay</p>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              className="mt-1 w-full"
                              value={typeof section.settings?.backgroundOpacity !== 'undefined' ? section.settings.backgroundOpacity : 0.22}
                              onChange={(e) => updateSectionSetting(index, 'backgroundOpacity', Number(e.target.value))}
                            />
                            <div className="mt-1 text-xs text-slate-500">{Math.round((typeof section.settings?.backgroundOpacity !== 'undefined' ? section.settings.backgroundOpacity : 0.22) * 100)}% overlay</div>
                          </div>
                          <MediaUploadInput
                            label="Hero spotlight background"
                            value={section.settings?.boxMedia || ''}
                            onChange={(val) => updateSectionSetting(index, 'boxMedia', val)}
                            helperText="Extends across the entire hero copy area (kicker, headline, CTAs)."
                          />
                          <div>
                            <p className={labelClass}>Box opacity</p>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.01"
                              className="mt-1 w-full"
                              value={typeof section.settings?.boxOpacity !== 'undefined' ? section.settings.boxOpacity : 0.9}
                              onChange={(e) => updateSectionSetting(index, 'boxOpacity', Number(e.target.value))}
                            />
                            <div className="mt-1 text-xs text-slate-500">{Math.round((typeof section.settings?.boxOpacity !== 'undefined' ? section.settings.boxOpacity : 0.9) * 100)}% opacity</div>
                          </div>
                          <label className={labelClass}>
                            Text color variant
                            <select
                              className={selectClass}
                              value={section.settings?.textVariant || 'auto'}
                              onChange={(e) => updateSectionSetting(index, 'textVariant', e.target.value)}
                            >
                              <option value="auto">Auto (contrast)</option>
                              <option value="light">Light text</option>
                              <option value="dark">Dark text</option>
                            </select>
                          </label>
                          <div className="sm:col-span-2">
                            <p className={`${labelClass} mb-2`}>Custom text colors</p>
                            <div className="grid gap-3 md:grid-cols-3">
                              {textColorControls.map(({ key, label, fallback }) => {
                                const currentValue = section.settings?.[key] || '';
                                const previewValue = currentValue || fallback;
                                return (
                                  <div key={key} className="rounded-2xl border border-slate-100 bg-white/80 p-3">
                                    <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">{label}</p>
                                    <div className="mt-2 flex items-center gap-2">
                                      <input
                                        type="color"
                                        className={colorSwatchClass}
                                        value={previewValue}
                                        onChange={(e) => updateSectionSetting(index, key, e.target.value)}
                                      />
                                      <button
                                        type="button"
                                        className={`${chipButtonClass} whitespace-nowrap`}
                                        onClick={() => updateSectionSetting(index, key, '')}
                                      >
                                        Reset
                                      </button>
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">{currentValue || 'Auto contrast'}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-100 bg-white/85 p-4">
                        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-slate-400">Hero layout controls</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <p className={labelClass}>Content vs media width</p>
                      <input
                        type="range"
                        min="0.35"
                        max="0.65"
                        step="0.01"
                        className="mt-1 w-full"
                        value={heroControls.contentWidthRatio}
                        onChange={(e) => updateSectionSetting(index, 'contentWidthRatio', Number(e.target.value))}
                      />
                      <div className="mt-1 text-xs text-slate-500">
                        Text {Math.round(heroControls.contentWidthRatio * 100)}% / Visual {100 - Math.round(heroControls.contentWidthRatio * 100)}%
                      </div>
                    </div>
                    <div>
                      <p className={labelClass}>Max width</p>
                      <input
                        type="range"
                        min="48"
                        max="120"
                        step="1"
                        className="mt-1 w-full"
                        value={heroControls.heroMaxWidth}
                        onChange={(e) => updateSectionSetting(index, 'heroMaxWidth', Number(e.target.value))}
                      />
                      <div className="mt-1 text-xs text-slate-500">{Math.round(heroControls.heroMaxWidth * 16)}px wide</div>
                    </div>
                    <div>
                      <p className={labelClass}>Vertical padding</p>
                      <input
                        type="range"
                        min="2"
                        max="12"
                        step="0.25"
                        className="mt-1 w-full"
                        value={heroControls.verticalPadding}
                        onChange={(e) => updateSectionSetting(index, 'verticalPadding', Number(e.target.value))}
                      />
                      <div className="mt-1 text-xs text-slate-500">{Math.round(heroControls.verticalPadding * 16)}px top/bottom padding</div>
                    </div>
                    <div>
                      <p className={labelClass}>Grid gap</p>
                      <input
                        type="range"
                        min="1"
                        max="6"
                        step="0.1"
                        className="mt-1 w-full"
                        value={heroControls.gridGap}
                        onChange={(e) => updateSectionSetting(index, 'gridGap', Number(e.target.value))}
                      />
                      <div className="mt-1 text-xs text-slate-500">{Math.round(heroControls.gridGap * 16)}px between columns</div>
                    </div>
                    <label className={labelClass}>
                      Content alignment
                      <select
                        className={selectClass}
                        value={contentAlignmentValue}
                        onChange={(e) => updateSectionSetting(index, 'contentAlignment', e.target.value)}
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </label>
                    <label className={labelClass}>
                      Font family
                      <select
                        className={selectClass}
                        value={fontFamilyValue}
                        onChange={(e) => updateSectionSetting(index, 'fontFamily', e.target.value)}
                      >
                        {fontFamilyOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Typography rhythm</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div>
                        <p className={labelClass}>Kicker size</p>
                        <input
                          type="range"
                          min="10"
                          max="20"
                          step="1"
                          className="mt-1 w-full"
                          value={heroControls.kickerSize}
                          onChange={(e) => updateSectionSetting(index, 'kickerSize', Number(e.target.value))}
                        />
                        <div className="mt-1 text-xs text-slate-500">{heroControls.kickerSize}px</div>
                      </div>
                      <div>
                        <p className={labelClass}>Headline size</p>
                        <input
                          type="range"
                          min="32"
                          max="80"
                          step="1"
                          className="mt-1 w-full"
                          value={heroControls.headlineSize}
                          onChange={(e) => updateSectionSetting(index, 'headlineSize', Number(e.target.value))}
                        />
                        <div className="mt-1 text-xs text-slate-500">{heroControls.headlineSize}px</div>
                      </div>
                      <div>
                        <p className={labelClass}>Subheading size</p>
                        <input
                          type="range"
                          min="14"
                          max="32"
                          step="1"
                          className="mt-1 w-full"
                          value={heroControls.subheadingSize}
                          onChange={(e) => updateSectionSetting(index, 'subheadingSize', Number(e.target.value))}
                        />
                        <div className="mt-1 text-xs text-slate-500">{heroControls.subheadingSize}px</div>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div>
                        <p className={labelClass}>Headline spacing</p>
                        <input
                          type="range"
                          min="0"
                          max="80"
                          step="2"
                          className="mt-1 w-full"
                          value={heroControls.headingSpacing}
                          onChange={(e) => updateSectionSetting(index, 'headingSpacing', Number(e.target.value))}
                        />
                        <div className="mt-1 text-xs text-slate-500">{heroControls.headingSpacing}px from kicker</div>
                      </div>
                      <div>
                        <p className={labelClass}>Subheading spacing</p>
                        <input
                          type="range"
                          min="0"
                          max="64"
                          step="2"
                          className="mt-1 w-full"
                          value={heroControls.subheadingSpacing}
                          onChange={(e) => updateSectionSetting(index, 'subheadingSpacing', Number(e.target.value))}
                        />
                        <div className="mt-1 text-xs text-slate-500">{heroControls.subheadingSpacing}px below headline</div>
                      </div>
                      <div>
                        <p className={labelClass}>CTA spacing</p>
                        <input
                          type="range"
                          min="12"
                          max="64"
                          step="2"
                          className="mt-1 w-full"
                          value={heroControls.ctaSpacing}
                          onChange={(e) => updateSectionSetting(index, 'ctaSpacing', Number(e.target.value))}
                        />
                        <div className="mt-1 text-xs text-slate-500">{heroControls.ctaSpacing}px above buttons</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

              <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Filters</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {filterFields.map((field) => (
                    <label key={field.key} className={labelClass}>
                      {field.label}
                      {field.type === 'boolean' ? (
                        <select
                          className={selectClass}
                          value={typeof section.dataFilters?.[field.key] === 'boolean' ? String(section.dataFilters[field.key]) : ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') updateFilter(index, field.key, undefined);
                            else updateFilter(index, field.key, value === 'true');
                          }}
                        >
                          <option value="">—</option>
                          <option value="true">True</option>
                          <option value="false">False</option>
                        </select>
                      ) : (
                        <input
                          type="text"
                          className={inputClass}
                          value={section.dataFilters?.[field.key] || ''}
                          onChange={(e) => updateFilter(index, field.key, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </div>
                </>
              ) : null}
            </article>
          );
          })}
        </section>
      ) : null}
    </div>
  );
});

export default LandingBuilderPanel;
