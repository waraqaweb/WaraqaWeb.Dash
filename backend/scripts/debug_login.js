// Quick debug script to verify seeded users and password comparison
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config();

const User = require('../models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager';

async function check(email, plain) {
  const u = await User.findOne({ email }).select('+password');
  if (!u) {
    console.log(`[NOT FOUND] ${email}`);
    return;
  }
  const ok = await bcrypt.compare(plain, u.password);
  console.log(`[FOUND] ${email} role=${u.role} active=${u.isActive} locked=${u.lockUntil && u.lockUntil > Date.now()} attempts=${u.loginAttempts}`);
  console.log(`  passwordHash=${u.password}`);
  console.log(`  compare('${plain}') => ${ok}`);
}

(async () => {
  try {
    await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB');

    await check(process.env.ADMIN_EMAIL || 'admin@waraqa.co', process.env.ADMIN_PASSWORD || 'Admin@123');
    await check('ahmed.ismail@waraqa.co', 'Teacher@123');
    await check('lamiaa.ali@waraqa.co', 'Teacher@123');
    await check('mariam.elsayed@waraqa.co', 'Guardian@123');
    await check('khaled.mostafa@waraqa.co', 'Guardian@123');
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
})();
