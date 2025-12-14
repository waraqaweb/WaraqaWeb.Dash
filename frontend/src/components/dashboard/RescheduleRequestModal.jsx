import React, { useCallback, useEffect, useMemo, useState } from "react";
import moment from "moment-timezone";
import { Calendar as CalendarIcon, Clock, MapPin, Zap, X } from "lucide-react";
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

const formatDisplay = (value, timezone) => {
  if (!value) return { dateLabel: "", timeLabel: "" };
  const locale = navigator?.language || "en-US";
  const momentObj = moment(value);
  if (timezone) {
    momentObj.tz(timezone);
  }
  return {
    dateLabel: momentObj.locale(locale).format("ddd, DD MMM"),
    timeLabel: momentObj.locale(locale).format("h:mm A"),
  };
};

const SuggestedSlotCard = ({ option, isSelected, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(option)}
    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
      isSelected
        ? "border-emerald-500 bg-emerald-50 shadow"
        : "border-gray-200 bg-white hover:border-emerald-300 hover:bg-emerald-50"
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">{option.user.dateLabel}</p>
        <p className="text-xs text-gray-600">
          {option.user.timeLabel}
          <span className="ml-1 text-[11px] text-gray-400">{option.user.timezone}</span>
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
);

const RescheduleRequestModal = ({
  isOpen,
  classData = null,
  policy = null,
  policyLoading = false,
  onClose,
  onSubmitted,
  userTimezone = DEFAULT_TIMEZONE,
}) => {
  const [availability, setAvailability] = useState(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [slotsError, setSlotsError] = useState("");
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [customDate, setCustomDate] = useState("");
  const [duration, setDuration] = useState(classData?.duration || 60);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const teacherId = classData?.teacher?._id || classData?.teacher;
  const teacherTimezone = availability?.timezone || classData?.timezone || userTimezone || DEFAULT_TIMEZONE;

  useEffect(() => {
    if (!isOpen) {
      setAvailability(null);
      setSelectedSlot(null);
      setCustomDate("");
      setDuration(classData?.duration || 60);
      setNote("");
      setSlotsError("");
      setFormError("");
      return;
    }

    setDuration(classData?.duration || 60);
    if (!teacherId) return;

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
  }, [isOpen, teacherId, classData?.duration]);

  const suggestions = useMemo(() => {
    if (!duration) return [];

    const limit = 8;
    const results = [];
    const guard = moment().add(3, "hours");
    const teacherZone = teacherTimezone || classData?.timezone || DEFAULT_TIMEZONE;

    if (availability?.slots?.length) {
      availability.slots.forEach((slot) => {
        const slotTimezone = slot.timezone || availability.timezone || teacherZone;
        const [startHour, startMinute] = (slot.startTime || "00:00").split(":").map((s) => parseInt(s, 10));
        if (!Number.isFinite(startHour) || !Number.isFinite(startMinute)) return;

        const nowInTz = moment().tz(slotTimezone);
        let occurrence = nowInTz.clone().day(slot.dayOfWeek ?? 0);
        if (occurrence.isSameOrBefore(nowInTz)) {
          occurrence = occurrence.add(1, "week");
        }

        let generated = 0;
        while (generated < 3 && results.length < limit) {
          const candidate = occurrence.clone().hour(startHour).minute(startMinute).second(0).millisecond(0);
          if (candidate.isAfter(guard)) {
            const teacherLabel = formatDisplay(candidate, slotTimezone);
            const userMoment = candidate.clone().tz(userTimezone || DEFAULT_TIMEZONE);
            const userLabel = formatDisplay(userMoment, userTimezone || DEFAULT_TIMEZONE);
            results.push({
              id: `${slot._id || `${slot.dayOfWeek}-${slot.startTime}`}-${generated}`,
              iso: candidate.clone().utc().toISOString(),
              duration,
              user: {
                ...userLabel,
                timezone: userTimezone || DEFAULT_TIMEZONE,
              },
              teacher: {
                ...teacherLabel,
                timezone: slotTimezone,
              },
            });
          }
          occurrence = occurrence.add(1, "week");
          generated += 1;
        }
      });
    }

    if (results.length < limit) {
      const base = classData?.scheduledDate
        ? moment(classData.scheduledDate).tz(classData?.timezone || teacherZone)
        : moment().tz(teacherZone).startOf("day").add(10, "hours");

      let dayOffset = classData?.scheduledDate ? 0 : 1;
      while (results.length < limit && dayOffset < 14) {
        const candidate = base.clone().add(dayOffset, "days");
        if (candidate.isAfter(guard)) {
          const teacherLabel = formatDisplay(candidate, teacherZone);
          const userMoment = candidate.clone().tz(userTimezone || DEFAULT_TIMEZONE);
          const userLabel = formatDisplay(userMoment, userTimezone || DEFAULT_TIMEZONE);

          results.push({
            id: `fallback-${candidate.format("YYYYMMDDHHmm")}-${dayOffset}`,
            iso: candidate.clone().utc().toISOString(),
            duration,
            user: {
              ...userLabel,
              timezone: userTimezone || DEFAULT_TIMEZONE,
            },
            teacher: {
              ...teacherLabel,
              timezone: teacherZone,
            },
          });
        }
        dayOffset += 1;
      }
    }

    return results
      .sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())
      .slice(0, limit);
  }, [availability, duration, teacherTimezone, userTimezone, classData?.scheduledDate, classData?.timezone]);

  const policyMessage = useMemo(() => {
    if (!policy) return "";
    if (policy.reasons?.reschedule && !policy.canRequestReschedule) {
      return policy.reasons.reschedule;
    }
    if (policy.withinThreeHours) {
      return "Reschedule requests must be made at least 3 hours before the class start time.";
    }
    return "";
  }, [policy]);

  const handleSlotSelect = useCallback((option) => {
    setSelectedSlot(option);
    setCustomDate(toLocalInputValue(option.iso));
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    if (!classData?._id) {
      setFormError("Missing class reference");
      return;
    }
    if (!policy?.canRequestReschedule) {
      setFormError(policyMessage || "Reschedule request not allowed.");
      return;
    }

    const payload = {
      proposedDate: selectedSlot?.iso || toIsoString(customDate),
      proposedDuration: Number(duration) || classData.duration || 60,
      note: note.trim() || undefined,
    };

    if (!payload.proposedDate) {
      setFormError("Please choose a new date and time for the class.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post(`/classes/${classData._id}/reschedule-request`, payload);
      if (onSubmitted) {
        await onSubmitted(response.data);
      }
      if (onClose) onClose();
    } catch (err) {
      const message = err?.response?.data?.message || "Failed to submit reschedule request";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const stats = policy?.stats;
  const hasPending = policy?.pendingReschedule?.status === "pending";

  const currentScheduleDisplay = formatDisplay(classData?.scheduledDate, classData?.timezone);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Request reschedule</h2>
            <p className="text-sm text-gray-500">
              {classData?.student?.studentName || "Class"}
              {classData?.subject ? ` • ${classData.subject}` : ""}
            </p>
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

        <div className="grid gap-5 px-6 py-5 md:grid-cols-5">
          <div className="md:col-span-3 space-y-4">
            {policyMessage && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {policyMessage}
              </div>
            )}

            {hasPending && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                A reschedule request is already pending approval. You can still submit a new request if plans changed.
              </div>
            )}

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <Clock className="h-4 w-4 text-gray-400" />
                  Choose a new time
                </label>

                {loadingAvailability && (
                  <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 py-6">
                    <LoadingSpinner />
                  </div>
                )}

                {!loadingAvailability && slotsError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {slotsError}
                  </div>
                )}

                {!loadingAvailability && !slotsError && suggestions.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {suggestions.map((option) => (
                      <SuggestedSlotCard
                        key={option.id}
                        option={option}
                        isSelected={selectedSlot?.id === option.id}
                        onSelect={handleSlotSelect}
                      />
                    ))}
                  </div>
                )}

                <div className="mt-4">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Pick a custom time
                  </label>
                  <input
                    type="datetime-local"
                    value={customDate}
                    onChange={(e) => {
                      setCustomDate(e.target.value);
                      setSelectedSlot(null);
                    }}
                    className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Times are shown in your timezone ({userTimezone}). A {policy?.pendingReschedule ? "revision" : "new"} request will go to the admin for approval.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Duration (minutes)</label>
                  <input
                    type="number"
                    min={15}
                    max={180}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Note for the admin (optional)</label>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Share context that helps approve this change"
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={submitting || !policy?.canRequestReschedule}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#2C736C] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#265f59] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Submitting…" : "Submit request"}
                </button>
              </div>
            </form>
          </div>

          <div className="md:col-span-2 space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <CalendarIcon className="h-4 w-4 text-gray-500" />
                Current schedule
              </h3>
              <p className="mt-2 text-sm text-gray-700">
                {currentScheduleDisplay.dateLabel}
                <span className="ml-1 text-gray-500">•</span>
                <span className="ml-1 text-gray-900">{currentScheduleDisplay.timeLabel}</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">Class timezone: {classData?.timezone}</p>
              <p className="mt-1 text-xs text-gray-500">Teacher timezone: {teacherTimezone}</p>
            </div>

            {stats && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Zap className="h-4 w-4" /> Monthly change summary
                </h3>
                <dl className="grid grid-cols-2 gap-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-emerald-700">Classes</dt>
                    <dd className="text-base font-semibold">{stats.totalClasses}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-emerald-700">Your cancellations</dt>
                    <dd className="text-base font-semibold">
                      {stats.guardianCancelled || stats.teacherCancelled || 0}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-emerald-700">Allowed this month</dt>
                    <dd className="text-base font-semibold">
                      {stats.guardianLimit || stats.teacherLimit || 0}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-emerald-700">Pending requests</dt>
                    <dd className="text-base font-semibold">{hasPending ? "1" : "0"}</dd>
                  </div>
                </dl>
              </div>
            )}

            {policyLoading && (
              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
                Checking policy…
              </div>
            )}

            {policy?.pendingReschedule && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                <h3 className="text-sm font-semibold">Pending request details</h3>
                {policy.pendingReschedule.proposedDate && (
                  <p className="mt-1 text-xs text-blue-700">
                    Requested for {formatDisplay(policy.pendingReschedule.proposedDate, classData?.timezone).dateLabel}
                    {" "}
                    {formatDisplay(policy.pendingReschedule.proposedDate, classData?.timezone).timeLabel}
                  </p>
                )}
                {policy.pendingReschedule.note && (
                  <p className="mt-2 text-xs text-blue-700">
                    "{policy.pendingReschedule.note}"
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RescheduleRequestModal;
