/**
 * One-off data repair script: sync embedded guardianInfo.students <-> standalone Student collection.
 *
 * Usage:
 *   node scripts/syncStudents.js
 *   node scripts/syncStudents.js --guardianId <mongoId>
 *
 * Notes:
 * - Idempotent-ish: uses a simple key match and links via embedded.standaloneStudentId.
 * - Prefers NOT to create duplicates: matches by (email) OR (firstName+lastName+dob) within a guardian.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Student = require('../models/Student');
const Guardian = require('../models/Guardian');

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--guardianId') out.guardianId = args[i + 1];
  }
  return out;
};

const makeKeyFromAny = ({ email, firstName, lastName, dateOfBirth, selfGuardian }) => {
  if (selfGuardian) return 'self-guardian';
  const e = (email || '').trim().toLowerCase();
  if (e) return `email:${e}`;
  const fn = (firstName || '').trim().toLowerCase();
  const ln = (lastName || '').trim().toLowerCase();
  const dob = dateOfBirth ? new Date(dateOfBirth).toISOString().slice(0, 10) : '';
  return `name:${fn}|${ln}|${dob}`;
};

const pickCommonFields = (src) => ({
  firstName: src.firstName,
  lastName: src.lastName,
  email: src.email,
  grade: src.grade,
  school: src.school,
  language: src.language,
  subjects: Array.isArray(src.subjects) ? src.subjects : [],
  phone: src.phone,
  whatsapp: src.whatsapp,
  learningPreferences: src.learningPreferences,
  evaluation: src.evaluation,
  evaluationSummary: src.evaluationSummary,
  dateOfBirth: src.dateOfBirth,
  gender: src.gender,
  timezone: src.timezone,
  profilePicture: src.profilePicture,
  isActive: typeof src.isActive === 'boolean' ? src.isActive : true,
  hoursRemaining: typeof src.hoursRemaining === 'number' ? src.hoursRemaining : 0,
  selfGuardian: !!src.selfGuardian,
  totalClassesAttended: src.totalClassesAttended || 0,
  currentTeachers: Array.isArray(src.currentTeachers) ? src.currentTeachers : [],
  notes: src.notes,
});

async function main() {
  const { guardianId } = parseArgs();

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required in env');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const guardianQuery = guardianId ? { _id: guardianId, role: 'guardian' } : { role: 'guardian' };
  const guardians = await User.find(guardianQuery);

  let createdStandalone = 0;
  let createdEmbedded = 0;
  let linked = 0;

  for (const guardian of guardians) {
    const embedded = Array.isArray(guardian.guardianInfo?.students) ? guardian.guardianInfo.students : [];
    const standalone = await Student.find({ guardian: guardian._id });

    const standaloneByKey = new Map();
    for (const s of standalone) {
      standaloneByKey.set(makeKeyFromAny(s), s);
    }

    // 1) Ensure standalone exists for each embedded
    for (const emb of embedded) {
      const key = makeKeyFromAny(emb);

      let st = null;
      if (emb.standaloneStudentId) {
        st = standalone.find((x) => String(x._id) === String(emb.standaloneStudentId));
      }
      if (!st) st = standaloneByKey.get(key);

      if (!st) {
        st = new Student({
          ...pickCommonFields(emb),
          guardian: guardian._id,
        });
        await st.save();
        standalone.push(st);
        standaloneByKey.set(key, st);
        createdStandalone += 1;

        await Guardian.findOneAndUpdate(
          { user: guardian._id },
          { $addToSet: { students: st._id } },
          { upsert: true }
        );
      }

      if (!emb.standaloneStudentId) {
        emb.standaloneStudentId = st._id;
        linked += 1;
      }
    }

    // 2) Ensure embedded exists for each standalone
    const embeddedByKey = new Map();
    for (const emb of embedded) {
      embeddedByKey.set(makeKeyFromAny(emb), emb);
    }

    for (const st of standalone) {
      const key = makeKeyFromAny(st);
      let emb = embeddedByKey.get(key);

      if (!emb) {
        guardian.guardianInfo = guardian.guardianInfo || {};
        guardian.guardianInfo.students = Array.isArray(guardian.guardianInfo.students) ? guardian.guardianInfo.students : [];

        guardian.guardianInfo.students.push({
          ...pickCommonFields(st),
          standaloneStudentId: st._id,
        });
        createdEmbedded += 1;
      } else if (!emb.standaloneStudentId) {
        emb.standaloneStudentId = st._id;
        linked += 1;
      }
    }

    await guardian.save();
  }

  console.log(JSON.stringify({
    guardiansProcessed: guardians.length,
    createdStandalone,
    createdEmbedded,
    linked,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
