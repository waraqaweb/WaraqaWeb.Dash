import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, RefreshCw } from 'lucide-react';
import Modal from '../ui/Modal';
import Select from '../ui/Select';
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


const GuardianFollowUpModal = ({ open, onClose, students = [], onBooked }) => {
  const { user } = useAuth();
  const detectedTimezone = user?.timezone || getBrowserTimezone();
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [calendarPreference, setCalendarPreference] = useState(() => getStoredCalendarPreference());
  const [notes, setNotes] = useState('');
  const [availability, setAvailability] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const timezoneChoices = useMemo(
    () => getPrioritizedMeetingTimezones(timezone || detectedTimezone),
    [timezone, detectedTimezone]
  );

  const studentOptions = useMemo(() => {
    if (!Array.isArray(students)) return [];
    return students.map((student) => {
      const id = student._id || student.id || student.studentId;
      const name = student.studentName || [student.firstName, student.lastName].filter(Boolean).join(' ') || 'Student';
      return { id, name };
    });
  }, [students]);

  const selectedStudent = useMemo(
    () => studentOptions.find((student) => student.id === selectedStudentId),
    [studentOptions, selectedStudentId]
  );

  const loadAvailability = useCallback(async (tz) => {
    if (!open) return;
    setLoadingSlots(true);
    setError(null);
    try {
      const start = new Date();
      const end = addDays(start, 21);
      const windows = await fetchMeetingAvailability({
        meetingType: MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP,
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
    setSelectedStudentId(studentOptions[0]?.id || '');
    setTimezone(detectedTimezone);
    setNotes('');
    setSelectedSlotId(null);
     setCalendarPreference(getStoredCalendarPreference());
  }, [open, detectedTimezone, studentOptions]);

  useEffect(() => {
    if (!open) return;
    loadAvailability(timezone);
  }, [timezone, open, loadAvailability]);

  const groupedSlots = useMemo(() => {
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

  const handleBook = async () => {
    if (!selectedStudentId || !selectedSlotId) {
      setError('Select a student and a time slot.');
      return;
    }
    const slot = availability.find((item) => item.startUtc === selectedSlotId);
    if (!slot) {
      setError('Slot is no longer available. Please refresh.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const preference = calendarPreference || getStoredCalendarPreference();
      const payload = {
        meetingType: MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP,
        startTime: slot.startUtc || slot.start,
        timezone: 'UTC',
        guardian: {
          guardianName: user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Guardian',
          guardianEmail: user?.email,
          guardianPhone: user?.phone,
          timezone,
          preferredCalendar: preference,
        },
        calendarPreference: preference,
        students: [
          {
            studentId: selectedStudentId,
            studentName: selectedStudent?.name || 'Student',
            isExistingStudent: true,
            notes,
          },
        ],
        notes,
      };
      const response = await bookMeeting(payload);
      downloadIcsFile(response?.calendar?.icsContent, 'guardian-follow-up.ics');
      if (onBooked) onBooked(response);
      onClose?.();
    } catch (err) {
      console.error(err);
      setError(err?.response?.data?.message || err.message || 'Unable to book follow-up');
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
      title="Schedule Guardian Follow-up"
      size="xl"
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
            {submitting ? 'Booking...' : 'Book follow-up'}
          </button>
        </>
      )}
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-600">
          {MEETING_TYPE_LABELS[MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]} calls are limited to one per student each month. Pick a time
          that fits your family and our admin will send the meeting link instantly.
        </p>

        <Select
          label="Select student"
          value={selectedStudentId}
          onChange={(e) => setSelectedStudentId(e.target.value)}
        >
          {studentOptions.length === 0 && <option value="">No students found</option>}
          {studentOptions.map((student) => (
            <option key={student.id} value={student.id}>{student.name}</option>
          ))}
        </Select>

        <div className="grid gap-3 md:grid-cols-2">
          <Select label="Timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezoneChoices.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <Input
            label="Focus for this call"
            placeholder="Progress check-in, scheduling, homework support..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="md:col-span-2">
            <Select
              label="Calendar preference"
              value={calendarPreference}
              onChange={(e) => {
                setCalendarPreference(e.target.value);
                storeCalendarPreference(e.target.value);
              }}
            >
              {CALENDAR_PREFERENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-500">We will open this calendar automatically after booking.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <CalendarDays className="h-5 w-5" /> Available times
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
            <p className="mt-4 text-sm text-amber-900">No open slots this week. Please message the admin team and we'll add one for you.</p>
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

export default GuardianFollowUpModal;
