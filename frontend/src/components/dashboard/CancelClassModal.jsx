import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calendar as CalendarIcon, Trash2, X } from "lucide-react";
import api from "../../api/axios";
import { DEFAULT_TIMEZONE } from "../../utils/timezoneUtils";
import moment from "moment-timezone";

const formatLabel = (value, timezone) => {
  if (!value) return { dateLabel: "", timeLabel: "" };
  const locale = navigator?.language || "en-US";
  const m = moment(value);
  if (timezone) m.tz(timezone);
  return {
    dateLabel: m.locale(locale).format("ddd, DD MMM"),
    timeLabel: m.locale(locale).format("h:mm A"),
  };
};

const CancelClassModal = ({
  isOpen,
  classData = null,
  policy = null,
  policyLoading = false,
  onClose,
  onCancelled,
  userRole = "guardian",
  userTimezone = DEFAULT_TIMEZONE,
}) => {
  const [reason, setReason] = useState("");
  const [refundIssued, setRefundIssued] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setReason("");
      setRefundIssued(false);
      setFormError("");
      return;
    }
    setFormError("");
    const defaultReason =
      userRole === "teacher"
        ? "Teacher is unavailable"
        : userRole === "guardian"
          ? "Student unavailable"
          : "Admin decision";
    setReason(defaultReason);
  }, [isOpen, userRole]);

  const policyMessage = useMemo(() => {
    if (!policy) return "";
    if (userRole === "admin") return "";
    if (!policy.canCancel && policy.reasons?.cancel) {
      return policy.reasons.cancel;
    }
    return "";
  }, [policy, userRole]);

  const limitDetails = useMemo(() => {
    const formatLimit = (limit) => (limit && limit > 0 ? limit : "No limit");

    if (policy?.limitStatus) {
      const { guardian, teacherCancel, teacherReschedule } = policy.limitStatus;
      return {
        guardian: {
          count: guardian?.used ?? 0,
          limit: formatLimit(guardian?.limit),
          exceeded: Boolean(guardian?.exceeded),
        },
        teacherCancel: {
          count: teacherCancel?.used ?? 0,
          limit: formatLimit(teacherCancel?.limit),
          exceeded: Boolean(teacherCancel?.exceeded),
        },
        teacherReschedule: {
          count: teacherReschedule?.used ?? 0,
          limit: formatLimit(teacherReschedule?.limit),
          exceeded: Boolean(teacherReschedule?.exceeded),
        },
      };
    }

    if (!policy?.stats) return null;

    const {
      guardianCancelled = 0,
      guardianLimit = 0,
      teacherCancelled = 0,
      teacherRescheduled = 0,
      teacherLimit = 0,
    } = policy.stats;

    return {
      guardian: {
        count: guardianCancelled,
        limit: formatLimit(guardianLimit),
        exceeded: guardianLimit > 0 && guardianCancelled >= guardianLimit,
      },
      teacherCancel: {
        count: teacherCancelled,
        limit: formatLimit(teacherLimit),
        exceeded: teacherLimit > 0 && teacherCancelled >= teacherLimit,
      },
      teacherReschedule: {
        count: teacherRescheduled,
        limit: formatLimit(teacherLimit),
        exceeded: teacherLimit > 0 && teacherRescheduled >= teacherLimit,
      },
    };
  }, [policy]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError("");
    if (!classData?._id) {
      setFormError("Missing class reference");
      return;
    }
    if (!reason.trim()) {
      setFormError("Please share a reason for cancelling the class.");
      return;
    }
    if (!policy?.canCancel && userRole !== "admin") {
      setFormError(policyMessage || "You are not allowed to cancel this class.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        reason: reason.trim(),
      };
      if (userRole === "admin") {
        payload.refundIssued = Boolean(refundIssued);
      }
      const response = await api.post(`/classes/${classData._id}/cancel`, payload);
      if (onCancelled) {
        await onCancelled(response.data);
      }
      if (onClose) onClose();
    } catch (err) {
      const message = err?.response?.data?.message || "Failed to cancel class";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const stats = policy?.stats;
  const currentSchedule = formatLabel(classData?.scheduledDate, classData?.timezone);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-red-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Cancel class</h2>
              <p className="text-sm text-gray-500">
                {classData?.student?.studentName || "Class"}
                {classData?.subject ? ` • ${classData.subject}` : ""}
              </p>
            </div>
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

            {formError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                  What happened?
                </label>
                <textarea
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Share a short note explaining why the class needs to be cancelled"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
                />
                <p className="mt-1 text-xs text-gray-500">
                  This note will be stored with the class record and visible to admins.
                </p>
              </div>

              {userRole === "admin" && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={refundIssued}
                    onChange={(e) => setRefundIssued(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-red-500 focus:ring-red-400"
                  />
                  Mark refund issued for this class
                </label>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
                >
                  Keep class
                </button>
                <button
                  type="submit"
                  disabled={submitting || !policy?.canCancel}
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Cancelling…" : "Confirm cancellation"}
                </button>
              </div>
            </form>
          </div>

          <div className="md:col-span-2 space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <CalendarIcon className="h-4 w-4 text-gray-500" />
                Scheduled time
              </h3>
              <p className="mt-2 text-sm text-gray-700">
                {currentSchedule.dateLabel}
                <span className="ml-1 text-gray-500">•</span>
                <span className="ml-1 text-gray-900">{currentSchedule.timeLabel}</span>
              </p>
              <p className="mt-1 text-xs text-gray-500">Class timezone: {classData?.timezone}</p>
              <p className="mt-1 text-xs text-gray-500">Your timezone: {userTimezone}</p>
            </div>

            {policyLoading && (
              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
                Checking policy…
              </div>
            )}

            {stats && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <h3 className="text-sm font-semibold">Monthly change summary</h3>
                <dl className="mt-2 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <dt>Total classes</dt>
                    <dd className="font-semibold text-amber-900">{stats.totalClasses}</dd>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt>Guardian cancellations</dt>
                    <dd className="flex items-center gap-2 font-semibold text-amber-900">
                      <span>{limitDetails?.guardian.count ?? 0}</span>
                      <span className="text-[11px] text-amber-700">/ {limitDetails?.guardian.limit ?? "No limit"}</span>
                      {limitDetails?.guardian.exceeded && (
                        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                          Limit reached
                        </span>
                      )}
                    </dd>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt>Teacher cancellations</dt>
                    <dd className="flex items-center gap-2 font-semibold text-amber-900">
                      <span>{limitDetails?.teacherCancel.count ?? 0}</span>
                      <span className="text-[11px] text-amber-700">/ {limitDetails?.teacherCancel.limit ?? "No limit"}</span>
                      {limitDetails?.teacherCancel.exceeded && (
                        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                          Limit reached
                        </span>
                      )}
                    </dd>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <dt>Teacher reschedules</dt>
                    <dd className="flex items-center gap-2 font-semibold text-amber-900">
                      <span>{limitDetails?.teacherReschedule.count ?? 0}</span>
                      <span className="text-[11px] text-amber-700">/ {limitDetails?.teacherReschedule.limit ?? "No limit"}</span>
                      {limitDetails?.teacherReschedule.exceeded && (
                        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                          Limit reached
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>

                {userRole === "admin" && (
                  <p className="mt-3 text-[11px] text-amber-700">
                    Limits apply to the teacher and guardian only; admins can still cancel when needed while staying aware of
                    each party&rsquo;s monthly usage.
                  </p>
                )}
              </div>
            )}

            {policy?.pendingReschedule && (
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800">
                There is a pending reschedule request for this class.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CancelClassModal;
