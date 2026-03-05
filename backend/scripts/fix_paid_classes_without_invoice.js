const mongoose = require('mongoose');
const Class = require('../models/Class');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
};

const toObjectId = (value) => {
  if (!value) return null;
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
};

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function run() {
  const args = parseArgs();
  const guardianId = toObjectId(args.guardian);
  const beforeDate = toDate(args.before);
  const dryRun = Boolean(args['dry-run'] || args.dryRun);

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const filter = {
    paidByGuardian: true,
    $or: [
      { billedInInvoiceId: null },
      { billedInInvoiceId: { $exists: false } }
    ]
  };

  if (guardianId) {
    filter['student.guardianId'] = guardianId;
  }

  if (beforeDate) {
    filter.scheduledDate = { $lt: beforeDate };
  }

  const matches = await Class.find(filter)
    .select('_id scheduledDate status student billedInInvoiceId paidByGuardian')
    .sort({ scheduledDate: 1 })
    .lean();

  if (!matches.length) {
    console.log('No classes found.');
    await mongoose.connection.close();
    return;
  }

  console.log(`Found ${matches.length} class(es) with paidByGuardian=true and no invoice link.`);

  if (dryRun) {
    matches.forEach((cls) => {
      console.log(`[dry-run] ${cls._id} ${cls.scheduledDate} status=${cls.status}`);
    });
    await mongoose.connection.close();
    return;
  }

  const ids = matches.map((cls) => cls._id);
  const result = await Class.updateMany(
    { _id: { $in: ids } },
    {
      $set: { paidByGuardian: false, flaggedUninvoiced: true, billedInInvoiceId: null, billedAt: null },
      $unset: { paidByGuardianAt: 1 }
    }
  );

  console.log(`Updated ${result.modifiedCount || 0} class(es).`);
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});
