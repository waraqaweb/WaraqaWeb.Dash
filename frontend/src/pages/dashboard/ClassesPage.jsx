import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate, useLocation } from 'react-router-dom';
import moment from "moment-timezone";
import { convertClassTimeForUser, DEFAULT_TIMEZONE } from "../../utils/timezoneUtils";
import { getTimezoneOptions } from "../../utils/timezoneOptions";
import { useAuth } from "../../contexts/AuthContext";
import { useSearch } from "../../contexts/SearchContext";
import api from '../../api/axios';
import { makeCacheKey, readCache, writeCache } from "../../utils/sessionCache";
import { listMeetings } from '../../api/meetings';
import Select from "react-select";
import {
  ChevronDown, ChevronUp, Video, Clock, CheckCircle,
  XCircle, AlertCircle, Plus, Trash2, Calendar, User, Users, BookOpen, 
  Pencil, Copy, Repeat, Star, FileText, RotateCcw, Globe, MessageCircle,
} from "lucide-react";
import LoadingSpinner from "../../components/ui/LoadingSpinner";
import CopyButton from "../../components/ui/CopyButton";
import EditClassModal from "../../components/dashboard/EditClassModal";
import CreateClassModal from "../../components/dashboard/CreateClassModal";
import FABCluster from "../../components/FABCluster";
import MeetingReportModal from "../../components/dashboard/MeetingReportModal";
import RescheduleClassModal from "../../components/dashboard/RescheduleClassModal";
import RescheduleRequestModal from "../../components/dashboard/RescheduleRequestModal";
import RescheduleRequestDetailsModal from "../../components/dashboard/RescheduleRequestDetailsModal";
import DeleteClassModal from "../../components/dashboard/DeleteClassModal";
import DuplicateClassModal from "../../components/dashboard/DuplicateClassModal";
import ClassesCalendarView from "../../components/dashboard/ClassesCalendarView";
import { MEETING_TYPE_LABELS } from '../../constants/meetingConstants';
import CancelClassModal from "../../components/dashboard/CancelClassModal";
import { useDeleteClassCountdown } from "../../contexts/DeleteClassCountdownContext";
import SeriesScannerModal from "../../components/dashboard/SeriesScannerModal";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MEETING_LOOKBACK_DAYS = 60;
const MEETING_LOOKAHEAD_DAYS = 90;
const DESKTOP_MEETING_SPLIT_MIN_WIDTH = 1280;
const MOBILE_MEETING_WINDOW_HOURS = 24;
const ALL_TEACHERS_OPTION_VALUE = '__all_teachers__';

const formatTimeLabel = (time) => {
  if (!time) return "";
  if (/[ap]m$/i.test(time.trim())) return time;

  const [hourPart = "", minutePart = "00"] = time.split(":");
  const hours24 = parseInt(hourPart, 10);

  if (Number.isNaN(hours24)) {
    return time;
  }

  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  const minutes = minutePart.slice(0, 2).padStart(2, "0");

  return `${hours12}:${minutes} ${period}`;
};

const convertMessageTimesTo12h = (text = "") => {
  if (!text || typeof text !== "string") return text;
  const timePattern = /\b([01]?\d|2[0-3]):([0-5]\d)\b(?!\s?(?:AM|PM))/gi;
  return text.replace(timePattern, (_, hours, minutes) => formatTimeLabel(`${hours}:${minutes}`));
};

const stripSlotTimezoneLabels = (text = "") => {
  if (!text || typeof text !== "string") return text;
  const timezonePattern = /\s*\((?:[A-Za-z]+\/[A-Za-z_]+|UTC[^)]*|GMT[^)]*)\)/g;

  return text
    .split("\n")
    .map((line) => (line.includes("•") ? line.replace(timezonePattern, "") : line))
    .join("\n");
};

const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parseTimeToMinutes = (raw = "") => {
  const value = String(raw || "").trim();
  if (!value) return null;
  if (value === "24:00") return 24 * 60;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 24) return null;
  if (minutes < 0 || minutes > 59) return null;
  if (hours === 24 && minutes !== 0) return null;
  return hours * 60 + minutes;
};

const formatMinutesAs12h = (totalMinutes, withPeriod = true) => {
  if (!Number.isFinite(totalMinutes)) return "";
  const normalized = totalMinutes === 24 * 60 ? 0 : totalMinutes;
  const hours24 = Math.floor(normalized / 60) % 24;
  const minutes = normalized % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  const hourLabel = String(hours12).padStart(2, "0");
  const minuteLabel = String(minutes).padStart(2, "0");
  const base = `${hourLabel}:${minuteLabel}`;
  return withPeriod ? `${base} ${period}` : base;
};

const formatTimeRangeSmart = (startHHMM, endHHMM) => {
  const startMin = parseTimeToMinutes(startHHMM);
  const endMin = parseTimeToMinutes(endHHMM);
  if (startMin === null || endMin === null) {
    return `${startHHMM || ""}${endHHMM ? ` to ${endHHMM}` : ""}`.trim();
  }

  const startLabel = formatMinutesAs12h(startMin, true);
  const endLabel = formatMinutesAs12h(endMin, true);
  return `${startLabel} to ${endLabel}`;
};

const compressDaysLabel = (dayNums = []) => {
  const unique = Array.from(new Set(dayNums.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)))
    .sort((a, b) => a - b);
  if (unique.length === 0) return "";
  if (unique.length === 7) return "Every day";

  const all = [0, 1, 2, 3, 4, 5, 6];
  const excluded = all.filter((d) => !unique.includes(d));
  if (unique.length >= 5 && excluded.length <= 2) {
    const excludedLabel = excluded
      .map((d) => DAY_NAMES_FULL[d])
      .join(excluded.length === 2 ? " and " : ", ");
    return `Every day except ${excludedLabel}`;
  }

  // Build ranges like Tuesday–Wednesday, Friday
  const parts = [];
  let i = 0;
  while (i < unique.length) {
    const start = unique[i];
    let end = start;
    while (i + 1 < unique.length && unique[i + 1] === end + 1) {
      i += 1;
      end = unique[i];
    }
    if (start === end) parts.push(DAY_NAMES_FULL[start]);
    else parts.push(`${DAY_NAMES_FULL[start]}–${DAY_NAMES_FULL[end]}`);
    i += 1;
  }
  return parts.join(", ");
};

