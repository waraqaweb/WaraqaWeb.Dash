/**
 * Create Admin User Script
 * 
 * This script creates the initial admin user for the system
 * Run this once after setting up the database
 */

const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const createAdmin = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    
    if (existingAdmin) {
      console.log('⚠️  Admin user already exists:', existingAdmin.email);
      process.exit(0);
    }

    // Create admin user
    const adminData = {
      firstName: 'System',
      lastName: 'Administrator',
      email: process.env.ADMIN_EMAIL || 'admin@waraqainc.com',
      password: process.env.ADMIN_PASSWORD || 'admin123456',
      role: 'admin',
      
      isActive: true,
      isEmailVerified: true,
      timezone: 'UTC'
    };

    const admin = new User(adminData);
    await admin.save();

    console.log('✅ Admin user created successfully!');
    console.log('📧 Email:', adminData.email);
    console.log('🔑 Password:', adminData.password);
    console.log('');
    console.log('⚠️  IMPORTANT: Please change the admin password after first login!');
    console.log('🔗 Admin login URL: http://localhost:3000/admin/login');

  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('📤 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the script
createAdmin();

