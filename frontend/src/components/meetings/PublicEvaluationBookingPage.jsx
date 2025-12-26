import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import Select from 'react-select';
import LoadingSpinner from '../ui/LoadingSpinner';
import Input from '../ui/Input';
import { MEETING_TYPES, MEETING_TYPE_LABELS, MEETING_TYPE_DESCRIPTIONS } from '../../constants/meetingConstants';
import { fetchMeetingAvailability, bookMeeting } from '../../api/meetings';
import { getBrowserTimezone } from '../../utils/timezone';
import { getTimezoneOptions } from '../../utils/timezoneOptions';
import api from '../../api/axios';
import {
  CALENDAR_PREFERENCE_OPTIONS,
  getStoredCalendarPreference,
  storeCalendarPreference,
  downloadIcsFile,
} from '../../utils/calendarPreference';

const formatDay = (date, timezone = 'UTC') =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  }).format(date);

const formatTime = (date, timezone = 'UTC') =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(date);

const formatDayKey = (date, timezone = 'UTC') =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone }).format(date);

const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

const pad2 = (value) => String(value).padStart(2, '0');

const monthKeyFromYearMonth = (year, monthIndex) => `${year}-${pad2(monthIndex + 1)}`;

const parseMonthKey = (key) => {
  const [y, m] = String(key || '').split('-');
  const year = Number(y);
  const monthIndex = Number(m) - 1;
  return {
    year: Number.isFinite(year) ? year : new Date().getUTCFullYear(),
    monthIndex: Number.isFinite(monthIndex) ? monthIndex : new Date().getUTCMonth(),
  };
};

const shiftMonthKey = (key, delta) => {
  const { year, monthIndex } = parseMonthKey(key);
  const next = new Date(Date.UTC(year, monthIndex + delta, 1, 12, 0, 0));
  return monthKeyFromYearMonth(next.getUTCFullYear(), next.getUTCMonth());
};

const compareMonthKey = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

const makeMonthDayDate = (year, monthIndex, day) => new Date(Date.UTC(year, monthIndex, day, 12, 0, 0));

const weekdayIndex = (date, timezone) => {
  const short = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[short] ?? 0;
};

