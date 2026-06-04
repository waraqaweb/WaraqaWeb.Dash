import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { XCircle, Trash2, Plus } from "lucide-react";
import moment from 'moment-timezone';
import TimezoneSelector from '../ui/TimezoneSelector';
import { DEFAULT_TIMEZONE } from '../../utils/timezoneUtils';
import { subjects as fallbackSubjects } from "../../constants/reportTopicsConfig";
import { getSubjectsCatalogCached } from '../../services/subjectsCatalog';
import axios from '../../api/axios';
import SearchSelect from '../ui/SearchSelect';
import CopyButton from '../ui/CopyButton';
import TimeInput from '../ui/TimeInput';
import {
  getStudentMessageName,
  getTeacherMessageLabel,
  getTimezoneHeadingLabel,
} from '../../utils/classMessageFormatting';
import {
  searchTeachers,
  getTeacherById,
  searchGuardians,
  getGuardianById,
  searchStudents,
  getStudentById
} from '../../services/entitySearch';

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayShortNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesToTime(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const adjustDurationByStep = (rawValue, direction = 1, step = 10) => {
  const current = Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0;
  const next = current + step * direction;
  return Math.max(1, Math.round(next));
};

const cleanDisplayName = (value = '', fallback = '') => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
};

const getOptionName = (option, fallback = '') => {
  if (!option) return fallback;
  const raw = option.raw || option;
  return cleanDisplayName(
    option.label
      || raw.studentName
      || raw.fullName
      || [raw.firstName, raw.lastName].filter(Boolean).join(' ')
      || raw.name,
    fallback
  );
};

const getOptionTimezone = (option, fallback = DEFAULT_TIMEZONE) => {
  const raw = option?.raw || option || {};
  return raw.timezone || raw.guardianInfo?.timezone || raw.teacherInfo?.timezone || fallback;
};

const formatDayList = (values = []) => {
  if (values.length <= 1) return values[0] || '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const formatStartLabel = (dateMoment, timezone) => {
  if (!dateMoment || !dateMoment.isValid()) return 'soon';
  const now = moment().tz(timezone || DEFAULT_TIMEZONE);
  if (dateMoment.isSame(now, 'day')) return 'today';
  if (dateMoment.isSame(now.clone().add(1, 'day'), 'day')) return 'tomorrow';
  return `on ${dateMoment.format('dddd D MMMM')}`;
};

const formatSingleOccurrenceLabel = (dateMoment, timezone) => {
  if (!dateMoment || !dateMoment.isValid()) return '';
  const now = moment().tz(timezone || DEFAULT_TIMEZONE);
  if (dateMoment.isSame(now, 'day')) return `Today at ${dateMoment.format('hh:mm A')}`;
  if (dateMoment.isSame(now.clone().add(1, 'day'), 'day')) return `Tomorrow at ${dateMoment.format('hh:mm A')}`;
  return `${dateMoment.format('dddd D MMMM')} at ${dateMoment.format('hh:mm A')}`;
};

