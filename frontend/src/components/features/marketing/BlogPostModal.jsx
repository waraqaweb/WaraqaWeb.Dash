import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { createBlogPost, updateBlogPost, deleteBlogPost } from '../../../api/marketing';
import MediaUploadInput from './MediaUploadInput';

const defaultPost = {
  title: '',
  slug: '',
  summary: '',
  heroImage: '',
  category: '',
  tagsText: '',
  language: 'en',
  contentDirection: 'ltr',
  content: '',
  articleIntro: '',
  articleSections: [],
  status: 'draft',
  featured: false,
  publishedAt: '',
  scheduledAt: '',
  locale: 'en'
};

const labelClass = 'text-[0.8rem] font-semibold text-slate-600';
const inputClass = 'mt-1 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const checkboxClass = 'rounded border-slate-300 text-slate-900 focus:ring-slate-900/30';

const languageOptions = [
  { value: 'en', label: 'English', direction: 'ltr' },
  { value: 'ar', label: 'Arabic', direction: 'rtl' },
  { value: 'fr', label: 'French', direction: 'ltr' }
];

const statusOptions = [
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' }
];

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ align: [] }, { direction: 'rtl' }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote', 'link'],
    [{ color: [] }, { background: [] }],
    [{ size: ['small', false, 'large', 'huge'] }],
    ['clean']
  ]
};

const quillFormats = ['header', 'font', 'size', 'bold', 'italic', 'underline', 'strike', 'blockquote', 'list', 'bullet', 'link', 'color', 'background', 'align', 'direction'];

const sectionModules = {
  toolbar: [
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['clean']
  ]
};

const sectionFormats = ['bold', 'italic', 'underline', 'list', 'bullet'];

const accentOptions = [
  { value: 'rose', label: 'Rose' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'amber', label: 'Amber' },
  { value: 'teal', label: 'Teal' }
];

const alignOptions = [
  { value: 'right', label: 'Image on the right' },
  { value: 'left', label: 'Image on the left' }
];

const emptySection = {
  kicker: '',
  heading: '',
  body: '',
  media: '',
  align: 'right',
  accent: 'rose',
  order: 0
};

const buildSectionLabel = (index) => `Section ${index + 1}`;

