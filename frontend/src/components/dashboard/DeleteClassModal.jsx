import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calendar as CalendarIcon, Trash2, User as UserIcon, X } from "lucide-react";
import LoadingSpinner from "../ui/LoadingSpinner";
import { formatDateDDMMMYYYY } from "../../utils/date";

const formatDisplayDate = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  const datePart = formatDateDDMMMYYYY(date);
  const timePart = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${datePart} • ${timePart}`;
};

const SCOPE_METADATA = {
  single: {
    label: "This class",
    summary: "Just this session.",
    buttonClass: "flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60",
    summaryClass: "mt-0.5 text-xs font-normal text-emerald-700",
  },
  past: {
    label: "Previous classes",
    summary: "Only earlier ones.",
    buttonClass: "flex w-full items-center justify-between rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-left text-sm font-semibold text-orange-900 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60",
    summaryClass: "mt-0.5 text-xs font-normal text-orange-700",
  },
  future: {
    label: "Future classes",
    summary: "This and later ones.",
    buttonClass: "flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60",
    summaryClass: "mt-0.5 text-xs font-normal text-amber-700",
  },
  all: {
    label: "Entire series",
    summary: "Everything in the series.",
    buttonClass: "flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-semibold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60",
    summaryClass: "mt-0.5 text-xs font-normal text-slate-600",
  },
};

const DeleteClassModal = ({
  isOpen,
  classId,
  initialClass = null,
  currentTab = 'upcoming',
  onClose,
  onCountdownStart, // New prop to notify parent that countdown has started
}) => {
  const [classData, setClassData] = useState(initialClass);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const handleRequestClose = useCallback(() => {
    if (onClose) {
      onClose();
    }
  }, [onClose]);

  const handleScopeSelect = useCallback((scope) => {
    setError("");
    if (!classId) {
      setError('Missing class identifier');
      return;
    }
    const targetScope = scope;
    
    // Notify parent that countdown has started
    if (onCountdownStart) {
      onCountdownStart(targetScope, classId);
    }
    
    // Close the modal immediately
    if (onClose) {
      onClose();
    }
  }, [onCountdownStart, onClose, classId]);

  useEffect(() => {
    if (!isOpen) {
      setError("");
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

  const isRecurring = useMemo(
    () => Boolean(classData?.isRecurring || classData?.status === "pattern"),
    [classData]
  );

  if (!isOpen) {
    return null;
  }

  const showFuture = currentTab === 'upcoming';
  const showPast = currentTab === 'previous';
  const showBothSecondary = !showFuture && !showPast;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Delete class</h2>
            {classData?.student?.studentName && (
              <p className="text-sm text-slate-500">
                {classData.student.studentName}
                {classData.subject ? ` • ${classData.subject}` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
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
            <div className="mb-5 space-y-4">
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <CalendarIcon className="mt-0.5 h-4 w-4 text-emerald-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Scheduled</p>
                  <p className="text-sm font-medium text-slate-800">{formatDisplayDate(classData.scheduledDate) || "Not scheduled"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm text-slate-700">
                <UserIcon className="mt-0.5 h-4 w-4 text-emerald-500" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Teacher</p>
                  <p className="text-sm font-medium text-slate-800">
                    {classData.teacher?.firstName || classData.teacher?.lastName
                      ? `${classData.teacher?.firstName || ""} ${classData.teacher?.lastName || ""}`.trim()
                      : "Not assigned"}
                  </p>
                </div>
              </div>
              {isRecurring && (
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-500">
                  This class is part of a recurring series.
                </p>
              )}
            </div>
          )}

          {!fetching && !classData && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
              <p>Unable to load class details. You can still proceed with deletion below.</p>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div className="space-y-4">
              {isRecurring ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => handleScopeSelect('single')}
                    className={SCOPE_METADATA.single.buttonClass}
                  >
                    <div>
                      <p>{SCOPE_METADATA.single.label}</p>
                      <p className={SCOPE_METADATA.single.summaryClass}>{SCOPE_METADATA.single.summary}</p>
                    </div>
                    <Trash2 className="h-4 w-4" />
                  </button>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {(showPast || showBothSecondary) && (
                      <button
                        type="button"
                        onClick={() => handleScopeSelect('past')}
                        className={SCOPE_METADATA.past.buttonClass}
                      >
                        <div>
                          <p>{SCOPE_METADATA.past.label}</p>
                          <p className={SCOPE_METADATA.past.summaryClass}>{SCOPE_METADATA.past.summary}</p>
                        </div>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}

                    {(showFuture || showBothSecondary) && (
                      <button
                        type="button"
                        onClick={() => handleScopeSelect('future')}
                        className={SCOPE_METADATA.future.buttonClass}
                      >
                        <div>
                          <p>{SCOPE_METADATA.future.label}</p>
                          <p className={SCOPE_METADATA.future.summaryClass}>{SCOPE_METADATA.future.summary}</p>
                        </div>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleScopeSelect('all')}
                      className={SCOPE_METADATA.all.buttonClass}
                    >
                      <div>
                        <p>{SCOPE_METADATA.all.label}</p>
                        <p className={SCOPE_METADATA.all.summaryClass}>{SCOPE_METADATA.all.summary}</p>
                      </div>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => handleScopeSelect('single')}
                    className={SCOPE_METADATA.single.buttonClass}
                  >
                    <div>
                      <p>{SCOPE_METADATA.single.label}</p>
                      <p className={SCOPE_METADATA.single.summaryClass}>{SCOPE_METADATA.single.summary}</p>
                    </div>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteClassModal;
