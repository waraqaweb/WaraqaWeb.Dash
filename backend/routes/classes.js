/**
 * backend/routes/classes.js
 *
 * - Clean, consistent responses: always `{ classes: [...], now, pagination? }`
 * - Fixed tzUsed bug in non-recurring POST
 * - Filter `?filter=upcoming` and `?filter=previous` use scheduledDate + duration properly
 * - Emits Socket.IO events if `app.set('io', io)` exists
 * - Keeps recurrence generation, update, delete, report, maintenance
 */

const express = require("express");
const mongoose = require('mongoose');
const router = express.Router();
const { body, validationResult } = require("express-validator");
const { authenticateToken, requireRole } = require("../middleware/auth");
const Class = require("../models/Class");
const User = require("../models/User");
const Notification = require("../models/Notification");
const Student = require("../models/Student");
const InvoiceModel = require("../models/Invoice");
const InvoiceService = require('../services/invoiceService');
const systemVacationService = require("../services/systemVacationService");
const availabilityService = require("../services/availabilityService");
const {
  extractParticipantIds,
  refreshParticipantsFromSchedule,
} = require("../services/activityStatusService");
const { processArrayWithTimezone, addTimezoneInfo, DEFAULT_TIMEZONE } = require("../utils/timezoneUtils");
const {
  normalizeAnchorMode,
  resolveStudentTimezone,
  resolveTeacherTimezone,
  resolveAnchorTimezone,
  resolveClassTimezone,
  buildTimeAnchorForScheduledClass,
  buildTimeAnchorForSlot,
  buildRecurringSlotAnchor,
} = require("../services/classTimezoneService");

// timezone helpers (you must have these implemented)
const tzUtils = require("../utils/timezone"); // expects toUtc(dateString, tz) and buildUtcFromParts(parts, tz)
const { generateRecurringClasses } = require("../utils/generateRecurringClasses");
const { saveToTrash, saveMultipleToTrash } = require("../utils/trash");

/* -------------------------
   GET /api/classes/reschedule-requests/stats
   Admin-only: counts of reschedule requests by requester role within a date range.
   Backed by Notification metadata (kind=class_reschedule_request).
   ------------------------- */
router.get("/reschedule-requests/stats", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const { teacherId, studentId, guardianId, from, to, days } = req.query || {};

    const now = new Date();
    const parsedTo = to ? new Date(to) : now;
    const parsedFrom = from
      ? new Date(from)
      : (days ? new Date(now.getTime() - Number(days) * 24 * 60 * 60 * 1000) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));

    if (Number.isNaN(parsedFrom.getTime()) || Number.isNaN(parsedTo.getTime())) {
      return res.status(400).json({ message: "Invalid date range" });
    }

    if (parsedTo < parsedFrom) {
      return res.status(400).json({ message: "Invalid date range" });
    }

    const match = {
      createdAt: { $gte: parsedFrom, $lte: parsedTo },
      "metadata.kind": "class_reschedule_request",
    };

    if (teacherId) match["metadata.teacherId"] = String(teacherId);
    if (studentId) match["metadata.studentId"] = String(studentId);
    if (guardianId) match["metadata.guardianId"] = String(guardianId);

    const rows = await Notification.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            role: "$metadata.requestedByRole",
            key: { $ifNull: ["$metadata.rescheduleRequestKey", "$_id"] },
          },
          any: { $first: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.role",
          count: { $sum: 1 },
        },
      },
    ]);

    const countsByRole = {};
    let total = 0;
    rows.forEach((row) => {
      const role = row._id || "unknown";
      const count = Number(row.count) || 0;
      countsByRole[role] = count;
      total += count;
    });

    return res.json({
      range: { from: parsedFrom.toISOString(), to: parsedTo.toISOString() },
      filters: { teacherId: teacherId || null, studentId: studentId || null, guardianId: guardianId || null },
      total,
      countsByRole,
    });
  } catch (err) {
    console.error("GET /classes/reschedule-requests/stats error:", err);
    return res.status(500).json({ message: "Failed to fetch reschedule request stats", error: err.message });
  }
});

/* -------------------------
   Small helpers
   ------------------------- */

function toBool(val) {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") return val === "true";
  return false;
}

function buildPerDayMap(recurrenceDetails = []) {
  const map = new Map();
  for (const slot of recurrenceDetails) {
    if (
      slot &&
      (typeof slot.dayOfWeek === "number" || typeof slot.dayOfWeek === "string") &&
      typeof slot.time === "string" &&
      /^\d{2}:\d{2}$/.test(slot.time)
    ) {
      const d = Number(slot.dayOfWeek);
      const [hh, mm] = slot.time.split(":").map((s) => parseInt(s, 10));
      const entry = {
        hours: hh,
        minutes: mm,
        duration: typeof slot.duration === "number" ? slot.duration : undefined,
        timezone: slot.timezone || undefined,
        raw: slot.raw || slot,
      };
      const existing = map.get(d) || [];
      existing.push(entry);
      map.set(d, existing);
    }
  }
  return map;
}

function normalizeRecurrenceSlots(slots, fallbackTimezone) {
  const tz = fallbackTimezone || "UTC";
  if (!Array.isArray(slots)) return [];

  return slots
    .map((slot) => {
      const dayOfWeek = Number(slot?.dayOfWeek);
      const timeString = typeof slot?.time === "string" ? slot.time.trim() : "";
      const timeMatch = timeString.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      const normalizedTime = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : undefined;
      const durationVal = slot?.duration;
      const parsedDuration = typeof durationVal === "number" && !Number.isNaN(durationVal)
        ? durationVal
        : (durationVal !== undefined && durationVal !== null && durationVal !== ""
            ? Number.parseInt(durationVal, 10)
            : undefined);

      return {
        dayOfWeek,
        time: normalizedTime,
        duration: Number.isFinite(parsedDuration) ? parsedDuration : undefined,
        timezone: slot?.timezone || tz,
        raw: slot
      };
    })
    .filter((slot) =>
      Number.isInteger(slot.dayOfWeek) && slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6 &&
      typeof slot.time === "string"
    );
}

function enrichClassObj(obj, now = new Date()) {
  const c = { ...obj };
  const scheduledDate = c.scheduledDate ? new Date(c.scheduledDate) : null;
  const endTime = scheduledDate ? new Date(scheduledDate.getTime() + (Number(c.duration || 0) * 60000)) : null;
  c.endTime = endTime;
  c.isOngoing = scheduledDate && endTime && scheduledDate.getTime() <= now.getTime() && endTime.getTime() > now.getTime();
  c.isOld = endTime && endTime.getTime() <= now.getTime();
  return c;
}

async function buildReportSubmissionForPastClass(scheduledDate, durationMinutes) {
  if (!scheduledDate || !Number.isFinite(durationMinutes)) return null;
  const ReportSubmissionService = require('../services/reportSubmissionService');
  const settings = await ReportSubmissionService.getSubmissionSettings();
  const teacherDeadline = ReportSubmissionService.calculateTeacherDeadline(
    scheduledDate,
    durationMinutes,
    settings.teacherWindowHours
  );

  return {
    status: 'open',
    teacherDeadline,
    adminExtension: {
      granted: false,
    },
  };
}

function isUnknownStudentName(name) {
  const s = String(name || '').trim().toLowerCase();
  return !s || s === 'unknown student';
}

async function hydrateUnknownStudentNames(classes = []) {
  const unknown = (classes || []).filter((c) => isUnknownStudentName(c?.student?.studentName));
  if (!unknown.length) return classes;

  const ids = Array.from(
    new Set(
      unknown
        .map((c) => c?.student?.studentId)
        .filter((v) => v && mongoose.Types.ObjectId.isValid(v))
        .map((v) => String(v))
    )
  );
  if (!ids.length) return classes;

  let rows = [];
  try {
    rows = await Student.find({ _id: { $in: ids } })
      .select('firstName lastName')
      .lean();
  } catch (e) {
    return classes;
  }

  const nameById = new Map();
  (rows || []).forEach((s) => {
    const fullName = `${s.firstName || ''} ${s.lastName || ''}`.trim();
    if (fullName) nameById.set(String(s._id), fullName);
  });

  (classes || []).forEach((c) => {
    if (!c?.student) return;
    if (!isUnknownStudentName(c.student.studentName)) return;
    const fullName = nameById.get(String(c.student.studentId));
    if (fullName) c.student.studentName = fullName;
  });

  const stillUnknown = (classes || []).filter((c) => isUnknownStudentName(c?.student?.studentName));
  if (!stillUnknown.length) return classes;

  const guardianIds = Array.from(
    new Set(
      stillUnknown
        .map((c) => c?.student?.guardianId)
        .filter(Boolean)
        .map((v) => String(v))
    )
  );
  if (!guardianIds.length) return classes;

  let guardians = [];
  try {
    guardians = await User.find({ _id: { $in: guardianIds }, role: 'guardian' })
      .select('guardianInfo.students')
      .lean();
  } catch (e) {
    return classes;
  }

  const embeddedNameByKey = new Map();
  (guardians || []).forEach((g) => {
    const gid = String(g._id);
    const students = Array.isArray(g.guardianInfo?.students) ? g.guardianInfo.students : [];
    students.forEach((s) => {
      const fullName = `${s.firstName || ''} ${s.lastName || ''}`.trim();
      if (!fullName) return;
      if (s._id) embeddedNameByKey.set(`${gid}|${String(s._id)}`, fullName);
      if (s.standaloneStudentId) embeddedNameByKey.set(`${gid}|${String(s.standaloneStudentId)}`, fullName);
      if (s.studentInfo?.standaloneStudentId) embeddedNameByKey.set(`${gid}|${String(s.studentInfo.standaloneStudentId)}`, fullName);
    });
  });

  (classes || []).forEach((c) => {
    if (!c?.student) return;
    if (!isUnknownStudentName(c.student.studentName)) return;
    const gid = c.student.guardianId ? String(c.student.guardianId) : '';
    const sid = c.student.studentId ? String(c.student.studentId) : '';
    if (!gid || !sid) return;
    const fullName = embeddedNameByKey.get(`${gid}|${sid}`);
    if (fullName) c.student.studentName = fullName;
  });

  return classes;
}

async function resolveStudentForClass(studentInput, guardianDoc) {
  if (!studentInput || !guardianDoc) return null;
  const providedStudentName = (studentInput && typeof studentInput.studentName === 'string')
    ? studentInput.studentName.trim()
    : '';

  const embeddedStudent = guardianDoc.guardianInfo?.students?.id?.(studentInput.studentId) || null;

  let standaloneStudent = null;
  if (!embeddedStudent && studentInput.studentId && mongoose.Types.ObjectId.isValid(studentInput.studentId)) {
    try {
      standaloneStudent = await Student.findById(studentInput.studentId).select('firstName lastName').lean();
    } catch (e) {
      // ignore
    }
  }

  let embeddedByStandalone = null;
  if (!embeddedStudent && standaloneStudent && Array.isArray(guardianDoc.guardianInfo?.students)) {
    embeddedByStandalone = guardianDoc.guardianInfo.students.find((s) =>
      String(s.standaloneStudentId || s.studentInfo?.standaloneStudentId || '') === String(standaloneStudent._id)
    ) || null;
  }

  const resolvedStudentId = embeddedStudent?._id
    || embeddedByStandalone?._id
    || studentInput.studentId
    || standaloneStudent?._id
    || null;

  const resolvedStudentName =
    providedStudentName
    || (embeddedStudent ? `${embeddedStudent.firstName} ${embeddedStudent.lastName}`.trim() : '')
    || (embeddedByStandalone ? `${embeddedByStandalone.firstName} ${embeddedByStandalone.lastName}`.trim() : '')
    || (standaloneStudent ? `${standaloneStudent.firstName} ${standaloneStudent.lastName}`.trim() : '')
    || 'Unknown Student';

  return {
    studentId: resolvedStudentId,
    studentName: resolvedStudentName,
  };
}

function normalizePendingReschedule(pending) {
  if (!pending) return null;

  const base = typeof pending.toObject === "function" ? pending.toObject() : { ...pending };
  const status = base?.status;
  const requestedBy = base?.requestedBy;
  const requestedAt = base?.requestedAt;
  const proposedDate = base?.proposedDate;

  if (status !== "pending") {
    return null;
  }

  // Guard against default subdocument initialization (no real request saved)
  if (!requestedBy || !requestedAt || !proposedDate) {
    return null;
  }

  return base;
}

function sanitizeClassForRole(classObj, role) {
  if (!classObj) return classObj;

  const normalizedPending = normalizePendingReschedule(classObj.pendingReschedule);

  if (role === "admin") {
    return {
      ...classObj,
      pendingReschedule: normalizedPending || undefined,
    };
  }

  const clone = { ...classObj };

  if (clone.cancellation && typeof clone.cancellation === "object") {
    const { reason, ...rest } = clone.cancellation;
    clone.cancellation = { ...rest };
    if (Object.keys(clone.cancellation).length === 0) {
      delete clone.cancellation;
    }
  }

  if (normalizedPending) {
    clone.pendingReschedule = sanitizePendingReschedule(normalizedPending, role);
  } else {
    delete clone.pendingReschedule;
  }

  return clone;
}


const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const MAX_CHANGE_RATIO = 0.4;

function timeUntilClassStarts(classDoc, reference = new Date()) {
  if (!classDoc?.scheduledDate) return -Infinity;
  return new Date(classDoc.scheduledDate).getTime() - reference.getTime();
}

function toObjectId(value) {
  if (!value) return null;
  try {
    return new mongoose.Types.ObjectId(value);
  } catch (err) {
    return null;
  }
}

async function buildMonthlyChangeStats(classDoc) {
  if (!classDoc?.scheduledDate || !classDoc?.teacher) {
    return {
      totalClasses: 0,
      guardianCancelled: 0,
      guardianLimit: 0,
      teacherCancelled: 0,
      teacherRescheduled: 0,
      teacherLimit: 0,
    };
  }

  const scheduled = new Date(classDoc.scheduledDate);
  const monthStart = new Date(Date.UTC(scheduled.getUTCFullYear(), scheduled.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(scheduled.getUTCFullYear(), scheduled.getUTCMonth() + 1, 1));

  const teacherId = toObjectId(classDoc.teacher?._id || classDoc.teacher);
  const guardianId = toObjectId(classDoc.student?.guardianId?._id || classDoc.student?.guardianId);
  const studentId = toObjectId(classDoc.student?.studentId?._id || classDoc.student?.studentId);

  const baseMatch = {
    teacher: teacherId,
    status: { $ne: "pattern" },
    scheduledDate: { $gte: monthStart, $lt: monthEnd },
  };

  if (guardianId) {
    baseMatch["student.guardianId"] = guardianId;
  }

  if (studentId) {
    baseMatch["student.studentId"] = studentId;
  }

  const totalClassesPromise = Class.countDocuments(baseMatch);

  const guardianCancelledPromise = guardianId
    ? Class.countDocuments({
        teacher: teacherId,
        "student.guardianId": guardianId,
        status: "cancelled_by_guardian",
        scheduledDate: { $gte: monthStart, $lt: monthEnd },
      })
    : Promise.resolve(0);

  const teacherCancelledPromise = studentId
    ? Class.countDocuments({
        teacher: teacherId,
        "student.studentId": studentId,
        status: "cancelled_by_teacher",
        scheduledDate: { $gte: monthStart, $lt: monthEnd },
      })
    : Promise.resolve(0);

  const teacherRescheduledPromise = studentId
    ? Class.aggregate([
        {
          $match: {
            teacher: teacherId,
            "student.studentId": studentId,
            status: { $ne: "pattern" },
            scheduledDate: { $gte: monthStart, $lt: monthEnd },
          },
        },
        {
          $project: {
            rescheduleHistory: 1,
          },
        },
        { $unwind: "$rescheduleHistory" },
        {
          $match: {
            "rescheduleHistory.rescheduledAt": { $gte: monthStart, $lt: monthEnd },
            "rescheduleHistory.rescheduledBy": toObjectId(teacherId),
          },
        },
        { $count: "count" },
      ]).then((result) => (result?.[0]?.count || 0))
    : Promise.resolve(0);

  const [totalClasses, guardianCancelled, teacherCancelled, teacherRescheduled] = await Promise.all([
    totalClassesPromise,
    guardianCancelledPromise,
    teacherCancelledPromise,
    teacherRescheduledPromise,
  ]);

  const guardianLimit = totalClasses > 0 ? Math.max(1, Math.floor(totalClasses * MAX_CHANGE_RATIO)) : 0;
  const teacherLimit = totalClasses > 0 ? Math.max(1, Math.floor(totalClasses * MAX_CHANGE_RATIO)) : 0;

  return {
    totalClasses,
    guardianCancelled,
    guardianLimit,
    teacherCancelled,
    teacherRescheduled,
    teacherLimit,
  };
}

async function ensureRecurringSlotsWithinAvailability(teacherId, slots = [], fallbackTimezone, fallbackDuration, excludeClassId) {
  if (!Array.isArray(slots) || slots.length === 0) {
    return { ok: true };
  }

  const now = new Date();
  const baseUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  for (const slot of slots) {
    const dayOfWeek = Number(slot?.dayOfWeek);
    const timeString = typeof slot?.time === "string" ? slot.time.trim() : "";

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !/^\d{2}:\d{2}$/.test(timeString)) {
      return {
        ok: false,
        error: "Invalid recurrence slot definition",
        slot,
      };
    }

    const [hour, minute] = timeString.split(":").map((value) => Number.parseInt(value, 10));
    const parsedDuration = Number(slot?.duration);
    const durationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0
      ? parsedDuration
      : Number(fallbackDuration || 60);

    const slotTimezone = slot?.timezone || fallbackTimezone || DEFAULT_TIMEZONE;
    const dayOffset = (dayOfWeek - baseUtc.getUTCDay() + 7) % 7;
    const targetDate = new Date(baseUtc.getTime() + dayOffset * 24 * 60 * 60 * 1000);

    const startUtc = tzUtils.buildUtcFromParts
      ? tzUtils.buildUtcFromParts(
          {
            year: targetDate.getUTCFullYear(),
            month: targetDate.getUTCMonth(),
            day: targetDate.getUTCDate(),
            hour,
            minute,
          },
          slotTimezone
        )
      : new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), hour, minute));

    const endUtc = new Date(startUtc.getTime() + durationMinutes * 60000);

    const availability = await availabilityService.validateTeacherAvailability(
      teacherId,
      startUtc,
      endUtc,
      excludeClassId
    );

    if (!availability.isAvailable) {
      return {
        ok: false,
        slot: {
          dayOfWeek,
          time: timeString,
          timezone: slotTimezone,
          durationMinutes,
        },
        availability,
      };
    }
  }

  return { ok: true };
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function resolveDocumentId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === "object" && value._id) return String(value._id);
  return value.toString ? value.toString() : null;
}

function ensureClassAccess(req, classDoc) {
  if (!classDoc) return false;
  if (req.user.role === "admin") return true;

  const userId = resolveDocumentId(req.user._id);

  if (req.user.role === "teacher") {
    const teacherId = resolveDocumentId(classDoc.teacher);
    return teacherId && teacherId === userId;
  }

  if (req.user.role === "guardian") {
    const guardianId = resolveDocumentId(classDoc.student?.guardianId);
    return guardianId && guardianId === userId;
  }

  if (req.user.role === "student") {
    const studentId = resolveDocumentId(classDoc.student?.studentId);
    return studentId && studentId === userId;
  }

  return false;
}

function sanitizePendingReschedule(pending, role) {
  if (!pending) return null;
  const base = typeof pending.toObject === "function" ? pending.toObject() : { ...pending };
  if (role === "admin") return base;
  const clone = { ...base };
  if (clone.requestedBy && clone.requestedByRole !== role) {
    delete clone.requestedBy;
  }
  if (clone.decisionBy && clone.decisionByRole !== role) {
    delete clone.decisionBy;
  }
  return clone;
}

