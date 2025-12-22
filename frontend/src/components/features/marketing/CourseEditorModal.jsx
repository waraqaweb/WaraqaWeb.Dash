import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { createCourse, updateCourse, deleteCourse } from '../../../api/marketing';
import MediaUploadInput from './MediaUploadInput';

const levelOptions = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'mixed', label: 'Mixed' }
];

const accentOptions = [
  { value: 'emerald', label: 'Emerald' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'rose', label: 'Rose' },
  { value: 'amber', label: 'Amber' },
  { value: 'teal', label: 'Teal' }
];

const alignOptions = [
  { value: 'right', label: 'Image on the right' },
  { value: 'left', label: 'Image on the left' }
];

const richTextModules = {
  toolbar: [
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean']
  ]
};

const richTextFormats = ['bold', 'italic', 'underline', 'list', 'bullet'];

const buildSectionLabel = (index) => `Section ${index + 1}`;

const emptySection = {
  kicker: '',
  heading: '',
  body: '',
  media: '',
  align: 'right',
  accent: 'emerald',
  order: 0
};

const emptyLevel = {
  title: '',
  slug: '',
  description: '',
  thumbnailMedia: '',
  heroMedia: '',
  articleIntro: '',
  articleSections: [],
  published: false,
  order: 0
};

const defaultCourse = {
  title: '',
  slug: '',
  excerpt: '',
  thumbnailMedia: '',
  articleIntro: '',
  articleSections: [],
  curriculum: [],
  level: 'mixed',
  published: false,
  featured: false,
  sortOrder: 0,
  badge: '',
  heroMedia: '',
  scheduleOption: ''
};

const labelClass = 'text-[0.8rem] font-semibold text-slate-600';
const inputClass = 'mt-1 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const checkboxClass = 'rounded border-slate-300 text-slate-900 focus:ring-slate-900/30';

