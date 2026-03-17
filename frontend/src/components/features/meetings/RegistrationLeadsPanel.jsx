import React, { useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, ChevronDown, ChevronUp, Clock3, RotateCcw, UserPlus, Users } from 'lucide-react';
import moment from 'moment-timezone';
import { archiveRegistrationLead, convertRegistrationLead, listRegistrationLeads } from '../../../api/leads';
import { getBrowserTimezone } from '../../../utils/timezoneUtils';
import { makeCacheKey, readCache, writeCache } from '../../../utils/sessionCache';
import { useSearch } from '../../../contexts/SearchContext';

const formatDate = (value) => {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
  } catch {
    return String(value || '');
  }
};

const formatDateTime = (value) => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '—';
  }
};

const sourceLabel = {
  student_registration_form: 'Registration',
  evaluation_booking: 'Evaluation',
};

const sourceTone = {
  student_registration_form: 'bg-emerald-50 text-emerald-700',
  evaluation_booking: 'bg-sky-50 text-sky-700',
};

const statusTone = {
  new: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  converted: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  archived: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
};

const infoPillTone = {
  neutral: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
  accent: 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200',
  success: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  violet: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
};

export default function RegistrationLeadsPanel() {
  const browserTimezone = getBrowserTimezone();
  const { searchTerm, viewFilters } = useSearch();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [convertingId, setConvertingId] = useState('');
  const [archivingId, setArchivingId] = useState('');
  const [message, setMessage] = useState('');

  const leadFilters = viewFilters?.availability || { leadStatus: 'all', leadSource: 'all', leadTimeView: 'viewer' };
  const timeView = leadFilters.leadTimeView || 'viewer';

  const load = async () => {
    try {
      const cacheKey = makeCacheKey('meetings:registrationLeads', 'admin', { status: 'all' });
      const cached = readCache(cacheKey, { deps: ['leads'] });
      if (cached.hit && Array.isArray(cached.value?.items)) {
        setItems(cached.value.items);
        setLoading(false);
        if (cached.ageMs < 60_000) {
          setError('');
          return;
        }
      } else {
        setLoading((prev) => prev && items.length === 0);
      }

      setError('');
      const data = await listRegistrationLeads({ status: 'all' });
      const nextItems = data || [];
      setItems(nextItems);
      writeCache(cacheKey, { items: nextItems }, { ttlMs: 5 * 60_000, deps: ['leads'] });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleConvert = async (leadId) => {
    try {
      setConvertingId(leadId);
      setMessage('');
      const result = await convertRegistrationLead(leadId);
      setMessage(`Created guardian account. Password: ${result.password}`);
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.message || 'Failed to convert lead');
    } finally {
      setConvertingId('');
    }
  };

  const handleArchiveToggle = async (leadId, archived) => {
    try {
      setArchivingId(leadId);
      setMessage('');
      await archiveRegistrationLead(leadId, archived);
      setMessage(archived ? 'Lead archived.' : 'Lead restored.');
      await load();
    } catch (err) {
      setMessage(err?.response?.data?.message || 'Failed to update lead');
    } finally {
      setArchivingId('');
    }
  };

  const formatAvailabilitySlot = (slot, sourceTimezone, targetTimezone) => {
    try {
      const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(slot.day);
      const base = moment.tz('2026-01-04 00:00', 'YYYY-MM-DD HH:mm', sourceTimezone || 'UTC').day(dayIndex >= 0 ? dayIndex : 0);
      const [startHour, startMinute] = String(slot.startTime || '00:00').split(':').map(Number);
      const [endHour, endMinute] = String(slot.endTime || '00:00').split(':').map(Number);
      const start = base.clone().hour(startHour || 0).minute(startMinute || 0);
      const end = base.clone().hour(endHour || 0).minute(endMinute || 0);
      return `${start.clone().tz(targetTimezone).format('ddd h:mm A')} - ${end.clone().tz(targetTimezone).format('ddd h:mm A')}${slot.duration ? ` · ${slot.duration} min` : ''}`;
    } catch {
      return `${slot.day} ${slot.startTime}-${slot.endTime}${slot.duration ? ` · ${slot.duration} min` : ''}`;
    }
  };

  const filteredItems = useMemo(() => {
    const query = String(searchTerm || '').trim().toLowerCase();
    return (items || []).filter((lead) => {
      if (leadFilters.leadStatus !== 'all' && lead.status !== leadFilters.leadStatus) return false;
      if (leadFilters.leadSource !== 'all' && lead.source !== leadFilters.leadSource) return false;
      if (!query) return true;

      const haystack = [
        lead.personalInfo?.fullName,
        lead.personalInfo?.guardianName,
        lead.personalInfo?.email,
        lead.personalInfo?.phone,
        lead.address?.city,
        lead.address?.country,
        ...(lead.students || []).flatMap((student) => [student.firstName, student.lastName, ...(student.courses || [])]),
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }, [items, leadFilters, searchTerm]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">{filteredItems.length} shown</span>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">Registration</span>
        <span className="rounded-full bg-sky-50 px-3 py-1.5 text-sky-700">Evaluation</span>
      </div>

      {message ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading leads…</div> : null}

      {!loading ? (
        <div className="space-y-3">
          {filteredItems.length ? filteredItems.map((lead) => {
            const isOpen = expandedId === lead._id;
            const studentCount = Array.isArray(lead.students) ? lead.students.length : 0;
            const topStart = lead?.availability?.preferredStartingDate ? formatDate(lead.availability.preferredStartingDate) : '—';
            const displayName = lead.personalInfo?.fullName || lead.personalInfo?.guardianName || [lead.personalInfo?.firstName, lead.personalInfo?.lastName].filter(Boolean).join(' ');
            const targetTimezone = timeView === 'viewer' ? browserTimezone : (lead.personalInfo?.timezone || browserTimezone);
            const classPreferenceTags = lead.preferences?.classPreferences || [];
            const teacherPreferenceTags = lead.preferences?.teacherPreferences || [];
            const hasPreferenceTags = classPreferenceTags.length || teacherPreferenceTags.length;
            const sharedDuration = lead?.availability?.allDurationsSame ? lead?.availability?.sharedDuration : null;

            return (
              <div key={lead._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <button type="button" onClick={() => setExpandedId(isOpen ? '' : lead._id)} className="flex w-full items-start justify-between gap-3 text-left">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${sourceTone[lead.source] || 'bg-slate-100 text-slate-700'}`}>{sourceLabel[lead.source] || 'Lead'}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${statusTone[lead.status] || 'bg-slate-100 text-slate-600'}`}>{lead.status}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700"><Clock3 className="h-3 w-3" />{formatDateTime(lead.createdAt)}</span>
                    </div>
                    <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-3 xl:grid-cols-6">
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Contact</p><p className="break-words font-semibold text-slate-900">{displayName || '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Email</p><p className="break-words">{lead.personalInfo?.email || '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Phone</p><p>{lead.personalInfo?.phone || '—'}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Students</p><p>{studentCount}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Start</p><p>{topStart}</p></div>
                      <div><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Timezone</p><p>{targetTimezone}</p></div>
                    </div>
                  </div>
                  {isOpen ? <ChevronUp className="mt-1 h-4 w-4 text-slate-400" /> : <ChevronDown className="mt-1 h-4 w-4 text-slate-400" />}
                </button>

                {isOpen ? (
                  <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Overview</p>
                        <div className="flex flex-wrap gap-2">
                          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.accent}`}>{lead.personalInfo?.timezone || '—'}</span>
                          {lead.address?.city ? <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.neutral}`}>{lead.address.city}</span> : null}
                          {lead.address?.country ? <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.neutral}`}>{lead.address.country}</span> : null}
                          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.success}`}>{studentCount} student{studentCount === 1 ? '' : 's'}</span>
                          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.warning}`}>Start {topStart}</span>
                          <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.violet}`}>{lead?.availability?.schedulingMode || '—'}</span>
                          {sharedDuration ? <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.neutral}`}>{sharedDuration} min</span> : null}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes</p>
                        <div className="space-y-2">
                          <p className="rounded-xl bg-white px-3 py-2"><span className="font-medium text-slate-800">Schedule:</span> {lead.availability?.notes || '—'}</p>
                          <p className="rounded-xl bg-white px-3 py-2"><span className="font-medium text-slate-800">Preferences:</span> {lead.preferences?.notes || '—'}</p>
                        </div>
                      </div>
                    </div>

                    {hasPreferenceTags ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Preference tags</p>
                        <div className="flex flex-wrap gap-2">
                          {classPreferenceTags.map((item) => <span key={`${lead._id}-class-${item}`} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 ring-1 ring-violet-200">{item}</span>)}
                          {teacherPreferenceTags.map((item) => <span key={`${lead._id}-teacher-${item}`} className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">{item}</span>)}
                        </div>
                      </div>
                    ) : null}

                    <div>
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Students</p>
                      <div className="grid gap-4 lg:grid-cols-2">
                        {(lead.students || []).map((student, index) => (
                          <div key={`${lead._id}-${index}`} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                            <div className="flex items-center gap-2 font-semibold text-slate-900"><Users className="h-4 w-4 text-[#2C736C]" />{student.firstName} {student.lastName}</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(student.courses || []).map((course) => <span key={`${lead._id}-${index}-${course}`} className="rounded-full bg-[#2C736C]/10 px-3 py-1 text-xs font-semibold text-[#2C736C] ring-1 ring-[#2C736C]/10">{course}</span>)}
                              {student.classesPerWeek ? <span className={`rounded-full px-3 py-1 text-xs font-semibold ${infoPillTone.accent}`}>{student.classesPerWeek}/week</span> : null}
                              {student.birthDate ? <span className={`rounded-full px-3 py-1 text-xs font-semibold ${infoPillTone.neutral}`}>{formatDate(student.birthDate)}</span> : null}
                              {!sharedDuration && student.classDuration ? <span className={`rounded-full px-3 py-1 text-xs font-semibold ${infoPillTone.warning}`}>{student.classDuration} min</span> : null}
                            </div>
                            {student.notes ? <p className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-600"><span className="font-medium text-slate-800">Notes:</span> {student.notes}</p> : null}
                            {lead?.availability?.schedulingMode === 'separate' ? (
                              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                {(lead.availability?.slots || []).filter((slot) => Number(slot.studentIndex) === index).map((slot, slotIndex) => (
                                  <span key={`${lead._id}-${index}-${slotIndex}`} className="rounded-full bg-white px-3 py-1.5 text-slate-700 ring-1 ring-slate-200">
                                    {formatAvailabilitySlot(slot, lead.personalInfo?.timezone, targetTimezone)}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Times</p>
                      <div className="mb-3 flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.warning}`}>Preferred start {topStart}</span>
                        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${infoPillTone.violet}`}>{lead?.availability?.schedulingMode || '—'}</span>
                      </div>
                      {lead?.availability?.slots?.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {lead.availability.slots.map((slot, index) => (
                            <span key={`${lead._id}-slot-${index}`} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                              {formatAvailabilitySlot(slot, lead.personalInfo?.timezone, targetTimezone)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {lead.status !== 'converted' ? (
                        <button type="button" onClick={() => handleConvert(lead._id)} disabled={convertingId === lead._id || lead.status === 'archived'} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
                          <UserPlus className="h-4 w-4" /> {convertingId === lead._id ? 'Creating…' : 'Turn into guardian'}
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Converted</div>
                      )}

                      {lead.status !== 'converted' ? (
                        lead.status === 'archived' ? (
                          <button type="button" onClick={() => handleArchiveToggle(lead._id, false)} disabled={archivingId === lead._id} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">
                            <RotateCcw className="h-4 w-4" /> {archivingId === lead._id ? 'Saving…' : 'Restore'}
                          </button>
                        ) : (
                          <button type="button" onClick={() => handleArchiveToggle(lead._id, true)} disabled={archivingId === lead._id} className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 disabled:opacity-60">
                            <Archive className="h-4 w-4" /> {archivingId === lead._id ? 'Saving…' : 'Archive'}
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          }) : <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">No leads found.</div>}
        </div>
      ) : null}
    </div>
  );
}
