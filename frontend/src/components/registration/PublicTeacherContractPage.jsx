import React, { useState } from 'react';
import { CheckCircle2, ChevronRight, FileBadge2, FileText, Loader2, Mic, ShieldCheck, Upload, UserRound, Wrench } from 'lucide-react';
import { getTeacherContractTemplate, listPublicRecruitmentCampaigns, submitPublicTeacherContract } from '../../api/teacherContract';
import api from '../../api/axios';

const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10';
const checkboxCardClass = 'flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700';
const containsArabic = (value = '') => /[\u0600-\u06FF]/.test(String(value));
const getFileLabel = (file, fallback = '') => file?.name || fallback || 'No file chosen';

const POSITION_OPTIONS = ['Quran Teacher', 'Arabic Teacher', 'Islamic Studies Teacher', 'Noor Al-Bayan Teacher'];
const MEETING_APP_OPTIONS = ['Google Meet', 'Zoom', 'Microsoft Teams', 'Skype'];
const OFFICE_OPTIONS = ['Word', 'Excel', 'PowerPoint', 'Outlook', 'OneDrive', 'Teams'];
const SUBJECT_OPTIONS = ['Quran', 'Tajweed', 'Arabic', 'Islamic Studies', 'Noor Al-Bayan'];

export default function PublicTeacherContractPage() {
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const campaignSlugFromUrl = search.get('campaign') || '';
  const [contractTemplate, setContractTemplate] = useState('');
  const [branding, setBranding] = useState({ title: 'Waraqa', slogan: 'Welcome', logoUrl: null });
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState({
    identityDocument: null,
    educationDocuments: null,
    profilePhoto: null,
    resume: null,
    englishIntroduction: null,
    quranRecitation: null,
    teachingTopicExplanation: null,
  });
  const [form, setForm] = useState({
    contractAccepted: false,
    contractFullName: '',
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
    positionsInterested: [],
    eligibilityPath: '',
    graduationStatus: '',
    facultyUniversity: '',
    degree: '',
    additionalCertificates: '',
    teachingExperienceLevel: '',
    currentJob: '',
    profileSummary: '',
    specialRequests: '',
    classTools: '',
    meetingApps: [],
    officeProducts: [],
    subjectsCanTeach: [],
    preferredAvailability: '',
    alternativeAvailability: '',
  });

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
    listPublicRecruitmentCampaigns().then((items) => {
      if (!mounted) return;
      setCampaigns(items || []);
      const selected = (items || []).find((item) => item.slug === campaignSlugFromUrl) || (items || [])[0] || null;
      setActiveCampaign(selected);
    }).catch(() => {
      if (!mounted) return;
      setCampaigns([]);
      setActiveCampaign(null);
    });
    return () => { mounted = false; };
  }, [campaignSlugFromUrl]);

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
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const toggleArrayValue = (field, value) => {
    setForm((prev) => {
      const current = Array.isArray(prev[field]) ? prev[field] : [];
      const exists = current.includes(value);
      return {
        ...prev,
        [field]: exists ? current.filter((item) => item !== value) : [...current, value],
      };
    });
  };

  const validateStep = (targetStep = step) => {
    if (targetStep === 1 && (!form.contractFullName.trim() || !form.contractAccepted)) {
      setError('Please confirm the contract and write your full legal name.');
      return false;
    }
    if (targetStep === 2 && (!form.fullName.trim() || !form.email.trim() || !form.birthDate || !form.mobileNumber.trim() || !form.gender || !form.positionsInterested.length || !files.resume)) {
      setError('Please complete personal information, choose a position, and upload your resume.');
      return false;
    }
    if (targetStep === 3 && (!form.eligibilityPath || !form.graduationStatus || !form.facultyUniversity.trim() || !form.degree.trim() || !form.teachingExperienceLevel.trim() || !form.currentJob.trim())) {
      setError('Please complete the education and experience section.');
      return false;
    }
    if (targetStep === 4 && (!form.classTools.trim() || !form.meetingApps.length || !form.officeProducts.length || !form.subjectsCanTeach.length || !form.preferredAvailability.trim())) {
      setError('Please complete the technical skills and teaching profile section.');
      return false;
    }
    if (targetStep === 5 && (!files.identityDocument || !files.educationDocuments || !files.englishIntroduction || !files.quranRecitation || !files.teachingTopicExplanation)) {
      setError('Please upload all required documents and recordings.');
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async () => {
    for (const targetStep of [1, 2, 3, 4, 5]) {
      if (!validateStep(targetStep)) return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (Array.isArray(value)) value.forEach((item) => payload.append(key, item));
        else payload.append(key, value ?? '');
      });
      if (activeCampaign?.id) payload.append('campaignId', activeCampaign.id);
      if (activeCampaign?.slug) payload.append('campaignSlug', activeCampaign.slug);
      Object.entries(files).forEach(([key, file]) => {
        if (file) payload.append(key, file);
      });
      payload.set('contractAccepted', String(form.contractAccepted));
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
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Application received</h1>
          <p className="mt-2 text-sm text-slate-600">Thank you. Your application and recordings were submitted successfully, and the Waraqa team will review them.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-6xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        {activeCampaign ? (
          <div className="mb-6 rounded-3xl border border-primary/20 bg-primary/5 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Recruitment campaign</p>
                <h2 className="mt-2 text-xl font-semibold text-slate-900">{activeCampaign.publicHeadline || activeCampaign.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{activeCampaign.publicDescription || 'Apply through the Waraqa teacher recruitment workflow.'}</p>
              </div>
              <div className="rounded-2xl border border-primary/20 bg-white px-4 py-3 text-sm text-slate-700">
                <p><span className="font-semibold text-slate-900">Subjects:</span> {activeCampaign.subjects?.join(', ') || 'General'}</p>
                <p className="mt-1"><span className="font-semibold text-slate-900">Preferred window:</span> {activeCampaign.preferredWindow || 'Flexible'}</p>
              </div>
            </div>
            {campaigns.length > 1 && !campaignSlugFromUrl ? (
              <div className="mt-4 max-w-sm">
                <label className="mb-1 block text-sm font-medium text-slate-700">Choose campaign</label>
                <select value={activeCampaign?.id || ''} onChange={(e) => setActiveCampaign(campaigns.find((item) => item.id === e.target.value) || null)} className={inputClass}>
                  {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
                </select>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 shadow-sm">
              {branding.logoUrl ? <img src={branding.logoUrl} alt={branding.title || 'Waraqa'} className="h-12 w-12 object-contain" /> : <div className="h-12 w-12 rounded-xl bg-primary/10" />}
            </div>
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Waraqa job application</div>
              <h1 className="mt-3 text-2xl font-semibold text-slate-900">Join the Waraqa team</h1>
              <p className="mt-1 text-xs font-semibold text-slate-500">{branding.slogan}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4, 5].map((item) => <div key={item} className={`h-2.5 w-12 rounded-full ${item <= step ? 'bg-primary' : 'bg-slate-200'}`} />)}
          </div>
        </div>

        <div className="mt-6 space-y-8">
          {step === 1 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><FileText className="h-5 w-5 text-primary" />Agreement and process</div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700">
                <p>Upload your resume, answer the questions, and submit the required audio or video samples. Applications that pass the first review stage will move to a 60-minute interview with English, Tajweed, Arabic, and Islamic Studies checks depending on the role.</p>
              </div>
              <div className={`rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700 ${containsArabic(contractTemplate) ? 'text-right' : 'text-left'}`} dir={containsArabic(contractTemplate) ? 'rtl' : 'ltr'}>
                <div className="whitespace-pre-wrap leading-7 text-slate-700">{contractTemplate}</div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <input className={inputClass} placeholder="Full legal name *" value={form.contractFullName} onChange={(e) => updateField('contractFullName', e.target.value)} />
                <label className={checkboxCardClass}>
                  <input type="checkbox" checked={form.contractAccepted} onChange={(e) => updateField('contractAccepted', e.target.checked)} />
                  <span>I confirm that I have read the contract and agree to its terms.</span>
                </label>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><UserRound className="h-5 w-5 text-primary" />Personal information</div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <input className={inputClass + ' xl:col-span-2'} placeholder="Full name *" value={form.fullName} onChange={(e) => updateField('fullName', e.target.value)} />
                <input className={inputClass} placeholder="Email *" type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} />
                <input className={inputClass} type="date" value={form.birthDate} onChange={(e) => updateField('birthDate', e.target.value)} />
                <input className={inputClass} placeholder="Phone number *" value={form.mobileNumber} onChange={(e) => updateField('mobileNumber', e.target.value)} />
                <input className={inputClass} placeholder="WhatsApp number" value={form.whatsappNumber} onChange={(e) => updateField('whatsappNumber', e.target.value)} />
                <input className={inputClass} placeholder="Address *" value={form.street} onChange={(e) => updateField('street', e.target.value)} />
                <input className={inputClass} placeholder="City" value={form.city} onChange={(e) => updateField('city', e.target.value)} />
                <input className={inputClass} placeholder="Country" value={form.country} onChange={(e) => updateField('country', e.target.value)} />
                <select className={inputClass} value={form.gender} onChange={(e) => updateField('gender', e.target.value)}>
                  <option value="">Gender *</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
                <input className={inputClass} placeholder="Nationality *" value={form.nationality} onChange={(e) => updateField('nationality', e.target.value)} />
                <input className={inputClass} placeholder="Preferred meeting link" value={form.meetingLink} onChange={(e) => updateField('meetingLink', e.target.value)} />
                <input className={inputClass} placeholder="Current occupation" value={form.occupation} onChange={(e) => updateField('occupation', e.target.value)} />
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-900">Which position(s) are you interested in? *</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {POSITION_OPTIONS.map((option) => (
                    <label key={option} className={checkboxCardClass}>
                      <input type="checkbox" checked={form.positionsInterested.includes(option)} onChange={() => toggleArrayValue('positionsInterested', option)} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="block rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">Submit your cover letter or resume *</div>
                <div className="flex items-center gap-3 text-sm text-slate-600"><Upload className="h-4 w-4" /><span>{getFileLabel(files.resume)}</span></div>
                <input type="file" className="mt-3 block w-full text-sm" onChange={(e) => setFiles((prev) => ({ ...prev, resume: e.target.files?.[0] || null }))} />
              </label>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><FileBadge2 className="h-5 w-5 text-primary" />Education and experience</div>
              <div className="grid gap-4 md:grid-cols-2">
                <select className={inputClass} value={form.eligibilityPath} onChange={(e) => updateField('eligibilityPath', e.target.value)}>
                  <option value="">Eligibility path *</option>
                  <option value="al_azhar">Al-Azhar graduate or student</option>
                  <option value="ijazah">Ijazah holder</option>
                  <option value="both">Both Al-Azhar and Ijazah</option>
                  <option value="other">Other relevant background</option>
                </select>
                <input className={inputClass} placeholder="Graduation status *" value={form.graduationStatus} onChange={(e) => updateField('graduationStatus', e.target.value)} />
                <input className={inputClass} placeholder="Faculty and university *" value={form.facultyUniversity} onChange={(e) => updateField('facultyUniversity', e.target.value)} />
                <input className={inputClass} placeholder="Degree *" value={form.degree} onChange={(e) => updateField('degree', e.target.value)} />
                <input className={inputClass} placeholder="Work experience in teaching *" value={form.teachingExperienceLevel} onChange={(e) => updateField('teachingExperienceLevel', e.target.value)} />
                <input className={inputClass} placeholder="What is your current job? *" value={form.currentJob} onChange={(e) => updateField('currentJob', e.target.value)} />
              </div>
              <textarea className={inputClass + ' min-h-[120px] resize-y'} placeholder="Additional certificates" value={form.additionalCertificates} onChange={(e) => updateField('additionalCertificates', e.target.value)} />
              <textarea className={inputClass + ' min-h-[160px] resize-y'} placeholder="Tell us what you want us to know about you." value={form.profileSummary} onChange={(e) => updateField('profileSummary', e.target.value)} />
              <textarea className={inputClass + ' min-h-[120px] resize-y'} placeholder="If you have any questions or special requests, please write them here." value={form.specialRequests} onChange={(e) => updateField('specialRequests', e.target.value)} />
            </section>
          ) : null}

          {step === 4 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Wrench className="h-5 w-5 text-primary" />Technical skills and teaching profile</div>
              <textarea className={inputClass + ' min-h-[120px] resize-y'} placeholder="What do you use for classes usually? *" value={form.classTools} onChange={(e) => updateField('classTools', e.target.value)} />
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-900">Which video meeting apps can you use? *</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {MEETING_APP_OPTIONS.map((option) => (
                    <label key={option} className={checkboxCardClass}>
                      <input type="checkbox" checked={form.meetingApps.includes(option)} onChange={() => toggleArrayValue('meetingApps', option)} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-900">Which Microsoft Office products can you use? *</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {OFFICE_OPTIONS.map((option) => (
                    <label key={option} className={checkboxCardClass}>
                      <input type="checkbox" checked={form.officeProducts.includes(option)} onChange={() => toggleArrayValue('officeProducts', option)} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-900">Which subjects can you teach? *</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {SUBJECT_OPTIONS.map((option) => (
                    <label key={option} className={checkboxCardClass}>
                      <input type="checkbox" checked={form.subjectsCanTeach.includes(option)} onChange={() => toggleArrayValue('subjectsCanTeach', option)} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
              <textarea className={inputClass + ' min-h-[120px] resize-y'} placeholder="Preferred availability hours, especially for school-season demand windows *" value={form.preferredAvailability} onChange={(e) => updateField('preferredAvailability', e.target.value)} />
              <textarea className={inputClass + ' min-h-[120px] resize-y'} placeholder="Alternative availability if your preferred hours are not possible" value={form.alternativeAvailability} onChange={(e) => updateField('alternativeAvailability', e.target.value)} />
            </section>
          ) : null}

          {step === 5 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Mic className="h-5 w-5 text-primary" />Documents and recordings</div>
              <div className="grid gap-4 md:grid-cols-2">
                {[
                  ['identityDocument', 'National ID or passport *'],
                  ['educationDocuments', 'Educational documents *'],
                  ['profilePhoto', 'Profile photo'],
                  ['englishIntroduction', 'Introduce yourself in an audio clip *'],
                  ['quranRecitation', 'Record your Quranic recitation *'],
                  ['teachingTopicExplanation', 'Explain a topic related to your field *'],
                ].map(([key, label]) => (
                  <label key={key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-900">{label}</div>
                    <div className="flex items-center gap-3 text-sm text-slate-600"><Upload className="h-4 w-4" /><span>{getFileLabel(files[key], key === 'profilePhoto' ? 'Optional' : '')}</span></div>
                    <input type="file" accept={key === 'profilePhoto' ? 'image/*' : undefined} className="mt-3 block w-full text-sm" onChange={(e) => setFiles((prev) => ({ ...prev, [key]: e.target.files?.[0] || null }))} />
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => setStep((prev) => Math.max(prev - 1, 1))} disabled={step === 1 || saving} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Back</button>
            <div className="flex items-center gap-3">
              {step < 5 ? (
                <button type="button" onClick={() => { if (validateStep()) setStep((prev) => Math.min(prev + 1, 5)); }} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-sm"><span>Next</span><ChevronRight className="h-4 w-4" /></button>
              ) : (
                <button type="button" disabled={saving} onClick={handleSubmit} className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>{saving ? 'Submitting…' : 'Submit application'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
