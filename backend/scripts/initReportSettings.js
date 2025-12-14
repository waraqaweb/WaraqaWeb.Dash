/**
 * Initialize Report Submission Settings
 * Run this once to add the default settings for report submission windows
 */

const mongoose = require('mongoose');
const Setting = require('../models/Setting');

async function initReportSettings() {
  try {
    // Connect to MongoDB
    const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/waraqa';
    await mongoose.connect(mongoURI);
    console.log('Connected to MongoDB');

    // Teacher report window (72 hours)
    const teacherWindow = await Setting.findOne({ key: 'teacher_report_window_hours' });
    if (!teacherWindow) {
      await Setting.create({
        key: 'teacher_report_window_hours',
        value: 72,
        description: 'Number of hours teachers have to submit a class report after the class ends',
      });
      console.log('✓ Created teacher_report_window_hours setting (72 hours)');
    } else {
      console.log('✓ teacher_report_window_hours already exists:', teacherWindow.value, 'hours');
    }

    // Admin extension window (24 hours default)
    const adminExtension = await Setting.findOne({ key: 'admin_extension_hours' });
    if (!adminExtension) {
      await Setting.create({
        key: 'admin_extension_hours',
        value: 24,
        description: 'Default number of hours for admin to extend the report submission window',
      });
      console.log('✓ Created admin_extension_hours setting (24 hours)');
    } else {
      console.log('✓ admin_extension_hours already exists:', adminExtension.value, 'hours');
    }

    console.log('\n✅ Report submission settings initialized successfully!');
    console.log('\nCurrent settings:');
    console.log('  - Teacher submission window:', (await Setting.findOne({ key: 'teacher_report_window_hours' })).value, 'hours');
    console.log('  - Admin extension default:', (await Setting.findOne({ key: 'admin_extension_hours' })).value, 'hours');

    process.exit(0);
  } catch (err) {
    console.error('Error initializing settings:', err);
    process.exit(1);
  }
}

initReportSettings();