const createStudent = () => ({
  id: `student_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  firstName: '',
  lastName: '',
  age: '',
  gender: '',
  notes: '',
});

const PublicEvaluationBookingPage = () => {
  const meetingType = MEETING_TYPES.NEW_STUDENT_EVALUATION;
  const detectedTimezone = getBrowserTimezone();
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [calendarPreference, setCalendarPreference] = useState(() => getStoredCalendarPreference());

  const [branding, setBranding] = useState({
    title: 'Waraqa',
    slogan: 'Welcome',
    logoUrl: null,
  });

  const [guardianName, setGuardianName] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [students, setStudents] = useState(() => [createStudent()]);
  const [notes, setNotes] = useState('');

  const [availability, setAvailability] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);
  const confirmationRef = useRef(null);

  const timezoneOptions = useMemo(() => {
    const base = getTimezoneOptions();
    const preferred = [timezone, detectedTimezone].filter(Boolean);

    const byValue = new Map(base.map((opt) => [opt.value, opt]));
    const prioritized = preferred.map((value) => byValue.get(value)).filter(Boolean);
    const seen = new Set(prioritized.map((opt) => opt.value));
    const rest = base.filter((opt) => !seen.has(opt.value));
    return [...prioritized, ...rest];
  }, [timezone, detectedTimezone]);

  const loadAvailability = useCallback(async (tz) => {
    setLoadingSlots(true);
    setError(null);
    try {
      const start = new Date();
      const end = addDays(start, 21);
      const windows = await fetchMeetingAvailability({
        meetingType,
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
        timezone: tz,
      });
      const sorted = windows.sort((a, b) => new Date(a.start) - new Date(b.start));
      setAvailability(sorted);
      if (sorted.length === 0) {
        setSelectedSlotId(null);
      }
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.message || err.message || 'Unable to load availability');
    } finally {
      setLoadingSlots(false);
    }
  }, [meetingType]);

  useEffect(() => {
    setCalendarPreference(getStoredCalendarPreference());
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.get('/settings/branding');
        if (!mounted) return;
        const b = res?.data?.branding;
        const title = b?.title || 'Waraqa';
        const slogan = b?.slogan || 'Welcome';
        const logoUrl = b?.logo?.url || b?.logo?.dataUri || null;
        setBranding({ title, slogan, logoUrl });
      } catch (e) {
        // ignore branding load errors; keep defaults
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    loadAvailability(timezone);
  }, [timezone, loadAvailability]);

  const availabilityByDayKey = useMemo(() => {
    return availability.reduce((acc, slot) => {
      const startDate = new Date(slot.start);
      const dayKey = formatDayKey(startDate, timezone);
      if (!acc[dayKey]) {
        acc[dayKey] = { title: formatDay(startDate, timezone), slots: [] };
      }
      acc[dayKey].slots.push(slot);
      return acc;
    }, {});
  }, [availability, timezone]);

  const minDayKey = useMemo(() => formatDayKey(new Date(), timezone), [timezone]);
  const maxDayKey = useMemo(() => formatDayKey(addDays(new Date(), 21), timezone), [timezone]);
  const minMonthKey = useMemo(() => minDayKey.slice(0, 7), [minDayKey]);
  const maxMonthKey = useMemo(() => maxDayKey.slice(0, 7), [maxDayKey]);

  const [visibleMonthKey, setVisibleMonthKey] = useState(() => monthKeyFromYearMonth(new Date().getUTCFullYear(), new Date().getUTCMonth()));
  const [selectedDayKey, setSelectedDayKey] = useState(null);

  useEffect(() => {
    // Keep month picker in a valid range when timezone changes.
    setVisibleMonthKey((prev) => {
      if (compareMonthKey(prev, minMonthKey) < 0) return minMonthKey;
      if (compareMonthKey(prev, maxMonthKey) > 0) return maxMonthKey;
      return prev;
    });

    // If previously selected day no longer exists in new timezone grouping, clear selection.
    setSelectedDayKey((prev) => (prev && availabilityByDayKey[prev] ? prev : prev));
  }, [minMonthKey, maxMonthKey, availabilityByDayKey]);

  const selectedDaySlots = useMemo(() => {
    if (!selectedDayKey) return [];
    const group = availabilityByDayKey[selectedDayKey];
    const slots = group?.slots || [];
    return slots
      .slice()
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }, [availabilityByDayKey, selectedDayKey]);

  const calendarGrid = useMemo(() => {
    const { year, monthIndex } = parseMonthKey(visibleMonthKey);
    const first = makeMonthDayDate(year, monthIndex, 1);
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0, 12, 0, 0)).getUTCDate();
    const firstWeekday = weekdayIndex(first, timezone);
    const cells = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(makeMonthDayDate(year, monthIndex, day));
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return { year, monthIndex, cells };
  }, [visibleMonthKey, timezone]);

  const handleBook = async () => {
    if (success) {
      setSuccess(null);
    }

    const cleanedGuardianName = guardianName.trim();
    const cleanedEmail = guardianEmail.trim();
    const cleanedStudents = (students || []).map((student) => ({
      ...student,
      firstName: (student.firstName || '').trim(),
      lastName: (student.lastName || '').trim(),
      age: String(student.age || '').trim(),
      gender: String(student.gender || '').trim(),
      notes: (student.notes || '').trim(),
    }));

    const validStudents = cleanedStudents.filter((student) => student.firstName && student.lastName);

    const invalidStudent = cleanedStudents.find((student) => (student.firstName || student.lastName || student.age || student.gender || student.notes) && (!student.firstName || !student.lastName));

    if (!cleanedGuardianName) {
      setError('Please enter your name.');
      return;
    }
    if (!cleanedEmail) {
      setError('Please enter your email.');
      return;
    }
    if (invalidStudent) {
      setError('Please enter both first and last name for each student.');
      return;
    }
    if (validStudents.length === 0) {
      setError('Please add at least one student.');
      return;
    }
    if (!selectedSlotId) {
      setError('Please pick a time slot.');
      return;
    }

    const slot = availability.find((item) => item.startUtc === selectedSlotId);
    if (!slot) {
      setError('That slot is no longer available. Please refresh and try again.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const preference = calendarPreference || getStoredCalendarPreference();
      const payload = {
        meetingType,
        startTime: slot.startUtc || slot.start,
        timezone: 'UTC',
        guardian: {
          guardianName: cleanedGuardianName,
          guardianEmail: cleanedEmail,
          guardianPhone: guardianPhone.trim(),
          timezone,
          preferredCalendar: preference,
        },
        students: validStudents.map((student) => ({
          studentName: `${student.firstName} ${student.lastName}`.trim(),
          firstName: student.firstName,
          lastName: student.lastName,
          age: student.age ? Number(student.age) : undefined,
          gender: student.gender || undefined,
          notes: student.notes || undefined,
          isExistingStudent: false,
        })),
        notes: notes.trim(),
        calendarPreference: preference,
      };

      const response = await bookMeeting(payload);
      setSuccess({ response, slot });

      // Auto-open preferred calendar after booking.
      if (preference === 'google') {
        const link = response?.calendar?.googleCalendarLink;
        if (link) window.open(link, '_blank');
      } else if (preference === 'outlook') {
        const link = response?.calendar?.outlookCalendarLink;
        if (link) window.open(link, '_blank');
      } else if (preference === 'apple') {
        downloadIcsFile(response?.calendar?.icsContent, 'evaluation.ics');
      }
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.message || err.message || 'Unable to book meeting');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!success) return;
    // After booking, scroll up so the confirmation is immediately visible.
    confirmationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [success]);

  const primaryLabel = MEETING_TYPE_LABELS[meetingType] || 'Evaluation';
  const primaryDescription = MEETING_TYPE_DESCRIPTIONS[meetingType] || 'Book a short call with our team.';

  const calendarPreferenceButtons = useMemo(() => {
    return CALENDAR_PREFERENCE_OPTIONS.map((option) => {
      const selected = calendarPreference === option.value;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            setCalendarPreference(option.value);
            storeCalendarPreference(option.value);

            // If booking already exists, treat this as an immediate action.
            if (success?.response) {
              if (option.value === 'google') {
                const link = success.response?.calendar?.googleCalendarLink;
                if (link) window.open(link, '_blank');
              } else if (option.value === 'outlook') {
                const link = success.response?.calendar?.outlookCalendarLink;
                if (link) window.open(link, '_blank');
              } else if (option.value === 'apple') {
                downloadIcsFile(success.response?.calendar?.icsContent, 'evaluation.ics');
              }
            }
          }}
          disabled={submitting}
          className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
            selected
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-background text-foreground hover:border-primary'
          }`}
        >
          {option.label}
        </button>
      );
    });
  }, [calendarPreference, submitting, success]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl bg-card p-5 shadow-sm ring-1 ring-border">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {branding.logoUrl ? (
                <img
                  src={branding.logoUrl}
                  alt="Waraqa"
                  className="h-10 w-10 rounded-xl bg-background object-contain"
                />
              ) : (
                <div className="h-10 w-10 rounded-xl bg-primary/10" />
              )}
              <div>
                <p className="text-xs font-semibold text-muted-foreground">{branding.slogan}</p>
                <h1 className="text-lg font-semibold leading-tight sm:text-xl">
                  {primaryLabel}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{primaryDescription}</p>
              </div>
            </div>

            <Link
              to="/dashboard/login"
              className="inline-flex h-9 items-center justify-center rounded-full border border-border bg-background px-4 text-xs font-semibold text-foreground"
            >
              Login page
            </Link>
          </div>

          {success && (
            <div ref={confirmationRef} className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-emerald-900">Booking confirmed</p>
                  <p className="mt-1 text-sm text-emerald-900/80">
                    {formatDay(new Date(success.slot.start), timezone)} at {formatTime(new Date(success.slot.start), timezone)} ({timezone})
                  </p>

                  <div className="mt-4">
                    <p className="text-xs font-semibold text-emerald-900/90">Calendar preference</p>
                    <div className="mt-2 flex flex-wrap gap-2">{calendarPreferenceButtons}</div>
                    <p className="mt-2 text-[11px] text-emerald-900/70">We will open this calendar automatically after booking.</p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {success.response?.calendar?.googleCalendarLink && (
                      <button
                        type="button"
                        onClick={() => window.open(success.response.calendar.googleCalendarLink, '_blank')}
                        className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"
                      >
                        Open Google Calendar
                      </button>
                    )}
                    {success.response?.calendar?.outlookCalendarLink && (
                      <button
                        type="button"
                        onClick={() => window.open(success.response.calendar.outlookCalendarLink, '_blank')}
                        className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"
                      >
                        Open Outlook
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-emerald-900/70">
                    If you don’t receive the meeting link, please contact the admin team.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr,360px]">
            <div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Your name"
                  placeholder="Guardian name"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  disabled={submitting}
                />
                <Input
                  label="Your email"
                  placeholder="name@example.com"
                  value={guardianEmail}
                  onChange={(e) => setGuardianEmail(e.target.value)}
                  disabled={submitting}
                />
                <Input
                  label="Phone (optional)"
                  placeholder="+20 ..."
                  value={guardianPhone}
                  onChange={(e) => setGuardianPhone(e.target.value)}
                  disabled={submitting}
                />
                <div className="w-full">
                  <label className="inline-flex w-full flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Timezone
                    <Select
                      instanceId="public-eval-timezone"
                      isSearchable
                      isDisabled={submitting}
                      options={timezoneOptions}
                      value={timezoneOptions.find((opt) => opt.value === timezone) || null}
                      onChange={(opt) => setTimezone(opt?.value || detectedTimezone)}
                      placeholder="Search timezone..."
                      styles={{
                        control: (base, state) => ({
                          ...base,
                          borderRadius: 12,
                          borderColor: state.isFocused ? 'hsl(var(--border))' : 'hsl(var(--border))',
                          backgroundColor: 'hsl(var(--background))',
                          padding: '0px 2px',
                          boxShadow: state.isFocused ? '0 0 0 2px hsl(var(--ring))' : 'none',
                          minHeight: 40,
                          fontSize: '0.875rem',
                        }),
                        menu: (base) => ({ ...base, zIndex: 60 }),
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setTimezone(getBrowserTimezone())}
                    disabled={submitting}
                    className="mt-1 text-xs font-semibold text-muted-foreground underline"
                  >
                    Detect my timezone
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Students</p>
                  <button
                    type="button"
                    onClick={() => setStudents((prev) => [...(prev || []), createStudent()])}
                    disabled={submitting}
                    className="inline-flex h-8 items-center justify-center rounded-full border border-border bg-background px-3 text-xs font-semibold"
                  >
                    Add student
                  </button>
                </div>

                <div className="mt-3 space-y-3">
                  {(students || []).map((student, index) => (
                    <div key={student.id} className="rounded-xl border border-border bg-background p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-muted-foreground">Student {index + 1}</p>
                        {students.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setStudents((prev) => (prev || []).filter((s) => s.id !== student.id))}
                            disabled={submitting}
                            className="text-xs font-semibold text-muted-foreground underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Input
                          label="First name"
                          placeholder="First name"
                          value={student.firstName}
                          onChange={(e) =>
                            setStudents((prev) =>
                              (prev || []).map((s) => (s.id === student.id ? { ...s, firstName: e.target.value } : s))
                            )
                          }
                          disabled={submitting}
                        />
                        <Input
                          label="Last name"
                          placeholder="Last name"
                          value={student.lastName}
                          onChange={(e) =>
                            setStudents((prev) =>
                              (prev || []).map((s) => (s.id === student.id ? { ...s, lastName: e.target.value } : s))
                            )
                          }
                          disabled={submitting}
                        />
                        <Input
                          label="Age"
                          placeholder="Age"
                          type="number"
                          value={student.age}
                          onChange={(e) =>
                            setStudents((prev) =>
                              (prev || []).map((s) => (s.id === student.id ? { ...s, age: e.target.value } : s))
                            )
                          }
                          disabled={submitting}
                        />
                        <label className="inline-flex w-full flex-col gap-1 text-xs font-medium text-muted-foreground">
                          Gender
                          <select
                            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                            value={student.gender}
                            onChange={(e) =>
                              setStudents((prev) =>
                                (prev || []).map((s) => (s.id === student.id ? { ...s, gender: e.target.value } : s))
                              )
                            }
                            disabled={submitting}
                          >
                            <option value="">Select</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                          </select>
                        </label>
                      </div>

                      <label className="mt-3 inline-flex w-full flex-col gap-1 text-xs font-medium text-muted-foreground">
                        Notes (optional)
                        <textarea
                          className="w-full rounded-xl border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                          rows={2}
                          placeholder="Any notes about this student"
                          value={student.notes}
                          onChange={(e) =>
                            setStudents((prev) =>
                              (prev || []).map((s) => (s.id === student.id ? { ...s, notes: e.target.value } : s))
                            )
                          }
                          disabled={submitting}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <label className="mt-4 inline-flex w-full flex-col gap-1 text-xs font-medium text-muted-foreground">
                Notes (optional)
                <textarea
                  className="w-full rounded-xl border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  rows={3}
                  placeholder="Language level, goals, availability..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={submitting}
                />
              </label>

              {!success && (
                <div className="mt-4">
                  <p className="text-xs font-medium text-muted-foreground">Calendar preference</p>
                  <div className="mt-2 flex flex-wrap gap-2">{calendarPreferenceButtons}</div>
                  <p className="mt-2 text-[11px] text-muted-foreground">We will open this calendar automatically after booking.</p>
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleBook}
                  className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  disabled={submitting}
                >
                  {submitting ? 'Booking…' : 'Book evaluation'}
                </button>
              </div>
            </div>

            <div className="lg:sticky lg:top-6">
              <div className="rounded-2xl border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CalendarDays className="h-4 w-4" /> Available times
                  </div>
                  <button
                    type="button"
                    onClick={() => loadAvailability(timezone)}
                    className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-background px-3 text-xs font-semibold"
                    disabled={loadingSlots || submitting}
                  >
                    <RefreshCw className="h-4 w-4" /> Refresh
                  </button>
                </div>

                {loadingSlots && (
                  <div className="mt-3 flex items-center justify-center rounded-xl bg-muted/30 py-6">
                    <LoadingSpinner />
                  </div>
                )}

                {error && !loadingSlots && (
                  <div className="mt-3 rounded-xl border border-border bg-destructive/10 p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  </div>
                )}

                {!loadingSlots && availability.length === 0 && !error && (
                  <p className="mt-3 text-sm text-muted-foreground">No open slots right now. Please try again later.</p>
                )}

                {!loadingSlots && availability.length > 0 && !error && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setVisibleMonthKey((prev) => {
                          const next = shiftMonthKey(prev, -1);
                          return compareMonthKey(next, minMonthKey) < 0 ? minMonthKey : next;
                        })}
                        disabled={compareMonthKey(visibleMonthKey, minMonthKey) <= 0}
                        className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold disabled:opacity-50"
                      >
                        Prev
                      </button>
                      <p className="text-sm font-semibold">
                        {new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: timezone }).format(
                          makeMonthDayDate(calendarGrid.year, calendarGrid.monthIndex, 1)
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => setVisibleMonthKey((prev) => {
                          const next = shiftMonthKey(prev, 1);
                          return compareMonthKey(next, maxMonthKey) > 0 ? maxMonthKey : next;
                        })}
                        disabled={compareMonthKey(visibleMonthKey, maxMonthKey) >= 0}
                        className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                        <div key={d}>{d}</div>
                      ))}
                    </div>

                    <div className="mt-2 grid grid-cols-7 gap-1">
                      {calendarGrid.cells.map((cell, idx) => {
                        if (!cell) return <div key={`empty_${idx}`} />;

                        const dayKey = formatDayKey(cell, timezone);
                        const inRange = dayKey >= minDayKey && dayKey <= maxDayKey;
                        const hasSlots = Boolean(availabilityByDayKey[dayKey]?.slots?.length);
                        const disabled = !inRange || !hasSlots || submitting;
                        const selected = selectedDayKey === dayKey;
                        const dayNumber = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: timezone }).format(cell);

                        return (
                          <button
                            key={dayKey}
                            type="button"
                            onClick={() => {
                              setSelectedDayKey(dayKey);
                              setSelectedSlotId(null);
                            }}
                            disabled={disabled}
                            className={`h-9 w-full rounded-lg border text-sm font-semibold transition ${
                              selected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background hover:border-primary'
                            } ${disabled ? 'opacity-40 hover:border-border' : ''}`}
                          >
                            {dayNumber}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Times</p>
                      {!selectedDayKey ? (
                        <p className="mt-2 text-sm text-muted-foreground">Choose a day to see available times.</p>
                      ) : selectedDaySlots.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">No times available on this day.</p>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedDaySlots.map((slot) => {
                            const id = slot.startUtc || slot.start;
                            const selected = selectedSlotId === id;
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setSelectedSlotId(id)}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  selected
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-border bg-background hover:border-primary'
                                }`}
                                disabled={submitting}
                              >
                                {formatTime(new Date(slot.start), timezone)}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicEvaluationBookingPage;
