import React, { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Clock, MapPin, User as UserIcon, X } from "lucide-react";
import moment from "moment-timezone";
import api from "../../api/axios";
import LoadingSpinner from "../ui/LoadingSpinner";
import { DEFAULT_TIMEZONE } from "../../utils/timezoneUtils";

const toLocalInputValue = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  const tzOffset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - tzOffset * 60000);
  return local.toISOString().slice(0, 16);
};

const toIsoString = (localValue) => {
  if (!localValue) return "";
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
};

const formatDisplayDate = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  // DD MMM YYYY • HH:MM (keep local time)
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = String(date.getDate()).padStart(2, '0');
  const m = MONTHS_SHORT[date.getMonth()];
  const y = date.getFullYear();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${d} ${m} ${y} • ${time}`;
};

const formatSlotLabels = (value, timezone) => {
  if (!value) return { dateLabel: "", timeLabel: "" };
  const locale = typeof navigator !== "undefined" && navigator.language ? navigator.language : "en-US";
  const m = moment(value);
  if (timezone) {
    m.tz(timezone);
  }
  return {
    dateLabel: m.locale(locale).format("ddd, DD MMM"),
    timeLabel: m.locale(locale).format("h:mm A"),
  };
};

const RescheduleClassModal = ({
  isOpen,
  classId,
  initialClass = null,
  onClose,
  onRescheduled,
}) => {
  const [classData, setClassData] = useState(initialClass);
  const [form, setForm] = useState({ newDate: "", reason: "" });
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [presetApplied, setPresetApplied] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(null);

  const teacherId = classData?.teacher?._id || classData?.teacher;
  const durationMinutes = classData?.duration || 60;
  const adminTimezone = classData?.__meta?.userTimezone || DEFAULT_TIMEZONE;
  const teacherTimezone = availability?.timezone || classData?.timezone || DEFAULT_TIMEZONE;

  useEffect(() => {
    if (!isOpen) {
      setError("");
      setPresetApplied(false);
      setAvailability(null);
      setSelectedSlot(null);
      setSlotsError("");
      setLoadingAvailability(false);
      return;
    }

    setClassData(initialClass || null);

    if (!initialClass && classId) {
      setFetching(true);
      api
        .get(`/classes/${classId}`)
        .then((res) => {
          setClassData(res.data?.class || null);
        })
        .catch((err) => {
          const message = err?.response?.data?.message || "Failed to load class details";
          setError(message);
        })
        .finally(() => setFetching(false));
    }
  }, [isOpen, classId, initialClass]);

  useEffect(() => {
    if (!isOpen) return;
    if (!teacherId) {
      setAvailability(null);
      return;
    }

    setLoadingAvailability(true);
    setSlotsError("");

    api
      .get(`/availability/slots/${teacherId}`)
      .then((res) => {
        setAvailability(res.data || null);
      })
      .catch((err) => {
        const message = err?.response?.data?.message || "Failed to load availability";
        setSlotsError(message);
      })
      .finally(() => setLoadingAvailability(false));
  }, [isOpen, teacherId]);

  useEffect(() => {
    if (!isOpen) return;
    if (!classData) return;
    if (presetApplied) return;

    setForm({
      newDate: toLocalInputValue(classData.scheduledDate),
      reason: "",
    });
    setPresetApplied(true);
  }, [isOpen, classData, presetApplied]);

  const suggestions = useMemo(() => {
    if (!durationMinutes) return [];

    const guard = moment().add(3, "hours");
    const limit = 8;
    const slots = [];
    const teacherZone = teacherTimezone || classData?.timezone || DEFAULT_TIMEZONE;

    if (availability?.slots?.length) {
      availability.slots.forEach((slot) => {
        const slotTimezone = slot.timezone || availability.timezone || teacherZone;
        const startTime = slot.startTime || "00:00";
        const [hourStr, minuteStr] = startTime.split(":");
        const hour = Number.parseInt(hourStr, 10);
        const minute = Number.parseInt(minuteStr, 10);
        if (!Number.isFinite(hour) || !Number.isFinite(minute)) return;

        const nowInSlotTz = moment().tz(slotTimezone);
        let occurrence = nowInSlotTz.clone().day(slot.dayOfWeek ?? 0);
        if (occurrence.isSameOrBefore(nowInSlotTz)) {
          occurrence = occurrence.add(1, "week");
        }

        let generated = 0;
        while (generated < 3 && slots.length < limit) {
          const candidate = occurrence
            .clone()
            .hour(hour)
            .minute(minute)
            .second(0)
            .millisecond(0);

          if (candidate.isAfter(guard)) {
            const teacherLabel = formatSlotLabels(candidate, slotTimezone);
            const adminMoment = candidate.clone().tz(adminTimezone || DEFAULT_TIMEZONE);
            const adminLabel = formatSlotLabels(adminMoment, adminTimezone || DEFAULT_TIMEZONE);

            slots.push({
              id: `${slot._id || `${slot.dayOfWeek}-${startTime}`}-${generated}`,
              iso: candidate.clone().utc().toISOString(),
              duration: durationMinutes,
              teacher: { ...teacherLabel, timezone: slotTimezone },
              admin: { ...adminLabel, timezone: adminTimezone || DEFAULT_TIMEZONE },
            });
          }

          occurrence = occurrence.add(1, "week");
          generated += 1;
        }
      });
    }

    if (slots.length < limit) {
      const base = classData?.scheduledDate
        ? moment(classData.scheduledDate).tz(classData?.timezone || teacherZone)
        : moment().tz(teacherZone).startOf("day").add(10, "hours");

      let dayOffset = classData?.scheduledDate ? 0 : 1;
      while (slots.length < limit && dayOffset < 14) {
        const candidate = base.clone().add(dayOffset, "days");

        if (candidate.isAfter(guard)) {
          const teacherLabel = formatSlotLabels(candidate, teacherZone);
          const adminMoment = candidate.clone().tz(adminTimezone || DEFAULT_TIMEZONE);
          const adminLabel = formatSlotLabels(adminMoment, adminTimezone || DEFAULT_TIMEZONE);

          slots.push({
            id: `fallback-${candidate.format("YYYYMMDDHHmm")}-${dayOffset}`,
            iso: candidate.clone().utc().toISOString(),
            duration: durationMinutes,
            teacher: { ...teacherLabel, timezone: teacherZone },
            admin: { ...adminLabel, timezone: adminTimezone || DEFAULT_TIMEZONE },
          });
        }

        dayOffset += 1;
      }
    }

    return slots
      .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())
      .slice(0, limit);
  }, [availability, durationMinutes, adminTimezone, teacherTimezone, classData?.scheduledDate, classData?.timezone]);

  const isRecurring = useMemo(() => Boolean(classData?.isRecurring || classData?.status === "pattern"), [classData]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!classId) {
      setError("Missing class identifier");
      return;
    }
    if (!form.newDate || !form.reason.trim()) {
      setError("Please provide both the new date/time and a reason for rescheduling.");
      return;
    }

    const payload = {
      newDate: toIsoString(form.newDate),
      reason: form.reason.trim(),
    };

    if (!payload.newDate) {
      setError("Invalid date selected");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await api.put(`/classes/${classId}/reschedule`, payload);
      if (onRescheduled) {
        await onRescheduled(res.data);
      }
      if (onClose) {
        onClose();
      }
    } catch (err) {
      const message = err?.response?.data?.message || "Failed to reschedule class";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "newDate") {
      setSelectedSlot(null);
    }
  };

  const handleSlotSelect = (option) => {
    setSelectedSlot(option);
    setForm((prev) => ({ ...prev, newDate: toLocalInputValue(option.iso) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Reschedule Class</h2>
            {classData?.student?.studentName && (
              <p className="text-sm text-gray-500">
                {classData.student.studentName}
                {classData.subject ? ` • ${classData.subject}` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {fetching && (
            <div className="flex items-center justify-center py-6">
              <LoadingSpinner />
            </div>
          )}

          {!fetching && classData && (
            <div className="mb-5 space-y-3 rounded-xl bg-gray-50 p-4">
              <div className="flex items-start gap-3 text-sm text-gray-700">
                <CalendarIcon className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="font-medium">Current schedule</p>
                  <p>{formatDisplayDate(classData.scheduledDate) || "Not scheduled"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-700">
                <Clock className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="font-medium">Duration</p>
                  <p>{classData.duration ? `${classData.duration} minutes` : "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-700">
                <UserIcon className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="font-medium">Teacher</p>
                  <p>
                    {classData.teacher?.firstName || classData.teacher?.lastName
                      ? `${classData.teacher?.firstName || ""} ${classData.teacher?.lastName || ""}`.trim()
                      : "Not assigned"}
                  </p>
                </div>
              </div>
              {isRecurring && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  This class is part of a recurring series. Only this occurrence will be rescheduled.
                </div>
              )}
            </div>
          )}

          {!fetching && !classData && (
            <p className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              Unable to load class details. You can still enter the new schedule below.
            </p>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                <Clock className="h-4 w-4 text-gray-400" /> Pick a new time *
              </label>

              {loadingAvailability && (
                <div className="mb-3 flex items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 py-4">
                  <LoadingSpinner />
                </div>
              )}

              {!loadingAvailability && slotsError && (
                <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {slotsError}
                </div>
              )}

              {!loadingAvailability && !slotsError && suggestions.length > 0 && (
                <div className="mb-3 grid gap-2 sm:grid-cols-2">
                  {suggestions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleSlotSelect(option)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                        selectedSlot?.id === option.id
                          ? "border-emerald-500 bg-emerald-50 shadow"
                          : "border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{option.admin.dateLabel}</p>
                          <p className="text-xs text-gray-600">
                            {option.admin.timeLabel}
                            <span className="ml-1 text-[11px] text-gray-400">{option.admin.timezone}</span>
                          </p>
                        </div>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                          {option.duration} min
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>
                          Teacher time:
                          <span className="ml-1 font-medium text-gray-700">
                            {option.teacher.dateLabel} • {option.teacher.timeLabel}
                          </span>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <input
                type="datetime-local"
                value={form.newDate}
                onChange={handleChange("newDate")}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                Times are shown in your timezone ({adminTimezone}). Teacher timezone: {teacherTimezone}.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Reason *</label>
              <textarea
                rows={3}
                value={form.reason}
                onChange={handleChange("reason")}
                placeholder="Share a brief reason for the change"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#265f59] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Rescheduling…" : "Confirm reschedule"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RescheduleClassModal;
