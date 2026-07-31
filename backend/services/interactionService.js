const mongoose = require('mongoose');
const Meeting = require('../models/Meeting');
const Class = require('../models/Class');
const Student = require('../models/Student');
const User = require('../models/User');
const { MEETING_TYPES, MEETING_STATUSES } = require('../constants/meetingConstants');

const toObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(String(value))) {
    return new mongoose.Types.ObjectId(String(value));
  }
  return null;
};

const attendanceToMeetingAttendance = (attendance) => {
  const normalized = String(attendance || '').trim().toLowerCase();
  if (normalized === 'attended' || normalized === 'missed_by_student') return 'attended';
  if (normalized === 'cancelled_by_teacher' || normalized === 'cancelled_by_student') return 'cancelled_no_penalty';
  if (normalized === 'no_show_both') return 'no_show';
  return null;
};

const statusFromAttendance = (attendanceStatus) => {
  if (attendanceStatus === 'attended') return MEETING_STATUSES.COMPLETED;
  if (attendanceStatus === 'no_show') return MEETING_STATUSES.NO_SHOW;
  if (attendanceStatus === 'cancelled_no_penalty') return MEETING_STATUSES.CANCELLED;
  return MEETING_STATUSES.SCHEDULED;
};

const resolveAdminForClass = async (classDoc) => {
  const ownerCandidates = [
    classDoc?.createdBy,
    classDoc?.admin,
    classDoc?.lastModifiedBy,
  ];

  for (const candidate of ownerCandidates) {
    const id = toObjectId(candidate);
    if (!id) continue;
    const user = await User.findById(id).select('_id role isActive').lean();
    if (user?.role === 'admin' && user?.isActive !== false) return user;
  }

  return User.findOne({ role: 'admin', isActive: true }).select('_id role').lean();
};

const syncClassReportToCanonicalMeeting = async ({ classDoc, submittedBy, source = 'classes.report' }) => {
  if (!classDoc?._id || !classDoc?.classReport?.submittedAt) {
    return { ok: true, skipped: true, reason: 'no-submitted-class-report' };
  }

  const admin = await resolveAdminForClass(classDoc);
  if (!admin?._id) {
    return { ok: true, skipped: true, reason: 'admin-not-found' };
  }

  const classId = toObjectId(classDoc._id);
  const teacherId = toObjectId(classDoc.teacher);
  const guardianId = toObjectId(classDoc?.student?.guardianId);
  const studentId = toObjectId(classDoc?.student?.studentId);
  const scheduledStart = new Date(classDoc.scheduledDate || new Date());
  const durationMinutes = Math.max(Number(classDoc.duration || 30), 15);
  const scheduledEnd = new Date(scheduledStart.getTime() + durationMinutes * 60000);

  const attendance = classDoc?.classReport?.attendance || classDoc?.status || null;
  const attendanceStatus = attendanceToMeetingAttendance(attendance);
  const meetingStatus = statusFromAttendance(attendanceStatus);

  const studentName = classDoc?.student?.studentName || 'Student';
  const teacherName = classDoc?.teacherName || undefined;

  const report = {
    submittedBy: toObjectId(submittedBy?._id || submittedBy) || undefined,
    submittedAt: classDoc.classReport.submittedAt,
    visibility: {
      admin: true,
      guardians: true,
      teachers: true,
    },
    guardianFollowUp: {
      studentId: studentId || undefined,
      studentName,
      currentLevel: classDoc.classReport?.subject || classDoc.subject || undefined,
      assessmentNotes: classDoc.classReport?.teacherNotes || undefined,
      nextPlan: classDoc.classReport?.newAssignment || undefined,
    },
    notes: classDoc.classReport?.supervisorNotes || classDoc.classReport?.teacherNotes || undefined,
    meta: {
      version: Number(classDoc?.interaction?.reportVersion || 1),
      source: 'class_report',
      sourceRef: String(classDoc._id),
      sourceModule: source,
      idempotencyKey: `class-report:${String(classDoc._id)}:${new Date(classDoc.classReport.submittedAt).toISOString()}`,
    },
  };

  const links = {
    classId,
    studentIds: studentId ? [studentId] : [],
    guardianStudentSubIds: classDoc?.student?.guardianStudentSubdocumentId
      ? [String(classDoc.student.guardianStudentSubdocumentId)]
      : [],
    teacherId: teacherId || undefined,
  };

  const query = {
    meetingType: MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP,
    'links.classId': classId,
  };

  const update = {
    $set: {
      adminId: admin._id,
      guardianId: guardianId || undefined,
      teacherId: teacherId || undefined,
      scheduledStart,
      scheduledEnd,
      durationMinutes,
      timezone: classDoc.timezone || 'Africa/Cairo',
      status: meetingStatus,
      attendanceStatus,
      report,
      links,
      bookingSource: 'admin',
      bookingPayload: {
        guardianName: classDoc?.student?.guardianName || undefined,
        students: [
          {
            studentId: studentId || undefined,
            studentName,
            isExistingStudent: true,
          },
        ],
      },
    },
    $setOnInsert: {
      meetingLinkSnapshot: classDoc.meetingLink || undefined,
      createdAt: new Date(),
    },
  };

  const meeting = await Meeting.findOneAndUpdate(query, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });

  await Class.updateOne(
    { _id: classDoc._id },
    {
      $set: {
        'interaction.meetingId': meeting._id,
        'interaction.reportSource': 'class',
        'interaction.reportSyncedAt': new Date(),
        'interaction.reportVersion': (Number(classDoc?.interaction?.reportVersion || 1) + 1),
      },
    }
  );

  return { ok: true, meetingId: meeting._id };
};