async function buildChangePolicy(classDoc, user) {
  const defaultResponse = {
    canRequestReschedule: false,
    canCancel: false,
    reasons: {},
    stats: {
      totalClasses: 0,
      guardianCancelled: 0,
      guardianLimit: 0,
      teacherCancelled: 0,
      teacherRescheduled: 0,
      teacherLimit: 0,
    },
    limitStatus: {
      guardian: { used: 0, limit: 0, exceeded: false },
      teacherCancel: { used: 0, limit: 0, exceeded: false },
      teacherReschedule: { used: 0, limit: 0, exceeded: false },
    },
    pendingReschedule: null,
    withinThreeHours: false,
    classStatus: classDoc?.status,
  };

  if (!classDoc || !user) {
    defaultResponse.reasons.general = "Class or user not provided";
    return defaultResponse;
  }

  const role = user.role;
  const now = new Date();
  const stats = await buildMonthlyChangeStats(classDoc);
  const timeDiff = timeUntilClassStarts(classDoc, now);
  const withinThreeHours = timeDiff < THREE_HOURS_MS;
  const notUpcoming = timeDiff <= 0;
  const pending = normalizePendingReschedule(classDoc.pendingReschedule);

  const classInactiveStatuses = [
    "cancelled_by_teacher",
    "cancelled_by_student",
    "cancelled_by_guardian",
    "cancelled_by_admin",
    "completed",
    "attended",
    "missed_by_student",
    "no_show_both",
    "absent",
  ];

  const response = {
    ...defaultResponse,
    stats,
    withinThreeHours: role === 'guardian' ? withinThreeHours : false,
    pendingReschedule: sanitizePendingReschedule(pending, role),
  };

  if (classDoc.status === "pattern") {
    response.reasons.reschedule = "Recurring pattern cannot be rescheduled directly.";
    response.reasons.cancel = "Recurring pattern cannot be cancelled.";
    return response;
  }

  if (classInactiveStatuses.includes(classDoc.status)) {
    response.reasons.reschedule = "Class is no longer active.";
    response.reasons.cancel = "Class is no longer active.";
    return response;
  }

  if (notUpcoming) {
    response.reasons.cancel = "Class start time has passed.";
    if (role === "guardian") {
      response.reasons.reschedule = "Class start time has passed.";
      return response;
    }
  }

  if (pending) {
    response.reasons.reschedule = "A reschedule request is already pending.";
  }

  const limitBreached = {
    guardianCancel: stats.guardianLimit > 0 && stats.guardianCancelled >= stats.guardianLimit,
    teacherCancel: stats.teacherLimit > 0 && stats.teacherCancelled >= stats.teacherLimit,
    teacherReschedule: stats.teacherLimit > 0 && stats.teacherRescheduled >= stats.teacherLimit,
  };

  response.limitStatus = {
    guardian: {
      used: stats.guardianCancelled,
      limit: stats.guardianLimit,
      exceeded: limitBreached.guardianCancel,
    },
    teacherCancel: {
      used: stats.teacherCancelled,
      limit: stats.teacherLimit,
      exceeded: limitBreached.teacherCancel,
    },
    teacherReschedule: {
      used: stats.teacherRescheduled,
      limit: stats.teacherLimit,
      exceeded: limitBreached.teacherReschedule,
    },
  };

  if (role === "guardian") {
    if (!pending && !withinThreeHours) {
      response.canRequestReschedule = true;
    } else if (withinThreeHours) {
      response.reasons.reschedule = "Guardians must request reschedule at least 3 hours before class.";
    }

    if (withinThreeHours) {
      response.reasons.cancel = "Guardians must cancel at least 3 hours before class.";
    } else if (limitBreached.guardianCancel) {
      response.reasons.cancel = "Monthly cancellation limit reached.";
    } else {
      response.canCancel = true;
    }
  } else if (role === "teacher") {
    if (!pending) {
      if (limitBreached.teacherReschedule) {
        response.reasons.reschedule = "Monthly reschedule limit reached.";
      } else {
        response.canRequestReschedule = true;
      }
    }

    if (limitBreached.teacherCancel) {
      response.reasons.cancel = "Monthly cancellation limit reached.";
    } else {
      response.canCancel = true;
    }
  } else if (role === "admin") {
    response.canRequestReschedule = !pending;
    response.canCancel = true;
  }

  if (!response.reasons.reschedule && pending) {
    response.reasons.reschedule = "A reschedule request is awaiting decision.";
  }

  return response;
}

/* -------------------------
   GET /api/classes
   - query params:
     filter = upcoming | previous
     page, limit, teacher, guardian, student, status, subject, date, dateFrom, dateTo
   Returns: { classes: [...], now, pagination }
   ------------------------- */
// GET /api/classes
// routes/classes.js
// Classes Routes - GET /api/classes
router.get("/", authenticateToken, async (req, res) => {
  try {
    const perfEnabled = process.env.DEBUG_PERF_CLASSES === '1';
    const t0 = perfEnabled ? Date.now() : 0;
    const mark = (label) => {
      if (!perfEnabled) return;
      const ms = Date.now() - t0;
      console.log(`⏱️  [classes:list] +${ms}ms ${label}`);
    };

    const {
      page = 1,
      limit = 20,
      filter,
      teacher,
      guardian,
      student,
      studentIds,
      status,
      subject,
      search,
      searchAll,
      date,
      dateFrom,
      dateTo,
    } = req.query;

    const now = new Date();
    const filters = {};

    const pushAnd = (clause) => {
      if (!clause || typeof clause !== 'object') return;
      filters.$and = [...(filters.$and || []), clause];
    };

    // If a teacher user supplies a teacher query param for someone else, reject explicitly
    if (req.user && req.user.role === 'teacher' && req.query.teacher && String(req.query.teacher) !== String(req.user._id)) {
      return res.status(403).json({ message: "You cannot query classes for other teachers", error: "FORBIDDEN_QUERY" });
    }

    if (teacher && teacher !== "all") filters.teacher = teacher;
    if (guardian && guardian !== "all") filters["student.guardianId"] = guardian;
    if (student && student !== "all") filters["student.studentId"] = student;

    // Allow filtering by multiple student ids (comma-separated). Useful for fast per-page lookups.
    if (studentIds && typeof studentIds === 'string') {
      const rawParts = studentIds.split(',').map((v) => v.trim()).filter(Boolean);
      const validIds = rawParts.filter((v) => mongoose.Types.ObjectId.isValid(v)).map((v) => new mongoose.Types.ObjectId(v));
      if (validIds.length) {
        filters['student.studentId'] = { $in: validIds };
      }
    }
    if (status && status !== "all") filters.status = status;
    if (subject) filters.subject = new RegExp(subject, "i");

    if (date) {
      const target = new Date(date);
      filters.scheduledDate = {
        $gte: new Date(target.setHours(0, 0, 0, 0)),
        $lt: new Date(target.setHours(23, 59, 59, 999)),
      };
    } else if (dateFrom || dateTo) {
      filters.scheduledDate = {};
      if (dateFrom) filters.scheduledDate.$gte = new Date(dateFrom);
      if (dateTo) filters.scheduledDate.$lte = new Date(dateTo);
    }

    // Text search (server-side) so global search works across pagination.
    // Search matches class fields + teacher/guardian names.
    const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const normalizedSearch = typeof search === "string" ? search.trim() : "";
    if (normalizedSearch) {
      mark('search:start');
      const regex = new RegExp(escapeRegExp(normalizedSearch), "i");
      const searchTokens = normalizedSearch.split(/\s+/).map((token) => token.trim()).filter(Boolean);
      const buildUserTokenClauses = (tokens = []) => (
        tokens.map((token) => ({
          $or: [
            { firstName: new RegExp(escapeRegExp(token), "i") },
            { lastName: new RegExp(escapeRegExp(token), "i") },
            { email: new RegExp(escapeRegExp(token), "i") },
            { phone: new RegExp(escapeRegExp(token), "i") },
          ],
        }))
      );

      const [teacherMatches, guardianMatches] = await Promise.all([
        User.find({
          role: "teacher",
          $and: buildUserTokenClauses(searchTokens),
        })
          .select("_id")
          .lean(),
        User.find({
          role: "guardian",
          $and: buildUserTokenClauses(searchTokens),
        })
          .select("_id")
          .lean(),
      ]);

      mark(`search:resolved teacherIds=${(teacherMatches || []).length} guardianIds=${(guardianMatches || []).length}`);

      const teacherIds = (teacherMatches || []).map((u) => u._id);
      const guardianIds = (guardianMatches || []).map((u) => u._id);

      const searchOr = [
        { title: regex },
        { subject: regex },
        { description: regex },
        { classCode: regex },
        { meetingLink: regex },
        { "student.studentName": regex },
        { "student.guardianName": regex },
      ];

      if (teacherIds.length) {
        searchOr.push({ teacher: { $in: teacherIds } });
      }

      if (guardianIds.length) {
        searchOr.push({ "student.guardianId": { $in: guardianIds } });
      }

      if (searchTokens.length > 1) {
        const tokenClauses = searchTokens.map((token) => {
          const tokenRegex = new RegExp(escapeRegExp(token), "i");
          return {
            $or: [
              { title: tokenRegex },
              { subject: tokenRegex },
              { description: tokenRegex },
              { classCode: tokenRegex },
              { meetingLink: tokenRegex },
              { "student.studentName": tokenRegex },
              { "student.guardianName": tokenRegex },
            ],
          };
        });
        searchOr.push({ $and: tokenClauses });
      }

      // If other filters used $or (e.g., upcoming filter), combine safely.
      if (filters.$or) {
        filters.$and = [...(filters.$and || []), { $or: filters.$or }];
        delete filters.$or;
      }

      filters.$and = [...(filters.$and || []), { $or: searchOr }];
    }

    mark('filters:built');

    const activeSystemVacation = await systemVacationService.getCurrentVacation();
    if (activeSystemVacation?.startDate && activeSystemVacation?.endDate) {
      pushAnd({
        $or: [
          { scheduledDate: { $lt: activeSystemVacation.startDate } },
          { scheduledDate: { $gt: activeSystemVacation.endDate } },
        ],
      });
    }

    // upcoming / previous filtering
    // Prefer `endsAt` (indexed), but keep legacy docs (missing endsAt) visible via scheduledDate fallback.
    if (filter === "upcoming") {
      pushAnd({
        $or: [
          { endsAt: { $gte: now } },
          {
            $and: [
              { $or: [{ endsAt: { $exists: false } }, { endsAt: null }] },
              { scheduledDate: { $gte: now } },
            ],
          },
        ],
      });
    } else if (filter === "previous") {
      pushAnd({
        $or: [
          { endsAt: { $lt: now } },
          {
            $and: [
              { $or: [{ endsAt: { $exists: false } }, { endsAt: null }] },
              { scheduledDate: { $lt: now } },
            ],
          },
        ],
      });
    }

    // Filter out classes that are hidden due to system vacation or individual teacher vacation
    if (!req.user || req.user.role !== 'admin') {
      // Prefer an index-friendly filter while still including legacy docs without `hidden`.
      filters.hidden = { $in: [false, null] };
    }
    if (req.user && req.user.role === 'teacher') {
      // always restrict to the logged-in teacher
      filters.teacher = String(req.user._id);
      
      // Check if teacher is on vacation and filter classes accordingly
      const teacher = await User.findById(req.user._id);
      if (teacher && teacher.vacationStartDate && teacher.vacationEndDate) {
        const vacationStart = new Date(teacher.vacationStartDate);
        const vacationEnd = new Date(teacher.vacationEndDate);
        const firstDayAfterVacation = new Date(vacationEnd.getTime() + 24 * 60 * 60 * 1000);
        
        // If currently on vacation, only show classes after vacation (first day)
        if (now >= vacationStart && now <= vacationEnd) {
          filters.$and = [
            ...(filters.$and || []),
            {
              $or: [
                { scheduledDate: { $lt: vacationStart } }, // Classes before vacation
                { scheduledDate: { $gte: firstDayAfterVacation } } // Classes from first day after vacation
              ]
            }
          ];
        }
      }
    }

    if (req.user && req.user.role === 'guardian') {
      // guardians only see classes where they are the guardian of the student
      filters['student.guardianId'] = String(req.user._id);
    }

    if (req.user && req.user.role === 'student') {
      filters['student.studentId'] = String(req.user._id);
    }

    const pageNumRaw = Math.max(1, Number.parseInt(page, 10) || 1);
    const limitNumRaw = Number.parseInt(limit, 10);
    const maxLimit = normalizedSearch ? 500 : 100;
    const searchAllEnabled = normalizedSearch && toBool(searchAll);
    const limitNum = searchAllEnabled
      ? maxLimit
      : Math.min(maxLimit, Math.max(1, Number.isFinite(limitNumRaw) ? limitNumRaw : 20));
    const pageNum = searchAllEnabled ? 1 : pageNumRaw;
    const skip = searchAllEnabled ? 0 : (pageNum - 1) * limitNum;

    const sortOrder = filter === "upcoming" ? 1 : -1;
    const sortObj = { scheduledDate: sortOrder };

    // Always exclude recurring pattern docs. Use a status allowlist to keep queries index-friendly.
    const STATUS_ALLOW_LIST = [
      "scheduled",
      "in_progress",
      "completed",
      "attended",
      "missed_by_student",
      "cancelled_by_teacher",
      "cancelled_by_student",
      "cancelled_by_guardian",
      "cancelled_by_admin",
      "no_show_both",
      "absent",
      "cancelled",
    ];

    if (filters.status && filters.status !== "all") {
      const normalizedStatus = String(filters.status || "").toLowerCase();
      if (normalizedStatus === 'completed') {
        filters.status = { $in: ['completed', 'attended'] };
      } else if (normalizedStatus === 'cancelled' || normalizedStatus === 'canceled') {
        filters.status = { $in: ['cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian', 'cancelled_by_admin', 'cancelled', 'no_show_both'] };
      } else {
        filters.status = filters.status;
      }
    } else {
      filters.status = { $in: STATUS_ALLOW_LIST };
    }

    const [rawClasses, totalClasses] = await Promise.all([
      Class.find(filters)
        .select([
          'title',
          'description',
          'subject',
          'status',
          'scheduledDate',
          'duration',
          'endsAt',
          'timezone',
          'meetingLink',
          'materials._id',
          'materials.kind',
          'materials.name',
          'materials.libraryItem',
          'materials.uploadedByRole',
          'parentRecurringClass',
          'student.guardianId',
          'student.studentId',
          'student.studentName',
          'pendingReschedule',
          'cancellation',
          'classReport.submittedAt',
          'classReport.classScore',
          'classReport.attendance',
          'classReport.subject',
          'classReport.subjects',
          'classReport.lessonTopic',
          'classReport.customLessonTopic',
          'classReport.teacherNotes',
          'classReport.supervisorNotes',
          'classReport.newAssignment',
          'classReport.surah',
          'classReport.verseEnd',
          'classReport.recitedQuran',
          'reportSubmission.status',
          'createdAt',
          'updatedAt'
        ].join(' '))
        .populate({ path: "teacher", select: "firstName lastName email phone profilePicture", options: { lean: true } })
        .populate({ path: "student.guardianId", select: "firstName lastName email phone", options: { lean: true } })
        .sort(sortObj)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Class.countDocuments(filters),
    ]);

    mark(`db:done rows=${(rawClasses || []).length} total=${totalClasses}`);

    await hydrateUnknownStudentNames(rawClasses);

    mark('hydrateUnknownStudentNames:done');

    // Avoid N+1 queries for recurring patterns on list endpoints.
    // The details are available from GET /api/classes/:id when needed.
    const classes = (rawClasses || []).map((obj) => {
      const isRecurring = Boolean(obj?.parentRecurringClass);
      return {
        ...obj,
        isRecurring,
      };
    });

    const totalPages = Math.ceil(totalClasses / limitNum);

    // Get user's timezone for conversion
    const userTimezone = req.user?.timezone || DEFAULT_TIMEZONE;
    
    // Process classes with timezone conversion
    const processedClasses = processArrayWithTimezone(classes, userTimezone, ['scheduledDate', 'createdAt', 'updatedAt']);
    const sanitizedClasses = processedClasses.map((cls) => sanitizeClassForRole(cls, req.user?.role));

    mark('postprocess:done');

    res.json({
      classes: sanitizedClasses,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalClasses,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      userTimezone,
      systemTimezone: DEFAULT_TIMEZONE
    });
  } catch (error) {
    console.error("Get classes error:", error);
    res.status(500).json({ message: "Failed to fetch classes", error: error.message });
  }
});

/* -------------------------
   GET /api/classes/series
   - Admin-only scanner endpoint
   - Returns recurring series (pattern docs) even if they have zero instances.
   Query:
     page, limit, teacher, guardian, student, search
   Returns: { series: [...], pagination }
   ------------------------- */
router.get("/series", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      teacher,
      guardian,
      student,
      search,
    } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const pageLimit = Math.min(500, Math.max(1, Number(limit) || 50));
    const now = new Date();

    const filters = {
      status: 'pattern',
    };

    if (teacher && teacher !== 'all') filters.teacher = teacher;
    if (guardian && guardian !== 'all') filters['student.guardianId'] = guardian;
    if (student && student !== 'all') filters['student.studentId'] = student;

    const escapeRegExp = (value = "") => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const normalizedSearch = typeof search === 'string' ? search.trim() : '';
    if (normalizedSearch) {
      const regex = new RegExp(escapeRegExp(normalizedSearch), 'i');
      const nameParts = normalizedSearch.split(/\s+/).filter(Boolean).slice(0, 4);
      const namePartRegexes = nameParts.map((p) => new RegExp(escapeRegExp(p), 'i'));

      const buildUserNameOr = () => {
        const baseOr = [{ firstName: regex }, { lastName: regex }, { email: regex }, { phone: regex }];
        if (namePartRegexes.length >= 2) {
          baseOr.push({
            $and: namePartRegexes.map((r) => ({ $or: [{ firstName: r }, { lastName: r }] }))
          });
        }
        return baseOr;
      };

      const [teacherMatches, guardianMatches] = await Promise.all([
        User.find({
          role: 'teacher',
          $or: buildUserNameOr(),
        }).select('_id').lean(),
        User.find({
          role: 'guardian',
          $or: buildUserNameOr(),
        }).select('_id').lean(),
      ]);

      const teacherIds = (teacherMatches || []).map((u) => u._id);
      const guardianIds = (guardianMatches || []).map((u) => u._id);

      const searchOr = [
        { title: regex },
        { subject: regex },
        { description: regex },
        { classCode: regex },
        { meetingLink: regex },
        { 'student.studentName': regex },
      ];

      if (teacherIds.length) searchOr.push({ teacher: { $in: teacherIds } });
      if (guardianIds.length) searchOr.push({ 'student.guardianId': { $in: guardianIds } });

      filters.$and = [...(filters.$and || []), { $or: searchOr }];
    }

    const total = await Class.countDocuments(filters);

    const patterns = await Class.find(filters)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip((pageNum - 1) * pageLimit)
      .limit(pageLimit)
      .populate('teacher', 'firstName lastName email')
      .populate('student.guardianId', 'firstName lastName email')
      .lean();

    await hydrateUnknownStudentNames(patterns);

    const patternIds = patterns.map((p) => p._id);
    const cancelledStatuses = ['cancelled', 'cancelled_by_admin', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian'];

    const childCounts = patternIds.length
      ? await Class.aggregate([
          {
            $match: {
              parentRecurringClass: { $in: patternIds },
              status: { $ne: 'pattern' },
            },
          },
          {
            $group: {
              _id: '$parentRecurringClass',
              totalInstances: { $sum: 1 },
              futureActiveInstances: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$scheduledDate', now] },
                        { $not: [{ $in: ['$status', cancelledStatuses] }] },
                        { $ne: ['$hidden', true] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ])
      : [];

    const countMap = new Map(childCounts.map((row) => [String(row._id), row]));
    const series = patterns.map((p) => {
      const c = countMap.get(String(p._id));
      return {
        ...p,
        instanceCounts: {
          total: c?.totalInstances || 0,
          futureActive: c?.futureActiveInstances || 0,
        },
      };
    });

    return res.json({
      series,
      pagination: {
        page: pageNum,
        limit: pageLimit,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageLimit)),
      },
    });
  } catch (err) {
    console.error('GET /api/classes/series error:', err);
    return res.status(500).json({ message: 'Failed to load class series' });
  }
});

/* -------------------------
   POST /api/classes/series/:id/recreate
   - Admin-only
   - Recreate missing instances for a recurring pattern
   Returns: { patternId, createdCount }
   ------------------------- */
router.post("/series/:id/recreate", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const pattern = await Class.findById(req.params.id);
    if (!pattern) return res.status(404).json({ message: 'Series not found' });
    if (pattern.status !== 'pattern') return res.status(400).json({ message: 'Target class is not a series pattern' });

    const perDayMap = buildPerDayMap(pattern.recurrenceDetails || []);
    const created = await generateRecurringClasses(
      pattern,
      pattern.recurrence?.generationPeriodMonths || 2,
      perDayMap,
      { throwOnError: true }
    );

    return res.json({
      patternId: pattern._id,
      createdCount: Array.isArray(created) ? created.length : 0,
    });
  } catch (err) {
    console.error('POST /api/classes/series/:id/recreate error:', err);
    return res.status(500).json({ message: 'Failed to recreate series instances' });
  }
});

/* -------------------------
   Deduplication helper
   Groups instances by calendar date (in the pattern's timezone) and
   compares the count against the pattern's recurrenceDetails.  For each
   date that has MORE instances than expected slots, the excess instances
   are removed — keeping those with submitted reports or final statuses,
   and preferring times closest to the expected slot times.
   Also handles DST-shifted duplicates (same slot → different UTC).
   ------------------------- */
