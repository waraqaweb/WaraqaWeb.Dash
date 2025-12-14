import React, { useMemo, useEffect, useState, useCallback } from "react";
import moment from "moment-timezone";
import {
  Calendar as BigCalendar,
  Views,
  momentLocalizer
} from "react-big-calendar";
import { formatDateDDMMMYYYY } from '../../utils/date';
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";
import {
  Clock,
  User,
  BookOpen,
  Repeat,
  CalendarCheck,
  Trash2,
  Pencil,
  Copy,
  FileText,
  AlertCircle,
  XCircle,
  Calendar,
  Eye,
  EyeOff
} from "lucide-react";
import api from "../../api/axios";
import { useAuth } from "../../contexts/AuthContext";
import {
  convertClassTimeForUser,
  DEFAULT_TIMEZONE
} from "../../utils/timezoneUtils";
import { MEETING_COLORS, MEETING_TYPE_LABELS } from '../../constants/meetingConstants';

const localizer = momentLocalizer(moment);
const DnDCalendar = withDragAndDrop(BigCalendar);

const STATUS_STYLES = {
  scheduled: { bg: "bg-blue-100", text: "text-blue-800", border: "border-blue-200" },
  in_progress: { bg: "bg-yellow-100", text: "text-yellow-800", border: "border-yellow-200" },
  completed: { bg: "bg-green-100", text: "text-green-800", border: "border-green-200" },
  attended: { bg: "bg-green-100", text: "text-green-800", border: "border-green-200" },
  missed_by_student: { bg: "bg-orange-100", text: "text-orange-800", border: "border-orange-200" },
  cancelled_by_teacher: { bg: "bg-red-100", text: "text-red-700", border: "border-red-200" },
  cancelled_by_student: { bg: "bg-red-100", text: "text-red-700", border: "border-red-200" },
  cancelled_by_admin: { bg: "bg-red-100", text: "text-red-700", border: "border-red-200" },
  no_show_both: { bg: "bg-gray-100", text: "text-gray-700", border: "border-gray-200" }
};

const STATUS_LABEL = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  attended: "Attended",
  missed_by_student: "Missed by student",
  cancelled_by_teacher: "Cancelled by teacher",
  cancelled_by_student: "Cancelled by student",
  cancelled_by_admin: "Cancelled",
  no_show_both: "No show"
};

const DEFAULT_RESCHEDULE_REASON = "Updated from calendar view";

const CALENDAR_STEP_MINUTES = 30;
const CALENDAR_TIMESLOTS_PER_GROUP = 2;
const DEFAULT_SCROLL_HOUR = 8;

// Use dashboard brand colors (lighter / teal accents) instead of dark gray
// Default event color for non-admin users (light, readable)
const EVENT_COLORS = {
  background: "#BBF7D0", // emerald-100 (light)
  border: "#86EFAC",
  primaryText: "#064E3B", // dark text for contrast
  secondaryText: "#A7F3D0",
  metaText: "#86EFAC",
  shadow: "0 6px 12px -4px rgba(15, 23, 42, 0.04)"
};

// Light pastel palette for admin (one distinct pastel per teacher)
const TEACHER_COLOR_PALETTE = [
  { bg: '#FEF3C7', border: '#FDE68A', text: '#92400E' }, // light amber
  { bg: '#E0F2FE', border: '#BAE6FD', text: '#0C4A6E' }, // light sky
  { bg: '#ECFCCB', border: '#D1FAE5', text: '#14532D' }, // light green
  { bg: '#FCE7F3', border: '#FBCFE8', text: '#831843' }, // light pink
  { bg: '#EEF2FF', border: '#E0E7FF', text: '#3730A3' }, // light indigo
  { bg: '#FFF7ED', border: '#FFE8CC', text: '#92400E' }, // light orange
  { bg: '#F3E8FF', border: '#E9D5FF', text: '#5B21B6' }, // light violet
  { bg: '#F0F9FF', border: '#CFEFFF', text: '#075985' }  // light cyan
];

const pickTeacherColor = (teacherId) => {
  if (!teacherId) return TEACHER_COLOR_PALETTE[0];
  let hash = 0;
  const s = String(teacherId);
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) % 1000000007;
  }
  const idx = Math.abs(hash) % TEACHER_COLOR_PALETTE.length;
  return TEACHER_COLOR_PALETTE[idx];
};

// Color utilities: convert hex to RGB, compute luminance and contrast ratio
const hexToRgb = (hex) => {
  if (!hex) return null;
  const h = hex.replace('#', '');
  const bigint = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return { r, g, b };
};

