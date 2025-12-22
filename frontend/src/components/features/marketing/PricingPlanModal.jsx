import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader2, Trash2 } from 'lucide-react';
import { createPricingPlan, updatePricingPlan, deletePricingPlan } from '../../../api/marketing';

const defaultPlan = {
  key: '',
  headline: '',
  subheading: '',
  audienceTag: '',
  trialInfo: '',
  depositInfo: '',
  ctaLabel: '',
  ctaHref: '',
  published: false,
  highlight: false,
  sortOrder: 0,
  price: {
    amount: '',
    currency: 'USD',
    cadence: 'per hour'
  },
  featuresText: ''
};

const cadenceOptions = ['per hour', 'per month', 'per year'];
const currencyOptions = ['USD', 'EUR', 'GBP', 'EGO'];

const labelClass = 'block text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-slate-500';
const inputClass = 'mt-1.5 w-full rounded-2xl border border-slate-200/80 bg-white/80 px-3 py-2.5 text-sm text-slate-900 shadow-inner focus:border-slate-500 focus:ring-2 focus:ring-slate-200';
const textareaClass = `${inputClass} min-h-[120px]`;
const checkboxClass = 'rounded border-slate-300 text-slate-900 focus:ring-slate-900/30';

const PricingPlanModal = ({ open, onClose, plan, onSaved, onDeleted, variant = 'modal' }) => {
  const [formState, setFormState] = useState(defaultPlan);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormState(defaultPlan);
      setError('');
      setSaving(false);
      setDeleting(false);
      return;
    }

    setFormState({
      ...defaultPlan,
      ...plan,
      price: {
        ...defaultPlan.price,
        ...(plan?.price || {}),
        amount: plan?.price?.amount ?? ''
      },
      featuresText: (plan?.features || []).join('\n')
    });
  }, [open, plan]);

  const isEdit = Boolean(plan?._id);

  const handleChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handlePriceChange = (field, value) => {
    setFormState((prev) => ({
      ...prev,
      price: {
        ...prev.price,
        [field]: value
      }
    }));
  };

  const buildPayload = () => {
    const features = (formState.featuresText || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);

    const payload = {
      key: formState.key.trim(),
      headline: formState.headline,
      subheading: formState.subheading,
      audienceTag: formState.audienceTag,
      trialInfo: formState.trialInfo,
      depositInfo: formState.depositInfo,
      ctaLabel: formState.ctaLabel,
      ctaHref: formState.ctaHref,
      published: Boolean(formState.published),
      highlight: Boolean(formState.highlight),
      sortOrder: Number(formState.sortOrder) || 0,
      features
    };

    if (formState.price?.amount) {
      payload.price = {
        amount: Number(formState.price.amount) || 0,
        currency: formState.price.currency || 'USD',
        cadence: formState.price.cadence || 'per month'
      };
    }

    return payload;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = buildPayload();
      const result = isEdit
        ? await updatePricingPlan(plan._id, payload)
        : await createPricingPlan(payload);
      if (onSaved) onSaved(result);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save pricing plan');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    if (!window.confirm('Delete this pricing plan? This cannot be undone.')) return;
    setDeleting(true);
    setError('');
    try {
      await deletePricingPlan(plan._id);
      if (onDeleted) onDeleted(plan._id);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to delete pricing plan');
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
      <div className={`relative z-10 w-full ${isDrawer ? 'h-full max-w-[560px]' : 'max-w-4xl'}`}>
        <div className={`flex min-h-0 flex-col overflow-hidden border border-white/30 bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-[0_30px_90px_rgba(15,23,42,0.18)] ${isDrawer ? 'min-h-full max-h-full rounded-none sm:rounded-l-[32px]' : 'min-h-[70vh] max-h-[calc(100vh-2rem)] rounded-[32px]'}`}>
          <div className="flex items-start justify-between border-b border-white/60 bg-white/80 px-6 py-4 backdrop-blur sm:px-8 sm:py-5">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{isEdit ? 'Update plan' : 'Create plan'}</p>
              <h3 className="mt-1 text-2xl font-semibold text-slate-900">{isEdit ? formState.headline || 'Untitled plan' : 'New pricing plan'}</h3>
              <p className="mt-1 text-sm text-slate-500">Dial in pricing, incentive copy, and feature bullets before publishing.</p>
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
                  Headline
                  <input
                    type="text"
                    value={formState.headline}
                    onChange={(e) => handleChange('headline', e.target.value)}
                    className={inputClass}
                    required
                  />
                </label>
                <label className={labelClass}>
                  Unique key
                  <input
                    type="text"
                    value={formState.key}
                    onChange={(e) => handleChange('key', e.target.value)}
                    className={inputClass}
                    placeholder="used for API targeting"
                    required
                  />
                </label>
              </div>

              <label className={`${labelClass} mt-6`}>
                Subheading
                <input
                  type="text"
                  value={formState.subheading || ''}
                  onChange={(e) => handleChange('subheading', e.target.value)}
                  className={inputClass}
                  placeholder="Short supporting copy"
                />
              </label>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className={labelClass}>
                  Price amount
                  <input
                    type="number"
                    value={formState.price.amount}
                    onChange={(e) => handlePriceChange('amount', e.target.value)}
                    className={inputClass}
                    min="0"
                    step="1"
                    placeholder="e.g. 120"
                  />
                </label>
                <label className={labelClass}>
                  Currency
                  <select
                    value={formState.price.currency}
                    onChange={(e) => handlePriceChange('currency', e.target.value)}
                    className={inputClass}
                  >
                    {currencyOptions.map((currency) => (
                      <option key={currency} value={currency}>{currency}</option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Cadence label
                  <select
                    value={formState.price.cadence}
                    onChange={(e) => handlePriceChange('cadence', e.target.value)}
                    className={inputClass}
                  >
                    {cadenceOptions.map((cadence) => (
                      <option key={cadence} value={cadence}>{cadence}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Audience tag
                  <input
                    type="text"
                    value={formState.audienceTag || ''}
                    onChange={(e) => handleChange('audienceTag', e.target.value)}
                    className={inputClass}
                    placeholder="Families, Adult learners, etc."
                  />
                </label>
                <label className={labelClass}>
                  Sort order
                  <input
                    type="number"
                    value={formState.sortOrder}
                    onChange={(e) => handleChange('sortOrder', e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>

              <label className={`${labelClass} mt-6`}>
                Feature bullets (one per line)
                <textarea
                  value={formState.featuresText}
                  onChange={(e) => handleChange('featuresText', e.target.value)}
                  className={textareaClass}
                  placeholder={'+ Weekly live session\n+ Progress tracking'}
                />
              </label>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className={labelClass}>
                  Trial info
                  <input
                    type="text"
                    value={formState.trialInfo || ''}
                    onChange={(e) => handleChange('trialInfo', e.target.value)}
                    className={inputClass}
                    placeholder="Free assessment, etc."
                  />
                </label>
                <label className={labelClass}>
                  Deposit info
                  <input
                    type="text"
                    value={formState.depositInfo || ''}
                    onChange={(e) => handleChange('depositInfo', e.target.value)}
                    className={inputClass}
                    placeholder="Deposit amount details"
                  />
                </label>
                <label className={labelClass}>
                  CTA label
                  <input
                    type="text"
                    value={formState.ctaLabel || ''}
                    onChange={(e) => handleChange('ctaLabel', e.target.value)}
                    className={inputClass}
                    placeholder="Enroll now"
                  />
                </label>
                <label className={labelClass}>
                  CTA href
                  <input
                    type="text"
                    value={formState.ctaHref || ''}
                    onChange={(e) => handleChange('ctaHref', e.target.value)}
                    className={inputClass}
                    placeholder="/apply"
                  />
                </label>
              </div>

              <div className="mt-6 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.published)}
                    onChange={(e) => handleChange('published', e.target.checked)}
                    className={checkboxClass}
                  />
                  Published
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean(formState.highlight)}
                    onChange={(e) => handleChange('highlight', e.target.checked)}
                    className={checkboxClass}
                  />
                  Highlight this plan
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
                    Delete plan
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
                    {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create plan'}
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

export default PricingPlanModal;