async function deduplicateSeriesInstances() {
  const cancelledStatuses = ['cancelled', 'cancelled_by_admin', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian'];
  const finalStatuses = ['completed', 'attended', 'in_progress', 'missed_by_student', 'no_show_both'];
  const MATCH_TOLERANCE_MS = 3 * 60 * 60 * 1000; // 3 hours — generous for DST + timezone edge cases

  // Load all pattern classes with their recurrenceDetails
  const patterns = await Class.find({ status: 'pattern', isRecurring: true })
    .select('_id recurrenceDetails recurrence timezone scheduledDate duration')
    .lean();

  if (patterns.length === 0) return { totalRemoved: 0, patternsProcessed: 0 };

  // Index patterns by _id for quick lookup
  const patternMap = new Map();
  for (const p of patterns) {
    patternMap.set(String(p._id), p);
  }

  // Get all parentRecurringClass ids that have instances
  const patternIds = await Class.distinct('parentRecurringClass', {
    parentRecurringClass: { $exists: true, $ne: null },
    status: { $nin: ['pattern', ...cancelledStatuses] },
  });

  const idsToRemove = [];

  for (const patternId of patternIds) {
    const pattern = patternMap.get(String(patternId));

    // Build expected-slots-per-dayOfWeek from recurrenceDetails
    const slotsPerDay = new Map(); // dayOfWeek → [{ time, timezone }]
    if (pattern && Array.isArray(pattern.recurrenceDetails) && pattern.recurrenceDetails.length > 0) {
      for (const slot of pattern.recurrenceDetails) {
        const day = Number(slot.dayOfWeek);
        if (!Number.isInteger(day) || day < 0 || day > 6) continue;
        const existing = slotsPerDay.get(day) || [];
        existing.push({
          time: slot.time || '',
          timezone: slot.timezone || pattern?.timezone || 'UTC',
        });
        slotsPerDay.set(day, existing);
      }
    }

    const instances = await Class.find({
      parentRecurringClass: patternId,
      status: { $nin: ['pattern', ...cancelledStatuses] },
    })
      .select('_id scheduledDate duration status classReport.submittedAt timezone')
      .sort({ scheduledDate: 1 })
      .lean();

    if (instances.length < 2 && slotsPerDay.size === 0) continue;

    // Group instances by calendar date in pattern timezone
    const tz = pattern?.timezone || 'UTC';
    const byDate = new Map();
    for (const inst of instances) {
      let dateKey;
      try {
        dateKey = new Date(inst.scheduledDate).toLocaleDateString('en-CA', { timeZone: tz });
      } catch {
        dateKey = new Date(inst.scheduledDate).toISOString().slice(0, 10);
      }
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey).push(inst);
    }

    for (const [dateKey, dateInstances] of byDate) {
      // Determine day-of-week for this calendar date
      const [yr, mo, dy] = dateKey.split('-').map(Number);
      const dow = new Date(yr, mo - 1, dy).getDay();

      const daySlots = slotsPerDay.get(dow);
      // If the pattern has recurrenceDetails and this day-of-week is NOT in them,
      // expectedCount is 0 — ALL instances on this day are erroneous (e.g. Friday
      // when only Sat/Sun/Thu are scheduled). If the pattern has no recurrenceDetails
      // at all, we fall back to 1 to avoid accidentally deleting everything.
      const expectedCount = daySlots ? daySlots.length : (slotsPerDay.size > 0 ? 0 : 1);

      if (dateInstances.length <= expectedCount) continue;

      // Compute expected UTC times for each slot on this date
      const expectedUtcMs = [];
      if (daySlots) {
        for (const s of daySlots) {
          const timeMatch = (s.time || '').match(/^(\d{2}):(\d{2})$/);
          if (!timeMatch) continue;
          const hh = parseInt(timeMatch[1], 10);
          const mm = parseInt(timeMatch[2], 10);
          try {
            const utc = tzUtils.buildUtcFromParts({ year: yr, month: mo - 1, day: dy, hour: hh, minute: mm }, s.timezone);
            expectedUtcMs.push(utc.getTime());
          } catch { /* skip */ }
        }
      }

      // Match instances to the closest expected time
      const matchedIndices = new Set();
      for (const expMs of expectedUtcMs) {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < dateInstances.length; i++) {
          if (matchedIndices.has(i)) continue;
          const dist = Math.abs(new Date(dateInstances[i].scheduledDate).getTime() - expMs);
          if (dist < bestDist && dist <= MATCH_TOLERANCE_MS) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx >= 0) matchedIndices.add(bestIdx);
      }

      // If no expected times available (no recurrenceDetails), keep the oldest N
      if (expectedUtcMs.length === 0) {
        for (let i = 0; i < Math.min(expectedCount, dateInstances.length); i++) {
          matchedIndices.add(i); // sorted by scheduledDate, keep earliest
        }
      }

      // Unmatched instances are candidates for removal
      for (let i = 0; i < dateInstances.length; i++) {
        if (matchedIndices.has(i)) continue;
        const inst = dateInstances[i];
        // Never remove instances with submitted reports or final statuses
        if (inst.classReport?.submittedAt || finalStatuses.includes(inst.status)) continue;
        idsToRemove.push(inst._id);
      }
    }
  }

  if (idsToRemove.length > 0) {
    await Class.deleteMany({ _id: { $in: idsToRemove } });
  }

  return { totalRemoved: idsToRemove.length, patternsProcessed: patternIds.length };
}

/* -------------------------
   POST /api/classes/series/deduplicate
   - Admin-only
   - Finds and removes duplicate class instances
   Returns: { totalRemoved, groupsProcessed }
   ------------------------- */
router.post("/series/deduplicate", authenticateToken, requireRole(["admin"]), async (_req, res) => {
  try {
    const result = await deduplicateSeriesInstances();
    return res.json(result);
  } catch (err) {
    console.error('POST /api/classes/series/deduplicate error:', err);
    return res.status(500).json({ message: 'Failed to deduplicate series instances' });
  }
});

/* -------------------------
   POST /api/classes/series/recreate-all
   - Admin-only
   - RESETS recurring class instances:
     1. Removes duplicates
     2. Deletes all future unreported instances (and past unreported
        ones too) for each active pattern
     3. Regenerates instances fresh from recurrenceDetails
   - Reported/completed instances are NEVER touched
   - Inactive patterns (no recurrenceDetails) are skipped
   Returns: { processed, totalCreated, skipped, totalRemoved, results[] }
   ------------------------- */
router.post("/series/recreate-all", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const cancelledStatuses = ['cancelled', 'cancelled_by_admin', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian'];
    const finalStatuses = ['completed', 'attended', 'in_progress', 'missed_by_student', 'no_show_both'];

    // Step 1: Deduplicate existing instances
    const dedup = await deduplicateSeriesInstances();

    const patterns = await Class.find({ status: 'pattern', isRecurring: true }).lean();

    const results = [];
    let totalCreated = 0;
    let totalRemoved = dedup.totalRemoved;
    let skipped = 0;

    for (const pattern of patterns) {
      const patternId = String(pattern._id);

      // Skip patterns with no recurrence details (can't regenerate)
      if (!Array.isArray(pattern.recurrenceDetails) || pattern.recurrenceDetails.length === 0) {
        skipped++;
        continue;
      }

      // Skip patterns with expired endDate
      if (pattern.recurrence?.endDate) {
        const endDate = new Date(pattern.recurrence.endDate);
        if (!Number.isNaN(endDate.getTime()) && endDate < new Date()) {
          skipped++;
          continue;
        }
      }

      // Step 2: Delete unreported instances (future + past unreported)
      // Keep: instances with submitted reports or final statuses
      try {
        const deleteResult = await Class.deleteMany({
          parentRecurringClass: pattern._id,
          status: { $nin: ['pattern', ...cancelledStatuses, ...finalStatuses] },
          'classReport.submittedAt': { $exists: false },
        });
        totalRemoved += deleteResult.deletedCount || 0;
      } catch (err) {
        console.error(`recreate-all: failed to clean pattern ${patternId}:`, err.message);
      }

      // Step 3: Regenerate instances from recurrenceDetails
      try {
        const perDayMap = buildPerDayMap(pattern.recurrenceDetails || []);
        const created = await generateRecurringClasses(
          pattern,
          pattern.recurrence?.generationPeriodMonths || 2,
          perDayMap,
          { throwOnError: true }
        );
        const count = Array.isArray(created) ? created.length : 0;
        totalCreated += count;
        if (count > 0) {
          results.push({ patternId, subject: pattern.subject, createdCount: count });
        }
      } catch (err) {
        console.error(`recreate-all: failed for pattern ${patternId}:`, err.message);
        results.push({ patternId, subject: pattern.subject, error: err.message });
      }
    }

    return res.json({
      processed: patterns.length - skipped,
      totalCreated,
      skipped,
      totalRemoved,
      results,
    });
  } catch (err) {
    console.error('POST /api/classes/series/recreate-all error:', err);
    return res.status(500).json({ message: 'Failed to recreate series instances' });
  }
});

/* -------------------------
   POST /api/classes/:id/reschedule-request
   Teacher or guardian submits a reschedule request
   ------------------------- */
router.post(
  "/:id/reschedule-request",
  authenticateToken,
  requireRole(["teacher", "guardian"]),
  [
    body("proposedDate").isISO8601().withMessage("Proposed date must be a valid ISO 8601 string"),
    body("proposedDuration")
      .optional()
      .isInt({ min: 15, max: 180 })
      .withMessage("Duration must be between 15 and 180 minutes"),
    body("note")
      .optional()
      .isLength({ max: 500 })
      .withMessage("Note must be 500 characters or fewer"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }

      const classDoc = await Class.findById(req.params.id)
        .populate("teacher", "firstName lastName email")
        .populate("student.guardianId", "firstName lastName email");

      if (!classDoc) {
        return res.status(404).json({ message: "Class not found" });
      }

      if (!ensureClassAccess(req, classDoc)) {
        return res.status(403).json({ message: "You do not have access to this class" });
      }

      const existingPending = normalizePendingReschedule(classDoc.pendingReschedule);
      if (existingPending) {
        return res.status(409).json({
          message: "A reschedule request is already pending",
          pendingReschedule: sanitizePendingReschedule(existingPending, req.user.role),
        });
      }

      const proposedDate = new Date(req.body.proposedDate);
      if (Number.isNaN(proposedDate.getTime())) {
        return res.status(400).json({ message: "Invalid proposed date" });
      }

      if (proposedDate.getTime() <= Date.now()) {
        return res.status(400).json({ message: "Proposed date must be in the future" });
      }

      const policy = await buildChangePolicy(classDoc, req.user);
      if (!policy.canRequestReschedule) {
        return res.status(403).json({
          message: policy.reasons.reschedule || "You cannot request a reschedule right now",
          policy,
        });
      }

      const minutes = typeof req.body.proposedDuration !== "undefined"
        ? Number(req.body.proposedDuration)
        : Number(classDoc.duration || 60);

      if (!Number.isFinite(minutes) || minutes <= 0) {
        return res.status(400).json({ message: "Duration must be a positive number" });
      }

      const classEnd = new Date(proposedDate.getTime() + minutes * 60000);

      const enforceAvailability = req.user.role === "guardian" || req.user.role === "student";
      if (enforceAvailability) {
        const availabilityCheck = await availabilityService.validateTeacherAvailability(
          classDoc.teacher._id || classDoc.teacher,
          proposedDate,
          classEnd,
          classDoc._id
        );

        if (!availabilityCheck.isAvailable) {
          const alternatives = await availabilityService.getAlternativeTimeSlots(
            classDoc.teacher._id || classDoc.teacher,
            minutes,
            [proposedDate.getUTCDay()],
            7
          );

          return res.status(400).json({
            message: "Teacher not available at requested time",
            availabilityError: {
              reason: availabilityCheck.reason,
              conflictType: availabilityCheck.conflictType,
              conflictDetails: availabilityCheck.conflictDetails,
              alternatives: alternatives.slice(0, 5),
            },
            policy,
          });
        }
      }

      classDoc.pendingReschedule = {
        status: "pending",
        requestedBy: req.user._id,
        requestedByRole: req.user.role,
        requestedAt: new Date(),
        proposedDate,
        proposedDuration: minutes,
        proposedTimezone: req.body.proposedTimezone || classDoc.timezone,
        note: req.body.note,
        originalDate: classDoc.scheduledDate,
        originalDuration: classDoc.duration,
      };
      classDoc.lastModifiedBy = req.user._id;
      classDoc.lastModifiedAt = new Date();
      classDoc.markModified("pendingReschedule");

      await classDoc.save();

      let notificationService;
      try {
        notificationService = require("../services/notificationService");
        const User = require("../models/User");
        const { formatTimeInTimezone, DEFAULT_TIMEZONE } = require("../utils/timezoneUtils");
        const requestorName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email;

        const rescheduleRequestKey = `${classDoc._id}:${classDoc.pendingReschedule.requestedAt.toISOString()}`;

        const teacherId = String(classDoc.teacher?._id || classDoc.teacher || "");
        const guardianId = String(classDoc.student?.guardianId?._id || classDoc.student?.guardianId || "");
        const studentId = String(classDoc.student?.studentId?._id || classDoc.student?.studentId || "");
        const studentName = classDoc.student?.studentName || "";
        const teacherName = classDoc.teacher
          ? `${classDoc.teacher.firstName || ""} ${classDoc.teacher.lastName || ""}`.trim() || classDoc.teacher.email
          : "Teacher";
        const guardianName = classDoc.student?.guardianId
          ? `${classDoc.student.guardianId.firstName || ""} ${classDoc.student.guardianId.lastName || ""}`.trim() || classDoc.student.guardianId.email
          : "Guardian";

        const adminOriginalLabel = formatTimeInTimezone(classDoc.scheduledDate, DEFAULT_TIMEZONE, "DD MMM YYYY hh:mm A");
        const adminProposedLabel = formatTimeInTimezone(proposedDate, DEFAULT_TIMEZONE, "DD MMM YYYY hh:mm A");
        const message = `${teacherName} and ${studentName || guardianName} have a reschedule request pending. From ${adminOriginalLabel} to ${adminProposedLabel}.`;

        await notificationService.notifyRole({
          role: "admin",
          title: "Pending reschedule approval",
          message,
          type: "warning",
          related: {
            class: classDoc._id,
            relatedTo: "class",
            relatedId: classDoc._id,
            actionRequired: true,
            actionLink: "/dashboard/classes",
            metadata: {
              kind: "class_reschedule_request",
              classId: String(classDoc._id),
              rescheduleRequestKey,
              teacherId,
              guardianId,
              studentId,
              studentName,
              teacherName,
              guardianName,
              requestedById: String(req.user._id),
              proposedDate: proposedDate.toISOString(),
              proposedDuration: minutes,
              requestedByRole: req.user.role,
              requestedByName: requestorName,
              originalDate: classDoc.scheduledDate?.toISOString?.() || classDoc.scheduledDate,
            }
          },
        });

        const counterpart = req.user.role === "teacher"
          ? classDoc.student?.guardianId
          : classDoc.teacher?._id || classDoc.teacher;

        if (counterpart) {
          const counterpartUser = await User.findById(counterpart).select("timezone");
          const recipientTimezone = counterpartUser?.timezone || DEFAULT_TIMEZONE;
          const originalLabel = formatTimeInTimezone(classDoc.scheduledDate, recipientTimezone, "DD MMM YYYY hh:mm A");
          const proposedLabel = formatTimeInTimezone(proposedDate, recipientTimezone, "DD MMM YYYY hh:mm A");
          const decisionLabel = req.user.role === "teacher" ? "accept" : "confirm";

          await notificationService.createNotification({
            userId: counterpart,
            title: "Reschedule request",
            message: `${requestorName} requested to move a class from ${originalLabel} to ${proposedLabel}. Please ${decisionLabel} or decline.`,
            type: "warning",
            relatedTo: "class",
            relatedId: classDoc._id,
            metadata: {
              kind: "class_reschedule_request",
              classId: String(classDoc._id),
              rescheduleRequestKey,
              teacherId,
              guardianId,
              studentId,
              studentName,
              teacherName,
              guardianName,
              requestedById: String(req.user._id),
              proposedDate: proposedDate.toISOString(),
              proposedDuration: minutes,
              requestedByRole: req.user.role,
              requestedByName: requestorName,
              originalDate: classDoc.scheduledDate?.toISOString?.() || classDoc.scheduledDate,
              recipientTimezone,
            },
            actionRequired: true,
            actionLink: "/dashboard/classes",
          });
        }
      } catch (notifyErr) {
        console.warn("Reschedule request notification failed", notifyErr.message);
      }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("class:updated", { class: classDoc });
        }
      } catch (socketErr) {
        console.warn("Socket emit reschedule-request failed", socketErr.message);
      }

      const updatedPolicy = await buildChangePolicy(classDoc, req.user);
      const responseClass = sanitizeClassForRole(classDoc.toObject({ virtuals: true }), req.user.role);

      return res.status(201).json({
        message: "Reschedule request submitted",
        class: responseClass,
        policy: updatedPolicy,
      });
    } catch (err) {
      console.error("POST /classes/:id/reschedule-request error:", err);
      return res.status(500).json({ message: "Failed to submit reschedule request", error: err.message });
    }
  }
);

/* -------------------------
   POST /api/classes/:id/reschedule-request/decision
   Admin OR the counterparty (teacher/guardian) approves or rejects a reschedule request
   ------------------------- */
router.post(
  "/:id/reschedule-request/decision",
  authenticateToken,
  requireRole(["admin", "teacher", "guardian"]),
  [
    body("decision")
      .isIn(["approved", "rejected"])
      .withMessage("Decision must be approved or rejected"),
    body("note").optional().isLength({ max: 500 }).withMessage("Note must be 500 characters or fewer"),
    body("newDate")
      .optional()
      .isISO8601()
      .withMessage("New date must be a valid ISO 8601 string"),
    body("duration")
      .optional()
      .isInt({ min: 15, max: 180 })
      .withMessage("Duration must be between 15 and 180 minutes"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }

      const classDoc = await Class.findById(req.params.id)
        .populate("teacher", "firstName lastName email")
        .populate("student.guardianId", "firstName lastName email");

      if (!classDoc) {
        return res.status(404).json({ message: "Class not found" });
      }

      const pending = classDoc.pendingReschedule;
      if (!pending || pending.status !== "pending") {
        return res.status(400).json({ message: "No pending reschedule request" });
      }

      // For teacher/guardian: only the counterparty may decide (admin can always decide).
      if (req.user.role !== "admin") {
        if (!ensureClassAccess(req, classDoc)) {
          return res.status(403).json({ message: "You do not have access to this class" });
        }

        const requestedByRole = pending.requestedByRole;
        const isCounterparty =
          (req.user.role === "teacher" && requestedByRole === "guardian") ||
          (req.user.role === "guardian" && requestedByRole === "teacher");

        if (!isCounterparty) {
          return res.status(403).json({ message: "Only the other party can respond to this reschedule request" });
        }

        // Only admins may override the proposed date/duration.
        if (typeof req.body.newDate !== "undefined" || typeof req.body.duration !== "undefined") {
          return res.status(403).json({ message: "Only admins can modify the proposed time or duration" });
        }
      }

      const requestSnapshot = typeof pending.toObject === "function" ? pending.toObject() : { ...pending };
      const decisionNote = req.body.note;

      if (req.body.decision === "rejected") {
        classDoc.pendingReschedule.status = "rejected";
        classDoc.pendingReschedule.decisionAt = new Date();
        classDoc.pendingReschedule.decisionBy = req.user._id;
        classDoc.pendingReschedule.decisionByRole = req.user.role;
        classDoc.pendingReschedule.decisionNote = decisionNote;
        classDoc.markModified("pendingReschedule");
        classDoc.lastModifiedBy = req.user._id;
        classDoc.lastModifiedAt = new Date();
        await classDoc.save();

        try {
          const notificationService = require("../services/notificationService");
          const User = require("../models/User");
          const { formatTimeInTimezone, DEFAULT_TIMEZONE } = require("../utils/timezoneUtils");

          const requestor = requestSnapshot?.requestedBy ? await User.findById(requestSnapshot.requestedBy).select("timezone") : null;
          const requestorTz = requestor?.timezone || DEFAULT_TIMEZONE;
          const proposedLabel = formatTimeInTimezone(requestSnapshot?.proposedDate, requestorTz, "DD MMM YYYY hh:mm A");
          const deciderLabel = (req.user.firstName || req.user.lastName)
            ? `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim()
            : (req.user.email || req.user.role);

          if (requestSnapshot?.requestedBy) {
            await notificationService.createNotification({
              userId: requestSnapshot.requestedBy,
              title: "Reschedule declined",
              message: decisionNote
                ? `${deciderLabel} declined your reschedule request for ${proposedLabel}. Note: ${decisionNote}`
                : `${deciderLabel} declined your reschedule request for ${proposedLabel}.`,
              type: "class",
              relatedTo: "class",
              relatedId: classDoc._id,
            });
          }
        } catch (notifyErr) {
          console.warn("Reschedule decision notification failed", notifyErr.message);
        }

        const responseClass = sanitizeClassForRole(classDoc.toObject({ virtuals: true }), req.user.role);
        const policy = await buildChangePolicy(classDoc, req.user);
        return res.json({ message: "Reschedule request rejected", class: responseClass, policy });
      }

      const rescheduleDate = req.body.newDate ? new Date(req.body.newDate) : new Date(requestSnapshot.proposedDate);
      if (Number.isNaN(rescheduleDate.getTime())) {
        return res.status(400).json({ message: "Invalid reschedule date" });
      }

      if (rescheduleDate.getTime() <= Date.now() && req.user.role !== "admin") {
        return res.status(400).json({ message: "Reschedule date must be in the future" });
      }

      const minutes = typeof req.body.duration !== "undefined"
        ? Number(req.body.duration)
        : Number(requestSnapshot.proposedDuration || classDoc.duration || 60);

      if (!Number.isFinite(minutes) || minutes <= 0) {
        return res.status(400).json({ message: "Duration must be a positive number" });
      }

      const reason = decisionNote
        ? `Reschedule approved. ${decisionNote}`
        : "Reschedule approved.";

      try {
        // Adjust class duration/timezone if provided
        classDoc.duration = minutes;
        if (requestSnapshot.proposedTimezone) {
          classDoc.timezone = requestSnapshot.proposedTimezone;
        }
        classDoc.pendingReschedule.status = "approved";
        classDoc.pendingReschedule.decisionAt = new Date();
        classDoc.pendingReschedule.decisionBy = req.user._id;
        classDoc.pendingReschedule.decisionByRole = req.user.role;
        classDoc.pendingReschedule.decisionNote = decisionNote;
        classDoc.markModified("pendingReschedule");

        const saved = await classDoc.reschedule(rescheduleDate, reason, req.user._id);

        const populated = await Class.findById(saved._id)
          .populate("teacher", "firstName lastName email phone profilePicture")
          .populate("student.guardianId", "firstName lastName email phone");

        try {
          const notificationService = require("../services/notificationService");
          const User = require("../models/User");
          const { formatTimeInTimezone, DEFAULT_TIMEZONE } = require("../utils/timezoneUtils");
          notificationService.notifyClassEvent({
            classObj: populated,
            eventType: "rescheduled",
            actor: req.user,
            extraMsg: decisionNote ? `Note: ${decisionNote}` : "",
            oldDate: requestSnapshot.originalDate,
          }).catch(console.error);

          if (requestSnapshot?.requestedBy) {
            const requestor = await User.findById(requestSnapshot.requestedBy).select("timezone");
            const requestorTz = requestor?.timezone || DEFAULT_TIMEZONE;
            const rescheduledLabel = formatTimeInTimezone(rescheduleDate, requestorTz, "DD MMM YYYY hh:mm A");
            const deciderLabel = (req.user.firstName || req.user.lastName)
              ? `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim()
              : (req.user.email || req.user.role);

            await notificationService.createNotification({
              userId: requestSnapshot.requestedBy,
              title: "Reschedule accepted",
              message: `${deciderLabel} accepted your reschedule request. New time: ${rescheduledLabel}.`,
              type: "class",
              relatedTo: "class",
              relatedId: classDoc._id,
              metadata: {
                kind: "class_reschedule_decision",
                classId: String(classDoc._id),
                decision: "approved",
                decidedByRole: req.user.role,
                newDate: rescheduleDate.toISOString(),
              }
            });
          }
        } catch (notifyErr) {
          console.warn("Reschedule approval notification failed", notifyErr.message);
        }

        try {
          const io = req.app.get("io");
          if (io) {
            io.emit("class:updated", { class: populated });
          }
        } catch (socketErr) {
          console.warn("Socket emit reschedule-approval failed", socketErr.message);
        }

        const responseClass = sanitizeClassForRole(populated.toObject({ virtuals: true }), req.user.role);
        const policy = await buildChangePolicy(populated, req.user);

        return res.json({ message: "Reschedule request approved", class: responseClass, policy });
      } catch (err) {
        console.error("Error approving reschedule request:", err);
        return res.status(500).json({ message: "Failed to approve reschedule request", error: err.message });
      }
    } catch (err) {
      console.error("POST /classes/:id/reschedule-request/decision error:", err);
      return res.status(500).json({ message: "Failed to update reschedule request", error: err.message });
    }
  }
);