const srgbToLinear = (value) => {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

const relativeLuminance = (hex) => {
  const rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (hex1, hex2) => {
  try {
    const L1 = relativeLuminance(hex1);
    const L2 = relativeLuminance(hex2);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    return (lighter + 0.05) / (darker + 0.05);
  } catch (err) {
    return 1;
  }
};

const getReadableOn = (bgHex) => {
  // prefer dark text on light backgrounds and white text on dark backgrounds
  const white = '#ffffff';
  const black = '#04111a';
  // compute which of white/black gives better contrast
  const ratioWithWhite = contrastRatio(bgHex, white);
  const ratioWithBlack = contrastRatio(bgHex, black);
  return ratioWithWhite >= ratioWithBlack ? white : black;
};

const toRgba = (hex, alpha = 1) => {
  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const AVAILABILITY_COLORS = {
  background: "rgba(226, 232, 240, 0.88)",
  border: "rgba(148, 163, 184, 0.75)",
  label: "#1E293B",
  time: "#475569",
  icon: "#475569",
  shadow: "0 2px 4px rgba(148, 163, 184, 0.35)"
};

const formatDisplayRange = (start, end, timezone) => {
  try {
    const dateFormatter = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: timezone
    });
    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone
    });

    const dateLabel = dateFormatter.format(start);
    const timeLabel = `${timeFormatter.format(start)} – ${timeFormatter.format(end)}`;

    return { dateLabel, timeLabel };
  } catch (err) {
    console.error("Calendar range format error", err);
    return {
  dateLabel: formatDateDDMMMYYYY(start),
      timeLabel: `${start.toLocaleTimeString()} – ${end.toLocaleTimeString()}`
    };
  }
};

const EventCard = ({ event }) => {
  const resource = event?.resource || {};

  if (resource.type === "availability") {
    const startLabel = moment(event.start).format("HH:mm");
    const endLabel = moment(event.end).format("HH:mm");

    return (
      <div
        className="flex h-full flex-col justify-between rounded-md px-2 py-1 text-[11px]"
        style={{
          backgroundColor: "transparent",
          border: "none",
          color: AVAILABILITY_COLORS.label
        }}
      >
        <div className="flex items-center gap-1 font-semibold" style={{ color: AVAILABILITY_COLORS.label }}>
          <Clock className="h-3 w-3" style={{ color: AVAILABILITY_COLORS.icon }} />
          <span>Available</span>
        </div>
        <span className="font-medium" style={{ color: AVAILABILITY_COLORS.time }}>
          {startLabel} – {endLabel}
        </span>
      </div>
    );
  }

  if (resource.type === 'meeting') {
    const meeting = resource.meeting || {};
    const meetingLabel = MEETING_TYPE_LABELS[meeting.meetingType] || 'Meeting';
    const guardianName = meeting.bookingPayload?.guardianName || meeting.guardianName;
    const teacherName = meeting.attendees?.teacherName || meeting.teacherName;
    const participantsLabel = guardianName || teacherName || 'Admin team';
    const durationMinutes = meeting.durationMinutes || meeting.duration || 30;
    const borderColor = resource.eventColors?.border || MEETING_COLORS.border;
    const primary = resource.eventColors?.primaryText || MEETING_COLORS.text;
    const secondary = resource.eventColors?.secondaryText || 'rgba(146,64,14,0.9)';

    return (
      <div className="flex h-full flex-col justify-between" style={{ background: 'transparent' }}>
        <div className="flex items-center justify-between text-xs font-semibold" style={{ color: primary }}>
          <span className="truncate">{meetingLabel}</span>
          <span className="ml-2 shrink-0 text-[10px]" style={{ color: borderColor }}>
            {durationMinutes} min
          </span>
        </div>
        <div className="mt-0 text-[11px]" style={{ color: secondary }}>
          {participantsLabel}
        </div>
      </div>
    );
  }

  const classItem = resource.classItem;

  if (!classItem) {
    return null;
  }

  const borderColor = resource.eventColors?.border || EVENT_COLORS.border;
  const primaryTextColor = resource.eventColors?.primaryText || EVENT_COLORS.primaryText;
  const secondaryTextColor = resource.eventColors?.secondaryText || EVENT_COLORS.secondaryText;
  const metaTextColor = resource.eventColors?.metaText || EVENT_COLORS.metaText;

  return (
    // Let the calendar's outer event element render the background and rounded
    // container. Here we render a transparent, full-height content wrapper so
    // the text occupies the full colored area without an inner rounded box.
    <div
      className="flex flex-col pl-0 pr-0 py-0 h-full"
      style={{ background: "transparent" }}
    >
      <div className="flex items-center justify-between text-xs font-medium">
        <span className="truncate font-semibold" style={{ color: primaryTextColor, marginTop: '-2px' }}>
          {classItem?.student?.studentName || "Unnamed"}
        </span>
        <span className="ml-0 shrink-0 text-[10px]" style={{ color: metaTextColor }}>
          {classItem?.duration || 60} min
        </span>
      </div>
      <div className="mt-0 flex items-center justify-between text-[11px]" style={{ color: secondaryTextColor }}>
        <span className="flex items-center gap-1 truncate">
          <BookOpen className="h-3 w-3" style={{ color: metaTextColor }} />
          <span className="truncate">{classItem?.subject || "Class"}</span>
        </span>
        <span className="flex items-center gap-1 truncate" style={{ color: metaTextColor }}>
          <User className="h-3 w-3" style={{ color: metaTextColor }} />
          <span className="truncate">
            {(classItem?.teacher?.firstName || "").concat(
              classItem?.teacher?.lastName ? ` ${classItem.teacher.lastName}` : ""
            ) || "Teacher"}
          </span>
        </span>
      </div>
    </div>
  );
};

