import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getSiteSettings, updateSiteSettings, uploadMediaAsset } from '../../../api/marketing';
import { Loader2, Plus, Trash2 } from 'lucide-react';

const defaultSettings = {
  hero: {
    eyebrow: '',
    headline: '',
    subheading: '',
    media: '',
    backgroundMedia: '',
    mediaMode: 'card',
    ctas: []
  },
  primaryNavigation: [],
  secondaryNavigation: [],
  contactInfo: {
    email: '',
    phone: '',
    address: '',
    officeHours: ''
  },
  socialLinks: [],
  seoDefaults: {
    title: '',
    description: '',
    image: '',
    twitterHandle: '',
    canonicalUrl: ''
  },
  structuredData: {
    organization: true,
    courses: true,
    reviews: true
  },
  assetLibrary: {
    logoLight: '',
    logoDark: '',
    favicon: ''
  },
  announcement: {
    message: '',
    href: '',
    active: false
  }
};

const blankNavItem = { label: '', href: '' };
const blankSocial = { label: '', url: '', icon: '' };

const labelClass = 'text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-slate-500';
const inputClass = 'mt-1 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const inputClassNoTop = 'w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const chipButtonClass = 'inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-400';

const SiteSettingsPanel = forwardRef(({ onDirtyChange, onSaved }, ref) => {
  const [formState, setFormState] = useState(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingHeroMedia, setUploadingHeroMedia] = useState({ card: false, background: false });
  const [uploadingAssets, setUploadingAssets] = useState({});
  const [status, setStatus] = useState({ type: '', message: '' });
  const [dirty, setDirty] = useState(false);

  const heroCardFileInputRef = useRef(null);
  const heroBackgroundFileInputRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getSiteSettings();
        if (mounted) {
          setFormState((prev) => ({
            ...prev,
            ...data,
            hero: { ...defaultSettings.hero, ...(data?.hero || {}) },
            contactInfo: { ...defaultSettings.contactInfo, ...(data?.contactInfo || {}) },
            seoDefaults: { ...defaultSettings.seoDefaults, ...(data?.seoDefaults || {}) },
            structuredData: { ...defaultSettings.structuredData, ...(data?.structuredData || {}) },
            assetLibrary: { ...defaultSettings.assetLibrary, ...(data?.assetLibrary || {}) },
            announcement: { ...defaultSettings.announcement, ...(data?.announcement || {}) },
            primaryNavigation: data?.primaryNavigation || [],
            secondaryNavigation: data?.secondaryNavigation || [],
            socialLinks: data?.socialLinks || []
          }));
          setDirty(false);
          onDirtyChange?.(false);
      }
      } catch (error) {
        console.error('Failed to load marketing settings', error);
        if (mounted) {
          setStatus({ type: 'error', message: 'Failed to load settings. Please retry.' });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleNestedChange = (path, value) => {
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
    setFormState((prev) => {
      const next = { ...prev };
      let ref = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i];
        ref[key] = Array.isArray(ref[key]) ? [...ref[key]] : { ...(ref[key] || {}) };
        ref = ref[key];
      }
      ref[path[path.length - 1]] = value;
      return next;
    });
  };

  const handleHeroImageUpload = async ({ file, targetField, kind }) => {
    if (!file) return;

    setStatus({ type: '', message: '' });
    setUploadingHeroMedia((prev) => ({ ...prev, [kind]: true }));

    try {
      const uploaded = await uploadMediaAsset({ file, tags: ['hero', kind] });
      if (!uploaded?.url) throw new Error('Upload succeeded but no URL returned');
      handleNestedChange(['hero', targetField], uploaded.url);
    } catch (error) {
      console.error('Hero image upload failed', error);
      setStatus({
        type: 'error',
        message: error?.response?.data?.message || error?.message || 'Failed to upload image. Please try again.'
      });
    } finally {
      setUploadingHeroMedia((prev) => ({ ...prev, [kind]: false }));
    }
  };

  const handleAssetLibraryUpload = async ({ field, file }) => {
    if (!file) return;

    setStatus({ type: '', message: '' });
    setUploadingAssets((prev) => ({ ...prev, [field]: true }));

    try {
      const uploaded = await uploadMediaAsset({ file, tags: ['asset-library', field] });
      if (!uploaded?.url) throw new Error('Upload succeeded but no URL returned');
      handleNestedChange(['assetLibrary', field], uploaded.url);
    } catch (error) {
      console.error('Asset upload failed', error);
      setStatus({
        type: 'error',
        message: error?.response?.data?.message || error?.message || 'Failed to upload asset. Please try again.'
      });
    } finally {
      setUploadingAssets((prev) => ({ ...prev, [field]: false }));
    }
  };

  const handleArrayChange = (key, index, field, value) => {
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
    setFormState((prev) => {
      const list = [...(prev[key] || [])];
      list[index] = { ...list[index], [field]: value };
      return { ...prev, [key]: list };
    });
  };

  const removeFromArray = (key, index) => {
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
    setFormState((prev) => {
      const list = [...(prev[key] || [])];
      list.splice(index, 1);
      return { ...prev, [key]: list };
    });
  };

  const addToArray = (key, blank) => {
    if (!dirty) {
      setDirty(true);
      onDirtyChange?.(true);
    }
    setFormState((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), blank]
    }));
  };

  const save = async () => {
    setSaving(true);
    setStatus({ type: '', message: '' });
    try {
      await updateSiteSettings(formState);
      setStatus({ type: 'success', message: 'Settings saved successfully.' });
      setDirty(false);
      onDirtyChange?.(false);
      onSaved?.();
    } catch (error) {
      console.error('Failed to save site settings', error);
      setStatus({ type: 'error', message: error?.response?.data?.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    await save();
  };

  useImperativeHandle(ref, () => ({
    save,
    isDirty: () => dirty,
    isSaving: () => saving
  }), [dirty, saving, formState]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-gray-500" />
        <span className="ml-2 text-sm text-gray-500">Loading settings…</span>
      </div>
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {status.message && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${status.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {status.message}
        </div>
      )}

      <section className="rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Hero Banner</h2>
            <p className="text-sm text-slate-500">Control the headline, media, and hero image layout.</p>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Homepage hero</span>
        </header>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-600">
          These values are the default hero copy for landing pages set to <span className="font-semibold">Use Site Settings</span> in the Landing Builder. Pages set to <span className="font-semibold">Custom for this page</span> will not change when you edit these fields.
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <label className={labelClass}>
            Eyebrow
            <input
              type="text"
              value={formState.hero?.eyebrow || ''}
              onChange={(e) => handleNestedChange(['hero', 'eyebrow'], e.target.value)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Headline
            <input
              type="text"
              value={formState.hero?.headline || ''}
              onChange={(e) => handleNestedChange(['hero', 'headline'], e.target.value)}
              className={inputClass}
            />
          </label>
          <label className={labelClass}>
            Subheading
            <input
              type="text"
              value={formState.hero?.subheading || ''}
              onChange={(e) => handleNestedChange(['hero', 'subheading'], e.target.value)}
              className={inputClass}
            />
          </label>

          <label className={labelClass}>
            Hero image mode
            <select
              value={formState.hero?.mediaMode || 'card'}
              onChange={(e) => handleNestedChange(['hero', 'mediaMode'], e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
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
                value={formState.hero?.media || ''}
                onChange={(e) => handleNestedChange(['hero', 'media'], e.target.value)}
                className={`${inputClassNoTop} flex-1`}
                placeholder="Upload an image (or paste a URL)"
              />
              <input
                ref={heroCardFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  e.target.value = '';
                  handleHeroImageUpload({ file, targetField: 'media', kind: 'card' });
                }}
              />
              <button
                type="button"
                className={`${chipButtonClass} normal-case mt-2.5`}
                onClick={() => heroCardFileInputRef.current?.click()}
                disabled={uploadingHeroMedia.card}
              >
                {uploadingHeroMedia.card ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Upload image
              </button>
            </div>
          </label>

          <label className={labelClass}>
            Hero background image URL
            <div className="mt-1 flex items-start gap-2">
              <input
                type="text"
                value={formState.hero?.backgroundMedia || ''}
                onChange={(e) => handleNestedChange(['hero', 'backgroundMedia'], e.target.value)}
                className={`${inputClassNoTop} flex-1`}
                placeholder="Upload an image (or paste a URL)"
              />
              <input
                ref={heroBackgroundFileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  e.target.value = '';
                  handleHeroImageUpload({ file, targetField: 'backgroundMedia', kind: 'background' });
                }}
              />
              <button
                type="button"
                className={`${chipButtonClass} normal-case mt-2.5`}
                onClick={() => heroBackgroundFileInputRef.current?.click()}
                disabled={uploadingHeroMedia.background}
              >
                {uploadingHeroMedia.background ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Upload image
              </button>
            </div>
          </label>
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Navigation & Contact</h2>
            <p className="text-sm text-slate-500">Update the menu items and contact details surfaced everywhere.</p>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Site chrome</span>
        </header>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          {['primaryNavigation', 'secondaryNavigation'].map((listKey) => (
            <div key={listKey} className="rounded-2xl border border-slate-100 bg-white/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-700">{listKey === 'primaryNavigation' ? 'Primary navigation' : 'Secondary navigation'}</p>
                <button type="button" onClick={() => addToArray(listKey, blankNavItem)} className={chipButtonClass}>
                  <Plus className="h-3 w-3" /> Add link
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {(formState[listKey] || []).length === 0 && (
                  <p className="text-xs text-slate-400">No links yet.</p>
                )}
                {(formState[listKey] || []).map((item, idx) => (
                  <div key={`${listKey}-${idx}`} className="grid gap-2 sm:grid-cols-[1fr,1fr,auto]">
                    <input
                      type="text"
                      value={item.label || ''}
                      onChange={(e) => handleArrayChange(listKey, idx, 'label', e.target.value)}
                      className={inputClass}
                      placeholder="Label"
                    />
                    <input
                      type="text"
                      value={item.href || ''}
                      onChange={(e) => handleArrayChange(listKey, idx, 'href', e.target.value)}
                      className={inputClass}
                      placeholder="/courses"
                    />
                    <button type="button" onClick={() => removeFromArray(listKey, idx)} className="rounded-full border border-rose-100 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(formState.contactInfo || {}).map(([field, value]) => (
            <label key={field} className={labelClass}>
              {field}
              <input
                type="text"
                value={value || ''}
                onChange={(e) => handleNestedChange(['contactInfo', field], e.target.value)}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Social Links</h2>
            <p className="text-sm text-slate-500">Control footer icons and tracking URLs.</p>
          </div>
          <button type="button" onClick={() => addToArray('socialLinks', blankSocial)} className={chipButtonClass}>
            <Plus className="h-3 w-3" /> Add link
          </button>
        </header>
        <div className="mt-4 space-y-3">
          {(formState.socialLinks || []).length === 0 && (
            <p className="text-xs text-slate-400">No social links configured.</p>
          )}
          {(formState.socialLinks || []).map((link, idx) => (
            <div key={`social-${idx}`} className="grid gap-3 md:grid-cols-[1fr,1.4fr,1fr,auto]">
              {['label', 'url', 'icon'].map((field) => (
                <input
                  key={`${field}-${idx}`}
                  type="text"
                  value={link[field] || ''}
                  onChange={(e) => handleArrayChange('socialLinks', idx, field, e.target.value)}
                  className={inputClass}
                  placeholder={field === 'icon' ? 'lucide:twitter' : field === 'label' ? 'Twitter' : 'https://twitter.com/...'}
                />
              ))}
              <button type="button" onClick={() => removeFromArray('socialLinks', idx)} className="self-center rounded-full border border-rose-100 px-3 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white/80 p-5 shadow-sm">
        <header>
          <h2 className="text-lg font-semibold text-slate-900">SEO Defaults & Announcement</h2>
          <p className="text-sm text-slate-500">Base metadata, schema markup, and the global banner.</p>
        </header>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(formState.seoDefaults || {}).map(([field, value]) => (
            <label key={field} className={labelClass}>
              {field.replace(/([A-Z])/g, ' $1')}
              <input
                type="text"
                value={value || ''}
                onChange={(e) => handleNestedChange(['seoDefaults', field], e.target.value)}
                className={inputClass}
              />
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {Object.entries(formState.structuredData || {}).map(([field, value]) => (
            <label key={field} className="inline-flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => handleNestedChange(['structuredData', field], e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/30"
              />
              Enable {field}
            </label>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(formState.assetLibrary || {}).map(([field, value]) => {
            const inputId = `asset-${field}`;
            const uploading = Boolean(uploadingAssets[field]);
            const accept = field === 'favicon'
              ? 'image/*,.ico'
              : 'image/*';
            return (
              <label key={field} className={labelClass}>
                {field}
                <div className="mt-1 flex items-start gap-2">
                  <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => handleNestedChange(['assetLibrary', field], e.target.value)}
                    className={`${inputClassNoTop} flex-1`}
                    placeholder="Upload or paste a URL"
                  />
                  <input
                    id={inputId}
                    type="file"
                    accept={accept}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files && e.target.files[0];
                      e.target.value = '';
                      handleAssetLibraryUpload({ field, file });
                    }}
                  />
                  <button
                    type="button"
                    className={`${chipButtonClass} normal-case mt-2`}
                    onClick={() => document.getElementById(inputId)?.click()}
                    disabled={uploading}
                  >
                    {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Upload
                  </button>
                </div>
              </label>
            );
          })}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {['message', 'href'].map((field) => (
            <label key={field} className={labelClass}>
              Announcement {field}
              <input
                type="text"
                value={formState.announcement?.[field] || ''}
                onChange={(e) => handleNestedChange(['announcement', field], e.target.value)}
                className={inputClass}
              />
            </label>
          ))}
          <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={Boolean(formState.announcement?.active)}
              onChange={(e) => handleNestedChange(['announcement', 'active'], e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/30"
            />
            Announcement active
          </label>
        </div>
      </section>

    </form>
  );
});

export default SiteSettingsPanel;
