import React, { useEffect, useMemo, useRef, useState } from "react";
import api from '../../api/axios';
import Select from "react-select";
import { XCircle, Loader2, Star } from "lucide-react";
import topicsMap, { subjects, surahs } from "../../constants/reportTopicsConfig";
import Toast from "../../components/ui/Toast";
import { saveDraft, loadDraft, clearDraft } from "../../utils/localStorageUtils";
import ReportSubmissionStatus from "../../components/dashboard/ReportSubmissionStatus";
import { getSubjectsCatalogCached } from '../../services/subjectsCatalog';
import { useAuth } from "../../contexts/AuthContext";
import { makeCacheKey, readCache, writeCache } from "../../utils/sessionCache";

const normalizeAttendance = (attendance) => {
  if (attendance === "missed_by_student") return "absent";
  if (String(attendance || "").startsWith("cancelled")) return "cancelled";
  return "attended";
};

const deriveCancelledBy = (attendance) => {
  return attendance === "cancelled_by_student" ? "student" : "teacher";
};

const toApiAttendance = (attendance, cancelledBy) => {
  if (attendance === "absent") return "missed_by_student";
  if (attendance === "cancelled") return cancelledBy === "student" ? "cancelled_by_student" : "cancelled_by_teacher";
  return "attended";
};

