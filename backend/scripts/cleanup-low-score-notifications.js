require('dotenv').config();
const mongoose = require('mongoose');
require('../models/Notification');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Notification = mongoose.model('Notification');

  // Count first
  const count = await Notification.countDocuments({ 'metadata.kind': 'low_score_followup' });
  console.log('Found low_score_followup notifications:', count);

  if (count > 0) {
    const result = await Notification.deleteMany({ 'metadata.kind': 'low_score_followup' });
    console.log('Deleted:', result.deletedCount);
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
