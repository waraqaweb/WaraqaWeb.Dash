/**
 * MeetingAvailabilityAdminPage
 *
 * Admin UI to manage meeting availability slots that feed the public booking flow.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Clock, Edit, Plus, Trash2, X, AlertCircle, Link2 } from 'lucide-react';
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

const MEETING_TYPE_LABELS = {
  new_student_evaluation: 'New Student Evaluations',
  current_student_follow_up: 'Guardian Follow-ups',
  teacher_sync: 'Teacher Syncs'
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

  const publicEvaluationLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const publicUrl = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    const basePrefix = publicUrl && publicUrl !== '/' ? publicUrl : '';
    return `${window.location.origin}${basePrefix}/public/meetings/evaluation`;
  }, []);

  useEffect(() => {
    if (!activeType && meetingTypes.length) {
      setActiveType(meetingTypes[0]);
    }
  }, [activeType, meetingTypes]);

  const refreshSlots = useCallback(async (options = {}) => {
    const currentType = activeType;
    if (!currentType) return;
    if (!options.silent) {
      setLoading(true);
    }
    setError('');
    try {
      const data = await listMeetingAvailabilitySlots({ meetingType: currentType, includeInactive: false });
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
    } catch (err) {
      console.error('Failed to load meeting availability slots', err);
      setError(err.response?.data?.message || 'Failed to load meeting availability');
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }, [activeType]);

  const refreshTimeOff = useCallback(async () => {
    setTimeOffLoading(true);
    setTimeOffError('');
    try {
      // Load nearby periods (next 60 days) for convenience.
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 60);
      const data = await listMeetingTimeOff({ rangeStart: start.toISOString(), rangeEnd: end.toISOString() });
      setTimeOffPeriods(data.periods || []);
    } catch (err) {
      console.error('Failed to load meeting time off', err);
      setTimeOffError(err?.response?.data?.message || 'Failed to load time off');
    } finally {
      setTimeOffLoading(false);
    }
  }, []);

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

  return (
    <div className="p-6 max-w-6xl mx-auto">
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

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="flex flex-wrap gap-2">
        {(meetingTypes.length ? meetingTypes : fallbackTypes).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setActiveType(type)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition ${
              activeType === type
                ? 'bg-[#2C736C] text-white border-[#2C736C]'
                : 'bg-white text-gray-700 border-gray-200 hover:border-[#2C736C] hover:text-[#2C736C]'
            }`}
          >
            {MEETING_TYPE_LABELS[type] || type}
          </button>
        ))}
          </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 space-y-3 animate-pulse">
          {[...Array(3)].map((_, idx) => (
            <div key={idx} className="h-16 rounded-lg bg-gray-100" />
          ))}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {DAY_NAMES.map((day, index) => {
            const daySlots = slotsByDay[index];
            const dayGroups = mergedSlotsByDay[index] || [];
            return (
              <div key={day} className="border border-gray-200 rounded-2xl bg-white p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{day}</p>
                    <p className="text-xs text-gray-500">
                      {daySlots.length ? `${daySlots.length} slot${daySlots.length !== 1 ? 's' : ''}` : 'No slots yet'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {daySlots.length > 0 && (
                      <button
                        type="button"
                        onClick={() => openDuplicateDayModal(index)}
                        className="text-xs font-semibold text-gray-600 hover:text-[#2C736C]"
                        title={`Duplicate ${day} to other weekdays`}
                      >
                        Duplicate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openCreateForm(index)}
                      className="icon-button icon-button--muted"
                      title={`Add slot for ${day}`}
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {daySlots.length === 0 ? (
                  <p className="text-xs text-gray-400">No bookable windows.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {dayGroups.map((group) => {
                      const groupKey = `${index}:${group.startTime}-${group.endTime}:${group.label || ''}:${group.capacity || 1}`;
                      const expanded = expandedGroupKey === groupKey;
                      return (
                        <div key={groupKey} className="border rounded-xl px-3 py-2 bg-gradient-to-r from-white to-gray-50">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedSlotId('');
                              setExpandedGroupKey((prev) => (prev === groupKey ? '' : groupKey));
                            }}
                            className="w-full text-left"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">
                                  {formatTime(group.startTime)} — {formatTime(group.endTime)}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {group.label || 'General availability'} · Capacity {group.capacity || 1}
                                  {group.slots.length > 1 ? ` · ${group.slots.length} blocks` : ''}
                                </p>
                              </div>
                              <div className="text-xs font-semibold text-gray-500">
                                {expanded ? 'Hide' : 'Details'}
                              </div>
                            </div>
                          </button>

                          {expanded && (
                            <div className="mt-2 space-y-2">
                              {group.slots.map((slot) => (
                                <div key={slot._id} className="rounded-lg border border-gray-100 bg-white px-3 py-2">
                                  <div className="flex items-start justify-between gap-3">
                                    <button
                                      type="button"
                                      onClick={() => setExpandedSlotId((prev) => (prev === slot._id ? '' : slot._id))}
                                      className="text-left"
                                    >
                                      <p className="text-sm font-semibold text-gray-900">
                                        {formatTime(slot.startTime)} — {formatTime(slot.endTime)}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        {slot.label || 'General availability'} · Capacity {slot.capacity || 1}
                                      </p>
                                    </button>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => openEditForm(slot)}
                                        className="icon-button icon-button--muted"
                                        title="Edit slot"
                                      >
                                        <Edit className="w-4 h-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDelete(slot._id)}
                                        className="icon-button icon-button--muted text-red-500 hover:text-red-600"
                                        title="Delete slot"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                  {expandedSlotId === slot._id && slot.description && (
                                    <p className="mt-2 text-xs text-gray-500">{slot.description}</p>
                                  )}
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

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          onClick={() => openCreateForm(0)}
          className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-5 py-3 text-sm font-semibold text-white shadow-sm hover:brightness-110"
        >
          <Plus className="w-4 h-4" />
          Add Availability Slot
        </button>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Day of week</label>
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
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Capacity</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={formState.capacity}
                    onChange={(e) => handleFormChange('capacity', parseInt(e.target.value, 10) || 1)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">Start time</label>
                  <input
                    type="time"
                    value={formState.startTime}
                    onChange={(e) => handleFormChange('startTime', e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 mb-1 block">End time</label>
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
                  <span>
                    Split into {MEETING_DEFAULT_DURATIONS[formState.meetingType || activeType] || 30}-minute slots when the range is longer.
                  </span>
                </label>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Timezone</label>
                <input
                  type="text"
                  value={formState.timezone}
                  onChange={(e) => handleFormChange('timezone', e.target.value)}
                  list="meeting-availability-timezones"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2"
                />
                <datalist id="meeting-availability-timezones">
                  {timezoneOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-gray-500">Use an IANA timezone (e.g., Africa/Cairo).</p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Label</label>
                <input
                  type="text"
                  value={formState.label}
                  onChange={(e) => handleFormChange('label', e.target.value)}
                  placeholder="Optional short label"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">Description</label>
                <textarea
                  value={formState.description}
                  onChange={(e) => handleFormChange('description', e.target.value)}
                  placeholder="Optional context for this slot"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2"
                  rows={3}
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
                  {saving ? 'Saving…' : formState._id ? 'Update slot' : 'Create slot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <Link2 className="w-5 h-5 text-[#2C736C] mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-900">Default meeting link</p>
                <p className="text-xs text-gray-500">Used in calendar invites and confirmation emails.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <input
                type="url"
                value={meetingLinkValue}
                onChange={(e) => setMeetingLinkValue(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C736C]"
              />
              {meetingLinkStatus.message && (
                <p className={`text-xs ${meetingLinkStatus.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {meetingLinkStatus.message}
                </p>
              )}
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveMeetingLink}
                  disabled={meetingLinkSaving}
                  className="inline-flex items-center gap-2 rounded-full bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60"
                >
                  {meetingLinkSaving ? 'Saving…' : 'Save meeting link'}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <Link2 className="w-5 h-5 text-[#2C736C] mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-900">Public evaluation booking link</p>
                <p className="text-xs text-gray-500">Send this link to new students/guardians to book an evaluation.</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={publicEvaluationLink}
                readOnly
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-500">{publicLinkStatus || 'Tip: paste it into WhatsApp, email, or SMS.'}</p>
                <button
                  type="button"
                  onClick={handleCopyPublicLink}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:border-[#2C736C]"
                >
                  Copy link
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-gray-900">Meetings status</p>
            <p className="mt-1 text-xs text-gray-500">Turn this off to stop all meeting bookings temporarily.</p>
            <div className="mt-3 flex items-center justify-between">
              <div className={`text-sm font-semibold ${meetingsEnabled ? 'text-green-700' : 'text-gray-700'}`}>
                {meetingsEnabled ? 'Available for meetings' : 'Not available'}
              </div>
              <button
                type="button"
                onClick={handleToggleMeetingsEnabled}
                disabled={meetingsEnabledSaving}
                className={`rounded-full px-4 py-2 text-sm font-semibold text-white ${
                  meetingsEnabled
                    ? 'bg-[#2C736C] hover:brightness-110'
                    : 'bg-gray-600 hover:bg-gray-700'
                } disabled:opacity-60`}
              >
                {meetingsEnabledSaving ? 'Saving…' : meetingsEnabled ? 'Disable' : 'Enable'}
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-gray-900">Temporary time off</p>
            <p className="mt-1 text-xs text-gray-500">Blocks booking even if slots exist.</p>

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