/* -------------------------
   POST /api/classes/:id/cancel
   Role-aware cancellation with limits and notifications
   ------------------------- */
router.post(
  "/:id/cancel",
  authenticateToken,
  requireRole(["teacher", "guardian", "admin"]),
  [
    body("reason")
      .isLength({ min: 3, max: 500 })
      .withMessage("Reason is required and must be 3-500 characters"),
    body("refundIssued")
      .optional()
      .isBoolean()
      .withMessage("refundIssued must be a boolean"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }

      const classDoc = await Class.findById(req.params.id)
        .populate("teacher", "firstName lastName email")
        .populate("student.guardianId", "firstName lastName email");

      if (!classDoc) {
        return res.status(404).json({ message: "Class not found" });
      }

      const { teacherId, guardianId, studentId } = extractParticipantIds(classDoc);

      if (classDoc.status === "pattern") {
        return res.status(400).json({ message: "Cannot cancel a recurring pattern template" });
      }

      if (["cancelled_by_teacher", "cancelled_by_student", "cancelled_by_guardian", "cancelled_by_admin"].includes(classDoc.status)) {
        return res.status(409).json({ message: "Class has already been cancelled" });
      }

      if (req.user.role !== "admin" && !ensureClassAccess(req, classDoc)) {
        return res.status(403).json({ message: "You do not have access to this class" });
      }

      let policy = null;
      if (req.user.role !== "admin") {
        policy = await buildChangePolicy(classDoc, req.user);
        if (!policy.canCancel) {
          return res.status(403).json({
            message: policy.reasons.cancel || "You cannot cancel this class",
            policy,
          });
        }
      }

      const reason = req.body.reason.trim();
      const refundIssued = typeof req.body.refundIssued === "boolean" ? req.body.refundIssued : false;

      classDoc.lastModifiedBy = req.user._id;
      classDoc.lastModifiedAt = new Date();

      const cancelledByRole = req.user.role;
      const saved = await classDoc.cancelClass(reason, req.user._id, cancelledByRole, refundIssued);

      const populated = await Class.findById(saved._id)
        .populate("teacher", "firstName lastName email phone profilePicture")
        .populate("student.guardianId", "firstName lastName email phone");

      // If the cancelled class was billed in an invoice, remove it
      try {
        if (saved.billedInInvoiceId) {
          const Invoice = require("../models/Invoice");
          const InvoiceService = require("../services/invoiceService");
          const billedInvoice = await Invoice.findById(saved.billedInInvoiceId);
          if (billedInvoice && !['cancelled', 'refunded'].includes(billedInvoice.status)) {
            const classIdStr = String(saved._id);
            const removedItem = (billedInvoice.items || []).find(it => {
              const itId = it.class ? String(it.class) : (it.lessonId || null);
              return itId === classIdStr;
            });

            if (removedItem) {
              const hours = (Number(removedItem.duration || 0) / 60);
              const amount = Number(removedItem.amount || 0);

              if (billedInvoice.status === 'paid') {
                // Paid invoice: record credit adjustment, remove item, freeze totals
                await InvoiceService.createPaidInvoiceAdjustment({
                  invoiceId: billedInvoice._id,
                  type: 'credit',
                  reason: 'class_cancelled',
                  classDoc: saved,
                  description: `Cancelled class on ${new Date(saved.scheduledDate || saved.dateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} removed — not delivered`,
                  hoursDelta: -hours,
                  amountDelta: -amount,
                  actorId: req.user._id
                });
                billedInvoice.items = billedInvoice.items.filter(it => {
                  const itId = it.class ? String(it.class) : (it.lessonId || null);
                  return itId !== classIdStr;
                });
                billedInvoice.markModified('items');
                billedInvoice._skipRecalculate = true;
                await billedInvoice.save();
              } else {
                // Unpaid invoice: remove item and recalculate
                billedInvoice.items = billedInvoice.items.filter(it => {
                  const itId = it.class ? String(it.class) : (it.lessonId || null);
                  return itId !== classIdStr;
                });
                billedInvoice.markModified('items');
                await billedInvoice.save();
              }

              // Unlink class from invoice
              await Class.updateOne(
                { _id: saved._id },
                { $unset: { billedInInvoiceId: 1, billedAt: 1 } }
              );
            }
          }
        }
      } catch (invoiceErr) {
        console.warn("[cancel] Failed to remove cancelled class from invoice:", invoiceErr.message);
      }

      try {
        const notificationService = require("../services/notificationService");
        const actor = req.user;
        notificationService.notifyClassEvent({
          classObj: populated,
          eventType: "cancelled",
          actor,
          extraMsg: reason ? `Reason: ${reason}` : "",
        }).catch(console.error);

        if (req.user.role !== "admin") {
          await notificationService.notifyRole({
            role: "admin",
            title: "Class cancelled",
            message: `${req.user.firstName || req.user.email || "User"} cancelled a class scheduled for ${new Date(populated.scheduledDate).toLocaleString()}.`,
            type: "class",
            related: { class: populated._id },
          });
        }
      } catch (notifyErr) {
        console.warn("Cancellation notification failed", notifyErr.message);
      }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("class:updated", { class: populated });
        }
      } catch (socketErr) {
        console.warn("Socket emit cancel failed", socketErr.message);
      }

  const responseClass = sanitizeClassForRole(populated.toObject({ virtuals: true }), req.user.role);
  const updatedPolicy = await buildChangePolicy(populated, req.user);

      const responsePayload = {
        message: "Class cancelled",
        class: responseClass,
        policy: updatedPolicy,
      };

      try {
        await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);
      } catch (refreshErr) {
        console.warn("[cancel] Failed to refresh participant activity flags", refreshErr.message);
      }

      return res.json(responsePayload);
    } catch (err) {
      console.error("POST /classes/:id/cancel error:", err);
      return res.status(500).json({ message: "Failed to cancel class", error: err.message });
    }
  }
);

/* -------------------------
   GET /api/classes/:id
   - returns { class: { ... } }
   ------------------------- */
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    let classDoc = await Class.findById(req.params.id)
      .populate("teacher", "firstName lastName email phone")
      .populate("student.guardianId", "firstName lastName email phone")
      .populate("createdBy", "firstName lastName")
      .populate("lastModifiedBy", "firstName lastName")
      .populate("classReport.submittedBy", "firstName lastName role")
      .populate("classReport.lastEditedBy", "firstName lastName role")
      .populate("classReportHistory.editedBy", "firstName lastName role")
      .lean();

    if (!classDoc) return res.status(404).json({ message: "Class not found" });

    const hasAccess =
      req.user.role === "admin" ||
      (req.user.role === "teacher" && classDoc.teacher && String(classDoc.teacher._id || classDoc.teacher) === String(req.user._id)) ||
      (req.user.role === "guardian" && classDoc.student && classDoc.student.guardianId && String(classDoc.student.guardianId._id || classDoc.student.guardianId) === String(req.user._id));

    if (!hasAccess) return res.status(403).json({ message: "Access denied" });

    if (classDoc.parentRecurringClass) {
      const pattern = await Class.findById(classDoc.parentRecurringClass).lean();
      if (pattern) {
        classDoc.recurrence = pattern.recurrence;
        classDoc.recurrenceDetails = pattern.recurrenceDetails || [];
        classDoc.isRecurring = true;
      }
    }

    await hydrateUnknownStudentNames([classDoc]);

    const policy = await buildChangePolicy(classDoc, req.user);

    // Add timezone conversion info
    const userTimezone = req.user?.timezone || DEFAULT_TIMEZONE;
    const processedClass = addTimezoneInfo(classDoc, userTimezone, ['scheduledDate', 'createdAt', 'updatedAt']);
    const enrichedClass = enrichClassObj(processedClass, new Date());
    const sanitizedClass = sanitizeClassForRole(enrichedClass, req.user?.role);

    return res.json({ 
      class: sanitizedClass,
      userTimezone,
      systemTimezone: DEFAULT_TIMEZONE,
      policy,
    });
  } catch (err) {
    console.error("GET /classes/:id error:", err);
    return res.status(500).json({ message: "Failed to fetch class", error: err.message });
  }
});

/* -------------------------
   POST /api/classes
   Create single or recurring
   ------------------------- */
router.post(
  "/",
  authenticateToken,
  requireRole(["admin"]),
  [
    body("title").trim().isLength({ min: 1 }).withMessage("Title required"),
    body("subject").trim().isLength({ min: 1 }).withMessage("Subject required"),
    body("teacher").isMongoId().withMessage("Teacher ID required"),
    body("student.guardianId").isMongoId().withMessage("Guardian ID required"),
    body("student.studentId").isMongoId().withMessage("Student ID required"),
    body("isRecurring").optional().isBoolean(),
    body("overrideDuplicateSeries").optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      console.log("=== CREATE CLASS DEBUG ===");
      console.log("Request body:", JSON.stringify(req.body, null, 2));
      console.log("User:", req.user._id, req.user.role);
      
      req.body.isRecurring = toBool(req.body.isRecurring);
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log("Validation errors:", errors.array());
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }

      const {
        title, description, subject, teacher, student,
        scheduledDate, duration, timezone, isRecurring,
          anchoredTimezone, recurrence, meetingLink, materials, recurrenceDetails = [],
          guardianRate: rawGuardianRate, teacherPremium: rawTeacherPremium
      } = req.body;
        const overrideDuplicateSeries = toBool(req.body.overrideDuplicateSeries);
      const guardianRate = rawGuardianRate != null && rawGuardianRate !== '' ? Number(rawGuardianRate) : null;
      const teacherPremium = rawTeacherPremium != null && rawTeacherPremium !== '' ? Number(rawTeacherPremium) : null;

      // Validate references
      console.log("Validating teacher:", teacher);
      const teacherDoc = await User.findOne({ _id: teacher, role: "teacher" });
      if (!teacherDoc) {
        console.log("Teacher not found");
        return res.status(404).json({ message: "Teacher not found" });
      }
      console.log("Teacher found:", teacherDoc.firstName, teacherDoc.lastName);

      console.log("Validating guardian:", student.guardianId);
      const guardianDoc = await User.findOne({ _id: student.guardianId, role: "guardian" });
      if (!guardianDoc) {
        console.log("Guardian not found");
        return res.status(404).json({ message: "Guardian not found" });
      }
      console.log("Guardian found:", guardianDoc.firstName, guardianDoc.lastName);

      // check student exists under guardian (best-effort)
      console.log("Checking student under guardian:", student.studentId);
      const sExists = guardianDoc.guardianInfo && guardianDoc.guardianInfo.students && guardianDoc.guardianInfo.students.id(student.studentId);
      if (!sExists) {
        console.log("Student not found under guardian - allowing gracefully");
        // allow creation if guardian doesn't have children array (graceful), but warn
        // return res.status(404).json({ message: "Student not found under guardian" });
      } else {
        console.log("Student found:", sExists.firstName, sExists.lastName);
      }

      const resolvedStudent = await resolveStudentForClass(student, guardianDoc);
      const studentForClass = {
        guardianId: student.guardianId,
        studentId: resolvedStudent?.studentId || student.studentId,
        studentName: resolvedStudent?.studentName || student.studentName || 'Unknown Student'
      };
      const anchorMode = normalizeAnchorMode(anchoredTimezone);
      const studentTimezone = resolveStudentTimezone({
        guardianDoc,
        studentId: studentForClass.studentId,
        fallbackTimezone: resolvedStudent?.timezone || timezone || DEFAULT_TIMEZONE,
      });
      const teacherTimezone = resolveTeacherTimezone(teacherDoc, DEFAULT_TIMEZONE);
      console.log("Student object for class:", studentForClass);

      const createdClasses = [];

      if (!isRecurring) {
        // ensure tzUsed and convert scheduledDate to UTC
        console.log("Creating single class");
        const displayTimezone = timezone || DEFAULT_TIMEZONE;
        const anchorTimezone = resolveAnchorTimezone({
          anchorMode,
          studentTimezone,
          teacherTimezone,
          fallbackTimezone: displayTimezone,
        });
        console.log("Timezone:", displayTimezone, "ScheduledDate:", scheduledDate, "AnchorTimezone:", anchorTimezone);
        const scheduledUtc = scheduledDate ? (tzUtils.toUtc ? tzUtils.toUtc(scheduledDate, displayTimezone) : new Date(scheduledDate)) : null;
        console.log("Scheduled UTC:", scheduledUtc);

        let reportSubmission = null;
        const scheduledEnd = scheduledUtc
          ? new Date(scheduledUtc.getTime() + (Number(duration || 60) * 60000))
          : null;
        if (scheduledEnd && scheduledEnd.getTime() <= Date.now()) {
          reportSubmission = await buildReportSubmissionForPastClass(
            scheduledUtc,
            Number(duration || 60)
          );
        }

        const newClass = new Class({
          title, description, subject, teacher, student: studentForClass,
          scheduledDate: scheduledUtc,
          duration: Number(duration || 60),
          timezone: displayTimezone,
          anchoredTimezone: anchorMode,
          timeAnchor: buildTimeAnchorForScheduledClass({
            scheduledDate: scheduledUtc,
            anchorMode,
            requestedTimezone: anchorTimezone,
            studentTimezone,
            teacherTimezone,
            fallbackTimezone: displayTimezone,
          }),
          isRecurring: false,
          meetingLink: meetingLink || null,
          materials: Array.isArray(materials) ? materials : (materials ? [materials] : []),
          createdBy: req.user._id,
          status: "scheduled",
          guardianRate: Number.isFinite(guardianRate) ? guardianRate : null,
          teacherPremium: Number.isFinite(teacherPremium) ? teacherPremium : null,
          ...(reportSubmission ? { reportSubmission } : {}),
        });

        const overlappingSystemVacation = scheduledUtc
          ? await systemVacationService.getActiveSystemVacationForDate(scheduledUtc)
          : null;
        if (overlappingSystemVacation) {
          systemVacationService.applyVacationHoldToClassDoc(newClass, overlappingSystemVacation, req.user._id);
        }

        console.log("New class object:", JSON.stringify(newClass.toObject(), null, 2));
        await newClass.save();
        console.log("Class saved successfully:", newClass._id);
        createdClasses.push(newClass);

        // Notification trigger: class added
        try {
          const notificationService = require('../services/notificationService');
          notificationService.notifyClassEvent({
            classObj: newClass,
            eventType: 'added',
            actor: req.user
          }).catch(console.error);
        } catch (e) { console.warn("Notification trigger failed", e.message); }

        // emit
        try { const io = req.app.get("io"); if (io) io.emit("class:created", { class: newClass }); } catch (e) { console.warn("Socket emit create failed", e.message); }
      } else {
  // recurring pattern creation
        const duplicateSeries = await Class.findOne({
          teacher,
          subject,
          'student.studentId': studentForClass.studentId,
          status: 'pattern',
          hidden: { $ne: true }
        }).lean();

        if (duplicateSeries && !overrideDuplicateSeries) {
          console.log("Duplicate recurring series detected", duplicateSeries._id);
          return res.status(409).json({
            message: "Duplicate recurring series detected",
            duplicateSeries: {
              id: duplicateSeries._id,
              subject: duplicateSeries.subject,
              teacherId: duplicateSeries.teacher,
              studentId: duplicateSeries?.student?.studentId,
              studentName: duplicateSeries?.student?.studentName,
              scheduledDate: duplicateSeries.scheduledDate,
              timezone: duplicateSeries.timezone
            }
          });
        }

        const baseTimezone = timezone || DEFAULT_TIMEZONE;
        const anchorTimezone = resolveAnchorTimezone({
          anchorMode,
          studentTimezone,
          teacherTimezone,
          fallbackTimezone: baseTimezone,
        });

        const referenceDate = scheduledDate || new Date();
        const normalizedDetails = normalizeRecurrenceSlots(recurrenceDetails, baseTimezone).map((slot) => {
          const slotTimezone = slot.timezone || baseTimezone;
          const anchorMeta = buildRecurringSlotAnchor({
            slot: { ...slot, timezone: slotTimezone },
            anchorMode,
            studentTimezone,
            teacherTimezone,
            fallbackTimezone: baseTimezone,
            referenceDate,
          });
          return {
            ...slot,
            timezone: slotTimezone,
            raw: {
              ...(slot.raw || {}),
              ...(anchorMeta || {}),
            },
          };
        });

        console.log("Recurring creation details (normalized):", normalizedDetails);

        const perDayMap = buildPerDayMap(normalizedDetails);
        let uniqueDays = Array.from(perDayMap.keys());
        if (!uniqueDays.length && Array.isArray(recurrence?.daysOfWeek)) {
          uniqueDays = recurrence.daysOfWeek
            .map((d) => Number(d))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
        }
        uniqueDays = Array.from(new Set(uniqueDays)).sort((a, b) => a - b);
        if (!uniqueDays.length) {
          return res.status(400).json({
            message: "Recurring classes need at least one weekday",
            error: "NO_RECURRING_DAYS"
          });
        }

        const tzUsed = normalizedDetails?.[0]?.timezone || baseTimezone || "UTC";
        const generationPeriodMonths = (recurrence && recurrence.generationPeriodMonths)
          || Number(req.body.generationPeriodMonths)
          || 2;

        const recurrenceDuration = (recurrence && recurrence.duration)
          || recurrenceDetails?.[0]?.duration
          || Number(duration)
          || 60;

        const finalRecurrence = {
          frequency: (recurrence && recurrence.frequency) || "weekly",
          interval: (recurrence && recurrence.interval) || 1,
          daysOfWeek: uniqueDays,
          duration: recurrenceDuration,
          generationPeriodMonths,
          lastGenerated: new Date()
        };

        const availabilitySlots = [];
        perDayMap.forEach((slotList, day) => {
          slotList.forEach((slot) => {
            const hours = Number(slot?.hours);
            const minutes = Number(slot?.minutes);
            if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
              return;
            }

            const normalizedTime = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
            const slotDuration = Number(slot?.duration);

            availabilitySlots.push({
              dayOfWeek: day,
              time: normalizedTime,
              duration: Number.isFinite(slotDuration) && slotDuration > 0 ? slotDuration : recurrenceDuration,
              timezone: slot?.timezone || tzUsed,
            });
          });
        });

        const recurringAvailabilityCheck = await ensureRecurringSlotsWithinAvailability(
          teacher,
          availabilitySlots,
          tzUsed,
          recurrenceDuration
        );

        if (!recurringAvailabilityCheck.ok) {
          const slotInfo = recurringAvailabilityCheck.slot || {};
          const dayName = typeof slotInfo.dayOfWeek === "number" ? DAY_LABELS[slotInfo.dayOfWeek] || "selected day" : "selected day";

          let alternatives = [];
          try {
            if (teacher) {
              const teacherId = teacher._id || teacher;
              const preferredDays = typeof slotInfo.dayOfWeek === 'number' ? [slotInfo.dayOfWeek] : [];
              alternatives = await availabilityService.getAlternativeTimeSlots(
                teacherId,
                recurrenceDuration,
                preferredDays,
                14
              );
            }
          } catch (altErr) {
            console.warn('Failed to compute alternative slots for recurring availability error', altErr?.message || altErr);
          }

          return res.status(400).json({
            message: "Teacher not available for one or more recurring slots",
            availabilityError: {
              reason: recurringAvailabilityCheck.availability?.reason || "Teacher not available during this recurring slot",
              conflictType: recurringAvailabilityCheck.availability?.conflictType,
              conflictDetails: recurringAvailabilityCheck.availability?.conflictDetails,
              alternatives: Array.isArray(alternatives) ? alternatives.slice(0, 5) : [],
              slot: slotInfo,
              dayName,
            },
          });
        }

        // use base scheduledDate if provided (converted to UTC), otherwise use now with first slot time
        let base;
        if (scheduledDate) {
          base = tzUtils.toUtc ? tzUtils.toUtc(scheduledDate, tzUsed) : new Date(scheduledDate);
        } else if (recurrenceDetails && recurrenceDetails[0]) {
          const [hh, mm] = recurrenceDetails[0].time.split(":").map(n => parseInt(n, 10));
          const now = new Date();
          base = tzUtils.buildUtcFromParts
            ? tzUtils.buildUtcFromParts({ year: now.getFullYear(), month: now.getMonth(), day: now.getDate(), hour: hh, minute: mm }, tzUsed)
            : new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm);
        } else {
          base = new Date();
        }

        const pattern = new Class({
          title, description, subject, teacher, student: studentForClass,
          scheduledDate: base,
          duration: recurrenceDuration,
          timezone: tzUsed,
          anchoredTimezone: anchorMode,
          timeAnchor: buildTimeAnchorForSlot({
            slot: normalizedDetails[0] || { dayOfWeek: uniqueDays[0], time: null, timezone: tzUsed },
            anchorMode,
            requestedTimezone: anchorTimezone,
            studentTimezone,
            teacherTimezone,
            fallbackTimezone: tzUsed,
          }),
          isRecurring: true,
          recurrence: finalRecurrence,
          recurrenceDetails: normalizedDetails.map((slot) => ({
            ...slot,
            timezone: slot.timezone || tzUsed,
          })),
          meetingLink: meetingLink || null,
          materials: Array.isArray(materials) ? materials : (materials ? [materials] : []),
          createdBy: req.user._id,
          status: "pattern",
          guardianRate: Number.isFinite(guardianRate) ? guardianRate : null,
          teacherPremium: Number.isFinite(teacherPremium) ? teacherPremium : null,
        });

        await pattern.save();

        // Notification trigger: recurring pattern added
        try {
          const notificationService = require('../services/notificationService');
          notificationService.notifyClassEvent({
            classObj: pattern,
            eventType: 'added',
            actor: req.user
          }).catch(console.error);
        } catch (e) { console.warn("Notification trigger failed", e.message); }

        // generate instances for the initial rolling window
        const generated = await generateRecurringClasses(pattern, pattern.recurrence.generationPeriodMonths || 2, perDayMap);

        createdClasses.push(pattern, ...generated);

        // emit for each
        try {
          const io = req.app.get("io");
          if (io) {
            io.emit("class:created", { class: pattern });
            generated.forEach(g => io.emit("class:created", { class: g }));
          }
        } catch (e) { console.warn("Socket emit recurring create failed", e.message); }
      }

      await refreshParticipantsFromSchedule(teacher, studentForClass.guardianId, studentForClass.studentId);
      return res.status(201).json({ message: "Created", classes: createdClasses, count: createdClasses.length });
    } catch (err) {
      console.error("=== POST /classes error ===");
      console.error("Error message:", err.message);
      console.error("Error stack:", err.stack);
      console.error("Request body was:", JSON.stringify(req.body, null, 2));
      return res.status(500).json({ message: "Failed to create class", error: err.message });
    }
  }
);


