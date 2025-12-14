import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import LoadingSpinner from '../ui/LoadingSpinner';
import { MEETING_TYPES, MEETING_TYPE_LABELS } from '../../constants/meetingConstants';
import { fetchMeetingAvailability, bookMeeting } from '../../api/meetings';
import { useAuth } from '../../contexts/AuthContext';
import { getBrowserTimezone, getPrioritizedMeetingTimezones } from '../../utils/timezone';
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
    timeZone: timezone
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


const TeacherSyncModal = ({ open, onClose, onBooked }) => {
  const { user } = useAuth();
  const baseTimezone = user?.timezone || getBrowserTimezone();
  const [timezone, setTimezone] = useState(baseTimezone);
  const [calendarPreference, setCalendarPreference] = useState(() => getStoredCalendarPreference());
  const [studentsNotes, setStudentsNotes] = useState('');
  const [agenda, setAgenda] = useState('');
  const [availability, setAvailability] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const timezoneChoices = useMemo(
    () => getPrioritizedMeetingTimezones(timezone || baseTimezone),
    [timezone, baseTimezone]
  );

  const loadAvailability = useCallback(async (tz) => {
    if (!open) return;
    setLoadingSlots(true);
    setError(null);
    try {
      const start = new Date();
      const end = addDays(start, 30);
      const windows = await fetchMeetingAvailability({
        meetingType: MEETING_TYPES.TEACHER_SYNC,
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setTimezone(baseTimezone);
    setStudentsNotes('');
    setAgenda('');
    setSelectedSlotId(null);
    setCalendarPreference(getStoredCalendarPreference());
  }, [open, baseTimezone]);

  useEffect(() => {
    if (!open) return;
    loadAvailability(timezone);
  }, [timezone, open, loadAvailability]);

  const groupedSlots = useMemo(() => {
    return availability.reduce((acc, slot) => {
      const slotDate = new Date(slot.start);
      const key = formatDayKey(slotDate, timezone);
      if (!acc[key]) {
        acc[key] = { title: formatDay(slotDate, timezone), slots: [] };
      }
      acc[key].slots.push(slot);
      return acc;
    }, {});
  }, [availability, timezone]);

  const handleBook = async () => {
    if (!selectedSlotId) {
      setError('Pick a time for the sync');
      return;
    }
    const slot = availability.find((item) => item.startUtc === selectedSlotId);
    if (!slot) {
      setError('Slot expired. Please refresh.');
      return;
    }
    const studentEntries = studentsNotes
      .split(/\n|,/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((name) => ({ studentName: name, isExistingStudent: true }));

    setSubmitting(true);
    setError(null);
    try {
      const preference = calendarPreference || getStoredCalendarPreference();
      const payload = {
        meetingType: MEETING_TYPES.TEACHER_SYNC,
        startTime: slot.startUtc || slot.start,
        timezone: 'UTC',
        teacher: {
          teacherId: user?._id,
          teacherName: user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim(),
          calendarPreference: preference,
        },
        students: studentEntries,
        notes: agenda,
        calendarPreference: preference,
      };
      const response = await bookMeeting(payload);
      downloadIcsFile(response?.calendar?.icsContent, 'teacher-sync.ics');
      if (onBooked) onBooked(response);
      onClose?.();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.message || err.message || 'Unable to book sync');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose?.();
      }}
      size="xl"
      title="Book a Teacher Sync"
      footer={(
        <>
          <button
            type="button"
            onClick={() => !submitting && onClose?.()}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleBook}
            className={`rounded-full px-5 py-2 text-sm font-semibold text-white ${
              submitting ? 'bg-slate-400' : 'bg-[#2C736C] hover:bg-[#245b56]'
            }`}
            disabled={submitting}
          >
            {submitting ? 'Booking...' : 'Book sync'}
          </button>
        </>
      )}
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-600">
          {MEETING_TYPE_LABELS[MEETING_TYPES.TEACHER_SYNC]} sessions run 30 minutes. Use this time to review tricky cases, ask for
          additional resources, or align on pacing. We keep the admin calendar highlighted in yellow for these syncs.
        </p>

        <div className="grid gap-3 md:grid-cols-2">
          <Input
            label="Agenda"
            placeholder="Share progress blockers, parent updates, needs..."
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
          />
          <label className="inline-flex w-full flex-col gap-1 text-xs font-medium text-slate-600">
            Students you'd like to discuss
            <textarea
              className="w-full rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm outline-none focus:border-[#2C736C] focus:ring-2 focus:ring-[#2C736C]/20"
              rows={3}
              placeholder="One name per line"
              value={studentsNotes}
              onChange={(e) => setStudentsNotes(e.target.value)}
            />
          </label>
        </div>

        <label className="inline-flex w-full flex-col gap-1 text-xs font-medium text-slate-600">
          Your timezone
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm outline-none focus:border-[#2C736C] focus:ring-2 focus:ring-[#2C736C]/20"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {timezoneChoices.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="inline-flex w-full flex-col gap-1 text-xs font-medium text-slate-600">
          Preferred calendar
          <select
            className="w-full rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm outline-none focus:border-[#2C736C] focus:ring-2 focus:ring-[#2C736C]/20"
            value={calendarPreference}
            onChange={(e) => {
              setCalendarPreference(e.target.value);
              storeCalendarPreference(e.target.value);
            }}
          >
            {CALENDAR_PREFERENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <span className="text-[11px] text-slate-500">We'll open this calendar automatically after you book.</span>
        </label>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <CalendarDays className="h-5 w-5" /> Available blocks
            </div>
            <button
              type="button"
              onClick={() => loadAvailability(timezone)}
              className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-semibold text-amber-800"
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
          </div>

          {loadingSlots && (
            <div className="mt-4 flex items-center justify-center rounded-2xl bg-white/60 py-8">
              <LoadingSpinner />
            </div>
          )}

          {error && !loadingSlots && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          )}

          {!loadingSlots && availability.length === 0 && !error && (
            <p className="mt-4 text-sm text-amber-900">No sync blocks are open right now. Ping the admin team if you need one urgently.</p>
          )}

          <div className="mt-4 space-y-3">
            {Object.entries(groupedSlots).map(([dayKey, group]) => (
              <div key={dayKey} className="rounded-xl border border-amber-100 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">{group.title}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {group.slots.map((slot) => (
                    <button
                      type="button"
                      key={slot.startUtc}
                      onClick={() => setSelectedSlotId(slot.startUtc)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold ${
                        selectedSlotId === slot.startUtc
                          ? 'bg-[#2C736C] text-white'
                          : 'bg-amber-50 text-amber-900 hover:bg-amber-100'
                      }`}
                    >
                      {formatTime(new Date(slot.start), timezone)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default TeacherSyncModal;
