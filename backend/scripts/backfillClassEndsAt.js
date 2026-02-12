/*
  Backfill `endsAt` for legacy Class documents.

  Why:
  - The `/api/classes` list endpoint uses `endsAt` for upcoming/previous filtering.
  - Missing `endsAt` forces expensive computed `$expr` filters (collection scans).

  Usage:
    MONGODB_URI="mongodb://..." node scripts/backfillClassEndsAt.js

  Notes:
  - Uses an aggregation-pipeline update (MongoDB 4.2+).
  - Safe to run multiple times.
*/

const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

  const Class = require('../models/Class');

  const filter = {
    $or: [{ endsAt: { $exists: false } }, { endsAt: null }],
    scheduledDate: { $type: 'date' },
  };

  console.log('🔧 Backfilling Class.endsAt where missing...');

  const res = await Class.updateMany(
    filter,
    [
      {
        $set: {
          endsAt: {
            $add: [
              '$scheduledDate',
              {
                $multiply: [
                  { $ifNull: ['$duration', 0] },
                  60000,
                ],
              },
            ],
          },
        },
      },
    ]
  );

  console.log('✅ Backfill complete:', {
    matched: res.matchedCount ?? res.n,
    modified: res.modifiedCount ?? res.nModified,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ backfillClassEndsAt failed:', err);
  process.exitCode = 1;
});
