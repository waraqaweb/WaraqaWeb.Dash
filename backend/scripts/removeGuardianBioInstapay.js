/**
 * Migration script: remove guardian-specific bio and instapay fields from existing documents
 * Run with: node scripts/removeGuardianBioInstapay.js
 */
const mongoose = require('mongoose');
require('dotenv').config();
const User = require('../models/User');

async function run() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
  await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log('Connected to DB:', MONGODB_URI);

  try {
    const res = await User.updateMany(
      { role: 'guardian' },
      {
        $unset: {
          bio: '',
          instapayName: '',
          'guardianInfo.instapayName': ''
        }
      }
    );
    console.log('Update result:', res);
  } catch (err) {
    console.error('Migration failed', err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected, exiting');
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Unexpected error', err);
  process.exit(1);
});