const listStudentInteractions = async ({ studentId, from, to, limit = 100 }) => {
  const sid = toObjectId(studentId);
  if (!sid) throw new Error('Invalid student id');

  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;

  const meetingDateFilter = {};
  if (fromDate) meetingDateFilter.$gte = fromDate;
  if (toDate) meetingDateFilter.$lte = toDate;

  const classDateFilter = {};
  if (fromDate) classDateFilter.$gte = fromDate;
  if (toDate) classDateFilter.$lte = toDate;

  const meetingsQuery = {
    $or: [
      { 'links.studentIds': sid },
      { 'bookingPayload.students.studentId': sid },
    ],
  };
  if (Object.keys(meetingDateFilter).length) meetingsQuery.scheduledStart = meetingDateFilter;

  const classQuery = {
    $or: [
      { 'student.studentId': sid },
      { 'student.studentId': String(sid) },
    ],
    status: { $ne: 'pattern' },
  };
  if (Object.keys(classDateFilter).length) classQuery.scheduledDate = classDateFilter;

  const [meetings, classes, student] = await Promise.all([
    Meeting.find(meetingsQuery)
      .sort({ scheduledStart: -1 })
      .limit(limit)
      .lean(),
    Class.find(classQuery)
      .select('_id scheduledDate status subject title duration classReport interaction meetingLink teacher student')
      .sort({ scheduledDate: -1 })
      .limit(limit)
      .lean(),
    Student.findById(sid).select('_id firstName lastName guardian').lean(),
  ]);

  const linkedClassIds = new Set(
    meetings
      .map((m) => (m?.links?.classId ? String(m.links.classId) : null))
      .filter(Boolean)
  );

  const meetingItems = meetings.map((meeting) => ({
    source: 'meeting',
    interactionId: `meeting:${String(meeting._id)}`,
    occurredAt: meeting.scheduledStart,
    meetingId: meeting._id,
    meetingType: meeting.meetingType,
    status: meeting.status,
    attendanceStatus: meeting.attendanceStatus || null,
    classId: meeting?.links?.classId || null,
    teacherId: meeting.teacherId || meeting?.links?.teacherId || null,
    notes: meeting?.report?.notes || null,
    reportSubmittedAt: meeting?.report?.submittedAt || null,
  }));

  const classItems = classes
    .filter((cls) => !linkedClassIds.has(String(cls._id)))
    .map((cls) => ({
      source: 'class',
      interactionId: `class:${String(cls._id)}`,
      occurredAt: cls.scheduledDate,
      classId: cls._id,
      status: cls.status,
      attendanceStatus: cls?.classReport?.attendance || null,
      subject: cls.classReport?.subject || cls.subject || null,
      teacherId: cls.teacher || null,
      notes: cls?.classReport?.teacherNotes || cls?.classReport?.supervisorNotes || null,
      reportSubmittedAt: cls?.classReport?.submittedAt || null,
      meetingId: cls?.interaction?.meetingId || null,
    }));

  const timeline = [...meetingItems, ...classItems]
    .sort((a, b) => new Date(b.occurredAt || 0) - new Date(a.occurredAt || 0))
    .slice(0, limit);

  return {
    student: student
      ? {
          _id: student._id,
          fullName: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
          guardianId: student.guardian || null,
        }
      : null,
    timeline,
  };
};

const listTeacherInteractions = async ({ teacherId, from, to, limit = 100 }) => {
  const tid = toObjectId(teacherId);
  if (!tid) throw new Error('Invalid teacher id');

  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);

  const query = {
    $or: [
      { teacherId: tid },
      { 'links.teacherId': tid },
      { 'report.teacherSync.teacherId': tid },
    ],
  };
  if (Object.keys(dateFilter).length) query.scheduledStart = dateFilter;

  const meetings = await Meeting.find(query)
    .sort({ scheduledStart: -1 })
    .limit(limit)
    .lean();

  return {
    teacherId: tid,
    timeline: meetings.map((meeting) => ({
      source: 'meeting',
      interactionId: `meeting:${String(meeting._id)}`,
      occurredAt: meeting.scheduledStart,
      meetingId: meeting._id,
      meetingType: meeting.meetingType,
      status: meeting.status,
      attendanceStatus: meeting.attendanceStatus || null,
      classId: meeting?.links?.classId || null,
      notes: meeting?.report?.notes || null,
      discussedStudents: Array.isArray(meeting?.report?.teacherSync?.students)
        ? meeting.report.teacherSync.students.map((s) => ({
            studentId: s.studentId || null,
            studentName: s.studentName || null,
          }))
        : [],
      reportSubmittedAt: meeting?.report?.submittedAt || null,
    })),
  };
};

module.exports = {
  syncClassReportToCanonicalMeeting,
  listStudentInteractions,
  listTeacherInteractions,
};