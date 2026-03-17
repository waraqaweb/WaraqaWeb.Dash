import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, FileBadge2, FileText, Loader2, ShieldCheck, Upload, UserRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getMyTeacherContract, getTeacherContractTemplate, saveMyTeacherContract, updateTeacherContractTemplate } from '../../api/teacherContract';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-[#2C736C] focus:ring-4 focus:ring-[#2C736C]/10';

const getFileLabel = (file, fallback = '') => file?.name || file?.originalName || fallback || 'No file chosen';
const containsArabic = (value = '') => /[\u0600-\u06FF]/.test(String(value));

export default function TeacherContractPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [contractTemplate, setContractTemplate] = useState('');
  const [existingFiles, setExistingFiles] = useState({});
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

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const [submission, template] = await Promise.all([
          getMyTeacherContract(),
          getTeacherContractTemplate(),
        ]);
        if (!mounted) return;
        setContractTemplate(template || '');
        setForm((prev) => ({
          ...prev,
          contractAccepted: Boolean(submission?.contract?.accepted),
          contractFullName: submission?.contract?.fullName || user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
          introEssay: submission?.verification?.introEssay || '',
          fullName: submission?.personalInfo?.fullName || user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
          email: submission?.personalInfo?.email || user?.email || '',
          birthDate: submission?.personalInfo?.birthDate ? String(submission.personalInfo.birthDate).slice(0, 10) : (user?.dateOfBirth ? String(user.dateOfBirth).slice(0, 10) : ''),
          mobileNumber: submission?.personalInfo?.mobileNumber || user?.phone || '',
          whatsappNumber: submission?.personalInfo?.whatsappNumber || user?.phone || '',
          meetingLink: submission?.personalInfo?.meetingLink || submission?.personalInfo?.skypeId || '',
          street: submission?.personalInfo?.address?.street || user?.address?.street || '',
          city: submission?.personalInfo?.address?.city || user?.address?.city || '',
          country: submission?.personalInfo?.address?.country || user?.address?.country || 'Egypt',
          gender: submission?.personalInfo?.gender || user?.gender || '',
          nationality: submission?.personalInfo?.nationality || '',
          occupation: submission?.personalInfo?.occupation || '',
        }));
        setExistingFiles({
          identityDocument: submission?.verification?.identityDocument || null,
          educationDocuments: submission?.verification?.educationDocuments || null,
          profilePhoto: submission?.verification?.profilePhoto || null,
        });
      } catch (err) {
        if (!mounted) return;
        setError(err?.response?.data?.message || 'Failed to load the contract form.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [user]);

  const wordCount = useMemo(() => form.introEssay.trim() ? form.introEssay.trim().split(/\s+/).filter(Boolean).length : 0, [form.introEssay]);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const validateStep = () => {
    if (step === 1) {
      if (!form.contractFullName.trim() || !form.contractAccepted) {
        setError('يرجى كتابة الاسم الرباعي والموافقة على بنود العقد.');
        return false;
      }
    }
    if (step === 2) {
      if (!form.introEssay.trim() || wordCount > 200 || (!(files.identityDocument || existingFiles.identityDocument?.url)) || (!(files.educationDocuments || existingFiles.educationDocuments?.url))) {
        setError('يرجى رفع الهوية والوثائق التعليمية وكتابة نبذة إنجليزية لا تزيد عن 200 كلمة.');
        return false;
      }
    }
    if (step === 3) {
      if (!form.fullName.trim() || !form.email.trim() || !form.birthDate || !form.mobileNumber.trim() || !form.gender || !form.nationality.trim()) {
        setError('يرجى إكمال البيانات الشخصية المطلوبة.');
        return false;
      }
    }
    setError('');
    return true;
  };

  const validateAllSteps = () => {
    if (!form.contractFullName.trim() || !form.contractAccepted) {
      setError('يرجى كتابة الاسم الرباعي والموافقة على بنود العقد.');
      return false;
    }
    if (!form.introEssay.trim() || wordCount > 200 || (!(files.identityDocument || existingFiles.identityDocument?.url)) || (!(files.educationDocuments || existingFiles.educationDocuments?.url))) {
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

  const handleNext = () => {
    if (!validateStep()) return;
    setStep((prev) => Math.min(prev + 1, 3));
  };

  const handleTemplateSave = async () => {
    try {
      setTemplateSaving(true);
      setError('');
      setSuccess('');
      const response = await updateTeacherContractTemplate(contractTemplate);
      setContractTemplate(response?.template || contractTemplate);
      setSuccess(response?.message || 'Contract text saved.');
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save contract text.');
    } finally {
      setTemplateSaving(false);
    }
  };

  const handleSave = async (status = 'submitted') => {
    if (status === 'submitted' && !validateAllSteps()) return;
    try {
      setSaving(true);
      setError('');
      setSuccess('');
      const payload = new FormData();
      payload.append('status', status);
      Object.entries(form).forEach(([key, value]) => payload.append(key, value ?? ''));
      payload.set('contractAccepted', String(form.contractAccepted));
      if (files.identityDocument) payload.append('identityDocument', files.identityDocument);
      if (files.educationDocuments) payload.append('educationDocuments', files.educationDocuments);
      if (files.profilePhoto) payload.append('profilePhoto', files.profilePhoto);
      const response = await saveMyTeacherContract(payload);
      setExistingFiles({
        identityDocument: response?.submission?.verification?.identityDocument || existingFiles.identityDocument,
        educationDocuments: response?.submission?.verification?.educationDocuments || existingFiles.educationDocuments,
        profilePhoto: response?.submission?.verification?.profilePhoto || existingFiles.profilePhoto,
      });
      setSuccess(response?.message || (status === 'draft' ? 'Draft saved.' : 'Form submitted successfully.'));
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save the form.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">Loading teacher contract…</div>;
  }

  return (
    <div className="min-h-full bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Teacher contract</div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-900">عقد عمل مع مؤسسة ورقة</h1>
            <p className="mt-2 text-sm text-slate-500">نفس أسلوب التسجيل متعدد الخطوات داخل الداشبورد مع حفظ البيانات والوثائق.</p>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((item) => <div key={item} className={`h-2.5 w-14 rounded-full ${item <= step ? 'bg-[#2C736C]' : 'bg-slate-200'}`} />)}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_320px]">
          <div className="space-y-8">
            {step === 1 ? (
              <section className="space-y-5">
                <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><FileText className="h-5 w-5 text-[#2C736C]" />العقد</div>
                <div className={`rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700 ${containsArabic(contractTemplate) ? 'text-right' : 'text-left'}`} dir={containsArabic(contractTemplate) ? 'rtl' : 'ltr'}>
                  {isAdmin ? (
                    <div className="space-y-3">
                      <textarea
                        className={inputClass + ` min-h-[360px] resize-y leading-7 ${containsArabic(contractTemplate) ? 'text-right' : 'text-left'}`}
                        dir={containsArabic(contractTemplate) ? 'rtl' : 'ltr'}
                        value={contractTemplate}
                        onChange={(e) => setContractTemplate(e.target.value)}
                      />
                      <div className="flex justify-end">
                        <button type="button" onClick={handleTemplateSave} disabled={templateSaving} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
                          {templateSaving ? 'Saving…' : 'Save contract text'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap leading-7 text-slate-700">{contractTemplate}</div>
                  )}
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
                    <div className="flex items-center gap-3 text-sm text-slate-600"><Upload className="h-4 w-4" /><span>{getFileLabel(files.identityDocument, existingFiles.identityDocument?.originalName)}</span></div>
                    <input type="file" className="mt-3 block w-full text-sm" onChange={(e) => setFiles((prev) => ({ ...prev, identityDocument: e.target.files?.[0] || null }))} />
                  </label>
                  <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-900">Educational documents *</div>
                    <div className="flex items-center gap-3 text-sm text-slate-600"><Upload className="h-4 w-4" /><span>{getFileLabel(files.educationDocuments, existingFiles.educationDocuments?.originalName)}</span></div>
                    <input type="file" className="mt-3 block w-full text-sm" onChange={(e) => setFiles((prev) => ({ ...prev, educationDocuments: e.target.files?.[0] || null }))} />
                  </label>
                  <label className="rounded-2xl border border-slate-200 bg-slate-50 p-4 md:col-span-2">
                    <div className="mb-3 text-sm font-semibold text-slate-900">Profile photo</div>
                    <div className="flex items-center gap-3 text-sm text-slate-600"><Upload className="h-4 w-4" /><span>{getFileLabel(files.profilePhoto, existingFiles.profilePhoto?.originalName || 'Optional')}</span></div>
                    <input type="file" accept="image/*" className="mt-3 block w-full text-sm" onChange={(e) => setFiles((prev) => ({ ...prev, profilePhoto: e.target.files?.[0] || null }))} />
                    <p className="mt-2 text-xs text-slate-500">Optional.</p>
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
            {success ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

            <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => setStep((prev) => Math.max(prev - 1, 1))} disabled={step === 1 || saving} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Back</button>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => handleSave('draft')} disabled={saving} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Save draft</button>
                {step < 3 ? (
                  <button type="button" onClick={handleNext} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-6 py-3 text-sm font-semibold text-white shadow-sm"><span>Next</span><ChevronRight className="h-4 w-4" /></button>
                ) : (
                  <button type="button" onClick={() => handleSave('submitted')} disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-6 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    <span>{saving ? 'Submitting…' : 'Submit form'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Checklist</p>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                <li>• بطاقة شخصية أو جواز سفر</li>
                <li>• وثائق وشهادات علمية</li>
                <li>• صورة شخصية حديثة</li>
                <li>• نبذة إنجليزية قصيرة</li>
                <li>• البيانات الشخصية الكاملة</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-900">Notes</p>
              <p className="mt-2">يمكنك حفظ المسودة ثم العودة لاحقا لإكمال النموذج. عند الإرسال سيتم حفظ البيانات داخل النظام.</p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
