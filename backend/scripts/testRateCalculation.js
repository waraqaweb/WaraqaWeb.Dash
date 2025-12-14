const mongoose = require('mongoose');
const SalarySettings = require('../models/SalarySettings');

async function testRateCalculation() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/waraqa');
    console.log('Connected to database\n');
    
    const settings = await SalarySettings.getGlobalSettings();
    
    console.log('Current Rate Tiers:');
    console.log('===================');
    settings.ratePartitions
      .filter(p => p.isActive)
      .sort((a, b) => a.minHours - b.minHours)
      .forEach(p => {
        console.log(`  ${p.minHours}-${p.maxHours}h: $${p.rateUSD}/hr`);
      });
    
    console.log('\nTest: 0.92 hours this month');
    console.log('===========================');
    const rate = settings.getRateForHours(0.92);
    const partition = settings.getPartitionForHours(0.92);
    console.log(`Partition: ${partition}`);
    console.log(`Rate: $${rate}/hr`);
    console.log('');
    console.log('Expected: Since 0.92 < 60, should be in the 1-60h tier at $3.00/hr');
    console.log(`Result: ${rate === 3 ? '✓ CORRECT' : '✗ INCORRECT'}`);
    
    await mongoose.disconnect();
    console.log('\nDisconnected');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testRateCalculation();
