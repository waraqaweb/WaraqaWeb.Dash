import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock, Sparkles, PhoneCall, Users, RefreshCw } from 'lucide-react';
import PublicSiteHeader from '../../components/public/PublicSiteHeader';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import TimezoneSelector from '../../components/ui/TimezoneSelector';
import { fetchMeetingAvailability, bookMeeting } from '../../api/meetings';
import {
  MEETING_TYPES,
  MEETING_TYPE_DESCRIPTIONS,
  MEETING_TYPE_LABELS,
  MEETING_DEFAULT_DURATIONS,
} from '../../constants/meetingConstants';
import { getBrowserTimezone } from '../../utils/timezone';
import {
  CALENDAR_PREFERENCE_OPTIONS,
  getStoredCalendarPreference,
  storeCalendarPreference,
  downloadIcsFile,
} from '../../utils/calendarPreference';

const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

const toISO = (date) => date.toISOString();

const formatDayHeading = (date, timezone = 'UTC') =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  }).format(date);

const formatTimeRange = (start, end, tz) => {
  const opts = { hour: 'numeric', minute: '2-digit', timeZone: tz };
  const timeFormatter = new Intl.DateTimeFormat('en-US', opts);
  return `${timeFormatter.format(start)} – ${timeFormatter.format(end)} (${tz.replace('_', ' ')})`;
};

const buildDayKey = (date, timezone = 'UTC') =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);

const emptyStudent = () => ({ studentName: '', age: '', goals: '' });
const BOOKING_CONFIRMATION_MESSAGE = 'Your session is confirmed. Join through the meeting link at your scheduled time and we will be ready for you.';

