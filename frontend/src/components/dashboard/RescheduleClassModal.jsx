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
    if (!teacherId) return;

    const handler = () => {
      setLoadingAvailability(true);
      setSlotsError("");
      api
        .get(`/availability/slots/${teacherId}`)
        .then((res) => setAvailability(res.data || null))
        .catch((err) => {
          const message = err?.response?.data?.message || "Failed to load availability";
          setSlotsError(message);
        })
        .finally(() => setLoadingAvailability(false));
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('availability:refresh', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('availability:refresh', handler);
      }
    };
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

  const handleClose = () => {
    if (submitting) return;
    onClose?.();
  };

  const inputClassName = "w-full rounded-xl border border-slate-300 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-700 shadow-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-3 py-4 sm:px-4 sm:py-6">
      <div className="relative flex w-full max-w-4xl max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[28px] bg-gradient-to-b from-white to-slate-50 shadow-2xl sm:max-h-[calc(100vh-3rem)]">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur sm:px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 sm:text-xl">Reschedule Class</h2>
            {classData?.student?.studentName && (
              <p className="text-sm text-slate-500">
                {classData.student.studentName}
                {classData.subject ? ` • ${classData.subject}` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {fetching && (
            <div className="flex items-center justify-center py-6">
              <LoadingSpinner />
            </div>
          )}

          {!fetching && classData && (
            <div className="mb-5 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:grid-cols-3">
              <div className="flex items-start gap-3 rounded-xl bg-white/80 px-3 py-3 text-sm text-slate-700">
                <CalendarIcon className="mt-0.5 h-4 w-4 text-slate-500" />
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">Current</p>
                  <p className="truncate">{formatDisplayDate(classData.scheduledDate) || "Not scheduled"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-white/80 px-3 py-3 text-sm text-slate-700">
                <Clock className="mt-0.5 h-4 w-4 text-slate-500" />
                <div>
                  <p className="font-medium text-slate-800">Duration</p>
                  <p>{classData.duration ? `${classData.duration} minutes` : "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-white/80 px-3 py-3 text-sm text-slate-700">
                <UserIcon className="mt-0.5 h-4 w-4 text-slate-500" />
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">Teacher</p>
                  <p>
                    {classData.teacher?.firstName || classData.teacher?.lastName
                      ? `${classData.teacher?.firstName || ""} ${classData.teacher?.lastName || ""}`.trim()
                      : "Not assigned"}
                  </p>
                </div>
              </div>
              {isRecurring && (
                <div className="sm:col-span-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
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

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Clock className="h-4 w-4 text-slate-400" /> Choose a new time
                </label>
                <p className="text-xs text-slate-500">Shown in your timezone ({adminTimezone})</p>
              </div>

              {!loadingAvailability && !slotsError && suggestions.length > 0 && (
                <div className="mb-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Suggested slots</p>
                    <p className="text-xs text-slate-500">Tap one to fill the date automatically</p>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-2 sm:max-h-72">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {suggestions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => handleSlotSelect(option)}
                          className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                            selectedSlot?.id === option.id
                              ? "border-emerald-400 bg-emerald-50 shadow-sm"
                              : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/60"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">{option.admin.dateLabel}</p>
                              <p className="text-xs text-slate-600">
                                {option.admin.timeLabel}
                                <span className="ml-1 text-[11px] text-slate-400">{option.admin.timezone}</span>
                              </p>
                            </div>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {option.duration} min
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                            <MapPin className="h-3.5 w-3.5" />
                            <span className="truncate">
                              Teacher: <span className="font-medium text-slate-700">{option.teacher.dateLabel} • {option.teacher.timeLabel}</span>
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-emerald-600">New date &amp; time</label>
                  <input
                    type="datetime-local"
                    value={form.newDate}
                    onChange={handleChange("newDate")}
                    className={inputClassName}
                    required
                  />
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-500">
                  <p className="font-semibold uppercase tracking-wide text-slate-400">Timezone guide</p>
                  <p className="mt-1 leading-5">Teacher timezone: <span className="font-medium text-slate-700">{teacherTimezone}</span></p>
                  <p className="leading-5">Your picks are saved in <span className="font-medium text-slate-700">{adminTimezone}</span>.</p>
                </div>
              </div>

              {loadingAvailability && (
                <div className="mt-4 flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-4">
                  <LoadingSpinner />
                </div>
              )}

              {!loadingAvailability && slotsError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {slotsError}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-emerald-600">Reason</label>
              <textarea
                rows={3}
                value={form.reason}
                onChange={handleChange("reason")}
                placeholder="Share a brief reason for the change"
                className={`${inputClassName} min-h-[92px] resize-y`}
                required
              />
              <p className="mt-2 text-xs text-slate-500">Keep it short and clear so the update is easy to review.</p>
            </div>

            <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-xl bg-[#2C736C] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#265f59] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Rescheduling…" : "Confirm reschedule"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RescheduleClassModal;
