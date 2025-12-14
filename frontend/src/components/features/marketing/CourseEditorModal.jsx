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

const defaultCourse = {
  title: '',
  slug: '',
  excerpt: '',
  articleIntro: '',
  articleSections: [],
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

const CourseEditorModal = ({ open, onClose, course, onSaved, onDeleted }) => {
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
      articleSections: Array.isArray(course?.articleSections) ? [...course.articleSections] : []
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
      const payload = {
        title: formState.title,
        slug: formState.slug,
        excerpt: formState.excerpt,
        articleIntro: formState.articleIntro,
        articleSections: cleanedSections,
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

  const modalClasses = useMemo(
    () => `fixed inset-0 z-50 ${open ? 'visible' : 'invisible'} flex items-center justify-center p-4 sm:p-10`,
    [open]
  );

  if (!open) return null;

  return (
    <div className={modalClasses}>
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-5xl">
        <div className="flex min-h-[72vh] max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[32px] border border-white/30 bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
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

          <form className="flex h-full flex-col" onSubmit={handleSubmit}>
            <div className="flex-1 overflow-y-auto px-6 py-4 sm:px-8 sm:py-6">
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
                  label="Hero media"
                  value={formState.heroMedia || ''}
                  onChange={(url) => handleChange('heroMedia', url)}
                  helperText="Used in course cards on the public site."
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
