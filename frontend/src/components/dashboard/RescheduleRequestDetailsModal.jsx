import React, { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import api from "../../api/axios";
import LoadingSpinner from "../ui/LoadingSpinner";
import { formatDateTimeDDMMMYYYYhhmmA } from "../../utils/date";

const toLocalDateInput = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
};

const parseLocalDayStart = (yyyyMmDd) => {
  if (!yyyyMmDd) return null;
  const d = new Date(`${yyyyMmDd}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const parseLocalDayEnd = (yyyyMmDd) => {
  if (!yyyyMmDd) return null;
  const d = new Date(`${yyyyMmDd}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const formatRoleLabel = (role) => {
  if (!role) return "Unknown";
  return String(role).charAt(0).toUpperCase() + String(role).slice(1);
};

const RoleCounts = ({ title, stats }) => {
  const counts = stats?.countsByRole || {};
  const total = stats?.total || 0;

  const rows = Object.entries(counts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {total === 0 ? (
        <p className="mt-1 text-sm text-gray-600">No requests in this range.</p>
      ) : (
        <div className="mt-2 space-y-1 text-sm text-gray-700">
          <p className="text-gray-600">Total: {total}</p>
          {rows.map(([role, count]) => (
            <p key={role}>
              {formatRoleLabel(role)}: {count}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

const RescheduleRequestDetailsModal = ({
  isOpen,
  notification,
  userTimezone,
  onClose,
  onDecision,
}) => {
  const [classData, setClassData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [decisionLoading, setDecisionLoading] = useState(false);

  const [rangeFrom, setRangeFrom] = useState(() => {
    const now = new Date();
    return toLocalDateInput(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  });
  const [rangeTo, setRangeTo] = useState(() => toLocalDateInput(new Date()));

  const [teacherStats, setTeacherStats] = useState(null);
  const [studentStats, setStudentStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const classId = notification?.metadata?.classId || notification?.relatedId;

  const teacherIdFromMeta = notification?.metadata?.teacherId;
  const studentIdFromMeta = notification?.metadata?.studentId;

  const requestorLabel = useMemo(() => {
    const role = notification?.metadata?.requestedByRole;
    const name = notification?.metadata?.requestedByName;
    if (name && role) return `${name} (${formatRoleLabel(role)})`;
    if (name) return name;
    if (role) return formatRoleLabel(role);
    return "—";
  }, [notification]);

  const originalDate = notification?.metadata?.originalDate;
  const proposedDate = notification?.metadata?.proposedDate;
  const proposedDuration = notification?.metadata?.proposedDuration;

  useEffect(() => {
    if (!isOpen) {
      setClassData(null);
      setError("");
      setTeacherStats(null);
      setStudentStats(null);
      return;
    }

    if (!classId) {
      setError("Missing class reference");
      return;
    }

    setLoading(true);
    setError("");
    api
      .get(`/classes/${classId}`)
      .then((res) => {
        setClassData(res.data?.class || null);
      })
      .catch((err) => {
        const message = err?.response?.data?.message || "Failed to load class";
        setError(message);
      })
      .finally(() => setLoading(false));
  }, [isOpen, classId]);

  useEffect(() => {
    if (!isOpen) return;

    const start = parseLocalDayStart(rangeFrom);
    const end = parseLocalDayEnd(rangeTo);
    if (!start || !end || end < start) return;

    const teacherId = teacherIdFromMeta || classData?.teacher?._id;
    const studentId = studentIdFromMeta || classData?.student?.studentId;
    if (!teacherId && !studentId) return;

    setStatsLoading(true);

    const query = (params) => api.get("/classes/reschedule-requests/stats", { params });

    Promise.all([
      teacherId
        ? query({ teacherId, from: start.toISOString(), to: end.toISOString() })
        : Promise.resolve({ data: null }),
      studentId
        ? query({ studentId, from: start.toISOString(), to: end.toISOString() })
        : Promise.resolve({ data: null }),
    ])
      .then(([teacherRes, studentRes]) => {
        setTeacherStats(teacherRes?.data || null);
        setStudentStats(studentRes?.data || null);
      })
      .catch(() => {
        // Keep stats optional; modal should still function.
      })
      .finally(() => setStatsLoading(false));
  }, [isOpen, rangeFrom, rangeTo, teacherIdFromMeta, studentIdFromMeta, classData]);

  const handleDecision = async (decision) => {
    if (!classId) return;
    setDecisionLoading(true);
    try {
      await api.post(`/classes/${classId}/reschedule-request/decision`, { decision });
      if (onDecision) {
        await onDecision(decision);
      }
      if (onClose) onClose();
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to update reschedule request");
    } finally {
      setDecisionLoading(false);
    }
  };

  if (!isOpen) return null;

  const teacherName =
    classData?.teacher
      ? `${classData.teacher.firstName || ""} ${classData.teacher.lastName || ""}`.trim() || classData.teacher.email
      : notification?.metadata?.teacherName || "—";

  const guardianName =
    classData?.student?.guardianId
      ? `${classData.student.guardianId.firstName || ""} ${classData.student.guardianId.lastName || ""}`.trim() || classData.student.guardianId.email
      : notification?.metadata?.guardianName || "—";

  const studentName = classData?.student?.studentName || notification?.metadata?.studentName || "—";

  const tz = userTimezone;

  const originalLabel = originalDate
    ? formatDateTimeDDMMMYYYYhhmmA(originalDate, { timeZone: tz })
    : (classData?.scheduledDate ? formatDateTimeDDMMMYYYYhhmmA(classData.scheduledDate, { timeZone: tz }) : "—");

  const proposedLabel = proposedDate
    ? formatDateTimeDDMMMYYYYhhmmA(proposedDate, { timeZone: tz })
    : (classData?.pendingReschedule?.proposedDate
        ? formatDateTimeDDMMMYYYYhhmmA(classData.pendingReschedule.proposedDate, { timeZone: tz })
        : "—");

  const pendingNote = classData?.pendingReschedule?.note || "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-lg bg-white shadow-lg">
        <div className="flex items-start justify-between border-b border-gray-200 p-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Reschedule request</h3>
            <p className="text-sm text-gray-600">Review details and decide.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          {loading ? (
            <div className="py-10">
              <LoadingSpinner />
            </div>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-semibold text-gray-900">Class</p>
                <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-gray-700 sm:grid-cols-2">
                  <p><span className="text-gray-500">Teacher:</span> {teacherName}</p>
                  <p><span className="text-gray-500">Guardian:</span> {guardianName}</p>
                  <p className="sm:col-span-2"><span className="text-gray-500">Student:</span> {studentName}</p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-3">
                <p className="text-sm font-semibold text-gray-900">Request</p>
                <div className="mt-2 space-y-2 text-sm text-gray-700">
                  <p><span className="text-gray-500">Requested by:</span> {requestorLabel}</p>
                  <p><span className="text-gray-500">Current time:</span> {originalLabel}</p>
                  <p>
                    <span className="text-gray-500">Proposed time:</span> {proposedLabel}
                    {proposedDuration ? <span className="text-gray-500"> • {proposedDuration} min</span> : null}
                  </p>
                  {pendingNote ? (
                    <p><span className="text-gray-500">Note:</span> {pendingNote}</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Recent request counts</p>
                    <p className="text-xs text-gray-500">Grouped by who requested the change.</p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">From</label>
                      <input
                        type="date"
                        value={rangeFrom}
                        onChange={(e) => setRangeFrom(e.target.value)}
                        className="w-full sm:w-auto rounded-md border border-gray-300 px-3 py-2"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">To</label>
                      <input
                        type="date"
                        value={rangeTo}
                        onChange={(e) => setRangeTo(e.target.value)}
                        className="w-full sm:w-auto rounded-md border border-gray-300 px-3 py-2"
                      />
                    </div>
                  </div>
                </div>

                {statsLoading ? (
                  <p className="mt-3 text-sm text-gray-600">Loading stats…</p>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <RoleCounts title="For this teacher" stats={teacherStats} />
                    <RoleCounts title="For this student" stats={studentStats} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
          <button
            type="button"
            disabled={decisionLoading || loading || Boolean(error)}
            onClick={() => handleDecision("rejected")}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={decisionLoading || loading || Boolean(error)}
            onClick={() => handleDecision("approved")}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
};

export default RescheduleRequestDetailsModal;
