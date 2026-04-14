require('dotenv').config();
const mongoose = require('mongoose');
const UserActivity = require('../models/UserActivity');
const User = require('../models/User');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Try to manually record a visit for admin user
  const adminUser = await User.findOne({ role: 'admin' }).select('_id email').lean();
  if (!adminUser) {
    console.log('No admin user found');
    process.exit(1);
  }
  console.log('Admin:', adminUser._id, adminUser.email);

  // Try record with raw upsert to see the error
  try {
    const today = new Date();
    const utcMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const doc = { user: adminUser._id, date: utcMidnight, deviceId: 'test-device-123' };
    const update = { $setOnInsert: doc, $set: { deviceId: 'test-device-123', 'auth.isAdmin': true, 'auth.isImpersonated': false } };
    const result = await UserActivity.updateOne({ user: adminUser._id, date: utcMidnight }, update, { upsert: true });
    console.log('Raw upsert result:', JSON.stringify(result));
  } catch (e) {
    console.error('Raw upsert error:', e.message, e.code, e.codeName);
  }

  const result = await UserActivity.recordVisit(adminUser._id, {
    deviceId: 'test-device-123',
    auth: { isImpersonated: false, isAdmin: true }
  });
  console.log('recordVisit result:', result);

  // Check if it was written
  const today = new Date();
  const utcMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const todayRecords = await UserActivity.find({ date: utcMidnight }).lean();
  console.log('Today records after insert:', todayRecords.length);
  todayRecords.forEach(r => console.log(JSON.stringify({ user: r.user, date: r.date, deviceId: r.deviceId })));

  // Run the aggregation
  const authMatch = {
    $or: [{ 'auth.isImpersonated': { $ne: true } }, { 'auth.isImpersonated': { $exists: false } }]
  };
  const dailyAgg = await UserActivity.aggregate([
    { $match: { date: utcMidnight } },
    { $match: authMatch },
    { $group: { _id: { $ifNull: ['$deviceId', '$user'] } } },
    { $count: 'count' }
  ]);
  console.log('Daily unique after test insert:', dailyAgg?.[0]?.count || 0);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