/* -------------------------
   POST /api/classes/:id/duplicate
   Clone an existing class instance with optional overrides (admins only)
   ------------------------- */
router.post(
  "/:id/duplicate",
  authenticateToken,
  requireRole(["admin"]),
  [
    body("scheduledDate").optional().isISO8601().withMessage("scheduledDate must be a valid ISO 8601 string"),
    body("duration")
      .optional()
      .isInt({ min: 15, max: 180 })
      .withMessage("Duration must be between 15 and 180 minutes"),
    body("timezone")
      .optional()
      .isString()
      .trim()
      .isLength({ min: 2 })
      .withMessage("Timezone must be a valid identifier"),
    body("title").optional().isString().trim().isLength({ min: 1 }).withMessage("Title cannot be empty"),
    body("subject").optional().isString().trim().isLength({ min: 1 }).withMessage("Subject cannot be empty"),
    body("description").optional().isString(),
    body("anchoredTimezone")
      .optional()
      .isIn(["student", "teacher", "system"])
      .withMessage("anchoredTimezone must be student, teacher, or system"),
    body("teacher").optional().isMongoId().withMessage("Teacher must be a valid ID"),
    body("student.guardianId").optional().isMongoId().withMessage("Guardian must be a valid ID"),
    body("student.studentId").optional().isMongoId().withMessage("Student must be a valid ID"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }

      const sourceClass = await Class.findById(req.params.id).lean();
      if (!sourceClass) {
        return res.status(404).json({ message: "Source class not found" });
      }

      const teacherId = req.body.teacher || sourceClass.teacher;
      const teacherDoc = await User.findOne({ _id: teacherId, role: "teacher" });
      if (!teacherDoc) {
        return res.status(404).json({ message: "Teacher not found" });
      }

      const originalStudent = sourceClass.student || {};
      let studentForClass = {
        guardianId: originalStudent.guardianId,
        studentId: originalStudent.studentId,
        studentName: originalStudent.studentName || "Unknown Student",
      };

      if (req.body.student && (req.body.student.guardianId || req.body.student.studentId)) {
        const guardianId = req.body.student.guardianId || studentForClass.guardianId;
        const studentId = req.body.student.studentId || studentForClass.studentId;

        if (!guardianId || !studentId) {
          return res.status(400).json({ message: "Guardian and student IDs are required when overriding student" });
        }

        const guardianDoc = await User.findOne({ _id: guardianId, role: "guardian" });
        if (!guardianDoc) {
          return res.status(404).json({ message: "Guardian not found" });
        }

        let studentSub;
        if (typeof guardianDoc.guardianInfo?.students?.id === "function") {
          studentSub = guardianDoc.guardianInfo.students.id(studentId);
        }
        if (!studentSub && Array.isArray(guardianDoc.guardianInfo?.students)) {
          studentSub = guardianDoc.guardianInfo.students.find((s) => String(s._id) === String(studentId));
        }

        if (!studentSub) {
          return res.status(404).json({ message: "Student not found under guardian" });
        }

        studentForClass = {
          guardianId,
          studentId,
          studentName: `${studentSub.firstName} ${studentSub.lastName}`.trim(),
        };
      }

      if (!studentForClass.guardianId || !studentForClass.studentId || !studentForClass.studentName) {
        return res.status(400).json({ message: "Source class is missing student information" });
      }

      const duplicateGuardianDoc = await User.findOne({ _id: studentForClass.guardianId, role: 'guardian' }).select('timezone guardianInfo.students');
      const anchorMode = normalizeAnchorMode(req.body.anchoredTimezone || sourceClass.anchoredTimezone || 'student');
      const studentTimezone = resolveStudentTimezone({
        guardianDoc: duplicateGuardianDoc,
        studentId: studentForClass.studentId,
        fallbackTimezone: sourceClass?.timeAnchor?.timezone || sourceClass.timezone || DEFAULT_TIMEZONE,
      });
      const teacherTimezone = resolveTeacherTimezone(teacherDoc, DEFAULT_TIMEZONE);

      const displayTimezone = req.body.timezone || sourceClass.timezone || DEFAULT_TIMEZONE;
      const anchorTimezone = resolveAnchorTimezone({
        anchorMode,
        studentTimezone,
        teacherTimezone,
        fallbackTimezone: displayTimezone,
      });
      let scheduledUtc;
      if (req.body.scheduledDate) {
        const parsedRequestedDate = new Date(req.body.scheduledDate);
        if (Number.isNaN(parsedRequestedDate.getTime())) {
          return res.status(400).json({ message: "Invalid scheduledDate supplied" });
        }
        scheduledUtc = tzUtils.toUtc ? tzUtils.toUtc(req.body.scheduledDate, displayTimezone) : parsedRequestedDate;
      } else {
        scheduledUtc = new Date(sourceClass.scheduledDate);
      }

      if (Number.isNaN(scheduledUtc.getTime())) {
        return res.status(400).json({ message: "Unable to determine scheduled date for duplicate" });
      }

      const durationMinutes = req.body.duration ? Number(req.body.duration) : Number(sourceClass.duration || 60);
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        return res.status(400).json({ message: "Invalid duration supplied" });
      }

      let reportSubmission = null;
      const scheduledEnd = new Date(scheduledUtc.getTime() + (durationMinutes * 60000));
      if (scheduledEnd.getTime() <= Date.now()) {
        reportSubmission = await buildReportSubmissionForPastClass(scheduledUtc, durationMinutes);
      }

      const baseMaterials = Array.isArray(sourceClass.materials)
        ? sourceClass.materials
            .filter((mat) => mat && mat.name && mat.url)
            .map((mat) => ({
              name: mat.name,
              url: mat.url,
              type: mat.type || "document",
            }))
        : [];

      const materials = Array.isArray(req.body.materials)
        ? req.body.materials
            .filter((mat) => mat && mat.name && mat.url)
            .map((mat) => ({
              name: mat.name,
              url: mat.url,
              type: mat.type || "document",
            }))
        : baseMaterials;

      const duplicateClass = new Class({
        title: typeof req.body.title === "string" ? req.body.title.trim() : sourceClass.title,
        description:
          typeof req.body.description === "string"
            ? req.body.description.trim()
            : sourceClass.description || "",
        subject: typeof req.body.subject === "string" ? req.body.subject.trim() : sourceClass.subject,
        teacher: teacherId,
        student: studentForClass,
        scheduledDate: scheduledUtc,
        duration: durationMinutes,
        timezone: displayTimezone,
        anchoredTimezone: anchorMode,
        timeAnchor: buildTimeAnchorForScheduledClass({
          scheduledDate: scheduledUtc,
          anchorMode,
          requestedTimezone: anchorTimezone,
          studentTimezone,
          teacherTimezone,
          fallbackTimezone: displayTimezone,
        }),
        isRecurring: false,
        recurrence: undefined,
        recurrenceDetails: [],
        parentRecurringClass: undefined,
        meetingLink:
          Object.prototype.hasOwnProperty.call(req.body, "meetingLink")
            ? req.body.meetingLink || null
            : sourceClass.meetingLink || null,
        materials,
        createdBy: req.user._id,
        status: "scheduled",
        ...(reportSubmission ? { reportSubmission } : {}),
      });

      const overlappingSystemVacation = scheduledUtc
        ? await systemVacationService.getActiveSystemVacationForDate(scheduledUtc)
        : null;
      if (overlappingSystemVacation) {
        systemVacationService.applyVacationHoldToClassDoc(duplicateClass, overlappingSystemVacation, req.user._id);
      }

      await duplicateClass.save();
      await refreshParticipantsFromSchedule(teacherId, studentForClass.guardianId, studentForClass.studentId);

      const populatedClass = await Class.findById(duplicateClass._id)
        .populate("teacher", "firstName lastName email phone profilePicture")
        .populate("student.guardianId", "firstName lastName email phone")
        .lean();

      try {
        const notificationService = require("../services/notificationService");
        notificationService
          .notifyClassEvent({
            classObj: populatedClass,
            eventType: "added",
            actor: req.user,
          })
          .catch(console.error);
      } catch (e) {
        console.warn("Notification trigger failed", e.message);
      }

      try {
        const io = req.app.get("io");
        if (io) io.emit("class:created", { class: populatedClass });
      } catch (e) {
        console.warn("Socket emit duplicate failed", e.message);
      }

      return res.status(201).json({
        message: "Class duplicated",
        class: enrichClassObj(populatedClass, new Date()),
      });
    } catch (err) {
      console.error("POST /classes/:id/duplicate error:", err);
      return res.status(500).json({ message: "Failed to duplicate class", error: err.message });
    }
  }
);


/* -------------------------
   PUT /api/classes/:id
   - Single or recurring update (admins only)
   ------------------------- */