const PublicEvaluationBooking = () => {
  const resolveMeetingId = (meeting) => {
    if (!meeting) return null;
    if (meeting._id) return String(meeting._id);
    if (meeting.id) return String(meeting.id);
    if (meeting.meetingId) return String(meeting.meetingId);
    return null;
  };

  const [guardian, setGuardian] = useState(() => ({
    guardianName: '',
    guardianEmail: '',
    guardianPhone: '',
    timezone: getBrowserTimezone(),
    preferredPlatform: 'zoom',
    preferredCalendar: getStoredCalendarPreference(),
  }));
  const [students, setStudents] = useState([emptyStudent()]);
  const [notes, setNotes] = useState('');
  const [availability, setAvailability] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState(null);
  const [selectedSlotKey, setSelectedSlotKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [errors, setErrors] = useState({});

  const durationLabel = `${MEETING_DEFAULT_DURATIONS[MEETING_TYPES.NEW_STUDENT_EVALUATION]} minutes`;
  const selectedSlot = useMemo(
    () => availability.find((slot) => slot.startUtc === selectedSlotKey),
    [availability, selectedSlotKey]
  );

  const openCalendarLink = (calendar, preference) => {
    if (!calendar || typeof window === 'undefined') return false;
    if (preference === 'google' && calendar.googleCalendarLink) {
      window.open(calendar.googleCalendarLink, '_blank', 'noopener,noreferrer');
      return true;
    }
    if (preference === 'outlook' && calendar.outlookCalendarLink) {
      window.open(calendar.outlookCalendarLink, '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  };

  const groupedSlots = useMemo(() => {
    return availability.reduce((map, slot) => {
      const startDate = new Date(slot.start);
      const dayKey = buildDayKey(startDate, guardian.timezone);
      if (!map[dayKey]) {
        map[dayKey] = { title: formatDayHeading(startDate, guardian.timezone), slots: [] };
      }
      map[dayKey].slots.push(slot);
      return map;
    }, {});
  }, [availability, guardian.timezone]);

  // Render the marketing-style header for public users
  // so /book/evaluation feels like part of the main website.

  const loadAvailability = useCallback(async () => {
    setAvailabilityLoading(true);
    setAvailabilityError(null);
    try {
      const start = new Date();
      const end = addDays(start, 21);
      const windows = await fetchMeetingAvailability({
        meetingType: MEETING_TYPES.NEW_STUDENT_EVALUATION,
        rangeStart: toISO(start),
        rangeEnd: toISO(end),
        timezone: guardian.timezone,
      });
      const sorted = windows.sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
      setAvailability(sorted);
      if (sorted.length === 0) {
        setSelectedSlotKey(null);
      } else if (selectedSlotKey) {
        const stillExists = sorted.some((slot) => slot.startUtc === selectedSlotKey);
        if (!stillExists) {
          setSelectedSlotKey(null);
        }
      }
    } catch (err) {
      console.error(err);
      setAvailabilityError(err?.response?.data?.message || err.message || 'Failed to load availability');
    } finally {
      setAvailabilityLoading(false);
    }
  }, [guardian.timezone, selectedSlotKey]);

  useEffect(() => {
    loadAvailability();
  }, [loadAvailability]);

  const handleGuardianChange = (field, value) => {
    setGuardian((prev) => ({ ...prev, [field]: value }));
    if (field === 'preferredCalendar') {
      storeCalendarPreference(value);
    }
  };

  const handleStudentChange = (idx, field, value) => {
    setStudents((prev) => prev.map((student, i) => (i === idx ? { ...student, [field]: value } : student)));
  };

  const addStudentRow = () => setStudents((prev) => [...prev, emptyStudent()]);
  const removeStudentRow = (idx) => {
    setStudents((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const validate = () => {
    const nextErrors = {};
    if (!guardian.guardianName.trim()) {
      nextErrors.guardianName = 'Please share your name';
    }
    if (!guardian.guardianEmail.trim() || !guardian.guardianEmail.includes('@')) {
      nextErrors.guardianEmail = 'Enter a valid email';
    }
    if (!guardian.timezone.trim()) {
      nextErrors.timezone = 'Timezone is required';
    }
    const namedStudents = students.filter((s) => s.studentName.trim().length > 0);
    if (namedStudents.length === 0) {
      nextErrors.students = 'Add at least one learner';
    }
    if (!selectedSlotKey) {
      nextErrors.slot = 'Select an available time';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    if (!selectedSlot) return;
    setSubmitting(true);
    setErrors({});
    try {
      const calendarPreference = guardian.preferredCalendar || getStoredCalendarPreference();
      const payload = {
        meetingType: MEETING_TYPES.NEW_STUDENT_EVALUATION,
        startTime: selectedSlot.startUtc || selectedSlot.start,
        timezone: 'UTC',
        guardian: {
          guardianName: guardian.guardianName,
          guardianEmail: guardian.guardianEmail,
          guardianPhone: guardian.guardianPhone,
          timezone: guardian.timezone,
          preferredPlatform: guardian.preferredPlatform,
          preferredCalendar: calendarPreference,
        },
        calendarPreference,
        notes,
        students: students
          .filter((student) => student.studentName.trim())
          .map((student) => ({
            studentName: student.studentName.trim(),
            notes: student.goals || undefined,
            age: student.age || undefined,
            isExistingStudent: false,
          })),
      };
      const response = await bookMeeting(payload);
        openCalendarLink(response?.calendar, calendarPreference);
      setConfirmation(response);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      console.error(err);
      setErrors((prev) => ({ ...prev, submit: err?.response?.data?.message || err.message || 'Unable to book meeting' }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadIcs = () => {
    if (!confirmation?.calendar?.icsContent) return;
    downloadIcsFile(confirmation.calendar.icsContent, 'evaluation-session.ics');
  };

  const handleOpenCalendarButton = (preference) => {
    if (!confirmation?.calendar) return;
    openCalendarLink(confirmation.calendar, preference || guardian.preferredCalendar || getStoredCalendarPreference());
  };

  const heroFont = { fontFamily: '"Space Grotesk", "Poppins", "Nunito", sans-serif' };

  return (
    <div className="min-h-screen flex flex-col bg-[#FFFCF2]">
      <PublicSiteHeader />
      <section className="relative isolate overflow-hidden bg-gradient-to-br from-[#fff9d2] via-[#fff4bf] to-[#ffe8a3]">
        <div className="max-w-5xl mx-auto px-6 pt-14 pb-10 text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/70 px-4 py-1 text-xs uppercase tracking-[0.2em] text-amber-700">
            <Sparkles className="h-4 w-4" /> New families welcome
          </p>
          <h1 className="mt-5 text-4xl sm:text-5xl font-semibold text-[#352500]" style={heroFont}>
            Schedule your {MEETING_TYPE_LABELS[MEETING_TYPES.NEW_STUDENT_EVALUATION].toLowerCase()}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[#6b4d01]">
            {MEETING_TYPE_DESCRIPTIONS[MEETING_TYPES.NEW_STUDENT_EVALUATION]} Choose a highlighted slot below to receive instant confirmation, the meeting link, and an import-ready calendar file.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-4 text-sm text-[#5b3a00]">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 shadow-sm border border-amber-100">
              <Clock className="h-4 w-4 text-[#C68C0A]" /> {durationLabel}
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 shadow-sm border border-amber-100">
              <PhoneCall className="h-4 w-4 text-[#C68C0A]" /> Live Zoom/Meet link provided
            </div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 shadow-sm border border-amber-100">
              <Users className="h-4 w-4 text-[#C68C0A]" /> Designed for new guardians
            </div>
          </div>
        </div>
      </section>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-12">
        {confirmation && (
          <div className="mb-10 rounded-3xl border border-[#FACC15] bg-white/90 shadow-[0_20px_80px_rgba(250,204,21,0.15)]">
            <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-[#C68C0A]">Booking confirmed</p>
                <h2 className="mt-2 text-2xl font-semibold text-[#342C03]" style={heroFont}>
                  {MEETING_TYPE_LABELS[MEETING_TYPES.NEW_STUDENT_EVALUATION]}
                </h2>
                <p className="mt-1 text-sm text-[#5c420a]">
                  {formatDayHeading(
                    new Date(confirmation.meeting.scheduledStart),
                    confirmation.meeting.timezone || guardian.timezone
                  )}
                  {' · '}
                  {formatTimeRange(
                    new Date(confirmation.meeting.scheduledStart),
                    new Date(confirmation.meeting.scheduledEnd),
                    confirmation.meeting.timezone || guardian.timezone
                  )}
                </p>
                <p className="mt-2 text-sm text-[#5c420a]">{BOOKING_CONFIRMATION_MESSAGE}</p>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  {confirmation.calendar?.googleCalendarLink && (
                    <button
                      type="button"
                      onClick={() => handleOpenCalendarButton('google')}
                      className="inline-flex items-center rounded-full border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 shadow-sm hover:bg-emerald-50"
                    >
                      Open in Google Calendar
                    </button>
                  )}
                  {confirmation.calendar?.outlookCalendarLink && (
                    <button
                      type="button"
                      onClick={() => handleOpenCalendarButton('outlook')}
                      className="inline-flex items-center rounded-full border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-900 shadow-sm hover:bg-sky-50"
                    >
                      Open in Outlook / Office 365
                    </button>
                  )}
                  {confirmation.calendar?.icsContent && (
                    <button
                      type="button"
                      onClick={handleDownloadIcs}
                      className="inline-flex items-center rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#245b56]"
                    >
                      Download calendar file (.ics)
                    </button>
                  )}
                </div>
                <p className="text-xs text-[#5c420a] max-w-sm">
                  We open your selected calendar immediately after booking. If you need the file again, download the .ics to import into Google, Outlook, or Apple Calendar with the meeting link and reminders.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1.1fr,0.9fr]">
          <form onSubmit={handleSubmit} className="rounded-3xl border border-amber-100 bg-white/90 p-6 shadow-[0_25px_120px_rgba(15,23,42,0.07)]">
            <p className="text-xs uppercase tracking-[0.3em] text-[#c0680e]">Step 1</p>
            <h2 className="mt-1 text-2xl font-semibold text-[#201400]" style={heroFont}>Family details</h2>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Input
                label="Your name"
                placeholder="Zaynab Ali"
                value={guardian.guardianName}
                onChange={(e) => handleGuardianChange('guardianName', e.target.value)}
                error={errors.guardianName}
              />
              <Input
                type="email"
                label="Email"
                placeholder="zaynab@email.com"
                value={guardian.guardianEmail}
                onChange={(e) => handleGuardianChange('guardianEmail', e.target.value)}
                error={errors.guardianEmail}
              />
              <Input
                label="Phone / WhatsApp"
                placeholder="+1 347 555 0192"
                value={guardian.guardianPhone}
                onChange={(e) => handleGuardianChange('guardianPhone', e.target.value)}
              />
              <label className="block text-xs font-medium text-slate-600">
                Time zone
                <div className="mt-1">
                  <TimezoneSelector
                    value={guardian.timezone}
                    onChange={(value) => handleGuardianChange('timezone', value)}
                    placeholder="Search by city, region, or GMT"
                    error={errors.timezone}
                  />
                </div>
              </label>
              <div className="md:col-span-2">
                <Select
                  label="Preferred calendar"
                  value={guardian.preferredCalendar}
                  onChange={(e) => handleGuardianChange('preferredCalendar', e.target.value)}
                >
                  {CALENDAR_PREFERENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-slate-500">We open this calendar immediately after you book.</p>
              </div>
            </div>

            <div className="mt-8">
              <p className="text-xs uppercase tracking-[0.3em] text-[#c0680e]">Step 2</p>
              <h3 className="mt-1 text-xl font-semibold text-[#201400]" style={heroFont}>Learner details</h3>
              {errors.students && <p className="mt-2 text-sm text-rose-600">{errors.students}</p>}
              <div className="mt-4 space-y-4">
                {students.map((student, index) => (
                  <div key={`student-${index}`} className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium text-slate-700">Learner {index + 1}</p>
                      {students.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStudentRow(index)}
                          className="text-xs text-slate-500 underline"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <Input
                        label="Name"
                        placeholder="Amina"
                        value={student.studentName}
                        onChange={(e) => handleStudentChange(index, 'studentName', e.target.value)}
                      />
                      <Input
                        label="Age (optional)"
                        placeholder="9"
                        value={student.age}
                        onChange={(e) => handleStudentChange(index, 'age', e.target.value)}
                      />
                    </div>
                    <label className="mt-3 block text-xs font-medium text-slate-600">
                      Learning goals
                      <textarea
                        className="mt-1 w-full rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm outline-none focus:border-[#2C736C] focus:ring-2 focus:ring-[#2C736C]/20"
                        rows={3}
                        placeholder="Reading fluency, tajwid focus, memorization support..."
                        value={student.goals}
                        onChange={(e) => handleStudentChange(index, 'goals', e.target.value)}
                      />
                    </label>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addStudentRow}
                className="mt-4 inline-flex items-center rounded-full border border-dashed border-amber-400 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50"
              >
                + Add learner
              </button>
            </div>

            <div className="mt-8">
              <p className="text-xs uppercase tracking-[0.3em] text-[#c0680e]">Step 3</p>
              <h3 className="mt-1 text-xl font-semibold text-[#201400]" style={heroFont}>Additional context</h3>
              <label className="mt-3 block text-xs font-medium text-slate-600">
                Notes for the admin team
                <textarea
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm outline-none focus:border-[#2C736C] focus:ring-2 focus:ring-[#2C736C]/20"
                  rows={4}
                  placeholder="Share class preferences, prior experiences, or any urgent updates."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
            </div>

            {selectedSlot && (
              <div className="mt-6 rounded-2xl border border-[#2C736C] bg-[#e9fbf7] p-4 text-sm text-[#0e3e38]">
                <p className="font-semibold">Selected time</p>
                <p>{formatDayHeading(new Date(selectedSlot.start), guardian.timezone)}</p>
                <p>{formatTimeRange(new Date(selectedSlot.start), new Date(selectedSlot.end), guardian.timezone)}</p>
              </div>
            )}

            {errors.submit && <p className="mt-4 text-sm text-rose-600">{errors.submit}</p>}

            <button
              type="submit"
              disabled={submitting || !selectedSlotKey}
              className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition ${
                submitting || !selectedSlotKey
                  ? 'bg-slate-400'
                  : 'bg-[#2C736C] hover:bg-[#245b56]'
              }`}
            >
              {submitting ? 'Booking your session...' : selectedSlotKey ? 'Book evaluation' : 'Select a slot to continue'}
            </button>
            <p className="mt-3 text-center text-xs text-slate-500">No payment is required. The meeting link arrives immediately.</p>
          </form>

          <div className="rounded-3xl border-2 border-dashed border-[#F1C40F] bg-[#fffdf3] p-6 shadow-inner">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[#c0680e]">Step 4</p>
                <h2 className="mt-1 text-xl font-semibold text-[#201400]" style={heroFont}>Select a slot</h2>
              </div>
              <button
                type="button"
                onClick={loadAvailability}
                className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/80 px-4 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50"
              >
                <RefreshCw className="h-4 w-4" /> Refresh times
              </button>
            </div>
            <p className="mt-2 text-sm text-[#5f4506]">
              All times display in <span className="font-semibold">{guardian.timezone.replace('_', ' ')}</span>. The slot you reserve is exactly what appears on the shared yellow calendar.
            </p>

            {availabilityLoading && (
              <div className="mt-6 flex items-center justify-center rounded-2xl bg-white/60 py-10">
                <LoadingSpinner />
              </div>
            )}

            {availabilityError && !availabilityLoading && (
              <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 text-sm text-rose-700">
                {availabilityError}
              </div>
            )}

            {!availabilityLoading && availability.length === 0 && !availabilityError && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-white/70 p-6 text-center text-sm text-amber-900">
                No open slots are available. Email <a className="font-semibold" href="mailto:hello@waraqa.org">waraqainc@gmail.com</a> and we will add a time that works for you.
              </div>
            )}

            <div className="mt-6 space-y-4">
              {Object.entries(groupedSlots).map(([key, group]) => (
                <div key={key} className="rounded-2xl border border-amber-100 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-center gap-3 text-sm font-semibold text-[#2f2001]">
                    <CalendarDays className="h-4 w-4 text-[#F59E0B]" /> {group.title}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.slots.map((slot) => {
                      const startDate = new Date(slot.start);
                      const endDate = new Date(slot.end);
                      const label = new Intl.DateTimeFormat('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZone: guardian.timezone
                      }).format(startDate);
                      const isSelected = slot.startUtc === selectedSlotKey;
                      return (
                        <button
                          key={slot.startUtc}
                          type="button"
                          onClick={() => setSelectedSlotKey(slot.startUtc)}
                          className={`min-w-[120px] rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
                            isSelected
                              ? 'border-[#2C736C] bg-[#2C736C] text-white'
                              : 'border-amber-200 bg-amber-50 text-[#3b2b04] hover:bg-amber-100'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {group.slots.length === 0 && (
                    <p className="text-sm text-slate-500">No times this day.</p>
                  )}
                </div>
              ))}
            </div>

            {selectedSlot && (
              <div className="mt-6 rounded-2xl border border-[#2C736C] bg-[#e9fbf7] p-4 text-sm text-[#0e3e38]">
                <p className="font-semibold">Selected time</p>
                <p>{formatDayHeading(new Date(selectedSlot.start), guardian.timezone)}</p>
                <p>{formatTimeRange(new Date(selectedSlot.start), new Date(selectedSlot.end), guardian.timezone)}</p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-12 rounded-3xl border border-amber-100 bg-white/80 p-6 text-center text-sm text-[#5f4506]">
          Prefer WhatsApp? Message <span className="font-semibold">+20 120 032 4956</span> and we will reply with this booking link.
        </div>
        </div>
      </main>
    </div>
  );
};

export default PublicEvaluationBooking;
