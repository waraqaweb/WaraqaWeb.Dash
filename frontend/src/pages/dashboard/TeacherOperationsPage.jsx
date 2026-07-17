import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  ChevronRight,
  Clock3,
  Copy,
  Edit3,
  Loader2,
  Plus,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import TeacherResponsesPanel from '../../components/features/meetings/TeacherResponsesPanel';
import BusinessIntelligenceModal from '../../components/admin/BusinessIntelligenceModal';
import { createRecruitmentCampaign, getTeacherOperationsSummary, listRecruitmentCampaigns, updateRecruitmentCampaign } from '../../api/teacherContract';

const TABS = [
  { id: 'overview', label: 'Overview', icon: TrendingUp },
  { id: 'pipeline', label: 'Pipeline', icon: BriefcaseBusiness },
  { id: 'interviews', label: 'Interviews', icon: CalendarClock },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
];

const staticPolicyCards = [
  {
    title: 'Working-hours policy',
    value: '4h reserve / day',
    note: 'Seed rule for new teachers, with at least 3h inside target Cairo windows.',
    icon: Clock3,
  },
  {
    title: 'Recruitment trigger',
    value: '75% occupancy',
    note: 'Start hiring before schedules are full and raise alerts again at 85%.',
    icon: TrendingUp,
  },
  {
    title: 'Pipeline focus',
    value: 'Applicants + coverage',
    note: 'Review candidate fit by gender, subject, timezone, and target hours.',
    icon: Users,
  },
];

const nextDeliverables = [
  'Capacity calculations by gender, subject, timezone window, and spare hours.',
  'Google Drive-backed public candidate application flow inside the dashboard.',
  'Candidate lifecycle, scoring, rejection categories, and bulk communication.',
  'One-hour candidate interview meeting type with slot booking and outcomes.',
];

function TabButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
      ].join(' ')}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function SectionCard({ title, children, className = '' }) {
  return (
    <section className={`rounded-3xl border border-border bg-card p-4 shadow-sm ${className}`.trim()}>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function TeacherOperationsPage({ isActive }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');
  const [legacyBiOpen, setLegacyBiOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [campaignLoading, setCampaignLoading] = useState(false);
  const [campaignError, setCampaignError] = useState('');
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState('');
  const [campaignForm, setCampaignForm] = useState({
    title: '', slug: '', status: 'draft', opensAt: '', closesAt: '', targetApplicants: '', targetHires: '',
    male: false, female: false, subjects: '', preferredWindow: '', publicHeadline: '', publicDescription: '', internalNotes: '', reopenLimit: '',
  });

  const headerCopy = useMemo(() => ({
    title: 'Teacher Operations',
    subtitle: 'A sidebar-native control room for staffing, recruitment, interviews, and teacher capacity.',
  }), []);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoadingSummary(true);
        setSummaryError('');
        const data = await getTeacherOperationsSummary();
        if (!cancelled) setSummary(data);
      } catch (error) {
        if (!cancelled) setSummaryError(error?.response?.data?.message || 'Failed to load teacher operations summary.');
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    const load = async () => {
      try {
        setCampaignLoading(true);
        setCampaignError('');
        const data = await listRecruitmentCampaigns();
        if (!cancelled) setCampaigns(data || []);
      } catch (error) {
        if (!cancelled) setCampaignError(error?.response?.data?.message || 'Failed to load recruitment campaigns.');
      } finally {
        if (!cancelled) setCampaignLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [isActive]);

  const newTeacherInterviewLink = useMemo(() => `${window.location.origin}/public/meetings/evaluation?type=new_teacher_interview`, []);

  const handleCopy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(`${label} copied.`);
      window.setTimeout(() => setCopyNotice(''), 2500);
    } catch (error) {
      setCopyNotice(`Could not copy ${label.toLowerCase()}.`);
    }
  };

  const resetCampaignForm = () => {
    setEditingCampaignId('');
    setCampaignForm({
      title: '', slug: '', status: 'draft', opensAt: '', closesAt: '', targetApplicants: '', targetHires: '',
      male: false, female: false, subjects: '', preferredWindow: '', publicHeadline: '', publicDescription: '', internalNotes: '', reopenLimit: '',
    });
  };

  const startEditCampaign = (campaign) => {
    setEditingCampaignId(campaign.id);
    setCampaignForm({
      title: campaign.title || '',
      slug: campaign.slug || '',
      status: campaign.status || 'draft',
      opensAt: campaign.opensAt ? String(campaign.opensAt).slice(0, 16) : '',
      closesAt: campaign.closesAt ? String(campaign.closesAt).slice(0, 16) : '',
      targetApplicants: campaign.targetApplicants ?? '',
      targetHires: campaign.targetHires ?? '',
      male: Boolean(campaign.roles?.male),
      female: Boolean(campaign.roles?.female),
      subjects: Array.isArray(campaign.subjects) ? campaign.subjects.join(', ') : '',
      preferredWindow: campaign.preferredWindow || '',
      publicHeadline: campaign.publicHeadline || '',
      publicDescription: campaign.publicDescription || '',
      internalNotes: campaign.internalNotes || '',
      reopenLimit: campaign.reopenLimit ?? '',
    });
  };

  const saveCampaign = async () => {
    try {
      setCampaignSaving(true);
      setCampaignError('');
      const payload = {
        title: campaignForm.title,
        slug: campaignForm.slug,
        status: campaignForm.status,
        opensAt: campaignForm.opensAt || null,
        closesAt: campaignForm.closesAt || null,
        targetApplicants: campaignForm.targetApplicants,
        targetHires: campaignForm.targetHires,
        roles: { male: campaignForm.male, female: campaignForm.female },
        subjects: campaignForm.subjects,
        preferredWindow: campaignForm.preferredWindow,
        publicHeadline: campaignForm.publicHeadline,
        publicDescription: campaignForm.publicDescription,
        internalNotes: campaignForm.internalNotes,
        reopenLimit: campaignForm.reopenLimit,
      };
      const saved = editingCampaignId
        ? await updateRecruitmentCampaign(editingCampaignId, payload)
        : await createRecruitmentCampaign(payload);
      if (!saved) return;
      setCampaigns((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        return exists ? prev.map((item) => item.id === saved.id ? saved : item) : [saved, ...prev];
      });
      resetCampaignForm();
    } catch (error) {
      setCampaignError(error?.response?.data?.message || 'Failed to save recruitment campaign.');
    } finally {
      setCampaignSaving(false);
    }
  };

  const liveOverviewCards = useMemo(() => {
    const teachers = summary?.teachers || {};
    const pipeline = summary?.pipeline || {};
    return [
      {
        title: 'Active teachers',
        value: teachers.activeCount ?? '—',
        note: `${teachers.withCustomAvailability ?? 0} custom availability, ${teachers.pendingAvailability ?? 0} pending setup.`,
        icon: Users,
      },
      {
        title: 'Unreviewed applications',
        value: pipeline.unreviewed ?? '—',
        note: `${pipeline.byStatus?.shortlisted ?? 0} shortlisted, ${pipeline.byStatus?.interview_pending ?? 0} waiting for interview.`,
        icon: BriefcaseBusiness,
      },
      {
        title: 'Upcoming hours (14d)',
        value: teachers.totalUpcomingHours14Days != null ? `${teachers.totalUpcomingHours14Days}h` : '—',
        note: `${teachers.distinctStudents14Days ?? 0} student slots across the next 14 days.`,
        icon: CalendarClock,
      },
    ];
  }, [summary]);

  return (
    <div className="min-h-full bg-background p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <section className="rounded-[28px] border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <BriefcaseBusiness className="h-3.5 w-3.5" />
                <span>New sidebar section</span>
              </div>
              <h1 className="mt-3 text-2xl font-semibold text-foreground">{headerCopy.title}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{headerCopy.subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setLegacyBiOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:border-primary/40"
              >
                <BarChart3 className="h-4 w-4" />
                <span>Open legacy BI</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/dashboard/availability')}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm"
              >
                <CalendarClock className="h-4 w-4" />
                <span>Manage interviews</span>
              </button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <TabButton
                key={tab.id}
                active={tab.id === activeTab}
                icon={tab.icon}
                label={tab.label}
                onClick={() => setActiveTab(tab.id)}
              />
            ))}
          </div>
        </section>

        {summaryError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{summaryError}</div> : null}

        {activeTab === 'overview' ? (
          <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
            <SectionCard title="Live operations snapshot">
              {loadingSummary ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading live summary…</div>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {liveOverviewCards.map((card) => {
                    const Icon = card.icon;
                    return (
                      <div key={card.title} className="rounded-2xl border border-border bg-background p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{card.title}</p>
                            <p className="mt-2 text-xl font-semibold text-foreground">{card.value}</p>
                          </div>
                          <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>
                        </div>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">{card.note}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              {summary?.dataCompleteness?.note ? <p className="mt-4 text-xs leading-5 text-muted-foreground">{summary.dataCompleteness.note}</p> : null}
            </SectionCard>

            <SectionCard title="Recruitment policy seed">
              <div className="grid gap-3 md:grid-cols-3">
                {staticPolicyCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div key={card.title} className="rounded-2xl border border-border bg-background p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{card.title}</p>
                          <p className="mt-2 text-xl font-semibold text-foreground">{card.value}</p>
                        </div>
                        <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                          <Icon className="h-4 w-4" />
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-muted-foreground">{card.note}</p>
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard title="What this page will own">
              <div className="space-y-3">
                {nextDeliverables.map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-border bg-background px-4 py-3">
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <p className="text-sm leading-6 text-foreground">{item}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'pipeline' ? (
          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <SectionCard title="Recruitment campaigns">
              {campaignError ? <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{campaignError}</div> : null}
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-foreground">
                  <span className="mb-1 block font-medium">Campaign title</span>
                  <input value={campaignForm.title} onChange={(event) => setCampaignForm((prev) => ({ ...prev, title: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
                </label>
                <label className="text-sm text-foreground">
                  <span className="mb-1 block font-medium">Slug</span>
                  <input value={campaignForm.slug} onChange={(event) => setCampaignForm((prev) => ({ ...prev, slug: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" placeholder="school-year-2026" />
                </label>
                <label className="text-sm text-foreground">
                  <span className="mb-1 block font-medium">Status</span>
                  <select value={campaignForm.status} onChange={(event) => setCampaignForm((prev) => ({ ...prev, status: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5">
                    <option value="draft">Draft</option>
                    <option value="open">Open</option>
                    <option value="closed">Closed</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label className="text-sm text-foreground">
                  <span className="mb-1 block font-medium">Preferred Cairo window</span>
                  <input value={campaignForm.preferredWindow} onChange={(event) => setCampaignForm((prev) => ({ ...prev, preferredWindow: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" placeholder="10 PM - 3 AM Cairo" />
                </label>
                <label className="text-sm text-foreground">
                  <span className="mb-1 block font-medium">Opens at</span>
                  <input type="datetime-local" value={campaignForm.opensAt} onChange={(event) => setCampaignForm((prev) => ({ ...prev, opensAt: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
                </label>
                <label className="text-sm text-foreground">
                  <span className="mb-1 block font-medium">Closes at</span>
                  <input type="datetime-local" value={campaignForm.closesAt} onChange={(event) => setCampaignForm((prev) => ({ ...prev, closesAt: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
                </label>
                <label className="text-sm text-foreground">
                  <span className="mb-1 block font-medium">Target applicants</span>
                  <input type="number" min="0" value={campaignForm.targetApplicants} onChange={(event) => setCampaignForm((prev) => ({ ...prev, targetApplicants: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
                </label>
                <label className="text-sm text-foreground">
                  <span className="mb-1 block font-medium">Target hires</span>
                  <input type="number" min="0" value={campaignForm.targetHires} onChange={(event) => setCampaignForm((prev) => ({ ...prev, targetHires: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
                </label>
                <label className="text-sm text-foreground md:col-span-2">
                  <span className="mb-1 block font-medium">Subjects</span>
                  <input value={campaignForm.subjects} onChange={(event) => setCampaignForm((prev) => ({ ...prev, subjects: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" placeholder="Quran, Arabic, Islamic Studies" />
                </label>
                <label className="text-sm text-foreground md:col-span-2">
                  <span className="mb-1 block font-medium">Public headline</span>
                  <input value={campaignForm.publicHeadline} onChange={(event) => setCampaignForm((prev) => ({ ...prev, publicHeadline: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
                </label>
                <label className="text-sm text-foreground md:col-span-2">
                  <span className="mb-1 block font-medium">Public description</span>
                  <textarea rows={4} value={campaignForm.publicDescription} onChange={(event) => setCampaignForm((prev) => ({ ...prev, publicDescription: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
                </label>
                <label className="text-sm text-foreground md:col-span-2">
                  <span className="mb-1 block font-medium">Internal notes</span>
                  <textarea rows={4} value={campaignForm.internalNotes} onChange={(event) => setCampaignForm((prev) => ({ ...prev, internalNotes: event.target.value }))} className="w-full rounded-xl border border-border bg-background px-3 py-2.5" />
                </label>
                <div className="md:col-span-2 flex flex-wrap items-center gap-4 text-sm text-foreground">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={campaignForm.male} onChange={(event) => setCampaignForm((prev) => ({ ...prev, male: event.target.checked }))} /> Male teachers</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={campaignForm.female} onChange={(event) => setCampaignForm((prev) => ({ ...prev, female: event.target.checked }))} /> Female teachers</label>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={saveCampaign} disabled={campaignSaving} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm disabled:opacity-60">
                  {editingCampaignId ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  <span>{campaignSaving ? 'Saving…' : editingCampaignId ? 'Update campaign' : 'Create campaign'}</span>
                </button>
                {editingCampaignId ? <button type="button" onClick={resetCampaignForm} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-foreground">Cancel edit</button> : null}
              </div>
            </SectionCard>

            <SectionCard title="Campaign list">
              {campaignLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…</div> : null}
              <div className="mb-4 rounded-2xl border border-border bg-background p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Generic application form link</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input readOnly value={`${window.location.origin}/teacher-contract`} className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground" />
                  <button type="button" onClick={() => handleCopy(`${window.location.origin}/teacher-contract`, 'Form link')} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:border-primary/40">
                    <Copy className="h-4 w-4" />
                    <span>Copy</span>
                  </button>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">Send this link to candidates. Use the per-campaign links below to pre-select a specific campaign.</p>
                {copyNotice ? <p className="mt-1 text-xs text-muted-foreground">{copyNotice}</p> : null}
              </div>
              <div className="space-y-3">
                {(campaigns || []).map((campaign) => (
                  <div key={campaign.id} className="rounded-2xl border border-border bg-background p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-base font-semibold text-foreground">{campaign.title}</p>
                        <p className="text-xs text-muted-foreground">/{campaign.slug} • {campaign.status} • {campaign.applicationCount} applications</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => handleCopy(`${window.location.origin}/teacher-contract?campaign=${campaign.slug}`, 'Campaign link')} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:border-primary/40">
                          <Copy className="h-3.5 w-3.5" />
                          <span>Copy link</span>
                        </button>
                        <button type="button" onClick={() => startEditCampaign(campaign)} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:border-primary/40">
                          <Edit3 className="h-4 w-4" />
                          <span>Edit</span>
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-foreground sm:grid-cols-2">
                      <div className="rounded-xl border border-border bg-card px-3 py-2">Subjects: {campaign.subjects?.join(', ') || 'General'}</div>
                      <div className="rounded-xl border border-border bg-card px-3 py-2">Window: {campaign.preferredWindow || 'Flexible'}</div>
                      <div className="rounded-xl border border-border bg-card px-3 py-2">Applicants target: {campaign.targetApplicants || 0}</div>
                      <div className="rounded-xl border border-border bg-card px-3 py-2">Hires target: {campaign.targetHires || 0}</div>
                    </div>
                  </div>
                ))}
                {!campaignLoading && !(campaigns || []).length ? <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">No recruitment campaigns yet.</div> : null}
              </div>
            </SectionCard>

            <SectionCard title="Candidate pipeline" className="xl:col-span-2">
              <p className="mb-4 text-sm text-muted-foreground">
                This slice keeps campaign planning and candidate review in the same workflow surface.
              </p>
              {isActive ? <TeacherResponsesPanel /> : null}
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'interviews' ? (
          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Interview operations">
              <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>New-teacher interviews now have a dedicated one-hour meeting type and can use the same booking infrastructure as other Waraqa meetings.</p>
                <p>Use the meeting availability page to create admin slots, then share the interview link with candidates.</p>
              </div>
              <div className="mt-4 rounded-2xl border border-border bg-background p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">New teacher interview link</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input readOnly value={newTeacherInterviewLink} className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground" />
                  <button type="button" onClick={() => handleCopy(newTeacherInterviewLink, 'Interview link')} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:border-primary/40">
                    <Copy className="h-4 w-4" />
                    <span>Copy link</span>
                  </button>
                </div>
                {copyNotice ? <p className="mt-2 text-xs text-muted-foreground">{copyNotice}</p> : null}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/dashboard/availability')}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm"
                >
                  <CalendarClock className="h-4 w-4" />
                  <span>Open meeting availability</span>
                </button>
              </div>
            </SectionCard>
            <SectionCard title="Upcoming implementation">
              <div className="space-y-3 text-sm leading-6 text-foreground">
                <div className="rounded-2xl border border-border bg-background px-4 py-3">Candidate self-booking from admin-created slots.</div>
                <div className="rounded-2xl border border-border bg-background px-4 py-3">Interview scorecards for punctuality, English, subject knowledge, and professionalism.</div>
                <div className="rounded-2xl border border-border bg-background px-4 py-3">Stage-driven invite, reminder, and outcome emails using the existing mail queue.</div>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'stats' ? (
          <div className="grid gap-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <SectionCard title="Recruitment pipeline stages">
                {loadingSummary ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading pipeline data…</div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['New', summary?.pipeline?.byStatus?.new ?? 0, 'text-foreground'],
                      ['Under review', summary?.pipeline?.byStatus?.under_review ?? 0, 'text-foreground'],
                      ['Shortlisted', summary?.pipeline?.byStatus?.shortlisted ?? 0, 'text-primary'],
                      ['Interview pending', summary?.pipeline?.byStatus?.interview_pending ?? 0, 'text-primary'],
                      ['Interviewed', summary?.pipeline?.byStatus?.interviewed ?? 0, 'text-foreground'],
                      ['Accepted', summary?.pipeline?.byStatus?.accepted ?? 0, 'text-green-600 dark:text-green-400'],
                      ['Rejected', summary?.pipeline?.byStatus?.rejected ?? 0, 'text-red-600 dark:text-red-400'],
                      ['Archived', summary?.pipeline?.byStatus?.archived ?? 0, 'text-muted-foreground'],
                    ].map(([label, value, colorClass]) => (
                      <div key={label} className="rounded-2xl border border-border bg-background px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                        <p className={`mt-1.5 text-2xl font-semibold ${colorClass}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  Total candidates in pipeline: <span className="font-semibold text-foreground">{summary?.pipeline?.total ?? 0}</span>
                  {' • '}
                  Unreviewed: <span className="font-semibold text-foreground">{summary?.pipeline?.unreviewed ?? 0}</span>
                </p>
              </SectionCard>

              <SectionCard title="Teacher workforce breakdown">
                {loadingSummary ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading teacher stats…</div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ['Quran teachers', summary?.teachers?.quranCount ?? 0],
                      ['Arabic teachers', summary?.teachers?.arabicCount ?? 0],
                      ['Islamic Studies', summary?.teachers?.islamicStudiesCount ?? 0],
                      ['English-speaking', summary?.teachers?.englishSpeakingCount ?? 0],
                      ['Al-Azhar background', summary?.teachers?.azharCount ?? 0],
                      ['Ijazah background', summary?.teachers?.ijazahCount ?? 0],
                      ['Single-subject', summary?.teachers?.singleSubjectCount ?? 0],
                      ['Multi-subject', summary?.teachers?.multiSubjectCount ?? 0],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <SectionCard title="Current teacher load">
              {loadingSummary ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading load data…</div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Monthly hours</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{summary?.teachers?.totalMonthlyHours ?? 0}h</p>
                      <p className="mt-1 text-xs text-muted-foreground">Average {summary?.teachers?.averageMonthlyHours ?? 0}h per active teacher this month.</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Next 14 days</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">{summary?.teachers?.withUpcomingClasses ?? 0}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Teachers with scheduled load; {summary?.teachers?.withoutUpcomingClasses ?? 0} currently have none.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {(summary?.teacherRows || []).map((teacher) => (
                      <div key={teacher.id} className="rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-semibold text-foreground">{teacher.name}</p>
                            <p className="text-xs text-muted-foreground">{teacher.subjects.join(', ') || 'No subjects yet'} • {teacher.timezone}</p>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {teacher.upcomingHours14Days}h next 14d • {teacher.studentCount14Days} students • {teacher.monthlyHours}h this month
                          </div>
                        </div>
                      </div>
                    ))}
                    {!(summary?.teacherRows || []).length ? <div className="text-sm text-muted-foreground">No active teachers found.</div> : null}
                  </div>
                </div>
              )}
            </SectionCard>
          </div>
        ) : null}
      </div>

      <BusinessIntelligenceModal open={legacyBiOpen} onClose={() => setLegacyBiOpen(false)} />
    </div>
  );
}