router.put("/:id", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const updates = req.body;
    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: "Class not found" });

    // If updating a single instance (non-recurring)
    if (!toBool(updates.isRecurring)) {
      const resolvedTeacherId = updates.teacher || classDoc.teacher;
      let resolvedStudent = updates.student;
      if (updates.student?.guardianId && updates.student?.studentId) {
        const guardianDoc = await User.findOne({ _id: updates.student.guardianId, role: 'guardian' });
        if (guardianDoc) {
          const resolved = await resolveStudentForClass(updates.student, guardianDoc);
          if (resolved) {
            resolvedStudent = {
              guardianId: updates.student.guardianId,
              studentId: resolved.studentId,
              studentName: resolved.studentName
            };
          }
        }
      }

      const resolvedScheduledDate = updates.scheduledDate ? new Date(updates.scheduledDate) : classDoc.scheduledDate;
      const resolvedDuration = (typeof updates.duration !== "undefined") ? Number(updates.duration) : classDoc.duration;
      const anchorMode = normalizeAnchorMode(updates.anchoredTimezone || classDoc.anchoredTimezone || 'student');
      const guardianIdForTimezone = resolvedStudent?.guardianId || classDoc?.student?.guardianId;
      const studentIdForTimezone = resolvedStudent?.studentId || classDoc?.student?.studentId;
      const [guardianDoc, teacherDoc] = await Promise.all([
        guardianIdForTimezone
          ? User.findOne({ _id: guardianIdForTimezone, role: 'guardian' }).select('timezone guardianInfo.students')
          : null,
        resolvedTeacherId
          ? User.findOne({ _id: resolvedTeacherId, role: 'teacher' }).select('timezone')
          : null,
      ]);
      const displayTimezone = updates.timezone || classDoc.timezone || DEFAULT_TIMEZONE;
      const studentTimezone = resolveStudentTimezone({
        guardianDoc,
        studentId: studentIdForTimezone,
        fallbackTimezone: classDoc?.timeAnchor?.timezone || displayTimezone || DEFAULT_TIMEZONE,
      });
      const teacherTimezone = resolveTeacherTimezone(teacherDoc, DEFAULT_TIMEZONE);
      const anchorTimezone = resolveAnchorTimezone({
        anchorMode,
        studentTimezone,
        teacherTimezone,
        fallbackTimezone: displayTimezone,
      });

      const updatePayload = {
        title: updates.title,
        description: updates.description,
        subject: updates.subject,
        teacher: resolvedTeacherId,
        student: resolvedStudent,
        scheduledDate: resolvedScheduledDate,
        duration: resolvedDuration,
        timezone: displayTimezone,
        anchoredTimezone: anchorMode,
        timeAnchor: buildTimeAnchorForScheduledClass({
          scheduledDate: resolvedScheduledDate,
          anchorMode,
          requestedTimezone: anchorTimezone,
          studentTimezone,
          teacherTimezone,
          fallbackTimezone: displayTimezone,
        }),
        meetingLink: updates.meetingLink,
        materials: Array.isArray(updates.materials) ? updates.materials : classDoc.materials,
        lastModifiedBy: req.user._id,
        lastModifiedAt: new Date(),
      };

      // Apply rate overrides if provided
      if (updates.guardianRate !== undefined) {
        updatePayload.guardianRate = (updates.guardianRate != null && updates.guardianRate !== '') ? Number(updates.guardianRate) : null;
      }
      if (updates.teacherPremium !== undefined) {
        updatePayload.teacherPremium = (updates.teacherPremium != null && updates.teacherPremium !== '') ? Number(updates.teacherPremium) : null;
      }

      const shouldReopenReportWindow = updates.scheduledDate
        && !classDoc.classReport?.submittedAt
        && resolvedScheduledDate instanceof Date
        && Number.isFinite(resolvedScheduledDate.getTime())
        && new Date(resolvedScheduledDate.getTime() + (Number(resolvedDuration || 0) * 60000)).getTime() <= Date.now();

      if (shouldReopenReportWindow) {
        const reportSubmission = await buildReportSubmissionForPastClass(
          resolvedScheduledDate,
          Number(resolvedDuration || 0)
        );
        if (reportSubmission) {
          updatePayload.reportSubmission = reportSubmission;
        }
      }

      // Use .save() instead of findByIdAndUpdate so that pre/post save hooks fire.
      // This ensures onClassStateChanged is called for duration/status changes,
      // which updates guardian hours and invoice item snapshots.
      const prevScheduledDate = classDoc.scheduledDate;
      Object.assign(classDoc, updatePayload);
      await classDoc.save();
      const updated = classDoc.toObject();

      // Notification trigger: class rescheduled or time changed
      try {
        const notificationService = require('../services/notificationService');
        const eventType = 'rescheduled';
        notificationService.notifyClassEvent({
          classObj: { ...classDoc.toObject(), ...updatePayload },
          eventType,
          actor: req.user,
          oldDate: prevScheduledDate
        }).catch(console.error);
      } catch (e) { console.warn("Notification trigger failed", e.message); }

      try { const io = req.app.get("io"); if (io) io.emit("class:updated", { class: updated }); } catch (e) { console.warn("emit update failed", e.message); }

      return res.json({ message: "Class updated", classes: [enrichClassObj(updated, new Date())] });
    }

    // Recurring pattern update: validate, update pattern, replace future children safely, regenerate
    const patternId = classDoc.parentRecurringClass ? classDoc.parentRecurringClass : classDoc._id;
    const pattern = await Class.findById(patternId);
    if (!pattern || pattern.status !== "pattern") return res.status(400).json({ message: "Recurring pattern not found" });

    const {
      title, description, subject, teacher, student,
      scheduledDate, duration, timezone, anchoredTimezone, recurrence, recurrenceDetails = []
    } = updates;

    const proposedDisplayTimezone = timezone || pattern.timezone || DEFAULT_TIMEZONE;
    const normalizedUpdateDetails = normalizeRecurrenceSlots(recurrenceDetails, proposedDisplayTimezone);

    const now = new Date();
    const patternBefore = pattern.toObject();

    // Snapshot future children so we can roll back if regeneration fails.
    const futureChildren = await Class.find({
      parentRecurringClass: patternId,
      scheduledDate: { $gte: now },
      status: { $ne: 'pattern' },
    })
      .select('_id status hidden cancellation')
      .lean();

    // Build a proposed pattern in-memory and validate availability BEFORE touching children.
    const patternAnchorMode = normalizeAnchorMode(anchoredTimezone || pattern.anchoredTimezone || 'student');
    const currentTeacherDoc = teacher ? await User.findOne({ _id: teacher, role: 'teacher' }).select('timezone') : null;
    const currentGuardianDoc = student?.guardianId
      ? await User.findOne({ _id: student.guardianId, role: 'guardian' }).select('timezone guardianInfo.students')
      : await User.findOne({ _id: pattern.student?.guardianId, role: 'guardian' }).select('timezone guardianInfo.students');
    const patternStudentId = student?.studentId || pattern.student?.studentId;
    const proposedStudentTimezone = resolveStudentTimezone({
      guardianDoc: currentGuardianDoc,
      studentId: patternStudentId,
      fallbackTimezone: pattern?.timeAnchor?.timezone || pattern.timezone || DEFAULT_TIMEZONE,
    });
    const proposedTeacherTimezone = resolveTeacherTimezone(currentTeacherDoc, DEFAULT_TIMEZONE);
    const proposedAnchorTimezone = resolveAnchorTimezone({
      anchorMode: patternAnchorMode,
      studentTimezone: proposedStudentTimezone,
      teacherTimezone: proposedTeacherTimezone,
      fallbackTimezone: proposedDisplayTimezone,
    });
    const proposedTeacher = teacher || pattern.teacher;
    const proposedDuration = (typeof duration !== "undefined") ? Number(duration) : Number(pattern.duration || 60);

    const proposedRecurrence = { ...(pattern.recurrence || {}), ...(recurrence || {}) };
    const proposedRecurrenceDetails = (normalizedUpdateDetails.length ? normalizedUpdateDetails : (pattern.recurrenceDetails || []))
      .map((slot) => {
        const slotTimezone = slot?.timezone || proposedDisplayTimezone || DEFAULT_TIMEZONE;
        const anchorMeta = buildRecurringSlotAnchor({
          slot: { ...slot, timezone: slotTimezone },
          anchorMode: patternAnchorMode,
          studentTimezone: proposedStudentTimezone,
          teacherTimezone: proposedTeacherTimezone,
          fallbackTimezone: proposedDisplayTimezone,
          referenceDate: scheduledDate || pattern.scheduledDate || new Date(),
        });
        return {
          ...slot,
          timezone: slotTimezone,
          raw: {
            ...(slot?.raw || {}),
            ...(anchorMeta || {}),
          },
        };
      });

    if (Array.isArray(proposedRecurrenceDetails) && proposedRecurrenceDetails.length) {
      const derivedDays = Array.from(new Set(proposedRecurrenceDetails.map((slot) => Number(slot.dayOfWeek))))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b);
      if (derivedDays.length) {
        proposedRecurrence.daysOfWeek = derivedDays;
      }
      if (!proposedRecurrence.duration) {
        proposedRecurrence.duration = proposedRecurrenceDetails[0]?.duration || proposedDuration;
      }
    }

    const proposedSlots = (proposedRecurrenceDetails || [])
      .map((slot) => {
        const dayOfWeek = Number(slot?.dayOfWeek);
        const timeString = typeof slot?.time === "string" ? slot.time : "";
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !/^\d{2}:\d{2}$/.test(timeString)) {
          return null;
        }

        const durationValue = Number(slot?.duration);
        return {
          dayOfWeek,
          time: timeString,
          duration: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : Number(proposedRecurrence?.duration || proposedDuration || 60),
          timezone: slot?.timezone || proposedDisplayTimezone || DEFAULT_TIMEZONE,
        };
      })
      .filter(Boolean);

    const proposedRecurrenceDuration = Number(proposedRecurrence?.duration || proposedDuration || 60);

    const recurringUpdateAvailability = await ensureRecurringSlotsWithinAvailability(
      proposedTeacher?._id || proposedTeacher,
      proposedSlots,
      proposedDisplayTimezone || DEFAULT_TIMEZONE,
      proposedRecurrenceDuration,
      { excludeParentRecurringClassId: patternId }
    );

    if (!recurringUpdateAvailability.ok) {
      const slotInfo = recurringUpdateAvailability.slot || {};
      const dayName = typeof slotInfo.dayOfWeek === "number" ? DAY_LABELS[slotInfo.dayOfWeek] || "selected day" : "selected day";

      let alternatives = [];
      try {
        const teacherId = proposedTeacher?._id || proposedTeacher;
        const duration = Number(proposedRecurrenceDuration || proposedDuration || 60);
        const preferredDays = typeof slotInfo.dayOfWeek === 'number' ? [slotInfo.dayOfWeek] : [];

        // Anchor suggestions near the edited slot time (avoid irrelevant 11:00/13:00 suggestions).
        let anchorStartUtc = null;
        try {
          const nowForAnchor = new Date();
          const baseUtc = new Date(Date.UTC(nowForAnchor.getUTCFullYear(), nowForAnchor.getUTCMonth(), nowForAnchor.getUTCDate()));
          const dayOfWeek = Number(slotInfo?.dayOfWeek);
          const timeString = typeof slotInfo?.time === 'string' ? slotInfo.time.trim() : '';
          const slotTimezone = slotInfo?.timezone || proposedDisplayTimezone || DEFAULT_TIMEZONE;
          if (Number.isInteger(dayOfWeek) && /^\d{2}:\d{2}$/.test(timeString)) {
            const [hour, minute] = timeString.split(':').map((v) => Number.parseInt(v, 10));
            const dayOffset = (dayOfWeek - baseUtc.getUTCDay() + 7) % 7;
            const targetDate = new Date(baseUtc.getTime() + dayOffset * 24 * 60 * 60 * 1000);
            anchorStartUtc = tzUtils.buildUtcFromParts
              ? tzUtils.buildUtcFromParts(
                  {
                    year: targetDate.getUTCFullYear(),
                    month: targetDate.getUTCMonth(),
                    day: targetDate.getUTCDate(),
                    hour,
                    minute,
                  },
                  slotTimezone
                )
              : new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(), hour, minute));
          }
        } catch (e) {
          // ignore
        }

        alternatives = await availabilityService.getAlternativeTimeSlots(
          teacherId,
          duration,
          preferredDays,
          14,
          {
            anchorStartUtc,
            windowHours: 2,
            exclude: { excludeParentRecurringClassId: patternId },
            timezone: slotInfo?.timezone || proposedDisplayTimezone || DEFAULT_TIMEZONE,
          }
        );
      } catch (altErr) {
        console.warn('Failed to compute alternative slots for recurring update availability error', altErr?.message || altErr);
      }

      return res.status(400).json({
        message: "Teacher not available for one or more recurring slots",
        availabilityError: {
          reason: recurringUpdateAvailability.availability?.reason || "Teacher not available during this recurring slot",
          conflictType: recurringUpdateAvailability.availability?.conflictType,
          conflictDetails: recurringUpdateAvailability.availability?.conflictDetails,
          alternatives: Array.isArray(alternatives) ? alternatives.slice(0, 5) : [],
          slot: slotInfo,
          dayName,
        },
      });
    }

    // Apply validated updates to the pattern.
    if (title) pattern.title = title;
    if (description) pattern.description = description;
    if (subject) pattern.subject = subject;
    if (teacher) pattern.teacher = teacher;
    if (student) {
      let resolvedStudent = student;
      if (student?.guardianId && student?.studentId) {
        const guardianDoc = await User.findOne({ _id: student.guardianId, role: 'guardian' });
        if (guardianDoc) {
          const resolved = await resolveStudentForClass(student, guardianDoc);
          if (resolved) {
            resolvedStudent = {
              guardianId: student.guardianId,
              studentId: resolved.studentId,
              studentName: resolved.studentName
            };
          }
        }
      }
      pattern.student = resolvedStudent;
    }
    if (typeof duration !== "undefined") pattern.duration = Number(duration);
    pattern.anchoredTimezone = patternAnchorMode;
    pattern.timezone = proposedDisplayTimezone || pattern.timezone;
    if (scheduledDate) {
      pattern.scheduledDate = tzUtils.toUtc ? tzUtils.toUtc(scheduledDate, pattern.timezone || proposedDisplayTimezone || "UTC") : new Date(scheduledDate);
    }
    pattern.recurrence = proposedRecurrence;
    if (normalizedUpdateDetails.length) {
      pattern.recurrenceDetails = proposedRecurrenceDetails;
    }
    pattern.timeAnchor = buildTimeAnchorForSlot({
      slot: (normalizedUpdateDetails && normalizedUpdateDetails[0]) || (pattern.recurrenceDetails && pattern.recurrenceDetails[0]) || null,
      anchorMode: patternAnchorMode,
      requestedTimezone: proposedAnchorTimezone,
      studentTimezone: proposedStudentTimezone,
      teacherTimezone: proposedTeacherTimezone,
      fallbackTimezone: proposedDisplayTimezone || DEFAULT_TIMEZONE,
    });
    pattern.recurrence.lastGenerated = new Date();
    pattern.lastModifiedBy = req.user._id;
    pattern.lastModifiedAt = new Date();

    // Apply rate overrides if provided
    if (updates.guardianRate !== undefined) {
      pattern.guardianRate = (updates.guardianRate != null && updates.guardianRate !== '') ? Number(updates.guardianRate) : null;
    }
    if (updates.teacherPremium !== undefined) {
      pattern.teacherPremium = (updates.teacherPremium != null && updates.teacherPremium !== '') ? Number(updates.teacherPremium) : null;
    }

    await pattern.save();

    // Replace future instances.
    // Historically we "soft-cancelled" children and regenerated new ones, which left
    // cancelled duplicates visible in the UI. We still soft-cancel first for rollback safety,
    // but we delete the replaced children after successful regeneration.
    const cancelFilter = {
      parentRecurringClass: patternId,
      scheduledDate: { $gte: now },
      status: 'scheduled',
    };

    const replacedChildIds = (futureChildren || [])
      .filter((child) => child?.status === 'scheduled')
      .map((child) => child._id);

    await Class.updateMany(cancelFilter, {
      $set: {
        status: 'cancelled_by_admin',
        'cancellation.reason': 'Series updated',
        'cancellation.cancelledAt': now,
        'cancellation.cancelledBy': req.user._id,
        'cancellation.cancelledByRole': 'admin',
      },
    });

    // regenerate instances
    let newInstances = [];
    try {
      const perDayMap = buildPerDayMap(pattern.recurrenceDetails || []);
      newInstances = await generateRecurringClasses(
        pattern,
        pattern.recurrence.generationPeriodMonths || 2,
        perDayMap,
        { throwOnError: true }
      );
    } catch (genErr) {
      // Rollback: restore cancelled children and revert the pattern.
      try {
        if (futureChildren.length > 0) {
          await Class.bulkWrite(
            futureChildren.map((child) => ({
              updateOne: {
                filter: { _id: child._id },
                update: (() => {
                  const update = {
                    $set: {
                      status: child.status,
                      hidden: child.hidden,
                    },
                  };
                  if (typeof child.cancellation === 'undefined') {
                    update.$unset = { cancellation: 1 };
                  } else {
                    update.$set.cancellation = child.cancellation;
                  }
                  return update;
                })(),
              },
            }))
          );
        }

        await Class.findByIdAndUpdate(patternId, {
          title: patternBefore.title,
          description: patternBefore.description,
          subject: patternBefore.subject,
          teacher: patternBefore.teacher,
          student: patternBefore.student,
          scheduledDate: patternBefore.scheduledDate,
          duration: patternBefore.duration,
          timezone: patternBefore.timezone,
          recurrence: patternBefore.recurrence,
          recurrenceDetails: patternBefore.recurrenceDetails,
          meetingLink: patternBefore.meetingLink,
          materials: patternBefore.materials,
          lastModifiedBy: req.user._id,
          lastModifiedAt: new Date(),
        });
      } catch (rollbackErr) {
        console.error('Failed to rollback recurring update after generation error:', rollbackErr);
      }

      console.error('Failed to regenerate recurring instances during update:', genErr);
      return res.status(500).json({
        message: 'Failed to update recurring series safely. No classes were deleted.',
        error: genErr?.message || String(genErr),
      });
    }

    // Delete replaced children now that regeneration succeeded.
    // This prevents cancelled duplicates from remaining visible and prevents invoice rebuilds
    // from accidentally including the replaced (cancelled) rows.
    try {
      if (replacedChildIds.length > 0) {
        await Class.deleteMany({
          _id: { $in: replacedChildIds },
          parentRecurringClass: patternId,
          scheduledDate: { $gte: now },
          status: 'cancelled_by_admin',
          'cancellation.reason': 'Series updated',
        });
      }
    } catch (cleanupErr) {
      // Non-fatal: the update succeeded, but duplicates may remain until cleanup.
      console.warn('Failed to delete replaced recurring children after regeneration:', cleanupErr?.message || cleanupErr);
    }

    // 🔄 Update affected pending/unpaid invoices
    try {
      const studentId = pattern.student?.studentId || pattern.student?._id || pattern.student;
      const guardianId = pattern.student?.guardianId;
      
      if (guardianId && studentId) {
        console.log(`[Recurring Update] Checking for pending invoices to update for guardian ${guardianId}, student ${studentId}`);
        
        // Find pending/unpaid invoices that might be affected
        const affectedInvoices = await InvoiceModel.find({
          guardian: guardianId,
          'items.student': studentId,
          status: { $nin: ['paid', 'cancelled', 'refunded'] },
          deleted: { $ne: true }
        });
        
        if (affectedInvoices.length > 0) {
          console.log(`[Recurring Update] Found ${affectedInvoices.length} pending invoice(s) to update`);
          
          for (const invoice of affectedInvoices) {
            // Recalculate invoice items based on current class reality
            const billingStart = new Date(invoice.billingPeriod.start);
            const billingEnd = new Date(invoice.billingPeriod.end);
            
            // Find ALL classes (attended, missed, scheduled) within the billing period
            const currentClasses = await Class.find({
              'student.guardianId': guardianId,
              'student.studentId': studentId,
              scheduledDate: { $gte: billingStart, $lte: billingEnd },
              status: { $nin: ['pattern', 'cancelled', 'cancelled_by_admin', 'cancelled_by_teacher', 'cancelled_by_student', 'cancelled_by_guardian'] }
            })
              .select('_id subject scheduledDate duration student teacher status guardianRate')
              .lean();
            
            console.log(`[Recurring Update] Found ${currentClasses.length} classes within billing period (${billingStart.toISOString().slice(0,10)} to ${billingEnd.toISOString().slice(0,10)})`);
            
            // Resolve system default rate
            const SalarySettings = require('../models/SalarySettings');
            const salarySettings = await SalarySettings.getGlobalSettings();
            const systemDefaultRate = salarySettings?.defaultGuardianHourlyRate ?? 10;
            const guardianDoc = await User.findById(guardianId).select('guardianInfo.hourlyRate').lean();
            const guardianDefaultRate = guardianDoc?.guardianInfo?.hourlyRate || systemDefaultRate;

            // Rebuild items array — per-class rate resolution
            const newItems = currentClasses.map(cls => {
              const studentFullName = (cls.student && cls.student.studentName) || '';
              const [fn, ...rest] = String(studentFullName).trim().split(' ').filter(Boolean);
              const ln = rest.join(' ');
              const itemHours = (Number(cls.duration || 0) || 0) / 60;
              const rate = (cls.guardianRate != null) ? cls.guardianRate : guardianDefaultRate;
              
              return {
                lessonId: String(cls._id),
                class: cls._id,
                student: cls.student?.studentId || null,
                studentSnapshot: { firstName: fn || studentFullName || '', lastName: ln || '', email: '' },
                teacher: cls.teacher || null,
                description: `${cls.subject || 'Class'}`,
                date: cls.scheduledDate,
                duration: cls.duration,
                rate: rate,
                amount: Math.round((itemHours * rate) * 100) / 100,
                attended: cls.status === 'attended'
              };
            });
            
            // Update invoice
            const totalHours = newItems.reduce((sum, item) => sum + (item.duration / 60), 0);
            const subtotal = newItems.reduce((sum, item) => sum + (Number(item.amount || 0) || 0), 0);
            
            invoice.items = newItems;
            invoice.totalHours = totalHours;
            invoice.subtotal = subtotal;
            invoice.totalAmount = subtotal + (invoice.transferFee || 0);
            invoice.remaining = invoice.totalAmount - (invoice.paidAmount || 0);
            
            // Update billing period if needed (earliest to latest class)
            if (newItems.length > 0) {
              const dates = newItems.map(item => new Date(item.date)).sort((a, b) => a - b);
              invoice.billingPeriod = {
                start: dates[0],
                end: dates[dates.length - 1]
              };
            }
            
            // Add audit note - concise format
            const dayjs = require('dayjs');
            const adminName = req.user.profile?.firstName || 'Admin';
            const auditNote = `Updated by **${adminName}** • ${dayjs().format('MMM D, h:mm A')} • Pattern changed`;
            invoice.internalNote = invoice.internalNote 
              ? `${invoice.internalNote}\n${auditNote}`
              : auditNote;
            
            invoice.lastModifiedBy = req.user._id;
            invoice.lastModifiedAt = new Date();
            
            await invoice.save();
            
            // Mark classes as billed
            await Class.updateMany(
              { _id: { $in: newItems.map(item => item.class) } },
              { $set: { billedInInvoiceId: invoice._id } }
            );
            
            console.log(`[Recurring Update] ✅ Updated invoice ${invoice.friendlyNumber}: ${newItems.length} classes, ${totalHours}h, $${invoice.totalAmount}`);
          }
        } else {
          console.log(`[Recurring Update] No pending invoices found to update`);
        }
      }
    } catch (updateErr) {
      console.error('[Recurring Update] Failed to update invoices:', updateErr);
      // Don't fail the whole request if invoice update fails
    }

    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("class:updated", { class: pattern });
        newInstances.forEach(n => io.emit("class:created", { class: n }));
      }
    } catch (e) { console.warn("emit update recurring failed", e.message); }

    return res.json({ message: "Recurring pattern updated", classes: [enrichClassObj(pattern.toObject(), new Date()), ...newInstances.map(i => enrichClassObj(i.toObject(), new Date()))] });
  } catch (err) {
    console.error("PUT /classes/:id error:", err);
    return res.status(500).json({ message: "Failed to update class", error: err.message });
  }
});

/* -------------------------
   PUT /api/classes/:id/reschedule
   - Admin reschedules a single class instance
   ------------------------- */
router.put(
  "/:id/reschedule",
  authenticateToken,
  requireRole(["admin"]),
  [
    body("newDate").isISO8601().withMessage("New date must be a valid ISO 8601 string"),
    body("reason").trim().isLength({ min: 3 }).withMessage("Reason is required"),
    body("duration")
      .optional()
      .isInt({ min: 15, max: 180 })
      .withMessage("Duration must be between 15 and 180 minutes"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ message: "Validation failed", errors: errors.array() });
      }

      const classDoc = await Class.findById(req.params.id);
      if (!classDoc) {
        return res.status(404).json({ message: "Class not found" });
      }

      if (classDoc.status === "pattern") {
        return res.status(400).json({ message: "Cannot reschedule a recurring pattern directly" });
      }

      const newDate = new Date(req.body.newDate);
      if (Number.isNaN(newDate.getTime())) {
        return res.status(400).json({ message: "Invalid date provided" });
      }

      const minutes = typeof req.body.duration !== "undefined"
        ? Number(req.body.duration)
        : Number(classDoc.duration || 60);

      if (!Number.isFinite(minutes)) {
        return res.status(400).json({ message: "Duration must be a valid number" });
      }

      if (minutes < 15 || minutes > 180) {
        return res.status(400).json({ message: "Duration must be between 15 and 180 minutes" });
      }

      classDoc.duration = minutes;
      classDoc.lastModifiedBy = req.user._id;
      classDoc.lastModifiedAt = new Date();

      if (req.body.meetingLink !== undefined) {
        classDoc.meetingLink = req.body.meetingLink || null;
      }

      const prevDate = classDoc.scheduledDate;
      const savedClass = await classDoc.reschedule(newDate, req.body.reason.trim(), req.user._id);

      const populated = await Class.findById(savedClass._id)
        .populate("teacher", "firstName lastName email phone profilePicture")
        .populate("student.guardianId", "firstName lastName email phone");

      try {
        const notificationService = require('../services/notificationService');
        notificationService.notifyClassEvent({
          classObj: populated,
          eventType: 'rescheduled',
          actor: req.user,
          oldDate: prevDate
        }).catch(console.error);
      } catch (e) {
        console.warn("Notification trigger failed", e.message);
      }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("class:updated", { class: populated });
        }
      } catch (e) {
        console.warn("Socket emit reschedule failed", e.message);
      }

      return res.json({
        message: "Class rescheduled",
        class: enrichClassObj(populated.toObject(), new Date())
      });
    } catch (err) {
      console.error("PUT /classes/:id/reschedule error:", err);
      if (err?.name === "ValidationError") {
        const details = Object.values(err.errors || {}).map((e) => e.message);
        return res.status(400).json({
          message: details[0] || "Validation failed",
          details
        });
      }
      return res.status(500).json({ message: "Failed to reschedule class", error: err.message });
    }
  }
);

/* -------------------------
   DELETE /api/classes/:id?scope=single|future|all
   ------------------------- */
