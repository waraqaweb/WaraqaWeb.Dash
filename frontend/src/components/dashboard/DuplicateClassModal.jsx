import React, { useEffect, useMemo, useState } from "react";
import { Calendar as CalendarIcon, Clock, User as UserIcon, X } from "lucide-react";
import api from "../../api/axios";
import { DEFAULT_TIMEZONE } from "../../utils/timezoneUtils";
import TimezoneSelector from "../ui/TimezoneSelector";
import LoadingSpinner from "../ui/LoadingSpinner";
import { subjects as fallbackSubjects } from "../../constants/reportTopicsConfig";
import { getSubjectsCatalogCached } from '../../services/subjectsCatalog';
import { formatDateDDMMMYYYY } from "../../utils/date";
import SearchSelect from "../ui/SearchSelect";

const CLASS_TYPE_OPTIONS = ["One on one", "Group classes", "Public lecture"];

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

const resolveId = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value._id || value.id || value.value || value.toString?.() || "";
  }
  return "";
};

const formatDisplayDate = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  const datePart = formatDateDDMMMYYYY(date);
  const timePart = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${datePart} • ${timePart}`;
};

const DuplicateClassModal = ({
  isOpen,
  onClose,
  sourceClass = null,
  teachers = [],
  guardians = [],
  onDuplicated,
}) => {
  const [form, setForm] = useState({
    title: "One on one",
    subject: "",
    description: "",
    teacher: "",
    guardianId: "",
    studentId: "",
    scheduledDate: "",
    timezone: DEFAULT_TIMEZONE,
    duration: "60",
    meetingLink: "",
  });
  const [students, setStudents] = useState([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [subjectOptions, setSubjectOptions] = useState(Array.isArray(fallbackSubjects) ? fallbackSubjects : []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await getSubjectsCatalogCached();
        if (cancelled) return;
        if (Array.isArray(catalog?.subjects) && catalog.subjects.length > 0) {
          setSubjectOptions(catalog.subjects);
        }
      } catch (e) {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setForm({
        title: "One on one",
        subject: "",
        description: "",
        teacher: "",
        guardianId: "",
        studentId: "",
        scheduledDate: "",
        timezone: DEFAULT_TIMEZONE,
        duration: "60",
        meetingLink: "",
      });
      setStudents([]);
      setError("");
      setSubmitting(false);
      return;
    }

    if (!sourceClass) {
      setError("Unable to load class data for duplication.");
      return;
    }

    const teacherId = resolveId(sourceClass.teacher);
    const guardianId = resolveId(sourceClass?.student?.guardianId);
    const studentId = resolveId(sourceClass?.student?.studentId);

    setForm({
      title: sourceClass.title || "One on one",
      subject: sourceClass.subject || "",
      description: sourceClass.description || "",
      teacher: teacherId || "",
      guardianId: guardianId || "",
      studentId: studentId || "",
      scheduledDate: toLocalInputValue(sourceClass.scheduledDate),
      timezone: sourceClass.timezone || DEFAULT_TIMEZONE,
      duration: String(Number(sourceClass.duration) || 60),
      meetingLink: sourceClass.meetingLink || "",
    });

    if (guardianId) {
      fetchStudentsForGuardian(guardianId, studentId);
    } else {
      setStudents([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sourceClass]);

  const classType = form.title || "One on one";
  const modalHeading = classType === "One on one" ? "One on one class" : classType;
  const classTypeOptions = form.title && !CLASS_TYPE_OPTIONS.includes(form.title)
    ? [...CLASS_TYPE_OPTIONS, form.title]
    : CLASS_TYPE_OPTIONS;

  const fetchStudentsForGuardian = async (guardianId, initialStudentId = "") => {
    if (!guardianId) {
      setStudents([]);
      return;
    }

    setLoadingStudents(true);
    setError("");
    try {
      const res = await api.get(`/users/${guardianId}/students`);
      const list = (res.data?.students || []).map((student) => ({
        _id: student._id || student.id,
        firstName: student.firstName,
        lastName: student.lastName,
      }));
      setStudents(list);

      if (initialStudentId) {
        const exists = list.some((s) => String(s._id) === String(initialStudentId));
        if (!exists) {
          setForm((prev) => ({ ...prev, studentId: "" }));
        }
      }
    } catch (err) {
      const message = err?.response?.data?.message || "Failed to load students for guardian";
      setError(message);
      setStudents([]);
    } finally {
      setLoadingStudents(false);
    }
  };

  const teacherOptions = useMemo(
    () => teachers.map((teacher) => ({
      value: teacher._id,
      label: `${teacher.firstName || ""} ${teacher.lastName || ""}`.trim() || teacher.email || "Unnamed Teacher",
    })),
    [teachers]
  );

  const guardianOptions = useMemo(
    () => guardians.map((guardian) => ({
      value: guardian._id,
      label: `${guardian.firstName || ""} ${guardian.lastName || ""}`.trim() || guardian.email || "Unnamed Guardian",
    })),
    [guardians]
  );

  const selectedTeacherLabel = useMemo(() => {
    const option = teacherOptions.find((opt) => String(opt.value) === String(form.teacher));
    if (option) return option.label;
    return sourceClass?.teacher?.firstName || sourceClass?.teacher?.lastName
      ? `${sourceClass?.teacher?.firstName || ""} ${sourceClass?.teacher?.lastName || ""}`.trim()
      : "";
  }, [teacherOptions, form.teacher, sourceClass]);

  const originalStudentName = useMemo(() => sourceClass?.student?.studentName || "", [sourceClass]);

  const handleFieldChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleGuardianChange = async (event) => {
    const guardianId = event.target.value;
    setForm((prev) => ({ ...prev, guardianId, studentId: "" }));
    if (guardianId) {
      await fetchStudentsForGuardian(guardianId);
    } else {
      setStudents([]);
    }
  };

  const handleTimezoneChange = (timezone) => {
    setForm((prev) => ({ ...prev, timezone: timezone || DEFAULT_TIMEZONE }));
  };

  const validateForm = () => {
    if (!form.title.trim()) {
      setError("Title is required.");
      return false;
    }
    if (!form.subject) {
      setError("Subject is required.");
      return false;
    }
    if (!form.teacher) {
      setError("Please select a teacher.");
      return false;
    }
    if (!form.guardianId) {
      setError("Please select a guardian.");
      return false;
    }
    if (!form.studentId) {
      setError("Please select a student.");
      return false;
    }
    if (!form.scheduledDate) {
      setError("Please choose the date and time for the new class.");
      return false;
    }
    if (!form.duration || Number(form.duration) <= 0) {
      setError("Duration must be a positive number of minutes.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!sourceClass?._id) {
      setError("Missing class identifier to duplicate.");
      return;
    }

    if (!validateForm()) return;

    const isoDate = toIsoString(form.scheduledDate);
    if (!isoDate) {
      setError("Invalid date selected.");
      return;
    }

    const payload = {
      title: form.title.trim(),
      subject: form.subject,
      description: form.description?.trim() || "",
      scheduledDate: isoDate,
      timezone: form.timezone || DEFAULT_TIMEZONE,
      duration: Number(form.duration),
      meetingLink: form.meetingLink?.trim() || "",
      teacher: form.teacher,
      student: {
        guardianId: form.guardianId,
        studentId: form.studentId,
      },
    };

    setSubmitting(true);
    setError("");
    try {
      const res = await api.post(`/classes/${sourceClass._id}/duplicate`, payload);
      if (onDuplicated) {
        await onDuplicated(res.data);
      }
      if (onClose) {
        onClose();
      }
    } catch (err) {
      const message = err?.response?.data?.message || "Failed to duplicate class";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Duplicate {modalHeading}</h2>
            {sourceClass?.student?.studentName && (
              <p className="text-sm text-gray-500">
                {sourceClass.student.studentName}
                {sourceClass.subject ? ` • ${sourceClass.subject}` : ""}
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
          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {sourceClass && (
            <div className="mb-5 space-y-3 rounded-xl bg-gray-50 p-4">
              <div className="flex items-start gap-3 text-sm text-gray-700">
                <CalendarIcon className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="font-medium">Original schedule</p>
                  <p>{formatDisplayDate(sourceClass.scheduledDate) || "Not scheduled"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-700">
                <Clock className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="font-medium">Duration</p>
                  <p>{sourceClass.duration ? `${sourceClass.duration} minutes` : "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 text-sm text-gray-700">
                <UserIcon className="mt-0.5 h-4 w-4 text-gray-500" />
                <div>
                  <p className="font-medium">Teacher</p>
                  <p>{selectedTeacherLabel || "Not assigned"}</p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Class Type *</label>
                <select
                  value={form.title || "One on one"}
                  onChange={handleFieldChange("title")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  required
                >
                  {classTypeOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Subject *</label>
                <SearchSelect
                  value={form.subject || ""}
                  onChange={(opt) => setForm((prev) => ({ ...prev, subject: opt?.label || "" }))}
                  fetchOptions={async (term = "") => {
                    const q = String(term || "").toLowerCase();
                    return (subjectOptions || [])
                      .filter((s) => !q || String(s).toLowerCase().includes(q))
                      .slice(0, 200)
                      .map((s) => ({ id: s, label: s }));
                  }}
                  fetchById={async (id) => (id ? { id, label: id } : null)}
                  placeholder="Select or type a subject"
                  required
                  allowCustom
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={form.description}
                onChange={handleFieldChange("description")}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                placeholder="Optional notes about the class"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Teacher * ({teacherOptions.length})
                </label>
                <select
                  value={form.teacher}
                  onChange={handleFieldChange("teacher")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  required
                >
                  <option value="">Select teacher</option>
                  {teacherOptions.map((teacher) => (
                    <option key={teacher.value} value={teacher.value}>
                      {teacher.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Guardian * ({guardianOptions.length})
                </label>
                <select
                  value={form.guardianId}
                  onChange={handleGuardianChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  required
                >
                  <option value="">Select guardian</option>
                  {guardianOptions.map((guardian) => (
                    <option key={guardian.value} value={guardian.value}>
                      {guardian.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Student *
                </label>
                <select
                  value={form.studentId}
                  onChange={handleFieldChange("studentId")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-100 disabled:cursor-not-allowed"
                  disabled={!form.guardianId || loadingStudents}
                  required
                >
                  <option value="">
                    {!form.guardianId
                      ? "Select guardian first"
                      : loadingStudents
                        ? "Loading students..."
                        : students.length > 0
                          ? "Select student"
                          : originalStudentName
                            ? `No students found (was ${originalStudentName})`
                            : "No students found"}
                  </option>
                  {students.map((student) => (
                    <option key={student._id} value={student._id}>
                      {`${student.firstName || ""} ${student.lastName || ""}`.trim() || "Unnamed student"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  New date & time *
                </label>
                <input
                  type="datetime-local"
                  value={form.scheduledDate}
                  onChange={handleFieldChange("scheduledDate")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Duration (minutes) *
                </label>
                <select
                  value={form.duration}
                  onChange={handleFieldChange("duration")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  required
                >
                  {[30, 45, 60, 75, 90, 120].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Timezone</label>
                <TimezoneSelector
                  value={form.timezone || DEFAULT_TIMEZONE}
                  onChange={handleTimezoneChange}
                  placeholder="Select class timezone"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Meeting link</label>
                <input
                  type="url"
                  value={form.meetingLink}
                  onChange={handleFieldChange("meetingLink")}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  placeholder="https://meet.google.com/..."
                />
              </div>
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
                {submitting ? "Duplicating…" : "Create duplicate"}
              </button>
            </div>
          </form>

          {loadingStudents && (
            <div className="mt-4 flex items-center justify-center">
              <LoadingSpinner />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DuplicateClassModal;