const ClassReportPage = ({ reportClass, reportClassId, onClose, onSuccess }) => {
  const derivedClassId = reportClass?._id || reportClassId;
  const [classData, setClassData] = useState(reportClass || null);
  const [classLoadError, setClassLoadError] = useState(null);
  const [classLoading, setClassLoading] = useState(!reportClass && Boolean(reportClassId));
  const [submissionEligibility, setSubmissionEligibility] = useState(null);
    const { user } = useAuth();
    const submitInFlightRef = useRef(false);
    const classFetchAbortRef = useRef(null);
  const [, setCheckingEligibility] = useState(false);
  const [userRole, setUserRole] = useState(null);
  const hasInitializedState = useRef(false);
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState({ show: false, type: "", message: "" });

  const [catalogSubjects, setCatalogSubjects] = useState(Array.isArray(subjects) ? subjects : []);
  const [catalogTopicsBySubject, setCatalogTopicsBySubject] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await getSubjectsCatalogCached();
        if (cancelled) return;
        if (Array.isArray(catalog?.subjects) && catalog.subjects.length > 0) {
          setCatalogSubjects(catalog.subjects);
        }
        if (catalog?.topicsBySubject && typeof catalog.topicsBySubject === 'object') {
          setCatalogTopicsBySubject(catalog.topicsBySubject);
        }
      } catch (e) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const defaultReportState = (baseClass) => ({
    attendance: normalizeAttendance(baseClass?.classReport?.attendance || "attended"),
    cancelledBy: String(baseClass?.classReport?.attendance || "").startsWith("cancelled")
      ? deriveCancelledBy(baseClass?.classReport?.attendance)
      : "teacher",
    countAbsentForBilling:
      typeof baseClass?.classReport?.countAbsentForBilling === "boolean"
        ? baseClass.classReport.countAbsentForBilling
        : true,
    subjects: Array.isArray(baseClass?.classReport?.subjects)
      ? baseClass.classReport.subjects
      : [],
    subject: baseClass?.classReport?.subject || baseClass?.subject || "",
    lessonTopic: baseClass?.classReport?.lessonTopic || "",
    customLessonTopic: baseClass?.classReport?.customLessonTopic || "",
    recitedQuran: baseClass?.classReport?.recitedQuran || "",
    surahName: baseClass?.classReport?.surah?.name || baseClass?.classReport?.surahName || "",
    verseEnd: baseClass?.classReport?.surah?.verse || baseClass?.classReport?.verseEnd || "",
    teacherNotes: baseClass?.classReport?.teacherNotes || "",
    supervisorNotes: baseClass?.classReport?.supervisorNotes || "",
    newAssignment: baseClass?.classReport?.newAssignment || "",
    cancellationReason: baseClass?.cancellation?.reason || "",
    absenceExcused:
      typeof baseClass?.classReport?.absenceExcused === "boolean"
        ? baseClass.classReport.absenceExcused
        : false,
    classScore:
      typeof baseClass?.classReport?.classScore === "number"
        ? baseClass.classReport.classScore
        : null,
    submittedAt: baseClass?.classReport?.submittedAt || null,
    submittedBy: baseClass?.classReport?.submittedBy || null,
  });

  const [classReport, setClassReport] = useState(() => {
    const base = defaultReportState(reportClass || null);
    const draft = derivedClassId ? loadDraft(derivedClassId) : null;
    if (draft) {
      const normalizedAttendance = normalizeAttendance(draft.attendance || base.attendance);
      return {
        ...base,
        ...draft,
        attendance: normalizedAttendance,
        cancelledBy: draft.cancelledBy || (normalizedAttendance === "cancelled" ? deriveCancelledBy(draft.attendance) : "teacher"),
      };
    }
    return base;
  });

  const formatDateTime = useMemo(() => (
    (value) => {
      if (!value) return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  ), []);

  const buildUserLabel = useMemo(() => (
    (user) => {
      if (!user) return null;
      if (typeof user === "string") return user;
      if (typeof user === "object") {
        const parts = [user.firstName, user.lastName].filter(Boolean);
        if (parts.length) return parts.join(" ");
        if (user.email) return user.email;
        if (user.role) return user.role;
        if (user._id) return String(user._id);
      }
      return null;
    }
  ), []);

  const reportMeta = useMemo(() => {
    if (!classData?.classReport) {
      return {
        submittedAt: null,
        submittedBy: null,
        lastEditedAt: null,
        lastEditedBy: null,
        historyCount: 0,
        previousEditor: null,
        previousChangedAt: null,
        previousNote: "",
      };
    }

    const submittedAt = formatDateTime(classData.classReport.submittedAt);
    const submittedBy = buildUserLabel(classData.classReport.submittedBy);
    const lastEditedAt = formatDateTime(classData.classReport.lastEditedAt);
    const lastEditedBy = buildUserLabel(classData.classReport.lastEditedBy);

    let previousEditor = null;
    let previousChangedAt = null;
    let previousNote = "";

    if (Array.isArray(classData.classReportHistory) && classData.classReportHistory.length) {
      const lastHistory = classData.classReportHistory[classData.classReportHistory.length - 1];
      previousEditor = buildUserLabel(lastHistory?.editedBy);
      previousChangedAt = formatDateTime(lastHistory?.editedAt);
      previousNote = lastHistory?.note || "";
    }

    return {
      submittedAt,
      submittedBy,
      lastEditedAt,
      lastEditedBy,
      historyCount: Array.isArray(classData.classReportHistory) ? classData.classReportHistory.length : 0,
      previousEditor,
      previousChangedAt,
      previousNote,
    };
  }, [buildUserLabel, classData, formatDateTime]);

  useEffect(() => {
    hasInitializedState.current = false;
  }, [derivedClassId]);

  useEffect(() => {
    let ignore = false;
    if (classFetchAbortRef.current) {
      try { classFetchAbortRef.current.abort(); } catch (e) { /* ignore */ }
    }

    if (!reportClass && reportClassId) {
      setClassLoadError(null);
      const cacheKey = makeCacheKey('class:detail', reportClassId, { role: user?.role || 'unknown' });
      const cached = readCache(cacheKey, { deps: ['classes'] });
      if (cached.hit && cached.value?.class) {
        setClassData(cached.value.class);
        setClassLoading(false);
        if (cached.ageMs < 60_000) return () => { ignore = true; };
      } else {
        setClassLoading(true);
      }

      const controller = new AbortController();
      classFetchAbortRef.current = controller;

      api
        .get(`/classes/${reportClassId}`, { signal: controller.signal })
        .then((res) => {
          if (ignore) return;
          const fetchedClass = res.data?.class || null;
          setClassData(fetchedClass);
          writeCache(cacheKey, { class: fetchedClass }, { ttlMs: 5 * 60_000, deps: ['classes'] });
        })
        .catch((err) => {
          if (ignore) return;
          const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
          if (!isCanceled) {
            console.error("[ClassReport] failed to load class data", err);
            setClassLoadError(err);
          }
        })
        .finally(() => {
          if (ignore) return;
          setClassLoading(false);
        });
    } else {
      setClassData(reportClass || null);
    }

    return () => {
      ignore = true;
    };
  }, [reportClass, reportClassId, user?.role]);

  useEffect(() => {
    if (hasInitializedState.current) return;
    if (!derivedClassId) {
      setClassReport(defaultReportState(classData));
      hasInitializedState.current = true;
      return;
    }

    const draft = loadDraft(derivedClassId);
    if (draft) {
      const normalizedAttendance = normalizeAttendance(draft.attendance || classData?.classReport?.attendance);
      setClassReport({
        ...defaultReportState(classData),
        ...draft,
        attendance: normalizedAttendance,
        cancelledBy: draft.cancelledBy || (normalizedAttendance === "cancelled" ? deriveCancelledBy(draft.attendance) : "teacher"),
      });
      hasInitializedState.current = true;
      return;
    }

    if (classData) {
      setClassReport(defaultReportState(classData));
      hasInitializedState.current = true;
    }
  }, [classData, derivedClassId]);

  // ✅ Auto-save draft on every change
  useEffect(() => {
    if (!derivedClassId) return;
    saveDraft(derivedClassId, classReport);
  }, [classReport, derivedClassId]);

  // Fetch user role
  useEffect(() => {
    if (user?.role) {
      setUserRole(user.role);
    }
  }, [user?.role]);

  // Check submission eligibility for teachers
  useEffect(() => {
    if (!derivedClassId || userRole === 'admin') return;

    const checkEligibility = async () => {
      try {
        setCheckingEligibility(true);
        const res = await api.post(`/classes/${derivedClassId}/check-can-submit`);
        setSubmissionEligibility(res.data);
      } catch (err) {
        console.error('Error checking eligibility:', err);
        setSubmissionEligibility({
          canSubmit: false,
          reason: 'Failed to check submission status',
        });
      } finally {
        setCheckingEligibility(false);
      }
    };

    checkEligibility();
  }, [derivedClassId, userRole]);

  // ✅ Ensure subject defaults to class subject while remaining editable
  useEffect(() => {
    if (!classData?.subject) return;
    setClassReport((prev) => {
      if (!prev || prev.subject) return prev;
      return { ...prev, subject: classData.subject };
    });
  }, [classData?.subject]);

  // ✅ Submit Report
  const [hoverScore, setHoverScore] = useState(0);

  const handleSubmitReport = async (e) => {
    e.preventDefault();
    if (submitInFlightRef.current) return;
    setLoading(true);
    submitInFlightRef.current = true;

    try {
      if (!derivedClassId) {
        throw new Error("Class identifier is missing");
      }

      if (userRole === 'teacher' && classReport.attendance === 'attended') {
        const subjectValue = (classReport.subject || '').trim();
        const topicValue = (classReport.customLessonTopic || classReport.lessonTopic || '').trim();
        const scoreValue = Number(classReport.classScore || 0);
        if (!subjectValue || !topicValue || !scoreValue) {
          setShowToast({
            show: true,
            type: "error",
            message: "Please fill subject, lesson topic, and class performance before submitting."
          });
          setLoading(false);
          submitInFlightRef.current = false;
          return;
        }
      }

      const {
        submittedAt,
        submittedBy,
        customLessonTopic,
        previousAssignment,
        subjects,
        cancelledBy,
        ...rest
      } = classReport;

      const attendance = rest.attendance || "attended";
      const apiAttendance = toApiAttendance(attendance, cancelledBy);
      const cancellationReason = (classReport.cancellationReason || "").trim();

      let sanitizedPayload = { attendance: apiAttendance };

      if (attendance === "absent") {
        sanitizedPayload.countAbsentForBilling = Boolean(rest.countAbsentForBilling);
        sanitizedPayload.absenceExcused = Boolean(rest.absenceExcused);
      } else if (attendance === "cancelled") {
        if (!cancellationReason) {
          setShowToast({ show: true, type: "error", message: "Please provide a cancellation reason." });
          setLoading(false);
          return;
        }
        sanitizedPayload.cancellationReason = cancellationReason;
      } else {
        const subjectValue = (rest.subject || classData?.subject || "").trim();
        const trimmedLessonTopic = typeof rest.lessonTopic === "string" ? rest.lessonTopic.trim() : "";
        const trimmedCustomLessonTopic = typeof customLessonTopic === "string" ? customLessonTopic.trim() : "";
        const trimmedTeacherNotes = typeof rest.teacherNotes === "string" ? rest.teacherNotes.trim() : "";
        const trimmedSupervisorNotes = typeof rest.supervisorNotes === "string" ? rest.supervisorNotes.trim() : "";
        const trimmedNewAssignment = typeof rest.newAssignment === "string" ? rest.newAssignment.trim() : "";
        const trimmedSurahName = typeof rest.surahName === "string" ? rest.surahName.trim() : "";
        const parsedVerseEnd = rest.verseEnd === "" || rest.verseEnd === null || typeof rest.verseEnd === "undefined"
          ? undefined
          : Number(rest.verseEnd);
        const verseValue = Number.isFinite(parsedVerseEnd) && parsedVerseEnd > 0 ? parsedVerseEnd : undefined;

        const subjectList = Array.isArray(subjects) && subjects.length
          ? subjects
              .map((item) => (typeof item === "string" ? item.trim() : ""))
              .filter(Boolean)
          : subjectValue
            ? [subjectValue]
            : [];

        const detailPayload = {
          attendance: apiAttendance,
          absenceExcused: Boolean(rest.absenceExcused),
          countAbsentForBilling: false,
          classScore: Number.isFinite(Number(rest.classScore)) ? Number(rest.classScore) : 5,
        };

        if (subjectList.length) detailPayload.subjects = subjectList;
        if (subjectValue) detailPayload.subject = subjectValue;

        const lessonTopicForSubject = ["Khatmah Prog.", "Hafez Prog.", "Ijazah Prog."].includes(subjectValue)
          ? trimmedSurahName
          : trimmedLessonTopic;

        if (lessonTopicForSubject) detailPayload.lessonTopic = lessonTopicForSubject;
        if (trimmedCustomLessonTopic) detailPayload.customLessonTopic = trimmedCustomLessonTopic;
        if (trimmedTeacherNotes) detailPayload.teacherNotes = trimmedTeacherNotes;
        if (trimmedSupervisorNotes) detailPayload.supervisorNotes = trimmedSupervisorNotes;
        if (trimmedNewAssignment) detailPayload.newAssignment = trimmedNewAssignment;

        if (rest.recitedQuran) {
          detailPayload.recitedQuran = rest.recitedQuran;
          detailPayload.quranRecitation = rest.recitedQuran;
        }

        if (trimmedSurahName || typeof verseValue !== "undefined") {
          detailPayload.surah = {};
          if (trimmedSurahName) detailPayload.surah.name = trimmedSurahName;
          if (typeof verseValue !== "undefined") detailPayload.surah.verse = verseValue;
        }
        if (typeof verseValue !== "undefined") detailPayload.verseEnd = verseValue;

        sanitizedPayload = detailPayload;
      }

      

      const res = await api.put(`/classes/${derivedClassId}/report`, sanitizedPayload);

      if (res.data.message) {
        clearDraft(derivedClassId);
        setShowToast({ show: true, type: "success", message: "Class report submitted successfully!" });

        try {
          window.dispatchEvent(
            new CustomEvent('waraqa:dashboard-stats-refresh', {
              detail: { reason: 'class-report-submitted', classId: derivedClassId }
            })
          );
        } catch (e) {
          // ignore
        }

        onSuccess?.();
          submitInFlightRef.current = false;
        onClose?.();
      }
    } catch (err) {
      console.error("[ClassReport] submission failed", err);
      setShowToast({ show: true, type: "error", message: err.response?.data?.message || "Failed to submit report" });
    } finally {
      setLoading(false);
    }
  };

  // ✅ Prepare options
  const subjectOptions = (catalogSubjects || []).map((s) => ({ value: s, label: s }));
  const surahOptions = surahs.map((s) => ({ value: s, label: s }));
  const topicsForSubject = Array.isArray(catalogTopicsBySubject?.[classReport.subject])
    ? catalogTopicsBySubject[classReport.subject]
    : (topicsMap[classReport.subject] || []);
  const topicOptions = (topicsForSubject || []).map((t) => ({ value: t, label: t }));

  // ✅ Subject groups for scenarios
  const quranWithRecitation = ["Tajweed Basics", "Tajweed Inter.", "Qari Prog.", "Short Surahs"];
  const quranSurahOnly = ["Khatmah Prog.", "Hafez Prog.", "Ijazah Prog."];

  const hasTopicOptions = Array.isArray(topicOptions) && topicOptions.length > 0;

  const isAttended = classReport.attendance === "attended";
  const isAbsent = classReport.attendance === "absent";
  const isCancelled = classReport.attendance === "cancelled";

  if (!derivedClassId) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl shadow-lg max-w-lg w-full p-6 text-center space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Submit Class Report</h2>
          <p className="text-gray-600">
            Select a class to report on before opening the report modal.
          </p>
          <button onClick={onClose} className="btn-primary px-4 py-2">
            Close
          </button>
        </div>
      </div>
    );
  }

  if (classLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl shadow-lg max-w-lg w-full p-6 text-center space-y-4">
          <h2 className="text-xl font-semibold text-gray-900">Loading class details…</h2>
          <p className="text-gray-600">Please wait while we prepare the class report form.</p>
        </div>
      </div>
    );
  }

  if (classLoadError) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl shadow-lg max-w-lg w-full p-6 text-center space-y-4">
          <h2 className="text-xl font-semibold text-red-600">Failed to load class</h2>
          <p className="text-gray-600">{classLoadError.response?.data?.message || classLoadError.message}</p>
          <button onClick={onClose} className="btn-primary px-4 py-2">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto relative">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Submit Class Report</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <XCircle className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={handleSubmitReport} className="p-5 space-y-6">
          {/* Submission Status Banner */}
          {derivedClassId && userRole && (
            <ReportSubmissionStatus
              classId={derivedClassId}
              userRole={userRole}
              onExtensionGranted={() => {
                // Refresh eligibility check
                if (userRole !== 'admin') {
                  api.post(`/classes/${derivedClassId}/check-can-submit`)
                    .then(res => setSubmissionEligibility(res.data))
                    .catch(err => console.error('Error refreshing eligibility:', err));
                }
              }}
              onRefresh={async () => {
                // Reload class data
                try {
                  const res = await api.get(`/classes/${derivedClassId}`);
                  setClassData(res.data?.class || null);
                } catch (err) {
                  console.error('Error refreshing class data:', err);
                }
              }}
            />
          )}

          {(reportMeta.submittedAt || reportMeta.lastEditedAt) && (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-1">
              {reportMeta.submittedAt ? (
                <p>
                  <span className="font-semibold">Submitted by:</span> {reportMeta.submittedBy || "Unknown user"} on {reportMeta.submittedAt}
                </p>
              ) : (
                <p className="font-semibold">Submission pending</p>
              )}
              {reportMeta.lastEditedAt && (
                <p>
                  <span className="font-semibold">Last edited by:</span> {reportMeta.lastEditedBy || "Unknown user"} on {reportMeta.lastEditedAt}
                </p>
              )}
              {reportMeta.previousEditor && (
                <p className="text-emerald-800">
                  <span className="font-semibold">Previous version:</span> {reportMeta.previousEditor}
                  {reportMeta.previousChangedAt ? ` · ${reportMeta.previousChangedAt}` : ""}
                  {reportMeta.previousNote ? ` · ${reportMeta.previousNote}` : ""}
                </p>
              )}
              {reportMeta.historyCount > 1 && (
                <p className="text-xs text-emerald-700">
                  {reportMeta.historyCount} versions recorded in history. Contact an admin if you need to review older submissions.
                </p>
              )}
            </div>
          )}

          {/* === First Row: Attendance + Billing === */}
          <div className="space-y-2">
            <label className="block font-semibold">Attendance</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {[
                { key: "attended", label: "Attended" },
                { key: "absent", label: "Absent" },
                { key: "cancelled", label: "Cancelled" }
              ].map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setClassReport((prev) => ({
                      ...prev,
                      attendance: key,
                      countAbsentForBilling:
                        key === "absent"
                          ? (typeof prev.countAbsentForBilling === "boolean" ? prev.countAbsentForBilling : true)
                          : false,
                      cancellationReason: key === "cancelled" ? prev.cancellationReason : "",
                      cancelledBy: key === "cancelled" ? (prev.cancelledBy || "teacher") : "teacher",
                    }))
                  }
                  className={`recite-toggle w-full ${
                    classReport.attendance === key ? "active" : ""
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Show Count for Billing toggle ONLY if absent */}
            {classReport.attendance === "absent" && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <label htmlFor="countAbsent" className="text-sm font-medium text-slate-800">
                      Count this absence for billing
                    </label>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Turn on only when this missed class should still be billable.
                    </p>
                  </div>
                  <button
                    id="countAbsent"
                    type="button"
                    role="switch"
                    aria-checked={Boolean(classReport.countAbsentForBilling)}
                    onClick={() =>
                      setClassReport((prev) => ({
                        ...prev,
                        countAbsentForBilling: !Boolean(prev.countAbsentForBilling),
                      }))
                    }
                    className={`inline-flex min-w-[72px] items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      classReport.countAbsentForBilling
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-300 text-slate-700"
                    }`}
                  >
                    {classReport.countAbsentForBilling ? "ON" : "OFF"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {isAbsent && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Student missed the class. No detailed report is required—just confirm whether the absence should be counted for billing.
            </div>
          )}

          {isCancelled && (
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">Cancelled by</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { key: "student", label: "Student" },
                  { key: "teacher", label: "Teacher" },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setClassReport((prev) => ({ ...prev, cancelledBy: key }))}
                    className={`recite-toggle w-full ${classReport.cancelledBy === key ? "active" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="block text-sm font-semibold text-gray-700" htmlFor="cancellationReason">
                Cancellation reason (visible to admins only)
              </label>
              <textarea
                id="cancellationReason"
                value={classReport.cancellationReason || ""}
                onChange={(e) => setClassReport({ ...classReport, cancellationReason: e.target.value })}
                className="w-full border rounded-lg p-3"
                rows={4}
                placeholder="Explain why the class was cancelled..."
              />
              <p className="text-xs text-gray-500">Your reason will be shared with the admin team; students and guardians will not see it.</p>
            </div>
          )}

          {isAttended && (
            <>
              {/* === Second Row: Subject + Lesson Topic/Surah === */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Subject */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <Select
                    options={subjectOptions}
                    value={
                      subjectOptions.find((s) => s.value === classReport.subject)
                      || { value: classReport.subject, label: classReport.subject }
                    }
                    onChange={(selected) => setClassReport({ ...classReport, subject: selected?.value || "" })}
                    placeholder="Search or select subject..."
                    isClearable
                    isSearchable
                  />
                </div>

                {/* Lesson Topic / Surah Handling */}
                <div>
                  {quranSurahOnly.includes(classReport.subject) ? (
                    <>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Surah (Lesson Topic)</label>
                      {classReport.lessonTopic === "custom" ? (
                        <input
                          type="text"
                          value={classReport.customLessonTopic || ""}
                          onChange={(e) => setClassReport({ ...classReport, customLessonTopic: e.target.value })}
                          className="w-full border rounded-lg p-2"
                          placeholder="Enter custom topic..."
                        />
                      ) : (
                        <Select
                          options={[...surahOptions, { value: "custom", label: "➕ Custom Topic" }]}
                          value={
                            surahOptions.find((s) => s.value === classReport.surahName) ||
                            (classReport.surahName && !surahOptions.find((s) => s.value === classReport.surahName)
                              ? { value: classReport.surahName, label: classReport.surahName }
                              : null)
                          }
                          onChange={(selected) =>
                            setClassReport({
                              ...classReport,
                              surahName: selected?.value || "",
                              lessonTopic: selected?.value || "",
                              customLessonTopic: selected?.value === "custom" ? "" : classReport.customLessonTopic,
                            })
                          }
                          placeholder="Search or select surah..."
                          isClearable
                          isSearchable
                        />
                      )}

                      <div className="mt-2">
                        <label className="block text-sm font-medium">Ending Verse</label>
                        <input
                          type="number"
                          value={classReport.verseEnd}
                          onChange={(e) => setClassReport({ ...classReport, verseEnd: e.target.value })}
                          className="w-full border rounded-lg p-2"
                          placeholder="Enter ending verse"
                        />
                      </div>
                    </>
                  ) : quranWithRecitation.includes(classReport.subject) ? (
                    <>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Lesson Topic</label>
                      <Select
                        options={[...topicOptions, { value: "custom", label: "➕ Custom Topic" }]}
                        value={
                          topicOptions.find((t) => t.value === classReport.lessonTopic) ||
                          (classReport.lessonTopic && !topicOptions.find((t) => t.value === classReport.lessonTopic)
                            ? { value: classReport.lessonTopic, label: classReport.lessonTopic }
                            : null)
                        }
                        onChange={(selected) =>
                          setClassReport({ ...classReport, lessonTopic: selected?.value || "" })
                        }
                        placeholder="Search or select topic..."
                        isClearable
                        isSearchable
                      />

                      {/* Recitation Toggle */}
                      <div className="mt-3">
                        <label className="block font-medium">Did the student recite Quran?</label>
                        <div className="flex gap-2 mt-2">
                          {["yes", "no"].map((val) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setClassReport({ ...classReport, recitedQuran: val })}
                              className={`recite-toggle w-full ${classReport.recitedQuran === val ? "active" : ""}`}
                            >
                              {val.toUpperCase()}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Surah & Verse if Recited */}
                      {classReport.recitedQuran === "yes" && (
                        <div className="mt-2">
                          <label className="block text-sm font-medium">Surah</label>
                          <Select
                            options={surahOptions}
                            value={surahOptions.find((s) => s.value === classReport.surahName) || null}
                            onChange={(selected) =>
                              setClassReport({ ...classReport, surahName: selected?.value || "" })
                            }
                            placeholder="Select surah..."
                            isClearable
                            isSearchable
                          />
                          <label className="block text-sm mt-2">Ending Verse</label>
                          <input
                            type="number"
                            value={classReport.verseEnd}
                            onChange={(e) => setClassReport({ ...classReport, verseEnd: e.target.value })}
                            className="w-full border rounded p-2"
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Lesson Topic</label>
                      {!hasTopicOptions ? (
                        <input
                          type="text"
                          value={classReport.customLessonTopic || classReport.lessonTopic || ""}
                          onChange={(e) =>
                            setClassReport({
                              ...classReport,
                              lessonTopic: e.target.value,
                              customLessonTopic: e.target.value,
                            })
                          }
                          className="w-full border rounded-lg p-2"
                          placeholder="Enter lesson topic..."
                        />
                      ) : (
                        <Select
                          options={[...topicOptions, { value: "custom", label: "➕ Custom Topic" }]}
                          value={
                            topicOptions.find((t) => t.value === classReport.lessonTopic) ||
                            (classReport.lessonTopic && !topicOptions.find((t) => t.value === classReport.lessonTopic)
                              ? { value: classReport.lessonTopic, label: classReport.lessonTopic }
                              : null)
                          }
                          onChange={(selected) =>
                            setClassReport({ ...classReport, lessonTopic: selected?.value || "" })
                          }
                          placeholder="Search or select topic..."
                          isClearable
                          isSearchable
                        />
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* === Notes === */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Notes</label>
                  <textarea
                    value={classReport.teacherNotes}
                    onChange={(e) => setClassReport({ ...classReport, teacherNotes: e.target.value })}
                    className="w-full border rounded-lg p-2"
                    rows={3}
                    placeholder="Visible to guardians and admins"
                  />
                  <p className="mt-1 text-xs text-gray-500">These notes are shared with guardians.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supervisor Notes</label>
                  <textarea
                    value={classReport.supervisorNotes}
                    onChange={(e) => setClassReport({ ...classReport, supervisorNotes: e.target.value })}
                    className="w-full border rounded-lg p-2"
                    rows={3}
                    placeholder="Visible to admins only"
                  />
                  <p className="mt-1 text-xs text-gray-500">Only admins can see these notes.</p>
                </div>
              </div>

              {/* Class performance */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2 text-center">Class performance</label>
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2">
                    {[1,2,3,4,5].map((i) => {
                      const activeScore = hoverScore || Number(classReport.classScore || 0);
                      const isActive = i <= activeScore;
                      return (
                        <button
                          key={i}
                          type="button"
                          aria-label={`${i} star${i>1?'s':''}`}
                          onClick={() => setClassReport({ ...classReport, classScore: i })}
                          onMouseEnter={() => setHoverScore(i)}
                          onMouseLeave={() => setHoverScore(0)}
                          onFocus={() => setHoverScore(i)}
                          onBlur={() => setHoverScore(0)}
                          className={`h-9 w-9 rounded-full border transition-all duration-150 flex items-center justify-center ${isActive ? 'bg-amber-400/90 border-amber-300 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-300'}`}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setClassReport({ ...classReport, classScore: i }); } }}
                        >
                          <Star className={`h-5 w-5 ${isActive ? 'fill-current' : ''}`} />
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-xs text-gray-500">{(classReport.classScore || 0)}/5</span>
                </div>
              </div>
            </>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3">
            {/* Show submission blocker message for teachers */}
            {userRole === 'teacher' && submissionEligibility && !submissionEligibility.canSubmit && (
              <div className="flex-1 text-sm text-red-600 flex items-center gap-2">
                <span className="font-medium">{submissionEligibility.reason}</span>
              </div>
            )}
            
            <button 
              type="submit" 
              disabled={loading || (userRole === 'teacher' && submissionEligibility && !submissionEligibility.canSubmit)} 
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              title={userRole === 'teacher' && submissionEligibility && !submissionEligibility.canSubmit ? submissionEligibility.reason : ''}
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Submit Report"}
            </button>
          </div>
        </form>

        {/* Toast Notifications */}
        {showToast.show && (
          <Toast
            type={showToast.type}
            message={showToast.message}
            onClose={() => setShowToast({ show: false })}
          />
        )}
      </div>
    </div>
  );
};

export default ClassReportPage;