router.delete("/:id", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const scope = req.query.scope || req.query.deleteType || "single";
    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) {
      // Idempotent delete: if the class is already gone, try best-effort series delete
      // for future/past/all scopes using the provided id as a parentRecurringClass.
      if (scope === "future" || scope === "past" || scope === "all") {
        const parentId = req.params.id;
        const now = new Date();
        const dateFilter = scope === "past"
          ? { $lt: now }
          : (scope === "future" ? { $gte: now } : undefined);

        const filter = dateFilter
          ? { parentRecurringClass: parentId, scheduledDate: dateFilter }
          : { parentRecurringClass: parentId };

        const toDelete = await Class.find(filter).lean();
        const ids = toDelete.map((d) => d._id);
        // Save to trash before deleting
        await saveMultipleToTrash({
          itemType: 'class',
          docs: toDelete,
          labelFn: (s) => `${s.subject || 'Class'} — ${s.scheduledDate ? new Date(s.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`,
          metaFn: (s) => ({ subject: s.subject, scheduledDate: s.scheduledDate, duration: s.duration }),
          userId: req.user._id,
        });
        const result = await Class.deleteMany(filter);
        try {
          const io = req.app.get("io");
          if (io && ids.length) io.emit("class:deleted", { ids, parentId, scope });
        } catch (e) {}

        return res.json({
          message: result.deletedCount
            ? `Deleted ${result.deletedCount} class(es)`
            : "Class already deleted",
          count: result.deletedCount || 0,
          deletedIds: ids,
        });
      }

      return res.json({ message: "Class already deleted" });
    }
    const teacherId = classDoc.teacher;
    const guardianId = classDoc.student?.guardianId;
    const studentId = classDoc.student?.studentId;

    if (scope === "single") {
      // If class is billed in a paid invoice, create a credit adjustment before deletion
      if (classDoc.billedInInvoiceId) {
        try {
          const Invoice = require('../models/Invoice');
          const billedInvoice = await Invoice.findById(classDoc.billedInInvoiceId).select('status paidAmount').lean();
          if (billedInvoice && (billedInvoice.status === 'paid' || billedInvoice.paidAmount > 0)) {
            const guardian = await User.findById(guardianId).select('guardianInfo.hourlyRate').lean();
            const rate = guardian?.guardianInfo?.hourlyRate || 10;
            const classDuration = Number(classDoc.duration || 60);
            const classHours = classDuration / 60;
            const amount = Math.round((classHours * rate) * 100) / 100;
            const dateStr = classDoc.scheduledDate
              ? new Date(classDoc.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'unknown date';
            await InvoiceService.createPaidInvoiceAdjustment({
              invoiceId: classDoc.billedInInvoiceId,
              type: 'credit',
              reason: 'class_deleted',
              classDoc,
              description: `Class on ${dateStr} (${classDoc.subject || 'Class'}) deleted — ${classHours.toFixed(2)}h credit`,
              hoursDelta: -classHours,
              amountDelta: -amount,
              previousDuration: classDuration,
              actorId: req.user._id
            });
          }
        } catch (adjErr) {
          console.error('Failed to create paid invoice adjustment for deleted class:', adjErr.message);
        }
      }

      // Save to trash before deleting
      await saveToTrash({
        itemType: 'class',
        doc: classDoc,
        label: `${classDoc.subject || 'Class'} — ${classDoc.scheduledDate ? new Date(classDoc.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`,
        meta: {
          subject: classDoc.subject,
          teacherName: classDoc.teacher?.toString(),
          scheduledDate: classDoc.scheduledDate,
          duration: classDoc.duration,
        },
        userId: req.user._id,
      });

      await Class.findByIdAndDelete(classDoc._id);
      // Notification trigger: class cancelled
      try {
        const notificationService = require('../services/notificationService');
        notificationService.notifyClassEvent({
          classObj: classDoc,
          eventType: 'cancelled',
          actor: req.user
        }).catch(console.error);
      } catch (e) { console.warn("Notification trigger failed", e.message); }
      try { const io = req.app.get("io"); if (io) io.emit("class:deleted", { id: classDoc._id }); } catch (e) {}
      await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);
      return res.json({ message: "Class deleted (single instance)" });
    }

    if (scope === "future") {
      const parentId = classDoc.parentRecurringClass || classDoc._id;
      const baseDate = classDoc.scheduledDate || new Date();
      const toDelete = await Class.find({ parentRecurringClass: parentId, scheduledDate: { $gte: baseDate } }).lean();
      // Create adjustments for any classes billed in paid invoices
      try {
        const Invoice = require('../models/Invoice');
        const billedClasses = toDelete.filter(c => c.billedInInvoiceId);
        for (const cls of billedClasses) {
          const inv = await Invoice.findById(cls.billedInInvoiceId).select('status paidAmount').lean();
          if (inv && (inv.status === 'paid' || inv.paidAmount > 0)) {
            const gDoc = await User.findById(cls.student?.guardianId).select('guardianInfo.hourlyRate').lean();
            const rate = gDoc?.guardianInfo?.hourlyRate || 10;
            const dur = Number(cls.duration || 60);
            const hrs = dur / 60;
            const amt = Math.round((hrs * rate) * 100) / 100;
            const dateStr = cls.scheduledDate ? new Date(cls.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown date';
            await InvoiceService.createPaidInvoiceAdjustment({
              invoiceId: cls.billedInInvoiceId, type: 'credit', reason: 'class_deleted', classDoc: cls,
              description: `Class on ${dateStr} (${cls.subject || 'Class'}) deleted — ${hrs.toFixed(2)}h credit`,
              hoursDelta: -hrs, amountDelta: -amt, previousDuration: dur, actorId: req.user._id
            });
          }
        }
      } catch (adjErr) { console.error('Bulk delete adjustment error (future):', adjErr.message); }
      // Save all to trash before deleting
      await saveMultipleToTrash({
        itemType: 'class',
        docs: toDelete,
        labelFn: (s) => `${s.subject || 'Class'} — ${s.scheduledDate ? new Date(s.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`,
        metaFn: (s) => ({ subject: s.subject, scheduledDate: s.scheduledDate, duration: s.duration }),
        userId: req.user._id,
      });
      const ids = toDelete.map(d => d._id);
      const result = await Class.deleteMany({ parentRecurringClass: parentId, scheduledDate: { $gte: baseDate } });
      try { const io = req.app.get("io"); if (io) io.emit("class:deleted", { ids, parentId }); } catch (e) {}
      await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);
      return res.json({ message: `Deleted ${result.deletedCount} future class(es)`, count: result.deletedCount, deletedIds: ids });
    }

    if (scope === "past") {
      const parentId = classDoc.parentRecurringClass || classDoc._id;
      const baseDate = classDoc.scheduledDate ? new Date(classDoc.scheduledDate) : null;

      if (!baseDate || Number.isNaN(baseDate.getTime())) {
        return res.status(400).json({ message: "Reference class is missing a scheduled date, cannot determine previous classes" });
      }

      const toDelete = await Class.find({ parentRecurringClass: parentId, scheduledDate: { $lt: baseDate } }).lean();
      // Create adjustments for any classes billed in paid invoices
      try {
        const Invoice = require('../models/Invoice');
        const billedClasses = toDelete.filter(c => c.billedInInvoiceId);
        for (const cls of billedClasses) {
          const inv = await Invoice.findById(cls.billedInInvoiceId).select('status paidAmount').lean();
          if (inv && (inv.status === 'paid' || inv.paidAmount > 0)) {
            const gDoc = await User.findById(cls.student?.guardianId).select('guardianInfo.hourlyRate').lean();
            const rate = gDoc?.guardianInfo?.hourlyRate || 10;
            const dur = Number(cls.duration || 60);
            const hrs = dur / 60;
            const amt = Math.round((hrs * rate) * 100) / 100;
            const dateStr = cls.scheduledDate ? new Date(cls.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown date';
            await InvoiceService.createPaidInvoiceAdjustment({
              invoiceId: cls.billedInInvoiceId, type: 'credit', reason: 'class_deleted', classDoc: cls,
              description: `Class on ${dateStr} (${cls.subject || 'Class'}) deleted — ${hrs.toFixed(2)}h credit`,
              hoursDelta: -hrs, amountDelta: -amt, previousDuration: dur, actorId: req.user._id
            });
          }
        }
      } catch (adjErr) { console.error('Bulk delete adjustment error (past):', adjErr.message); }
      await saveMultipleToTrash({
        itemType: 'class',
        docs: toDelete,
        labelFn: (s) => `${s.subject || 'Class'} — ${s.scheduledDate ? new Date(s.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`,
        metaFn: (s) => ({ subject: s.subject, scheduledDate: s.scheduledDate, duration: s.duration }),
        userId: req.user._id,
      });
      const ids = toDelete.map((d) => d._id);
      const result = await Class.deleteMany({ parentRecurringClass: parentId, scheduledDate: { $lt: baseDate } });
      try { const io = req.app.get("io"); if (io) io.emit("class:deleted", { ids, parentId, scope: "past" }); } catch (e) {}
      await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);
      return res.json({ message: `Deleted ${result.deletedCount} past class(es)`, count: result.deletedCount, deletedIds: ids });
    }

    if (scope === "all") {
      const parentId = classDoc.parentRecurringClass || classDoc._id;
      const children = await Class.find({ parentRecurringClass: parentId }).lean();
      // Create adjustments for any classes billed in paid invoices
      try {
        const Invoice = require('../models/Invoice');
        const billedClasses = children.filter(c => c.billedInInvoiceId);
        for (const cls of billedClasses) {
          const inv = await Invoice.findById(cls.billedInInvoiceId).select('status paidAmount').lean();
          if (inv && (inv.status === 'paid' || inv.paidAmount > 0)) {
            const gDoc = await User.findById(cls.student?.guardianId).select('guardianInfo.hourlyRate').lean();
            const rate = gDoc?.guardianInfo?.hourlyRate || 10;
            const dur = Number(cls.duration || 60);
            const hrs = dur / 60;
            const amt = Math.round((hrs * rate) * 100) / 100;
            const dateStr = cls.scheduledDate ? new Date(cls.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown date';
            await InvoiceService.createPaidInvoiceAdjustment({
              invoiceId: cls.billedInInvoiceId, type: 'credit', reason: 'class_deleted', classDoc: cls,
              description: `Class on ${dateStr} (${cls.subject || 'Class'}) deleted — ${hrs.toFixed(2)}h credit`,
              hoursDelta: -hrs, amountDelta: -amt, previousDuration: dur, actorId: req.user._id
            });
          }
        }
      } catch (adjErr) { console.error('Bulk delete adjustment error (all):', adjErr.message); }
      // Save parent + children to trash
      const allDocs = [classDoc.toObject ? classDoc.toObject() : classDoc, ...children];
      await saveMultipleToTrash({
        itemType: 'class',
        docs: allDocs,
        labelFn: (s) => `${s.subject || 'Class'} — ${s.scheduledDate ? new Date(s.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`,
        metaFn: (s) => ({ subject: s.subject, scheduledDate: s.scheduledDate, duration: s.duration }),
        userId: req.user._id,
      });
      const childIds = children.map(c => c._id);
      const result = await Class.deleteMany({ parentRecurringClass: parentId });
      await Class.findByIdAndDelete(parentId);
      try { const io = req.app.get("io"); if (io) io.emit("class:deleted", { parentId, childrenIds: childIds }); } catch (e) {}
      await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);
      return res.json({ message: `Deleted series (pattern + ${result.deletedCount} classes)`, count: result.deletedCount + 1 });
    }

    return res.status(400).json({ message: "Invalid scope. Use single | future | past | all" });
  } catch (err) {
    console.error("DELETE /classes/:id error:", err);
    return res.status(500).json({ message: "Failed to delete class", error: err.message });
  }
});

/* -------------------------
   PUT /api/classes/:id/unsubmit-report
   Admin-only: reverts a submitted class report as if it was never submitted.
   - Restores guardian hours that were consumed
   - Subtracts teacher hours that were credited
   - If the class belongs to a past month with an existing TeacherInvoice,
     adds a deduction entry with explanatory note
   - Archives the existing report in classReportHistory
   - Resets class status to 'scheduled' and reportSubmission to 'pending'
   ------------------------- */
router.put("/:id/unsubmit-report", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: "Class not found" });

    const isCountable = (s) => ['attended', 'missed_by_student', 'absent'].includes(s);
    if (!isCountable(classDoc.status)) {
      return res.status(400).json({
        message: "This class does not have a submitted report that affects hours"
      });
    }

    if (!classDoc.classReport?.submittedAt) {
      return res.status(400).json({ message: "No submitted report to revert" });
    }

    const adminReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';

    // Archive the current report into history before clearing
    if (!Array.isArray(classDoc.classReportHistory)) {
      classDoc.classReportHistory = [];
    }
    classDoc.classReportHistory.push({
      snapshot: JSON.parse(JSON.stringify(classDoc.classReport)),
      editedAt: new Date(),
      editedBy: req.user._id,
      note: `Unsubmitted by admin${adminReason ? ': ' + adminReason : ''}`,
    });
    if (classDoc.classReportHistory.length > 20) {
      classDoc.classReportHistory = classDoc.classReportHistory.slice(-20);
    }
    classDoc.markModified("classReportHistory");

    // Determine the class month/year for teacher invoice adjustment
    const classDate = classDoc.scheduledDate ? new Date(classDoc.scheduledDate) : null;
    const classMonth = classDate ? classDate.getUTCMonth() + 1 : null;
    const classYear = classDate ? classDate.getUTCFullYear() : null;
    const now = new Date();
    const currentMonth = now.getUTCMonth() + 1;
    const currentYear = now.getUTCFullYear();
    const isCrossMonth = classMonth !== null && (classMonth !== currentMonth || classYear !== currentYear);
    const classDuration = Number(classDoc.duration || 60);
    const classHours = classDuration / 60;

    // Clear the report — status change to 'scheduled' triggers the post-save
    // hook which calls onClassStateChanged (countable→non-countable) to:
    //   - subtract teacher hours (current month counter)
    //   - restore guardian hours
    classDoc.classReport = undefined;
    classDoc.markModified("classReport");

    // Reset status back to scheduled — this is the key transition that
    // triggers hour reversal via the post-save hook
    classDoc.status = "scheduled";

    // Reset attendance
    classDoc.attendance = {};
    classDoc.markModified("attendance");

    // Reset report submission tracking
    if (!classDoc.reportSubmission) classDoc.reportSubmission = {};
    classDoc.reportSubmission.status = 'pending';
    classDoc.reportSubmission.markedUnreportedAt = undefined;
    classDoc.reportSubmission.markedUnreportedBy = undefined;
    classDoc.markModified("reportSubmission");

    // Clear cancellation if it was a teacher/student cancellation
    if (classDoc.cancellation) {
      classDoc.cancellation = undefined;
      classDoc.markModified("cancellation");
    }

    classDoc.lastModifiedBy = req.user._id;
    classDoc.lastModifiedAt = new Date();

    await classDoc.save();

    // Handle cross-month teacher invoice adjustments:
    // When a report from a past month is unsubmitted, the teacher's live
    // monthlyHours counter (which tracks the *current* month) gets decreased
    // by onClassStateChanged. But the real accounting impact is on the month
    // the class belongs to. If that month already has a TeacherInvoice we
    // need to record the deduction there.
    if (isCrossMonth && classDoc.teacher) {
      try {
        const TeacherInvoice = require('../models/TeacherInvoice');
        const dayjs = require('dayjs');
        const monthLabel = dayjs.utc(`${classYear}-${String(classMonth).padStart(2, '0')}-01`).format('MMM YYYY');

        // Find the teacher invoice for the month the class belongs to
        const teacherInvoice = await TeacherInvoice.findOne({
          teacher: classDoc.teacher,
          month: classMonth,
          year: classYear,
          isAdjustment: { $ne: true },
          deleted: { $ne: true },
        });

        if (teacherInvoice) {
          // Remove the class from the invoice's classIds
          const classIdStr = String(classDoc._id);
          teacherInvoice.classIds = (teacherInvoice.classIds || []).filter(
            (id) => String(id) !== classIdStr
          );

          // Decrease totalHours
          teacherInvoice.totalHours = Math.max(
            0,
            (teacherInvoice.totalHours || 0) - classHours
          );

          // Add a deduction extra to leave an audit trail
          const deductionReason =
            `Report unsubmitted for class on ${dayjs.utc(classDate).format('MMM D, YYYY')} ` +
            `(${classHours.toFixed(2)}h)` +
            (adminReason ? ` — ${adminReason}` : '');

          if (typeof teacherInvoice.addExtra === 'function') {
            teacherInvoice.addExtra({
              category: 'penalty',
              amountUSD: 0,
              reason: deductionReason,
              addedBy: req.user._id,
            });
          } else {
            if (!Array.isArray(teacherInvoice.extras)) teacherInvoice.extras = [];
            teacherInvoice.extras.push({
              category: 'penalty',
              amountUSD: 0,
              reason: deductionReason,
              addedAt: new Date(),
              addedBy: req.user._id,
            });
          }

          // Append an internal note explaining the discrepancy
          const note =
            `[Auto] Class unsubmitted (${monthLabel}): -${classHours.toFixed(2)}h. ` +
            `The class list may show more entries than the total hours because ` +
            `this class was unsubmitted after the invoice was generated.` +
            (adminReason ? ` Reason: ${adminReason}` : '');
          teacherInvoice.internalNotes = teacherInvoice.internalNotes
            ? teacherInvoice.internalNotes + '\n' + note
            : note;

          // Record in change history
          if (!Array.isArray(teacherInvoice.changeHistory)) teacherInvoice.changeHistory = [];
          teacherInvoice.changeHistory.push({
            changedAt: new Date(),
            changedBy: req.user._id,
            action: 'unsubmit_class',
            field: 'totalHours',
            oldValue: String((teacherInvoice.totalHours + classHours).toFixed(3)),
            newValue: String(teacherInvoice.totalHours.toFixed(3)),
            note: deductionReason,
          });

          // Recalculate amounts if the invoice is still in draft
          if (teacherInvoice.status === 'draft' && typeof teacherInvoice.calculateAmounts === 'function') {
            teacherInvoice.calculateAmounts();
          }

          teacherInvoice.updatedBy = req.user._id;
          await teacherInvoice.save();

          // Undo the incorrect current-month teacher hours adjustment that
          // onClassStateChanged applied. The post-save hook subtracts hours
          // from the teacher's live monthlyHours (which tracks the current
          // month), but the class belongs to a different month. We add the
          // hours back so the current month counter stays correct.
          try {
            const teacher = await User.findById(classDoc.teacher);
            if (teacher && teacher.role === 'teacher') {
              await teacher.addTeachingHours(classHours);
            }
          } catch (revertErr) {
            console.warn('[unsubmit-report] Failed to revert current-month teacher hours:', revertErr?.message);
          }
        }
      } catch (tiErr) {
        console.warn('[unsubmit-report] Teacher invoice adjustment failed:', tiErr?.message || tiErr);
      }
    }

    // Emit socket events
    try {
      const io = req.app.get("io");
      if (io) {
        io.emit("class:reportUnsubmitted", { classId: classDoc._id, class: classDoc });
        io.emit("class:updated", { classId: classDoc._id, class: classDoc });
      }
    } catch (e) {
      console.warn("[unsubmit-report] Socket emit error:", e.message);
    }

    const responseClass = sanitizeClassForRole(classDoc.toObject({ virtuals: true }), req.user?.role);
    res.json({ message: "Report unsubmitted successfully", class: responseClass });
  } catch (err) {
    console.error("[unsubmit-report] Error:", err);
    res.status(500).json({ message: "Failed to unsubmit report", error: err.message });
  }
});

/* -------------------------
   PUT /api/classes/:id/report
   Teacher/Admin submits report -> mark reportSubmitted & completedAt
   ------------------------- */
/* -------------------------
   PUT /api/classes/:id/report
   Teacher/Admin submits report -> mark reportSubmitted & completedAt
   - Enforces teacher submission window: after class end and within 60 hours
   - Teacher edit allowed within 24 hours of submission
   - Saves report into classDoc.classReport (subjects array supported)
   - Updates teacher hours and guardian hours and creates a minimal invoice if needed
   - Emits socket events for frontend/admin
   ------------------------- */
