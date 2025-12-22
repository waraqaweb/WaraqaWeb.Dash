import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { createTestimonial, updateTestimonial, deleteTestimonial } from '../../../api/marketing';

const defaultTestimonial = {
  guardianName: '',
  guardianRelation: '',
  studentName: '',
  quote: '',
  rating: 5,
  locale: 'en',
  course: '',
  showOnHomepage: false,
  featured: false,
  published: false
};

const localeOptions = ['en', 'ar', 'fr'];

const labelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-slate-500';
const inputClass = 'mt-1.5 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const textareaClass = `${inputClass} min-h-[110px]`;
const checkboxClass = 'rounded border-slate-300 text-slate-900 focus:ring-slate-900/30';

const TestimonialModal = ({ open, onClose, testimonial, onSaved, onDeleted, courses = [], variant = 'modal' }) => {
  const [formState, setFormState] = useState(defaultTestimonial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormState(defaultTestimonial);
      setError('');
      setSaving(false);
      setDeleting(false);
      return;
    }

    setFormState({
      ...defaultTestimonial,
      ...testimonial,
      course: testimonial?.course?._id || testimonial?.course || ''
    });
  }, [open, testimonial]);

  const isEdit = Boolean(testimonial?._id);

  const handleChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        guardianName: formState.guardianName,
        guardianRelation: formState.guardianRelation,
        studentName: formState.studentName,
        quote: formState.quote,
        rating: Number(formState.rating) || 5,
        locale: formState.locale || 'en',
        showOnHomepage: Boolean(formState.showOnHomepage),
        featured: Boolean(formState.featured),
        published: Boolean(formState.published),
        course: formState.course || undefined
      };
      const result = isEdit
        ? await updateTestimonial(testimonial._id, payload)
        : await createTestimonial(payload);
      if (onSaved) onSaved(result);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save testimonial');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    if (!window.confirm('Delete this testimonial? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      await deleteTestimonial(testimonial._id);
      if (onDeleted) onDeleted(testimonial._id);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to delete testimonial');
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
      <div className={`relative z-10 w-full ${isDrawer ? 'h-full max-w-[560px]' : 'max-w-3xl'}`}>
        <div className={`flex min-h-0 flex-col overflow-hidden border border-white/30 bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-[0_30px_90px_rgba(15,23,42,0.18)] ${isDrawer ? 'min-h-full max-h-full rounded-none sm:rounded-l-[32px]' : 'min-h-[60vh] max-h-[calc(100vh-2rem)] rounded-[32px]'}`}>
          <div className="flex items-start justify-between border-b border-white/60 bg-white/80 px-6 py-4 backdrop-blur sm:px-8 sm:py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{isEdit ? 'Update testimonial' : 'Create testimonial'}</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-900">{isEdit ? formState.guardianName || 'Untitled testimonial' : 'New testimonial'}</h3>
              <p className="mt-1 text-sm text-slate-500">Capture guardian quotes and decide where they surface.</p>
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

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Guardian / parent name
                  <input
                    type="text"
                    value={formState.guardianName}
                    onChange={(e) => handleChange('guardianName', e.target.value)}
                    className={inputClass}
                    placeholder="Umm Ahmad"
                  />
                </label>
                <label className={labelClass}>
                  Relationship
                  <input
                    type="text"
                    value={formState.guardianRelation}
                    onChange={(e) => handleChange('guardianRelation', e.target.value)}
                    className={inputClass}
                    placeholder="Mother"
                  />
                </label>
              </div>

              <label className={`${labelClass} mt-6`}>
                Student name
                <input
                  type="text"
                  value={formState.studentName}
                  onChange={(e) => handleChange('studentName', e.target.value)}
                  className={inputClass}
                  placeholder="Ahmad"
                />
              </label>

              <label className={`${labelClass} mt-6`}>
                Quote
                <textarea
                  value={formState.quote}
                  onChange={(e) => handleChange('quote', e.target.value)}
                  className={textareaClass}
                  placeholder="Share the guardian feedback"
                  required
                />
              </label>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <label className={labelClass}>
                  Rating (1-5)
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formState.rating}
                    onChange={(e) => handleChange('rating', e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className={labelClass}>
                  Locale
                  <select
                    value={formState.locale}
                    onChange={(e) => handleChange('locale', e.target.value)}
                    className={inputClass}
                  >
                    {localeOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Course (optional)
                  <select
                    value={formState.course || ''}
                    onChange={(e) => handleChange('course', e.target.value)}
                    className={inputClass}
                  >
                    <option value="">-- None --</option>
                    {courses.map((course) => (
                      <option key={course._id} value={course._id}>{course.title}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-6 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.showOnHomepage)}
                    onChange={(e) => handleChange('showOnHomepage', e.target.checked)}
                    className={checkboxClass}
                  />
                  Show on homepage
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.featured)}
                    onChange={(e) => handleChange('featured', e.target.checked)}
                    className={checkboxClass}
                  />
                  Featured highlight
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.published)}
                    onChange={(e) => handleChange('published', e.target.checked)}
                    className={checkboxClass}
                  />
                  Published
                </label>
              </div>
            </div>

            <div className="border-t border-slate-200/70 bg-white/80 px-6 py-4 sm:px-8 sm:py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {isEdit && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex items-center gap-2 rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600"
                    disabled={deleting || saving}
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Delete testimonial
                  </button>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
                    disabled={saving || deleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-70"
                    disabled={saving || deleting}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create testimonial'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default TestimonialModal;
