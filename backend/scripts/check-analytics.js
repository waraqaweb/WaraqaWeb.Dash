require('dotenv').config();
const mongoose = require('mongoose');
const UserActivity = require('../models/UserActivity');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const total = await UserActivity.countDocuments();
  console.log('Total UserActivity records:', total);

  const today = new Date();
  const utcMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const todayCount = await UserActivity.countDocuments({ date: utcMidnight });
  console.log('Today records:', todayCount, '(date:', utcMidnight.toISOString(), ')');

  const recent = await UserActivity.find().sort({ date: -1 }).limit(10).lean();
  console.log('\nRecent 10 records:');
  for (const r of recent) {
    console.log(JSON.stringify({
      user: r.user,
      date: r.date,
      deviceId: r.deviceId,
      auth: r.auth
    }));
  }

  // Check socket.io connection won't work from script, but check if any records exist for last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 29);
  const start30 = new Date(Date.UTC(thirtyDaysAgo.getUTCFullYear(), thirtyDaysAgo.getUTCMonth(), thirtyDaysAgo.getUTCDate()));

  const monthlyCount = await UserActivity.countDocuments({ date: { $gte: start30 } });
  console.log('\nLast 30 days records:', monthlyCount);

  // Run the same aggregation as dashboard
  const authMatch = {
    $or: [{ 'auth.isImpersonated': { $ne: true } }, { 'auth.isImpersonated': { $exists: false } }]
  };

  const dailyAgg = await UserActivity.aggregate([
    { $match: { date: utcMidnight } },
    { $match: authMatch },
    { $group: { _id: { $ifNull: ['$deviceId', '$user'] } } },
    { $count: 'count' }
  ]);
  console.log('\nDaily unique (same query as dashboard):', dailyAgg?.[0]?.count || 0);

  const monthlyAgg = await UserActivity.aggregate([
    { $match: { date: { $gte: start30 } } },
    { $match: authMatch },
    { $group: { _id: { $ifNull: ['$deviceId', '$user'] } } },
    { $count: 'count' }
  ]);
  console.log('30-day unique (same query as dashboard):', monthlyAgg?.[0]?.count || 0);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
