/**
 * Update Salary Settings to New Rate Tier Structure
 * 
 * This script updates existing salary settings from class-type based
 * to hour-tier based rate structure
 */

const mongoose = require('mongoose');
const SalarySettings = require('../models/SalarySettings');
require('dotenv').config();

// New hour-based rate tiers
const NEW_RATE_TIERS = [
  { minHours: 1, maxHours: 60, rateUSD: 3.00, name: '1-60 hours' },
  { minHours: 61, maxHours: 75, rateUSD: 3.25, name: '61-75 hours' },
  { minHours: 76, maxHours: 90, rateUSD: 3.50, name: '76-90 hours' },
  { minHours: 91, maxHours: 110, rateUSD: 3.75, name: '91-110 hours' },
  { minHours: 111, maxHours: 130, rateUSD: 4.00, name: '111-130 hours' },
  { minHours: 131, maxHours: 150, rateUSD: 4.25, name: '131-150 hours' },
  { minHours: 151, maxHours: 999999, rateUSD: 4.50, name: '150+ hours' }
];

async function updateSalarySettings() {
  console.log('🔄 Updating salary settings to new rate tier structure...\n');

  try {
    const settings = await SalarySettings.findOne();
    
    if (!settings) {
      console.log('❌ No settings found. Please run initializeSalarySettings.js first.');
      return;
    }

    console.log('📊 Current partitions:');
    settings.ratePartitions.forEach(p => {
      console.log(`   - ${p.name}: $${p.rateUSD}/hr (${p.minHours}-${p.maxHours} hours)`);
    });

    console.log('\n🔄 Updating to new hour-tier structure...');

    settings.ratePartitions = NEW_RATE_TIERS.map(tier => ({
      name: tier.name,
      minHours: tier.minHours,
      maxHours: tier.maxHours,
      rateUSD: tier.rateUSD,
      description: `Hourly rate for ${tier.minHours}-${tier.maxHours === 999999 ? '150+' : tier.maxHours} hours per month`,
      isActive: true
    }));

    await settings.save();

    console.log('\n✅ Updated successfully!');
    console.log('\n📊 New partitions:');
    settings.ratePartitions.forEach(p => {
      console.log(`   - ${p.name}: $${p.rateUSD}/hr (${p.minHours}-${p.maxHours === 999999 ? '∞' : p.maxHours} hours)`);
    });

    console.log('\n🎉 Update complete!\n');
  } catch (error) {
    console.error('\n❌ Error during update:', error);
    throw error;
  }
}

async function main() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager';
    
    console.log('🔌 Connecting to MongoDB...');
    console.log(`   URI: ${mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    await updateSalarySettings();

    console.log('✨ Closing connection...\n');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { updateSalarySettings };
