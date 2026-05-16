/* eslint-disable no-console */
// One-off cleanup: run the uninvoiced-lessons resolver with a wide window.
// Usage (inside backend container): node scripts/run_resolve_uninvoiced.js [sinceDays]
const mongoose = require('mongoose');

function summarizeFlagged(lessons) {
  const byReason = {};
  const byGuardian = {};
  for (const l of lessons) {
    byReason[l.reason] = (byReason[l.reason] || 0) + 1;
    const g = l.guardianId || 'unknown';
    byGuardian[g] = (byGuardian[g] || 0) + 1;
  }
  return { total: lessons.length, byReason, byGuardian };
}

async function main() {
  const sinceDays = parseInt(process.argv[2] || '365', 10);
  require('../models/User');
  require('../models/Class');
  require('../models/Invoice');
  require('../models/InvoiceAudit');
  require('../models/Notification');

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri);

  const svc = require('../services/invoiceAuditService');

  const beforeLessons = await svc.findUninvoicedLessons({ sinceDays });
  console.log('BEFORE ' + JSON.stringify(summarizeFlagged(beforeLessons), null, 2));
  for (const l of beforeLessons) {
    console.log('  lesson=' + l.lessonId + ' guardian=' + l.guardianId + ' status=' + l.status + ' date=' + l.scheduledDate + ' reason=' + l.reason);
  }

  const r = await svc.resolveUninvoicedLessons({ sinceDays });
  console.log('RESOLVE ' + JSON.stringify(r.summary, null, 2));

  const afterLessons = await svc.findUninvoicedLessons({ sinceDays });
  console.log('AFTER ' + JSON.stringify(summarizeFlagged(afterLessons), null, 2));
  for (const l of afterLessons) {
    console.log('  lesson=' + l.lessonId + ' guardian=' + l.guardianId + ' status=' + l.status + ' date=' + l.scheduledDate + ' reason=' + l.reason);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('ERR', (e && e.stack) || e);
  process.exit(1);
});
