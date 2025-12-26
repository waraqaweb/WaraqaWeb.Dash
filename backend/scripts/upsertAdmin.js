/**
 * Upsert Admin User Script
 *
 * Creates or updates an admin user by email.
 *
 * Usage:
 *   ADMIN_EMAIL=waraqainc@gmail.com ADMIN_PASSWORD='somepass' node scripts/upsertAdmin.js
 *
 * Notes:
 * - Password should be provided in plain text; it will be hashed by the User model pre-save hook.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

const run = async () => {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';

  if (!email) {
    console.error('❌ ADMIN_EMAIL is required');
    process.exit(1);
  }

  if (!password || password.length < 6) {
    console.error('❌ ADMIN_PASSWORD is required (min 6 chars)');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✅ Connected to MongoDB');

    const existing = await User.findOne({ email }).select('+password');

    if (!existing) {
      const admin = await User.create({
        firstName: 'Waraqa',
        lastName: 'Admin',
        email,
        password,
        role: 'admin',
        isActive: true,
        isEmailVerified: true,
        timezone: 'UTC'
      });

      console.log('✅ Admin user created');
      console.log('📧 Email:', admin.email);
      console.log('🔑 Password:', password);
      return;
    }

    const previousRole = existing.role;

    existing.role = 'admin';
    existing.isActive = true;
    existing.isEmailVerified = true;

    if (!existing.firstName) existing.firstName = 'Waraqa';
    if (!existing.lastName) existing.lastName = 'Admin';

    // Always reset password to the provided one (explicit request: "any password")
    existing.password = password;

    await existing.save();

    console.log('✅ Admin user updated');
    console.log('📧 Email:', existing.email);
    console.log('🔁 Role:', `${previousRole} -> ${existing.role}`);
    console.log('🔑 Password reset to:', password);
  } catch (err) {
    console.error('❌ Failed to upsert admin user:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    process.exit(process.exitCode || 0);
  }
};

run();
