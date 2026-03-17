import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Loader2, Plus, Sparkles, Trash2, UserRound, Users } from 'lucide-react';
import Select from 'react-select';
import { savePublicStudentLead } from '../../api/leads';
import { getBrowserTimezone } from '../../utils/timezoneUtils';
import { getTimezoneOptions } from '../../utils/timezoneOptions';
import api from '../../api/axios';

const COURSE_OPTIONS = ['Quran recitation', 'Quran memorization', 'Arabic language', 'Islamic studies'];
const DURATION_OPTIONS = [30, 45, 60, 90, 120];
const WEEKDAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_SHORT = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-[#2C736C] focus:ring-4 focus:ring-[#2C736C]/10';
const smallTextareaClass = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm outline-none transition focus:border-[#2C736C] focus:ring-4 focus:ring-[#2C736C]/10 overflow-hidden resize-none';
const compactInputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-[#2C736C] focus:ring-4 focus:ring-[#2C736C]/10';
const singleBorderNoteFieldClass = 'relative block rounded-2xl border border-slate-200 bg-white p-4 pt-6 transition focus-within:border-[#2C736C] focus-within:ring-4 focus-within:ring-[#2C736C]/10';
const singleBorderTextareaClass = 'mt-3 w-full resize-none overflow-hidden bg-transparent p-0 text-sm text-slate-700 outline-none placeholder:text-slate-400';
const borderedFieldLabelClass = 'absolute left-3 top-0 z-10 -translate-y-1/2 bg-white px-1 py-0 text-[11px] font-semibold leading-none tracking-wide text-slate-500 whitespace-nowrap';
const dayCardThemes = [
  'border-sky-200 bg-sky-50/70',
  'border-emerald-200 bg-emerald-50/70',
  'border-violet-200 bg-violet-50/70',
  'border-amber-200 bg-amber-50/70',
  'border-rose-200 bg-rose-50/70',
  'border-cyan-200 bg-cyan-50/70',
  'border-indigo-200 bg-indigo-50/70',
];

const emptyStudent = () => ({ firstName: '', lastName: '', gender: '', birthDate: '', courses: [], classesPerWeek: '', notes: '' });
const createSlot = (studentIndex = null, day = 'Monday') => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, studentIndex, day, startTime: '', endTime: '', duration: '' });
const clampStudentCount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(12, Math.floor(numeric)));
};
const formatList = (items = []) => {
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};
const getMissingStudentFields = (student = {}, options = {}) => {
  const { skipName = false } = options;
  const missing = [];
  if (!skipName && !student.firstName?.trim()) missing.push('first name');
  if (!skipName && !student.lastName?.trim()) missing.push('last name');
  if (!student.birthDate) missing.push('birth date');
  if (!Array.isArray(student.courses) || !student.courses.length) missing.push('at least one course');
  if (!student.classesPerWeek || Number(student.classesPerWeek) > 9) missing.push('classes per week');
  return missing;
};
const toMinutes = (value) => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
};
const autoResizeTextarea = (event) => {
  const element = event.currentTarget;
  element.style.height = 'auto';
  element.style.height = `${Math.min(Math.max(element.scrollHeight, 44), 180)}px`;
};
const buildInitialForm = (timezone) => ({
  personalInfo: { firstName: '', lastName: '', fullName: '', email: '', phone: '', timezone },
  address: { city: '', state: '', country: '' },
  preferences: { classPreferences: [], teacherPreferences: [], notes: '' },
  selfEnrollment: false,
  students: [emptyStudent()],
  availability: { preferredStartingDate: '', notes: '', schedulingMode: 'consecutive', allDurationsSame: true, sharedDuration: 30, selectedDays: ['Monday'], slots: [createSlot(null)] },
});