const CourseEditorModal = ({ open, onClose, course, onSaved, onDeleted, variant = 'modal' }) => {
  const [formState, setFormState] = useState(defaultCourse);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormState(defaultCourse);
      setError('');
      setSaving(false);
      setDeleting(false);
      return;
    }
    setFormState({
      ...defaultCourse,
      ...course,
      articleSections: Array.isArray(course?.articleSections) ? [...course.articleSections] : [],
      curriculum: Array.isArray(course?.curriculum) ? [...course.curriculum] : []
    });
  }, [open, course]);

  const isEdit = Boolean(course?._id);

  const handleChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const cleanedSections = (formState.articleSections || [])
        .map((section, index) => ({
          ...section,
          order: index
        }))
        .filter((section) => section.heading || section.body || section.media);

      const cleanedLevels = (formState.curriculum || [])
        .map((level, index) => {
          const cleanedLevelSections = (level.articleSections || [])
            .map((section, sectionIndex) => ({
              ...section,
              order: sectionIndex
            }))
            .filter((section) => section.heading || section.body || section.media);

          return {
            title: level.title,
            slug: level.slug,
            description: level.description,
            thumbnailMedia: level.thumbnailMedia,
            heroMedia: level.heroMedia,
            articleIntro: level.articleIntro,
            articleSections: cleanedLevelSections,
            published: Boolean(level.published),
            order: index
          };
        })
        .filter((level) => level.title || level.description || level.thumbnailMedia || level.heroMedia || level.articleIntro || (level.articleSections || []).length);
      const payload = {
        title: formState.title,
        slug: formState.slug,
        excerpt: formState.excerpt,
        thumbnailMedia: formState.thumbnailMedia,
        articleIntro: formState.articleIntro,
        articleSections: cleanedSections,
        curriculum: cleanedLevels,
        level: formState.level,
        published: formState.published,
        featured: formState.featured,
        sortOrder: Number(formState.sortOrder) || 0,
        badge: formState.badge,
        heroMedia: formState.heroMedia,
        scheduleOption: formState.scheduleOption
      };

      const result = isEdit
        ? await updateCourse(course._id, payload)
        : await createCourse(payload);
      if (onSaved) onSaved(result);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save course');
    } finally {
      setSaving(false);
    }
  };

  const handleSectionChange = (index, field, value) => {
    setFormState((prev) => {
      const sections = [...(prev.articleSections || [])];
      sections[index] = { ...sections[index], [field]: value };
      return { ...prev, articleSections: sections };
    });
  };

  const handleLevelChange = (index, field, value) => {
    setFormState((prev) => {
      const levels = [...(prev.curriculum || [])];
      levels[index] = { ...levels[index], [field]: value };
      return { ...prev, curriculum: levels };
    });
  };

  const handleLevelSectionChange = (levelIndex, sectionIndex, field, value) => {
    setFormState((prev) => {
      const levels = [...(prev.curriculum || [])];
      const level = { ...(levels[levelIndex] || emptyLevel) };
      const sections = [...(level.articleSections || [])];
      sections[sectionIndex] = { ...sections[sectionIndex], [field]: value };
      level.articleSections = sections;
      levels[levelIndex] = level;
      return { ...prev, curriculum: levels };
    });
  };

  const addLevel = () => {
    setFormState((prev) => ({
      ...prev,
      curriculum: [
        ...(prev.curriculum || []),
        { ...emptyLevel, order: (prev.curriculum || []).length }
      ]
    }));
  };

  const removeLevel = (index) => {
    setFormState((prev) => {
      const levels = [...(prev.curriculum || [])];
      levels.splice(index, 1);
      return { ...prev, curriculum: levels };
    });
  };

  const moveLevel = (index, direction) => {
    setFormState((prev) => {
      const levels = [...(prev.curriculum || [])];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= levels.length) return prev;
      const temp = levels[targetIndex];
      levels[targetIndex] = levels[index];
      levels[index] = temp;
      return { ...prev, curriculum: levels };
    });
  };

  const addLevelSection = (levelIndex) => {
    setFormState((prev) => {
      const levels = [...(prev.curriculum || [])];
      const level = { ...(levels[levelIndex] || emptyLevel) };
      const nextIndex = (level.articleSections || []).length;
      level.articleSections = [
        ...(level.articleSections || []),
        { ...emptySection, kicker: buildSectionLabel(nextIndex), order: nextIndex }
      ];
      levels[levelIndex] = level;
      return { ...prev, curriculum: levels };
    });
  };

  const removeLevelSection = (levelIndex, sectionIndex) => {
    setFormState((prev) => {
      const levels = [...(prev.curriculum || [])];
      const level = { ...(levels[levelIndex] || emptyLevel) };
      const sections = [...(level.articleSections || [])];
      sections.splice(sectionIndex, 1);
      level.articleSections = sections;
      levels[levelIndex] = level;
      return { ...prev, curriculum: levels };
    });
  };

  const moveLevelSection = (levelIndex, sectionIndex, direction) => {
    setFormState((prev) => {
      const levels = [...(prev.curriculum || [])];
      const level = { ...(levels[levelIndex] || emptyLevel) };
      const sections = [...(level.articleSections || [])];
      const targetIndex = sectionIndex + direction;
      if (targetIndex < 0 || targetIndex >= sections.length) return prev;
      const temp = sections[targetIndex];
      sections[targetIndex] = sections[sectionIndex];
      sections[sectionIndex] = temp;
      level.articleSections = sections;
      levels[levelIndex] = level;
      return { ...prev, curriculum: levels };
    });
  };

  const addSection = () => {
    setFormState((prev) => ({
      ...prev,
      articleSections: [
        ...(prev.articleSections || []),
        { ...emptySection, kicker: buildSectionLabel((prev.articleSections || []).length), order: (prev.articleSections || []).length }
      ]
    }));
  };

  const removeSection = (index) => {
    setFormState((prev) => {
      const sections = [...(prev.articleSections || [])];
      sections.splice(index, 1);
      return { ...prev, articleSections: sections };
    });
  };

  const moveSection = (index, direction) => {
    setFormState((prev) => {
      const sections = [...(prev.articleSections || [])];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= sections.length) return prev;
      const temp = sections[targetIndex];
      sections[targetIndex] = sections[index];
      sections[index] = temp;
      return { ...prev, articleSections: sections };
    });
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    if (!window.confirm('Delete this course? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      await deleteCourse(course._id);
      if (onDeleted) onDeleted(course._id);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to delete course');
    } finally {
      setDeleting(false);
    }
  };

  const isDrawer = variant === 'drawer';
  const modalClasses = useMemo(
    () => `fixed inset-0 z-50 ${open ? 'visible' : 'invisible'} flex ${isDrawer ? 'items-stretch justify-end' : 'items-center justify-center'} ${isDrawer ? 'p-0' : 'p-4 sm:p-10'}`,
    [open, isDrawer]
  );

  if (!open) return null;

  return (
    <div className={modalClasses}>
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 w-full ${isDrawer ? 'h-full max-w-[620px]' : 'max-w-5xl'}`}>
        <div className={`flex min-h-0 flex-col overflow-hidden border border-white/30 bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-[0_30px_90px_rgba(15,23,42,0.18)] ${isDrawer ? 'min-h-full max-h-full rounded-none sm:rounded-l-[32px]' : 'min-h-[72vh] max-h-[calc(100vh-2rem)] rounded-[32px]'}`}>
          <div className="flex items-start justify-between border-b border-white/60 bg-white/70 px-6 py-4 backdrop-blur sm:px-8 sm:py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{isEdit ? 'Update course' : 'Create course'}</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-900">{isEdit ? formState.title || 'Untitled course' : 'New marketing course'}</h3>
              <p className="mt-1 text-sm text-slate-500">Craft an editorial-ready narrative without leaving the Marketing Hub.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 transition hover:bg-slate-200/60">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form className="flex min-h-0 h-full flex-col" onSubmit={handleSubmit}>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 sm:px-8 sm:py-6">
            {error && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-12">
              <label className={`${labelClass} lg:col-span-7`}>
                Title
                <input
                  type="text"
                  value={formState.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className={inputClass}
                  required
                />
              </label>
              <label className={`${labelClass} lg:col-span-5`}>
                Slug
                <input
                  type="text"
                  value={formState.slug}
                  onChange={(e) => handleChange('slug', e.target.value)}
                  className={inputClass}
                  placeholder="auto-generated if blank"
                />
              </label>
            </div>

            <label className={`${labelClass} mt-6 block`}>
              Excerpt
              <textarea
                value={formState.excerpt || ''}
                onChange={(e) => handleChange('excerpt', e.target.value)}
                className={`${inputClass} min-h-[120px] resize-none`}
              />
            </label>

            <label className={`${labelClass} mt-6 block`}>
              Story intro (optional)
              <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
                <ReactQuill
                  value={formState.articleIntro || ''}
                  onChange={(value) => handleChange('articleIntro', value)}
                  modules={richTextModules}
                  formats={richTextFormats}
                  theme="snow"
                  placeholder="Set the tone for the long-form layout."
                />
              </div>
            </label>

            <div className="mt-6 rounded-[28px] border border-slate-200/80 bg-white/80 p-5 shadow-inner">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Story sections</p>
                  <p className="text-sm text-slate-500">Pair text, imagery, and accents to mirror the public narrative.</p>
                </div>
                <button
                  type="button"
                  onClick={addSection}
                  className="rounded-full border border-slate-300 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700"
                >
                  + Add section
                </button>
              </div>

              {(formState.articleSections || []).length === 0 && (
                <p className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                  No sections yet. Each section renders an alternating text + image story on the public site.
                </p>
              )}

              <div className="mt-4 space-y-4 overflow-y-auto pr-1" style={{ maxHeight: '40vh' }}>
                {(formState.articleSections || []).map((section, index) => (
                  <div key={`section-${index}`} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-700">Section {index + 1}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                        <button type="button" onClick={() => moveSection(index, -1)} disabled={index === 0} className="rounded-full border border-slate-200 px-3 py-1 disabled:opacity-40">
                          ↑
                        </button>
                        <button type="button" onClick={() => moveSection(index, 1)} disabled={index === (formState.articleSections || []).length - 1} className="rounded-full border border-slate-200 px-3 py-1 disabled:opacity-40">
                          ↓
                        </button>
                        <button type="button" onClick={() => removeSection(index)} className="rounded-full border border-rose-200 px-3 py-1 text-rose-600">
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-12">
                      <label className={`${labelClass} lg:col-span-6`}>
                        Section label
                        <input
                          type="text"
                          value={section.kicker || ''}
                          onChange={(e) => handleSectionChange(index, 'kicker', e.target.value)}
                          className={inputClass}
                          placeholder={buildSectionLabel(index)}
                        />
                      </label>
                      <label className={`${labelClass} lg:col-span-6`}>
                        Heading
                        <input
                          type="text"
                          value={section.heading || ''}
                          onChange={(e) => handleSectionChange(index, 'heading', e.target.value)}
                          className={inputClass}
                          placeholder="The promise of this chapter"
                        />
                      </label>
                    </div>

                    <label className={`${labelClass} mt-3 block`}>
                      Body copy
                      <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
                        <ReactQuill
                          value={section.body || ''}
                          onChange={(value) => handleSectionChange(index, 'body', value)}
                          modules={richTextModules}
                          formats={richTextFormats}
                          theme="snow"
                          placeholder="Use bold or bullet lists to highlight key moments."
                        />
                      </div>
                    </label>

                    <div className="mt-3 grid gap-4 lg:grid-cols-12">
                      <div className="lg:col-span-6">
                        <MediaUploadInput
                          label="Section image"
                          value={section.media || ''}
                          onChange={(url) => handleSectionChange(index, 'media', url)}
                          helperText="Appears beside the text with motion."
                          tags={['course', 'section']}
                        />
                      </div>
                      <div className="space-y-3 lg:col-span-6">
                        <label className={`${labelClass} block`}>
                          Image placement
                          <select
                            value={section.align || 'right'}
                            onChange={(e) => handleSectionChange(index, 'align', e.target.value)}
                            className={inputClass}
                          >
                            {alignOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                        <label className={`${labelClass} block`}>
                          Accent color
                          <select
                            value={section.accent || 'emerald'}
                            onChange={(e) => handleSectionChange(index, 'accent', e.target.value)}
                            className={inputClass}
                          >
                            {accentOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              <label className={`${labelClass} lg:col-span-4`}>
                Level
                <select
                  value={formState.level}
                  onChange={(e) => handleChange('level', e.target.value)}
                  className={inputClass}
                >
                  {levelOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className={`${labelClass} lg:col-span-4`}>
                Sort order
                <input
                  type="number"
                  value={formState.sortOrder}
                  onChange={(e) => handleChange('sortOrder', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} lg:col-span-4`}>
                Badge
                <input
                  type="text"
                  value={formState.badge || ''}
                  onChange={(e) => handleChange('badge', e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <MediaUploadInput
                  label="Subject thumbnail"
                  value={formState.thumbnailMedia || ''}
                  onChange={(url) => handleChange('thumbnailMedia', url)}
                  helperText="Used on the landing page and subjects grid (different from the hero image)."
                  tags={['course', 'thumbnail']}
                />
              </div>
              <div className="lg:col-span-5" />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <MediaUploadInput
                  label="Hero media"
                  value={formState.heroMedia || ''}
                  onChange={(url) => handleChange('heroMedia', url)}
                  helperText="Used inside the subject page header (separate from thumbnail)."
                  tags={['course', 'hero']}
                />
              </div>
              <label className={`${labelClass} lg:col-span-5`}>
                Schedule option summary
                <input
                  type="text"
                  value={formState.scheduleOption || ''}
                  onChange={(e) => handleChange('scheduleOption', e.target.value)}
                  className={inputClass}
                  placeholder="e.g. 2x/week, rolling"
                />
              </label>
            </div>

            <div className="mt-6 rounded-[28px] border border-slate-200/80 bg-white/80 p-5 shadow-inner">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Levels</p>
                  <p className="text-sm text-slate-500">Each published level gets its own page with 1–4 sections and left/right image placement.</p>
                </div>
                <button
                  type="button"
                  onClick={addLevel}
                  className="rounded-full border border-slate-300 px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700"
                >
                  + Add level
                </button>
              </div>

              {(formState.curriculum || []).length === 0 && (
                <p className="mt-4 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                  No levels yet.
                </p>
              )}

              <div className="mt-4 space-y-3">
                {(formState.curriculum || []).map((level, levelIndex) => (
                  <details key={`level-${levelIndex}`} className="rounded-2xl border border-slate-100 bg-white shadow-sm" open={levelIndex === 0 && !isEdit}>
                    <summary className="cursor-pointer list-none px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">Level {levelIndex + 1}: {level.title || 'Untitled'}</p>
                          <p className="text-xs text-slate-500">{level.published ? 'Published' : 'Draft'}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                          <button type="button" onClick={() => moveLevel(levelIndex, -1)} disabled={levelIndex === 0} className="rounded-full border border-slate-200 px-3 py-1 disabled:opacity-40">
                            ↑
                          </button>
                          <button type="button" onClick={() => moveLevel(levelIndex, 1)} disabled={levelIndex === (formState.curriculum || []).length - 1} className="rounded-full border border-slate-200 px-3 py-1 disabled:opacity-40">
                            ↓
                          </button>
                          <button type="button" onClick={() => removeLevel(levelIndex)} className="rounded-full border border-rose-200 px-3 py-1 text-rose-600">
                            Remove
                          </button>
                        </div>
                      </div>
                    </summary>

                    <div className="px-4 pb-4">
                      <div className="grid gap-4 lg:grid-cols-12">
                        <label className={`${labelClass} lg:col-span-7`}>
                          Title
                          <input
                            type="text"
                            value={level.title || ''}
                            onChange={(e) => handleLevelChange(levelIndex, 'title', e.target.value)}
                            className={inputClass}
                            placeholder="e.g. Beginner"
                          />
                        </label>
                        <label className={`${labelClass} lg:col-span-5`}>
                          Slug (optional)
                          <input
                            type="text"
                            value={level.slug || ''}
                            onChange={(e) => handleLevelChange(levelIndex, 'slug', e.target.value)}
                            className={inputClass}
                            placeholder="auto-generated if blank"
                          />
                        </label>
                      </div>

                      <label className={`${labelClass} mt-3 block`}>
                        Short description
                        <textarea
                          value={level.description || ''}
                          onChange={(e) => handleLevelChange(levelIndex, 'description', e.target.value)}
                          className={`${inputClass} min-h-[90px] resize-none`}
                        />
                      </label>

                      <div className="mt-3 grid gap-4 lg:grid-cols-12">
                        <div className="lg:col-span-6">
                          <MediaUploadInput
                            label="Level thumbnail"
                            value={level.thumbnailMedia || ''}
                            onChange={(url) => handleLevelChange(levelIndex, 'thumbnailMedia', url)}
                            helperText="Used in the subject page level list (separate from hero)."
                            tags={['course', 'level', 'thumbnail']}
                          />
                        </div>
                        <div className="lg:col-span-6">
                          <MediaUploadInput
                            label="Level hero media"
                            value={level.heroMedia || ''}
                            onChange={(url) => handleLevelChange(levelIndex, 'heroMedia', url)}
                            helperText="Used inside the level detail page."
                            tags={['course', 'level', 'hero']}
                          />
                        </div>
                      </div>

                      <label className={`${labelClass} mt-3 block`}>
                        Level intro (optional)
                        <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
                          <ReactQuill
                            value={level.articleIntro || ''}
                            onChange={(value) => handleLevelChange(levelIndex, 'articleIntro', value)}
                            modules={richTextModules}
                            formats={richTextFormats}
                            theme="snow"
                            placeholder="Write the ~300-word intro for this level."
                          />
                        </div>
                      </label>

                      <div className="mt-3 rounded-[24px] border border-slate-200/80 bg-white/70 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Level sections</p>
                            <p className="text-sm text-slate-500">Add 1–4 sections. Each section supports left/right image alignment.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => addLevelSection(levelIndex)}
                            className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700"
                          >
                            + Add section
                          </button>
                        </div>

                        {(level.articleSections || []).length === 0 && (
                          <p className="mt-3 rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-400">
                            No sections yet.
                          </p>
                        )}

                        <div className="mt-3 space-y-4">
                          {(level.articleSections || []).map((section, sectionIndex) => (
                            <div key={`level-${levelIndex}-section-${sectionIndex}`} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm font-semibold text-slate-700">Section {sectionIndex + 1}</p>
                                <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                                  <button type="button" onClick={() => moveLevelSection(levelIndex, sectionIndex, -1)} disabled={sectionIndex === 0} className="rounded-full border border-slate-200 px-3 py-1 disabled:opacity-40">
                                    ↑
                                  </button>
                                  <button type="button" onClick={() => moveLevelSection(levelIndex, sectionIndex, 1)} disabled={sectionIndex === (level.articleSections || []).length - 1} className="rounded-full border border-slate-200 px-3 py-1 disabled:opacity-40">
                                    ↓
                                  </button>
                                  <button type="button" onClick={() => removeLevelSection(levelIndex, sectionIndex)} className="rounded-full border border-rose-200 px-3 py-1 text-rose-600">
                                    Remove
                                  </button>
                                </div>
                              </div>

                              <div className="mt-4 grid gap-4 lg:grid-cols-12">
                                <label className={`${labelClass} lg:col-span-6`}>
                                  Section label
                                  <input
                                    type="text"
                                    value={section.kicker || ''}
                                    onChange={(e) => handleLevelSectionChange(levelIndex, sectionIndex, 'kicker', e.target.value)}
                                    className={inputClass}
                                    placeholder={buildSectionLabel(sectionIndex)}
                                  />
                                </label>
                                <label className={`${labelClass} lg:col-span-6`}>
                                  Heading
                                  <input
                                    type="text"
                                    value={section.heading || ''}
                                    onChange={(e) => handleLevelSectionChange(levelIndex, sectionIndex, 'heading', e.target.value)}
                                    className={inputClass}
                                  />
                                </label>
                              </div>

                              <label className={`${labelClass} mt-3 block`}>
                                Body copy
                                <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
                                  <ReactQuill
                                    value={section.body || ''}
                                    onChange={(value) => handleLevelSectionChange(levelIndex, sectionIndex, 'body', value)}
                                    modules={richTextModules}
                                    formats={richTextFormats}
                                    theme="snow"
                                  />
                                </div>
                              </label>

                              <div className="mt-3 grid gap-4 lg:grid-cols-12">
                                <div className="lg:col-span-6">
                                  <MediaUploadInput
                                    label="Section image"
                                    value={section.media || ''}
                                    onChange={(url) => handleLevelSectionChange(levelIndex, sectionIndex, 'media', url)}
                                    helperText="Appears beside the text on the level page."
                                    tags={['course', 'level', 'section']}
                                  />
                                </div>
                                <div className="space-y-3 lg:col-span-6">
                                  <label className={`${labelClass} block`}>
                                    Image placement
                                    <select
                                      value={section.align || 'right'}
                                      onChange={(e) => handleLevelSectionChange(levelIndex, sectionIndex, 'align', e.target.value)}
                                      className={inputClass}
                                    >
                                      {alignOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className={`${labelClass} block`}>
                                    Accent color
                                    <select
                                      value={section.accent || 'emerald'}
                                      onChange={(e) => handleLevelSectionChange(levelIndex, sectionIndex, 'accent', e.target.value)}
                                      className={inputClass}
                                    >
                                      {accentOptions.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <label className={`mt-4 inline-flex items-center gap-2 ${labelClass}`}>
                        <input
                          type="checkbox"
                          checked={Boolean(level.published)}
                          onChange={(e) => handleLevelChange(levelIndex, 'published', e.target.checked)}
                          className={checkboxClass}
                        />
                        Published
                      </label>
                    </div>
                  </details>
                ))}
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className={`inline-flex items-center gap-2 ${labelClass}`}>
                <input
                  type="checkbox"
                  checked={Boolean(formState.published)}
                  onChange={(e) => handleChange('published', e.target.checked)}
                  className={checkboxClass}
                />
                Published
              </label>
              <label className={`inline-flex items-center gap-2 ${labelClass}`}>
                <input
                  type="checkbox"
                  checked={Boolean(formState.featured)}
                  onChange={(e) => handleChange('featured', e.target.checked)}
                  className={checkboxClass}
                />
                Featured
              </label>
            </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/70 bg-white/80 px-6 py-4 sm:px-8">
            {isEdit && (
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center gap-2 rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600"
                disabled={deleting || saving}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete course
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-200 bg-white/70 px-5 py-2 text-sm font-medium text-slate-600"
                disabled={saving || deleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-lg"
                disabled={saving || deleting}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create course'}
              </button>
            </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CourseEditorModal;