const buildConciseShareMessageFromResults = ({
  results,
  shareMode,
  selectedTeacherId,
  selectedTeacher,
  user,
  timezoneFriendlyLabel,
}) => {
  const list = ([]
    .concat(results?.exactMatches || [])
    .concat(results?.flexibleMatches || []))
    .filter(Boolean);

  const isAdminAllTeachers = shareMode === 'admin' && selectedTeacherId === ALL_TEACHERS_OPTION_VALUE;
  const subjectLabel = isAdminAllTeachers
    ? 'Availability (all teachers)'
    : (shareMode === 'admin' && selectedTeacher
      ? `Availability (${(selectedTeacher.firstName || "")} ${(selectedTeacher.lastName || "")}`.trim() + ')'
      : `Availability (${(user?.firstName || "")} ${(user?.lastName || "")}`.trim() + ')');

  const headerLines = [subjectLabel];
  if (timezoneFriendlyLabel) {
    headerLines.push(`Times shown in: ${timezoneFriendlyLabel}`);
  }

  const formatSlotsByDay = (slots = []) => {
    const byDay = new Map();

    for (const slot of slots) {
      const dayOfWeek = Number(slot?.dayOfWeek);
      if (!Number.isFinite(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;

      const start = slot?.displayStart;
      const end = slot?.displayEnd;
      const startMin = parseTimeToMinutes(start);
      const endMin = parseTimeToMinutes(end);

      if (!byDay.has(dayOfWeek)) byDay.set(dayOfWeek, []);
      byDay.get(dayOfWeek).push({
        start,
        end,
        startMin: startMin ?? Number.POSITIVE_INFINITY,
        endMin: endMin ?? Number.POSITIVE_INFINITY,
      });
    }

    const lines = [];
    for (let day = 0; day <= 6; day += 1) {
      const ranges = byDay.get(day);
      if (!Array.isArray(ranges) || ranges.length === 0) continue;

      const sorted = ranges
        .slice()
        .sort((a, b) => (a.startMin - b.startMin) || (a.endMin - b.endMin) || String(a.start || '').localeCompare(String(b.start || '')));

      // De-dupe identical ranges
      const unique = [];
      for (const r of sorted) {
        const last = unique[unique.length - 1];
        if (last && last.start === r.start && last.end === r.end) continue;
        unique.push(r);
      }

      const dayLabel = DAY_NAMES_FULL[day] || 'Day';

      lines.push(`${dayLabel}:`);
      for (const r of unique) {
        lines.push(`  ${formatTimeRangeSmart(r.start, r.end)}`);
      }
    }

    return lines;
  };

  const formatTeacherBlock = (teacherResult) => {
    const teacherName = teacherResult?.teacher?.name || 'Teacher';
    const slots = Array.isArray(teacherResult?.availableSlots) ? teacherResult.availableSlots : [];
    if (!slots.length) return [teacherName, 'No available time slots found.'];

    const lines = formatSlotsByDay(slots);
    return [teacherName, ...lines];
  };

  // For a single teacher message, avoid repeating the teacher name twice.
  if (!isAdminAllTeachers && list.length === 1) {
    const teacherResult = list[0];
    const slots = Array.isArray(teacherResult?.availableSlots) ? teacherResult.availableSlots : [];
    if (!slots.length) return [...headerLines, '', 'No available time slots found.'].join('\n');

    const lines = formatSlotsByDay(slots);

    return [...headerLines, '', ...lines].join('\n');
  }

  const blocks = list.map((teacherResult) => {
    const blockLines = formatTeacherBlock(teacherResult);
    return blockLines.join('\n');
  });

  return [...headerLines, '', ...blocks].join('\n\n');
};

const prettifyTimezoneLabel = (label = "", value = "") => {
  const cleanedLabel = label.trim();

  if (cleanedLabel) {
    const match = cleanedLabel.match(/^([^()]+)\s*\(([^)]+)\)\s*(GMT[+\-0-9:]+)/i);
    if (match) {
      const city = match[1].trim();
      const offset = match[3].trim();
      return `${city} time (${offset})`;
    }

    if (/GMT/i.test(cleanedLabel)) {
      const [cityPart, offsetPart] = cleanedLabel.split(/\s+(GMT[+\-0-9:]+)/i).filter(Boolean);
      const city = cityPart?.replace(/_/g, " ")?.trim();
      const offset = offsetPart?.toUpperCase();
      if (city && offset) {
        return `${city} time (${offset})`;
      }
      return cleanedLabel.replace(/_/g, " ");
    }

    return cleanedLabel.replace(/_/g, " ");
  }

  if (value) {
    const parts = value.split("/");
    const city = (parts[parts.length - 1] || value).replace(/_/g, " ");
    const region = parts.length > 1 ? parts[0].replace(/_/g, " ") : "";
    return region ? `${city}, ${region}` : city;
  }

  return "";
};
const ClassesPage = ({ isActive = true }) => {
  // router hooks for tab sync and route-backed modals
  const location = useLocation();
  const navigate = useNavigate();
  const { searchTerm, globalFilter } = useSearch();
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm || "");
  const getInitialTab = () => {

    try {
      const q = new URLSearchParams(location.search);
      return q.get('tab') || 'upcoming';
    } catch (e) {
      return 'upcoming';
    }
  };
  const getInitialLayout = () => {
    try {
      const q = new URLSearchParams(location.search);
      const layout = q.get('layout');
      return layout === 'calendar' ? 'calendar' : 'list';
    } catch (e) {
      return 'list';
    }
  };

  const getInitialPage = () => {
    try {
      const q = new URLSearchParams(location.search);
      const raw = Number(q.get('page') || '1');
      return Number.isFinite(raw) && raw > 0 ? raw : 1;
    } catch (e) {
      return 1;
    }
  };

  const [tabFilter, setTabFilter] = useState(getInitialTab);
  const [viewLayout, setViewLayout] = useState(getInitialLayout);
  const isCalendarView = viewLayout === 'calendar';
  const { isAdmin, isTeacher, user } = useAuth();
  const adminTimezone = user?.timezone || DEFAULT_TIMEZONE;
  const createAvailabilityState = useMemo(() => (overrides = {}) => ({
    slots: [],
    slotsByDay: {},
    availabilityStatus: 'default_24_7',
    isDefaultAvailability: true,
    timezone: user?.timezone || DEFAULT_TIMEZONE,
    ...overrides
  }), [user?.timezone]);
  const isAdminUser = isAdmin();
  const isTeacherUser = isTeacher();
  const isGuardianUser = user?.role === 'guardian';
  const canViewMeetings = isAdminUser || isTeacherUser || isGuardianUser;

  const [classes, setClasses] = useState([]);
  const [classesCorpus, setClassesCorpus] = useState([]);
  const loadedClassPagesRef = useRef(new Set());
  const [meetings, setMeetings] = useState([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportMeeting, setReportMeeting] = useState(null);
  const [showAllMobileMeetings, setShowAllMobileMeetings] = useState(false);
  const [isLargeScreen, setIsLargeScreen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(`(min-width: ${DESKTOP_MEETING_SPLIT_MIN_WIDTH}px)`).matches;
  });
  
  const [teachers, setTeachers] = useState([]);
  const [guardians, setGuardians] = useState([]);
  const [students, setStudents] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortBy] = useState("scheduledDate");
  const [sortOrder] = useState("asc");
  const [statusFilter] = useState("all");
  const [teacherFilter] = useState("all");
  const [guardianFilter] = useState("all");
  const [expandedClass, setExpandedClass] = useState(null);
  const [currentPage, setCurrentPage] = useState(getInitialPage);
  const [totalPages, setTotalPages] = useState(1);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSeriesScanner, setShowSeriesScanner] = useState(false);
  const [seriesScannerLoading, setSeriesScannerLoading] = useState(false);
  const [seriesScannerError, setSeriesScannerError] = useState("");
  const [seriesScannerList, setSeriesScannerList] = useState([]);
  const [seriesScannerSearch, setSeriesScannerSearch] = useState("");
  const [seriesRecreatingId, setSeriesRecreatingId] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editClass, setEditClass] = useState(null);
  const [editAvailabilityWarning, setEditAvailabilityWarning] = useState(null);
  
  const [editStudents, setEditStudents] = useState([]);
  const [editUpdateScope, setEditUpdateScope] = useState("single");
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [rescheduleClass, setRescheduleClass] = useState(null);
  const [showRescheduleRequestModal, setShowRescheduleRequestModal] = useState(false);
  const [requestClass, setRequestClass] = useState(null);
  const [rescheduleDetailsOpen, setRescheduleDetailsOpen] = useState(false);
  const [rescheduleDetailsNotification, setRescheduleDetailsNotification] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteClass, setDeleteClass] = useState(null);
  const { start: startDeleteCountdown } = useDeleteClassCountdown();
  // Ref to avoid temporal-dead-zone errors when effects reference fetchClasses
  const fetchClassesRef = useRef(null);
  const fetchTeachersRef = useRef(null);
  const fetchGuardiansRef = useRef(null);
  const adminTimezoneRef = useRef(adminTimezone);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateClass, setDuplicateClass] = useState(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTargetClass, setCancelTargetClass] = useState(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareMode, setShareMode] = useState(isTeacherUser ? "teacher" : "admin");
  const [shareLoading, setShareLoading] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [targetTimezone, setTargetTimezone] = useState(adminTimezone);
  const [teacherAvailability, setTeacherAvailability] = useState(() => createAvailabilityState());
  const [calendarAvailability, setCalendarAvailability] = useState(null);
  const [calendarAvailabilityTeacherId, setCalendarAvailabilityTeacherId] = useState(null);
  const [calendarAvailabilityEnabled, setCalendarAvailabilityEnabled] = useState(false);
  const [calendarAvailabilityLabel, setCalendarAvailabilityLabel] = useState("");
  const [calendarAvailabilityLoading, setCalendarAvailabilityLoading] = useState(false);
  const [timezoneOptions, setTimezoneOptions] = useState([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState(null);
  const [selectedGuardianId, setSelectedGuardianId] = useState(null);
  const [recipientPhone, setRecipientPhone] = useState("");
  const [classDetails, setClassDetails] = useState({});
  const [classPolicies, setClassPolicies] = useState({});
  const [focusedClassId, setFocusedClassId] = useState(null);
  const [, setFocusedPolicy] = useState(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState("");

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
    resetNewClassForm();
  };

  const fetchSeriesScannerList = useCallback(async () => {
    if (!isAdminUser) return;
    setSeriesScannerLoading(true);
    setSeriesScannerError("");
    try {
      const res = await api.get('/classes/series', { params: { limit: 500 } });
      setSeriesScannerList(res.data?.series || []);
    } catch (err) {
      console.error('Failed to load series scanner list:', err);
      setSeriesScannerError(err?.response?.data?.message || 'Failed to load series');
      setSeriesScannerList([]);
    } finally {
      setSeriesScannerLoading(false);
    }
  }, [isAdminUser]);

  useEffect(() => {
    if (!showSeriesScanner) return;
    fetchSeriesScannerList();
  }, [showSeriesScanner, fetchSeriesScannerList]);

  const handleRecreateSeriesInstances = useCallback(async (pattern) => {
    const patternId = pattern?._id;
    if (!patternId) return;
    setSeriesRecreatingId(patternId);
    try {
      await api.post(`/classes/series/${patternId}/recreate`);
      await fetchSeriesScannerList();
      await fetchClassesRef.current?.();
    } catch (err) {
      console.error('Failed to recreate series instances:', err);
      alert(err?.response?.data?.message || 'Failed to recreate series instances');
    } finally {
      setSeriesRecreatingId(null);
    }
  }, [fetchSeriesScannerList]);

  const formatAlternativeSlot = (alt) => {
    const start = alt?.startDateTime || alt?.start || alt?.startTime;
    const end = alt?.endDateTime || alt?.end || alt?.endTime;
    const startLabel = alt?.startLocal || (start ? new Date(start).toLocaleString() : '');
    const endLabel = alt?.endLocal || (end ? new Date(end).toLocaleString() : '');
    if (!startLabel && !endLabel) return '';
    const tz = alt?.timezone ? ` (${alt.timezone})` : '';
    return `${startLabel}${endLabel ? ` – ${endLabel}` : ''}${tz}`;
  };

  const buildAvailabilityWarningFromApi = (data = {}) => {
    const ae = data?.availabilityError || {};
    const reason = ae?.reason || '';

    let details = '';
    if (ae?.conflictType === 'existing_class' && ae?.conflictDetails) {
      const cd = ae.conflictDetails;
      const tz = cd?.timezone || '';
      const start = cd?.startLocal || (cd?.startTime ? new Date(cd.startTime).toLocaleString() : '');
      const end = cd?.endLocal || (cd?.endTime ? new Date(cd.endTime).toLocaleString() : '');
      const who = cd?.studentName || 'another class';
      const what = cd?.subject ? ` (${cd.subject})` : '';
      const when = start && end ? `${start} – ${end}${tz ? ` (${tz})` : ''}` : '';
      details = `${who}${what}${when ? ` • ${when}` : ''}`;
    } else if (ae?.conflictType === 'no_availability' && ae?.conflictDetails) {
      const cd = ae.conflictDetails;
      const slotsForDay = Array.isArray(cd?.slotsForDay) ? cd.slotsForDay : [];
      const slotLabel = slotsForDay.length
        ? slotsForDay.map((s) => `${s.startTime}–${s.endTime}`).join(', ')
        : 'none';
      details = `Requested: ${cd?.requested?.startLocal || ''} – ${cd?.requested?.endLocal || ''} (${cd?.teacherTimezone || ''})\nWindows: ${slotLabel}`;
    }

    const alternatives = Array.isArray(ae?.alternatives) ? ae.alternatives : [];
    const nearest = alternatives.length ? formatAlternativeSlot(alternatives[0]) : '';
    const suggested = alternatives
      .slice(0, 3)
      .map((alt) => formatAlternativeSlot(alt))
      .filter(Boolean);

    return {
      title: data?.message || 'Teacher not available',
      reason,
      details,
      nearest,
      suggested,
    };
  };

  const [newClass, setNewClass] = useState({
    title: "",
    description: "",
    subject: "",
    teacher: "",
    student: { guardianId: "", studentId: "", studentName: "" },
    isRecurring: false,
    scheduledDate: "",
    duration: 60,
    recurrenceDetails: [{ dayOfWeek: 1, time: "18:00", duration: 60, timezone: adminTimezone }],
    generationPeriodMonths: 2,
    timezone: adminTimezone,
    meetingLink: ""
  });

  const resolveTeacherInfo = useCallback((teacher) => {
    if (!teacher) return null;
    if (typeof teacher === "string") {
      return {
        id: teacher,
        label: "",
        haystack: []
      };
    }

    const id = teacher._id || teacher.id || teacher.userId || teacher.value || null;
    if (!id) return null;

    const first = (teacher.firstName || "").trim();
    const last = (teacher.lastName || "").trim();
    const displayName = `${first} ${last}`.replace(/\s+/g, " ").trim();
    const fallbackName = (teacher.name || teacher.displayName || teacher.fullName || "").trim();
    const label = displayName || fallbackName || "";

    const haystack = [
      displayName,
      fallbackName,
      teacher.email,
      teacher.preferredName,
      teacher.nickName,
      teacher.username,
      teacher.handle,
      teacher.phone
    ]
      .filter(Boolean)
      .map((value) => value.toString().toLowerCase());

    if (label) {
      const lowerLabel = label.toLowerCase();
      if (!haystack.includes(lowerLabel)) {
        haystack.push(lowerLabel);
      }
    }

    return { id, label, haystack };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm || "");
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const normalizedSearchTerm = useMemo(
    () => (debouncedSearchTerm || "").trim().toLowerCase(),
    [debouncedSearchTerm]
  );

  const filteredClasses = useMemo(() => classes || [], [classes]);


  const mapAvailabilityResponse = useCallback((raw = {}) => createAvailabilityState({
    slots: raw.slots || [],
    slotsByDay: raw.slotsByDay || {},
    availabilityStatus: raw.availabilityStatus || 'default_24_7',
    isDefaultAvailability: typeof raw.isDefaultAvailability === 'boolean'
      ? raw.isDefaultAvailability
      : ((raw.availabilityStatus || 'default_24_7') === 'default_24_7' && (raw.slots?.length || 0) === 0),
    timezone: raw.timezone || user?.timezone || DEFAULT_TIMEZONE
  }), [createAvailabilityState, user?.timezone]);

  const fetchTeacherAvailability = useCallback(async (teacherId) => {
    const targetTeacherId = teacherId || user?._id;
    if (!targetTeacherId) return null;
    try {
      const res = await api.get(`/availability/slots/${targetTeacherId}`);
      const availabilityPayload = mapAvailabilityResponse(res.data || {});
      setTeacherAvailability(availabilityPayload);
      return availabilityPayload;
    } catch (err) {
      console.error("Fetch teacher availability error:", err);
      const fallback = createAvailabilityState({
        availabilityStatus: 'unknown',
        isDefaultAvailability: false,
        timezone: user?.timezone || DEFAULT_TIMEZONE
      });
      setTeacherAvailability(fallback);
      return fallback;
    }
  }, [createAvailabilityState, mapAvailabilityResponse, user?._id, user?.timezone]);


  // When filters change, reset to the first page.
  useEffect(() => {
    if (!isActive) return;
    setCurrentPage(1);
    loadedClassPagesRef.current = new Set();
    setClassesCorpus([]);
  }, [isActive, globalFilter, statusFilter, teacherFilter, guardianFilter, tabFilter, normalizedSearchTerm]);

  useEffect(() => {
    if (!isActive) return;
    // Avoid referencing callback consts before initialization (TDZ) by calling refs.
    if (fetchClassesRef.current) {
      fetchClassesRef.current();
    }

    if (!isAdminUser) {
      setTeachers([]);
      setGuardians([]);
    }
  }, [
    isActive,
    globalFilter,
    sortBy,
    sortOrder,
    statusFilter,
    teacherFilter,
    guardianFilter,
    tabFilter,
    currentPage,
    isAdminUser,
  ]);

  useEffect(() => {
    if (!isActive || !isAdminUser) return;
    if (!teachers.length && fetchTeachersRef.current) {
      fetchTeachersRef.current({ force: false });
    }
    if (!guardians.length && fetchGuardiansRef.current) {
      fetchGuardiansRef.current({ force: false });
    }
  }, [guardians.length, isActive, isAdminUser, teachers.length]);

  // Server-side search is used now; no background prefetch needed.

  // Listen for external refresh requests (e.g., after class report submit from route modal)
  // Use a ref to avoid referencing fetchClasses before it's initialized (TDZ)
  
  useEffect(() => {
    const handler = () => {
      try {
        if (fetchClassesRef.current) fetchClassesRef.current();
      } catch (err) {
        // swallow any timing related errors; fetch will run on next normal cycle
        // console.debug('classes:refresh handler error', err);
      }
    };
    window.addEventListener('classes:refresh', handler);
    return () => window.removeEventListener('classes:refresh', handler);
  }, []);

  useEffect(() => {
    setTimezoneOptions(getTimezoneOptions());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return () => {};
    const mediaQuery = window.matchMedia(`(min-width: ${DESKTOP_MEETING_SPLIT_MIN_WIDTH}px)`);
    const handleChange = (event) => setIsLargeScreen(event.matches);
    handleChange(mediaQuery);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);
  
  useEffect(() => {
    if (isTeacherUser && user?._id) {
      fetchTeacherAvailability(user._id);
    }
  }, [fetchTeacherAvailability, isTeacherUser, user?._id]);

  useEffect(() => {
    setTargetTimezone(adminTimezone);
  }, [adminTimezone]);

  useEffect(() => {
    setNewClass((prev) => {
      if (!prev) return prev;
      const shouldUpdateTimezone = !prev.timezone || prev.timezone === adminTimezoneRef.current;
      if (!shouldUpdateTimezone) return prev;
      return {
        ...prev,
        timezone: adminTimezone,
        recurrenceDetails: (prev.recurrenceDetails || []).map((slot) => ({
          ...slot,
          timezone: adminTimezone,
        })),
      };
    });
    adminTimezoneRef.current = adminTimezone;
  }, [adminTimezone]);

  useEffect(() => {
    if (shareMode === "admin" && showShareModal && !selectedTeacherId && teachers.length > 0) {
      const defaultTeacherId = teachers[0]._id;
      setSelectedTeacherId(defaultTeacherId);
      fetchTeacherAvailability(defaultTeacherId);
    }
  }, [fetchTeacherAvailability, shareMode, showShareModal, selectedTeacherId, teachers]);

  useEffect(() => {
    if (viewLayout !== "calendar") {
      setCalendarAvailabilityEnabled(false);
      setCalendarAvailability(null);
      setCalendarAvailabilityTeacherId(null);
      setCalendarAvailabilityLabel("");
      setCalendarAvailabilityLoading(false);
      return;
    }

    if (!normalizedSearchTerm) {
      setCalendarAvailabilityEnabled(false);
      setCalendarAvailability(null);
      setCalendarAvailabilityTeacherId(null);
      setCalendarAvailabilityLabel("");
      return;
    }

    const candidateMap = new Map();

    (teachers || []).forEach((teacher) => {
      const info = resolveTeacherInfo(teacher);
      if (info?.id && !candidateMap.has(info.id)) {
        candidateMap.set(info.id, info);
      }
    });

    (classes || []).forEach((classItem) => {
      const info = resolveTeacherInfo(classItem?.teacher);
      if (info?.id && !candidateMap.has(info.id)) {
        candidateMap.set(info.id, info);
      }
    });

    const candidates = Array.from(candidateMap.values());
    const matched = candidates.find((candidate) =>
      Array.isArray(candidate.haystack) && candidate.haystack.some((value) => value.includes(normalizedSearchTerm))
    );

    if (!matched) {
      setCalendarAvailabilityEnabled(false);
      setCalendarAvailability(null);
      setCalendarAvailabilityTeacherId(null);
      setCalendarAvailabilityLabel("");
      setCalendarAvailabilityLoading(false);
      return;
    }

    if (calendarAvailabilityTeacherId === matched.id) {
      if (matched.label && matched.label !== calendarAvailabilityLabel) {
        setCalendarAvailabilityLabel(matched.label);
      }
      return;
    }

    let cancelled = false;

    const loadAvailability = async () => {
      setCalendarAvailabilityLoading(true);
      try {
        const availabilityPayload = await fetchTeacherAvailability(matched.id);
        if (cancelled) return;
        setCalendarAvailability(availabilityPayload);
        setCalendarAvailabilityTeacherId(matched.id);
        setCalendarAvailabilityLabel(matched.label || "");
        setCalendarAvailabilityEnabled(true);
      } catch (error) {
        if (cancelled) return;
        console.error("Calendar availability fetch error:", error);
        setCalendarAvailabilityEnabled(false);
        setCalendarAvailability(null);
        setCalendarAvailabilityTeacherId(null);
      } finally {
        if (!cancelled) {
          setCalendarAvailabilityLoading(false);
        }
      }
    };

    loadAvailability();

    return () => {
      cancelled = true;
    };
  }, [
    calendarAvailabilityLabel,
    calendarAvailabilityTeacherId,
    classes,
    fetchTeacherAvailability,
    normalizedSearchTerm,
    resolveTeacherInfo,
    teachers,
    viewLayout
  ]);

  // router hooks for route-backed modals

  // Keep tabFilter in sync when the URL query string changes (Back/Forward or manual URL edits)
  useEffect(() => {
    if (!isActive) return;
    const q = new URLSearchParams(location.search);
    const tab = q.get('tab') || 'upcoming';
    if (tab !== tabFilter) setTabFilter(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, location.search]);

  // Sync currentPage from URL (Back/Forward)
  useEffect(() => {
    if (!isActive) return;
    try {
      const q = new URLSearchParams(location.search);
      const raw = Number(q.get('page') || '1');
      const next = Number.isFinite(raw) && raw > 0 ? raw : 1;
      if (next !== currentPage) setCurrentPage(next);
    } catch (e) {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, location.search]);

  // Persist currentPage in URL (refresh keeps your place)
  useEffect(() => {
    if (!isActive) return;
    try {
      const q = new URLSearchParams(location.search);
      const currentParam = Number(q.get('page') || '1');
      if (currentParam === Number(currentPage || 1)) return;
      q.set('page', String(currentPage || 1));
      navigate(`${location.pathname}?${q.toString()}`, { replace: false });
    } catch (e) {
      // ignore
    }
  }, [isActive, currentPage, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!isActive) return;
    const q = new URLSearchParams(location.search);
    const layout = q.get('layout');
    const normalized = layout === 'calendar' ? 'calendar' : 'list';
    if (normalized !== viewLayout) setViewLayout(normalized);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, location.search]);

  const toggleCalendarAvailability = useCallback(() => {
    if (!calendarAvailability) return;
    setCalendarAvailabilityEnabled((prev) => !prev);
  }, [calendarAvailability]);

  const refreshCalendarAvailability = useCallback(
    async (teacherIdOverride) => {
      const targetId = teacherIdOverride || calendarAvailabilityTeacherId;
      if (!targetId) return null;

      setCalendarAvailabilityLoading(true);
      try {
        const availabilityPayload = await fetchTeacherAvailability(targetId);
        setCalendarAvailability(availabilityPayload);
        setCalendarAvailabilityTeacherId(targetId);
        return availabilityPayload;
      } catch (error) {
        console.error("Calendar availability refresh error:", error);
        throw error;
      } finally {
        setCalendarAvailabilityLoading(false);
      }
    },
    [calendarAvailabilityTeacherId, fetchTeacherAvailability]
  );

  const canEditCalendarAvailability = useMemo(() => {
    if (!calendarAvailabilityTeacherId) return false;
    if (isAdminUser) return true;
    if (isTeacherUser && user?._id) {
      return String(calendarAvailabilityTeacherId) === String(user._id);
    }
    return false;
  }, [calendarAvailabilityTeacherId, isAdminUser, isTeacherUser, user?._id]);

  const handleLayoutChange = (nextLayout) => {
    if (nextLayout === viewLayout) return;
    const q = new URLSearchParams(location.search);
    q.set('view', 'classes');
    q.set('layout', nextLayout);
    q.set('page', '1');
    navigate(`${location.pathname}?${q.toString()}`, { state: { background: location.state?.background }, replace: false });
    setViewLayout(nextLayout);
  };

  const handleTabChange = (nextTab) => {
    if (!nextTab) return;
    const q = new URLSearchParams(location.search);
    q.set('tab', nextTab);
    q.set('view', 'classes');
    q.set('page', '1');
    navigate(`${location.pathname}?${q.toString()}`, { state: { background: location.state?.background }, replace: false });
    setTabFilter(nextTab);
  };

  const canOpenReport = (classItem) => {
    if (!classItem) return false;
    const now = new Date();
    const start = new Date(classItem.scheduledDate);
    const end = new Date(start.getTime() + (Number(classItem.duration || 0) * 60000));

    if (isAdminUser) {
      // admin can always open report for past classes
      return now >= end;
    }

    // teacher rule
    if (isTeacherUser) {
      // only the assigned teacher can open
      const teacherId = classItem.teacher?._id || classItem.teacher;
      if (!teacherId || String(teacherId) !== String(user?._id)) return false;

      // Must be after class ends
      if (now < end) return false;

      // Check if report already submitted - always allow viewing
      if (classItem.classReport?.submittedAt) return true;

      // Check submission window status
      const submissionStatus = classItem.reportSubmission?.status;
      
      // Show button if:
      // - No status yet (class just ended, tracking not initialized) - allow
      // - Status is 'pending' (class hasn't ended tracking)
      // - Status is 'open' (within 72-hour window)
      // - Status is 'admin_extended' (admin granted extension)
      if (!submissionStatus || 
          submissionStatus === 'pending' || 
          submissionStatus === 'open' || 
          submissionStatus === 'admin_extended') {
        return true;
      }

      // Hide button if status is 'unreported' - teacher needs admin to grant extension
      if (submissionStatus === 'unreported') {
        return false;
      }

      // Default: allow if class ended (for any edge cases)
      return true;
    }

    return false;
  };

// Fetch classes with filter
const fetchClasses = useCallback(async () => {
  try {
    const cacheKey = makeCacheKey(
      'classes:list',
      user?._id,
      {
        page: currentPage,
        limit: 30,
        filter: tabFilter,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        teacher: teacherFilter !== 'all' ? teacherFilter : undefined,
        guardian: guardianFilter !== 'all' ? guardianFilter : undefined,
        global: globalFilter && globalFilter !== 'all' ? globalFilter : undefined,
        search: normalizedSearchTerm || undefined,
      }
    );

    const cached = readCache(cacheKey, { deps: ['classes'] });
    if (cached.hit && cached.value) {
      const cachedClasses = cached.value.classes || [];
      const cachedTotalPages = cached.value.totalPages || 1;
      setClasses(cachedClasses);
      setTotalPages(cachedTotalPages);
      setError('');
      setLoading(false);

      // Background revalidate if cache is getting old (keeps data fresh without blocking UI)
      if (cached.ageMs < 60_000) {
        return;
      }
    } else {
      setLoading(true);
    }

    const params = {
      page: currentPage,
      limit: 30,
      filter: tabFilter, // "upcoming" or "previous"
      sortBy: "scheduledDate",
      order: "asc",
    };

    if (statusFilter !== "all") params.status = statusFilter;
    if (teacherFilter !== "all") params.teacher = teacherFilter;
    if (guardianFilter !== "all") params.guardian = guardianFilter;
    
    // Apply global filter
    if (globalFilter && globalFilter !== 'all') {
      params.status = globalFilter;
    }

    if (normalizedSearchTerm) {
      params.search = normalizedSearchTerm;
    }

    const res = await api.get("/classes", { params });
    const fetchedClasses = res.data.classes || [];

    // Backend already sorts by scheduledDate, so no need to sort again
    setClasses(fetchedClasses);
    loadedClassPagesRef.current.add(currentPage);
    setClassesCorpus((prev) => {
      const map = new Map();
      (prev || []).forEach((c) => {
        const id = c?._id ? String(c._id) : null;
        if (id) map.set(id, c);
      });
      fetchedClasses.forEach((c) => {
        const id = c?._id ? String(c._id) : null;
        if (id) map.set(id, c);
      });
      const merged = Array.from(map.values());
      merged.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));
      return merged;
    });
    const apiTotalPages = Number(res.data?.pagination?.totalPages);
    setTotalPages(Number.isFinite(apiTotalPages) && apiTotalPages > 0 ? apiTotalPages : 1);
    setError("");

    writeCache(
      cacheKey,
      {
        classes: fetchedClasses,
        totalPages: Number.isFinite(apiTotalPages) && apiTotalPages > 0 ? apiTotalPages : 1,
      },
      { ttlMs: 5 * 60_000, deps: ['classes'] }
    );
  } catch (err) {
    console.error("Fetch classes error:", err);
    setError("Failed to fetch classes");
  } finally {
    setLoading(false);
  }
}, [
  currentPage,
  globalFilter,
  guardianFilter,
  normalizedSearchTerm,
  statusFilter,
  tabFilter,
  teacherFilter,
  user?._id,
]);

// Keep a ref reference to fetchClasses so effects that are created earlier can call it
fetchClassesRef.current = fetchClasses;

  const openPendingRescheduleDetails = useCallback((classItem) => {
    if (!isAdminUser) return;
    if (!classItem?._id) return;

    const pending = classItem?.pendingReschedule;
    if (!pending || pending.status !== "pending") return;

    const teacherId = String(classItem?.teacher?._id || classItem?.teacher || "");
    const guardianId = String(classItem?.student?.guardianId?._id || classItem?.student?.guardianId || "");
    const studentId = String(classItem?.student?.studentId?._id || classItem?.student?.studentId || "");

    const teacherName = classItem?.teacher
      ? `${classItem.teacher.firstName || ""} ${classItem.teacher.lastName || ""}`.trim() || classItem.teacher.email
      : "";

    const guardianName = classItem?.student?.guardianId
      ? `${classItem.student.guardianId.firstName || ""} ${classItem.student.guardianId.lastName || ""}`.trim() || classItem.student.guardianId.email
      : "";

    const studentName = classItem?.student?.studentName || "";

    setRescheduleDetailsNotification({
      _id: `class-${classItem._id}-pending-reschedule`,
      relatedId: classItem._id,
      actionRequired: true,
      metadata: {
        kind: "class_reschedule_request",
        classId: String(classItem._id),
        teacherId,
        guardianId,
        studentId,
        teacherName,
        guardianName,
        studentName,
        requestedByRole: pending.requestedByRole,
        requestedById: pending.requestedBy ? String(pending.requestedBy) : undefined,
        originalDate: pending.originalDate || classItem.scheduledDate,
        proposedDate: pending.proposedDate,
        proposedDuration: pending.proposedDuration,
      },
    });
    setRescheduleDetailsOpen(true);
  }, [isAdminUser]);

  const fetchMeetings = useCallback(async (rangeOverride = {}) => {
    if (!canViewMeetings) return;
    try {
      setMeetingsLoading(true);
      const lookbackDays = Number(rangeOverride.lookbackDays || MEETING_LOOKBACK_DAYS);
      const lookaheadDays = Number(rangeOverride.lookaheadDays || MEETING_LOOKAHEAD_DAYS);
      const windowStart = rangeOverride.rangeStart || moment().subtract(lookbackDays, 'days').toISOString();
      const windowEnd = rangeOverride.rangeEnd || moment().add(lookaheadDays, 'days').toISOString();
      const meetingResponse = await listMeetings({
        rangeStart: windowStart,
        rangeEnd: windowEnd,
        limit: rangeOverride.limit || 200
      });
      setMeetings(Array.isArray(meetingResponse) ? meetingResponse : []);
    } catch (err) {
      console.error('Fetch meetings error:', err);
    } finally {
      setMeetingsLoading(false);
    }
  }, [canViewMeetings]);

  useEffect(() => {
    if (!canViewMeetings) return;
    fetchMeetings();
  }, [canViewMeetings, isCalendarView, fetchMeetings]);

  useEffect(() => {
    setShowAllMobileMeetings(false);
  }, [tabFilter, isLargeScreen, viewLayout]);

  const handleAdminTeacherChange = async (teacherId) => {
    const nextTeacherId = teacherId || null;
    setSelectedTeacherId(nextTeacherId);
    setShareMessage("");
    setSelectedGuardianId(null);
    setRecipientPhone("");

    if (!nextTeacherId || nextTeacherId === ALL_TEACHERS_OPTION_VALUE) {
      setTeacherAvailability(createAvailabilityState({
        availabilityStatus: 'unknown',
        isDefaultAvailability: false
      }));
      return;
    }

    await fetchTeacherAvailability(nextTeacherId);
  };

  const handleGuardianSelection = (guardianId) => {
    setSelectedGuardianId(guardianId || null);

    if (!guardianId) {
      setRecipientPhone("");
      return;
    }

    const guardianRecord = guardians.find((g) => String(g._id) === String(guardianId));
    const fallbackPhone = guardianRecord?.phone
      || guardianRecord?.phoneNumber
      || guardianRecord?.whatsapp
      || guardianRecord?.contactNumber
      || guardianRecord?.emergencyContact?.phone
      || "";
    setRecipientPhone(fallbackPhone);
  };

  const handleOpenShareModal = async () => {
    const nextMode = isAdminUser ? "admin" : "teacher";
    setShareMode(nextMode);
    setShareMessage("");
    setSelectedGuardianId(null);
    setRecipientPhone("");
    setTargetTimezone(user?.timezone || DEFAULT_TIMEZONE);

    if (nextMode === "teacher" && isTeacherUser && user?._id) {
      await fetchTeacherAvailability(user._id);
    }

    if (nextMode === "admin") {
      const defaultTeacher = selectedTeacherId || teachers?.[0]?._id || ALL_TEACHERS_OPTION_VALUE;
      setSelectedTeacherId(defaultTeacher);
      if (defaultTeacher && defaultTeacher !== ALL_TEACHERS_OPTION_VALUE) {
        await fetchTeacherAvailability(defaultTeacher);
      } else {
        setTeacherAvailability(createAvailabilityState({
          availabilityStatus: 'unknown',
          isDefaultAvailability: false
        }));
      }
    }

    setShowShareModal(true);
  };

  // Floating FAB cluster is now handled by a reusable component (FABCluster)

  const handleGenerateShareMessage = async () => {
    const isAdminAllTeachers = shareMode === 'admin' && selectedTeacherId === ALL_TEACHERS_OPTION_VALUE;
    const isAdminSpecificTeacher = shareMode === 'admin' && selectedTeacherId && selectedTeacherId !== ALL_TEACHERS_OPTION_VALUE;

    if (shareMode === 'admin' && !selectedTeacherId) {
      setShareMessage("Select a teacher (or All teachers) before generating a share message.");
      return;
    }

    if (isAdminSpecificTeacher) {
      await fetchTeacherAvailability(selectedTeacherId);
    }

    if (!isAdminAllTeachers && !hasShareableAvailability) {
      setShareMessage("No availability information available. Please refresh or add slots.");
      return;
    }
    try {
      setShareLoading(true);

      if (isAdminAllTeachers) {
        const payload = {
          studentAvailability: { preferredDays: [0, 1, 2, 3, 4, 5, 6], timeSlots: [], duration: 60 },
          additionalCriteria: {},
          flexibility: {},
          teacherId: null
        };
        const res = await api.post("/availability/share", { ...payload, targetTimezone });
        const results = res.data?.results;
        if (results) {
          setShareMessage(buildConciseShareMessageFromResults({
            results,
            shareMode,
            selectedTeacherId,
            selectedTeacher,
            user,
            timezoneFriendlyLabel,
          }));
        } else {
          const rawMessage = res.data?.message || "No message generated";
          setShareMessage(buildFriendlyShareMessage(rawMessage));
        }
        return;
      }

      const isDefaultAvailability = teacherAvailability.isDefaultAvailability;
      let preferredDays = [];

      if (isDefaultAvailability) {
        preferredDays = [0, 1, 2, 3, 4, 5, 6];
      } else {
        preferredDays = Object.keys(teacherAvailability.slotsByDay || {})
          .map((k) => parseInt(k, 10))
          .filter((n) => !Number.isNaN(n));

        if (preferredDays.length === 0) {
          setShareMessage("No availability slots found to share.");
          return;
        }
      }

      let timeSlots = [];
      if (!isDefaultAvailability) {
        timeSlots = preferredDays.flatMap((day) => {
          const slotsForDay = teacherAvailability.slotsByDay?.[day] || [];
          return slotsForDay.map((slot) => ({
            dayOfWeek: day,
            startTime: slot.startTime,
            endTime: slot.endTime
          }));
        });

        if (timeSlots.length === 0) {
          setShareMessage("No availability slots found to share.");
          return;
        }
      }

      const payload = {
        studentAvailability: { preferredDays, timeSlots, duration: 60 },
        additionalCriteria: {},
        flexibility: {},
        teacherId: shareMode === "admin"
          ? (selectedTeacherId === ALL_TEACHERS_OPTION_VALUE ? undefined : selectedTeacherId)
          : (isTeacherUser ? user?._id : undefined)
      };

      const res = await api.post("/availability/share", { ...payload, targetTimezone });
      const results = res.data?.results;
      if (results) {
        setShareMessage(buildConciseShareMessageFromResults({
          results,
          shareMode,
          selectedTeacherId,
          selectedTeacher,
          user,
          timezoneFriendlyLabel,
        }));
      } else {
        const rawMessage = res.data?.message || "No message generated";
        setShareMessage(buildFriendlyShareMessage(rawMessage));
      }
    } catch (err) {
      console.error("Share availability error:", err);
      setShareMessage("Error generating share message");
    } finally {
      setShareLoading(false);
    }
  };

  const shareRegenerateTimeoutRef = useRef(null);
  const regenerateShareMessageRef = useRef(handleGenerateShareMessage);
  useEffect(() => {
    regenerateShareMessageRef.current = handleGenerateShareMessage;
  }, [handleGenerateShareMessage]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (!showShareModal) return;
      if (!shareMessage) return; // only auto-refresh if user already generated a message

      if (shareRegenerateTimeoutRef.current) {
        clearTimeout(shareRegenerateTimeoutRef.current);
      }

      shareRegenerateTimeoutRef.current = setTimeout(() => {
        try {
          regenerateShareMessageRef.current?.();
        } catch (e) {
          // ignore
        }
      }, 500);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('availability:refresh', scheduleRefresh);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('availability:refresh', scheduleRefresh);
      }
      if (shareRegenerateTimeoutRef.current) {
        clearTimeout(shareRegenerateTimeoutRef.current);
        shareRegenerateTimeoutRef.current = null;
      }
    };
  }, [showShareModal, shareMessage]);

  useEffect(() => {
    const handler = () => {
      try {
        if (calendarAvailabilityTeacherId) {
          refreshCalendarAvailability(calendarAvailabilityTeacherId);
        }
      } catch (e) {
        // ignore
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('availability:refresh', handler);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('availability:refresh', handler);
      }
    };
  }, [calendarAvailabilityTeacherId, refreshCalendarAvailability]);


  const annotateStudentsWithGuardian = (studentsList, guardianId) => {
    if (!Array.isArray(studentsList)) return [];

    const resolvedGuardianId = guardianId && typeof guardianId === 'object'
      ? guardianId._id || guardianId.id || guardianId.value || ''
      : guardianId;

    const guardianIdString = resolvedGuardianId ? String(resolvedGuardianId) : '';

    const guardianRecord = guardians.find(g => String(g._id) === guardianIdString);
    const guardianName = guardianRecord?.fullName
      || [guardianRecord?.firstName, guardianRecord?.lastName].filter(Boolean).join(' ').trim()
      || undefined;

    return studentsList.map(student => ({
      ...student,
      guardianId: guardianIdString,
      guardianName: student.guardianName || guardianName
    }));
  };

  const fetchTeachers = useCallback(async ({ force = false } = {}) => {
    if (!isAdminUser) {
      setTeachers([]);
      return;
    }

    if (!force && teachers.length > 0) return;

    const cacheKey = makeCacheKey('classes:teachers', user?._id, { role: 'teacher' });
    const cached = readCache(cacheKey, { deps: ['users', 'teachers'] });
    if (!force && cached.hit && Array.isArray(cached.value)) {
      setTeachers(cached.value);
      return;
    }

    try {
      const res = await api.get("/users", {
        params: { role: 'teacher', limit: 200, sortBy: 'firstName', order: 'asc' }
      });
      const list = res.data?.users || [];
      setTeachers(list);
      writeCache(cacheKey, list, { ttlMs: 10 * 60_000, deps: ['users', 'teachers'] });
    } catch (err) {
      console.error("Fetch teachers error:", err);
      setTeachers([]);
    }
  }, [isAdminUser, teachers.length, user?._id]);

  fetchTeachersRef.current = fetchTeachers;

  const fetchGuardians = useCallback(async ({ force = false } = {}) => {
    if (!isAdminUser) {
      setGuardians([]);
      return;
    }

    if (!force && guardians.length > 0) return;

    const cacheKey = makeCacheKey('classes:guardians', user?._id, { role: 'guardian' });
    const cached = readCache(cacheKey, { deps: ['users', 'guardians'] });
    if (!force && cached.hit && Array.isArray(cached.value)) {
      setGuardians(cached.value);
      return;
    }

    try {
      const res = await api.get("/users", {
        params: { role: 'guardian', limit: 200, sortBy: 'firstName', order: 'asc' }
      });
      const list = res.data?.users || [];
      setGuardians(list);
      writeCache(cacheKey, list, { ttlMs: 10 * 60_000, deps: ['users', 'guardians'] });
    } catch (err) {
      console.error("Fetch guardians error:", err);
      setGuardians([]);
    }
  }, [guardians.length, isAdminUser, user?._id]);

  fetchGuardiansRef.current = fetchGuardians;

  const fetchStudentsForGuardian = async (guardianId) => {
    try {
      const res = await api.get(`/users/${guardianId}/students`);
      const studentsList = res.data?.students || [];
      const annotated = annotateStudentsWithGuardian(studentsList, guardianId);
      setStudents(annotated);
      return annotated;
    } catch (err) {
      console.error("Fetch students error:", err);
      setStudents([]);
      return [];
    }
  };

  const handleGuardianChange = async (guardianId, options = {}) => {
    const { isEdit, preserveStudent } = options;
    if (isEdit) {
      setEditClass((prev) => ({
        ...prev,
        student: preserveStudent && prev?.student?.studentId
          ? { ...prev.student, guardianId }
          : { guardianId, studentId: "", studentName: "" }
      }));
    } else {
      setNewClass((prev) => ({
        ...prev,
        student: preserveStudent && prev?.student?.studentId
          ? { ...prev.student, guardianId }
          : { guardianId, studentId: "", studentName: "" }
      }));
    }

    if (guardianId) {
      await fetchStudentsForGuardian(guardianId);
    } else {
      setStudents([]);
    }
  };

  const handleStudentChange = (studentId, options = {}) => {
    const student = students.find((s) => s._id === studentId);
    const updated = {
      studentId,
      studentName: options.studentName || (student ? `${student.firstName} ${student.lastName}` : "")
    };

    if (options.isEdit) {
      setEditClass((prev) => ({
        ...prev,
        student: { ...prev.student, ...updated, ...(options.guardianId ? { guardianId: options.guardianId } : {}) }
      }));
    } else {
      setNewClass((prev) => ({
        ...prev,
        student: { ...prev.student, ...updated, ...(options.guardianId ? { guardianId: options.guardianId } : {}) }
      }));
    }
  };

  const addRecurrenceSlot = () => {
    setNewClass(prev => ({
      ...prev,
      recurrenceDetails: [
        ...prev.recurrenceDetails,
        {
          dayOfWeek: 1,
          time: "18:00",
          duration: 60,
          timezone: prev.timezone || adminTimezone
        }
      ]
    }));
  };

  const removeRecurrenceSlot = (index) => {
    setNewClass(prev => ({
      ...prev,
      recurrenceDetails: prev.recurrenceDetails.filter((_, i) => i !== index)
    }));
  };

  const updateRecurrenceSlot = (index, field, value) => {
    setNewClass(prev => ({
      ...prev,
      recurrenceDetails: prev.recurrenceDetails.map((slot, i) => 
        i === index ? { ...slot, [field]: value } : slot
      )
    }));
  };
  const handleCreateClass = async () => {
    const buildPayload = () => {
      const data = {
        title: newClass.title,
        description: newClass.description,
        subject: newClass.subject,
        teacher: newClass.teacher,
        student: newClass.student,
        timezone: newClass.timezone,
        meetingLink: newClass.meetingLink,
        isRecurring: newClass.isRecurring
      };

      if (newClass.isRecurring) {
        const uniqueDays = Array.from(
          new Set(
            (newClass.recurrenceDetails || [])
              .map(slot => (slot?.dayOfWeek === 0 || Number.isInteger(Number(slot?.dayOfWeek)) ? Number(slot.dayOfWeek) : null))
              .filter(day => day !== null && day >= 0 && day <= 6)
          )
        );

        if (uniqueDays.length === 0) {
          throw new Error("Recurring classes need at least one weekday.");
        }

        data.recurrence = {
          frequency: "weekly",
          interval: 1,
          daysOfWeek: uniqueDays,
          duration: newClass.recurrenceDetails[0]?.duration || 60,
          generationPeriodMonths: newClass.generationPeriodMonths
        };
        data.recurrenceDetails = newClass.recurrenceDetails;
      } else {
        data.scheduledDate = new Date(newClass.scheduledDate).toISOString();
        data.duration = newClass.duration;
      }

      return data;
    };

    const submitPayload = async (payload) => {
      const res = await api.post("/classes", payload);
      if (res.data.message) {
        setShowCreateModal(false);
        resetNewClassForm();
        await fetchClasses();
        alert(newClass.isRecurring ? "Recurring classes created successfully!" : "Class created successfully!");
      }
    };

    try {
      const payload = buildPayload();
      await submitPayload(payload);
    } catch (err) {
      if (err?.message === "Recurring classes need at least one weekday.") {
        alert("Recurring classes need at least one weekday.");
        return;
      }
      const duplicateInfo = err.response?.data?.duplicateSeries;
      if (err.response?.status === 409 && duplicateInfo && newClass.isRecurring) {
        const { studentName, subject } = duplicateInfo;
        const confirmation = window.confirm(
          `A recurring series for ${studentName || "this student"} with subject "${subject}" already exists.
Would you like to create another series anyway?`
        );

        if (confirmation) {
          try {
            const overridePayload = { ...buildPayload(), overrideDuplicateSeries: true };
            await submitPayload(overridePayload);
            return;
          } catch (overrideErr) {
            alert(overrideErr.response?.data?.message || "Error creating class");
            console.error(overrideErr);
            return;
          }
        }
        return;
      }

      alert(err.response?.data?.message || "Error creating class");
      console.error(err);
    }
  };

  const resetNewClassForm = () => {
    setNewClass({
      title: "",
      description: "",
      subject: "",
      teacher: "",
      student: { guardianId: "", studentId: "", studentName: "" },
      isRecurring: false,
      scheduledDate: "",
      duration: 60,
      recurrenceDetails: [{ dayOfWeek: 1, time: "18:00", duration: 60, timezone: adminTimezone }],
      generationPeriodMonths: 2,
      timezone: adminTimezone,
      meetingLink: ""
    });
  };

  const openEditFor = async (cls) => {
    try {
  const res = await api.get(`/classes/${cls._id}`);
      const fullClass = res.data.class;

      if (fullClass.student?.guardianId) {
        await fetchStudentsForEditModal(fullClass.student.guardianId._id || fullClass.student.guardianId);
      }

      const classTimezone = fullClass.timezone || adminTimezone;
      const rawPatternSlots = Array.isArray(fullClass.recurrenceDetails)
        ? fullClass.recurrenceDetails
        : [];

      let recurrenceDetails = [];
      if (fullClass.isRecurring) {
        if (rawPatternSlots.length > 0) {
          recurrenceDetails = rawPatternSlots.map((slot) => {
            const slotDay = Number(slot?.dayOfWeek);
            const validDay = Number.isInteger(slotDay) && slotDay >= 0 && slotDay <= 6 ? slotDay : 0;
            const slotTimezone = slot?.timezone || classTimezone;
            const baseMoment = slot?.time
              ? moment.tz(slot.time, "HH:mm", slotTimezone)
              : moment.tz(fullClass.scheduledDate, classTimezone);
            const timeString = baseMoment.clone().tz(classTimezone).format("HH:mm");
            const slotDuration = Number.isFinite(Number(slot?.duration))
              ? Number(slot.duration)
              : fullClass.duration || 60;

            return {
              dayOfWeek: validDay,
              time: timeString,
              duration: slotDuration,
              timezone: slotTimezone
            };
          });
        } else if (Array.isArray(fullClass.recurrence?.daysOfWeek) && fullClass.recurrence.daysOfWeek.length > 0) {
          const baseTime = fullClass.scheduledDate
            ? moment(fullClass.scheduledDate).tz(classTimezone).format("HH:mm")
            : "18:00";
          recurrenceDetails = fullClass.recurrence.daysOfWeek.map((dayOfWeek) => ({
            dayOfWeek,
            time: baseTime,
            duration: fullClass.duration || 60,
            timezone: classTimezone
          }));
        }
      }

      if (recurrenceDetails.length === 0) {
        recurrenceDetails = [{ dayOfWeek: 1, time: "18:00", duration: 60, timezone: classTimezone }];
      }

      setEditClass({
        _id: fullClass._id,
        title: fullClass.title || "",
        description: fullClass.description || "",
        subject: fullClass.subject || "",
        teacher: fullClass.teacher?._id || fullClass.teacher,
        student: {
          guardianId: fullClass.student?.guardianId?._id || fullClass.student?.guardianId,
          studentId: fullClass.student?.studentId,
          studentName: fullClass.student?.studentName
        },
        isRecurring: fullClass.isRecurring || false,
        scheduledDate: fullClass.scheduledDate || "",
        duration: fullClass.duration || 60,
        timezone: fullClass.timezone || adminTimezone,
        meetingLink: fullClass.meetingLink || "",
        generationPeriodMonths: fullClass.recurrence?.generationPeriodMonths || 2,
        recurrenceDetails,
        recurrence: fullClass.recurrence
      });
      
      setShowEditModal(true);
      // Default update scope: if editing a recurring series, assume user wants to update the whole series
      setEditUpdateScope(fullClass.isRecurring ? 'all' : 'single');
    } catch (err) {
      console.error("Failed to fetch class details for edit:", err);
      alert("Failed to load class details for editing");
    }
  };

  const fetchStudentsForEditModal = async (guardianId) => {
    try {
      const res = await api.get(`/users/${guardianId}/students`);
      const studentsList = res.data?.students || [];
      const annotated = annotateStudentsWithGuardian(studentsList, guardianId);
      setEditStudents(annotated);
    } catch (err) {
      console.error("Fetch students for edit error:", err);
      setEditStudents([]);
    }
  };

  const handleEditGuardianChange = async (guardianId) => {
    setEditClass(prev => ({
      ...prev,
      student: { guardianId, studentId: "", studentName: "" }
    }));

    if (guardianId) {
      await fetchStudentsForEditModal(guardianId);
    } else {
      setEditStudents([]);
    }
  };

  const handleEditStudentChange = (studentId) => {
    const selected = editStudents.find(s => s._id === studentId);
    setEditClass(prev => ({
      ...prev,
      student: {
        guardianId: prev.student.guardianId,
        studentId,
        studentName: selected ? `${selected.firstName} ${selected.lastName}` : ""
      }
    }));
  };

  const addEditRecurrenceSlot = () => {
    setEditClass(prev => ({
      ...prev,
      recurrenceDetails: [
        ...prev.recurrenceDetails,
        {
          dayOfWeek: 1,
          time: "18:00",
          duration: 60,
          timezone: prev.timezone || adminTimezone
        }
      ]
    }));
  };

  const removeEditRecurrenceSlot = (index) => {
    setEditClass(prev => ({
      ...prev,
      recurrenceDetails: prev.recurrenceDetails.filter((_, i) => i !== index)
    }));
  };

  const updateEditRecurrenceSlot = (index, field, value) => {
    setEditClass(prev => {
      const details = [...prev.recurrenceDetails];
      details[index] = { ...details[index], [field]: value };
      return { ...prev, recurrenceDetails: details };
    });
  };

  const handleUpdateClass = async () => {
    try {
      const updateData = {
        title: editClass.title,
        description: editClass.description,
        subject: editClass.subject,
        teacher: editClass.teacher,
        student: editClass.student,
        meetingLink: editClass.meetingLink,
        timezone: editClass.timezone,
        isRecurring: editClass.isRecurring,
        generationPeriodMonths: editClass.generationPeriodMonths
      };

      if (editUpdateScope === 'all' && editClass.isRecurring) {
        const uniqueDays = Array.from(
          new Set(
            (editClass.recurrenceDetails || [])
              .map((slot) => (Number.isFinite(Number(slot?.dayOfWeek)) ? Number(slot.dayOfWeek) : null))
              .filter((day) => day !== null && day >= 0 && day <= 6)
          )
        );

        updateData.recurrence = {
          frequency: "weekly",
          interval: 1,
          daysOfWeek: uniqueDays,
          duration: editClass.recurrenceDetails[0]?.duration || 60,
          generationPeriodMonths: editClass.generationPeriodMonths
        };
        updateData.recurrenceDetails = editClass.recurrenceDetails;
        updateData.duration = editClass.recurrenceDetails[0]?.duration || 60;
      } else {
        updateData.scheduledDate = new Date(editClass.scheduledDate).toISOString();
        updateData.duration = editClass.duration;
      }

      // Client-side validation: ensure the selected teacher is available for each recurring slot
      try {
        const teacherIdToCheck = editClass.teacher;
        if (teacherIdToCheck) {
          const availability = await fetchTeacherAvailability(teacherIdToCheck);

          const isDefault = availability?.isDefaultAvailability;

          if (!isDefault && Array.isArray(editClass.recurrenceDetails)) {
            const toMinutes = (t) => {
              if (!t) return null;
              const [hh = '0', mm = '0'] = t.split(':');
              const h = parseInt(hh, 10);
              const m = parseInt(mm, 10);
              if (Number.isNaN(h) || Number.isNaN(m)) return null;
              return h * 60 + m;
            };

            const conflicts = [];

            (editClass.recurrenceDetails || []).forEach((slot, idx) => {
              const day = Number.isFinite(Number(slot.dayOfWeek)) ? Number(slot.dayOfWeek) : null;
              const slotStartMin = toMinutes(slot.time);
              const slotEndMin = slotStartMin !== null ? slotStartMin + (Number(slot.duration) || 0) : null;

              if (day === null || slotStartMin === null || slotEndMin === null) {
                conflicts.push({ idx, reason: 'invalid_time' });
                return;
              }

              const daySlots = (availability.slotsByDay || {})[String(day)] || [];
              // If no availability for that day, it's a conflict
              if (!daySlots || daySlots.length === 0) {
                conflicts.push({ idx, reason: 'no_day_slots' });
                return;
              }

              // Check if any availability slot fully contains the requested class slot
              const matched = daySlots.some((av) => {
                const avStart = toMinutes(av.startTime || av.start || av.start_time || av.startTimeLocal || av.start_time_local || '');
                const avEnd = toMinutes(av.endTime || av.end || av.end_time || av.endTimeLocal || av.end_time_local || '');
                if (avStart === null || avEnd === null) return false;
                return avStart <= slotStartMin && avEnd >= slotEndMin;
              });

              if (!matched) {
                conflicts.push({ idx, reason: 'not_covered' });
              }
            });

            if (conflicts.length > 0) {
              console.warn('Teacher availability conflicts detected for recurring update', { conflicts });

              const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
              const minutesToTime = (minutes) => {
                if (!Number.isFinite(minutes) || minutes < 0) return '';
                const h = Math.floor(minutes / 60) % 24;
                const m = minutes % 60;
                return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
              };

              const tzLabel = availability?.timezone || editClass?.timezone || DEFAULT_TIMEZONE;
              const slotsByDay = availability?.slotsByDay || {};

              const suggestStartWithinDaySlots = (daySlots = [], requestedStartMin, durationMinutes) => {
                if (!Number.isFinite(requestedStartMin) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) return '';
                const toMin = (t) => {
                  if (!t) return null;
                  const [hh = '0', mm = '0'] = String(t).split(':');
                  const h = parseInt(hh, 10);
                  const m = parseInt(mm, 10);
                  if (Number.isNaN(h) || Number.isNaN(m)) return null;
                  return h * 60 + m;
                };
                let bestStart = null;
                let bestScore = Infinity;
                (Array.isArray(daySlots) ? daySlots : []).forEach((av) => {
                  const avStart = toMin(av.startTime || av.start || av.start_time || '');
                  const avEnd = toMin(av.endTime || av.end || av.end_time || '');
                  if (avStart === null || avEnd === null) return;
                  const latestStart = avEnd - durationMinutes;
                  if (latestStart < avStart) return;
                  const candidate = Math.min(Math.max(requestedStartMin, avStart), latestStart);
                  const score = Math.abs(candidate - requestedStartMin);
                  if (score < bestScore) {
                    bestScore = score;
                    bestStart = candidate;
                  }
                });
                if (bestStart === null) return '';
                const bestEnd = bestStart + durationMinutes;
                return `${minutesToTime(bestStart)}–${minutesToTime(bestEnd)}`;
              };

              let nearestLabel = '';

              const lines = conflicts.map(({ idx, reason }) => {
                const slot = (editClass.recurrenceDetails || [])[idx] || {};
                const day = Number.isFinite(Number(slot.dayOfWeek)) ? Number(slot.dayOfWeek) : null;
                const startMin = toMinutes(slot.time);
                const duration = Number(slot.duration) || 0;
                const endMin = startMin !== null ? startMin + duration : null;

                const dayName = day !== null ? (dayNames[day] || `Day ${day}`) : 'Unknown day';
                const reqStart = startMin !== null ? minutesToTime(startMin) : String(slot.time || '');
                const reqEnd = endMin !== null ? minutesToTime(endMin) : '';
                const reqRange = reqEnd ? `${reqStart}–${reqEnd}` : reqStart;

                const daySlots = (day !== null ? slotsByDay[String(day)] : []) || [];
                const daySlotsLabel = daySlots.length
                  ? daySlots.map((av) => `${av.startTime || av.start || ''}–${av.endTime || av.end || ''}`).join(', ')
                  : 'none';

                const suggested = reason === 'not_covered' ? suggestStartWithinDaySlots(daySlots, startMin, duration) : '';
                if (!nearestLabel && suggested) {
                  nearestLabel = `${dayName}: ${suggested}`;
                }

                if (reason === 'no_day_slots') {
                  return `• ${dayName}: no availability windows (timezone ${tzLabel})`;
                }
                if (reason === 'not_covered') {
                  return `• ${dayName}: requested ${reqRange} (${duration} min) is not fully covered. Available: ${daySlotsLabel} (timezone ${tzLabel})`;
                }
                if (reason === 'invalid_time') {
                  return `• ${dayName}: invalid time/duration`;
                }
                return `• ${dayName}: not available`;
              });

              setEditAvailabilityWarning({
                title: 'Teacher not available for one or more recurring slots',
                reason: '',
                details: lines.join('\n'),
                nearest: nearestLabel,
                suggested: [],
              });
              return;
            }
          }
        }
      } catch (availErr) {
        // If availability check fails (network), log and allow server to perform final validation
        console.error('Availability check failed, proceeding to update (server will validate):', availErr);
      }

      const res = await api.put(`/classes/${editClass._id}`, updateData);
      if (res.data.message) {
        setShowEditModal(false);
        setEditClass(null);
        setEditStudents([]);
        setEditUpdateScope("single");
        setEditAvailabilityWarning(null);
        await fetchClasses();
        alert("Class updated successfully!");
      }
    } catch (err) {
      const data = err?.response?.data || {};
      if (data?.availabilityError) {
        setEditAvailabilityWarning(buildAvailabilityWarningFromApi(data));
        return;
      }
      alert(err.response?.data?.message || "Failed to update class");
      console.error(err);
    }
  };

  const handleOpenRescheduleModal = async (classItem) => {
    if (!classItem?._id) return;
    const detail = await ensureClassDetail(classItem._id);
    if (!detail) {
      if (policyError) alert(policyError);
      return;
    }
    const loadedClass = detail?.classData || classItem;

    if (isAdminUser) {
      setRescheduleClass(loadedClass);
      setShowRescheduleModal(true);
    } else {
      setRequestClass(loadedClass);
      setShowRescheduleRequestModal(true);
    }
  };

  const handleCloseRescheduleModal = () => {
    setShowRescheduleModal(false);
    setRescheduleClass(null);
  };

  const handleCloseRescheduleRequestModal = () => {
    setShowRescheduleRequestModal(false);
    setRequestClass(null);
  };

  const handleRescheduleSuccess = async (response) => {
    await fetchClasses();
    alert(response?.message || "Class rescheduled successfully!");
  };

  const handleRescheduleRequestSuccess = async (response) => {
    await fetchClasses();
    alert(response?.message || "Reschedule request submitted!");
  };

  const handleOpenDeleteModal = (classItem) => {
    setDeleteClass(classItem);
    setShowDeleteModal(true);
  };

  const handleCloseDeleteModal = () => {
    setShowDeleteModal(false);
    setDeleteClass(null);
  };

  const handleDeleteCountdownStart = useCallback((scope, classId) => {
    const baseMessage = deleteClass?.subject
      ? `Deleting ${deleteClass.subject}`
      : 'Deleting class';

    startDeleteCountdown({
      classId,
      scope,
      message: baseMessage,
      durationSeconds: 5
    });
  }, [startDeleteCountdown, deleteClass]);

  const handleOpenDuplicateModal = (classItem) => {
    setDuplicateClass(classItem);
    setShowDuplicateModal(true);
  };

  const handleCloseDuplicateModal = () => {
    setShowDuplicateModal(false);
    setDuplicateClass(null);
  };

  const handleDuplicateSuccess = async (response) => {
    await fetchClasses();
    alert(response?.message || "Class duplicated successfully!");
  };

  const handleOpenCancelModal = async (classItem) => {
    if (!classItem?._id) return;
    const detail = await ensureClassDetail(classItem._id);
    if (!detail) {
      if (policyError) alert(policyError);
      return;
    }
    const loadedClass = detail?.classData || classItem;
    setCancelTargetClass(loadedClass);
    setShowCancelModal(true);
  };

  const handleCloseCancelModal = () => {
    setShowCancelModal(false);
    setCancelTargetClass(null);
  };

  const handleCancelSuccess = async (response) => {
    await fetchClasses();
    alert(response?.message || "Class cancelled successfully!");
  };

  const openGoogleMeet = (link) => {
    if (link) window.open(link, "_blank");
  };

  const toggleExpanded = (id) => {
    setExpandedClass(expandedClass === id ? null : id);
  };

  const ensureClassDetail = useCallback(
    async (classId, { force = false } = {}) => {
      if (!classId) return null;
      if (!force && classDetails[classId] && classPolicies[classId]) {
        setFocusedClassId(classId);
        setFocusedPolicy(classPolicies[classId]);
        return { classData: classDetails[classId], policy: classPolicies[classId] };
      }

      setFocusedClassId(classId);
      setFocusedPolicy(null);
      setPolicyLoading(true);
      setPolicyError("");
      try {
        const response = await api.get(`/classes/${classId}`);
        const classData = response.data?.class || null;
        const policy = response.data?.policy || null;
        const extra = { userTimezone: response.data?.userTimezone, systemTimezone: response.data?.systemTimezone };
        setClassDetails((prev) => ({ ...prev, [classId]: classData ? { ...classData, __meta: extra } : null }));
        if (policy) {
          setClassPolicies((prev) => ({ ...prev, [classId]: policy }));
          setFocusedPolicy(policy);
        } else {
          setClassPolicies((prev) => ({ ...prev, [classId]: null }));
          setFocusedPolicy(null);
        }
        setFocusedClassId(classId);
        return { classData, policy };
      } catch (err) {
        const message = err?.response?.data?.message || "Failed to load class details";
        setPolicyError(message);
        console.error("ensureClassDetail error", err);
        return null;
      } finally {
        setPolicyLoading(false);
      }
    },
    [classDetails, classPolicies]
  );

  const getPolicyForClass = useCallback(
    (classId) => (classId ? classPolicies[classId] || null : null),
    [classPolicies]
  );

  const formatDateTime = useCallback((dateString, classTimezone = DEFAULT_TIMEZONE) => {
    if (!dateString) return { date: "N/A", time: "N/A", timezone: "N/A" };
    
    const userTimezone = user?.timezone || DEFAULT_TIMEZONE;
    const timeInfo = convertClassTimeForUser(dateString, classTimezone, userTimezone);
    
    const date = new Date(timeInfo.convertedDate);
    return {
      date: date.toLocaleDateString("en-GB", { 
        weekday: "short", 
        day: "2-digit", 
        month: "short", 
        year: "2-digit",
        timeZone: userTimezone
      }),
      time: date.toLocaleTimeString([], { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true,
        timeZone: userTimezone
      }),
      timezone: userTimezone,
      isConverted: timeInfo.isConverted,
      originalTime: timeInfo.originalTime
    };
  }, [user?.timezone]);

  const formatStatus = (status) => {
    return status?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown';
  };

  const openMeetingReportModal = useCallback((meeting) => {
    if (!meeting) return;
    setReportMeeting(meeting);
    setReportModalOpen(true);
  }, []);

  const closeMeetingReportModal = useCallback(() => {
    setReportModalOpen(false);
    setReportMeeting(null);
  }, []);

  const handleMeetingReportSaved = useCallback(async () => {
    await fetchMeetings();
    closeMeetingReportModal();
  }, [fetchMeetings, closeMeetingReportModal]);

  const meetingBuckets = useMemo(() => {
    if (!Array.isArray(meetings) || !meetings.length) {
      return { upcoming: [], past: [] };
    }

    const now = Date.now();
    const upcoming = [];
    const past = [];

    meetings.forEach((meeting) => {
      if (!meeting?.scheduledStart) return;
      const scheduledAt = new Date(meeting.scheduledStart);
      const formatted = formatDateTime(meeting.scheduledStart, meeting.timezone || DEFAULT_TIMEZONE);
      const studentCount = Number(meeting.bookingPayload?.students?.length || 0);
      const studentLabel = studentCount
        ? `${studentCount} student${studentCount === 1 ? '' : 's'}`
        : 'No students listed';
      const guardianName = meeting.bookingPayload?.guardianName || meeting.guardianName;
      const teacherName = meeting.attendees?.teacherName || meeting.teacherName;
      const attendeeLabel = guardianName || teacherName || 'Admin team';
      const meetingLabel = MEETING_TYPE_LABELS[meeting.meetingType] || 'Meeting';

      const entry = {
        id: meeting._id || meeting.id,
        meeting,
        attendeeLabel,
        meetingLabel,
        studentCount,
        studentLabel,
        timeDisplay: `${formatted.date} • ${formatted.time}`,
        timezone: formatted.timezone,
        isConverted: formatted.isConverted,
        scheduledAt,
        guardianName,
        teacherName,
        reportSubmitted: Boolean(meeting.report?.submittedAt)
      };

      if (scheduledAt.getTime() >= now) {
        upcoming.push(entry);
      } else {
        past.push(entry);
      }
    });

    return {
      upcoming: upcoming.sort((a, b) => a.scheduledAt - b.scheduledAt),
      past: past.sort((a, b) => b.scheduledAt - a.scheduledAt)
    };
  }, [formatDateTime, meetings]);

  const meetingsForActiveTab = tabFilter === 'previous'
    ? meetingBuckets.past
    : meetingBuckets.upcoming;
  const nextMeeting = meetingBuckets.upcoming[0] || null;
  const recentMeeting = meetingBuckets.past[0] || null;
  const shouldShowMeetingHighlights = !isAdminUser && canViewMeetings && viewLayout === 'list';
  const meetingSectionLabel = tabFilter === 'previous' ? 'Past meetings' : 'Upcoming meetings';
  const meetingEmptyStateText = tabFilter === 'previous'
    ? 'Meetings from the last 60 days will appear here.'
    : 'Book or confirm a meeting to see it here.';
  const shouldSplitColumns = isAdminUser && viewLayout === 'list' && isLargeScreen;

  const pendingRescheduleCount = useMemo(() => {
    if (!isAdminUser) return 0;
    return (filteredClasses || []).reduce((acc, classItem) => {
      const pending = classItem?.pendingReschedule;
      if (pending?.status === 'pending' && (pending?.requestedAt || pending?.requestedBy)) {
        return acc + 1;
      }
      return acc;
    }, 0);
  }, [filteredClasses, isAdminUser]);

  const renderTeacherAvailabilitySummary = () => {
    if (shareMode === "admin" && !selectedTeacherId) {
      return (
        <p className="text-sm text-gray-600">
          Select a teacher above to preview their availability slots.
        </p>
      );
    }

    const slotsByDay = teacherAvailability?.slotsByDay || {};
    const dayKeys = Object.keys(slotsByDay);

    if (dayKeys.length === 0) {
      if (teacherAvailability?.isDefaultAvailability) {
        return (
          <p className="text-sm text-gray-600">
            {shareMode === "admin"
              ? 'This teacher hasn\'t added custom slots. They\'re currently available 24/7 by default.'
              : 'You\'re currently available 24/7. Add custom slots if you want to limit your availability.'}
          </p>
        );
      }

      return (
        <p className="text-sm text-gray-600">
          {shareMode === "admin"
            ? 'This teacher has no saved availability slots yet. Ask them to add availability before sharing.'
            : 'You haven\'t added any availability slots yet. Add slots from the Availability page to generate a shareable message.'}
        </p>
      );
    }

    const weekdayOrder = [1, 2, 3, 4, 5];
    const weekendOrder = [6, 0];

    const renderDayCard = (day) => {
      const daySlots = slotsByDay[day] || [];
      if (daySlots.length === 0) return null;

      return (
        <div key={day} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">
              {DAY_NAMES[day] || `Day ${day}`}
            </p>
            <span className="text-xs font-medium text-gray-400">
              {daySlots.length} slot{daySlots.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {daySlots.map((slot, index) => (
              <span
                key={slot._id || `${day}-${index}`}
                className="inline-flex items-center rounded-full bg-[#F1F8F7] px-3 py-1 text-xs font-medium text-[#2C736C]"
              >
                <Clock className="mr-1 h-3 w-3" />
                {formatTimeLabel(slot.startTime)} – {formatTimeLabel(slot.endTime)}
              </span>
            ))}
          </div>
        </div>
      );
    };

    const renderSection = (title, ordering) => {
      const cards = ordering
        .map((day) => renderDayCard(day))
        .filter(Boolean);

      if (cards.length === 0) return null;

      return (
        <div key={title} className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h4>
            <span className="h-[1px] flex-1 ml-4 bg-gray-200" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {cards}
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-5">
        {renderSection("Weekdays", weekdayOrder)}
        {renderSection("Weekend", weekendOrder)}
      </div>
    );
  };

  const getStatusColor = (status) => {
    const colors = {
      scheduled: "bg-blue-100 text-blue-800",
      in_progress: "bg-yellow-100 text-yellow-800",
      completed: "bg-green-100 text-green-800",
      attended: "bg-green-100 text-green-800",
      missed_by_student: "bg-orange-100 text-orange-800",
      cancelled_by_teacher: "bg-red-100 text-red-800",
      cancelled_by_student: "bg-red-100 text-red-800",
      cancelled_by_admin: "bg-red-100 text-red-800",
      no_show_both: "bg-gray-100 text-gray-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  const getStatusIcon = (status) => {
    const icons = {
      scheduled: <Clock className="h-4 w-4" />,
      in_progress: <Video className="h-4 w-4" />,
      completed: <CheckCircle className="h-4 w-4" />,
      attended: <CheckCircle className="h-4 w-4" />,
      missed_by_student: <AlertCircle className="h-4 w-4" />,
      cancelled_by_teacher: <XCircle className="h-4 w-4" />,
      cancelled_by_student: <XCircle className="h-4 w-4" />,
      cancelled_by_admin: <XCircle className="h-4 w-4" />,
      no_show_both: <XCircle className="h-4 w-4" />,
    };
    return icons[status] || <Clock className="h-4 w-4" />;
  };

  const renderClassesList = () => (
    <div className="space-y-4">
      {filteredClasses.length === 0 && !loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
          <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No classes found</h3>
          <p className="text-gray-600 mb-4">
            {searchTerm ? "No classes match your search criteria." : "Get started by creating your first class."}
          </p>
          {isAdmin() && (
            <button
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-[#2C736C] text-white rounded-md shadow-sm hover:bg-[#256a63] transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Create First Class</span>
              </button>
          )}
        </div>
      ) : (
        filteredClasses.map((classItem) => {
          // Use scheduledDate for time display with timezone conversion
          const timeInfo = formatDateTime(classItem?.scheduledDate, classItem?.timezone);
          const reportSubmitted = Boolean(classItem?.classReport?.submittedAt);
          const rawScore = reportSubmitted ? classItem?.classReport?.classScore : null;
          const parsedClassScore = Number(rawScore);
          const hasClassScore = reportSubmitted && Number.isFinite(parsedClassScore);
          const boundedClassScore = hasClassScore
            ? Math.max(0, Math.min(5, parsedClassScore))
            : null;
          const showCancellationReason = isAdminUser && classItem?.cancellation?.reason;
          const classId = classItem?._id;
          const classPolicy = getPolicyForClass(classId);
          const policyLoadingForClass = Boolean(policyLoading && classId && focusedClassId === classId);
          const teacherOwnsClass = Boolean(
            isTeacherUser &&
            user?._id &&
            classItem?.teacher &&
            String(classItem.teacher?._id || classItem.teacher) === String(user._id)
          );
          const guardianOwnsClass = Boolean(
            user?.role === "guardian" &&
            user?._id &&
            classItem?.student?.guardianId &&
            String(classItem.student.guardianId?._id || classItem.student.guardianId) === String(user._id)
          );
          const canManageAsNonAdmin = !isAdminUser && (teacherOwnsClass || guardianOwnsClass);
          const rescheduleDisabledReason =
            !isAdminUser && classPolicy && !classPolicy.canRequestReschedule
              ? classPolicy.reasons?.reschedule || "Reschedule request not allowed"
              : "";
          const cancelDisabledReason =
            !isAdminUser && classPolicy && !classPolicy.canCancel
              ? classPolicy.reasons?.cancel || "Cancellation not allowed"
              : "";
          const hasPendingReschedule = Boolean(
            (classItem?.pendingReschedule?.status === "pending" &&
              (classItem?.pendingReschedule?.requestedAt || classItem?.pendingReschedule?.requestedBy)) ||
            (classPolicy?.pendingReschedule?.status === "pending" &&
              (classPolicy?.pendingReschedule?.requestedAt || classPolicy?.pendingReschedule?.requestedBy))
          );
          
          return (
            <div key={classItem._id} className="bg-white rounded-md border border-gray-100 overflow-hidden hover:shadow-md transition-shadow duration-150">
          {/* Class Summary */}
          <div className="p-3">

            {/* Row clickable for expand */}
            <div
              className="flex cursor-pointer flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              onClick={() => toggleExpanded(classItem._id)}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">

                {/* Time & Date with Timezone Info */}
                <div className="flex w-full flex-shrink-0 flex-col items-start sm:w-28 sm:items-center md:items-start">
                  <div className="flex items-center space-x-1">
                    <span className="text-sm font-semibold text-[#2F3559]">{timeInfo.time}</span>
                    {timeInfo.isConverted && (
                      <Globe className="h-4 w-4 text-blue-500" title={`Converted from ${timeInfo.originalTime}`} />
                    )}
                  </div>
                  <span className="mt-1 text-xs text-[#2F3559]">{timeInfo.date}</span>
                  {timeInfo.isConverted && (
                    <span className="text-[11px] text-blue-600" title={`Original: ${timeInfo.originalTime}`}>
                      Your timezone
                    </span>
                  )}
                </div>

                {/* Student Name */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{classItem?.student?.studentName}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                    {/* Status Tag */}
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(classItem?.status)}`}>
                      {getStatusIcon(classItem?.status)}
                      <span className="ml-1">{formatStatus(classItem?.status || "Pending")}</span>
                    </span>

                    {/* Recurring Tag */}
                    {classItem?.isRecurring && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800">
                        <Repeat className="h-3 w-3 mr-1" />
                        Recurring
                      </span>
                    )}

                    <span className="flex items-center whitespace-nowrap">
                      <Clock className="h-3.5 w-3.5 mr-1" /> {classItem?.duration} min
                    </span>
                    <span className="flex items-center whitespace-nowrap">
                      <User className="h-3.5 w-3.5 mr-1" /> {classItem?.teacher?.firstName} {classItem?.teacher?.lastName}
                    </span>
                    <span className="flex items-center whitespace-nowrap">
                      <span className="font-medium">Subject:</span> {classItem?.subject}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons (not part of clickable row) */}
              <div className="flex w-full flex-wrap items-center justify-start gap-1 sm:w-auto sm:justify-end sm:gap-2">
                {hasPendingReschedule && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openPendingRescheduleDetails(classItem);
                    }}
                    className={`inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ${
                      isAdminUser ? "hover:bg-amber-100" : "cursor-default"
                    }`}
                    title={isAdminUser ? "Review reschedule request" : "Pending approval"}
                    disabled={!isAdminUser}
                  >
                    <AlertCircle className="h-3.5 w-3.5" /> Pending approval
                  </button>
                )}
                {classItem?.meetingLink && (
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); openGoogleMeet(classItem.meetingLink); }}
                      className="icon-button icon-button--blue"
                      title="Join Google Meet"
                    >
                      <Video className="h-4 w-4" />
                    </button>
                    <CopyButton text={classItem.meetingLink} />
                  </div>
                )}

                {canOpenReport(classItem) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/classes/${classItem._id}/report`, { state: { background: location, reportClass: classItem } }); }}
                    className="icon-button icon-button--green"
                    title="Submit Class Report"
                  >
                    <FileText className="h-4 w-4" />
                  </button>
                )}

                {isAdminUser ? (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditFor(classItem); }}
                      className="icon-button icon-button--blue"
                      title="Edit Class"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    {classItem.status === 'scheduled' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenRescheduleModal(classItem);
                        }}
                        className="icon-button icon-button--orange"
                        title="Reschedule Class"
                        disabled={policyLoadingForClass}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    )}

                    {classItem.status === 'scheduled' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenCancelModal(classItem);
                        }}
                        className="icon-button icon-button--red"
                        title="Cancel class"
                        disabled={policyLoadingForClass}
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDuplicateModal(classItem);
                      }}
                      className="icon-button icon-button--green"
                      title="Duplicate Class"
                    >
                      <Copy className="h-4 w-4" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenDeleteModal(classItem);
                      }}
                      className="icon-button icon-button--red"
                      title="Delete Class"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  canManageAsNonAdmin && classItem.status === 'scheduled' && (
                    <>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleOpenRescheduleModal(classItem);
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-70"
                        title={rescheduleDisabledReason || "Request a new time"}
                        disabled={policyLoadingForClass || (!!rescheduleDisabledReason && Boolean(classPolicy))}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Reschedule
                      </button>

                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          await handleOpenCancelModal(classItem);
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
                        title={cancelDisabledReason || "Cancel this class"}
                        disabled={policyLoadingForClass || (!!cancelDisabledReason && Boolean(classPolicy))}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Cancel
                      </button>
                    </>
                  )
                )}

                {/* Expand Button (optional, can be removed if row click handles expand) */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleExpanded(classItem._id); }}
                  className="icon-button icon-button--muted"
                >
                  {expandedClass === classItem._id ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

              
          {/* Expanded Details */}
          {expandedClass === classItem._id && (
            <div className="border-t border-gray-200 p-4 bg-gray-50">
              <div className="flex flex-wrap gap-6">
                {/* Class Details */}
                <div className="flex-1 min-w-[250px] max-w-lg space-y-4">
                  <h4 className="font-medium text-gray-900 mb-2">Class Details</h4>
                  <div className="space-y-2 text-sm">
                    <div><span className="font-medium">Duration:</span> {classItem?.duration} minutes</div>
                    <div><span className="font-medium">Timezone:</span> {classItem?.timezone}</div>
                    <div><span className="font-medium">Class type: </span> {classItem?.title}</div>
                    {classItem?.meetingLink && (
                      <div>
                        <span className="font-medium">Meeting Link:</span>
                        <a href={classItem.meetingLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-1">
                          Join Meeting</a>
                        {classItem?.description && <div><span className="font-medium">Description:</span> {classItem.description}</div>}
                      </div>
                    )}
                  </div>
                </div>

                {/* Participants */}
                <div className="flex-1 min-w-[250px] max-w-lg space-y-2">
                  <h4 className="font-medium text-gray-900 mb-2">Participants</h4>
                  <div className="space-y-2 text-sm">
                    <div><span className="font-medium">Teacher:</span> {classItem?.teacher?.firstName} {classItem?.teacher?.lastName}</div>
                    <div><span className="font-medium">Student:</span> {classItem?.student?.studentName}</div>
                    <div><span className="font-medium">Guardian:</span> {classItem?.student?.guardianId?.firstName} {classItem?.student?.guardianId?.lastName}</div>
                  </div>
                </div>

                {/* Class Report */}
                {classItem?.classReport && (
                  <div className="flex-1 min-w-[250px] max-w-lg space-y-2">
                    <h4 className="font-medium text-gray-900 mb-2 border-b pb-1">Class Report</h4>
                    {!reportSubmitted ? (
                      <p className="text-sm italic text-gray-500">Report not submitted yet.</p>
                    ) : (
                      <div className="flex flex-col space-y-2 text-sm">
                        {classItem.classReport.attendance && (
                          <div>
                            <span className="font-medium">Attendance:</span>{" "}
                            <span
                              className={`px-2 py-0.5 rounded text-white text-xs ${
                                classItem.classReport.attendance === "attended"
                                  ? "bg-green-600"
                                  : classItem.classReport.attendance === "missed_by_student"
                                  ? "bg-red-500"
                                  : "bg-gray-500"
                              }`}
                            >
                              {classItem.classReport.attendance === "attended"
                                ? "Attended"
                                : classItem.classReport.attendance === "missed_by_student"
                                ? "Absent"
                                : "Cancelled"}
                            </span>
                            {classItem.classReport.attendance === "missed_by_student" && (
                              <span className="ml-2 text-xs text-gray-600">
                                {classItem.classReport.countAbsentForBilling ? "(Counted for billing)" : "(Not billed)"}
                              </span>
                            )}
                          </div>
                        )}

                        {classItem.classReport.lessonTopic && (
                          <div>
                            <span className="font-medium">Lesson Topic:</span> {classItem.classReport.lessonTopic}
                          </div>
                        )}

                        {classItem.classReport.surah?.name && (
                          <div>
                            <span className="font-medium">Surah:</span> {classItem.classReport.surah.name}
                            {classItem.classReport.surah.verse && <> (up to verse {classItem.classReport.surah.verse})</>}
                          </div>
                        )}

                        {classItem.classReport.recitedQuran && (
                          <div>
                            <span className="font-medium">Quran Recitation:</span> {classItem.classReport.recitedQuran === "yes" ? "Yes" : "No"}
                          </div>
                        )}

                        {hasClassScore && (
                          <div>
                            <span className="font-medium">Class Score:</span>
                            <div className="flex items-center ml-1">
                              {[...Array(5)].map((_, i) => (
                                <Star
                                  key={i}
                                  className={`h-4 w-4 ${i < boundedClassScore ? "text-yellow-400 fill-current" : "text-gray-300"}`}
                                />
                              ))}
                              <span className="ml-2 text-xs text-gray-600">{boundedClassScore}/5</span>
                            </div>
                          </div>
                        )}

                        {showCancellationReason && (
                          <div className="rounded-lg border border-red-100 bg-red-50 p-2">
                            <span className="font-medium text-red-700">Cancellation reason:</span>
                            <span className="ml-1 text-red-900">{classItem.cancellation.reason}</span>
                          </div>
                        )}

                        {classItem.classReport.teacherNotes && (
                          <div className="bg-gray-50 p-2 rounded">
                            <span className="font-medium">Teacher Notes:</span> {classItem.classReport.teacherNotes}
                          </div>
                        )}

                        {user.role !== "guardian" && classItem.classReport.supervisorNotes && (
                          <div className="bg-gray-100 p-2 rounded border-l-4 border-indigo-500">
                            <span className="font-medium">Supervisor Notes:</span> {classItem.classReport.supervisorNotes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
            </div>
          );
        })
      )}
    </div>
  );

  const renderMeetingPanel = (variant = 'sidebar') => {
    if (!isAdminUser || !canViewMeetings) return null;
    const isSidebar = variant === 'sidebar';
    const baseEntries = meetingsForActiveTab;
    const nowMs = Date.now();
    const windowMs = MOBILE_MEETING_WINDOW_HOURS * 60 * 60 * 1000;
    const windowEntries = tabFilter === 'previous'
      ? meetingBuckets.past.filter((entry) => nowMs - entry.scheduledAt.getTime() <= windowMs)
      : meetingBuckets.upcoming.filter((entry) => entry.scheduledAt.getTime() - nowMs <= windowMs);
    const collapsedEntries = windowEntries.length ? windowEntries : baseEntries.slice(0, 4);
    const visibleEntries = isSidebar || showAllMobileMeetings ? baseEntries : collapsedEntries;
    const showToggle = !isSidebar && baseEntries.length > collapsedEntries.length;
    const collapsedLabel = tabFilter === 'previous' ? 'Last 24 hours' : 'Next 24 hours';

    const panelClasses = [
      'rounded-3xl border border-slate-100 bg-white/95 p-4 shadow-xl backdrop-blur-sm space-y-4',
      isSidebar ? 'xl:sticky xl:top-28' : ''
    ].join(' ').trim();

    return (
      <div className={panelClasses}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{meetingSectionLabel}</p>
            <h3 className="text-lg font-semibold text-slate-900">Meetings overview</h3>
            {!isSidebar && !showAllMobileMeetings && collapsedEntries.length && (
              <p className="text-xs text-slate-500">Showing {collapsedLabel} • tap arrow to expand</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchMeetings()}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-teal-500 hover:text-teal-600 disabled:opacity-60"
              disabled={meetingsLoading}
            >
              <RotateCcw className={`h-3.5 w-3.5 ${meetingsLoading ? 'animate-spin' : ''}`} />
              {meetingsLoading ? 'Refreshing' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => setViewLayout('calendar')}
              className="hidden sm:inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-teal-500 hover:text-teal-600"
            >
              <Calendar className="h-3.5 w-3.5" />
              Calendar
            </button>
          </div>
        </div>

        {meetingsLoading && !baseEntries.length ? (
          <div className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <Clock className="h-4 w-4 animate-spin text-teal-600" />
            Syncing meeting list...
          </div>
        ) : !visibleEntries.length ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {meetingEmptyStateText}
          </div>
        ) : (
          <ul className="space-y-3">
            {visibleEntries.map((meetingCard) => (
              <li key={meetingCard.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <User className="h-4 w-4 text-teal-600" />
                      <span className="truncate">{meetingCard.attendeeLabel}</span>
                    </div>
                    <p className="text-xs font-medium text-teal-700">{meetingCard.meetingLabel}</p>
                    <p className="text-sm text-slate-600">{meetingCard.timeDisplay}</p>
                    {meetingCard.isConverted && (
                      <p className="text-xs text-slate-400">Converted to your timezone</p>
                    )}
                    {meetingCard.teacherName && (
                      <p className="text-xs text-slate-500">Teacher: {meetingCard.teacherName}</p>
                    )}
                    {meetingCard.guardianName && (
                      <p className="text-xs text-slate-500">Guardian: {meetingCard.guardianName}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right">
                    <div className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      <Users className="h-3.5 w-3.5" />
                      {meetingCard.studentLabel}
                    </div>
                    {tabFilter === 'previous' && (
                      <button
                        type="button"
                        onClick={() => openMeetingReportModal(meetingCard.meeting)}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-teal-500 hover:text-teal-600"
                      >
                        {meetingCard.reportSubmitted ? 'View report' : 'Add report'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {showToggle && (
          <button
            type="button"
            onClick={() => setShowAllMobileMeetings((prev) => !prev)}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-teal-500 hover:text-teal-600"
          >
            <span>{showAllMobileMeetings ? 'Show less' : 'Show all meetings'}</span>
            {showAllMobileMeetings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>
    );
  };

  const selectStyles = useMemo(() => ({
    control: (base, state) => ({
      ...base,
      minHeight: 44,
      borderRadius: 12,
      borderColor: state.isFocused ? '#2C736C' : '#D1D5DB',
      boxShadow: state.isFocused ? '0 0 0 1px #2C736C22' : 'none',
      '&:hover': {
        borderColor: '#2C736C'
      }
    }),
    menu: (base) => ({
      ...base,
      borderRadius: 12,
      overflow: 'hidden'
    }),
    menuPortal: (base) => ({
      ...base,
      zIndex: 9999
    }),
    option: (base, state) => ({
      ...base,
      padding: '10px 14px',
      backgroundColor: state.isSelected ? '#2C736C' : state.isFocused ? '#E8F4F3' : 'white',
      color: state.isSelected ? 'white' : '#1F2937',
      cursor: 'pointer'
    })
  }), []);

  const teacherOptions = useMemo(() => (
    [
      { value: ALL_TEACHERS_OPTION_VALUE, label: 'All teachers', subLabel: 'Generate availability for all teachers' },
      ...teachers.map((teacher) => ({
        value: teacher._id,
        label: `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() || teacher.email,
        subLabel: teacher.email || ''
      }))
    ]
  ), [teachers]);

  const selectedTeacherOption = useMemo(
    () => teacherOptions.find((option) => option.value === selectedTeacherId) || null,
    [teacherOptions, selectedTeacherId]
  );

  const guardianOptions = useMemo(() => (
    guardians.map((guardian) => ({
      value: guardian._id,
      label: `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim() || guardian.email,
      phone: guardian.phone || guardian.phoneNumber || guardian.whatsapp || guardian.emergencyContact?.phone || guardian.contactNumber || ''
    }))
  ), [guardians]);

  const selectedGuardianOption = useMemo(
    () => guardianOptions.find((option) => option.value === selectedGuardianId) || null,
    [guardianOptions, selectedGuardianId]
  );

  const selectedTeacher = useMemo(() => (
    selectedTeacherId && selectedTeacherId !== ALL_TEACHERS_OPTION_VALUE
      ? teachers.find((t) => String(t._id) === String(selectedTeacherId))
      : null
  ), [teachers, selectedTeacherId]);

  const menuPortalTarget = typeof document !== "undefined" ? document.body : undefined;

  const teacherFilterOption = useCallback((candidate, input) => {
    if (!input) return true;
    const haystack = [candidate.data.label, candidate.data.subLabel, candidate.data.value]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(input.toLowerCase().trim());
  }, []);

  const guardianFilterOption = useCallback((candidate, input) => {
    if (!input) return true;
    const haystack = [candidate.data.label, candidate.data.phone]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(input.toLowerCase().trim());
  }, []);

  const timezoneFilterOption = useCallback((candidate, input) => {
    if (!input) return true;
    const haystack = [candidate.data.label, candidate.data.value]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(input.toLowerCase().trim());
  }, []);

  const teacherOptionLabel = useCallback((option) => (
    <div className="flex flex-col">
      <span className="text-sm font-medium text-gray-800">{option.label}</span>
      {option.subLabel && (
        <span className="text-xs text-gray-500">{option.subLabel}</span>
      )}
    </div>
  ), []);

  const guardianOptionLabel = useCallback((option) => (
    <div className="flex flex-col">
      <span className="text-sm font-medium text-gray-800">{option.label}</span>
      {option.phone && (
        <span className="text-xs text-gray-500">{option.phone}</span>
      )}
    </div>
  ), []);

  const timezoneOptionLabel = useCallback((option) => (
    <div className="flex flex-col">
      <span className="text-sm font-medium text-gray-800">{option.label}</span>
      <span className="text-xs text-gray-500">{option.value}</span>
    </div>
  ), []);

  const timezoneSelectOptions = useMemo(() => (
    (timezoneOptions || []).map((tz) => ({
      value: tz.value,
      label: tz.label
    }))
  ), [timezoneOptions]);

  const selectedTimezoneOption = useMemo(
    () => timezoneSelectOptions.find((option) => option.value === targetTimezone) || null,
    [timezoneSelectOptions, targetTimezone]
  );

  const timezoneLabelRaw = useMemo(() => {
    if (selectedTimezoneOption?.label) return selectedTimezoneOption.label;
    const fallback = timezoneSelectOptions.find((option) => option.value === targetTimezone);
    if (fallback?.label) return fallback.label;
    if (!targetTimezone) return "";
    return targetTimezone.replace(/_/g, " ");
  }, [selectedTimezoneOption, timezoneSelectOptions, targetTimezone]);

  const timezoneFriendlyLabel = useMemo(
    () => prettifyTimezoneLabel(timezoneLabelRaw, targetTimezone),
    [timezoneLabelRaw, targetTimezone]
  );

  // Resolved timezone string for display across this page (fallback to user timezone)
  const resolvedTimezone = timezoneFriendlyLabel || user?.timezone || DEFAULT_TIMEZONE;

  const buildFriendlyShareMessage = (rawMessage) => {
    // Fallback formatter (kept for safety). Prefer buildConciseShareMessageFromResults.
    const body = stripSlotTimezoneLabels(convertMessageTimesTo12h((rawMessage || "").trim()));
    const header = timezoneFriendlyLabel ? `Times shown in: ${timezoneFriendlyLabel}` : "";
    return [header, body].filter(Boolean).join("\n\n");
  };

  const formatPhoneForWhatsApp = (raw) => (raw || "").replace(/\D+/g, "");

  const openWhatsApp = () => {
    const cleanNumber = formatPhoneForWhatsApp(recipientPhone);
    if (!cleanNumber || !shareMessage) return;
    const encodedMessage = encodeURIComponent(shareMessage);
    window.open(`https://wa.me/${cleanNumber}?text=${encodedMessage}`, "_blank", "noopener,noreferrer");
  };

  const hasAvailability = (teacherAvailability?.slots || []).length > 0;
  const defaultAvailabilityActive = teacherAvailability?.isDefaultAvailability;
  const isAdminAllTeachersShare = shareMode === 'admin' && selectedTeacherId === ALL_TEACHERS_OPTION_VALUE;
  const hasShareableAvailability = isAdminAllTeachersShare ? true : (defaultAvailabilityActive || hasAvailability);
  const canShareMessage = Boolean((shareMessage || "").trim());
  const canWhatsApp = canShareMessage && Boolean(formatPhoneForWhatsApp(recipientPhone));

  if (loading) return <LoadingSpinner />;


  return (
  <div className="p-4 font-sans text-gray-800 bg-gray-50 min-h-screen">
     <div className="flex flex-wrap items-start justify-between gap-6">
               <div className="max-w-3xl space-y-3">
                 <button
                   onClick={() => setTabFilter("upcoming")}
                   className={`tab-toggle rounded-full px-4 py-1.5 ${tabFilter === "upcoming" ? "active" : ""}`}
                 >
                   Upcoming
                 </button>
                 <button
                   onClick={() => setTabFilter("previous")}
                   className={`tab-toggle rounded-full px-4 py-1.5 ${tabFilter === "previous" ? "active" : ""}`}
                 >
                   Previous
                   </button>
                   <div className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 p-1 text-sm font-medium">
                 
               </div>
               
             </div>
             <div className="flex flex-wrap items-center gap-3 max-w-3xl">
             <button
                   onClick={() => setViewLayout("list")}
                   className={`tab-toggle flex items-center gap-2 rounded-full px-4 py-1.5 ${!isCalendarView ? "active" : ""}`}
                 >
                   <BookOpen className="h-4 w-4" />
                   List view
                 </button>
                 <button
                   onClick={() => setViewLayout("calendar")}
                   className={`tab-toggle flex items-center gap-2 rounded-full px-4 py-1.5 ${isCalendarView ? "active" : ""}`}
                 >
                   <Calendar className="h-4 w-4" />
                   Calendar
                 </button>

                {isAdminUser && (
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1.5 text-sm font-semibold text-amber-800">
                    <AlertCircle className="h-4 w-4" />
                    Pending reschedules: {pendingRescheduleCount}
                  </div>
                )}
             </div>
               <div className="flex w-full max-w-xs flex-col gap-3">
                 <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-inner">
                   <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                     <Clock className="h-4 w-4 text-[#2C736C]" />
                     Local timezone
                   </div>
                   <p className="text-sm text-slate-500">{resolvedTimezone}</p>
                   
               </div>
               
     
               </div>
             </div>
     
           {error && (
             <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
               {error}
             </div>
      )}
      
      <div className="flex items-center justify-between gap-3 mb-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          {/* Left area kept minimal */}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isAdminUser && (
            <button
              type="button"
              onClick={() => navigate('/dashboard/availability?source=classes')}
              className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-[#2C736C] hover:text-[#2C736C]"
            >
              <Clock className="h-4 w-4" />
              Manage Meeting Availability
            </button>
          )}
        </div>
      </div>

        {shouldShowMeetingHighlights && !isAdminUser && (
          <div className="mt-6 rounded-2xl border border-emerald-100 bg-white/90 px-4 py-3 shadow-sm">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-emerald-600" />
              {meetingsLoading && !nextMeeting ? (
                <div className="text-sm font-medium text-emerald-700">Checking for meetings...</div>
              ) : nextMeeting ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Next meeting</p>
                  <p className="text-sm font-semibold text-slate-900">{nextMeeting.meetingLabel}</p>
                  <p className="text-sm text-slate-600">{nextMeeting.timeDisplay}</p>
                  <p className="text-xs text-slate-500">
                    {[nextMeeting.attendeeLabel, nextMeeting.studentLabel].filter(Boolean).join(' • ')}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-slate-800">No upcoming meetings yet.</p>
                  {recentMeeting && (
                    <p className="text-xs text-slate-500">Last meeting: {recentMeeting.timeDisplay}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

      {/* Floating FAB cluster (bottom-right) */}
      {(isTeacherUser || isAdminUser || isAdmin()) && (
        <FABCluster
          isAdmin={isAdminUser}
          isTeacher={isTeacherUser}
          onCreate={() => navigate('/classes/create', { state: { background: location } })}
          onShare={() => handleOpenShareModal()}
          onSeriesScanner={() => setShowSeriesScanner(true)}
        />
      )}

      {/* Tab filters were moved into the calendar toolbar to save vertical space */}

      {/* CALENDAR / LIST VIEWS */}
      {viewLayout === 'calendar' ? (
        <ClassesCalendarView
          classes={filteredClasses}
          meetings={meetings}
          meetingsLoading={meetingsLoading}
          onRefresh={fetchClasses}
          onEditClass={openEditFor}
          onReschedule={handleOpenRescheduleModal}
          onCancel={handleOpenCancelModal}
          onDuplicate={handleOpenDuplicateModal}
          onDelete={handleOpenDeleteModal}
          onSubmitReport={(classItem) => navigate(`/classes/${classItem._id}/report`, { state: { background: location, reportClass: classItem } })}
          canManageClasses={isAdmin()}
          canSubmitReport={canOpenReport}
          userTimezone={user?.timezone || DEFAULT_TIMEZONE}
          availabilityData={calendarAvailability}
          availabilityEnabled={calendarAvailabilityEnabled && Boolean(calendarAvailability)}
          availabilityLoading={calendarAvailabilityLoading}
          availabilityLabel={calendarAvailabilityLabel}
          onToggleAvailability={calendarAvailability ? toggleCalendarAvailability : undefined}
          canEditAvailability={calendarAvailabilityEnabled && canEditCalendarAvailability}
          onRefreshAvailability={refreshCalendarAvailability}
          availabilityTeacherId={calendarAvailabilityTeacherId}
          tabFilter={tabFilter}
          onChangeTab={handleTabChange}
          viewLayout={viewLayout}
          onChangeLayout={handleLayoutChange}
        />
      ) : (
        isAdminUser ? (
          shouldSplitColumns ? (
            <div className="flex flex-col xl:flex-row gap-6">
              <div className="order-2 xl:order-1 xl:w-2/3">{renderClassesList()}</div>
              <div className="order-1 xl:order-2 xl:w-1/3">{renderMeetingPanel('sidebar')}</div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="order-1">{renderMeetingPanel('stacked')}</div>
              <div className="order-2">{renderClassesList()}</div>
            </div>
          )
        ) : (
          renderClassesList()
        )
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center space-x-2 mt-6">
          <button
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="px-3 py-2 text-sm font-medium text-gray-700">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-4xl rounded-2xl border border-gray-100 bg-white p-6 shadow-2xl">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-gray-900">Share Availability</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Prepare a polished availability summary and send it instantly via email or WhatsApp.
                  </p>
                </div>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="self-end rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100"
                >
                  Close
                </button>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-5">
                  {shareMode === "admin" && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Choose a teacher</label>
                      <Select
                        value={selectedTeacherOption}
                        onChange={(option) => handleAdminTeacherChange(option?.value || null)}
                        options={teacherOptions}
                        placeholder="Search teacher by name or email"
                        isClearable
                        isSearchable
                        styles={selectStyles}
                        menuPortalTarget={menuPortalTarget}
                        menuPosition="fixed"
                        filterOption={teacherFilterOption}
                        formatOptionLabel={teacherOptionLabel}
                        noOptionsMessage={({ inputValue }) => inputValue ? `No teachers found for "${inputValue}"` : 'No teachers found'}
                      />
                      {selectedTeacher && (
                        <p className="text-xs text-gray-500">
                          Crafting a message for {selectedTeacher.firstName} {selectedTeacher.lastName}.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Target timezone</label>
                    <Select
                      value={selectedTimezoneOption}
                      onChange={(option) => setTargetTimezone(option?.value || user?.timezone || DEFAULT_TIMEZONE)}
                      options={timezoneSelectOptions}
                      placeholder="Type a city or timezone"
                      isSearchable
                      styles={selectStyles}
                      menuPortalTarget={menuPortalTarget}
                      menuPosition="fixed"
                      filterOption={timezoneFilterOption}
                      formatOptionLabel={timezoneOptionLabel}
                      noOptionsMessage={({ inputValue }) => inputValue ? `No timezones match "${inputValue}"` : 'No timezones available'}
                    />
                    <p className="text-xs text-gray-500">Families will see these times converted automatically.</p>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-[#F8FBFB] p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-gray-800">
                        {shareMode === "admin" && selectedTeacher
                          ? `${selectedTeacher.firstName} ${selectedTeacher.lastName}`
                          : "Your"} availability overview
                      </p>
                      <span className="text-xs font-medium text-gray-400">
                        {defaultAvailabilityActive
                          ? 'Default 24/7 availability'
                          : isAdminAllTeachersShare
                            ? 'All teachers'
                            : hasAvailability
                            ? `${teacherAvailability.slots.length} slot${teacherAvailability.slots.length !== 1 ? 's' : ''}`
                            : 'No slots saved'}
                      </span>
                    </div>
                    <div className="mt-4">
                      {isAdminAllTeachersShare
                        ? (
                          <p className="text-sm text-gray-600">
                            This will generate a message for all teachers.
                          </p>
                        )
                        : renderTeacherAvailabilitySummary()}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <button
                      onClick={handleGenerateShareMessage}
                      className="inline-flex items-center justify-center rounded-full bg-[#2C736C] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#265f59] disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={shareLoading || !hasShareableAvailability}
                    >
                      {shareLoading ? 'Generating…' : 'Generate friendly message'}
                    </button>
                    {!hasShareableAvailability && (
                      <p className="text-xs text-red-500">
                        {shareMode === "admin"
                          ? 'Select a teacher or choose All teachers.'
                          : 'Add availability slots or refresh to continue.'}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-5">
                  {isAdminUser && (
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">Optional: choose a guardian</label>
                      <Select
                        value={selectedGuardianOption}
                        onChange={(option) => handleGuardianSelection(option?.value || null)}
                        options={guardianOptions}
                        placeholder="Search guardians to autofill WhatsApp"
                        isClearable
                        isSearchable
                        styles={selectStyles}
                          menuPortalTarget={menuPortalTarget}
                          menuPosition="fixed"
                          filterOption={guardianFilterOption}
                          formatOptionLabel={guardianOptionLabel}
                          noOptionsMessage={({ inputValue }) => inputValue ? `No guardians found for "${inputValue}"` : 'No guardians found'}
                      />
                      <p className="text-xs text-gray-500">Selecting a guardian fills in their phone number automatically.</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Recipient phone (WhatsApp)</label>
                    <input
                      type="tel"
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="e.g. +971501234567"
                      className="w-full rounded-xl border border-gray-300 px-4 py-2 text-sm focus:border-[#2C736C] focus:outline-none focus:ring-2 focus:ring-[#2C736C]/20"
                    />
                    <p className="text-xs text-gray-500">Include country code. We’ll launch WhatsApp with this number.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Share message</label>
                    <textarea
                      value={shareMessage}
                      onChange={(e) => setShareMessage(e.target.value)}
                      rows={12}
                      placeholder="Click “Generate friendly message” or start writing from scratch."
                      className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm leading-relaxed shadow-inner focus:border-[#2C736C] focus:outline-none focus:ring-2 focus:ring-[#2C736C]/15"
                    />
                    <p className="text-xs text-gray-500">Feel free to personalize the tone before sending.</p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={!canShareMessage}
                      onClick={() => canShareMessage && navigator?.clipboard?.writeText?.(shareMessage)}
                      className="inline-flex items-center justify-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Copy to clipboard
                    </button>
                    <button
                      type="button"
                      disabled={!canShareMessage}
                      onClick={() => canShareMessage && window.open(`mailto:?subject=Teacher Availability&body=${encodeURIComponent(shareMessage)}`)}
                      className="inline-flex items-center justify-center rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Send via email
                    </button>
                    <button
                      type="button"
                      disabled={!canWhatsApp}
                      onClick={() => canWhatsApp && openWhatsApp()}
                      className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1FAF38] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#18962F] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Share on WhatsApp
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <MeetingReportModal
        isOpen={reportModalOpen}
        meeting={reportMeeting}
        onClose={closeMeetingReportModal}
        onSaved={handleMeetingReportSaved}
      />

      <SeriesScannerModal
        isOpen={showSeriesScanner}
        onClose={() => setShowSeriesScanner(false)}
        series={seriesScannerList}
        loading={seriesScannerLoading}
        error={seriesScannerError}
        searchText={seriesScannerSearch}
        onChangeSearchText={setSeriesScannerSearch}
        recreatingId={seriesRecreatingId}
        onEdit={async (pattern) => {
          setShowSeriesScanner(false);
          await openEditFor(pattern);
        }}
        onDelete={(pattern) => {
          setShowSeriesScanner(false);
          handleOpenDeleteModal(pattern);
        }}
        onRecreate={handleRecreateSeriesInstances}
      />

      <CreateClassModal
        isOpen={showCreateModal}
        onClose={handleCloseCreateModal}
        newClass={newClass}
        setNewClass={setNewClass}
        teachers={teachers}
        guardians={guardians}
        students={students}
        handleGuardianChange={handleGuardianChange}
        handleStudentChange={handleStudentChange}
        addRecurrenceSlot={addRecurrenceSlot}
        removeRecurrenceSlot={removeRecurrenceSlot}
        updateRecurrenceSlot={updateRecurrenceSlot}
        handleCreateClass={handleCreateClass}
        resetNewClassForm={resetNewClassForm}
      />

      {/* Edit Class Modal */}
      <EditClassModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setEditClass(null);
          setEditStudents([]);
          setEditAvailabilityWarning(null);
        }}
        editClass={editClass}
        setEditClass={setEditClass}
        teachers={teachers}
        guardians={guardians}
        students={editStudents}
        handleGuardianChange={handleEditGuardianChange}
        handleStudentChange={handleEditStudentChange}
        addRecurrenceSlot={addEditRecurrenceSlot}
        removeRecurrenceSlot={removeEditRecurrenceSlot}
        updateRecurrenceSlot={updateEditRecurrenceSlot}
        handleUpdateClass={handleUpdateClass}
        availabilityWarning={editAvailabilityWarning}
        onDismissAvailabilityWarning={() => setEditAvailabilityWarning(null)}
      />

      <DuplicateClassModal
        isOpen={showDuplicateModal}
        onClose={handleCloseDuplicateModal}
        sourceClass={duplicateClass}
        teachers={teachers}
        guardians={guardians}
        onDuplicated={handleDuplicateSuccess}
      />


      <RescheduleClassModal
        isOpen={showRescheduleModal}
        classId={rescheduleClass?._id}
        initialClass={rescheduleClass}
        onClose={handleCloseRescheduleModal}
        onRescheduled={handleRescheduleSuccess}
      />

      <RescheduleRequestModal
        isOpen={showRescheduleRequestModal}
        classData={requestClass}
        policy={getPolicyForClass(requestClass?._id)}
        policyLoading={policyLoading && focusedClassId === requestClass?._id}
        onClose={handleCloseRescheduleRequestModal}
        onSubmitted={handleRescheduleRequestSuccess}
        userTimezone={user?.timezone || DEFAULT_TIMEZONE}
      />

      <RescheduleRequestDetailsModal
        isOpen={rescheduleDetailsOpen}
        notification={rescheduleDetailsNotification}
        userTimezone={user?.timezone || DEFAULT_TIMEZONE}
        onClose={() => {
          setRescheduleDetailsOpen(false);
          setRescheduleDetailsNotification(null);
        }}
        onDecision={async () => {
          // refresh list so the badge disappears and times update
          await fetchClassesRef.current?.();
        }}
      />

      <CancelClassModal
        isOpen={showCancelModal}
        classData={cancelTargetClass}
        policy={getPolicyForClass(cancelTargetClass?._id)}
        policyLoading={policyLoading && focusedClassId === cancelTargetClass?._id}
        onClose={() => {
          setShowCancelModal(false);
          setCancelTargetClass(null);
        }}
        onCancelled={handleCancelSuccess}
        userRole={user?.role || (isAdminUser ? "admin" : isTeacherUser ? "teacher" : "guardian")}
        userTimezone={user?.timezone || DEFAULT_TIMEZONE}
      />

      <DeleteClassModal
        isOpen={showDeleteModal}
        classId={deleteClass?._id}
        initialClass={deleteClass}
        onClose={handleCloseDeleteModal}
        onCountdownStart={handleDeleteCountdownStart}
      />

    </div>
  );
};

export default ClassesPage;