const buildRecurringScheduleLines = (recurrenceDetails = [], targetTimezone, sourceFallbackTimezone) => {
  const normalizedSlots = Array.isArray(recurrenceDetails) ? recurrenceDetails : [];
  if (!normalizedSlots.length) return { lines: [], commonDuration: null, firstOccurrence: null };

  const allDurations = normalizedSlots
    .map((slot) => Number(slot?.duration))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  const commonDuration = allDurations.length && allDurations.every((duration) => duration === allDurations[0])
    ? allDurations[0]
    : null;

  const converted = normalizedSlots
    .map((slot) => {
      const dayOfWeek = Number(slot?.dayOfWeek);
      const timeText = String(slot?.time || '00:00');
      const [hourText = '0', minuteText = '0'] = timeText.split(':');
      const hour = Number(hourText);
      const minute = Number(minuteText);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !Number.isFinite(hour) || !Number.isFinite(minute)) {
        return null;
      }

      const sourceTimezone = slot?.timezone || sourceFallbackTimezone || DEFAULT_TIMEZONE;
      let nextOccurrence = moment().tz(sourceTimezone).day(dayOfWeek).hour(hour).minute(minute).second(0).millisecond(0);
      if (nextOccurrence.isSameOrBefore(moment().tz(sourceTimezone))) {
        nextOccurrence = nextOccurrence.add(1, 'week');
      }

      const convertedMoment = nextOccurrence.clone().tz(targetTimezone || sourceTimezone || DEFAULT_TIMEZONE);
      return {
        duration: Number(slot?.duration) || null,
        weekdayIndex: convertedMoment.day(),
        weekdayLabel: dayShortNames[convertedMoment.day()],
        timeLabel: convertedMoment.format('hh:mm A'),
        dateMoment: convertedMoment,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dateMoment.valueOf() - b.dateMoment.valueOf());

  if (!converted.length) return { lines: [], commonDuration, firstOccurrence: null };

  const grouped = new Map();
  converted.forEach((item) => {
    const key = commonDuration ? item.timeLabel : `${item.timeLabel}__${item.duration || ''}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        timeLabel: item.timeLabel,
        duration: item.duration,
        days: [],
        firstOccurrence: item.dateMoment,
      });
    }
    const target = grouped.get(key);
    target.days.push({ index: item.weekdayIndex, label: item.weekdayLabel });
    if (item.dateMoment.isBefore(target.firstOccurrence)) {
      target.firstOccurrence = item.dateMoment;
    }
  });

  const lines = Array.from(grouped.values())
    .map((group) => {
      const uniqueDays = Array.from(new Map(
        group.days
          .sort((a, b) => a.index - b.index)
          .map((day) => [day.index, day.label])
      ).values());
      return {
        firstOccurrence: group.firstOccurrence,
        text: `${formatDayList(uniqueDays)} at ${group.timeLabel}${commonDuration ? '' : ` (${group.duration} Minutes)`}`,
      };
    })
    .sort((a, b) => a.firstOccurrence.valueOf() - b.firstOccurrence.valueOf());

  return {
    lines: lines.map((item) => item.text),
    commonDuration,
    firstOccurrence: converted[0]?.dateMoment || null,
  };
};

const buildSingleScheduleLine = (scheduledDate, sourceTimezone, targetTimezone, duration) => {
  if (!scheduledDate) {
    return { line: '', occurrence: null, commonDuration: Number(duration) || null };
  }

  const base = sourceTimezone
    ? moment.tz(scheduledDate, sourceTimezone)
    : moment(scheduledDate);
  const converted = base.clone().tz(targetTimezone || sourceTimezone || DEFAULT_TIMEZONE);
  return {
    line: formatSingleOccurrenceLabel(converted, targetTimezone || sourceTimezone || DEFAULT_TIMEZONE),
    occurrence: converted,
    commonDuration: Number(duration) || null,
  };
};

const buildWhatsAppMessage = ({
  classForm,
  teacherOption,
  guardianOption,
  studentOption,
  fallbackTimezone,
}) => {
  const teacherLabel = getTeacherMessageLabel(teacherOption, 'teacher');
  const studentName = getStudentMessageName({
    student: classForm?.student,
    studentOption,
    fallback: 'Student',
  });
  const guardianTimezone = getOptionTimezone(guardianOption, fallbackTimezone || DEFAULT_TIMEZONE);
  const teacherTimezone = getOptionTimezone(teacherOption, classForm?.timezone || fallbackTimezone || DEFAULT_TIMEZONE);
  const sourceTimezone = classForm?.timezone || fallbackTimezone || DEFAULT_TIMEZONE;
  const isRecurring = Boolean(classForm?.isRecurring);

  const guardianSchedule = isRecurring
    ? buildRecurringScheduleLines(classForm?.recurrenceDetails, guardianTimezone, sourceTimezone)
    : buildSingleScheduleLine(classForm?.scheduledDate, sourceTimezone, guardianTimezone, classForm?.duration);

  const teacherSchedule = teacherTimezone === guardianTimezone
    ? null
    : (isRecurring
      ? buildRecurringScheduleLines(classForm?.recurrenceDetails, teacherTimezone, sourceTimezone)
      : buildSingleScheduleLine(classForm?.scheduledDate, sourceTimezone, teacherTimezone, classForm?.duration));

  const firstOccurrence = guardianSchedule?.firstOccurrence || teacherSchedule?.firstOccurrence || null;
  const startLabel = formatStartLabel(firstOccurrence, guardianTimezone);
  const commonDuration = guardianSchedule?.commonDuration || teacherSchedule?.commonDuration || null;
  const guardianLines = Array.isArray(guardianSchedule?.lines)
    ? guardianSchedule.lines
    : guardianSchedule?.line ? [guardianSchedule.line] : [];
  const teacherLines = Array.isArray(teacherSchedule?.lines)
    ? teacherSchedule.lines
    : teacherSchedule?.line ? [teacherSchedule.line] : [];
  const classWord = isRecurring ? 'classes' : 'class';

  const parts = [
    'Assalamu Alaykum everyone,',
    'I hope you are all doing well.',
    '',
    `This is to confirm that ${studentName}'s ${classWord} with ${teacherLabel} will begin ${startLabel}, Inshaa Allah.`,
    '',
    'Class Schedule:',
  ];

  if (guardianLines.length) {
    parts.push(getTimezoneHeadingLabel(guardianTimezone, 'Class'));
    guardianLines.forEach((line) => parts.push(line));
    parts.push('');
  }

  if (teacherLines.length) {
    parts.push(getTimezoneHeadingLabel(teacherTimezone, 'Class'));
    teacherLines.forEach((line) => parts.push(line));
    parts.push('');
  }

  if (commonDuration) {
    parts.push(`Class duration: ${commonDuration} Minutes`);
    parts.push('');
  }

  if (classForm?.meetingLink) {
    parts.push(`Class Link: ${classForm.meetingLink}`);
    parts.push('');
  }

  parts.push('Looking forward to starting!');
  parts.push('Thank you');

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const classModalSectionClass = "rounded-[20px] border border-slate-200/80 bg-white/80 p-3.5 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur-sm sm:rounded-[24px] sm:p-4";
const classModalSectionTitleClass = "text-sm font-semibold text-slate-900";
const classModalSectionHintClass = "mt-1 text-[11px] leading-relaxed text-slate-500 sm:text-xs";
const classModalLabelClass = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500";
const classModalInputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 sm:px-3.5";
const classModalTextareaClass = `${classModalInputClass} min-h-[96px] resize-y`;
const classModalNoteClass = "mt-1 text-[11px] text-slate-500";
const classModalSecondaryButtonClass = "inline-flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:w-auto";
const classModalPrimaryButtonClass = "inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(59,130,246,0.24)] transition hover:bg-primary/90 sm:w-auto";
const classModalIconButtonClass = "inline-flex h-10 w-10 items-center justify-center rounded-[18px] border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-700 sm:h-11 sm:w-11 sm:rounded-2xl";
const classModalDangerButtonClass = "inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-200 bg-white text-rose-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50";
const classModalSlotCardClass = "rounded-[18px] border border-slate-200/80 bg-slate-50/80 p-3 shadow-sm sm:rounded-2xl";
const getClassModalTabClass = (active) => `flex-1 rounded-[18px] px-3 py-2.5 text-sm font-semibold transition sm:rounded-2xl sm:px-4 sm:py-3 ${active ? 'bg-white text-slate-900 shadow-[0_8px_24px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/80' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'}`;

export default function CreateClassModal({
  isOpen,
  onClose,
  newClass = {
    title: 'One on one',
    subject: '',
    description: '',
    teacher: '',
    student: {
      guardianId: '',
      studentId: ''
    },
    duration: 30,
    meetingLink: '',
    timezone: DEFAULT_TIMEZONE,
    isRecurring: true,
    recurrenceDetails: [
      { dayOfWeek: 1, time: '18:00', duration: 30, timezone: DEFAULT_TIMEZONE }
    ],
    scheduledDate: '',
    generationPeriodMonths: 3
  },
  setNewClass,
  teachers = [],
  guardians = [],
  students = [],
  handleGuardianChange = () => {},
  handleStudentChange = () => {},
  addRecurrenceSlot = () => {},
  removeRecurrenceSlot = () => {},
  updateRecurrenceSlot = () => {},
  handleCreateClass = () => {},
  resetNewClassForm = () => {},
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const adminTimezone = user?.timezone || DEFAULT_TIMEZONE;
  const isAdminUser = user?.role === 'admin';
  const pushedRef = useRef(false);
  
  // Local state for when component is used standalone (e.g., from route)
  const [localNewClass, setLocalNewClass] = useState({
    title: 'One on one',
    subject: '',
    description: '',
    teacher: '',
    student: {
      guardianId: '',
      studentId: ''
    },
    duration: 30,
    meetingLink: '',
    timezone: adminTimezone,
    isRecurring: true,
    recurrenceDetails: [
      { dayOfWeek: 1, time: '18:00', duration: 30, timezone: adminTimezone }
    ],
    scheduledDate: '',
    generationPeriodMonths: 3
  });
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [duplicatePrompt, setDuplicatePrompt] = useState(null);
  const [availabilityWarning, setAvailabilityWarning] = useState(null);
  const [subjectOptions, setSubjectOptions] = useState(Array.isArray(fallbackSubjects) ? fallbackSubjects : []);
  const [selectedTeacherOption, setSelectedTeacherOption] = useState(null);
  const [selectedGuardianOption, setSelectedGuardianOption] = useState(null);
  const [selectedStudentOption, setSelectedStudentOption] = useState(null);
  const duplicateActionRef = useRef(null);

  // Use local state if no external state is provided (standalone mode)
  // NOTE: Never rely on Function#toString() for behavior; prod builds can minify it.
  // These MUST be declared before any effect/dependency-array that reads them,
  // otherwise the render-time dependency array hits a temporal dead zone.
  const isStandalone = typeof setNewClass !== 'function';
  const currentNewClass = isStandalone ? localNewClass : newClass;
  const currentSetNewClass = isStandalone ? setLocalNewClass : setNewClass;

  // Session draft persistence for the create-class form so the user can
  // navigate away (e.g. to peek a teacher schedule) and return without
  // losing typed input. Scoped to the browser session.
  const DRAFT_STORAGE_KEY = 'waraqa:createClassDraft:v1';
  const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const draftHydratedRef = useRef(false);

  const clearDraftStorage = useCallback(() => {
    try { sessionStorage.removeItem(DRAFT_STORAGE_KEY); } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await getSubjectsCatalogCached();
        if (cancelled) return;
        if (Array.isArray(catalog?.subjects) && catalog.subjects.length > 0) {
          setSubjectOptions(catalog.subjects);
        }
      } catch (e) {
        // ignore; fallbackSubjects already loaded
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSuccessMessage('');
      setShareMessage('');
    }
  }, [isOpen]);

  // Hydrate from session draft on open (once per open cycle).
  useEffect(() => {
    if (!isOpen) {
      draftHydratedRef.current = false;
      return;
    }
    if (draftHydratedRef.current) return;
    draftHydratedRef.current = true;
    try {
      const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const age = Date.now() - (parsed?.savedAt || 0);
      if (!parsed?.data || age > DRAFT_MAX_AGE_MS) {
        clearDraftStorage();
        return;
      }
      currentSetNewClass?.((prev) => ({ ...prev, ...parsed.data }));
    } catch (e) { /* ignore corrupt draft */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Persist draft on every change while open.
  useEffect(() => {
    if (!isOpen || !draftHydratedRef.current) return;
    try {
      sessionStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ savedAt: Date.now(), data: currentNewClass })
      );
    } catch (e) { /* ignore quota */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, JSON.stringify(currentNewClass || {})]);

  // Ensure we always have a default class type
  useEffect(() => {
    if (!isOpen) return;
    if (currentNewClass?.title) return;
    currentSetNewClass((prev) => ({ ...prev, title: 'One on one' }));
  }, [isOpen, currentNewClass?.title, currentSetNewClass]);

  // Clear availability warning when key scheduling inputs change.
  useEffect(() => {
    if (!availabilityWarning) return;
    setAvailabilityWarning(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentNewClass?.teacher,
    currentNewClass?.timezone,
    currentNewClass?.duration,
    currentNewClass?.scheduledDate,
    currentNewClass?.isRecurring,
    JSON.stringify(currentNewClass?.recurrenceDetails || [])
  ]);

  const formatAlternativeSlot = (alt) => {
    const tz = alt?.timezone ? ` · ${String(alt.timezone).replace(/_/g, ' ')}` : '';
    const startLocal = typeof alt?.startLocal === 'string' ? alt.startLocal : '';
    const endLocal = typeof alt?.endLocal === 'string' ? alt.endLocal : '';
    if (startLocal) {
      const [startDate, startTime = ''] = startLocal.split(' ');
      const [, endTime = ''] = (endLocal || '').split(' ');
      let dateLabel = startDate;
      try {
        const d = startDate ? new Date(`${startDate}T00:00:00`) : null;
        if (d && !Number.isNaN(d.getTime())) {
          dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        }
      } catch (e) { /* keep raw */ }
      const range = endTime ? `${startTime}–${endTime}` : startTime;
      return `${dateLabel} · ${range}${tz}`;
    }
    const start = alt?.startDateTime || alt?.start || alt?.startTime;
    const end = alt?.endDateTime || alt?.end || alt?.endTime;
    if (!start && !end) return '';
    const fmt = (v) => {
      if (!v) return '';
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return String(v);
      return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };
    return `${fmt(start)}${end ? ` – ${fmt(end)}` : ''}${tz}`;
  };

  const buildAvailabilityWarningFromApi = (data = {}) => {
    const ae = data?.availabilityError || {};
    const reason = ae?.reason || '';

    let details = '';
    if (ae?.conflictType === 'existing_class' && ae?.conflictDetails) {
      const cd = ae.conflictDetails;
      const tz = cd?.timezone || '';
      const start = cd?.startLocal || (cd?.startTime ? new Date(cd.startTime).toLocaleString() : '');
      const end = cd?.endLocal || (cd?.endTime ? new Date(cd.endTime).toLocaleString() : '');
      const who = cd?.studentName || 'another class';
      const what = cd?.subject ? ` (${cd.subject})` : '';
      const when = start && end ? `${start} – ${end}${tz ? ` (${tz})` : ''}` : '';
      details = `${who}${what}${when ? ` • ${when}` : ''}`;
    } else if (ae?.conflictType === 'no_availability' && ae?.conflictDetails) {
      const cd = ae.conflictDetails;
      const slotsForDay = Array.isArray(cd?.slotsForDay) ? cd.slotsForDay : [];
      const slotLabel = slotsForDay.length
        ? slotsForDay.map((s) => `${s.startTime}–${s.endTime}`).join(', ')
        : 'none';
      details = `Requested: ${cd?.requested?.startLocal || ''} – ${cd?.requested?.endLocal || ''} (${cd?.teacherTimezone || ''})\nWindows: ${slotLabel}`;
    }

    const alternatives = Array.isArray(ae?.alternatives) ? ae.alternatives : [];
    const nearest = alternatives.length ? formatAlternativeSlot(alternatives[0]) : '';
    const suggested = alternatives
      .slice(0, 3)
      .map((alt) => formatAlternativeSlot(alt))
      .filter(Boolean);

    return {
      title: data?.message || 'Teacher not available',
      reason,
      details,
      nearest,
      suggested,
    };
  };
  
  // Filter students based on selected guardian - only show students of selected guardian
  const selectedGuardianId = currentNewClass.student?.guardianId
    ? String(currentNewClass.student.guardianId)
    : null;

  const fetchTeacherOptions = useCallback((term = '') => searchTeachers(term), []);
  const fetchTeacherById = useCallback((id) => getTeacherById(id), []);
  const fetchGuardianOptions = useCallback((term = '') => searchGuardians(term), []);
  const fetchGuardianById = useCallback((id) => getGuardianById(id), []);
  const fetchStudentOptions = useCallback(
    (term = '') => searchStudents(term, currentNewClass.student?.guardianId || null),
    [currentNewClass.student?.guardianId]
  );
  const fetchStudentById = useCallback(
    (id) => getStudentById(id, currentNewClass.student?.guardianId || null),
    [currentNewClass.student?.guardianId]
  );

  const extractTeacherMeetingLink = (option) => {
    if (!option) return '';
    const raw = option.raw || option;
    return (
      raw?.teacherInfo?.googleMeetLink ||
      raw?.googleMeetLink ||
      raw?.meetingLink ||
      ''
    );
  };

  const handleTeacherSelect = (option) => {
    const teacherId = option?.id || '';
    const teacherMeetingLink = extractTeacherMeetingLink(option);
    setSelectedTeacherOption(option || null);
    currentSetNewClass((prev) => ({
      ...prev,
      teacher: teacherId,
      meetingLink: teacherId ? teacherMeetingLink : '',
    }));
  };

  const handleGuardianSelect = (option) => {
    const guardianId = option?.id || '';
    setSelectedGuardianOption(option || null);
    currentSetNewClass((prev) => ({
      ...prev,
      student: {
        guardianId,
        studentId: guardianId && prev.student?.guardianId === guardianId ? prev.student?.studentId : '',
      },
    }));

    if (!isStandalone) {
      handleGuardianChange?.(guardianId);
      if (!guardianId) {
        handleStudentChange?.('');
      }
    }
  };

  const handleStudentSelect = (option) => {
    const studentId = option?.id || '';
    const guardianId = option?.guardianId || currentNewClass.student?.guardianId || '';
    const studentName = option?.label || '';

    setSelectedStudentOption(option || null);

    currentSetNewClass((prev) => ({
      ...prev,
      student: {
        guardianId,
        studentId,
        studentName,
      },
    }));

    if (!isStandalone) {
      handleStudentChange?.(studentId, { guardianId, studentName });
      if (guardianId && guardianId !== currentNewClass.student?.guardianId) {
        handleGuardianChange?.(guardianId, { preserveStudent: true });
      }
    }
  };

  const validateParticipants = () => {
    if (currentNewClass.teacher && currentNewClass.student?.guardianId && currentNewClass.student?.studentId) {
      return true;
    }
    alert('Please select a teacher, guardian, and student before continuing.');
    return false;
  };

  const buildShareMessage = useCallback(async (classFormSnapshot) => {
    const [teacherOption, guardianOption, studentOption] = await Promise.all([
      selectedTeacherOption || (classFormSnapshot?.teacher ? fetchTeacherById(classFormSnapshot.teacher) : Promise.resolve(null)),
      selectedGuardianOption || (classFormSnapshot?.student?.guardianId ? fetchGuardianById(classFormSnapshot.student.guardianId) : Promise.resolve(null)),
      selectedStudentOption || (classFormSnapshot?.student?.studentId ? fetchStudentById(classFormSnapshot.student.studentId, classFormSnapshot?.student?.guardianId || null) : Promise.resolve(null)),
    ]);

    return buildWhatsAppMessage({
      classForm: classFormSnapshot,
      teacherOption,
      guardianOption,
      studentOption,
      fallbackTimezone: adminTimezone,
    });
  }, [adminTimezone, fetchGuardianById, fetchStudentById, fetchTeacherById, selectedGuardianOption, selectedStudentOption, selectedTeacherOption]);

  const buildClientRecurringAvailabilityWarning = useCallback(async (classFormSnapshot, { reminderOnly = false } = {}) => {
    if (!classFormSnapshot?.isRecurring || !classFormSnapshot?.teacher) return null;

    try {
      const resAvail = await axios.get(`/availability/slots/${classFormSnapshot.teacher}`);
      const availability = resAvail.data || {};
      const isDefault = availability?.isDefaultAvailability;

      if (isDefault || !Array.isArray(classFormSnapshot.recurrenceDetails)) {
        return null;
      }

      const toMinutes = (timeValue) => {
        if (!timeValue) return null;
        const [hh = '0', mm = '0'] = String(timeValue).split(':');
        const hours = parseInt(hh, 10);
        const minutes = parseInt(mm, 10);
        if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
        return hours * 60 + minutes;
      };

      const conflicts = [];
      (classFormSnapshot.recurrenceDetails || []).forEach((slot, idx) => {
        const day = Number.isFinite(Number(slot.dayOfWeek)) ? Number(slot.dayOfWeek) : null;
        const slotStartMin = toMinutes(slot.time);
        const slotEndMin = slotStartMin !== null ? slotStartMin + (Number(slot.duration) || 0) : null;

        if (day === null || slotStartMin === null || slotEndMin === null) {
          conflicts.push({ idx, reason: 'invalid_time' });
          return;
        }

        const daySlots = (availability.slotsByDay || {})[String(day)] || [];
        if (!daySlots || daySlots.length === 0) {
          conflicts.push({ idx, reason: 'no_day_slots' });
          return;
        }

        const matched = daySlots.some((availabilitySlot) => {
          const avStart = toMinutes(availabilitySlot.startTime || availabilitySlot.start || availabilitySlot.start_time || '');
          const avEnd = toMinutes(availabilitySlot.endTime || availabilitySlot.end || availabilitySlot.end_time || '');
          if (avStart === null || avEnd === null) return false;
          return avStart <= slotStartMin && avEnd >= slotEndMin;
        });

        if (!matched) {
          conflicts.push({ idx, reason: 'not_covered' });
        }
      });

      if (!conflicts.length) {
        return null;
      }

      const tzLabel = availability?.timezone || classFormSnapshot?.timezone || adminTimezone || DEFAULT_TIMEZONE;
      const slotsByDay = availability?.slotsByDay || {};

      const suggestStartWithinDaySlots = (daySlots = [], requestedStartMin, durationMinutes) => {
        if (!Number.isFinite(requestedStartMin) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return '';
        let bestStart = null;
        let bestScore = Infinity;

        (Array.isArray(daySlots) ? daySlots : []).forEach((availabilitySlot) => {
          const avStart = toMinutes(availabilitySlot.startTime || availabilitySlot.start || availabilitySlot.start_time || '');
          const avEnd = toMinutes(availabilitySlot.endTime || availabilitySlot.end || availabilitySlot.end_time || '');
          if (avStart === null || avEnd === null) return;
          const latestStart = avEnd - durationMinutes;
          if (latestStart < avStart) return;
          const candidate = Math.min(Math.max(requestedStartMin, avStart), latestStart);
          const score = Math.abs(candidate - requestedStartMin);
          if (score < bestScore) {
            bestScore = score;
            bestStart = candidate;
          }
        });

        if (bestStart === null) return '';
        const bestEnd = bestStart + durationMinutes;
        return `${minutesToTime(bestStart)}–${minutesToTime(bestEnd)}`;
      };

      let nearestLabel = '';
      const suggested = [];
      const lines = conflicts.map(({ idx, reason }) => {
        const slot = (classFormSnapshot.recurrenceDetails || [])[idx] || {};
        const day = Number.isFinite(Number(slot.dayOfWeek)) ? Number(slot.dayOfWeek) : null;
        const startMin = toMinutes(slot.time);
        const duration = Number(slot.duration) || 0;
        const endMin = startMin !== null ? startMin + duration : null;

        const dayName = day !== null ? (dayNames[day] || `Day ${day}`) : 'Unknown day';
        const reqStart = startMin !== null ? minutesToTime(startMin) : String(slot.time || '');
        const reqEnd = endMin !== null ? minutesToTime(endMin) : '';
        const reqRange = reqEnd ? `${reqStart}–${reqEnd}` : reqStart;

        const daySlots = (day !== null ? slotsByDay[String(day)] : []) || [];
        const daySlotsLabel = daySlots.length
          ? daySlots.map((availabilitySlot) => `${availabilitySlot.startTime || availabilitySlot.start || ''}–${availabilitySlot.endTime || availabilitySlot.end || ''}`).join(', ')
          : 'none';

        const suggestion = reason === 'not_covered'
          ? suggestStartWithinDaySlots(daySlots, startMin, duration)
          : '';

        if (suggestion) {
          const suggestionLine = `${dayName}: ${suggestion}`;
          if (!nearestLabel) nearestLabel = suggestionLine;
          suggested.push(suggestionLine);
        }

        if (reason === 'no_day_slots') {
          return `• ${dayName}: no availability windows (timezone ${tzLabel})`;
        }
        if (reason === 'not_covered') {
          return `• ${dayName}: requested ${reqRange} (${duration} min) is not fully covered. Available: ${daySlotsLabel} (timezone ${tzLabel})`;
        }
        if (reason === 'invalid_time') {
          return `• ${dayName}: invalid time/duration`;
        }
        return `• ${dayName}: not available`;
      });

      return {
        title: reminderOnly
          ? 'Reminder: one or more recurring slots sit outside the teacher availability'
          : 'Teacher not available for one or more recurring slots',
        reason: reminderOnly
          ? 'Admin reminder only. You can still save this class, but the selected slots are outside the teacher availability.'
          : '',
        details: lines.join('\n'),
        nearest: nearestLabel,
        suggested: suggested.slice(nearestLabel ? 1 : 0),
        mode: reminderOnly ? 'reminder' : 'blocking',
      };
    } catch (availErr) {
      try {
        if (!(import.meta?.env?.PROD)) {
          console.error('Availability check failed (create), will allow server validation:', availErr);
        }
      } catch (e) {
        // ignore
      }
      return null;
    }
  }, [adminTimezone]);

  const handleFormSubmit = async (event) => {
    event.preventDefault();
    if (!validateParticipants()) return;
    setShareMessage('');
    if (isStandalone) {
      await handleLocalCreateClass();
    } else {
      const classSnapshot = JSON.parse(JSON.stringify(currentNewClass));
      const adminReminder = isAdminUser
        ? await buildClientRecurringAvailabilityWarning(classSnapshot, { reminderOnly: true })
        : null;

      if (adminReminder) {
        setAvailabilityWarning(adminReminder);
      }

      const result = await handleCreateClass?.(adminReminder ? { force: true } : undefined);
      if (result?.code === 'duplicate') {
        if (adminReminder) setAvailabilityWarning(null);
        const studentName = result?.duplicateSeries?.studentName || 'this student';
        const subject = result?.duplicateSeries?.subject || currentNewClass.subject || 'this subject';
        const message = result?.message || 'Duplicate recurring series detected.';
        duplicateActionRef.current = { mode: 'parent' };
        setDuplicatePrompt({
          message,
          details: `A recurring series for ${studentName} with subject "${subject}" already exists.`
        });
        return;
      }
      if (result?.code === 'availability' && result?.data) {
        setAvailabilityWarning(buildAvailabilityWarningFromApi(result.data));
        return;
      }
      if (result?.success) {
        clearDraftStorage();
        setSuccessMessage(result.message || 'Class created successfully!');
        setShareMessage(await buildShareMessage(classSnapshot));
      }
    }
  };

  const handleProceedAnyway = async () => {
    if (isLoading) return;
    setAvailabilityWarning(null);
    if (isStandalone) {
      await handleLocalCreateClass({ force: true });
      return;
    }
    const classSnapshot = JSON.parse(JSON.stringify(currentNewClass));
    const result = await handleCreateClass?.({ force: true });
    if (result?.code === 'availability' && result?.data) {
      setAvailabilityWarning(buildAvailabilityWarningFromApi(result.data));
      return;
    }
    if (result?.success) {
      clearDraftStorage();
      setSuccessMessage(result.message || 'Class created successfully!');
      setShareMessage(await buildShareMessage(classSnapshot));
    }
  };

  const handleDuplicateConfirm = async () => {
    if (isLoading) return;
    const action = duplicateActionRef.current || {};
    setIsLoading(true);
    setDuplicatePrompt(null);
    try {
      if (action.mode === 'standalone' && action.payload) {
        const overridePayload = { ...action.payload, overrideDuplicateSeries: true };
        await axios.post('/classes', overridePayload);
        clearDraftStorage();
        setSuccessMessage('Recurring classes created successfully!');
        return;
      }

      if (action.mode === 'parent') {
        const result = await handleCreateClass?.({ overrideDuplicateSeries: true });
        if (result?.success) {
          clearDraftStorage();
          setSuccessMessage(result.message || 'Recurring classes created successfully!');
        } else {
          const errorMessage = result?.message || 'Error creating class. Please try again.';
          alert(errorMessage);
        }
      }
    } catch (err) {
      alert(err?.response?.data?.message || err?.message || 'Error creating class. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Push history state when modal opens so Back (popstate) will close it
  useEffect(() => {
    if (!isOpen) return;
    if (pushedRef.current) return;
    try {
      pushedRef.current = true;
      window.history.pushState({ modal: 'create-class' }, '');
    } catch (e) {
      // ignore
    }

    const onPop = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      if (onClose) onClose();
      else navigate(-1);
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, [isOpen, navigate, onClose]);
  
  // Log filtered students whenever guardian selection changes
  useEffect(() => {
    // No console logging here (was noisy in production builds).
  }, [selectedGuardianId]);
  
  const handleLocalCreateClass = async ({ force = false } = {}) => {
    if (!isStandalone) return handleCreateClass?.();
    if (!validateParticipants()) return;
    
    const buildPayload = (shouldForceSubmit) => {
      if (!currentNewClass?.isRecurring) {
        return {
          ...currentNewClass,
          scheduledDate: currentNewClass?.scheduledDate
            ? new Date(currentNewClass.scheduledDate).toISOString()
            : currentNewClass?.scheduledDate,
          force: shouldForceSubmit === true,
        };
      }

      return { ...currentNewClass, force: shouldForceSubmit === true };
    };

    try {
      setIsLoading(true);
      let shouldForceSubmit = force === true;

      if (!shouldForceSubmit) {
        const availabilityPrecheck = await buildClientRecurringAvailabilityWarning(currentNewClass, {
          reminderOnly: isAdminUser,
        });

        if (availabilityPrecheck) {
          setAvailabilityWarning(availabilityPrecheck);
          if (!isAdminUser) {
            return;
          }
          shouldForceSubmit = true;
        }
      }

      const payload = buildPayload(shouldForceSubmit);

      await axios.post('/classes', payload);
      clearDraftStorage();
      setSuccessMessage(currentNewClass?.isRecurring ? 'Recurring classes created successfully!' : 'Class created successfully!');
      setShareMessage(await buildShareMessage(JSON.parse(JSON.stringify(currentNewClass))));
    } catch (error) {
      try {
        if (!(import.meta?.env?.PROD)) {
          console.error('Error creating class:', error);
        }
      } catch (e) {
        // ignore
      }

      const status = error?.response?.status;
      const data = error?.response?.data || {};

      if (data?.availabilityError) {
        setAvailabilityWarning(buildAvailabilityWarningFromApi(data));
        return;
      }

      if (status === 409 && currentNewClass?.isRecurring) {
        const serverMessage = data?.message || 'A recurring series appears to exist for this student/subject.';
        const studentName = data?.duplicateSeries?.studentName || 'this student';
        const subject = data?.duplicateSeries?.subject || currentNewClass.subject || 'this subject';
        duplicateActionRef.current = { mode: 'standalone', payload: buildPayload() };
        setDuplicatePrompt({
          message: serverMessage,
          details: `A recurring series for ${studentName} with subject "${subject}" already exists.`
        });
        return;
      }

      alert(error?.response?.data?.message || error?.message || 'Error creating class. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const addLocalRecurrenceSlot = () => {
    if (!isStandalone) return addRecurrenceSlot?.();
    
    setLocalNewClass(prev => ({
      ...prev,
      recurrenceDetails: [
        ...(prev.recurrenceDetails || []),
        (() => {
          const lastSlot = (prev.recurrenceDetails || [])[prev.recurrenceDetails.length - 1] || {};
          const lastDay = Number.isInteger(Number(lastSlot.dayOfWeek)) ? Number(lastSlot.dayOfWeek) : 1;
          const nextDay = (lastDay + 1) % 7;
          return {
            dayOfWeek: nextDay,
            time: lastSlot.time || '18:00',
            duration: lastSlot.duration || 30,
            timezone: lastSlot.timezone || prev.timezone || DEFAULT_TIMEZONE
          };
        })()
      ]
    }));
  };
  
  const removeLocalRecurrenceSlot = (index) => {
    if (!isStandalone) return removeRecurrenceSlot?.(index);
    
    setLocalNewClass(prev => ({
      ...prev,
      recurrenceDetails: (prev.recurrenceDetails || []).filter((_, i) => i !== index)
    }));
  };
  
  const updateLocalRecurrenceSlot = (index, field, value) => {
    if (!isStandalone) return updateRecurrenceSlot?.(index, field, value);
    
    setLocalNewClass(prev => ({
      ...prev,
      recurrenceDetails: (prev.recurrenceDetails || []).map((slot, i) => 
        i === index ? { ...slot, [field]: value } : slot
      )
    }));
  };
  
  if (!isOpen) return null;
  
  const handleClose = () => {
    // If we pushed state, prevent double-close by clearing the flag then navigate back
    if (pushedRef.current) {
      pushedRef.current = false;
      if (onClose) onClose();
      try { window.history.back(); } catch (e) {}
      return;
    }

    if (onClose) return onClose();
    navigate(-1);
  };

  const classType = currentNewClass?.title || 'One on one';
  const modalHeading = classType === 'One on one' ? 'One on one class' : classType;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-[6px] sm:items-center sm:p-4">
      <div className="relative h-[100dvh] w-full max-w-3xl max-h-[100dvh] overflow-y-auto overscroll-contain rounded-none border border-white/70 bg-slate-50 shadow-[0_32px_90px_rgba(15,23,42,0.28)] sm:max-h-[92vh] sm:rounded-[28px]" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.22),_transparent_58%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.18),_transparent_46%)]" />
        <div className="relative p-3.5 sm:p-6">
          {/* Header */}
          <div className="mb-5 flex items-start justify-between gap-3 sm:mb-6 sm:gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-700 sm:px-3 sm:py-1 sm:text-[11px]">
                Scheduling
              </div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Create {modalHeading}</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600 sm:text-sm">
                Build the class, review conflicts clearly, and keep this draft available while you check the teacher schedule.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                handleClose();
                resetNewClassForm();
              }}
              className={classModalIconButtonClass}
            >
              <XCircle className="h-6 w-6" />
            </button>
          </div>

          {/* Form */}
          <form
            onSubmit={handleFormSubmit}
            onFocusCapture={(event) => {
              if (event.target instanceof Element && event.target.closest('[data-success-banner="true"]')) {
                return;
              }
              if (successMessage) setSuccessMessage('');
              if (shareMessage) setShareMessage('');
              if (duplicatePrompt) setDuplicatePrompt(null);
            }}
            className="space-y-5"
          >
            {/* Class Type Toggle as tabs */}
            <div className="inline-flex w-full rounded-[18px] bg-slate-100/90 p-1.5 shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] sm:rounded-[22px]">
              <button
                type="button"
                role="tab"
                aria-selected={currentNewClass.isRecurring}
                onClick={() => currentSetNewClass((prev) => ({ ...prev, isRecurring: true }))}
                className={getClassModalTabClass(currentNewClass.isRecurring)}
              >
                Recurring Classes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!currentNewClass.isRecurring}
                onClick={() => currentSetNewClass((prev) => ({ ...prev, isRecurring: false }))}
                className={getClassModalTabClass(!currentNewClass.isRecurring)}
              >
                Single Class
              </button>
            </div>

            {/* Availability Warning */}
            {availabilityWarning && (
              <div className="rounded-[20px] border border-amber-200/80 bg-amber-50/95 p-3.5 shadow-[0_12px_30px_rgba(217,119,6,0.10)] sm:rounded-[22px] sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-amber-950">
                      {availabilityWarning.title || 'Teacher not available'}
                    </div>
                    {availabilityWarning.reason && (
                      <div className="mt-1 text-xs text-amber-950 whitespace-pre-wrap">
                        {availabilityWarning.reason}
                      </div>
                    )}
                    {availabilityWarning.details && (
                      <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-amber-200/70 bg-white/70 px-3 py-2 text-xs leading-relaxed text-amber-900">
                        {availabilityWarning.details}
                      </div>
                    )}
                    {availabilityWarning.nearest && (
                      <div className="mt-3 text-xs text-amber-950">
                        <span className="font-medium">Nearest available slot:</span>{' '}
                        {availabilityWarning.nearest}
                      </div>
                    )}
                    {Array.isArray(availabilityWarning.suggested) && availabilityWarning.suggested.length > 0 && (
                      <div className="mt-3 text-xs text-amber-950">
                        <div className="font-medium">Other suggested slots:</div>
                        <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-amber-200/70 bg-white/70 px-3 py-2 leading-relaxed">
                          {availabilityWarning.suggested.map((s) => `• ${s}`).join('\n')}

                        </div>
                      </div>
                    )}
                    {availabilityWarning.mode === 'reminder' ? (
                      <div className="mt-3 text-xs font-medium text-amber-900">
                        Admin reminder only. You can keep this schedule or dismiss this note.
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleProceedAnyway}
                          disabled={isLoading}
                          className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:opacity-60"
                        >
                          Proceed anyway
                        </button>
                        <button
                          type="button"
                          onClick={() => setAvailabilityWarning(null)}
                          className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-white px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-100/70"
                        >
                          Stop and edit
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAvailabilityWarning(null)}
                    className="text-amber-700 transition hover:text-amber-900"
                    aria-label="Dismiss availability warning"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}

            {duplicatePrompt && (
              <div className="rounded-[20px] border border-orange-200/80 bg-orange-50/95 p-3.5 shadow-[0_12px_30px_rgba(234,88,12,0.10)] sm:rounded-[22px] sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-orange-950">
                      {duplicatePrompt.message || 'Duplicate recurring series detected.'}
                    </div>
                    {duplicatePrompt.details && (
                      <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-orange-200/70 bg-white/70 px-3 py-2 text-xs leading-relaxed text-orange-900">
                        {duplicatePrompt.details}
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleDuplicateConfirm}
                        className="inline-flex items-center justify-center rounded-xl bg-orange-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-700"
                        disabled={isLoading}
                      >
                        Create anyway
                      </button>
                      <button
                        type="button"
                        onClick={() => setDuplicatePrompt(null)}
                        className="inline-flex items-center justify-center rounded-xl border border-orange-200 bg-white px-4 py-2 text-xs font-semibold text-orange-900 transition hover:bg-orange-100/70"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDuplicatePrompt(null)}
                    className="text-orange-700 transition hover:text-orange-900"
                    aria-label="Dismiss duplicate series warning"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}

            {successMessage && (
              <div data-success-banner="true" className="flex flex-col items-start justify-between gap-3 rounded-[20px] border border-emerald-200/80 bg-emerald-50/95 p-3.5 text-sm text-emerald-900 shadow-[0_12px_30px_rgba(5,150,105,0.10)] sm:flex-row sm:items-center sm:rounded-[22px] sm:p-4">
                <div className="min-w-0">
                  <p className="font-semibold">{successMessage}</p>
                  {shareMessage && (
                    <p className="mt-1 text-xs leading-relaxed text-emerald-800">WhatsApp confirmation is ready to copy without re-submitting the form.</p>
                  )}
                </div>
                {shareMessage && (
                  <CopyButton
                    text={shareMessage}
                    title="Copy WhatsApp message"
                    variant="outline"
                    size="sm"
                    className="shrink-0 rounded-xl border-emerald-200 bg-white/85 text-emerald-800 shadow-sm hover:bg-emerald-100/70"
                  />
                )}
              </div>
            )}
           
            {/* Participants */}
            <section className={classModalSectionClass}>
              <div className="mb-4">
                <h3 className={classModalSectionTitleClass}>Participants</h3>
                <p className={classModalSectionHintClass}>Choose the teacher, guardian, and student before shaping the schedule.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <SearchSelect
                  label="Teacher *"
                  placeholder="Search teachers..."
                  value={currentNewClass.teacher || ''}
                  onChange={handleTeacherSelect}
                  fetchOptions={fetchTeacherOptions}
                  fetchById={fetchTeacherById}
                  required
                />

                <SearchSelect
                  label="Guardian *"
                  placeholder="Search guardians..."
                  value={currentNewClass.student?.guardianId || ''}
                  onChange={handleGuardianSelect}
                  fetchOptions={fetchGuardianOptions}
                  fetchById={fetchGuardianById}
                  required
                />

                <SearchSelect
                  label="Student *"
                  placeholder="Search students..."
                  value={currentNewClass.student?.studentId || ''}
                  onChange={handleStudentSelect}
                  fetchOptions={fetchStudentOptions}
                  fetchById={fetchStudentById}
                  required
                />
              </div>
            </section>

            

            {/* Single Class Fields */}
            <section className={classModalSectionClass}>
              <div className="mb-4">
                <h3 className={classModalSectionTitleClass}>Schedule</h3>
                <p className={classModalSectionHintClass}>
                  {currentNewClass.isRecurring
                    ? 'Set the weekly pattern, generation window, and slot durations in one place.'
                    : 'Choose the exact date, start time, and duration for this single session.'}
                </p>
              </div>

            {!currentNewClass.isRecurring && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className={classModalLabelClass}>
                    Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={currentNewClass.scheduledDate}
                    onChange={(e) =>
                      currentSetNewClass((prev) => ({
                        ...prev,
                        scheduledDate: e.target.value,
                      }))
                    }
                    className={classModalInputClass}
                  />
                </div>

                <div>
                  <label className={classModalLabelClass}>
                    Duration (min) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={currentNewClass.duration || ''}
                    onChange={(e) =>
                      currentSetNewClass((prev) => ({
                        ...prev,
                        duration: e.target.value === '' ? '' : Number(e.target.value),
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        const direction = e.key === 'ArrowUp' ? 1 : -1;
                        const next = adjustDurationByStep(currentNewClass.duration, direction, 10);
                        currentSetNewClass((prev) => ({
                          ...prev,
                          duration: next
                        }));
                      }
                    }}
                    inputMode="numeric"
                    className={classModalInputClass}
                    placeholder="Minutes"
                  />
                </div>
              </div>
            )}

            {/* Recurring Class Fields */}
            {currentNewClass.isRecurring && (
              <div className="space-y-4">
                <div>
                  <div className="hidden gap-3 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:grid md:[grid-template-columns:1fr_1fr_1fr_1fr_auto]">
                    <div className="min-w-0">Months</div>
                    <div className="min-w-0">Day</div>
                    <div className="min-w-0">Time</div>
                    <div className="min-w-0">Duration</div>
                    <div className="min-w-0 w-11" />
                  </div>

                  {(currentNewClass.recurrenceDetails || []).map((slot, index) => (
                    <div key={index} className={classModalSlotCardClass}>
                    <div className="grid grid-cols-1 gap-3 min-w-0 md:[grid-template-columns:1fr_1fr_1fr_1fr_auto] md:items-center md:gap-2">
                      {/* Generation period shows only on the first row to visually group with slots */}
                      <div className="min-w-0">
                        <div className={`${classModalLabelClass} md:hidden`}>Months</div>
                        {index === 0 ? (
                          <select
                            value={currentNewClass.generationPeriodMonths}
                            onChange={(e) =>
                              currentSetNewClass((prev) => ({
                                ...prev,
                                generationPeriodMonths: parseInt(e.target.value),
                              }))
                            }
                            className={classModalInputClass}
                          >
                            <option value={1}>1 month</option>
                            <option value={2}>2 months</option>
                            <option value={3}>3 months</option>
                            <option value={6}>6 months</option>
                          </select>
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-400">
                            Same as first row
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                          <div className={`${classModalLabelClass} md:hidden`}>Day</div>
                          <select
                          value={
                            slot.dayOfWeek === 0 || slot.dayOfWeek
                              ? slot.dayOfWeek
                              : ''
                          }
                          onChange={(e) =>
                            (isStandalone ? updateLocalRecurrenceSlot : updateRecurrenceSlot)?.(
                              index,
                              'dayOfWeek',
                              e.target.value === '' ? null : Number(e.target.value)
                            )
                          }
                          className={`${classModalInputClass} truncate whitespace-nowrap`}
                        >
                          <option value="">Select Day</option>
                          {dayNames.map((day, i) => (
                            <option key={i} value={i}>
                              {day}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <div className={`${classModalLabelClass} md:hidden`}>Time</div>
                        <TimeInput
                          value={slot.time || ''}
                          onChange={(e) =>
                            (isStandalone ? updateLocalRecurrenceSlot : updateRecurrenceSlot)?.(index, 'time', e.target.value)
                          }
                        />
                      </div>

                      <div className="min-w-0">
                        <div className={`${classModalLabelClass} md:hidden`}>Duration</div>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={slot.duration || ''}
                          onChange={(e) =>
                            (isStandalone ? updateLocalRecurrenceSlot : updateRecurrenceSlot)?.(
                              index,
                              'duration',
                              e.target.value === '' ? null : Number(e.target.value)
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              const direction = e.key === 'ArrowUp' ? 1 : -1;
                              const next = adjustDurationByStep(slot.duration, direction, 10);
                              (isStandalone ? updateLocalRecurrenceSlot : updateRecurrenceSlot)?.(
                                index,
                                'duration',
                                next
                              );
                            }
                          }}
                          inputMode="numeric"
                          className={`${classModalInputClass} truncate whitespace-nowrap`}
                          placeholder="Minutes"
                        />
                      </div>

                      <div className="min-w-0 flex items-end justify-end md:items-center md:justify-center w-full md:w-11 flex-shrink-0">
                        {(currentNewClass.recurrenceDetails || []).length > 1 && (
                          <button
                            type="button"
                            onClick={() => (isStandalone ? removeLocalRecurrenceSlot : removeRecurrenceSlot)?.(index)}
                            className={classModalDangerButtonClass}
                            aria-label="Remove time slot"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    </div>
                  ))}

                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={isStandalone ? addLocalRecurrenceSlot : addRecurrenceSlot}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Slot</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
            </section>

{/* Basic Info */}
            <section className={classModalSectionClass}>
              <div className="mb-4">
                <h3 className={classModalSectionTitleClass}>Class Details</h3>
                <p className={classModalSectionHintClass}>Define the class type, subject, and any billing overrides before saving.</p>
              </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={classModalLabelClass}>
                  Class Type *
                </label>
                <select
                  required
                  value={currentNewClass.title || 'One on one'}
                  onChange={(e) => currentSetNewClass((prev) => ({ ...prev, title: e.target.value }))}
                  className={classModalInputClass}
                >
                  <option value="One on one">One on one</option>
                  <option value="Group classes">Group classes</option>
                  <option value="Public lecture">Public lecture</option>
                </select>
              </div>

              <div>
                <label className={classModalLabelClass}>
                  Subject *
                </label>
                <SearchSelect
                  value={currentNewClass.subject || ''}
                  onChange={(opt) =>
                    currentSetNewClass((prev) => ({ ...prev, subject: opt?.label || '' }))
                  }
                  fetchOptions={async (term = '') => {
                    const q = String(term || '').toLowerCase();
                    return (subjectOptions || [])
                      .filter((s) => !q || String(s).toLowerCase().includes(q))
                      .slice(0, 200)
                      .map((s) => ({ id: s, label: s }));
                  }}
                  fetchById={async (id) => (id ? { id, label: id } : null)}
                  placeholder="Type or select..."
                  required
                  allowCustom
                />
              </div>
            </div>

            {/* Rate Overrides (optional) */}
            <details className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/70" open={currentNewClass.guardianRate != null || currentNewClass.teacherPremium != null}>
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-white/70">
                Rate Overrides (optional)
              </summary>
              <div className="grid grid-cols-1 gap-4 px-4 pb-4 pt-1 md:grid-cols-2">
                <div>
                  <label className={classModalLabelClass}>
                    Guardian Rate ($/hr)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={currentNewClass.guardianRate ?? ''}
                    onChange={(e) =>
                      currentSetNewClass((prev) => ({
                        ...prev,
                        guardianRate: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    className={classModalInputClass}
                    placeholder="Default"
                  />
                  <p className={classModalNoteClass}>Leave empty for default</p>
                </div>
                <div>
                  <label className={classModalLabelClass}>
                    Teacher Premium ($/hr)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={currentNewClass.teacherPremium ?? ''}
                    onChange={(e) =>
                      currentSetNewClass((prev) => ({
                        ...prev,
                        teacherPremium: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    className={classModalInputClass}
                    placeholder="No premium"
                  />
                  <p className={classModalNoteClass}>Extra $/hr for teacher</p>
                </div>
              </div>
            </details>
            </section>

            {/* Additional Fields */}
            <section className={classModalSectionClass}>
              <div className="mb-4">
                <h3 className={classModalSectionTitleClass}>Logistics & Notes</h3>
                <p className={classModalSectionHintClass}>Confirm the timezone, attach the meeting link, and leave any internal notes.</p>
              </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={classModalLabelClass}>
                  Timezone
                </label>
                <TimezoneSelector
                  value={currentNewClass.timezone || adminTimezone}
                  onChange={(timezone) =>
                    currentSetNewClass((prev) => ({ ...prev, timezone }))
                  }
                  placeholder="Select timezone..."
                  className="w-full"
                />
              </div>

              <div>
                <label className={classModalLabelClass}>
                  Meeting Link
                </label>
                <input
                  type="url"
                  value={currentNewClass.meetingLink}
                  onChange={(e) =>
                    currentSetNewClass((prev) => ({ ...prev, meetingLink: e.target.value }))
                  }
                  className={classModalInputClass}
                  placeholder="Paste link..."
                />
              </div>
            </div>
            
            {/* Description */}
            <div className="mt-4">
              <label className={classModalLabelClass}>
                Description
              </label>
              <textarea
                value={currentNewClass.description || ''}
                onChange={(e) =>
                  currentSetNewClass((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={1}
                className={classModalTextareaClass}
                placeholder="Optional notes..."
              />
            </div>
            </section>


            {/* Form Actions */}
            <div className="flex flex-col gap-3 border-t border-slate-200/80 pt-4 pb-[calc(0.25rem+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-between sm:pb-0">
              <p className="text-xs leading-relaxed text-slate-500">
                The draft stays in this browser tab for up to 24 hours and clears after a successful create.
              </p>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  if (!isStandalone) resetNewClassForm?.();
                }}
                className={classModalSecondaryButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className={`${classModalPrimaryButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {isLoading ? "Creating..." : (currentNewClass.isRecurring
                  ? "Create Recurring Classes"
                  : "Create Class")}
              </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
