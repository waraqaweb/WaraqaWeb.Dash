/**
 * RegisterStudentPage — public student registration funnel.
 *
 * Guardians land here (no login) and walk through a short, friendly funnel:
 *   1. About you (guardian contact + timezone)
 *   2. Your students (one or more children, with desired courses)
 *   3. Availability (preferred start date + weekly time slots)
 *   4. Review & submit
 *
 * Submitting creates a PENDING RegistrationLead for admin approval
 * (POST /api/leads/public/student-registration). No account is created until
 * an admin converts the lead from the dashboard.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Select from 'react-select';
import {
  User, Users, CalendarDays, ClipboardCheck, CheckCircle2, AlertCircle,
  Plus, Trash2, Copy, ChevronRight, ChevronLeft, Send,
} from 'lucide-react';
import api from '../../api/axios';
import Input from '../../components/ui/Input';
import { subjects as COURSE_OPTIONS } from '../../constants/reportTopicsConfig';
import { getTimezoneOptions } from '../../utils/timezoneOptions';
import { getBrowserTimezone } from '../../utils/timezone';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DURATIONS = [30, 45, 60, 90, 120];

const STEPS = [
  { key: 'guardian', label: 'About you', icon: User, description: 'Tell us about you, the parent or guardian. You will add the student(s) in the next step.' },
  { key: 'students', label: 'Students', icon: Users, description: 'Add the student(s) who will take classes — this can be your child, yourself, or both.' },
  { key: 'availability', label: 'Availability', icon: CalendarDays, description: 'Pick the days and times that work best for you.' },
  { key: 'review', label: 'Review', icon: ClipboardCheck, description: 'Check everything looks right, then submit.' },
];

const makeStudent = () => ({
  id: `s_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  firstName: '',
  lastName: '',
  gender: '',
  birthDate: '',
  courses: [],
  classesPerWeek: '',
  notes: '',
  isSelf: false,
});

const addMinutesToTime = (time, minutes) => {
  if (!time || !Number.isFinite(minutes)) return '';
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const total = h * 60 + m + minutes;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
};

const makeSlot = (day = 'Monday', start = '16:00', duration = 60) => ({
  id: `slot_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  day,
  startTime: start,
  duration,
  endTime: addMinutesToTime(start, duration),
});

const selectStyles = {
  control: (base) => ({ ...base, borderRadius: 12, minHeight: 40, borderColor: '#e2e8f0' }),
  menu: (base) => ({ ...base, zIndex: 30 }),
};

const RegisterStudentPage = () => {
  const detectedTimezone = getBrowserTimezone();
  const [stepIdx, setStepIdx] = useState(0);
  const [branding, setBranding] = useState({ title: 'Waraqa', slogan: 'Welcome', logoUrl: null });

  // Guardian
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState(detectedTimezone || 'Africa/Cairo');
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');

  // Students
  const [students, setStudents] = useState(() => [makeStudent()]);
  const [enrollSelf, setEnrollSelf] = useState(false);

  // Availability
  const [preferredStartingDate, setPreferredStartingDate] = useState('');
  const [slots, setSlots] = useState(() => [makeSlot()]);
  const [availabilityNotes, setAvailabilityNotes] = useState('');

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.get('/settings/branding');
        if (!mounted) return;
        const b = res?.data?.branding;
        setBranding({
          title: b?.title || 'Waraqa',
          slogan: b?.slogan || 'Welcome',
          logoUrl: b?.logo?.url || b?.logo?.dataUri || null,
        });
      } catch {
        /* keep defaults */
      }
    })();
    return () => { mounted = false; };
  }, []);

  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);
  const courseOptions = useMemo(
    () => COURSE_OPTIONS.map((c) => ({ value: c, label: c })),
    [],
  );

  const updateStudent = (id, patch) =>
    setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addStudent = () => setStudents((prev) => [...prev, makeStudent()]);
  const removeStudent = (id) =>
    setStudents((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));

  // Let the guardian quickly enroll themselves as a student (uses their name).
  const toggleEnrollSelf = () => {
    setEnrollSelf((was) => {
      const next = !was;
      setStudents((prev) => {
        if (next) {
          // Fill the first student with the guardian's own name.
          const [first, ...rest] = prev;
          return [{ ...(first || makeStudent()), firstName: firstName.trim() || first?.firstName || '', lastName: lastName.trim() || first?.lastName || '', isSelf: true }, ...rest];
        }
        // Clear the self flag (and the auto-filled name if untouched).
        return prev.map((s) => (s.isSelf ? { ...s, isSelf: false } : s));
      });
      return next;
    });
  };

  const updateSlot = (id, patch) =>
    setSlots((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      const next = { ...s, ...patch };
      // Keep endTime derived from start + duration unless the user edits it directly.
      if (patch.startTime != null || patch.duration != null) {
        next.endTime = addMinutesToTime(next.startTime, Number(next.duration) || 60);
      }
      return next;
    }));
  const addSlot = () => setSlots((prev) => [...prev, makeSlot()]);
  const removeSlot = (id) =>
    setSlots((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  const duplicateToNextDay = (id) =>
    setSlots((prev) => {
      const src = prev.find((s) => s.id === id);
      if (!src) return prev;
      const nextDayIdx = (DAYS.indexOf(src.day) + 1) % 7;
      return [...prev, makeSlot(DAYS[nextDayIdx], src.startTime, Number(src.duration) || 60)];
    });

  const validateStep = (idx) => {
    if (idx === 0) {
      if (!firstName.trim() || !lastName.trim()) return 'Please enter your first and last name.';
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Please enter a valid email address.';
      if (!timezone) return 'Please select your timezone.';
    }
    if (idx === 1) {
      const valid = students.filter((s) => s.firstName.trim() && s.lastName.trim());
      if (!valid.length) return 'Please add at least one student with a first and last name.';
    }
    if (idx === 2) {
      if (!preferredStartingDate) return 'Please choose a preferred starting date.';
      const valid = slots.filter((s) => s.day && s.startTime && s.endTime);
      if (!valid.length) return 'Please add at least one availability slot.';
    }
    return '';
  };

  const goNext = () => {
    const msg = validateStep(stepIdx);
    if (msg) { setError(msg); return; }
    setError('');
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  };
  const goBack = () => { setError(''); setStepIdx((i) => Math.max(i - 1, 0)); };

  const buildPayload = () => ({
    personalInfo: {
      fullName: `${firstName.trim()} ${lastName.trim()}`.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      guardianName: `${firstName.trim()} ${lastName.trim()}`.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      timezone,
    },
    address: { city: city.trim(), state: '', country: country.trim() },
    preferences: { classPreferences: [], teacherPreferences: [], notes: '' },
    students: students
      .filter((s) => s.firstName.trim() && s.lastName.trim())
      .map((s) => ({
        firstName: s.firstName.trim(),
        lastName: s.lastName.trim(),
        gender: s.gender || '',
        birthDate: s.birthDate || undefined,
        courses: s.courses,
        classesPerWeek: s.classesPerWeek ? Number(s.classesPerWeek) : undefined,
        notes: s.notes.trim(),
        isSelf: Boolean(s.isSelf),
      })),
    availability: {
      weekdays: [...new Set(slots.map((s) => s.day))],
      preferredStartingDate,
      schedulingMode: 'consecutive',
      allDurationsSame: new Set(slots.map((s) => Number(s.duration))).size === 1,
      sharedDuration: slots.length ? Number(slots[0].duration) : undefined,
      slots: slots
        .filter((s) => s.day && s.startTime && s.endTime)
        .map((s) => ({
          day: s.day,
          startTime: s.startTime,
          endTime: s.endTime,
          duration: Number(s.duration) || undefined,
        })),
      notes: availabilityNotes.trim(),
    },
  });

  const handleSubmit = async () => {
    for (let i = 0; i < 3; i += 1) {
      const msg = validateStep(i);
      if (msg) { setStepIdx(i); setError(msg); return; }
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/leads/public/student-registration', buildPayload());
      setSuccess(true);
    } catch (err) {
      setError(err?.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-emerald-900 mb-2">Thank you!</h1>
          <p className="text-slate-600 mb-1">Your registration has been received.</p>
          <p className="text-slate-500 text-sm">Our team will review your details and reach out to you shortly to confirm your schedule.</p>
          <Link to="/login" className="inline-block mt-6 px-5 py-2 rounded-full bg-emerald-700 text-white text-sm font-medium">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  const StepIcon = STEPS[stepIdx].icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header / branding */}
        <div className="text-center mb-6">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.title} className="h-12 mx-auto mb-2 object-contain" />
          ) : (
            <h2 className="text-xl font-bold text-emerald-900">{branding.title}</h2>
          )}
          <h1 className="text-2xl font-bold text-emerald-900">Register a student</h1>
          <p className="text-sm text-slate-600">It only takes a couple of minutes.</p>
        </div>

        {/* Progress / funnel steps */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < stepIdx;
            const active = i === stepIdx;
            return (
              <React.Fragment key={s.key}>
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div className={`h-9 w-9 rounded-full flex items-center justify-center border-2 transition ${
                    active ? 'bg-emerald-700 border-emerald-700 text-white'
                      : done ? 'bg-emerald-100 border-emerald-400 text-emerald-700'
                      : 'bg-white border-slate-200 text-slate-400'
                  }`}>
                    {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className={`text-[11px] font-medium ${active ? 'text-emerald-800' : 'text-slate-500'}`}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 -mt-5 ${i < stepIdx ? 'bg-emerald-400' : 'bg-slate-200'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6">
          <div className="flex items-center gap-2 mb-1 text-emerald-900">
            <StepIcon className="h-5 w-5" />
            <h3 className="text-lg font-semibold">{STEPS[stepIdx].label}</h3>
          </div>
          <p className="text-sm text-slate-500 mb-4">{STEPS[stepIdx].description}</p>

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Step 1: Guardian */}
          {stepIdx === 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Input label="First name *" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <Input label="Last name *" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              <Input label="Email *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="sm:col-span-2" />
              <Input label="Phone (WhatsApp)" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Timezone *</span>
                <Select
                  options={timezoneOptions}
                  value={timezoneOptions.find((o) => o.value === timezone) || null}
                  onChange={(opt) => setTimezone(opt?.value || '')}
                  styles={selectStyles}
                  placeholder="Select timezone"
                />
              </div>
              <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
              <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          )}

          {/* Step 2: Students */}
          {stepIdx === 1 && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-emerald-900">
                  <input type="checkbox" checked={enrollSelf} onChange={toggleEnrollSelf} />
                  <span>I want to take classes myself (enroll me as a student)</span>
                </label>
                <p className="text-[12px] text-slate-500 mt-1">
                  Adding one child? Just fill in their details below. Have more students? Use <strong>Add another student</strong> at the bottom.
                </p>
              </div>
              {students.map((s, idx) => (
                <div key={s.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-emerald-800">Student {idx + 1}</span>
                    {students.length > 1 && (
                      <button type="button" onClick={() => removeStudent(s.id)} className="text-rose-600 hover:text-rose-700 inline-flex items-center gap-1 text-xs">
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Input label="First name *" value={s.firstName} onChange={(e) => updateStudent(s.id, { firstName: e.target.value })} />
                    <Input label="Last name *" value={s.lastName} onChange={(e) => updateStudent(s.id, { lastName: e.target.value })} />
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600">Gender</span>
                      <select
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800"
                        value={s.gender}
                        onChange={(e) => updateStudent(s.id, { gender: e.target.value })}
                      >
                        <option value="">Prefer not to say</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                    </div>
                    <Input label="Date of birth" type="date" value={s.birthDate} onChange={(e) => updateStudent(s.id, { birthDate: e.target.value })} />
                    <div className="flex flex-col gap-1 sm:col-span-2">
                      <span className="text-xs font-medium text-slate-600">Desired courses</span>
                      <Select
                        isMulti
                        options={courseOptions}
                        value={s.courses.map((c) => ({ value: c, label: c }))}
                        onChange={(opts) => updateStudent(s.id, { courses: (opts || []).map((o) => o.value) })}
                        styles={selectStyles}
                        placeholder="Select one or more courses"
                      />
                    </div>
                    <Input
                      label="Classes per week"
                      type="number"
                      min="1"
                      max="9"
                      value={s.classesPerWeek}
                      onChange={(e) => updateStudent(s.id, { classesPerWeek: e.target.value })}
                    />
                    <Input label="Notes" value={s.notes} onChange={(e) => updateStudent(s.id, { notes: e.target.value })} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addStudent} className="inline-flex items-center gap-1 text-sm text-emerald-700 font-medium">
                <Plus className="h-4 w-4" /> Add another student
              </button>
            </div>
          )}

          {/* Step 3: Availability */}
          {stepIdx === 2 && (
            <div className="space-y-4">
              <Input
                label="Preferred starting date *"
                type="date"
                value={preferredStartingDate}
                onChange={(e) => setPreferredStartingDate(e.target.value)}
                className="sm:w-1/2"
              />
              <div>
                <span className="text-xs font-medium text-slate-600">Weekly availability *</span>
                <p className="text-[11px] text-slate-500 mb-2">
                  Times are in your timezone ({timezone}). Add the days and times that work for you.
                </p>
                <div className="space-y-2">
                  {slots.map((slot) => (
                    <div key={slot.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-500">Day</span>
                        <select
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                          value={slot.day}
                          onChange={(e) => updateSlot(slot.id, { day: e.target.value })}
                        >
                          {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-500">Start</span>
                        <input
                          type="time"
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                          value={slot.startTime}
                          onChange={(e) => updateSlot(slot.id, { startTime: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-500">Duration</span>
                        <select
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                          value={slot.duration}
                          onChange={(e) => updateSlot(slot.id, { duration: Number(e.target.value) })}
                        >
                          {DURATIONS.map((d) => <option key={d} value={d}>{d} min</option>)}
                        </select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] text-slate-500">End</span>
                        <input
                          type="time"
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
                          value={slot.endTime}
                          onChange={(e) => updateSlot(slot.id, { endTime: e.target.value })}
                        />
                      </div>
                      <div className="flex items-center gap-1 ml-auto">
                        <button type="button" title="Duplicate to next day" onClick={() => duplicateToNextDay(slot.id)} className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-emerald-700">
                          <Copy className="h-4 w-4" />
                        </button>
                        {slots.length > 1 && (
                          <button type="button" title="Remove" onClick={() => removeSlot(slot.id)} className="p-2 rounded-lg border border-slate-200 text-rose-500 hover:text-rose-700">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addSlot} className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-700 font-medium">
                  <Plus className="h-4 w-4" /> Add time slot
                </button>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Anything else we should know?</span>
                <textarea
                  className="min-h-[80px] rounded-xl border border-slate-200 bg-white p-3 text-sm"
                  value={availabilityNotes}
                  onChange={(e) => setAvailabilityNotes(e.target.value)}
                  placeholder="Optional notes about your schedule or preferences"
                />
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {stepIdx === 3 && (
            <div className="space-y-4 text-sm">
              <ReviewBlock title="About you">
                <div>{firstName} {lastName}</div>
                <div className="text-slate-500">{email}{phone ? ` · ${phone}` : ''}</div>
                <div className="text-slate-500">{timezone}{country ? ` · ${country}` : ''}{city ? `, ${city}` : ''}</div>
              </ReviewBlock>
              <ReviewBlock title={`Students (${students.filter((s) => s.firstName && s.lastName).length})`}>
                {students.filter((s) => s.firstName && s.lastName).map((s) => (
                  <div key={s.id} className="mb-1">
                    <span className="font-medium text-slate-700">{s.firstName} {s.lastName}</span>
                    {s.courses.length > 0 && <span className="text-slate-500"> — {s.courses.join(', ')}</span>}
                  </div>
                ))}
              </ReviewBlock>
              <ReviewBlock title="Availability">
                <div className="text-slate-500 mb-1">Preferred start: {preferredStartingDate || '—'}</div>
                {slots.map((s) => (
                  <div key={s.id} className="text-slate-600">{s.day} · {s.startTime}–{s.endTime} ({s.duration} min)</div>
                ))}
                {availabilityNotes && <div className="mt-1 text-slate-500 italic">{availabilityNotes}</div>}
              </ReviewBlock>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <button
              type="button"
              onClick={goBack}
              disabled={stepIdx === 0}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-slate-200 text-slate-600 text-sm disabled:opacity-40"
            ><ChevronLeft className="h-4 w-4" /> Back</button>

            {stepIdx < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={goNext}
                className="inline-flex items-center gap-1 px-5 py-2 rounded-full bg-emerald-700 text-white text-sm font-medium"
              >Continue <ChevronRight className="h-4 w-4" /></button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {submitting ? 'Submitting…' : 'Submit registration'}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-4">
          Already have an account? <Link to="/login" className="text-emerald-700 font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
};

const ReviewBlock = ({ title, children }) => (
  <div className="rounded-xl border border-slate-200 p-4">
    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 mb-2">{title}</div>
    {children}
  </div>
);

export default RegisterStudentPage;
