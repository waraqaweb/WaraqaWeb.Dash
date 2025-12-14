import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { createTeacherProfile, updateTeacherProfile, deleteTeacherProfile } from '../../../api/marketing';
import MediaUploadInput from './MediaUploadInput';

const defaultTeacher = {
  firstName: '',
  lastName: '',
  role: '',
  country: '',
  gender: '',
  avatar: '',
  yearsExperience: '',
  quote: '',
  bio: '',
  languagesText: '',
  certificatesText: '',
  additionalCertificatesText: '',
  educationText: '',
  teachesCoursesText: '',
  published: false
};

const genderOptions = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];

const labelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-slate-500';
const inputClass = 'mt-1.5 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const textareaClass = `${inputClass} min-h-[110px]`;
const checkboxClass = 'rounded border-slate-300 text-slate-900 focus:ring-slate-900/30';

const parseList = (value = '') =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const TeacherProfileModal = ({ open, onClose, teacher, onSaved, onDeleted }) => {
  const [formState, setFormState] = useState(defaultTeacher);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormState(defaultTeacher);
      setError('');
      setSaving(false);
      setDeleting(false);
      return;
    }

    setFormState({
      ...defaultTeacher,
      ...teacher,
      languagesText: (teacher?.languages || []).join(', '),
      certificatesText: (teacher?.credentials || []).join('\n'),
      additionalCertificatesText: (teacher?.additionalCertificates || []).join('\n'),
      educationText: (teacher?.education || []).join('\n'),
      teachesCoursesText: (teacher?.teachesCourses || []).join('\n')
    });
  }, [open, teacher]);

  const isEdit = Boolean(teacher?._id);

  const handleChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const buildPayload = () => {
    const languages = parseList(formState.languagesText);
    const credentials = parseList(formState.certificatesText);
    const additionalCertificates = parseList(formState.additionalCertificatesText);
    const education = parseList(formState.educationText);
    const teachesCourses = parseList(formState.teachesCoursesText);

    return {
      firstName: formState.firstName,
      lastName: formState.lastName,
      role: formState.role,
      country: formState.country,
      gender: formState.gender,
      avatar: formState.avatar,
      quote: formState.quote,
      bio: formState.bio,
      yearsExperience: formState.yearsExperience ? Number(formState.yearsExperience) : undefined,
      languages,
      credentials,
      additionalCertificates,
      education,
      teachesCourses,
      published: Boolean(formState.published)
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = buildPayload();
      const result = isEdit
        ? await updateTeacherProfile(teacher._id, payload)
        : await createTeacherProfile(payload);
      if (onSaved) onSaved(result);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save teacher profile');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    if (!window.confirm('Delete this teacher profile? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      await deleteTeacherProfile(teacher._id);
      if (onDeleted) onDeleted(teacher._id);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to delete teacher profile');
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
      <div className="relative z-10 w-full max-w-4xl">
        <div className="flex min-h-[70vh] max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[32px] border border-white/30 bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-[0_30px_90px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between border-b border-white/60 bg-white/80 px-6 py-4 backdrop-blur sm:px-8 sm:py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{isEdit ? 'Update teacher' : 'Create teacher'}</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-900">{isEdit ? formState.firstName || 'Untitled teacher' : 'New teacher profile'}</h3>
              <p className="mt-1 text-sm text-slate-500">Spotlight the educators front-loading your marketing narrative.</p>
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

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  First name
                  <input
                    type="text"
                    value={formState.firstName}
                    onChange={(e) => handleChange('firstName', e.target.value)}
                    className={inputClass}
                    required
                  />
                </label>
                <label className={labelClass}>
                  Last name
                  <input
                    type="text"
                    value={formState.lastName}
                    onChange={(e) => handleChange('lastName', e.target.value)}
                    className={inputClass}
                    placeholder="shown as initial on site"
                  />
                </label>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <label className={labelClass}>
                  Role / specialty
                  <input
                    type="text"
                    value={formState.role || ''}
                    onChange={(e) => handleChange('role', e.target.value)}
                    className={inputClass}
                    placeholder="Senior Quran Instructor"
                  />
                </label>
                <label className={labelClass}>
                  Gender
                  <select
                    value={formState.gender || ''}
                    onChange={(e) => handleChange('gender', e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select</option>
                    {genderOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Country
                  <input
                    type="text"
                    value={formState.country || ''}
                    onChange={(e) => handleChange('country', e.target.value)}
                    className={inputClass}
                    placeholder="Egypt"
                  />
                </label>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <label className={labelClass}>
                  Years experience
                  <input
                    type="number"
                    min="0"
                    value={formState.yearsExperience}
                    onChange={(e) => handleChange('yearsExperience', e.target.value)}
                    className={inputClass}
                    placeholder="8"
                  />
                </label>
                <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                  <MediaUploadInput
                    label="Profile image"
                    value={formState.avatar || ''}
                    onChange={(url) => handleChange('avatar', url)}
                    helperText="Square images at least 400px recommended."
                    tags={['teacher', 'profile']}
                  />
                </div>
                <label className={labelClass}>
                  Languages
                  <input
                    type="text"
                    value={formState.languagesText}
                    onChange={(e) => handleChange('languagesText', e.target.value)}
                    className={inputClass}
                    placeholder="Arabic, English"
                  />
                </label>
              </div>

              <label className={`${labelClass} mt-6`}>
                Bio
                <textarea
                  value={formState.bio || ''}
                  onChange={(e) => handleChange('bio', e.target.value)}
                  className={textareaClass}
                  placeholder="Short teaching story"
                />
              </label>

              <label className={`${labelClass} mt-6`}>
                Quote
                <input
                  type="text"
                  value={formState.quote || ''}
                  onChange={(e) => handleChange('quote', e.target.value)}
                  className={inputClass}
                  placeholder="Students deserve..."
                />
              </label>

              <label className={`${labelClass} mt-6`}>
                Certificates & education (one per line)
                <textarea
                  value={formState.certificatesText}
                  onChange={(e) => handleChange('certificatesText', e.target.value)}
                  className={textareaClass}
                  placeholder={'Ijazah in Hafs\nBA in Islamic Studies'}
                />
              </label>

              <label className={`${labelClass} mt-6`}>
                Additional certificates
                <textarea
                  value={formState.additionalCertificatesText}
                  onChange={(e) => handleChange('additionalCertificatesText', e.target.value)}
                  className={textareaClass}
                  placeholder={'Child safeguarding\nTESOL'}
                />
              </label>

              <label className={`${labelClass} mt-6`}>
                Education history
                <textarea
                  value={formState.educationText}
                  onChange={(e) => handleChange('educationText', e.target.value)}
                  className={textareaClass}
                  placeholder={'Al-Azhar University, BA Quranic Sciences'}
                />
              </label>

              <label className={`${labelClass} mt-6`}>
                Courses taught (one per line)
                <textarea
                  value={formState.teachesCoursesText}
                  onChange={(e) => handleChange('teachesCoursesText', e.target.value)}
                  className={textareaClass}
                  placeholder={'Beginner Quran\nArabic for Kids'}
                />
              </label>

              <div className="mt-6 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.published)}
                    onChange={(e) => handleChange('published', e.target.checked)}
                    className={checkboxClass}
                  />
                  Published to site
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
                    Delete profile
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
                    {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create profile'}
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

export default TeacherProfileModal;
