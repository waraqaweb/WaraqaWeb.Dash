/**
 * activityStatusService.js
 *
 * Keeps teacher, guardian, and student activation flags in sync with
 * the actual future class schedule.
 */
const mongoose = require("mongoose");
const User = require("../models/User");

const UPCOMING_CLASS_STATUS_EXCLUSIONS = [
  "cancelled_by_teacher",
  "cancelled_by_guardian",
  "cancelled_by_admin",
  "cancelled",
  "pattern",
];

function getClassModel() {
  if (mongoose.models && mongoose.models.Class) {
    return mongoose.models.Class;
  }
  return mongoose.model("Class");
}

function buildUpcomingClassQuery(filters = {}, referenceDate = new Date()) {
  const query = {
    scheduledDate: { $gte: referenceDate },
    status: { $nin: UPCOMING_CLASS_STATUS_EXCLUSIONS },
    hidden: { $ne: true },
  };

  if (filters.teacherId) {
    query.teacher = filters.teacherId;
  }
  if (filters.guardianId) {
    query["student.guardianId"] = filters.guardianId;
  }
  if (filters.studentId) {
    query["student.studentId"] = filters.studentId;
  }

  return query;
}

function unwrapId(value) {
  if (!value) return null;
  if (typeof value === "object" && value._id) {
    return value._id;
  }
  return value;
}

function extractParticipantIds(classDoc) {
  if (!classDoc) {
    return { teacherId: null, guardianId: null, studentId: null };
  }
  return {
    teacherId: unwrapId(classDoc.teacher),
    guardianId: unwrapId(classDoc.student && classDoc.student.guardianId),
    studentId: unwrapId(classDoc.student && classDoc.student.studentId),
  };
}

async function setTeacherActiveFlag(teacherId, isActive) {
  if (!teacherId) return;
  await User.updateOne(
    { _id: teacherId, role: "teacher", isActive: { $ne: Boolean(isActive) } },
    { isActive: Boolean(isActive) }
  );
}

async function ensureTeacherActiveMatchesSchedule(teacherId, referenceDate = new Date()) {
  if (!teacherId) return;
  const Class = getClassModel();
  const hasUpcoming = await Class.exists(buildUpcomingClassQuery({ teacherId }, referenceDate));
  await setTeacherActiveFlag(teacherId, Boolean(hasUpcoming));
}

async function setGuardianActiveFlag(guardianId, isActive) {
  if (!guardianId) return;
  await User.updateOne(
    { _id: guardianId, role: "guardian", isActive: { $ne: Boolean(isActive) } },
    { isActive: Boolean(isActive) }
  );
}

async function refreshGuardianActiveFromStudents(guardianId) {
  if (!guardianId) return;
  const hasActiveStudent = await User.exists({
    _id: guardianId,
    role: "guardian",
    "guardianInfo.students": { $elemMatch: { isActive: true } },
  });
  await setGuardianActiveFlag(guardianId, Boolean(hasActiveStudent));
}

async function setStudentActiveFlag(guardianId, studentId, isActive) {
  if (!guardianId || !studentId) return;
  await User.updateOne(
    { _id: guardianId, role: "guardian", "guardianInfo.students._id": studentId },
    { $set: { "guardianInfo.students.$.isActive": Boolean(isActive) } }
  );
  if (isActive) {
    await setGuardianActiveFlag(guardianId, true);
  } else {
    await refreshGuardianActiveFromStudents(guardianId);
  }
}

async function refreshStudentActiveFromSchedule(guardianId, studentId, referenceDate = new Date()) {
  if (!guardianId || !studentId) return;
  const Class = getClassModel();
  const hasUpcoming = await Class.exists(buildUpcomingClassQuery({ guardianId, studentId }, referenceDate));
  await setStudentActiveFlag(guardianId, studentId, Boolean(hasUpcoming));
}

async function refreshParticipantsFromSchedule(teacherId, guardianId, studentId) {
  const jobs = [];
  const referenceDate = new Date();
  if (teacherId) jobs.push(ensureTeacherActiveMatchesSchedule(teacherId, referenceDate));
  if (guardianId && studentId) jobs.push(refreshStudentActiveFromSchedule(guardianId, studentId, referenceDate));
  if (jobs.length) {
    await Promise.allSettled(jobs);
  }
}

module.exports = {
  extractParticipantIds,
  refreshParticipantsFromSchedule,
  ensureTeacherActiveMatchesSchedule,
  refreshStudentActiveFromSchedule,
};
