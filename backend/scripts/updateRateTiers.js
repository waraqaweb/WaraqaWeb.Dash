const mongoose = require('mongoose');
const SalarySettings = require('../models/SalarySettings');

async function updateRateTiers() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/waraqadb');
    console.log('Connected to database\n');
    
    let settings = await SalarySettings.findById('global');
    
    if (!settings) {
      console.log('Creating new salary settings...');
      settings = new SalarySettings({ _id: 'global' });
    }
    
    console.log('Current rate partitions:', settings.ratePartitions.length);
    
    // Clear existing partitions
    settings.ratePartitions = [];
    
    // Add new rate tiers based on monthly hours
    const newTiers = [
      { name: '1-60h', minHours: 0, maxHours: 60, rateUSD: 3.00, description: 'Entry level - up to 60 hours per month', isActive: true },
      { name: '61-75h', minHours: 61, maxHours: 75, rateUSD: 3.25, description: 'Level 2 - 61 to 75 hours per month', isActive: true },
      { name: '76-90h', minHours: 76, maxHours: 90, rateUSD: 3.50, description: 'Level 3 - 76 to 90 hours per month', isActive: true },
      { name: '91-110h', minHours: 91, maxHours: 110, rateUSD: 3.75, description: 'Level 4 - 91 to 110 hours per month', isActive: true },
      { name: '111-130h', minHours: 111, maxHours: 130, rateUSD: 4.00, description: 'Level 5 - 111 to 130 hours per month', isActive: true },
      { name: '131-150h', minHours: 131, maxHours: 150, rateUSD: 4.25, description: 'Level 6 - 131 to 150 hours per month', isActive: true },
      { name: '151+h', minHours: 151, maxHours: 999999, rateUSD: 4.50, description: 'Top level - 151+ hours per month', isActive: true }
    ];
    
    console.log('\nNew Rate Tiers:');
    console.log('===============');
    newTiers.forEach(tier => {
      settings.ratePartitions.push(tier);
      console.log(`  ${tier.name}: ${tier.minHours}-${tier.maxHours}h = $${tier.rateUSD.toFixed(2)}/hr`);
    });
    
    settings.rateModel = 'flat';
    settings.lastModifiedAt = new Date();
    
    await settings.save();
    
    console.log('\n✓ Rate tiers updated successfully!');
    console.log('\nVerification:');
    console.log('=============');
    const testCases = [0.92, 1, 50, 60, 65, 80, 100, 120, 140, 160];
    testCases.forEach(hours => {
      const rate = settings.getRateForHours(hours);
      const partition = settings.getPartitionForHours(hours);
      console.log(`  ${hours}h → ${partition || 'N/A'} = $${rate.toFixed(2)}/hr`);
    });
    
    await mongoose.disconnect();
    console.log('\nDisconnected');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateRateTiers();
