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
const router = express.Router();
const { body, validationResult } = require("express-validator");
const { authenticateToken, requireRole } = require("../middleware/auth");
const Class = require("../models/Class");
const User = require("../models/User");
require("../models/Student");
const InvoiceModel = require("../models/Invoice");
const InvoiceService = require('../services/invoiceService');
const mongoose = require("mongoose");
const systemVacationService = require("../services/systemVacationService");
const availabilityService = require("../services/availabilityService");
const {
  extractParticipantIds,
  refreshParticipantsFromSchedule,
} = require("../services/activityStatusService");
const { processArrayWithTimezone, addTimezoneInfo, DEFAULT_TIMEZONE } = require("../utils/timezoneUtils");

// timezone helpers (you must have these implemented)
const tzUtils = require("../utils/timezone"); // expects toUtc(dateString, tz) and buildUtcFromParts(parts, tz)
const { generateRecurringClasses } = require("../utils/generateRecurringClasses");

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
        raw: slot
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
    withinThreeHours,
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
    response.reasons.reschedule = "Class start time has passed.";
    response.reasons.cancel = "Class start time has passed.";
    return response;
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
    const {
      page = 1,
      limit = 20,
      filter,
      teacher,
      guardian,
      student,
      status,
      subject,
      date,
      dateFrom,
      dateTo,
    } = req.query;

    const now = new Date();
    const filters = {};

    // If a teacher user supplies a teacher query param for someone else, reject explicitly
    if (req.user && req.user.role === 'teacher' && req.query.teacher && String(req.query.teacher) !== String(req.user._id)) {
      return res.status(403).json({ message: "You cannot query classes for other teachers", error: "FORBIDDEN_QUERY" });
    }

    if (teacher && teacher !== "all") filters.teacher = teacher;
    if (guardian && guardian !== "all") filters["student.guardianId"] = guardian;
    if (student && student !== "all") filters["student.studentId"] = student;
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

  // upcoming / previous filtering based on end time
    if (filter === "upcoming") {
      filters.$or = [
        { scheduledDate: { $gte: now } },
        {
          $expr: {
            $gte: [
              { $add: ["$scheduledDate", { $multiply: [{ $ifNull: ["$duration", 0] }, 60000] }] },
              now,
            ],
          },
        },
      ];
    } else if (filter === "previous") {
      filters.$and = [
        {
          $expr: {
            $lt: [
              { $add: ["$scheduledDate", { $multiply: [{ $ifNull: ["$duration", 0] }, 60000] }] },
              now,
            ],
          },
        },
      ];
    }

    // Filter out classes that are hidden due to system vacation or individual teacher vacation
    if (!req.user || req.user.role !== 'admin') {
      filters.hidden = { $ne: true };
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

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const sortOrder = filter === "upcoming" ? 1 : -1;
    const sortObj = { scheduledDate: sortOrder };

    // Always exclude recurring pattern docs
    filters.status = filters.status && filters.status !== "all" 
      ? filters.status 
      : { $ne: "pattern" };

    const rawClasses = await Class.find(filters)
      .populate("teacher", "firstName lastName email phone profilePicture")
      .populate("student.guardianId", "firstName lastName email phone")
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum);


    // enrich recurring info
    const classes = await Promise.all(
      rawClasses.map(async (c) => {
        const obj = c.toObject();
        if (obj.parentRecurringClass) {
          const pattern = await Class.findById(obj.parentRecurringClass);
          if (pattern) {
            obj.isRecurring = true;
            obj.parentRecurringClass = obj.parentRecurringClass;
            obj.recurrence = pattern.recurrence;
            obj.recurrenceDetails = pattern.recurrenceDetails || [];
          }
        }
        return obj;
      })
    );

    const totalClasses = await Class.countDocuments(filters);
    const totalPages = Math.ceil(totalClasses / limitNum);

    // Get user's timezone for conversion
    const userTimezone = req.user?.timezone || DEFAULT_TIMEZONE;
    
    // Process classes with timezone conversion
    const processedClasses = processArrayWithTimezone(classes, userTimezone, ['scheduledDate', 'createdAt', 'updatedAt']);
    const sanitizedClasses = processedClasses.map((cls) => sanitizeClassForRole(cls, req.user?.role));

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
        const requestorName = `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() || req.user.email;
        const classDate = new Date(classDoc.scheduledDate).toLocaleString();
        const message = `${requestorName} requested to move class on ${classDate}`;

        await notificationService.notifyRole({
          role: "admin",
          title: "Class reschedule request",
          message,
          type: "class",
          related: { class: classDoc._id },
        });

        const counterpart = req.user.role === "teacher"
          ? classDoc.student?.guardianId
          : classDoc.teacher?._id || classDoc.teacher;

        if (counterpart) {
          await notificationService.createNotification({
            userId: counterpart,
            title: "Class reschedule requested",
            message: `${requestorName} requested to reschedule the class to ${proposedDate.toLocaleString()}.`,
            type: "class",
            relatedTo: "class",
            relatedId: classDoc._id,
            actionRequired: req.user.role === "teacher",
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
   Admin approves or rejects a reschedule request
   ------------------------- */
router.post(
  "/:id/reschedule-request/decision",
  authenticateToken,
  requireRole(["admin"]),
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
          if (requestSnapshot?.requestedBy) {
            await notificationService.createNotification({
              userId: requestSnapshot.requestedBy,
              title: "Reschedule request rejected",
              message: decisionNote
                ? `Your reschedule request was rejected. Reason: ${decisionNote}`
                : "Your reschedule request was rejected.",
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

      if (rescheduleDate.getTime() <= Date.now()) {
        return res.status(400).json({ message: "Reschedule date must be in the future" });
      }

      const minutes = typeof req.body.duration !== "undefined"
        ? Number(req.body.duration)
        : Number(requestSnapshot.proposedDuration || classDoc.duration || 60);

      if (!Number.isFinite(minutes) || minutes <= 0) {
        return res.status(400).json({ message: "Duration must be a positive number" });
      }

      const reason = decisionNote
        ? `Approved reschedule request. ${decisionNote}`
        : "Approved reschedule request.";

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
          notificationService.notifyClassEvent({
            classObj: populated,
            eventType: "rescheduled",
            actor: req.user,
            extraMsg: decisionNote ? `Note: ${decisionNote}` : "",
          }).catch(console.error);

          if (requestSnapshot?.requestedBy) {
            await notificationService.createNotification({
              userId: requestSnapshot.requestedBy,
              title: "Reschedule request approved",
              message: `Your reschedule request was approved. New time: ${rescheduleDate.toLocaleString()}.`,
              type: "class",
              relatedTo: "class",
              relatedId: classDoc._id,
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

      if (["cancelled_by_teacher", "cancelled_by_guardian", "cancelled_by_admin"].includes(classDoc.status)) {
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
          recurrence, meetingLink, materials, recurrenceDetails = []
      } = req.body;
        const overrideDuplicateSeries = toBool(req.body.overrideDuplicateSeries);

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

      // Prepare student object with name for class creation
      const studentForClass = {
        guardianId: student.guardianId,
        studentId: student.studentId,
        studentName: sExists ? `${sExists.firstName} ${sExists.lastName}` : 'Unknown Student'
      };
      console.log("Student object for class:", studentForClass);

      const createdClasses = [];

      if (!isRecurring) {
        // ensure tzUsed and convert scheduledDate to UTC
        console.log("Creating single class");
        const tzUsed = timezone || "UTC";
        console.log("Timezone:", tzUsed, "ScheduledDate:", scheduledDate);
        const scheduledUtc = scheduledDate ? (tzUtils.toUtc ? tzUtils.toUtc(scheduledDate, tzUsed) : new Date(scheduledDate)) : null;
        console.log("Scheduled UTC:", scheduledUtc);

        const newClass = new Class({
          title, description, subject, teacher, student: studentForClass,
          scheduledDate: scheduledUtc,
          duration: Number(duration || 60),
          timezone: tzUsed,
          isRecurring: false,
          meetingLink: meetingLink || null,
          materials: Array.isArray(materials) ? materials : (materials ? [materials] : []),
          createdBy: req.user._id,
          status: "scheduled",
        });

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

        const normalizedDetails = normalizeRecurrenceSlots(recurrenceDetails, timezone);

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

        const tzUsed = recurrenceDetails?.[0]?.timezone || timezone || "UTC";
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
          return res.status(400).json({
            message: "Teacher not available for one or more recurring slots",
            availabilityError: {
              reason: recurringAvailabilityCheck.availability?.reason || "Teacher not available during this recurring slot",
              conflictType: recurringAvailabilityCheck.availability?.conflictType,
              conflictDetails: recurringAvailabilityCheck.availability?.conflictDetails,
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

      const tzUsed = req.body.timezone || sourceClass.timezone || DEFAULT_TIMEZONE;
      let scheduledUtc;
      if (req.body.scheduledDate) {
        const parsedRequestedDate = new Date(req.body.scheduledDate);
        if (Number.isNaN(parsedRequestedDate.getTime())) {
          return res.status(400).json({ message: "Invalid scheduledDate supplied" });
        }
        scheduledUtc = tzUtils.toUtc ? tzUtils.toUtc(req.body.scheduledDate, tzUsed) : parsedRequestedDate;
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
        timezone: tzUsed,
        anchoredTimezone: req.body.anchoredTimezone || sourceClass.anchoredTimezone || "student",
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
      });

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
      const updatePayload = {
        title: updates.title,
        description: updates.description,
        subject: updates.subject,
        teacher: updates.teacher,
        student: updates.student,
        scheduledDate: updates.scheduledDate ? new Date(updates.scheduledDate) : classDoc.scheduledDate,
        duration: (typeof updates.duration !== "undefined") ? Number(updates.duration) : classDoc.duration,
        timezone: updates.timezone || classDoc.timezone,
        meetingLink: updates.meetingLink,
        materials: Array.isArray(updates.materials) ? updates.materials : classDoc.materials,
        lastModifiedBy: req.user._id,
        lastModifiedAt: new Date(),
      };

      const updated = await Class.findByIdAndUpdate(req.params.id, updatePayload, { new: true, runValidators: true }).lean();
      
      // Note: Teacher hour adjustments for duration changes are now handled automatically
      // by the Class model's post('save') hook which calls InvoiceService.onClassStateChanged

      // Notification trigger: class rescheduled or time changed
      try {
        const notificationService = require('../services/notificationService');
        let eventType = 'rescheduled';
        if (updates.scheduledDate && new Date(updates.scheduledDate).getTime() !== new Date(classDoc.scheduledDate).getTime()) {
          eventType = 'time_changed';
        }
        notificationService.notifyClassEvent({
          classObj: { ...classDoc.toObject(), ...updatePayload },
          eventType,
          actor: req.user
        }).catch(console.error);
      } catch (e) { console.warn("Notification trigger failed", e.message); }

      try { const io = req.app.get("io"); if (io) io.emit("class:updated", { class: updated }); } catch (e) { console.warn("emit update failed", e.message); }

      return res.json({ message: "Class updated", classes: [enrichClassObj(updated, new Date())] });
    }

    // Recurring pattern update: update pattern, delete future children, regenerate
    const patternId = classDoc.parentRecurringClass ? classDoc.parentRecurringClass : classDoc._id;
    const pattern = await Class.findById(patternId);
    if (!pattern || pattern.status !== "pattern") return res.status(400).json({ message: "Recurring pattern not found" });

    const {
      title, description, subject, teacher, student,
      scheduledDate, duration, timezone, recurrence, recurrenceDetails = []
    } = updates;

    const normalizedUpdateDetails = normalizeRecurrenceSlots(recurrenceDetails, timezone || pattern.timezone);

    // Delete future children
    const now = new Date();
    await Class.deleteMany({ parentRecurringClass: patternId, scheduledDate: { $gte: now } });

    // Update pattern fields
    if (title) pattern.title = title;
    if (description) pattern.description = description;
    if (subject) pattern.subject = subject;
    if (teacher) pattern.teacher = teacher;
    if (student) pattern.student = student;
    if (typeof duration !== "undefined") pattern.duration = Number(duration);
    pattern.timezone = timezone || pattern.timezone;
    if (scheduledDate) {
      // convert to UTC if tz util exists
      pattern.scheduledDate = tzUtils.toUtc ? tzUtils.toUtc(scheduledDate, pattern.timezone || timezone || "UTC") : new Date(scheduledDate);
    }
    pattern.recurrence = { ...(pattern.recurrence || {}), ...(recurrence || {}) };
    if (normalizedUpdateDetails.length) {
      pattern.recurrenceDetails = normalizedUpdateDetails;
      const derivedDays = Array.from(new Set(normalizedUpdateDetails.map((slot) => slot.dayOfWeek))).sort();
      if (derivedDays.length) {
        pattern.recurrence.daysOfWeek = derivedDays;
      }
      if (!pattern.recurrence.duration) {
        pattern.recurrence.duration = normalizedUpdateDetails[0]?.duration || pattern.duration;
      }
    }
    pattern.recurrence.lastGenerated = new Date();
    pattern.lastModifiedBy = req.user._id;
    pattern.lastModifiedAt = new Date();

    const recurringUpdateSlots = (pattern.recurrenceDetails || [])
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
          duration: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : Number(pattern.recurrence?.duration || pattern.duration || 60),
          timezone: slot?.timezone || pattern.timezone || DEFAULT_TIMEZONE,
        };
      })
      .filter(Boolean);

    const recurringUpdateAvailability = await ensureRecurringSlotsWithinAvailability(
      pattern.teacher?._id || pattern.teacher,
      recurringUpdateSlots,
      pattern.timezone || DEFAULT_TIMEZONE,
      Number(pattern.recurrence?.duration || pattern.duration || 60)
    );

    if (!recurringUpdateAvailability.ok) {
      const slotInfo = recurringUpdateAvailability.slot || {};
      const dayName = typeof slotInfo.dayOfWeek === "number" ? DAY_LABELS[slotInfo.dayOfWeek] || "selected day" : "selected day";
      return res.status(400).json({
        message: "Teacher not available for one or more recurring slots",
        availabilityError: {
          reason: recurringUpdateAvailability.availability?.reason || "Teacher not available during this recurring slot",
          conflictType: recurringUpdateAvailability.availability?.conflictType,
          conflictDetails: recurringUpdateAvailability.availability?.conflictDetails,
          slot: slotInfo,
          dayName,
        },
      });
    }

    await pattern.save();

    // regenerate instances
    const perDayMap = buildPerDayMap(pattern.recurrenceDetails || []);
    const newInstances = await generateRecurringClasses(pattern, pattern.recurrence.generationPeriodMonths || 2, perDayMap);

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
              status: { $ne: 'cancelled' }
            })
              .select('_id subject scheduledDate duration student teacher status')
              .lean();
            
            console.log(`[Recurring Update] Found ${currentClasses.length} classes within billing period (${billingStart.toISOString().slice(0,10)} to ${billingEnd.toISOString().slice(0,10)})`);
            
            // Rebuild items array
            const rate = invoice.hourlyRate || 10;
            const newItems = currentClasses.map(cls => {
              const studentFullName = (cls.student && cls.student.studentName) || '';
              const [fn, ...rest] = String(studentFullName).trim().split(' ').filter(Boolean);
              const ln = rest.join(' ');
              const itemHours = (Number(cls.duration || 0) || 0) / 60;
              
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
            const subtotal = Math.round(totalHours * rate * 100) / 100;
            
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

      const savedClass = await classDoc.reschedule(newDate, req.body.reason.trim(), req.user._id);

      const populated = await Class.findById(savedClass._id)
        .populate("teacher", "firstName lastName email phone profilePicture")
        .populate("student.guardianId", "firstName lastName email phone");

      try {
        const notificationService = require('../services/notificationService');
        notificationService.notifyClassEvent({
          classObj: populated,
          eventType: 'rescheduled',
          actor: req.user
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
    if (!classDoc) return res.status(404).json({ message: "Class not found" });
    const teacherId = classDoc.teacher;
    const guardianId = classDoc.student?.guardianId;
    const studentId = classDoc.student?.studentId;

    if (scope === "single") {
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
      const ids = toDelete.map((d) => d._id);
      const result = await Class.deleteMany({ parentRecurringClass: parentId, scheduledDate: { $lt: baseDate } });
      try { const io = req.app.get("io"); if (io) io.emit("class:deleted", { ids, parentId, scope: "past" }); } catch (e) {}
      await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);
      return res.json({ message: `Deleted ${result.deletedCount} past class(es)`, count: result.deletedCount, deletedIds: ids });
    }

    if (scope === "all") {
      const parentId = classDoc.parentRecurringClass || classDoc._id;
      const children = await Class.find({ parentRecurringClass: parentId }).lean();
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

    const attendanceOptions = new Set(["attended", "missed_by_student", "cancelled_by_teacher", "no_show_both"]);
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
    const recitedQuran =
      payload.recitedQuran ?? payload.quranRecitation ?? classDoc.classReport?.recitedQuran ?? "";

    const classScore = attendanceValue === "attended"
      ? (Number.isFinite(Number(payload.classScore))
          ? Number(payload.classScore)
          : Number.isFinite(Number(classDoc.classReport?.classScore))
            ? Number(classDoc.classReport.classScore)
            : 5)
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
    } else if (attendanceValue === "cancelled_by_teacher") {
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
    }

    // If this is the first time a report is submitted for this class, attempt to
    // create an initial "first-lesson" invoice for the guardian/student pair.
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
            // create an invoice containing this lesson so the guardian can pay
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

    // ✅ HOURS LOGIC REMOVED - Now handled automatically by Class model hooks
    // The Class model's post('save') hook triggers invoiceService.onClassStateChanged()
    // which handles all hour adjustments (teacher & guardian) based on status changes
    // This prevents duplicate hour updates and ensures consistency

    const responseClass = sanitizeClassForRole(classDoc.toObject({ virtuals: true }), req.user?.role);
    const responsePayload = { message: "Report submitted", class: responseClass };

    try {
      await refreshParticipantsFromSchedule(teacherId, guardianId, studentId);
    } catch (refreshErr) {
      console.warn("[report] Failed to refresh participant activity flags", refreshErr.message);
    }

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

/* -------------------------
   Export router
   ------------------------- */
module.exports = router;