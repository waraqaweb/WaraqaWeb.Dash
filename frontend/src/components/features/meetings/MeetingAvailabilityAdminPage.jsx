/**
 * MeetingAvailabilityAdminPage
 *
 * Admin UI to manage meeting availability slots that feed the public booking flow.
 */

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { Calendar, Clock, Edit, Plus, Trash2, X, AlertCircle, Link2, CalendarRange, FileText, UserPlus, Copy, Power, Ban, ChevronDown, ChevronUp, GraduationCap } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import {
  listMeetingAvailabilitySlots,
  createMeetingAvailabilitySlot,
  updateMeetingAvailabilitySlot,
  deleteMeetingAvailabilitySlot,
  listMeetingTimeOff,
  createMeetingTimeOff,
  deleteMeetingTimeOff
} from '../../../api/meetings';
import { getMeetingTimezoneOptions } from '../../../utils/timezone';
import { MEETING_DEFAULT_DURATIONS } from '../../../constants/meetingConstants';
import { makeCacheKey, readCache, writeCache } from '../../../utils/sessionCache';
import { getPublicAppUrl } from '../../../utils/publicAppLinks';
import CopyButton from '../../ui/CopyButton';
import MeetingActivityPanel from './MeetingActivityPanel';
import RegistrationLeadsPanel from './RegistrationLeadsPanel';
import TeacherResponsesPanel from './TeacherResponsesPanel';

