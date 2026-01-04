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
    label: "Delete only this class",
    summary: "Remove just this class instance.",
    confirmTitle: "Delete only this class?",
    confirmBody: "This class will be permanently removed. Future classes stay on the schedule.",
    buttonClass: "flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60",
    summaryClass: "mt-0.5 text-xs font-normal text-gray-500",
    confirmButtonClass: "bg-red-600 hover:bg-red-700 text-white",
  },
  past: {
    label: "Delete previous classes",
    summary: "Remove earlier classes in this series before this date.",
    confirmTitle: "Delete previous classes?",
    confirmBody: "Every class in this series that occurred before the selected start time will be deleted. Upcoming classes remain scheduled.",
    buttonClass: "flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60",
    summaryClass: "mt-0.5 text-xs font-normal text-slate-600",
    confirmButtonClass: "bg-slate-700 hover:bg-slate-800 text-white",
  },
  future: {
    label: "Delete this and future classes",
    summary: "Remove this class and every later one in the series.",
    confirmTitle: "Delete this and future classes?",
    confirmBody: "This class and all future occurrences in this series will be deleted.",
    buttonClass: "flex w-full items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-left text-sm font-medium text-orange-800 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60",
    summaryClass: "mt-0.5 text-xs font-normal text-orange-700",
    confirmButtonClass: "bg-orange-600 hover:bg-orange-700 text-white",
  },
  all: {
    label: "Delete entire series",
    summary: "Remove the template and every class in the series.",
    confirmTitle: "Delete entire series?",
    confirmBody: "The recurring series and all of its classes will be permanently deleted.",
    buttonClass: "flex w-full items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60",
    summaryClass: "mt-0.5 text-xs font-normal text-red-600",
    confirmButtonClass: "bg-red-600 hover:bg-red-700 text-white",
  },
};

const RECURRING_SCOPES = ["single", "past", "future", "all"];

const DeleteClassModal = ({
  isOpen,
  classId,
  initialClass = null,
  onClose,
  onCountdownStart, // New prop to notify parent that countdown has started
}) => {
  const [classData, setClassData] = useState(initialClass);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState("");
  const [selectedScope, setSelectedScope] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const resetFlow = useCallback(() => {
    setSelectedScope(null);
    setIsConfirming(false);
  }, []);

  const handleRequestClose = useCallback(() => {
    resetFlow();
    if (onClose) {
      onClose();
    }
  }, [onClose, resetFlow]);

  const handleScopeSelect = useCallback((scope) => {
    setSelectedScope(scope);
    setIsConfirming(true);
    setError("");
  }, []);

  const cancelConfirm = useCallback(() => {
    setSelectedScope(null);
    setIsConfirming(false);
  }, []);

  const beginCountdown = useCallback(() => {
    if (!selectedScope) return;
    if (!classId) {
      setError('Missing class identifier');
      return;
    }
    const scope = selectedScope;
    
    // Notify parent that countdown has started
    if (onCountdownStart) {
      onCountdownStart(scope, classId);
    }
    
    // Close the modal immediately
    if (onClose) {
      onClose();
    }
  }, [selectedScope, onCountdownStart, onClose, classId]);

  useEffect(() => {
    if (!isOpen) {
      setError("");
      resetFlow();
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
  }, [isOpen, classId, initialClass, resetFlow]);

  const isRecurring = useMemo(
    () => Boolean(classData?.isRecurring || classData?.status === "pattern"),
    [classData]
  );

  const confirmationMeta = selectedScope ? SCOPE_METADATA[selectedScope] : null;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Delete Class</h2>
            {classData?.student?.studentName && (
              <p className="text-sm text-gray-500">
                {classData.student.studentName}
                {classData.subject ? ` • ${classData.subject}` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleRequestClose}
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
                  <p className="font-medium">Scheduled for</p>
                  <p>{formatDisplayDate(classData.scheduledDate) || "Not scheduled"}</p>
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
                  This class is part of a recurring series.
                </div>
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
            {isRecurring ? (
              <div className="space-y-3">
                {RECURRING_SCOPES.map((scope) => {
                  const meta = SCOPE_METADATA[scope];
                  const isActive = selectedScope === scope;
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => handleScopeSelect(scope)}
                      className={`${meta.buttonClass} ${isActive ? "ring-2 ring-offset-1 ring-blue-300" : ""}`}
                    >
                      <div className="flex flex-col">
                        <span>{meta.label}</span>
                        <span className={meta.summaryClass}>{meta.summary}</span>
                      </div>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleRequestClose}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleScopeSelect("single")}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            )}

            {isConfirming && confirmationMeta && (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold">{confirmationMeta.confirmTitle}</p>
                    <p className="mt-1 text-amber-800/90">{confirmationMeta.confirmBody}</p>
                    <p className="mt-2 text-xs text-amber-700">You'll have 5 seconds to undo after confirming.</p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelConfirm}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={beginCountdown}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition ${confirmationMeta.confirmButtonClass}`}
                  >
                    <Trash2 className="h-4 w-4" />
                    Confirm Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeleteClassModal;
