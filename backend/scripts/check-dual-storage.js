// Check dual storage for a specific guardian or all guardians
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb');
  const Student = require('../models/Student');
  const Guardian = require('../models/Guardian');
  const User = require('../models/User');

  const guardianId = process.argv[2]; // optional single guardian ID

  const query = { role: 'guardian', deleted: { $ne: true } };
  if (guardianId) query._id = guardianId;

  const guardians = await User.find(query)
    .select('guardianInfo firstName lastName email')
    .lean();

  console.log(`Checking ${guardians.length} guardian(s)...\n`);

  let issues = [];

  for (const g of guardians) {
    const embedded = g.guardianInfo?.students || [];
    const standalone = await Student.find({ guardian: g._id }).lean();
    const guardianModel = await Guardian.findOne({ user: g._id }).lean();

    // Check for embedded students missing standalone counterparts
    for (const es of embedded) {
      const sid = es.standaloneStudentId ? String(es.standaloneStudentId) : null;
      const hasStandalone = sid && standalone.some(s => String(s._id) === sid);
      
      if (!sid) {
        issues.push({
          guardianId: String(g._id),
          guardianName: `${g.firstName} ${g.lastName}`,
          issue: 'embedded_missing_standaloneId',
          detail: `Embedded student "${es.firstName} ${es.lastName}" (${es._id}) has no standaloneStudentId`,
          embeddedId: String(es._id),
          hoursRemaining: es.hoursRemaining,
          isActive: es.isActive,
        });
      } else if (!hasStandalone) {
        issues.push({
          guardianId: String(g._id),
          guardianName: `${g.firstName} ${g.lastName}`,
          issue: 'standalone_missing',
          detail: `Embedded student "${es.firstName} ${es.lastName}" references standalone ${sid} but it doesn't exist`,
          embeddedId: String(es._id),
          standaloneStudentId: sid,
          hoursRemaining: es.hoursRemaining,
          isActive: es.isActive,
        });
      }
    }

    // Check for standalone students not linked from embedded
    for (const ss of standalone) {
      const linked = embedded.some(es => 
        es.standaloneStudentId && String(es.standaloneStudentId) === String(ss._id)
      );
      if (!linked) {
        issues.push({
          guardianId: String(g._id),
          guardianName: `${g.firstName} ${g.lastName}`,
          issue: 'standalone_orphaned',
          detail: `Standalone student "${ss.firstName} ${ss.lastName}" (${ss._id}) not linked from any embedded student`,
          standaloneId: String(ss._id),
          hoursRemaining: ss.hoursRemaining,
          isActive: ss.isActive,
        });
      }
    }

    // Check Guardian model
    if (!guardianModel) {
      issues.push({
        guardianId: String(g._id),
        guardianName: `${g.firstName} ${g.lastName}`,
        issue: 'guardian_model_missing',
        detail: `No Guardian document (separate collection) exists for this user`,
      });
    } else {
      // Check guardian model students array
      const gmStudents = (guardianModel.students || []).map(String);
      for (const ss of standalone) {
        if (!gmStudents.includes(String(ss._id))) {
          issues.push({
            guardianId: String(g._id),
            guardianName: `${g.firstName} ${g.lastName}`,
            issue: 'guardian_model_missing_student',
            detail: `Standalone student "${ss.firstName} ${ss.lastName}" (${ss._id}) not in Guardian.students array`,
            standaloneId: String(ss._id),
          });
        }
      }
    }

    // Check hours mismatch between embedded and standalone
    for (const es of embedded) {
      if (!es.standaloneStudentId) continue;
      const ss = standalone.find(s => String(s._id) === String(es.standaloneStudentId));
      if (ss && Math.abs((es.hoursRemaining || 0) - (ss.hoursRemaining || 0)) > 0.001) {
        issues.push({
          guardianId: String(g._id),
          guardianName: `${g.firstName} ${g.lastName}`,
          issue: 'hours_mismatch',
          detail: `Student "${es.firstName} ${es.lastName}" embedded=${es.hoursRemaining}h standalone=${ss.hoursRemaining}h`,
          embeddedId: String(es._id),
          standaloneId: String(ss._id),
          embeddedHours: es.hoursRemaining,
          standaloneHours: ss.hoursRemaining,
        });
      }
    }
  }

  console.log(`Found ${issues.length} issue(s):\n`);
  for (const i of issues) {
    console.log(`[${i.issue}] ${i.guardianName} (${i.guardianId})`);
    console.log(`  ${i.detail}`);
    console.log();
  }

  if (process.argv.includes('--json')) {
    console.log('\n--- JSON ---');
    console.log(JSON.stringify(issues, null, 2));
  }

  await mongoose.disconnect();
})();