const MEETING_TYPE_LABELS = {
  new_student_evaluation: 'Evaluations',
  current_student_follow_up: 'Follow ups',
  teacher_sync: 'Teachers'
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PAGE_TABS = [
  { id: 'availability', label: 'Availability', icon: CalendarRange },
  { id: 'meetings', label: 'Meetings', icon: FileText },
  { id: 'leads', label: 'Leads', icon: UserPlus },
  { id: 'teachers', label: 'Teachers', icon: GraduationCap },
];

const getInitialPageTab = () => {
  if (typeof window === 'undefined') return 'availability';
  const section = String(new URLSearchParams(window.location.search).get('section') || '').toLowerCase();
  return PAGE_TABS.some((item) => item.id === section) ? section : 'availability';
};

const emptyFormState = (overrides = {}) => ({
  _id: null,
  meetingType: '',
  dayOfWeek: 0,
  startTime: '09:00',
  endTime: '09:30',
  timezone: 'Africa/Cairo',
  label: '',
  description: '',
  capacity: 1,
  ...overrides
});

const formatTime = (value) => {
  const [hours = '00', minutes = '00'] = String(value || '00:00').split(':');
  const hourNum = parseInt(hours, 10);
  const ampm = hourNum >= 12 ? 'PM' : 'AM';
  const displayHour = hourNum % 12 || 12;
  return `${displayHour}:${minutes} ${ampm}`;
};

const timeStrToMinutes = (value) => {
  const [hours = '0', minutes = '0'] = String(value || '00:00').split(':');
  const h = parseInt(hours, 10);
  const m = parseInt(minutes, 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
};

const minutesToTimeStr = (minutes) => {
  const total = Math.max(0, Math.min(24 * 60, minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const addMinutesToTimeStr = (value, minutes) => minutesToTimeStr(timeStrToMinutes(value) + minutes);

const mergeConsecutiveSlots = (daySlots = []) => {
  const groups = [];
  const sorted = (daySlots || []).slice().sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  for (const slot of sorted) {
    if (!groups.length) {
      groups.push({
        startTime: slot.startTime,
        endTime: slot.endTime,
        label: slot.label || '',
        description: slot.description || '',
        capacity: slot.capacity || 1,
        timezone: slot.timezone || '',
        slots: [slot]
      });
      continue;
    }

    const last = groups[groups.length - 1];
    const sameMeta =
      (last.label || '') === (slot.label || '') &&
      (last.description || '') === (slot.description || '') &&
      (last.capacity || 1) === (slot.capacity || 1) &&
      (last.timezone || '') === (slot.timezone || '');
    const contiguous = String(last.endTime || '') === String(slot.startTime || '');
    if (sameMeta && contiguous) {
      last.endTime = slot.endTime;
      last.slots.push(slot);
      continue;
    }

    groups.push({
      startTime: slot.startTime,
      endTime: slot.endTime,
      label: slot.label || '',
      description: slot.description || '',
      capacity: slot.capacity || 1,
      timezone: slot.timezone || '',
      slots: [slot]
    });
  }
  return groups;
};

const MeetingAvailabilityAdminPage = () => {
  const { user, updateProfile } = useAuth();
  const fallbackTypes = Object.keys(MEETING_TYPE_LABELS);
  const [meetingTypes, setMeetingTypes] = useState(fallbackTypes);
  const [activeType, setActiveType] = useState(fallbackTypes[0]);
  const [slots, setSlots] = useState([]);
  const [timezone, setTimezone] = useState(user?.timezone || 'Africa/Cairo');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formState, setFormState] = useState(() => emptyFormState({ timezone: user?.timezone || 'Africa/Cairo' }));
  const [saving, setSaving] = useState(false);
  const [splitRange, setSplitRange] = useState(true);
  const [lastSlotDefaultsByType, setLastSlotDefaultsByType] = useState({});
  const [expandedGroupKey, setExpandedGroupKey] = useState('');
  const [expandedSlotId, setExpandedSlotId] = useState('');
  const [showDuplicateDay, setShowDuplicateDay] = useState(false);
  const [duplicateSourceDay, setDuplicateSourceDay] = useState(0);
  const [duplicateTargets, setDuplicateTargets] = useState(() => new Set());
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateStatus, setDuplicateStatus] = useState('');
  const [meetingLinkValue, setMeetingLinkValue] = useState(user?.adminSettings?.meetingLink || '');
  const [meetingLinkStatus, setMeetingLinkStatus] = useState({ type: '', message: '' });
  const [meetingLinkSaving, setMeetingLinkSaving] = useState(false);
  const [publicLinkStatus, setPublicLinkStatus] = useState('');
  const [pageTab, setPageTab] = useState(getInitialPageTab);
  const [loadedTabs, setLoadedTabs] = useState(() => new Set([getInitialPageTab()]));
  const timezoneOptions = useMemo(() => getMeetingTimezoneOptions(), []);
  const meetingsEnabled = user?.adminSettings?.meetingsEnabled !== false;
  const [meetingsEnabledSaving, setMeetingsEnabledSaving] = useState(false);

  const [timeOffPeriods, setTimeOffPeriods] = useState([]);
  const [timeOffLoading, setTimeOffLoading] = useState(false);
  const [timeOffError, setTimeOffError] = useState('');
  const [timeOffForm, setTimeOffForm] = useState(() => ({
    date: '',
    startTime: '09:00',
    endTime: '10:00',
    hours: '',
    description: ''
  }));
  const [showTimeOffForm, setShowTimeOffForm] = useState(false);
  const [selectedDaysByType, setSelectedDaysByType] = useState(() => {
    const today = new Date().getDay();
    return fallbackTypes.reduce((acc, type) => {
      acc[type] = [today];
      return acc;
    }, {});
  });
  const slotsRef = useRef([]);
  const refreshSlotsInFlightRef = useRef(false);
  const refreshSlotsKeyRef = useRef('');
  const refreshSlotsAbortRef = useRef(null);
  const refreshSlotsRequestIdRef = useRef(0);
  const timeOffRef = useRef([]);
  const refreshTimeOffInFlightRef = useRef(false);
  const refreshTimeOffKeyRef = useRef('');
  const refreshTimeOffAbortRef = useRef(null);
  const refreshTimeOffRequestIdRef = useRef(0);

  const publicEvaluationLink = useMemo(() => {
    return getPublicAppUrl('/public/meetings/evaluation');
  }, []);

  const publicGuardianFollowUpLink = useMemo(() => {
    return getPublicAppUrl('/public/meetings/evaluation?type=current_student_follow_up');
  }, []);

  const publicTeacherSyncLink = useMemo(() => {
    return getPublicAppUrl('/public/meetings/evaluation?type=teacher_sync');
  }, []);

  const publicRegistrationLink = useMemo(() => {
    return getPublicAppUrl('/register-student');
  }, []);

  const publicTeacherRegistrationLink = useMemo(() => {
    return getPublicAppUrl('/register-teacher');
  }, []);

  const registrationInviteMessage = useMemo(() => (
    `Assalamu Alaykum,\n\nThank you for attending the evaluation session. We hope you found it helpful and informative. Here is the link to our registration form: ${publicRegistrationLink}\n\nAs soon as we receive your response, we will start the registration process and update you soon, Inshaa Allah. If you have any questions regarding our payment and cancellation policy, you can check it on our website so feel free to visit it https://www.waraqaweb.com to learn more about our courses and services.\n\nIt was a pleasure meeting you, and we are excited to accompany you on your learning journey. Please let us know if you have any further questions.\n\nThank you,\nWaraqa`
  ), [publicRegistrationLink]);

  const evaluationInviteMessage = useMemo(() => (
    `Let’s schedule a free evaluation session to assess your level, set a plan, and answer any questions you may have.\n\n${publicEvaluationLink}`
  ), [publicEvaluationLink]);

  useEffect(() => {
    setLoadedTabs((prev) => {
      if (prev.has(pageTab)) return prev;
      const next = new Set(prev);
      next.add(pageTab);
      return next;
    });
  }, [pageTab]);

  useEffect(() => {
    if (!activeType && meetingTypes.length) {
      setActiveType(meetingTypes[0]);
    }
  }, [activeType, meetingTypes]);

  useEffect(() => {
    slotsRef.current = slots || [];
  }, [slots]);

  useEffect(() => {
    timeOffRef.current = timeOffPeriods || [];
  }, [timeOffPeriods]);

  const refreshSlots = useCallback(async (options = {}) => {
    const currentType = activeType;
    if (!currentType) return;
    const requestSignature = JSON.stringify({ type: currentType, includeInactive: false });
    if (refreshSlotsInFlightRef.current && refreshSlotsKeyRef.current === requestSignature) {
      return;
    }

    refreshSlotsKeyRef.current = requestSignature;
    refreshSlotsInFlightRef.current = true;

    const requestId = refreshSlotsRequestIdRef.current + 1;
    refreshSlotsRequestIdRef.current = requestId;

    if (refreshSlotsAbortRef.current) {
      try {
        refreshSlotsAbortRef.current.abort();
      } catch (e) {
        // ignore abort errors
      }
    }

    const controller = new AbortController();
    refreshSlotsAbortRef.current = controller;

    if (!options.silent) {
      const hasExisting = (slotsRef.current || []).length > 0;
      setLoading(!hasExisting);
    }
    setError('');
    try {
      const cacheKey = makeCacheKey('meetings:availabilitySlots', user?._id || 'admin', { meetingType: currentType });
      const cached = readCache(cacheKey, { deps: ['meetings'] });
      if (cached.hit && cached.value) {
        const data = cached.value;
        setSlots(data.slots || []);
        if (Array.isArray(data.meetingTypes) && data.meetingTypes.length) {
          setMeetingTypes(data.meetingTypes);
          if (!data.meetingTypes.includes(currentType)) {
            setActiveType(data.meetingTypes[0]);
          }
        }
        if (data.timezone) {
          setTimezone(data.timezone);
        }
        if (cached.ageMs < 60_000) {
          refreshSlotsInFlightRef.current = false;
          return;
        }
      }

      const data = await listMeetingAvailabilitySlots({ meetingType: currentType, includeInactive: false }, { signal: controller.signal });
      if (requestId !== refreshSlotsRequestIdRef.current) return;
      setSlots(data.slots || []);
      if (Array.isArray(data.meetingTypes) && data.meetingTypes.length) {
        setMeetingTypes(data.meetingTypes);
        if (!data.meetingTypes.includes(currentType)) {
          setActiveType(data.meetingTypes[0]);
        }
      }
      if (data.timezone) {
        setTimezone(data.timezone);
      }
      writeCache(cacheKey, data, { ttlMs: 5 * 60_000, deps: ['meetings'] });
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        console.error('Failed to load meeting availability slots', err);
        setError(err.response?.data?.message || 'Failed to load meeting availability');
      }
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
      refreshSlotsInFlightRef.current = false;
    }
  }, [activeType, user?._id]);

  const refreshTimeOff = useCallback(async () => {
    const requestSignature = JSON.stringify({ scope: 'next-60-days' });
    if (refreshTimeOffInFlightRef.current && refreshTimeOffKeyRef.current === requestSignature) {
      return;
    }

    refreshTimeOffKeyRef.current = requestSignature;
    refreshTimeOffInFlightRef.current = true;

    const requestId = refreshTimeOffRequestIdRef.current + 1;
    refreshTimeOffRequestIdRef.current = requestId;

    if (refreshTimeOffAbortRef.current) {
      try {
        refreshTimeOffAbortRef.current.abort();
      } catch (e) {
        // ignore abort errors
      }
    }

    const controller = new AbortController();
    refreshTimeOffAbortRef.current = controller;

    const hasExisting = (timeOffRef.current || []).length > 0;
    setTimeOffLoading(!hasExisting);
    setTimeOffError('');
    try {
      // Load nearby periods (next 60 days) for convenience.
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 60);
      const cacheKey = makeCacheKey('meetings:timeOff', user?._id || 'admin', { rangeStart: start.toISOString(), rangeEnd: end.toISOString() });
      const cached = readCache(cacheKey, { deps: ['meetings'] });
      if (cached.hit && cached.value) {
        setTimeOffPeriods(cached.value.periods || []);
        if (cached.ageMs < 60_000) {
          refreshTimeOffInFlightRef.current = false;
          return;
        }
      }

      const data = await listMeetingTimeOff({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() }, { signal: controller.signal });
      if (requestId !== refreshTimeOffRequestIdRef.current) return;
      setTimeOffPeriods(data.periods || []);
      writeCache(cacheKey, data, { ttlMs: 5 * 60_000, deps: ['meetings'] });
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        console.error('Failed to load meeting time off', err);
        setTimeOffError(err?.response?.data?.message || 'Failed to load time off');
      }
    } finally {
      setTimeOffLoading(false);
      refreshTimeOffInFlightRef.current = false;
    }
  }, [user?._id]);

  useEffect(() => {
    refreshSlots();
  }, [refreshSlots]);

  useEffect(() => {
    refreshTimeOff();
  }, [refreshTimeOff]);

  const slotsByDay = useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    slots.forEach((slot) => {
      const idx = slot.dayOfWeek ?? 0;
      map[idx].push(slot);
    });
    return map.map((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  }, [slots]);

  const activeSelectedDays = selectedDaysByType[activeType] || [new Date().getDay()];

  const mergedSlotsByDay = useMemo(() => {
    return slotsByDay.map((daySlots) => mergeConsecutiveSlots(daySlots));
  }, [slotsByDay]);

  useEffect(() => {
    setMeetingLinkValue(user?.adminSettings?.meetingLink || '');
  }, [user?.adminSettings?.meetingLink]);

  const openCreateForm = (dayIndex = 0) => {
    const meetingType = activeType;
    const durationMinutes = MEETING_DEFAULT_DURATIONS[meetingType] || 30;
    const existingForDay = slotsByDay[dayIndex] || [];
    const lastForDay = existingForDay.length ? existingForDay[existingForDay.length - 1] : null;
    const lastDefault = lastSlotDefaultsByType[meetingType];

    const suggestedStart =
      lastForDay?.endTime ||
      (lastDefault && lastDefault.dayOfWeek === dayIndex ? lastDefault.endTime : '') ||
      (lastDefault ? lastDefault.endTime : '') ||
      '09:00';

    const suggestedEnd = addMinutesToTimeStr(suggestedStart, durationMinutes);

    setSplitRange(true);
    setFormState(emptyFormState({
      meetingType,
      dayOfWeek: dayIndex,
      timezone,
      startTime: suggestedStart,
      endTime: suggestedEnd
    }));
    setShowForm(true);
  };

  const openEditForm = (slot) => {
    setSplitRange(false);
    setFormState(emptyFormState({ ...slot }));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormState(emptyFormState({ timezone }));
    setExpandedSlotId('');
  };

  const handleFormChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveMeetingLink = async () => {
    if (!user?._id) return;
    setMeetingLinkStatus({ type: '', message: '' });
    const normalizedLink = meetingLinkValue.trim();
    if (normalizedLink && !/^https?:\/\//i.test(normalizedLink)) {
      setMeetingLinkStatus({ type: 'error', message: 'Include http:// or https:// in the meeting link.' });
      return;
    }
    setMeetingLinkSaving(true);
    try {
      const payload = {
        adminSettings: {
          ...(user?.adminSettings || {}),
          meetingLink: normalizedLink
        }
      };
      const result = await updateProfile(payload);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to save meeting link');
      }
      setMeetingLinkStatus({ type: 'success', message: 'Meeting link saved.' });
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Failed to save meeting link';
      setMeetingLinkStatus({ type: 'error', message });
    } finally {
      setMeetingLinkSaving(false);
    }
  };

  const handleToggleMeetingsEnabled = async () => {
    if (!user?._id) return;
    setMeetingsEnabledSaving(true);
    try {
      const payload = {
        adminSettings: {
          ...(user?.adminSettings || {}),
          meetingsEnabled: !meetingsEnabled
        }
      };
      const result = await updateProfile(payload);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to update meetings status');
      }
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Failed to update meetings status';
      setError(message);
    } finally {
      setMeetingsEnabledSaving(false);
    }
  };

  const handleTimeOffChange = (field, value) => {
    setTimeOffForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'hours' && next.startTime && String(value || '').trim()) {
        const hoursNum = Number(value);
        if (Number.isFinite(hoursNum) && hoursNum > 0) {
          const endMinutes = timeStrToMinutes(next.startTime) + Math.round(hoursNum * 60);
          next.endTime = minutesToTimeStr(endMinutes);
        }
      }
      return next;
    });
  };

  const handleCreateTimeOff = async () => {
    setTimeOffError('');
    const { date, startTime, endTime, description } = timeOffForm;
    if (!date || !startTime || !endTime || startTime >= endTime) {
      setTimeOffError('Choose a date and a valid time range.');
      return;
    }

    try {
      await createMeetingTimeOff({
        date,
        startTime,
        endTime,
        timezone,
        description: description || undefined
      });
      setTimeOffForm((prev) => ({ ...prev, description: '' }));
      await refreshTimeOff();
    } catch (err) {
      console.error('Failed to create time off', err);
      setTimeOffError(err?.response?.data?.message || 'Failed to create time off');
    }
  };

  const handleDeleteTimeOff = async (timeOffId) => {
    if (!window.confirm('Delete this time off?')) return;
    try {
      await deleteMeetingTimeOff(timeOffId);
      await refreshTimeOff();
    } catch (err) {
      console.error('Failed to delete time off', err);
      setTimeOffError(err?.response?.data?.message || 'Failed to delete time off');
    }
  };

  const formatDateTime = (value) => {
    try {
      const d = new Date(value);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }).format(d);
    } catch {
      return String(value);
    }
  };

  const handleCopyPublicLink = async () => {
    setPublicLinkStatus('');
    const value = publicEvaluationLink;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setPublicLinkStatus('Copied');
      window.setTimeout(() => setPublicLinkStatus(''), 2000);
    } catch (err) {
      console.error('Failed to copy public booking link', err);
      setPublicLinkStatus('Copy failed');
      window.setTimeout(() => setPublicLinkStatus(''), 2500);
    }
  };

  const toggleVisibleDay = (dayIndex) => {
    setSelectedDaysByType((prev) => {
      const current = new Set(prev[activeType] || [new Date().getDay()]);
      if (current.has(dayIndex)) {
        if (current.size === 1) return prev;
        current.delete(dayIndex);
      } else {
        current.add(dayIndex);
      }
      return { ...prev, [activeType]: Array.from(current).sort((a, b) => a - b) };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    // Basic client-side validation to avoid 500 when times are invalid
    const start = formState.startTime || '';
    const end = formState.endTime || '';
    if (!start || !end || start >= end) {
      setError('End time must be after start time.');
      return;
    }
    setSaving(true);
    const meetingType = formState.meetingType || activeType;
    const durationMinutes = MEETING_DEFAULT_DURATIONS[meetingType] || 30;
    const basePayload = {
      meetingType,
      dayOfWeek: formState.dayOfWeek,
      timezone: formState.timezone || timezone,
      label: formState.label || undefined,
      description: formState.description || undefined,
      capacity: Number(formState.capacity) || 1
    };

    try {
      if (formState._id) {
        await updateMeetingAvailabilitySlot(formState._id, {
          ...basePayload,
          startTime: formState.startTime,
          endTime: formState.endTime,
        });

        setSaving(false);
        closeForm();
        await refreshSlots({ silent: true });
        return;
      }

      const startMinutes = timeStrToMinutes(start);
      const endMinutes = timeStrToMinutes(end);
      const totalMinutes = endMinutes - startMinutes;
      const shouldSplit = splitRange && totalMinutes > durationMinutes;
      if (shouldSplit && totalMinutes % durationMinutes !== 0) {
        setSaving(false);
        setError(`Range must be a multiple of ${durationMinutes} minutes.`);
        return;
      }

      const segments = [];
      if (shouldSplit) {
        for (let t = startMinutes; t < endMinutes; t += durationMinutes) {
          segments.push({ startTime: minutesToTimeStr(t), endTime: minutesToTimeStr(t + durationMinutes) });
        }
      } else {
        segments.push({ startTime: formState.startTime, endTime: formState.endTime });
      }

      for (const segment of segments) {
        await createMeetingAvailabilitySlot({
          ...basePayload,
          startTime: segment.startTime,
          endTime: segment.endTime,
        });
      }

      const lastEndTime = segments[segments.length - 1]?.endTime || formState.endTime;
      setLastSlotDefaultsByType((prev) => ({
        ...prev,
        [meetingType]: {
          dayOfWeek: formState.dayOfWeek,
          endTime: lastEndTime,
          durationMinutes
        }
      }));

      await refreshSlots({ silent: true });

      // Keep the form open and preselect the next slot time.
      const nextStart = lastEndTime;
      const nextEnd = addMinutesToTimeStr(nextStart, durationMinutes);
      setFormState((prev) => ({
        ...prev,
        _id: null,
        startTime: nextStart,
        endTime: nextEnd,
      }));
      setSaving(false);
    } catch (err) {
      console.error('Failed to save meeting availability slot', err);
      setSaving(false);
      setError(err.response?.data?.message || 'Failed to save meeting availability slot');
    }
  };

  const openDuplicateDayModal = (sourceDay) => {
    setDuplicateStatus('');
    setDuplicateSourceDay(sourceDay);
    setDuplicateTargets(new Set());
    setShowDuplicateDay(true);
  };

  const toggleDuplicateTarget = (dayIndex) => {
    setDuplicateTargets((prev) => {
      const next = new Set(prev);
      if (next.has(dayIndex)) next.delete(dayIndex);
      else next.add(dayIndex);
      return next;
    });
  };

  const handleDuplicateDay = async () => {
    const meetingType = activeType;
    const sourceSlots = (slotsByDay[duplicateSourceDay] || []).slice();
    if (!sourceSlots.length) {
      setDuplicateStatus('No slots to duplicate.');
      return;
    }

    const targets = Array.from(duplicateTargets);
    if (!targets.length) {
      setDuplicateStatus('Select at least one weekday.');
      return;
    }

    setDuplicating(true);
    setDuplicateStatus('');
    let createdCount = 0;
    let failedCount = 0;

    try {
      for (const targetDay of targets) {
        for (const slot of sourceSlots) {
          try {
            await createMeetingAvailabilitySlot({
              meetingType,
              dayOfWeek: targetDay,
              startTime: slot.startTime,
              endTime: slot.endTime,
              timezone: slot.timezone || timezone,
              label: slot.label || undefined,
              description: slot.description || undefined,
              capacity: Number(slot.capacity) || 1
            });
            createdCount += 1;
          } catch (err) {
            failedCount += 1;
          }
        }
      }

      await refreshSlots({ silent: true });
      setDuplicateStatus(
        failedCount
          ? `Duplicated ${createdCount} slot(s). Skipped ${failedCount} (overlap).`
          : `Duplicated ${createdCount} slot(s).`
      );
      window.setTimeout(() => {
        setShowDuplicateDay(false);
        setDuplicateStatus('');
      }, 700);
    } finally {
      setDuplicating(false);
    }
  };

  const handleDelete = async (slotId) => {
    if (!window.confirm('Delete this availability slot?')) {
      return;
    }
    try {
      await deleteMeetingAvailabilitySlot(slotId);
      await refreshSlots({ silent: true });
    } catch (err) {
      console.error('Failed to delete meeting availability slot', err);
      setError(err.response?.data?.message || 'Failed to delete meeting availability slot');
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="p-6">
        <div className="text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">Only admins can manage meeting availability.</p>
        </div>
      </div>
    );
  }

  const renderAvailabilitySection = () => (
    <>
      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="mt-2 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-4 xl:flex-nowrap xl:gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <label className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Meeting type</label>
            {(meetingTypes.length ? meetingTypes : fallbackTypes).map((type) => {
              const active = activeType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setActiveType(type)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${active ? 'bg-[#2C736C] text-white shadow-sm' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {MEETING_TYPE_LABELS[type] || type}
                </button>
              );
            })}
          </div>

          <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-end">
            <label className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Visible days</label>
            <button
              type="button"
              onClick={() => setSelectedDaysByType((prev) => ({ ...prev, [activeType]: [new Date().getDay()] }))}
              className="mr-1 text-xs font-semibold text-[#2C736C] hover:underline"
            >
              Today only
            </button>
            {DAY_NAMES.map((day, index) => {
              const active = activeSelectedDays.includes(index);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleVisibleDay(index)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold transition ${active ? 'bg-[#2C736C] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-[#2C736C]'}`}
                  title={day}
                >
                  {SHORT_DAY_NAMES[index]}
                </button>
              );
            })}
            <button type="button" onClick={() => openCreateForm(activeSelectedDays[0] ?? new Date().getDay())} className="ml-1 inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-110">
              <Plus className="w-4 h-4" /> Add slot
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 space-y-3 animate-pulse">
          {[...Array(Math.max(activeSelectedDays.length, 1))].map((_, idx) => (
            <div key={idx} className="h-20 rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {activeSelectedDays.map((index) => {
            const day = DAY_NAMES[index];
            const daySlots = slotsByDay[index];
            const dayGroups = mergedSlotsByDay[index] || [];
            return (
              <div key={day} className="border border-gray-200 rounded-2xl bg-white p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{day}</p>
                    <p className="text-xs text-gray-500">{daySlots.length ? `${daySlots.length} slot${daySlots.length !== 1 ? 's' : ''}` : 'No slots'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {daySlots.length > 0 && (
                      <button type="button" onClick={() => openDuplicateDayModal(index)} className="icon-button icon-button--muted" title="Duplicate day">
                        <Copy className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" onClick={() => openCreateForm(index)} className="icon-button icon-button--muted" title="Add slot">
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {daySlots.length === 0 ? (
                  <p className="text-xs text-gray-400">No windows.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {dayGroups.map((group) => {
                      const groupKey = `${index}:${group.startTime}-${group.endTime}:${group.label || ''}:${group.capacity || 1}`;
                      const expanded = expandedGroupKey === groupKey;
                      return (
                        <div key={groupKey} className="border rounded-xl px-3 py-2 bg-gradient-to-r from-white to-gray-50">
                          <button type="button" onClick={() => {
                            setExpandedSlotId('');
                            setExpandedGroupKey((prev) => (prev === groupKey ? '' : groupKey));
                          }} className="w-full text-left">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{formatTime(group.startTime)} — {formatTime(group.endTime)}</p>
                                <p className="text-xs text-gray-500">{group.label || 'Open'} · Cap {group.capacity || 1}{group.slots.length > 1 ? ` · ${group.slots.length} blocks` : ''}</p>
                              </div>
                              <div className="text-xs font-semibold text-gray-500">{expanded ? 'Hide' : 'Open'}</div>
                            </div>
                          </button>

                          {expanded && (
                            <div className="mt-2 space-y-2">
                              {group.slots.map((slot) => (
                                <div key={slot._id} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
                                  <div className="flex items-start justify-between gap-3">
                                    <button type="button" onClick={() => setExpandedSlotId((prev) => (prev === slot._id ? '' : slot._id))} className="text-left">
                                      <p className="text-sm font-semibold text-gray-900">{formatTime(slot.startTime)} — {formatTime(slot.endTime)}</p>
                                      <p className="text-xs text-gray-500">{slot.label || 'Open'} · Cap {slot.capacity || 1}</p>
                                    </button>
                                    <div className="flex items-center gap-1">
                                      <button type="button" onClick={() => openEditForm(slot)} className="icon-button icon-button--muted" title="Edit"><Edit className="w-4 h-4" /></button>
                                      <button type="button" onClick={() => handleDelete(slot._id)} className="icon-button icon-button--muted text-red-500 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                  </div>
                                  {expandedSlotId === slot._id && slot.description ? <p className="mt-2 text-xs text-gray-500">{slot.description}</p> : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  return (
    <div className="mx-auto max-w-[1600px] p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-gray-700" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Meeting Availability</h1>
            <p className="text-sm text-gray-500">Control the bookable windows for evaluations and syncs.</p>
          </div>
        </div>
        <div className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#2C736C]" />
          <span>{timezone}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap gap-2">
            {PAGE_TABS.map((item) => {
              const Icon = item.icon;
              const active = pageTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPageTab(item.id)}
                  className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${active ? 'border-[#2C736C] bg-[#2C736C] text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-[#2C736C] hover:text-[#2C736C]'}`}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </button>
              );
            })}
            </div>
          </div>
          <div className="mt-6">
            <div className={pageTab === 'availability' ? 'block' : 'hidden'}>
              {renderAvailabilitySection()}
            </div>
            {loadedTabs.has('meetings') ? (
              <div className={pageTab === 'meetings' ? 'block' : 'hidden'}>
                <MeetingActivityPanel timezone={timezone} />
              </div>
            ) : null}
            {loadedTabs.has('leads') ? (
              <div className={pageTab === 'leads' ? 'block' : 'hidden'}>
                <RegistrationLeadsPanel registrationLink={publicRegistrationLink} />
              </div>
            ) : null}
            {loadedTabs.has('teachers') ? (
              <div className={pageTab === 'teachers' ? 'block' : 'hidden'}>
                <TeacherResponsesPanel />
              </div>
            ) : null}
          </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-lg font-semibold text-gray-900">
                  {formState._id ? 'Edit slot' : 'Add slot'}
                </p>
                <p className="text-xs text-gray-500">{MEETING_TYPE_LABELS[formState.meetingType || activeType]}</p>
              </div>
              <button type="button" onClick={closeForm} className="icon-button icon-button--muted">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Day</label>
                  <select
                    value={formState.dayOfWeek}
                    onChange={(e) => handleFormChange('dayOfWeek', parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  >
                    {DAY_NAMES.map((day, idx) => (
                      <option key={day} value={idx}>{day}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Start</label>
                  <input
                    type="time"
                    value={formState.startTime}
                    onChange={(e) => handleFormChange('startTime', e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">End</label>
                  <input
                    type="time"
                    value={formState.endTime}
                    onChange={(e) => handleFormChange('endTime', e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </div>
              </div>

              {!formState._id && (
                <label className="flex items-start gap-2 text-xs font-medium text-gray-600">
                  <input
                    type="checkbox"
                    checked={splitRange}
                    onChange={(e) => setSplitRange(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Auto-split to {MEETING_DEFAULT_DURATIONS[formState.meetingType || activeType] || 30} min</span>
                </label>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Timezone</label>
                <select
                  value={formState.timezone}
                  onChange={(e) => handleFormChange('timezone', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2"
                >
                  {timezoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Label</label>
                <input
                  type="text"
                  value={formState.label}
                  onChange={(e) => handleFormChange('label', e.target.value)}
                  placeholder="Short label"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeForm}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                >
                  {saving ? 'Saving…' : formState._id ? 'Update' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        </div>

        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Link2 className="w-4 h-4 text-[#2C736C]" />Default link</div>
            <div className="mt-3 flex items-center gap-2">
              <input type="url" value={meetingLinkValue} onChange={(e) => setMeetingLinkValue(e.target.value)} placeholder="https://meet.google.com/..." className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C736C]" />
              <button type="button" onClick={handleSaveMeetingLink} disabled={meetingLinkSaving} className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60">{meetingLinkSaving ? 'Saving…' : 'Save'}</button>
            </div>
            {meetingLinkStatus.message ? <p className={`mt-2 text-xs ${meetingLinkStatus.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{meetingLinkStatus.message}</p> : null}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Link2 className="w-4 h-4 text-[#2C736C]" />Evaluation link</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input type="text" value={publicEvaluationLink} readOnly className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <CopyButton text={publicEvaluationLink} title="Copy evaluation link" variant="link" icon="link" className="rounded-xl shadow-sm" />
                  <CopyButton text={evaluationInviteMessage} title="Copy evaluation message" variant="message" icon="message" className="rounded-xl shadow-sm" />
                </div>
              </div>
              {publicLinkStatus ? <p className="mt-2 text-xs text-slate-500">{publicLinkStatus}</p> : null}
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Link2 className="w-4 h-4 text-[#2C736C]" />Guardian follow-up link</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input type="text" value={publicGuardianFollowUpLink} readOnly className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <CopyButton text={publicGuardianFollowUpLink} title="Copy guardian follow-up link" variant="link" icon="link" className="rounded-xl shadow-sm" />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Link2 className="w-4 h-4 text-[#2C736C]" />Teacher sync link</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input type="text" value={publicTeacherSyncLink} readOnly className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <CopyButton text={publicTeacherSyncLink} title="Copy teacher sync link" variant="link" icon="link" className="rounded-xl shadow-sm" />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><UserPlus className="w-4 h-4 text-[#2C736C]" />Registration link</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input type="text" value={publicRegistrationLink} readOnly className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <CopyButton text={publicRegistrationLink} title="Copy registration link" variant="link" icon="link" className="rounded-xl shadow-sm" />
                  <CopyButton text={registrationInviteMessage} title="Copy registration message" variant="message" icon="message" className="rounded-xl shadow-sm" />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><UserPlus className="w-4 h-4 text-[#2C736C]" />Teacher registration link</div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input type="text" value={publicTeacherRegistrationLink} readOnly className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700" />
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <CopyButton text={publicTeacherRegistrationLink} title="Copy teacher registration link" variant="link" icon="link" className="rounded-xl shadow-sm" />
                </div>
              </div>
            </div>

          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Power className={`h-4 w-4 ${meetingsEnabled ? 'text-emerald-600' : 'text-slate-400'}`} />Meetings</div>
              <div className={`text-sm font-semibold ${meetingsEnabled ? 'text-green-700' : 'text-gray-700'}`}>{meetingsEnabled ? 'On' : 'Off'}</div>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={handleToggleMeetingsEnabled}
                disabled={meetingsEnabledSaving}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white ${meetingsEnabled ? 'bg-[#2C736C]' : 'bg-gray-600'} disabled:opacity-60`}
              >
                <Ban className="h-4 w-4" />{meetingsEnabledSaving ? 'Saving…' : meetingsEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <button type="button" onClick={() => setShowTimeOffForm((prev) => !prev)} className="flex w-full items-center justify-between gap-3 text-left">
              <div>
                <p className="text-sm font-semibold text-gray-900">Time off</p>
                <p className="text-xs text-gray-500">Block bookings when needed.</p>
              </div>
              {showTimeOffForm ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>

            {showTimeOffForm ? (
            <div className="mt-4 grid grid-cols-1 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Date</label>
                  <input
                    type="date"
                    value={timeOffForm.date}
                    onChange={(e) => handleTimeOffChange('date', e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Hours (optional)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={timeOffForm.hours}
                    onChange={(e) => handleTimeOffChange('hours', e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                    placeholder="e.g. 2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Start</label>
                  <input
                    type="time"
                    value={timeOffForm.startTime}
                    onChange={(e) => handleTimeOffChange('startTime', e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">End</label>
                  <input
                    type="time"
                    value={timeOffForm.endTime}
                    onChange={(e) => handleTimeOffChange('endTime', e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Description (optional)</label>
                <input
                  type="text"
                  value={timeOffForm.description}
                  onChange={(e) => handleTimeOffChange('description', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  placeholder="e.g. appointment"
                />
              </div>

              {timeOffError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{timeOffError}</div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCreateTimeOff}
                  className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
                  disabled={timeOffLoading}
                >
                  {timeOffLoading ? 'Saving…' : 'Add time off'}
                </button>
              </div>

              <div className="border-t border-gray-100 pt-3">
                {timeOffLoading ? (
                  <p className="text-sm text-gray-500">Loading…</p>
                ) : timeOffPeriods.length === 0 ? (
                  <p className="text-sm text-gray-500">No time off scheduled.</p>
                ) : (
                  <div className="space-y-2">
                    {timeOffPeriods.map((period) => (
                      <div key={period._id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {formatDateTime(period.startDateTime)} → {formatDateTime(period.endDateTime)}
                          </p>
                          {period.description ? (
                            <p className="text-xs text-gray-600">{period.description}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteTimeOff(period._id)}
                          className="text-xs font-semibold text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            ) : (
              <div className="mt-3 text-sm text-slate-500">Hidden. Click to manage.</div>
            )}
          </div>
        </div>
      </div>

      {showDuplicateDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-lg font-semibold text-gray-900">Duplicate day</p>
                <p className="text-xs text-gray-500">Copy all slots from {DAY_NAMES[duplicateSourceDay]} to selected weekdays.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!duplicating) {
                    setShowDuplicateDay(false);
                    setDuplicateStatus('');
                  }
                }}
                className="icon-button icon-button--muted"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {DAY_NAMES.map((name, idx) => (
                <label
                  key={name}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                    idx === duplicateSourceDay
                      ? 'border-gray-200 bg-gray-50 text-gray-400'
                      : 'border-gray-200 bg-white text-gray-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={idx === duplicateSourceDay || duplicating}
                    checked={duplicateTargets.has(idx)}
                    onChange={() => toggleDuplicateTarget(idx)}
                  />
                  {name}
                </label>
              ))}
            </div>

            {duplicateStatus && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800">
                {duplicateStatus}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!duplicating) {
                    setShowDuplicateDay(false);
                    setDuplicateStatus('');
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                disabled={duplicating}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDuplicateDay}
                disabled={duplicating}
                className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
              >
                {duplicating ? 'Duplicating…' : 'Duplicate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingAvailabilityAdminPage;
