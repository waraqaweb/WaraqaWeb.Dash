import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, FileBadge2, FileText, Loader2, ShieldCheck, Upload, UserRound } from 'lucide-react';
import { getTeacherContractTemplate, submitPublicTeacherContract } from '../../api/teacherContract';
import api from '../../api/axios';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-[#2C736C] focus:ring-4 focus:ring-[#2C736C]/10';

const getFileLabel = (file, fallback = '') => file?.name || fallback || 'No file chosen';
const containsArabic = (value = '') => /[\u0600-\u06FF]/.test(String(value));

export default function PublicTeacherContractPage() {
  const [contractTemplate, setContractTemplate] = useState('');
  const [branding, setBranding] = useState({ title: 'Waraqa', slogan: 'Welcome', logoUrl: null });
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState({ identityDocument: null, educationDocuments: null, profilePhoto: null });
  const [form, setForm] = useState({
    contractAccepted: false,
    contractFullName: '',
    introEssay: '',
    fullName: '',
    email: '',
    birthDate: '',
    mobileNumber: '',
    whatsappNumber: '',
    meetingLink: '',
    street: '',
    city: '',
    country: 'Egypt',
    gender: '',
    nationality: '',
    occupation: '',
  });

  const wordCount = useMemo(() => form.introEssay.trim() ? form.introEssay.trim().split(/\s+/).filter(Boolean).length : 0, [form.introEssay]);

  React.useEffect(() => {
    let mounted = true;
    getTeacherContractTemplate().then((template) => {
      if (mounted) setContractTemplate(template || '');
    }).catch(() => {
      if (mounted) setContractTemplate('');
    });
    return () => { mounted = false; };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    api.get('/settings/branding').then((res) => {
      if (!mounted) return;
      const b = res?.data?.branding;
      setBranding({
        title: b?.title || 'Waraqa',
        slogan: b?.slogan || 'Welcome',
        logoUrl: b?.logo?.url || b?.logo?.dataUri || null,
      });
    }).catch(() => {
      // ignore branding load errors
    });
    return () => { mounted = false; };
  }, []);

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const validateStep = () => {
    if (step === 1 && (!form.contractFullName.trim() || !form.contractAccepted)) {
      setError('يرجى كتابة الاسم الرباعي والموافقة على بنود العقد.');
      return false;
    }
    if (step === 2 && (!form.introEssay.trim() || wordCount > 200 || !files.identityDocument || !files.educationDocuments)) {
      setError('يرجى رفع الهوية والوثائق التعليمية وكتابة نبذة إنجليزية لا تزيد عن 200 كلمة.');
      return false;
    }
    if (step === 3 && (!form.fullName.trim() || !form.email.trim() || !form.birthDate || !form.mobileNumber.trim() || !form.gender || !form.nationality.trim())) {
      setError('يرجى إكمال البيانات الشخصية المطلوبة.');
      return false;
    }
    setError('');
    return true;
  };

  const validateAll = () => {
    if (!form.contractFullName.trim() || !form.contractAccepted) {
      setError('يرجى كتابة الاسم الرباعي والموافقة على بنود العقد.');
      return false;
    }
    if (!form.introEssay.trim() || wordCount > 200 || !files.identityDocument || !files.educationDocuments) {
      setError('يرجى رفع الهوية والوثائق التعليمية وكتابة نبذة إنجليزية لا تزيد عن 200 كلمة.');
      return false;
    }
    if (!form.fullName.trim() || !form.email.trim() || !form.birthDate || !form.mobileNumber.trim() || !form.gender || !form.nationality.trim()) {
      setError('يرجى إكمال البيانات الشخصية المطلوبة.');
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async () => {
    if (!validateAll()) return;
    try {
      setSaving(true);
      setError('');
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => payload.append(key, value ?? ''));
      payload.set('contractAccepted', String(form.contractAccepted));
      payload.append('identityDocument', files.identityDocument);
      payload.append('educationDocuments', files.educationDocuments);
      if (files.profilePhoto) payload.append('profilePhoto', files.profilePhoto);
      await submitPublicTeacherContract(payload);
      setSuccess(true);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to submit the form.');
    } finally {
      setSaving(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800">
        <div className="mx-auto max-w-3xl rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">تم استلام الطلب</h1>
          <p className="mt-2 text-sm text-slate-600">شكرا لك. تم إرسال عقد المعلم والوثائق بنجاح، وسنتواصل معك قريبا بإذن الله.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-5xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 shadow-sm">
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt={branding.title || 'Waraqa'} className="h-12 w-12 object-contain" />
              ) : (
                <div className="h-12 w-12 rounded-xl bg-[#2C736C]/10" />
              )}
            </div>
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Teacher contract</div>
              <h1 className="mt-3 text-2xl font-semibold text-slate-900">عقد عمل مع مؤسسة ورقة</h1>
              <p className="mt-1 text-xs font-semibold text-slate-500">{branding.slogan}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((item) => <div key={item} className={`h-2.5 w-14 rounded-full ${item <= step ? 'bg-[#2C736C]' : 'bg-slate-200'}`} />)}
          </div>
        </div>

        <div className="mt-6 space-y-8">
          {step === 1 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><FileText className="h-5 w-5 text-[#2C736C]" />العقد</div>
              <div className={`rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700 ${containsArabic(contractTemplate) ? 'text-right' : 'text-left'}`} dir={containsArabic(contractTemplate) ? 'rtl' : 'ltr'}>
                <div className="whitespace-pre-wrap leading-7 text-slate-700">{contractTemplate}</div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <input className={inputClass} placeholder="Full legal name *" value={form.contractFullName} onChange={(e) => updateField('contractFullName', e.target.value)} />
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                  <input type="checkbox" checked={form.contractAccepted} onChange={(e) => updateField('contractAccepted', e.target.checked)} />
                  <span>I confirm that I have read the contract and agree to its terms.</span>
                </label>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><FileBadge2 className="h-5 w-5 text-[#2C736C]" />Identity and Educational Verification</div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">National ID or passport *</div>
                  <div className="flex items-center gap-3 text-sm text-slate-600"><Upload className="h-4 w-4" /><span>{getFileLabel(files.identityDocument)}</span></div>
                  <input type="file" className="mt-3 block w-full text-sm" onChange={(e) => setFiles((prev) => ({ ...prev, identityDocument: e.target.files?.[0] || null }))} />
                </label>
                <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Educational documents *</div>
                  <div className="flex items-center gap-3 text-sm text-slate-600"><Upload className="h-4 w-4" /><span>{getFileLabel(files.educationDocuments)}</span></div>
                  <input type="file" className="mt-3 block w-full text-sm" onChange={(e) => setFiles((prev) => ({ ...prev, educationDocuments: e.target.files?.[0] || null }))} />
                </label>
                <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                  <div className="mb-3 text-sm font-semibold text-slate-900">Profile photo</div>
                  <div className="flex items-center gap-3 text-sm text-slate-600"><Upload className="h-4 w-4" /><span>{getFileLabel(files.profilePhoto, 'Optional')}</span></div>
                  <input type="file" accept="image/*" className="mt-3 block w-full text-sm" onChange={(e) => setFiles((prev) => ({ ...prev, profilePhoto: e.target.files?.[0] || null }))} />
                </label>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-slate-900">نبذة باللغة الإنجليزية لا تزيد عن 200 كلمة *</label>
                  <span className={`text-xs font-semibold ${wordCount > 200 ? 'text-red-600' : 'text-slate-500'}`}>{wordCount}/200</span>
                </div>
                <textarea className={inputClass + ' min-h-[180px] resize-y'} placeholder="Write a short English introduction about your teaching style and why you enjoy teaching online." value={form.introEssay} onChange={(e) => updateField('introEssay', e.target.value)} />
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><UserRound className="h-5 w-5 text-[#2C736C]" />Personal information</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <input className={inputClass + ' xl:col-span-2'} placeholder="Full name *" value={form.fullName} onChange={(e) => updateField('fullName', e.target.value)} />
                <input className={inputClass} placeholder="E-mail *" type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} />
                <input className={inputClass} type="date" value={form.birthDate} onChange={(e) => updateField('birthDate', e.target.value)} />
                <input className={inputClass} placeholder="Mobile number *" value={form.mobileNumber} onChange={(e) => updateField('mobileNumber', e.target.value)} />
                <input className={inputClass} placeholder="WhatsApp number" value={form.whatsappNumber} onChange={(e) => updateField('whatsappNumber', e.target.value)} />
                <input className={inputClass} placeholder="Zoom or Google Meet link (optional)" value={form.meetingLink} onChange={(e) => updateField('meetingLink', e.target.value)} />
                <input className={inputClass + ' xl:col-span-2'} placeholder="Street Address" value={form.street} onChange={(e) => updateField('street', e.target.value)} />
                <input className={inputClass} placeholder="City" value={form.city} onChange={(e) => updateField('city', e.target.value)} />
                <input className={inputClass} placeholder="Country" value={form.country} onChange={(e) => updateField('country', e.target.value)} />
                <select className={inputClass} value={form.gender} onChange={(e) => updateField('gender', e.target.value)}>
                  <option value="">Gender *</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                <input className={inputClass} placeholder="Nationality *" value={form.nationality} onChange={(e) => updateField('nationality', e.target.value)} />
                <input className={inputClass} placeholder="Occupation" value={form.occupation} onChange={(e) => updateField('occupation', e.target.value)} />
              </div>
            </section>
          ) : null}

          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => setStep((prev) => Math.max(prev - 1, 1))} disabled={step === 1 || saving} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Back</button>
            <div className="flex items-center gap-3">
              {step < 3 ? (
                <button type="button" onClick={() => { if (validateStep()) setStep((prev) => Math.min(prev + 1, 3)); }} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-6 py-3 text-sm font-semibold text-white shadow-sm"><span>Next</span><ChevronRight className="h-4 w-4" /></button>
              ) : (
                <button type="button" disabled={saving} onClick={handleSubmit} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-6 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>{saving ? 'Submitting…' : 'Submit form'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
