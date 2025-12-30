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
  deleteMeetingAvailabilitySlot
} from '../../../api/meetings';
import { getMeetingTimezoneOptions } from '../../../utils/timezone';

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
  const [meetingLinkValue, setMeetingLinkValue] = useState(user?.adminSettings?.meetingLink || '');
  const [meetingLinkStatus, setMeetingLinkStatus] = useState({ type: '', message: '' });
  const [meetingLinkSaving, setMeetingLinkSaving] = useState(false);
  const [publicLinkStatus, setPublicLinkStatus] = useState('');
  const timezoneOptions = useMemo(() => getMeetingTimezoneOptions(), []);

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

  useEffect(() => {
    refreshSlots();
  }, [refreshSlots]);

  const slotsByDay = useMemo(() => {
    const map = Array.from({ length: 7 }, () => []);
    slots.forEach((slot) => {
      const idx = slot.dayOfWeek ?? 0;
      map[idx].push(slot);
    });
    return map.map((list) => list.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  }, [slots]);

  useEffect(() => {
    setMeetingLinkValue(user?.adminSettings?.meetingLink || '');
  }, [user?.adminSettings?.meetingLink]);

  const openCreateForm = (dayIndex = 0) => {
    setFormState(emptyFormState({ meetingType: activeType, dayOfWeek: dayIndex, timezone }));
    setShowForm(true);
  };

  const openEditForm = (slot) => {
    setFormState(emptyFormState({ ...slot }));
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormState(emptyFormState({ timezone }));
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
    const payload = {
      meetingType: formState.meetingType || activeType,
      dayOfWeek: formState.dayOfWeek,
      startTime: formState.startTime,
      endTime: formState.endTime,
      timezone: formState.timezone || timezone,
      label: formState.label || undefined,
      description: formState.description || undefined,
      capacity: Number(formState.capacity) || 1
    };

    try {
      if (formState._id) {
        await updateMeetingAvailabilitySlot(formState._id, payload);
      } else {
        await createMeetingAvailabilitySlot(payload);
      }
      setSaving(false);
      closeForm();
      await refreshSlots({ silent: true });
    } catch (err) {
      console.error('Failed to save meeting availability slot', err);
      setSaving(false);
      setError(err.response?.data?.message || 'Failed to save meeting availability slot');
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

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
        </div>

      <div className="mt-6 flex flex-wrap gap-2">
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
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DAY_NAMES.map((day, index) => {
            const daySlots = slotsByDay[index];
            return (
              <div key={day} className="border border-gray-200 rounded-2xl bg-white p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{day}</p>
                    <p className="text-xs text-gray-500">
                      {daySlots.length ? `${daySlots.length} slot${daySlots.length !== 1 ? 's' : ''}` : 'No slots yet'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreateForm(index)}
                    className="icon-button icon-button--muted"
                    title={`Add slot for ${day}`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {daySlots.length === 0 ? (
                  <p className="text-xs text-gray-400">No bookable windows.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {daySlots.map((slot) => (
                      <div key={slot._id} className="border rounded-xl px-3 py-2 bg-gradient-to-r from-white to-gray-50">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {formatTime(slot.startTime)} — {formatTime(slot.endTime)}
                            </p>
                            <p className="text-xs text-gray-500">
                              {slot.label || 'General availability'} · Capacity {slot.capacity || 1}
                            </p>
                          </div>
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
                        {slot.description && (
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
  );
};

export default MeetingAvailabilityAdminPage;