const ClassesCalendarView = ({
  classes = [],
  meetings = [],
  meetingsLoading = false,
  onRefresh,
  onEditClass,
  onReschedule,
  onCancel,
  onDuplicate,
  onDelete,
  onSubmitReport,
  canManageClasses = false,
  canSubmitReport = () => false,
  userTimezone = DEFAULT_TIMEZONE,
  availabilityData = null,
  availabilityEnabled = false,
  availabilityLoading = false,
  availabilityLabel = "",
  onToggleAvailability,
  canEditAvailability = false,
  onRefreshAvailability,
  availabilityTeacherId = null
  ,
  // optional remote control for tabs and layout moved from parent into the toolbar
  tabFilter = 'upcoming',
  onChangeTab = null,
  viewLayout = 'calendar',
  onChangeLayout = null
}) => {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [activeDate, setActiveDate] = useState(() => new Date());
  const [savingEventId, setSavingEventId] = useState(null);

  const computeCalendarHeight = () => {
    if (typeof window === 'undefined') return 720;
    const viewportHeight = window.innerHeight;
    const reservedChrome = 260; // header, filters, paddings
    return Math.max(620, viewportHeight - reservedChrome);
  };

  const [calendarHeight, setCalendarHeight] = useState(() => computeCalendarHeight());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => {
      setCalendarHeight(computeCalendarHeight());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const { isAdmin } = useAuth();
  const isAdminUser = typeof isAdmin === 'function' ? isAdmin() : false;

  useEffect(() => {
    if (typeof moment?.tz?.setDefault !== "function") return undefined;

    const previousDefaultZone = moment?.tz?._defaultZone?.name || null;

    if (userTimezone) {
      moment.tz.setDefault(userTimezone);
    }

    return () => {
      if (previousDefaultZone) {
        moment.tz.setDefault(previousDefaultZone);
      } else {
        moment.tz.setDefault();
      }
    };
  }, [userTimezone]);

  const classEvents = useMemo(() => {
    const now = new Date();
    

    return (classes || [])
      .filter((cls) => Boolean(cls?.scheduledDate))
      .map((classItem) => {
        const conversion = convertClassTimeForUser(
          classItem.scheduledDate,
          classItem.timezone || DEFAULT_TIMEZONE,
          userTimezone
        );
        const start = conversion?.convertedDate
          ? new Date(conversion.convertedDate)
          : new Date(classItem.scheduledDate);
        const durationMinutes = Number(classItem.duration || 60);
        const end = new Date(start.getTime() + durationMinutes * 60000);
        const statusStyle = STATUS_STYLES[classItem.status] || STATUS_STYLES.scheduled;
        const isPast = end.getTime() < now.getTime();
        const isEditable = Boolean(
          canManageClasses &&
          classItem.status === "scheduled" &&
          !isPast
        );

        // assign event colors: if admin, choose per-teacher palette, else use default
        let eventColors = { ...EVENT_COLORS };
        if (isAdminUser) {
          const teacherId = classItem.teacher?._id || classItem.teacher;
          const palette = pickTeacherColor(teacherId);
          eventColors = {
            background: palette.bg,
            border: palette.border,
            // palette may include a suggested text color; we'll compute a readable
            // fallback based on the background to ensure sufficient contrast.
            primaryText: palette.text || EVENT_COLORS.primaryText,
            secondaryText: palette.text || EVENT_COLORS.secondaryText,
            metaText: palette.text || EVENT_COLORS.metaText,
            shadow: '0 6px 12px rgba(15,23,42,0.06)'
          };
        }

        // Ensure readable primary/secondary/meta text on top of the chosen background.
        try {
          const bg = eventColors.background || EVENT_COLORS.background;
          const readable = getReadableOn(bg);
          // If current primaryText doesn't meet a reasonable contrast threshold,
          // override it with the computed readable one. WCAG recommends 4.5:1
          const currentPrimary = eventColors.primaryText || EVENT_COLORS.primaryText;
          const cr = contrastRatio(currentPrimary, bg);
          if (!currentPrimary || cr < 4.5) {
            eventColors.primaryText = readable;
          }

          // secondary/meta should be slighty translucent variants of primary for visual hierarchy
          if (eventColors.primaryText === '#ffffff') {
            eventColors.secondaryText = 'rgba(255,255,255,0.9)';
            eventColors.metaText = 'rgba(255,255,255,0.85)';
          } else {
            // use a near-opaque version of the readable color for secondary/meta
            eventColors.secondaryText = toRgba(eventColors.primaryText, 0.95);
            eventColors.metaText = toRgba(eventColors.primaryText, 0.8);
          }
        } catch (err) {
          // fallback: ensure there's always a readable primary text color
          eventColors.primaryText = eventColors.primaryText || EVENT_COLORS.primaryText;
          eventColors.secondaryText = eventColors.secondaryText || EVENT_COLORS.secondaryText;
          eventColors.metaText = eventColors.metaText || EVENT_COLORS.metaText;
        }

        return {
          id: classItem._id,
          title: classItem.student?.studentName || classItem.title || "Class",
          start,
          end,
          allDay: false,
          resource: {
            classItem,
            isEditable,
            statusStyle,
            status: classItem.status || "scheduled",
            isRecurring: Boolean(classItem.isRecurring),
            originalStart: new Date(classItem.scheduledDate),
            conversion,
            eventColors
          }
        };
      })
      .sort((a, b) => a.start - b.start);
  }, [classes, canManageClasses, userTimezone]);

  const meetingEvents = useMemo(() => {
    if (!Array.isArray(meetings) || !meetings.length) return [];
    return meetings
      .filter((meeting) => meeting?.visibility?.showInCalendar !== false)
      .map((meeting) => {
        const meetingTimezone = meeting.timezone || DEFAULT_TIMEZONE;
        const originalStart = meeting.scheduledStart ? new Date(meeting.scheduledStart) : new Date();
        const fallbackDuration = Number(meeting.durationMinutes || meeting.duration || 30) || 30;
        const originalEnd = meeting.scheduledEnd
          ? new Date(meeting.scheduledEnd)
          : new Date(originalStart.getTime() + fallbackDuration * 60000);

        const startConversion = convertClassTimeForUser(originalStart, meetingTimezone, userTimezone);
        const endConversion = convertClassTimeForUser(originalEnd, meetingTimezone, userTimezone);

        const start = startConversion?.convertedDate
          ? new Date(startConversion.convertedDate)
          : originalStart;
        const end = endConversion?.convertedDate
          ? new Date(endConversion.convertedDate)
          : originalEnd;

        const baseColors = meeting.visibility || {};
        const eventColors = {
          background: baseColors.displayColor || MEETING_COLORS.background,
          border: baseColors.borderColor || MEETING_COLORS.border,
          primaryText: baseColors.textColor || MEETING_COLORS.text,
          secondaryText: baseColors.textColor || MEETING_COLORS.text,
          metaText: baseColors.textColor || MEETING_COLORS.text,
          shadow: '0 6px 12px rgba(146,64,14,0.15)'
        };

        return {
          id: meeting._id || meeting.id,
          title: MEETING_TYPE_LABELS[meeting.meetingType] || 'Meeting',
          start,
          end,
          allDay: false,
          resource: {
            type: 'meeting',
            meeting,
            eventColors,
            conversion: startConversion
          }
        };
      })
      .sort((a, b) => a.start - b.start);
  }, [meetings, userTimezone]);

  const availabilityBackgroundEvents = useMemo(() => {
    if (!availabilityEnabled || !availabilityData) return [];

    const timezone = availabilityData.timezone || userTimezone;
    const weekStart = moment(activeDate).tz(userTimezone).startOf("week");
    const eventsList = [];

    if (availabilityData.isDefaultAvailability) {
      for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
        const baseDay = weekStart.clone().add(dayIndex, "day");
        const startInViewerZone = baseDay.clone().startOf("day");
        const endInViewerZone = startInViewerZone.clone().add(24, "hours");

        eventsList.push({
          id: `availability-default-${dayIndex}-${startInViewerZone.valueOf()}`,
          start: startInViewerZone.toDate(),
          end: endInViewerZone.toDate(),
          allDay: false,
          resource: { type: "availability-default", timezone }
        });
      }
      return eventsList;
    }

    return [];
  }, [availabilityEnabled, availabilityData, activeDate, userTimezone]);

  const availabilityInteractiveEvents = useMemo(() => {
    if (!availabilityEnabled || !availabilityData || availabilityData.isDefaultAvailability) return [];

    const slotsByDay = availabilityData.slotsByDay || {};
    const timezone = availabilityData.timezone || userTimezone;
    const weekStart = moment(activeDate).tz(userTimezone).startOf("week");
    const eventsList = [];

    Object.entries(slotsByDay).forEach(([dayKey, slots]) => {
      const dayIndex = Number.parseInt(dayKey, 10);
      if (Number.isNaN(dayIndex)) return;

      const baseDay = weekStart.clone().add(dayIndex, "day");

      (slots || []).forEach((slot) => {
        const [startHourRaw = "0", startMinuteRaw = "0"] = (slot.startTime || "00:00").split(":");
        const [endHourRaw = "0", endMinuteRaw = "0"] = (slot.endTime || "00:00").split(":");
        const startHour = Number.parseInt(startHourRaw, 10) || 0;
        const startMinute = Number.parseInt(startMinuteRaw, 10) || 0;
        const endHour = Number.parseInt(endHourRaw, 10) || 0;
        const endMinute = Number.parseInt(endMinuteRaw, 10) || 0;

        const slotStart = moment.tz({
          year: baseDay.year(),
          month: baseDay.month(),
          date: baseDay.date(),
          hour: startHour,
          minute: startMinute,
          second: 0,
          millisecond: 0
        }, timezone);

        let slotEnd = moment.tz({
          year: baseDay.year(),
          month: baseDay.month(),
          date: baseDay.date(),
          hour: endHour,
          minute: endMinute,
          second: 0,
          millisecond: 0
        }, timezone);

        if (!slot.endTime || slotEnd.isSameOrBefore(slotStart)) {
          const fallbackDuration = Number(slot.durationMinutes) || 60;
          slotEnd = slotStart.clone().add(fallbackDuration, "minutes");
        }

        const startInViewerZone = slotStart.clone().tz(userTimezone);
        const endInViewerZone = slotEnd.clone().tz(userTimezone);

        eventsList.push({
          id: `availability-interactive-${dayIndex}-${slot._id || `${slot.startTime}-${slot.endTime}`}-${slotStart.valueOf()}`,
          start: startInViewerZone.toDate(),
          end: endInViewerZone.toDate(),
          allDay: false,
          resource: {
            type: "availability",
            slot,
            dayIndex,
            isEditable: Boolean(canEditAvailability),
            timezone,
            teacherId: availabilityTeacherId
          }
        });
      });
    });

    return eventsList;
  }, [availabilityEnabled, availabilityData, activeDate, userTimezone, canEditAvailability, availabilityTeacherId]);

  const calendarEvents = useMemo(
    () => [...meetingEvents, ...classEvents, ...availabilityInteractiveEvents],
    [meetingEvents, classEvents, availabilityInteractiveEvents]
  );

  useEffect(() => {
    try {
      // Debug: print a concise table of events to verify start/end and timezone conversion
      if (calendarEvents && calendarEvents.length) {
        // eslint-disable-next-line no-console
        console.debug("[Calendar] calendarEvents:", calendarEvents.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.start && e.start.toString(),
          end: e.end && e.end.toString(),
          allDay: e.allDay,
          scheduledDate: e.resource?.originalStart && e.resource.originalStart.toString(),
          converted: e.resource?.conversion && e.resource.conversion.convertedDate
        })));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[Calendar] debug log failed", err);
    }
  }, [calendarEvents]);

  useEffect(() => {
    const combined = [...meetingEvents, ...classEvents].sort((a, b) => a.start - b.start);
    if (!combined.length) return;
    const now = new Date();
    const firstUpcoming = combined.find((event) => event.end > now);
    if (firstUpcoming) {
      setActiveDate(firstUpcoming.start);
    }
  }, [classEvents, meetingEvents]);

  const eventPropGetter = useCallback((event) => {
    if (event?.resource?.type === "availability") {
      return {
        style: {
          backgroundColor: AVAILABILITY_COLORS.background,
          borderRadius: "12px",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: AVAILABILITY_COLORS.border,
          color: AVAILABILITY_COLORS.label,
          boxShadow: AVAILABILITY_COLORS.shadow,
          zIndex: 1
        }
      };
    }

    if (event?.resource?.type === 'meeting') {
      const colors = event.resource.eventColors || MEETING_COLORS;
      return {
        style: {
          backgroundColor: colors.background,
          borderRadius: '14px',
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.border,
          color: colors.primaryText || MEETING_COLORS.text,
          opacity: 0.96,
          boxShadow: colors.shadow || '0 4px 10px rgba(250, 204, 21, 0.35)',
          zIndex: 2
        }
      };
    }

    const colors = event.resource.eventColors || EVENT_COLORS;

    return {
      className: "",
      style: {
        backgroundColor: colors.background,
        borderRadius: "12px",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: colors.border,
        color: colors.primaryText,
        opacity: 0.98,
        boxShadow: colors.shadow || "0 4px 8px rgba(15, 23, 42, 0.18)",
        zIndex: 3
      }
    };
  }, []);

  const availabilityBackgroundPropGetter = useCallback(() => ({
    className: "availability-layer",
    // Render availability as a subtle top band instead of filling the whole day
    style: {
      // Create a top-colored band (36px) and keep the rest transparent so the
      // day column isn't fully colored.
      backgroundImage: `linear-gradient(to bottom, ${AVAILABILITY_COLORS.background} 0px, ${AVAILABILITY_COLORS.background} 36px, transparent 36px)`,
      borderTop: `1px solid ${AVAILABILITY_COLORS.border}`,
      borderBottom: "none",
      borderRadius: "6px 6px 0 0",
      boxShadow: "inset 0 0 0 1px rgba(148, 163, 184, 0.08)",
      overflow: "visible"
    }
  }), []);

  const minTime = useMemo(() => {
    return moment().tz(userTimezone || DEFAULT_TIMEZONE).startOf('day').toDate();
  }, [userTimezone]);

  const maxTime = useMemo(() => {
    return moment().tz(userTimezone || DEFAULT_TIMEZONE).endOf('day').toDate();
  }, [userTimezone]);

  const scrollTimeAnchor = useMemo(() => {
    return moment(minTime).tz(userTimezone || DEFAULT_TIMEZONE).add(DEFAULT_SCROLL_HOUR, 'hours').toDate();
  }, [minTime, userTimezone]);

  const draggableAccessor = useCallback((event) => {
    if (event?.resource?.type === 'meeting') return false;
    return Boolean(event?.resource?.isEditable);
  }, []);
  const resizableAccessor = draggableAccessor;

  const updateClassSchedule = useCallback(
    async (event, start, end) => {
      if (!event?.resource?.isEditable) return;

      const classItem = event.resource.classItem;
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        alert("Class duration must be greater than zero minutes.");
        throw new Error("Invalid class duration");
      }

      if (durationMinutes < 15) {
        alert("Classes must be at least 15 minutes long.");
        throw new Error("Duration below minimum");
      }

      if (durationMinutes > 180) {
        alert("Classes cannot exceed 180 minutes. Please choose a shorter time range.");
        throw new Error("Duration above maximum");
      }

      const isoStart = start.toISOString();

      setSavingEventId(classItem._id);
      try {
        await api.put(`/classes/${classItem._id}/reschedule`, {
          newDate: isoStart,
          duration: durationMinutes,
          reason: DEFAULT_RESCHEDULE_REASON
        });
        if (typeof onRefresh === "function") {
          await onRefresh();
        }
      } catch (error) {
        const message = error?.response?.data?.message || "Failed to reschedule class";
        if (error?.response?.data?.availabilityError?.alternatives?.length) {
          const alternative = error.response.data.availabilityError.alternatives
            .map((alt) => `${new Date(alt.start).toLocaleString()} (${alt.duration} min)`).join("\n");
          alert(`${message}.\nSuggested slots:\n${alternative}`);
        } else {
          alert(message);
        }
        throw error;
      } finally {
        setSavingEventId(null);
      }
    },
    [onRefresh]
  );

  const updateAvailabilitySlot = useCallback(
    async (event, start, end) => {
      if (event?.resource?.type !== "availability" || !event?.resource?.isEditable) {
        return;
      }

      const slot = event.resource.slot;
      if (!slot?._id) {
        alert("Couldn't identify this availability slot.");
        throw new Error("Missing slot id");
      }

      const timezone = event.resource.timezone || availabilityData?.timezone || userTimezone || DEFAULT_TIMEZONE;
      const teacherId = event.resource.teacherId || availabilityTeacherId;

      const startMoment = moment(start).tz(timezone);
      const endMoment = moment(end).tz(timezone);

      if (!endMoment.isAfter(startMoment)) {
        alert("Availability end time must be after the start time.");
        throw new Error("Invalid availability duration");
      }

      const minutes = endMoment.diff(startMoment, "minutes");
      if (minutes < 15) {
        alert("Availability slots must be at least 15 minutes long.");
        throw new Error("Availability duration below minimum");
      }

      if (minutes > 12 * 60) {
        alert("Availability slots cannot exceed 12 hours.");
        throw new Error("Availability duration above maximum");
      }

      const startDay = startMoment.clone().startOf("day");
      const endDay = endMoment.clone().startOf("day");
      if (!startDay.isSame(endDay)) {
        alert("Availability slots must stay within a single day.");
        throw new Error("Availability crosses day boundary");
      }

      const payload = {
        dayOfWeek: startMoment.day(),
        startTime: startMoment.format("HH:mm"),
        endTime: endMoment.format("HH:mm"),
        timezone
      };

      setSavingEventId(slot._id);
      try {
        await api.put(`/availability/slots/${slot._id}`, payload);
        if (typeof onRefreshAvailability === "function") {
          await onRefreshAvailability(teacherId);
        }
      } catch (error) {
        const message = error?.response?.data?.message || "Failed to update availability slot";
        alert(message);
        throw error;
      } finally {
        setSavingEventId(null);
      }
    },
    [availabilityData, userTimezone, availabilityTeacherId, onRefreshAvailability]
  );

  const handleEventDrop = useCallback(
    async ({ event, start, end }) => {
      try {
        if (event?.resource?.type === "availability") {
          await updateAvailabilitySlot(event, start, end);
        } else if (event?.resource?.type === 'meeting') {
          return;
        } else {
          await updateClassSchedule(event, start, end);
        }
      } catch (err) {
        // swallow after alert
      }
    },
    [updateClassSchedule, updateAvailabilitySlot]
  );

  const handleEventResize = useCallback(
    async ({ event, start, end }) => {
      try {
        if (event?.resource?.type === "availability") {
          await updateAvailabilitySlot(event, start, end);
        } else if (event?.resource?.type === 'meeting') {
          return;
        } else {
          await updateClassSchedule(event, start, end);
        }
      } catch (err) {
        // swallow after alert
      }
    },
    [updateClassSchedule, updateAvailabilitySlot]
  );

  const components = useMemo(
    () => ({
      event: EventCard,
      toolbar: () => null
    }),
    []
  );

  // Compute a friendly week-range label for the header's navigation controls
  const weekLabel = useMemo(() => {
    try {
      const start = moment(activeDate).tz(userTimezone).startOf("week").toDate();
      const end = moment(activeDate).tz(userTimezone).endOf("week").toDate();
      return `${formatDateDDMMMYYYY(start)} — ${formatDateDDMMMYYYY(end)}`;
    } catch (e) {
      return formatDateDDMMMYYYY(activeDate);
    }
  }, [activeDate, userTimezone]);
  const formats = useMemo(() => ({
    // show hours in 12-hour format with minutes (e.g. 12:00 AM, 1:00 AM, ... 11:00 PM)
    timeGutterFormat: (date, culture, localizer) => {
      try {
        return moment(date).format("h:mm A");
      } catch (err) {
        return localizer.format(date, 'HH:mm');
      }
    }
  }), []);

  const selectEvent = useCallback((event) => {
    if (event?.resource?.type === "availability") {
      return;
    }
    setSelectedEvent(event);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedEvent(null);
  }, []);

  // Build left gutter labels (every hour) to overlay the calendar's time slots.
  const selectedClass = selectedEvent?.resource?.classItem || null;
  const selectedMeeting = selectedEvent?.resource?.type === 'meeting' ? selectedEvent.resource.meeting : null;
  const selectedRange = selectedEvent
    ? formatDisplayRange(selectedEvent.start, selectedEvent.end, userTimezone)
    : null;

  return (
    <div className="space-y-4">
      {selectedClass && selectedRange && (
        <div className="mb-2 w-full">
          <div className="flex items-center justify-between">
            <div className="space-y-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <CalendarCheck className="h-4 w-4 text-[#2C736C]" />
                <span>{selectedClass.student?.studentName || "Unnamed student"}</span>
                {selectedClass.isRecurring && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                    <Repeat className="h-3 w-3" /> Recurring
                  </span>
                )}
              </div>
              <div className="text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span>{selectedRange.dateLabel}</span>
                  <span className="text-gray-400">•</span>
                  <span>{selectedRange.timeLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-600">
              <div className="mr-2">{(selectedClass.teacher?.firstName || "") + (selectedClass.teacher?.lastName ? ` ${selectedClass.teacher.lastName}` : "")}</div>
              <div className="mr-2">{selectedClass.subject || selectedClass.title || "Class"}</div>
              <div className="opacity-80">Status: {STATUS_LABEL[selectedClass.status] || "Scheduled"}</div>
            </div>
          </div>
        </div>
      )}

      {!selectedClass && selectedMeeting && selectedRange && (
        <div className="mb-2 w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <CalendarCheck className="h-4 w-4 text-[#D97706]" />
                <span>{MEETING_TYPE_LABELS[selectedMeeting.meetingType] || 'Meeting'}</span>
              </div>
              <div className="text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-gray-400" />
                  <span>{selectedRange.dateLabel}</span>
                  <span className="text-gray-400">•</span>
                  <span>{selectedRange.timeLabel}</span>
                </div>
              </div>
            </div>
            <div className="text-sm text-gray-600 space-y-1 text-right">
              {selectedMeeting.bookingPayload?.guardianName && (
                <div>Guardian: {selectedMeeting.bookingPayload.guardianName}</div>
              )}
              {selectedMeeting.attendees?.teacherName && (
                <div>Teacher: {selectedMeeting.attendees.teacherName}</div>
              )}
              {Array.isArray(selectedMeeting.bookingPayload?.students) && selectedMeeting.bookingPayload.students.length > 0 && (
                <div className="text-xs text-gray-500">
                  Students: {selectedMeeting.bookingPayload.students.map((s) => s.studentName || 'Student').join(', ')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {/* Page header (single-row layout with even spacing) placed above the calendar table */}
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-evenly gap-4 py-1">
      
      <div className="flex items-center gap-2">
        <button
          onClick={() => setActiveDate(new Date())}
          className="rounded-full border border-gray-200 px-3 py-1 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
        >
          Today
        </button>

        <div className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 text-sm font-medium text-gray-700">
          <button
            onClick={() => setActiveDate((prev) => moment(prev).tz(userTimezone).subtract(1, "week").toDate())}
            className="rounded-l-full px-2 py-1 transition hover:bg-white"
          >
            ‹
          </button>
          <span className="px-3 py-1 text-sm font-semibold text-gray-700">{weekLabel}</span>
          <button
            onClick={() => setActiveDate((prev) => moment(prev).tz(userTimezone).add(1, "week").toDate())}
            className="rounded-r-full px-2 py-1 transition hover:bg-white"
          >
            ›
          </button>
        </div>
      </div>
        </div>
      </div>

      <div
        className="classes-calendar-shell relative overflow-hidden rounded-2xl border border-gray-200 bg-white p-2 shadow-sm"
        style={{ height: calendarHeight }}
      >
        {savingEventId && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/60">
            <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 shadow">
              <Clock className="h-4 w-4 animate-spin" /> Saving changes…
            </div>
          </div>
        )}
        {(availabilityData || typeof onToggleAvailability === "function") && (
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <span className="inline-flex items-center gap-2 font-medium text-[#2C736C]">
                <span className="relative flex h-4 w-4 items-center justify-center">
                  <span className="absolute h-3 w-3 rounded-full border border-[#2C736C]/60 bg-[#2C736C]/20" />
                </span>
                Availability layer
              </span>
              <span>
                {availabilityEnabled
                  ? `Showing${availabilityLabel ? ` for ${availabilityLabel}` : ""}`
                  : `Hidden${availabilityLabel ? ` for ${availabilityLabel}` : ""}`}
              </span>
              {availabilityData?.timezone && (
                <span className="text-gray-400">
                  • Teacher timezone: {availabilityData.timezone}
                </span>
              )}
              {availabilityLoading && (
                <Clock className="h-4 w-4 animate-spin text-[#2C736C]" />
              )}
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-800">
                <span
                  className="h-3 w-3 rounded-full border"
                  style={{
                    backgroundColor: MEETING_COLORS.background,
                    borderColor: MEETING_COLORS.border
                  }}
                />
                Admin meetings
                {meetingsLoading && <Clock className="h-4 w-4 animate-spin text-amber-700" />}
              </span>
            </div>
            {typeof onToggleAvailability === "function" && (
              <button
                onClick={onToggleAvailability}
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-[#2C736C]/40 bg-white px-4 py-2 text-sm font-semibold text-[#2C736C] transition hover:bg-[#2C736C]/10"
              >
                {availabilityEnabled ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                <span>{availabilityEnabled ? "Hide availability" : "Show availability"}</span>
              </button>
            )}
          </div>
        )}
        <DnDCalendar
          localizer={localizer}
          defaultView={Views.WEEK}
          views={[Views.WEEK, Views.DAY]}
          step={CALENDAR_STEP_MINUTES}
          timeslots={CALENDAR_TIMESLOTS_PER_GROUP}
          showMultiDayTimes
          selectable={false}
          resizable
          popup
          events={calendarEvents}
          date={activeDate}
          min={minTime}
          max={maxTime}
          scrollToTime={scrollTimeAnchor}
          dayLayoutAlgorithm="no-overlap"
          longPressThreshold={12}
          style={{ height: "100%" }}
          onNavigate={setActiveDate}
          onSelectEvent={selectEvent}
          eventPropGetter={eventPropGetter}
          formats={formats}
          components={components}
          draggableAccessor={draggableAccessor}
          resizableAccessor={resizableAccessor}
          onEventDrop={handleEventDrop}
          onEventResize={handleEventResize}
          tooltipAccessor={null}
          backgroundEvents={availabilityEnabled ? availabilityBackgroundEvents : []}
          backgroundEventPropGetter={availabilityBackgroundPropGetter}
        />
      </div>

      {!classEvents.length && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
            <CalendarCheck className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-gray-800">No classes scheduled</h3>
          <p className="mt-1 text-sm text-gray-500">
            Switch back to the event list to create classes, then return here to manage them in the calendar.
          </p>
        </div>
      )}
    </div>
  );
};

export default ClassesCalendarView;
