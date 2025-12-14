import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, LayoutPanelLeft, Loader2, Plus, Sparkles, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { getLandingPages, publishLandingPage, updateLandingPage } from '../../../api/marketing';
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

const labelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-slate-500';
const inputClass = 'mt-1.5 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const selectClass = 'mt-1.5 w-full rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const textareaClass = `${inputClass} min-h-[90px]`;
const sectionShellClass = 'rounded-[30px] border border-slate-200 bg-white/80 p-6 shadow-sm';
const asideShellClass = 'rounded-[26px] border border-slate-200 bg-white/80 p-5 shadow-sm';
const iconButtonClass = 'rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 disabled:opacity-30';
const chipButtonClass = 'inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-40';
const colorSwatchClass = 'h-10 w-12 cursor-pointer rounded-2xl border border-slate-200 bg-white/80 shadow-inner focus:outline-none';

const LandingBuilderPanel = forwardRef(({ onDirtyChange, onSaved, onPublished }, ref) => {
  const [pages, setPages] = useState([]);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [formState, setFormState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const [dirty, setDirty] = useState(false);

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

  const currentPage = useMemo(() => pages.find((page) => page._id === selectedPageId), [pages, selectedPageId]);
  const sections = formState?.sections || [];
  const disabledBlocks = useMemo(() => new Set(sections.map((section) => section.key)), [sections]);

  const selectPage = (pageId) => {
    if (!pageId || pageId === selectedPageId) return;
    const next = pages.find((page) => page._id === pageId);
    if (!next) return;
    setSelectedPageId(pageId);
    setFormState(deepClone(next));
    setStatus({ type: '', message: '' });
    setDirty(false);
    onDirtyChange?.(false);
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
    mutateSections((prev) => prev.filter((_, idx) => idx !== index));
  };

  const addBlock = (key) => {
    const template = blockLibrary.find((block) => block.key === key);
    if (!template) return;
    const defaultFilters = () => {
      if (['courses', 'teachers', 'testimonials'].includes(key)) return { featured: true };
      if (key === 'pricing') return { highlight: true };
      if (key === 'blog') return { status: 'published' };
      return {};
    };
    const limitByKey = () => {
      if (key === 'hero' || key === 'contact') return 1;
      if (key === 'courses') return 3;
      if (key === 'pricing') return 2;
      if (key === 'teachers') return 6;
      if (key === 'testimonials') return 4;
      if (key === 'blog') return 3;
      return 0;
    };
    mutateSections((prev) => [...prev, deepClone({
      key: template.key,
      label: template.label,
      description: template.description,
      enabled: true,
      layout: template.layout,
      theme: template.theme,
      dataSource: template.dataSource,
      dataFilters: defaultFilters(),
      limit: limitByKey(),
      settings: {
        kicker: template.label,
        headline: template.description,
        subheading: '',
        primaryCta: { label: '', href: '' },
        secondaryCta: { label: '', href: '' }
      }
    })]);
  };

  const addCustomBlock = () => {
    mutateSections((prev) => [...prev, {
      key: `custom-${prev.length + 1}`,
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

  useImperativeHandle(ref, () => ({
    save: handleSave,
    publish: handlePublish,
    isDirty: () => dirty,
    isSaving: () => saving,
    isPublishing: () => publishing
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
      <div className="rounded-[32px] border border-slate-900/10 bg-gradient-to-br from-indigo-900 via-slate-900 to-slate-900 p-5 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[0.75rem] font-semibold uppercase tracking-[0.35em] text-white/60">Landing builder</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Structure every surface without touching code</h2>
            <p className="mt-2 text-sm text-white/70">Set hierarchies, connect data sources, and preview hero mixes in one place.</p>
          </div>
        </div>
      </div>

      {status.message && (
        <div className={`rounded-2xl border px-4 py-3 text-sm ${status.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {status.message}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[320px,1fr]">
        <aside className="space-y-5">
          <div className={asideShellClass}>
            <div className="flex items-center gap-2 text-slate-500">
              <LayoutPanelLeft className="h-4 w-4" />
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Pages</p>
            </div>
            <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {pages.map((page) => (
                <button
                  type="button"
                  key={page._id}
                  onClick={() => selectPage(page._id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                    page._id === selectedPageId
                      ? 'border-slate-900 bg-slate-900 text-white shadow'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{page.title}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-white/80">
                      {page.status === 'published' ? 'Live' : page.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-1 text-xs text-slate-400">
              {currentPage?.updatedAt && (
                <p>Last updated {new Date(currentPage.updatedAt).toLocaleString()}</p>
              )}
              {currentPage?.lastPublishedAt && (
                <p>Last published {new Date(currentPage.lastPublishedAt).toLocaleString()}</p>
              )}
            </div>
          </div>

          <div className={asideShellClass}>
            <div className="flex items-center gap-2 text-slate-500">
              <Sparkles className="h-4 w-4" />
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Block library</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {blockLibrary.map((block) => (
                <div key={block.key} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                  <p className="text-sm font-semibold text-slate-900">{block.label}</p>
                  <p className="text-xs text-slate-500">{block.description}</p>
                  <div className="mt-2 text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-slate-400">{block.dataSource}</div>
                  <button
                    type="button"
                    onClick={() => addBlock(block.key)}
                    disabled={disabledBlocks.has(block.key)}
                    className={`${chipButtonClass} mt-3`}
                  >
                    <Plus className="h-3 w-3" /> Add block
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addCustomBlock}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-400"
            >
              <Plus className="h-3 w-3" /> Custom block
            </button>
          </div>
        </aside>

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
            const isHeroSection = section.key === 'hero';
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
            return (
            <article key={`${section.key}-${index}`} className={sectionShellClass}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Section {index + 1}</p>
                  <h3 className="text-lg font-semibold text-slate-900">{section.label}</h3>
                  <p className="text-sm text-slate-500">{section.description}</p>
                </div>
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

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Internal label
                  <input
                    type="text"
                    className={inputClass}
                    value={section.label}
                    onChange={(e) => updateSectionField(index, 'label', e.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  Description
                  <textarea
                    rows={2}
                    className={textareaClass}
                    value={section.description || ''}
                    onChange={(e) => updateSectionField(index, 'description', e.target.value)}
                  />
                </label>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <label className={labelClass}>
                  Layout
                  <select
                    className={selectClass}
                    value={section.layout || 'full'}
                    onChange={(e) => updateSectionField(index, 'layout', e.target.value)}
                  >
                    {layoutOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
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
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Kicker
                  <input
                    type="text"
                    className={inputClass}
                    value={section.settings?.kicker || ''}
                    onChange={(e) => updateSectionSetting(index, 'kicker', e.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  Headline
                  <input
                    type="text"
                    className={inputClass}
                    value={section.settings?.headline || ''}
                    onChange={(e) => updateSectionSetting(index, 'headline', e.target.value)}
                  />
                </label>
                <label className={`${labelClass} sm:col-span-2`}>
                  Subheading
                  <textarea
                    rows={2}
                    className={textareaClass}
                    value={section.settings?.subheading || ''}
                    onChange={(e) => updateSectionSetting(index, 'subheading', e.target.value)}
                  />
                </label>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {(['primaryCta', 'secondaryCta']).map((slot) => (
                  <div key={slot} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                    <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">{slot === 'primaryCta' ? 'Primary CTA' : 'Secondary CTA'}</p>
                    <input
                      type="text"
                      placeholder="Label"
                      className={`${inputClass} mt-3`}
                      value={section.settings?.[slot]?.label || ''}
                      onChange={(e) => updateSectionCta(index, slot, 'label', e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="/contact"
                      className={`${inputClass} mt-2`}
                      value={section.settings?.[slot]?.href || ''}
                      onChange={(e) => updateSectionCta(index, slot, 'href', e.target.value)}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Appearance</p>
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
                            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">{label}</p>
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

              {isHeroSection && (
                <div className="mt-6 rounded-2xl border border-slate-100 bg-white/85 p-4">
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400">Hero layout controls</p>
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
              )}

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
            </article>
          );
          })}
        </section>
      </div>
    </div>
  );
});

export default LandingBuilderPanel;