// PUT /classes/:id/report
router.put("/:id/report", authenticateToken, requireRole(["admin", "teacher"]), async (req, res) => {
  console.log("✅ Connected to MongoDB successfully");
  console.log("➡️ Starting report submission...");
  console.log("📥 Payload received:", req.body);

  try {
  const payload = req.body;
  const classDoc = await Class.findById(req.params.id);
    if (!classDoc) return res.status(404).json({ message: "Class not found" });
    console.log("✅ Loaded classDoc:", classDoc._id);

    const { teacherId, guardianId, studentId } = extractParticipantIds(classDoc);

    const now = new Date();
    const scheduled = new Date(classDoc.scheduledDate);
    const classEnd = new Date(scheduled.getTime() + (Number(classDoc.duration || 0) * 60000));

    const isAdminUser = req.user.role === "admin";
    const isTeacherUser = req.user.role === "teacher" && String(classDoc.teacher) === String(req.user._id);
    console.log("👤 User role:", req.user.role, "isAdmin?", isAdminUser, "isTeacher?", isTeacherUser);

    if (!isAdminUser && !isTeacherUser) return res.status(403).json({ message: "Not allowed to submit report" });

    // Check submission eligibility using the service (teachers only, admins bypass)
    if (isTeacherUser) {
      const ReportSubmissionService = require('../services/reportSubmissionService');
      const eligibility = await ReportSubmissionService.canTeacherSubmit(req.params.id, req.user._id);
      
      if (!eligibility.canSubmit) {
        return res.status(403).json({ 
          message: eligibility.reason,
          isUnreported: eligibility.isUnreported,
          isSubmitted: eligibility.isSubmitted
        });
      }
    }

    // ✅ Map incoming payload → classReport
    console.log("📝 Mapping payload → classReport");
    console.log("🧐 Raw attendance type:", typeof payload.attendance, "value:", payload.attendance);
    console.log("🧐 Raw countAbsentForBilling type:", typeof payload.countAbsentForBilling, "value:", payload.countAbsentForBilling);

    const attendanceOptions = new Set(["attended", "missed_by_student", "cancelled_by_teacher", "cancelled_by_student", "no_show_both"]);
    const attendanceValue = attendanceOptions.has(payload.attendance) ? payload.attendance : "attended";

    const rawSubject = typeof payload.subject === "string" ? payload.subject.trim() : "";
    const subjectsArray = Array.isArray(payload.subjects)
      ? payload.subjects
          .map((subject) => (typeof subject === "string" ? subject.trim() : ""))
          .filter(Boolean)
      : [];
    if (!subjectsArray.length && rawSubject) {
      subjectsArray.push(rawSubject);
    }

    const surahName = typeof payload.surahName === "string" ? payload.surahName.trim() : "";
    const verseInput = payload.verseEnd ?? payload.verseNumber ?? payload?.surah?.verse;
    const parsedVerse =
      verseInput === null || typeof verseInput === "undefined" || verseInput === ""
        ? null
        : Number(verseInput);
    const verseEnd = Number.isFinite(parsedVerse) && parsedVerse > 0 ? Number(parsedVerse) : undefined;

    const lessonTopic = typeof payload.lessonTopic === "string" ? payload.lessonTopic.trim() : "";
    const customLessonTopic = typeof payload.customLessonTopic === "string" ? payload.customLessonTopic.trim() : "";
    const teacherNotes = typeof payload.teacherNotes === "string" ? payload.teacherNotes.trim() : "";
    const supervisorNotes = typeof payload.supervisorNotes === "string" ? payload.supervisorNotes.trim() : "";
    const newAssignment = typeof payload.newAssignment === "string" ? payload.newAssignment.trim() : "";
    const previousAssignmentEvaluation = typeof payload.previousAssignmentEvaluation === "string"
      ? payload.previousAssignmentEvaluation.trim()
      : "";
    const recitedQuran =
      payload.recitedQuran ?? payload.quranRecitation ?? classDoc.classReport?.recitedQuran ?? "";

    const incomingScore = Number(payload.classScore);
    const hasIncomingScore = Number.isFinite(incomingScore) && incomingScore > 0;
    const classScore = attendanceValue === "attended"
      ? (hasIncomingScore
          ? incomingScore
          : Number.isFinite(Number(classDoc.classReport?.classScore))
            ? Number(classDoc.classReport.classScore)
            : 0)
      : 0;

    const absenceExcused = typeof payload.absenceExcused !== "undefined"
      ? Boolean(payload.absenceExcused)
      : Boolean(classDoc.classReport?.absenceExcused) || false;

    const countAbsentForBilling = attendanceValue === "missed_by_student"
      ? Boolean(payload.countAbsentForBilling)
      : false;

    const cancellationReason = typeof payload.cancellationReason === "string"
      ? payload.cancellationReason.trim()
      : "";

    let reportPayload = { attendance: attendanceValue };

    if (attendanceValue === "attended") {
      const effectiveSubject = rawSubject || classDoc.classReport?.subject || classDoc.subject || "";
      const effectiveTopic = (customLessonTopic || lessonTopic || "").trim();
      if (isTeacherUser) {
        if (!effectiveSubject) {
          return res.status(400).json({ message: "Subject is required", error: "SUBJECT_REQUIRED" });
        }
        if (!effectiveTopic) {
          return res.status(400).json({ message: "Lesson topic is required", error: "LESSON_TOPIC_REQUIRED" });
        }
        if (!hasIncomingScore && !Number.isFinite(Number(classDoc.classReport?.classScore))) {
          return res.status(400).json({ message: "Class performance is required", error: "CLASS_SCORE_REQUIRED" });
        }
      }
      reportPayload = {
        attendance: attendanceValue,
        absenceExcused,
        countAbsentForBilling,
        classScore,
      };

      if (subjectsArray.length) reportPayload.subjects = subjectsArray;
      if (effectiveSubject) reportPayload.subject = effectiveSubject;
      if (lessonTopic) reportPayload.lessonTopic = lessonTopic;
      if (customLessonTopic) reportPayload.customLessonTopic = customLessonTopic;
      if (teacherNotes) reportPayload.teacherNotes = teacherNotes;
      if (supervisorNotes) reportPayload.supervisorNotes = supervisorNotes;
      if (newAssignment) reportPayload.newAssignment = newAssignment;
      if (previousAssignmentEvaluation) reportPayload.previousAssignmentEvaluation = previousAssignmentEvaluation;
      if (recitedQuran) {
        reportPayload.recitedQuran = recitedQuran;
        reportPayload.quranRecitation = recitedQuran;
      }
      if (surahName || typeof verseEnd !== "undefined") {
        reportPayload.surah = {};
        if (surahName) reportPayload.surah.name = surahName;
        if (typeof verseEnd !== "undefined") reportPayload.surah.verse = verseEnd;
      }
      if (typeof verseEnd !== "undefined") reportPayload.verseEnd = verseEnd;
    } else if (attendanceValue === "missed_by_student") {
      reportPayload = {
        attendance: attendanceValue,
        countAbsentForBilling,
        absenceExcused,
        classScore,
      };
    } else if (attendanceValue === "cancelled_by_teacher" || attendanceValue === "cancelled_by_student") {
      if (!cancellationReason) {
        return res.status(400).json({
          message: "Cancellation reason is required",
          error: "CANCELLATION_REASON_REQUIRED",
        });
      }

      reportPayload = {
        attendance: attendanceValue,
        classScore,
      };

      classDoc.cancellation = classDoc.cancellation || {};
      classDoc.cancellation.reason = cancellationReason;
      classDoc.cancellation.cancelledAt = now;
      classDoc.cancellation.cancelledBy = req.user._id;
      classDoc.markModified("cancellation");
    } else {
      // For other non-attended states (e.g., no_show_both), keep minimal payload
      reportPayload = {
        attendance: attendanceValue,
        classScore,
      };
    }

    const previousReport = classDoc.classReport
      ? JSON.parse(JSON.stringify(classDoc.classReport))
      : null;
    const isFirstSubmission = !previousReport || !previousReport.submittedAt;
    const editNote = typeof payload.editNote === "string" ? payload.editNote.trim() : "";

    if (isFirstSubmission) {
      reportPayload.submittedAt = now;
      reportPayload.submittedBy = req.user._id;
    } else {
      reportPayload.submittedAt = previousReport.submittedAt
        ? new Date(previousReport.submittedAt)
        : now;
      reportPayload.submittedBy = previousReport.submittedBy || req.user._id;
      reportPayload.lastEditedAt = now;
      reportPayload.lastEditedBy = req.user._id;
    }

    if (previousReport) {
      if (!Array.isArray(classDoc.classReportHistory)) {
        classDoc.classReportHistory = [];
      }
      classDoc.classReportHistory.push({
        snapshot: previousReport,
        editedAt: now,
        editedBy: req.user._id,
        note: editNote || undefined,
      });
      if (classDoc.classReportHistory.length > 20) {
        classDoc.classReportHistory = classDoc.classReportHistory.slice(-20);
      }
      classDoc.markModified("classReportHistory");
    }

    classDoc.classReport = reportPayload;
    classDoc.markModified("classReport");

    console.log("✅ classReport normalized:", JSON.stringify(classDoc.classReport, null, 2));
    console.log("🗒️ class status before save:", {
      classId: classDoc._id,
      status: classDoc.status,
      attendance: classDoc.classReport.attendance,
      billing: classDoc.classReport.countAbsentForBilling,
    });

    // ✅ Attendance summary
    console.log("📊 Updating attendance summary...");
    classDoc.attendance = classDoc.attendance || {};
    classDoc.attendance.markedAt = now;
    classDoc.attendance.markedBy = req.user._id;

    classDoc.lastModifiedBy = req.user._id;
    classDoc.lastModifiedAt = now;

    if (attendanceValue === "attended") {
      classDoc.attendance.teacherPresent = true;
      classDoc.attendance.studentPresent = true;
      classDoc.status = "attended";
    } else if (attendanceValue === "missed_by_student") {
      classDoc.attendance.teacherPresent = true;
      classDoc.attendance.studentPresent = false;
      classDoc.status = "missed_by_student";
    } else if (attendanceValue === "cancelled_by_teacher") {
      classDoc.attendance.teacherPresent = false;
      classDoc.attendance.studentPresent = true;
      classDoc.status = "cancelled_by_teacher";
    } else if (attendanceValue === "cancelled_by_student") {
      classDoc.attendance.teacherPresent = true;
      classDoc.attendance.studentPresent = false;
      classDoc.status = "cancelled_by_student";
    } else if (attendanceValue === "no_show_both") {
      classDoc.attendance.teacherPresent = false;
      classDoc.attendance.studentPresent = false;
      classDoc.status = "no_show_both";
    }

    // Update report submission status to 'submitted'
    if (!classDoc.reportSubmission) {
      classDoc.reportSubmission = {};
    }
    classDoc.reportSubmission.status = 'submitted';

    classDoc.markModified("attendance");
    classDoc.markModified("reportSubmission");

    try {
      await classDoc.save();
      console.log("💾 class report saved", {
        classId: classDoc._id,
        status: classDoc.status,
        attendance: classDoc.attendance,
      });
    } catch (saveErr) {
      console.error("❌ Error saving class report", {
        classId: classDoc._id,
        message: saveErr.message,
        stack: saveErr.stack,
      });
      throw saveErr;
    }
    console.log("✅ Class saved with report and attendance");

    // ✅ Emit socket event
    try {
      const io = req.app.get("io");
      if (io) {
        console.log("📡 Emitting socket: class:reportSubmitted");
        io.emit("class:reportSubmitted", { classId: classDoc._id, class: classDoc });
      }
    } catch (e) {
      console.warn("⚠️ Socket emit error (reportSubmitted):", e.message);
    }

    const responseClass = sanitizeClassForRole(classDoc.toObject({ virtuals: true }), req.user?.role);
    const responsePayload = { message: "Report submitted", class: responseClass };

    setImmediate(async () => {
      if (classDoc.classReport.supervisorNotes?.length > 0) {
        try {
          const io = req.app.get("io");
          if (io) {
            console.log("📡 Emitting socket: admin:supervisorNote");
            io.emit("admin:supervisorNote", {
              classId: classDoc._id,
              supervisorNotes: classDoc.classReport.supervisorNotes,
              teacherId: req.user._id,
              classTitle: classDoc.title || "",
            });
          }
        } catch (e) {
          console.warn("⚠️ Socket emit error (supervisorNote):", e.message);
        }

        try {
          const notificationService = require("../services/notificationService");
          const { formatTimeInTimezone, DEFAULT_TIMEZONE } = require("../utils/timezoneUtils");
          const admins = await User.find({ role: "admin", isActive: true }).select("_id");
          const teacherName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email || "Teacher";
          const studentName = classDoc.student?.studentName || "student";
          const subjectLabel = classDoc.subject ? ` (${classDoc.subject})` : "";
          const classTime = classDoc.scheduledDate
            ? formatTimeInTimezone(classDoc.scheduledDate, DEFAULT_TIMEZONE, "DD MMM YYYY hh:mm A")
            : null;
          const actionLink = `/dashboard/classes?tab=previous&open=${classDoc._id}`;

          await Promise.allSettled((admins || []).map((admin) => (
            notificationService.createNotification({
              userId: admin._id,
              title: "Supervisor note submitted",
              message: `${teacherName} left supervisor notes for ${studentName}${subjectLabel}${classTime ? ` on ${classTime}` : ''}.`,
              type: "class",
              relatedTo: "class",
              relatedId: classDoc._id,
              actionRequired: true,
              actionLink,
              metadata: {
                kind: "class_supervisor_note",
                classId: String(classDoc._id),
                teacherId: String(req.user._id)
              }
            })
          )));
        } catch (notifyErr) {
          console.warn("⚠️ Failed to notify admins about supervisor notes:", notifyErr.message);
        }
      }

      // Low-score follow-up: only trigger when the CURRENT report score is low
      const LOW_SCORE_THRESHOLD = 2;
      if (isFirstSubmission && attendanceValue === 'attended' && Number.isFinite(Number(classScore)) && Number(classScore) >= 1 && Number(classScore) <= LOW_SCORE_THRESHOLD) {
        try {
          const LOW_SCORE_WINDOW = 3;
          const LOW_SCORE_MIN_OCCURRENCES = 2;
          const studentIdValue = classDoc.student?.studentId;
          if (studentIdValue) {
            // Only look at scores within the last 60 days to avoid stale data
            const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000);
            const recentLowScores = await Class.find({
              'student.studentId': studentIdValue,
              'classReport.attendance': 'attended',
              'classReport.classScore': { $lte: LOW_SCORE_THRESHOLD },
              scheduledDate: { $gte: sixtyDaysAgo }
            })
              .sort({ scheduledDate: -1 })
              .limit(LOW_SCORE_WINDOW)
              .select('classReport.classScore scheduledDate subject teacher student')
              .lean();

            if ((recentLowScores || []).length >= LOW_SCORE_MIN_OCCURRENCES) {
              const notificationService = require("../services/notificationService");
              const admins = await User.find({ role: "admin", isActive: true }).select("_id");
              const studentName = classDoc.student?.studentName || 'student';
              const subjectLabel = classDoc.subject ? ` (${classDoc.subject})` : '';
              // Link to the class that was just reported (the actual low-score class)
              const actionLink = `/dashboard/classes?tab=previous&open=${classDoc._id}`;

              await Promise.allSettled((admins || []).map((admin) => (
                (async () => {
                  // Dedup: skip if a notification was already sent for this student in the last 30 days
                  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
                  const existing = await Notification.findOne({
                    user: admin._id,
                    "metadata.kind": "low_score_followup",
                    "metadata.studentId": String(studentIdValue),
                    createdAt: { $gte: thirtyDaysAgo }
                  }).select("_id");

                  if (existing) return null;

                  return notificationService.createNotification({
                    userId: admin._id,
                    title: 'Low performance follow-up',
                    message: `${studentName}${subjectLabel} scored ${classScore}/5. ${recentLowScores.length} low scores in recent classes.`,
                    type: 'warning',
                    relatedTo: 'class',
                    relatedId: classDoc._id,
                    actionRequired: true,
                    actionLink,
                    metadata: {
                      kind: 'low_score_followup',
                      classId: String(classDoc._id),
                      studentId: String(studentIdValue),
                      guardianId: guardianId ? String(guardianId) : undefined,
                      teacherId: teacherId ? String(teacherId) : undefined,
                    }
                  });
                })()
              )));
            }
          }
        } catch (lowScoreErr) {
          console.warn('[report] Failed to notify low score follow-up', lowScoreErr.message);
        }
      }

      if (isFirstSubmission) {
        try {
          const guardianUser = await User.findById(classDoc.student?.guardianId);
          if (guardianUser) {
            const studentId = classDoc.student?.studentId || null;
            const existingInvoice = await InvoiceModel.findOne({
              guardian: guardianUser._id,
              'items.student': studentId
            }).lean();

            if (!existingInvoice) {
              try {
                await InvoiceService.createInvoiceForFirstLesson(guardianUser, classDoc, { createdBy: req.user._id });
                try {
                  const io = req.app.get('io');
                  if (io) io.emit('guardian:invoiceCreated', { guardianId: guardianUser._id });
                } catch (emitErr) {
                  console.warn('Socket emit failed for first-lesson invoice', emitErr.message);
                }
              } catch (createErr) {
                console.warn('Failed to create first-lesson invoice:', createErr.message);
              }
            }
          }
        } catch (err) {
          console.warn('First-lesson invoice creation check failed:', err.message);
        }
      }

      try {
        await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);
      } catch (refreshErr) {
        console.warn("[report] Failed to refresh participant activity flags", refreshErr.message);
      }
    });

    return res.json(responsePayload);
  } catch (err) {
    console.error("❌ PUT /classes/:id/report error:", err);
    console.error("❌ PUT /classes/:id/report error (outer catch)", {
      message: err.message,
      stack: err.stack,
    });
    return res.status(500).json({ message: "Failed to submit report", error: err.message });
  }
});


/* -------------------------
   POST /api/classes/maintenance/generate-recurring
   Admin-only endpoint to run rolling generation
   ------------------------- */
router.post("/maintenance/generate-recurring", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const patterns = await Class.find({ isRecurring: true, status: "pattern" }).lean();
    let total = 0;
    for (const p of patterns) {
      const lastGenerated = p.recurrence?.lastGenerated ? new Date(p.recurrence.lastGenerated) : new Date(0);
      const daysSince = Math.floor((Date.now() - lastGenerated.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince >= 1) {
        const perDayMap = buildPerDayMap(p.recurrenceDetails || []);
        const created = await generateRecurringClasses(p, p.recurrence?.generationPeriodMonths || 2, perDayMap);
        total += created.length;
        try { const io = req.app.get("io"); if (io) created.forEach(c => io.emit("class:created", { class: c })); } catch (e) {}
      }
    }
    return res.json({ message: `Generated ${total} classes`, count: total });
  } catch (err) {
    console.error("maintenance error:", err);
    return res.status(500).json({ message: "Failed maintenance", error: err.message });
  }
});

/* -------------------------
   POST /api/classes/maintenance/recompute-activity
   Admin-only utility to manually refresh activity flags
   ------------------------- */
router.post("/maintenance/recompute-activity", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const teacherId = req.body.teacherId || null;
    const guardianId = req.body.guardianId || null;
    const studentId = req.body.studentId || null;

    if (!teacherId && !(guardianId && studentId)) {
      return res.status(400).json({
        message: "Provide a teacherId or both guardianId and studentId to refresh activity",
      });
    }

    await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);

    return res.json({
      message: "Activity flags refreshed",
      teacherId,
      guardianId,
      studentId,
    });
  } catch (err) {
    console.error("POST /classes/maintenance/recompute-activity error:", err);
    return res.status(500).json({ message: "Failed to refresh activity flags", error: err.message });
  }
});

/* -------------------------
   POST /api/classes/:id/grant-extension
   Admin grants extension for report submission
   ------------------------- */
router.post("/:id/grant-extension", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const ReportSubmissionService = require('../services/reportSubmissionService');
    const { extensionHours, reason } = req.body;
    
    const result = await ReportSubmissionService.grantAdminExtension(
      req.params.id,
      req.user._id,
      extensionHours,
      reason
    );
    
    if (!result.success) {
      return res.status(400).json({ message: result.error });
    }
    
    return res.json({
      message: result.message,
      expiresAt: result.expiresAt,
      extensionHours: result.extensionHours,
    });
  } catch (err) {
    console.error("Error granting extension:", err);
    return res.status(500).json({ message: "Failed to grant extension", error: err.message });
  }
});

/* -------------------------
   POST /api/classes/:id/admin-report
   Admin submits report (bypasses all time restrictions)
   ------------------------- */
router.post("/:id/admin-report", authenticateToken, requireRole(["admin"]), async (req, res) => {
  try {
    const ReportSubmissionService = require('../services/reportSubmissionService');
    const reportData = req.body;
    
    const result = await ReportSubmissionService.submitAsAdmin(
      req.params.id,
      reportData,
      req.user._id
    );
    
    if (!result.success) {
      return res.status(400).json({ message: result.error });
    }
    
    return res.json({
      message: result.message,
      class: result.class,
    });
  } catch (err) {
    console.error("Error submitting admin report:", err);
    return res.status(500).json({ message: "Failed to submit report", error: err.message });
  }
});

/* -------------------------
   GET /api/classes/:id/submission-status
   Get report submission status and eligibility
   ------------------------- */
router.get("/:id/submission-status", authenticateToken, async (req, res) => {
  try {
    const ReportSubmissionService = require('../services/reportSubmissionService');
    
    const result = await ReportSubmissionService.getSubmissionStatus(req.params.id);
    
    if (!result.success) {
      return res.status(400).json({ message: result.error });
    }
    
    return res.json(result.status);
  } catch (err) {
    console.error("Error getting submission status:", err);
    return res.status(500).json({ message: "Failed to get status", error: err.message });
  }
});

/* -------------------------
   POST /api/classes/:id/check-can-submit
   Check if user can submit report for this class
   ------------------------- */
router.post("/:id/check-can-submit", authenticateToken, async (req, res) => {
  try {
    const ReportSubmissionService = require('../services/reportSubmissionService');
    
    const result = await ReportSubmissionService.canTeacherSubmit(req.params.id, req.user._id);
    
    return res.json(result);
  } catch (err) {
    console.error("Error checking submission eligibility:", err);
    return res.status(500).json({ message: "Failed to check eligibility", error: err.message });
  }
});

// generateRecurringClasses implementation moved to utils/generateRecurringClasses.js
// (kept for historical reference) -- use require('../utils/generateRecurringClasses')

// (duplicate simple GET removed to keep the richer handler above)

// ── Bulk actions ────────────────────────────────────────────────────────────

// Bulk delete classes (Admin)
router.post('/bulk/delete', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'ids array required' });
    if (ids.length > 500) return res.status(400).json({ success: false, message: 'Maximum 500 classes per batch' });

    // Save to trash before deleting
    const toTrash = await Class.find({ _id: { $in: ids } }).lean();
    await saveMultipleToTrash({
      itemType: 'class',
      docs: toTrash,
      labelFn: (s) => `${s.subject || 'Class'} — ${s.scheduledDate ? new Date(s.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}`,
      metaFn: (s) => ({ subject: s.subject, scheduledDate: s.scheduledDate, duration: s.duration }),
      userId: req.user._id,
    });

    const result = await Class.deleteMany({ _id: { $in: ids } });

    try {
      const io = req.app.get('io');
      if (io) io.emit('class:bulkDeleted', { ids });
    } catch (_) {}

    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('Bulk delete classes error:', err);
    res.status(500).json({ success: false, message: 'Failed to bulk delete', error: err.message });
  }
});

// Bulk cancel classes (Admin)
router.post('/bulk/cancel', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { ids, reason = 'Bulk cancelled by admin' } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, message: 'ids array required' });
    if (ids.length > 500) return res.status(400).json({ success: false, message: 'Maximum 500 classes per batch' });

    const classes = await Class.find({
      _id: { $in: ids },
      status: { $nin: ['cancelled_by_admin', 'cancelled_by_teacher', 'cancelled_by_guardian'] }
    });

    const results = { cancelled: 0, failed: [] };

    for (const classDoc of classes) {
      try {
        classDoc.lastModifiedBy = req.user._id;
        classDoc.lastModifiedAt = new Date();
        await classDoc.cancelClass(reason, req.user._id, 'admin', false);
        results.cancelled++;
      } catch (e) {
        results.failed.push({ id: String(classDoc._id), error: e.message });
      }
    }

    try {
      const io = req.app.get('io');
      if (io) io.emit('class:bulkUpdated', { ids });
    } catch (_) {}

    res.json({ success: true, ...results });
  } catch (err) {
    console.error('Bulk cancel classes error:', err);
    res.status(500).json({ success: false, message: 'Failed to bulk cancel', error: err.message });
  }
});

/* -------------------------
   Export router
   ------------------------- */
module.exports = router;