/*
 * Backfill canonical Meeting.links and Class.interaction linkage.
 *
 * Usage:
 *   node scripts/backfillMeetingInteractionLinks.js --dry-run
 *   node scripts/backfillMeetingInteractionLinks.js --apply
 */

const mongoose = require('mongoose');
const Meeting = require('../models/Meeting');
const Class = require('../models/Class');

const isApply = process.argv.includes('--apply');

const toObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(String(value))) {
    return new mongoose.Types.ObjectId(String(value));
  }
  return null;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/waraqadb');

  const stats = {
    meetingsScanned: 0,
    meetingsUpdated: 0,
    classesScanned: 0,
    classesUpdated: 0,
    linksByClassSet: 0,
    classMeetingBacklinked: 0,
  };

  const meetings = await Meeting.find({}).select('_id meetingType teacherId bookingPayload report links').lean();
  stats.meetingsScanned = meetings.length;

  for (const meeting of meetings) {
    const links = { ...(meeting.links || {}) };
    let dirty = false;

    if (!links.teacherId && meeting.teacherId) {
      links.teacherId = meeting.teacherId;
      dirty = true;
    }

    const studentIds = new Set((Array.isArray(links.studentIds) ? links.studentIds : []).map((id) => String(id)));

    for (const row of (meeting.bookingPayload?.students || [])) {
      const sid = toObjectId(row?.studentId);
      if (sid) studentIds.add(String(sid));
      if (row?.guardianSubdocumentId) {
        links.guardianStudentSubIds = Array.isArray(links.guardianStudentSubIds) ? links.guardianStudentSubIds : [];
        if (!links.guardianStudentSubIds.includes(String(row.guardianSubdocumentId))) {
          links.guardianStudentSubIds.push(String(row.guardianSubdocumentId));
          dirty = true;
        }
      }
    }

    const reportStudents = [
      ...(meeting?.report?.evaluation?.students || []),
      ...(meeting?.report?.teacherSync?.students || []),
      meeting?.report?.guardianFollowUp || null,
    ].filter(Boolean);

    for (const row of reportStudents) {
      const sid = toObjectId(row?.studentId);
      if (sid) studentIds.add(String(sid));
    }

    const normalizedStudentIds = Array.from(studentIds);
    if (normalizedStudentIds.length !== (Array.isArray(links.studentIds) ? links.studentIds.length : 0)) {
      links.studentIds = normalizedStudentIds.map((id) => new mongoose.Types.ObjectId(id));
      dirty = true;
    }

    if (dirty) {
      stats.meetingsUpdated += 1;
      if (isApply) {
        await Meeting.updateOne({ _id: meeting._id }, { $set: { links } });
      }
    }
  }

  const classes = await Class.find({ status: { $ne: 'pattern' } })
    .select('_id student teacher interaction classReport meetingLink scheduledDate duration timezone')
    .lean();
  stats.classesScanned = classes.length;

  for (const cls of classes) {
    const classId = toObjectId(cls._id);
    if (!classId) continue;

    const linkedMeeting = await Meeting.findOne({ 'links.classId': classId }).select('_id').lean();
    if (linkedMeeting) {
      const needsBacklink = !cls?.interaction?.meetingId || String(cls.interaction.meetingId) !== String(linkedMeeting._id);
      if (needsBacklink) {
        stats.classesUpdated += 1;
        stats.classMeetingBacklinked += 1;
        if (isApply) {
          await Class.updateOne(
            { _id: cls._id },
            {
              $set: {
                'interaction.meetingId': linkedMeeting._id,
                'interaction.reportSource': 'sync',
                'interaction.reportSyncedAt': new Date(),
              },
            }
          );
        }
      }
      continue;
    }

    if (!cls?.interaction?.meetingId && cls?.classReport?.submittedAt) {
      stats.linksByClassSet += 1;
      // Link will be created by route/service on next report edit; this script only
      // reports missing links for now to keep migration low-risk.
    }
  }

  console.log(JSON.stringify({ mode: isApply ? 'apply' : 'dry-run', stats }, null, 2));
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
