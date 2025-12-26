/**
 * Bulk reset passwords for all non-admin users.
 *
 * Usage:
 *   RESET_PASSWORD=waraqa123 node scripts/resetNonAdminPasswords.js
 *
 * Notes:
 * - Default password is "waraqa123" if RESET_PASSWORD is not provided.
 * - Passwords are hashed via the User model pre-save hook to keep per-user salts.
 * - Admin accounts are never touched by this script.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
const TARGET_PASSWORD = process.env.RESET_PASSWORD || 'waraqa123';

const run = async () => {
  if (!TARGET_PASSWORD || TARGET_PASSWORD.length < 6) {
    console.error('❌ RESET_PASSWORD must be at least 6 characters.');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    const filter = { role: { $ne: 'admin' } };
    const users = await User.find(filter).select('firstName lastName email role isActive');

    if (!users.length) {
      console.log('ℹ️  No non-admin users found. Nothing to reset.');
      return;
    }

    console.log(`🔁 Resetting passwords for ${users.length} users...`);

    const affected = [];

    for (const user of users) {
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email;
      user.password = TARGET_PASSWORD; // Triggers hashing via pre-save hook
      user.passwordResetToken = null;
      user.passwordResetExpires = null;

      await user.save();

      affected.push({
        email: user.email,
        role: user.role,
        name: fullName,
        isActive: user.isActive,
      });

      console.log(`  • Updated ${fullName} <${user.email}> (${user.role})`);
    }

    console.log('\n✅ Password reset complete.');
    console.log('📬 Users to notify:');
    affected.forEach((user) => {
      console.log(`   - ${user.name} <${user.email}> (${user.role})`);
    });

    console.log('\n📌 Share the temporary password "' + TARGET_PASSWORD + '" with the above users and remind them to change it after logging in.');
  } catch (error) {
    console.error('❌ Failed to reset passwords:', error?.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    process.exit(process.exitCode || 0);
  }
};

run();
