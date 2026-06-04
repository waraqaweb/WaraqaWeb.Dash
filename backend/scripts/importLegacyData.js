// importLegacyData.js
// Usage: node scripts/importLegacyData.js
// Imports legacy guardian registrations and evaluation bookings from CSVs in legacy-data/

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Meeting = require('../models/Meeting');

const GUARDIAN_CSV = path.join(__dirname, '../../legacy-data/Waraqa_Registration_Form_2026-05-20_12_40_39.csv');
const EVAL_CSV = path.join(__dirname, '../../legacy-data/New_Student_Evaluation2026-05-20_12_41_06.csv');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

async function importGuardians() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(GUARDIAN_CSV)
      .pipe(csv())
      .on('data', (row) => results.push(row))
      .on('end', async () => {
        for (const row of results) {
          const email = row.Email?.trim().toLowerCase();
          if (!email) continue;
          const existing = await User.findOne({ email });
          if (existing) continue;
          // Add as guardian
          const notes = Object.entries(row)
            .filter(([k]) => !['Email', 'Guardian Name', 'Phone', 'Country', 'Date of Birth'].includes(k))
            .map(([k, v]) => `${k}: ${v}`)
            .join(' | ');
          await User.create({
            email,
            role: 'guardian',
            fullName: row['Guardian Name'] || '',
            phone: row['Phone'] || '',
            country: row['Country'] || '',
            dateOfBirth: row['Date of Birth'] || '',
            notes,
            legacy: true,
          });
        }
        resolve();
      })
      .on('error', reject);
  });
}

async function importEvaluations() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(EVAL_CSV)
      .pipe(csv())
      .on('data', (row) => results.push(row))
      .on('end', async () => {
        for (const row of results) {
          // Use guardian email as organizer
          const email = row.Email?.trim().toLowerCase();
          const guardian = await User.findOne({ email });
          // Compose meeting notes from extra fields
          const notes = Object.entries(row)
            .filter(([k]) => !['Email', 'Gurdian Name', 'Phone / Whatsapp', 'Country', 'Student Name', 'Second Student', 'Third Student', 'Fourth Student', 'Evaluation Time'].includes(k))
            .map(([k, v]) => `${k}: ${v}`)
            .join(' | ');
          await Meeting.create({
            title: 'Legacy Evaluation',
            organizer: guardian?._id,
            participants: [row['Student Name'], row['Second Student'], row['Third Student'], row['Fourth Student']].filter(Boolean).map(name => ({ name })),
            scheduledFor: row['Evaluation Time'] || '',
            notes,
            legacy: true,
          });
        }
        resolve();
      })
      .on('error', reject);
  });
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  await importGuardians();
  await importEvaluations();
  await mongoose.disconnect();
  console.log('Legacy data import complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