const parseTags = (value = '') =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const BlogPostModal = ({ open, onClose, post, onSaved, onDeleted }) => {
  const [formState, setFormState] = useState(defaultPost);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormState(defaultPost);
      setError('');
      setSaving(false);
      setDeleting(false);
      return;
    }

    setFormState({
      ...defaultPost,
      ...post,
      tagsText: (post?.tags || []).join(', '),
      content: typeof post?.content === 'string' ? post.content : JSON.stringify(post?.content || ''),
      articleSections: Array.isArray(post?.articleSections) ? [...post.articleSections] : []
    });
  }, [open, post]);

  const isEdit = Boolean(post?._id);

  const handleChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleLanguageChange = (value) => {
    const selected = languageOptions.find((option) => option.value === value);
    setFormState((prev) => ({
      ...prev,
      language: value,
      contentDirection: selected?.direction || prev.contentDirection
    }));
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
        summary: formState.summary,
        heroImage: formState.heroImage,
        category: formState.category,
        content: formState.content,
        articleIntro: formState.articleIntro,
        articleSections: cleanedSections,
        language: formState.language,
        contentDirection: formState.contentDirection,
        tags: parseTags(formState.tagsText),
        status: formState.status,
        featured: Boolean(formState.featured),
        publishedAt: formState.publishedAt || undefined,
        scheduledAt: formState.scheduledAt || undefined
      };
      const result = isEdit
        ? await updateBlogPost(post._id, payload)
        : await createBlogPost(payload);
      if (onSaved) onSaved(result);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save blog post');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    if (!window.confirm('Delete this blog post? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      await deleteBlogPost(post._id);
      if (onDeleted) onDeleted(post._id);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to delete blog post');
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
      <div className="relative z-10 w-full max-w-6xl">
        <div className="flex min-h-[74vh] max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[32px] border border-white/30 bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between border-b border-white/60 bg-white/70 px-6 py-4 backdrop-blur sm:px-8 sm:py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{isEdit ? 'Update blog post' : 'Create blog post'}</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-900">{isEdit ? formState.title || 'Untitled post' : 'New blog article'}</h3>
              <p className="mt-1 text-sm text-slate-500">Give the editorial team a full-width control deck for immersive stories.</p>
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
              Summary
              <textarea
                value={formState.summary}
                onChange={(e) => handleChange('summary', e.target.value)}
                className={`${inputClass} min-h-[120px] resize-none`}
                placeholder="Leader paragraph shown in cards"
              />
            </label>

            <label className={`${labelClass} mt-6 block`}>
              Story intro (optional)
              <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
                <ReactQuill
                  value={formState.articleIntro || ''}
                  onChange={(value) => handleChange('articleIntro', value)}
                  modules={sectionModules}
                  formats={sectionFormats}
                  theme="snow"
                  placeholder="Use this to set the tone before the sections start."
                />
              </div>
            </label>

            <div className="mt-6 rounded-[28px] border border-slate-200/80 bg-white/80 p-5 shadow-inner">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Narrative sections</p>
                  <p className="text-sm text-slate-500">Mirror the course layout with alternating beats.</p>
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
                  No sections yet. These power the immersive layout on the public article.
                </p>
              )}

              <div className="mt-4 space-y-4 overflow-y-auto pr-1" style={{ maxHeight: '40vh' }}>
                {(formState.articleSections || []).map((section, index) => (
                  <div key={`blog-section-${index}`} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
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
                          placeholder="Section promise"
                        />
                      </label>
                    </div>

                    <label className={`${labelClass} mt-3 block`}>
                      Body copy
                      <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
                        <ReactQuill
                          value={section.body || ''}
                          onChange={(value) => handleSectionChange(index, 'body', value)}
                          modules={sectionModules}
                          formats={sectionFormats}
                          theme="snow"
                          placeholder="Write the detailed paragraph."
                        />
                      </div>
                    </label>

                    <div className="mt-3 grid gap-4 lg:grid-cols-12">
                      <div className="lg:col-span-6">
                        <MediaUploadInput
                          label="Section image"
                          value={section.media || ''}
                          onChange={(url) => handleSectionChange(index, 'media', url)}
                          helperText="Appears beside the story block."
                          tags={['blog', 'section']}
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
                            value={section.accent || 'rose'}
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
              <div className="lg:col-span-7">
                <MediaUploadInput
                  label="Hero image"
                  value={formState.heroImage || ''}
                  onChange={(url) => handleChange('heroImage', url)}
                  helperText="Displayed on blog cards and the article page."
                  tags={['blog', 'hero']}
                />
              </div>
              <label className={`${labelClass} lg:col-span-5`}>
                Category
                <input
                  type="text"
                  value={formState.category || ''}
                  onChange={(e) => handleChange('category', e.target.value)}
                  className={inputClass}
                  placeholder="Curriculum, Teacher stories..."
                />
              </label>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              <label className={`${labelClass} lg:col-span-4`}>
                Language
                <select
                  value={formState.language}
                  onChange={(e) => handleLanguageChange(e.target.value)}
                  className={inputClass}
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className={`${labelClass} lg:col-span-4`}>
                Content direction
                <select
                  value={formState.contentDirection}
                  onChange={(e) => handleChange('contentDirection', e.target.value)}
                  className={inputClass}
                >
                  <option value="ltr">Left to right</option>
                  <option value="rtl">Right to left</option>
                </select>
              </label>
              <label className={`${labelClass} lg:col-span-4`}>
                Tags
                <input
                  type="text"
                  value={formState.tagsText}
                  onChange={(e) => handleChange('tagsText', e.target.value)}
                  className={inputClass}
                  placeholder="comma separated"
                />
              </label>
            </div>

            <label className={`${labelClass} mt-6 block`}>
              Body content
              <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200/80 bg-white">
                <ReactQuill
                  value={formState.content}
                  onChange={(value) => handleChange('content', value)}
                  modules={quillModules}
                  formats={quillFormats}
                  theme="snow"
                  placeholder="Start writing..."
                />
              </div>
            </label>

            <div className="mt-6 grid gap-6 lg:grid-cols-12">
              <label className={`${labelClass} lg:col-span-4`}>
                Status
                <select
                  value={formState.status}
                  onChange={(e) => handleChange('status', e.target.value)}
                  className={inputClass}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className={`${labelClass} lg:col-span-4`}>
                Publish at
                <input
                  type="datetime-local"
                  value={formState.publishedAt ? formState.publishedAt.slice(0, 16) : ''}
                  onChange={(e) => handleChange('publishedAt', e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className={`${labelClass} lg:col-span-4`}>
                Schedule at
                <input
                  type="datetime-local"
                  value={formState.scheduledAt ? formState.scheduledAt.slice(0, 16) : ''}
                  onChange={(e) => handleChange('scheduledAt', e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className={`inline-flex items-center gap-2 ${labelClass}`}>
                <input
                  type="checkbox"
                  checked={Boolean(formState.featured)}
                  onChange={(e) => handleChange('featured', e.target.checked)}
                  className={checkboxClass}
                />
                Feature this post
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
                Delete post
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
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create post'}
              </button>
            </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default BlogPostModal;