export default function PublicStudentRegistrationPage() {
  const detectedTimezone = getBrowserTimezone();
  const timezoneOptions = useMemo(() => {
    const options = getTimezoneOptions();
    const preferred = [detectedTimezone, 'Africa/Cairo'].filter(Boolean);
    const selected = preferred
      .map((value) => options.find((option) => option.value === value))
      .filter(Boolean);
    const seen = new Set(selected.map((option) => option.value));
    return [...selected, ...options.filter((option) => !seen.has(option.value))];
  }, [detectedTimezone]);
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => buildInitialForm(detectedTimezone));
  const [leadId, setLeadId] = useState('');
  const [branding, setBranding] = useState({ title: 'Waraqa', slogan: 'Welcome', logoUrl: null });

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

  const studentCount = form.students.length;
  const displayTimezone = form.personalInfo.timezone || detectedTimezone;
  const isSeparate = form.students.length > 1 && form.availability.schedulingMode === 'separate';
  const selectedDays = form.availability.selectedDays?.length ? form.availability.selectedDays : ['Monday'];
  const guardianStudentName = `${form.personalInfo.firstName || ''} ${form.personalInfo.lastName || ''}`.trim();

  const updatePersonal = (field, value) => setForm((prev) => ({ ...prev, personalInfo: { ...prev.personalInfo, [field]: value } }));
  const updateAddress = (field, value) => setForm((prev) => ({ ...prev, address: { ...prev.address, [field]: value } }));
  const updatePreferences = (field, value) => setForm((prev) => ({ ...prev, preferences: { ...prev.preferences, [field]: value } }));
  const updateAvailability = (field, value) => setForm((prev) => ({ ...prev, availability: { ...prev.availability, [field]: value } }));
  const updateStudent = (index, field, value) => setForm((prev) => ({ ...prev, students: prev.students.map((student, i) => (i === index ? { ...student, [field]: value } : student)) }));
  const setSelfEnrollment = (value) => setForm((prev) => ({
    ...prev,
    selfEnrollment: value,
    students: prev.students.map((student, index) => {
      if (!value || index !== 0) return student;
      return {
        ...student,
        firstName: prev.personalInfo.firstName || student.firstName,
        lastName: prev.personalInfo.lastName || student.lastName,
      };
    }),
  }));

  const getResolvedStudent = (student, index) => {
    if (form.selfEnrollment && index === 0) {
      return {
        ...student,
        firstName: form.personalInfo.firstName || student.firstName,
        lastName: form.personalInfo.lastName || student.lastName,
      };
    }
    return student;
  };

  const getRelevantSlots = (studentIndex = null) => (form.availability.slots || []).filter((slot) => (isSeparate ? Number(slot.studentIndex) === Number(studentIndex) : slot.studentIndex === null || slot.studentIndex === undefined));
  const getVisibleSlots = (studentIndex = null) => getRelevantSlots(studentIndex).filter((slot) => selectedDays.includes(slot.day));

  const ensureSeparateSlots = (slots, totalStudents) => {
    const next = slots.filter((slot) => slot.studentIndex !== null && slot.studentIndex !== undefined && Number(slot.studentIndex) < totalStudents);
    for (let index = 0; index < totalStudents; index += 1) {
      if (!next.some((slot) => Number(slot.studentIndex) === index)) next.push(createSlot(index));
    }
    return next;
  };

  const setStudentTotal = (value) => {
    const nextCount = clampStudentCount(value);
    setForm((prev) => {
      const nextStudents = Array.from({ length: nextCount }, (_, index) => prev.students[index] || emptyStudent());
      const nextSeparate = nextCount > 1 && prev.availability.schedulingMode === 'separate';
      let nextSlots = prev.availability.slots || [];
      if (nextSeparate) {
        nextSlots = ensureSeparateSlots(nextSlots, nextCount);
      } else {
        nextSlots = nextSlots.filter((slot) => slot.studentIndex === null || slot.studentIndex === undefined).map((slot) => ({ ...slot, studentIndex: null }));
        if (!nextSlots.length) nextSlots = [createSlot(null)];
      }
      return {
        ...prev,
        students: nextStudents,
        availability: {
          ...prev.availability,
          schedulingMode: nextCount > 1 ? prev.availability.schedulingMode : 'consecutive',
          slots: nextSlots,
        },
      };
    });
  };

  const toggleCourse = (index, course) => setForm((prev) => ({
    ...prev,
    students: prev.students.map((student, i) => {
      if (i !== index) return student;
      const exists = student.courses.includes(course);
      return { ...student, courses: exists ? student.courses.filter((item) => item !== course) : [...student.courses, course] };
    }),
  }));

  const toggleSelectedDay = (day) => setForm((prev) => {
    const current = prev.availability.selectedDays?.length ? prev.availability.selectedDays : ['Monday'];
    const exists = current.includes(day);
    const nextSelectedDays = exists ? current.filter((item) => item !== day) : [...current, day];
    return {
      ...prev,
      availability: {
        ...prev.availability,
        selectedDays: nextSelectedDays,
      },
    };
  });

  const setSchedulingMode = (mode) => {
    setForm((prev) => {
      const nextMode = mode === 'separate' && prev.students.length > 1 ? 'separate' : 'consecutive';
      let nextSlots = prev.availability.slots || [];
      if (nextMode === 'separate') {
        const template = nextSlots.find((slot) => slot.studentIndex === null || slot.studentIndex === undefined) || createSlot(null);
        nextSlots = prev.students.map((_, index) => ({ ...createSlot(index), day: template.day, startTime: template.startTime, endTime: template.endTime, duration: template.duration }));
      } else {
        const template = nextSlots[0] || createSlot(null);
        nextSlots = [{ ...createSlot(null), day: template.day, startTime: template.startTime, endTime: template.endTime, duration: template.duration }];
      }
      return { ...prev, availability: { ...prev.availability, schedulingMode: nextMode, slots: nextSlots } };
    });
  };

  const addSlot = (studentIndex = null, day = 'Monday') => setForm((prev) => ({ ...prev, availability: { ...prev.availability, slots: [...prev.availability.slots, createSlot(studentIndex, day)] } }));
  const updateSlot = (id, field, value) => setForm((prev) => ({ ...prev, availability: { ...prev.availability, slots: prev.availability.slots.map((slot) => (slot.id === id ? { ...slot, [field]: value } : slot)) } }));
  const removeSlot = (id) => setForm((prev) => ({ ...prev, availability: { ...prev.availability, slots: prev.availability.slots.filter((slot) => slot.id !== id) } }));
  const updateDayDuration = (studentIndex, day, value) => setForm((prev) => ({
    ...prev,
    availability: {
      ...prev.availability,
      slots: prev.availability.slots.map((slot) => {
        const sameStudent = isSeparate ? Number(slot.studentIndex) === Number(studentIndex) : slot.studentIndex === null || slot.studentIndex === undefined;
        return sameStudent && slot.day === day ? { ...slot, duration: value } : slot;
      }),
    },
  }));

  const deriveStudentDuration = (index) => {
    if (form.availability.allDurationsSame) return Number(form.availability.sharedDuration) || null;
    const durations = [...new Set(getVisibleSlots(index).map((slot) => Number(slot.duration)).filter(Boolean))];
    return durations.length === 1 ? durations[0] : null;
  };

  const validateStep = (targetStep = step) => {
    if (targetStep === 1) {
      if (!form.personalInfo.firstName.trim() || !form.personalInfo.lastName.trim() || !form.personalInfo.email.trim() || !form.personalInfo.phone.trim() || !form.personalInfo.timezone) {
        setError('Please complete the required contact details.');
        return false;
      }
    }
    if (targetStep === 2) {
      const invalidStudentIndex = form.students.findIndex((student, index) => getMissingStudentFields(getResolvedStudent(student, index), { skipName: form.selfEnrollment && index === 0 }).length > 0);
      if (invalidStudentIndex !== -1) {
        const missingFields = getMissingStudentFields(getResolvedStudent(form.students[invalidStudentIndex], invalidStudentIndex), { skipName: form.selfEnrollment && invalidStudentIndex === 0 });
        setError(`Please complete Student ${invalidStudentIndex + 1}: ${formatList(missingFields)}.`);
        return false;
      }
    }
    if (targetStep === 3) {
      if (!form.availability.preferredStartingDate) {
        setError('Please choose a preferred starting date.');
        return false;
      }
      if (!selectedDays.length) {
        setError('Please select at least one day.');
        return false;
      }
      if (form.availability.allDurationsSame && !form.availability.sharedDuration) {
        setError('Please choose the common class duration.');
        return false;
      }
      const slots = (form.availability.slots || []).filter((slot) => selectedDays.includes(slot.day));
      if (!slots.length || slots.some((slot) => !slot.day || !slot.startTime || !slot.endTime)) {
        setError('Please complete all availability slots.');
        return false;
      }
      if (slots.some((slot) => {
        const startMinutes = toMinutes(slot.startTime);
        const endMinutes = toMinutes(slot.endTime);
        return startMinutes === null || endMinutes === null || endMinutes <= startMinutes;
      })) {
        setError('Please make sure every time slot ends after it starts.');
        return false;
      }
      if (isSeparate && form.students.some((_, index) => getVisibleSlots(index).length === 0)) {
        setError('Please add at least one slot for each student.');
        return false;
      }
    }
    setError('');
    return true;
  };

  const handleNext = () => {
    if (!validateStep()) return;
    setStep((prev) => Math.min(prev + 1, 3));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (![1, 2, 3].every((targetStep) => validateStep(targetStep))) {
      return;
    }
    try {
      setSubmitting(true);
      setError('');
      const guardianFullName = `${form.personalInfo.firstName || ''} ${form.personalInfo.lastName || ''}`.trim();
      const response = await savePublicStudentLead({
        personalInfo: {
          ...form.personalInfo,
          fullName: guardianFullName,
        },
        address: form.address,
        preferences: form.preferences,
        students: form.students.map((student, index) => {
          const resolvedStudent = getResolvedStudent(student, index);
          return ({
          firstName: resolvedStudent.firstName,
          lastName: resolvedStudent.lastName,
          gender: resolvedStudent.gender,
          birthDate: resolvedStudent.birthDate ? new Date(resolvedStudent.birthDate).toISOString() : null,
          courses: resolvedStudent.courses,
          classDuration: deriveStudentDuration(index),
          classesPerWeek: Number(resolvedStudent.classesPerWeek),
          notes: resolvedStudent.notes || '',
        });
        }),
        availability: {
          preferredStartingDate: form.availability.preferredStartingDate,
          notes: form.availability.notes,
          schedulingMode: isSeparate ? 'separate' : 'consecutive',
          weekdays: selectedDays,
          allDurationsSame: form.availability.allDurationsSame,
          sharedDuration: form.availability.allDurationsSame ? Number(form.availability.sharedDuration) : null,
          slots: (form.availability.slots || []).filter((slot) => selectedDays.includes(slot.day)).map((slot) => ({
            studentIndex: isSeparate ? Number(slot.studentIndex) : null,
            day: slot.day,
            startTime: slot.startTime,
            endTime: slot.endTime,
            duration: form.availability.allDurationsSame ? Number(form.availability.sharedDuration) : Number(slot.duration),
          })),
        },
      }, leadId);
      setLeadId(response?.leadId || leadId);
      setSuccess(true);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save your registration.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm(buildInitialForm(detectedTimezone));
    setStep(1);
    setError('');
    setSuccess(false);
    setLeadId('');
  };

  const renderSlotEditor = (studentIndex = null, title = 'Availability slots') => {
    const slots = getRelevantSlots(studentIndex);
    return (
      <div className="relative rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 pt-6 shadow-sm">
        <span className={borderedFieldLabelClass}>{title}</span>
        <div className="mb-4 space-y-3">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Selected days</p>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_OPTIONS.map((day) => {
                const active = selectedDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleSelectedDay(day)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${active ? 'bg-[#2C736C] text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                  >
                    {WEEKDAY_SHORT[day] || day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="space-y-4">
          {WEEKDAY_OPTIONS.filter((day) => selectedDays.includes(day)).map((day, dayIndex) => {
            const daySlots = slots.filter((slot) => slot.day === day);
            const dayDuration = daySlots.find((slot) => slot.duration)?.duration || '';
            return (
              <div key={day} className="flex items-start gap-4">
                <div className="w-20 pt-4 text-sm font-semibold text-slate-900">
                  {day}
                </div>
                <div className={`w-full max-w-full rounded-2xl border p-4 shadow-sm md:w-fit md:min-w-[390px] ${dayCardThemes[dayIndex % dayCardThemes.length]}`}>
                {daySlots.length ? (
                  <div className="space-y-3">
                    {daySlots.map((slot, slotIndex) => (
                      <div key={slot.id} className="rounded-xl p-1">
                        <div className="overflow-x-auto">
                          <div className={`grid min-w-[520px] items-end gap-2 ${!form.availability.allDurationsSame && slotIndex === 0 ? 'grid-cols-[92px_132px_132px_96px_44px_96px]' : 'grid-cols-[92px_132px_132px_44px_96px]'}`}>
                            <div className="min-w-0">
                              {slotIndex === 0 ? <div className="h-0" /> : <div className="h-0" />}
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Slot {slotIndex + 1}</p>
                            </div>
                            <div className="relative pt-3">
                              <span className={borderedFieldLabelClass}>Start</span>
                              <input className={compactInputClass} type="time" step="900" value={slot.startTime} onChange={(e) => updateSlot(slot.id, 'startTime', e.target.value)} />
                            </div>
                            <div className="relative pt-3">
                              <span className={borderedFieldLabelClass}>End</span>
                              <input className={compactInputClass} type="time" step="900" value={slot.endTime} onChange={(e) => updateSlot(slot.id, 'endTime', e.target.value)} />
                            </div>
                            {!form.availability.allDurationsSame && slotIndex === 0 ? (
                              <div className="relative pt-3">
                                <span className={borderedFieldLabelClass}>Duration</span>
                                <select className={compactInputClass} value={dayDuration} onChange={(e) => updateDayDuration(studentIndex, day, e.target.value)}>
                                  <option value="">Optional</option>
                                  {DURATION_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} min</option>)}
                                </select>
                              </div>
                            ) : null}
                            <button type="button" onClick={() => removeSlot(slot.id)} className="inline-flex h-[42px] w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </button>
                            {slotIndex === daySlots.length - 1 ? (
                              <button type="button" onClick={() => addSlot(studentIndex, day)} className="inline-flex h-[42px] w-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100" aria-label={`Add time for ${day}`}>
                                <Plus className="h-4 w-4" />
                              </button>
                            ) : (
                              <div />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    <span>No time slots added for {day} yet.</span>
                    <button type="button" onClick={() => addSlot(studentIndex, day)} className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-100" aria-label={`Add time for ${day}`}>
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800">
        <div className="mx-auto max-w-3xl rounded-3xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Information saved</h1>
          <p className="mt-2 text-sm text-slate-600">Thank you. Your availability details have been received successfully. We will review them and contact you soon, Inshaa Allah.</p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button type="button" onClick={resetForm} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700">Submit another availability</button>
            <button type="button" onClick={() => setSuccess(false)} className="rounded-full bg-[#2C736C] px-5 py-3 text-sm font-semibold text-white">Edit it</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-800">
      <div className="mx-auto max-w-4xl rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
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
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"><Sparkles className="h-3.5 w-3.5" />Student registration</div>
              <h1 className="mt-3 text-2xl font-semibold text-slate-900">Join Waraqa in 3 simple steps</h1>
              <p className="mt-1 text-sm text-slate-500">Share your details, add your students, then enter availability in your timezone.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((item) => <div key={item} className={`h-2.5 w-14 rounded-full ${item <= step ? 'bg-[#2C736C]' : 'bg-slate-200'}`} />)}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-8">
          {step === 1 ? (
            <section className="space-y-5">
              <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><UserRound className="h-5 w-5 text-[#2C736C]" />Contact information</div>
              <div className="grid gap-4 md:grid-cols-2">
                <input className={inputClass} placeholder="Guardian first name *" value={form.personalInfo.firstName} onChange={(e) => updatePersonal('firstName', e.target.value)} required />
                <input className={inputClass} placeholder="Guardian last name *" value={form.personalInfo.lastName} onChange={(e) => updatePersonal('lastName', e.target.value)} required />
                <input className={inputClass} placeholder="E-mail *" type="email" value={form.personalInfo.email} onChange={(e) => updatePersonal('email', e.target.value)} required />
                <input className={inputClass} placeholder="Whatsapp / Telegram *" value={form.personalInfo.phone} onChange={(e) => updatePersonal('phone', e.target.value)} required />
                <div className="md:col-span-2">
                  <Select
                    instanceId="student-registration-timezone"
                    options={timezoneOptions}
                    value={timezoneOptions.find((option) => option.value === form.personalInfo.timezone) || null}
                    onChange={(option) => updatePersonal('timezone', option?.value || detectedTimezone)}
                    placeholder="Time zone *"
                  />
                </div>
                <input className={inputClass} placeholder="City" value={form.address.city} onChange={(e) => updateAddress('city', e.target.value)} />
                <input className={inputClass} placeholder="State" value={form.address.state} onChange={(e) => updateAddress('state', e.target.value)} />
                <input className={inputClass + ' md:col-span-2'} placeholder="Country" value={form.address.country} onChange={(e) => updateAddress('country', e.target.value)} />
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Users className="h-5 w-5 text-[#2C736C]" />Student details</div>
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-600">Number of students</label>
                  <input className={inputClass + ' w-24'} type="number" min="1" max="12" value={studentCount} onChange={(e) => setStudentTotal(e.target.value)} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Is the guardian also a student?</p>
                      <p className="text-sm text-slate-500">If yes, the first student will use the guardian name automatically.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelfEnrollment(true)} className={`rounded-full px-4 py-2 text-sm font-semibold ${form.selfEnrollment ? 'bg-[#2C736C] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Yes</button>
                      <button type="button" onClick={() => setSelfEnrollment(false)} className={`rounded-full px-4 py-2 text-sm font-semibold ${!form.selfEnrollment ? 'bg-[#2C736C] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>No</button>
                    </div>
                  </div>
                </div>

                {form.students.map((student, index) => {
                  const resolvedStudent = getResolvedStudent(student, index);
                  const isGuardianStudent = form.selfEnrollment && index === 0;
                  return (
                  <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-800">{isGuardianStudent ? 'Student 1 — guardian' : `Student ${index + 1}`}</p>
                        {isGuardianStudent ? <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{guardianStudentName || 'Uses guardian name'}</span> : null}
                      </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {isGuardianStudent ? (
                          <div className="md:col-span-2 xl:col-span-2">
                            <div className="flex h-full min-h-[52px] items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm">
                              {guardianStudentName || 'Guardian name will be used here'}
                            </div>
                          </div>
                        ) : (
                          <>
                            <input className={inputClass} placeholder="First name *" value={student.firstName} onChange={(e) => updateStudent(index, 'firstName', e.target.value)} />
                            <input className={inputClass} placeholder="Last name *" value={student.lastName} onChange={(e) => updateStudent(index, 'lastName', e.target.value)} />
                          </>
                        )}
                        <select className={inputClass} value={resolvedStudent.gender} onChange={(e) => updateStudent(index, 'gender', e.target.value)}>
                        <option value="">Gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                      </select>
                        <input className={inputClass} type="date" value={resolvedStudent.birthDate} onChange={(e) => updateStudent(index, 'birthDate', e.target.value)} />
                        <input className={inputClass} type="number" min="1" max="9" step="1" placeholder="Classes weekly *" value={resolvedStudent.classesPerWeek} onChange={(e) => updateStudent(index, 'classesPerWeek', e.target.value)} />
                    </div>

                    <div className="mt-4">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Courses</p>
                      <div className="flex flex-wrap gap-2">
                        {COURSE_OPTIONS.map((course) => {
                            const active = resolvedStudent.courses.includes(course);
                          return <button key={course} type="button" onClick={() => toggleCourse(index, course)} className={`rounded-full px-3 py-2 text-sm font-medium ${active ? 'bg-[#2C736C] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>{course}</button>;
                        })}
                      </div>
                    </div>

                    <label className="mt-4 block">
                      <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">Optional notes</span>
                        <textarea className={smallTextareaClass} rows={1} placeholder="Optional notes about this student" value={resolvedStudent.notes || ''} onInput={autoResizeTextarea} onChange={(e) => updateStudent(index, 'notes', e.target.value)} />
                    </label>
                  </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Sparkles className="h-5 w-5 text-[#2C736C]" />Schedule preferences</div>
                <div className="text-sm text-slate-600">Timezone <span className="font-semibold text-slate-900">{displayTimezone}</span></div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.85fr)_minmax(260px,1fr)]">
                {form.students.length > 1 ? (
                  <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 pt-6">
                    <span className={borderedFieldLabelClass}>Back-to-back classes?</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setSchedulingMode('consecutive')} className={`rounded-full px-4 py-2 text-sm font-semibold ${form.availability.schedulingMode === 'consecutive' ? 'bg-[#2C736C] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Yes — one after another</button>
                      <button type="button" onClick={() => setSchedulingMode('separate')} className={`rounded-full px-4 py-2 text-sm font-semibold ${form.availability.schedulingMode === 'separate' ? 'bg-[#2C736C] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>No — separate times</button>
                    </div>
                  </div>
                ) : <div />}

                <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 pt-6">
                    <span className={borderedFieldLabelClass}>Start date</span>
                    <input className={inputClass} type="date" value={form.availability.preferredStartingDate} onChange={(e) => updateAvailability('preferredStartingDate', e.target.value)} />
                </div>

                <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-4 pt-6">
                  <span className={borderedFieldLabelClass}>Same class duration?</span>
                  <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => updateAvailability('allDurationsSame', true)} className={`rounded-full px-4 py-2 text-sm font-semibold ${form.availability.allDurationsSame ? 'bg-[#2C736C] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>Yes</button>
                      <button type="button" onClick={() => updateAvailability('allDurationsSame', false)} className={`rounded-full px-4 py-2 text-sm font-semibold ${!form.availability.allDurationsSame ? 'bg-[#2C736C] text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>No</button>
                      {form.availability.allDurationsSame ? (
                        <div className="relative min-w-[170px] pt-2">
                          <span className={borderedFieldLabelClass}>Duration</span>
                          <select className={compactInputClass} value={form.availability.sharedDuration} onChange={(e) => updateAvailability('sharedDuration', e.target.value)}>
                            {DURATION_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                          </select>
                        </div>
                      ) : null}
                  </div>
                </div>
              </div>

              {isSeparate
                ? form.students.map((student, index) => {
                  const resolvedStudent = getResolvedStudent(student, index);
                  const studentLabel = `${resolvedStudent.firstName || `Student ${index + 1}`}${resolvedStudent.lastName ? ` ${resolvedStudent.lastName}` : ''}`.trim();
                  return renderSlotEditor(index, `${studentLabel || `Student ${index + 1}`} availability`);
                })
                : renderSlotEditor(null, 'Availability slots')}

              <label className={singleBorderNoteFieldClass}>
                <span className={borderedFieldLabelClass}>Preferences</span>
                <textarea className={singleBorderTextareaClass} rows={1} placeholder="Add any teacher, course, or learning preferences that would help us match the student well." value={form.preferences.notes} onInput={autoResizeTextarea} onChange={(e) => updatePreferences('notes', e.target.value)} />
              </label>

              <label className={singleBorderNoteFieldClass}>
                <span className={borderedFieldLabelClass}>Schedule notes</span>
                <textarea className={singleBorderTextareaClass} rows={1} placeholder="Mention anything important about timing, flexibility, or special scheduling needs." value={form.availability.notes} onInput={autoResizeTextarea} onChange={(e) => updateAvailability('notes', e.target.value)} />
              </label>
            </section>
          ) : null}

          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={() => setStep((prev) => Math.max(prev - 1, 1))} className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700" disabled={step === 1 || submitting}>Back</button>
            <div className="flex items-center gap-3">
              {step < 3 ? (
                <button type="button" onClick={handleNext} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-6 py-3 text-sm font-semibold text-white shadow-sm"><span>Next</span><ChevronRight className="h-4 w-4" /></button>
              ) : (
                <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-6 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-60">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  <span>{submitting ? 'Submitting…' : 'Submit'}</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
