const mongoose = require('mongoose');
const SalarySettings = require('../models/SalarySettings');

async function checkRateTiers() {
  try {
    await mongoose.connect('mongodb://127.0.0.1:27017/waraqadb');
    console.log('Connected to database\n');
    
    const settings = await SalarySettings.getGlobalSettings();
    
    console.log('Rate Partitions:');
    console.log('================');
    settings.ratePartitions.forEach(p => {
      console.log(`  ${p.name}: ${p.minHours}-${p.maxHours}h = $${p.rateUSD}/hr`);
    });
    
    console.log('\nTest Cases:');
    console.log('===========');
    
    const testHours = [0.91, 1, 10, 50, 51, 100, 101, 200, 201];
    testHours.forEach(hours => {
      const rate = settings.getRateForHours(hours);
      const partition = settings.getPartitionForHours(hours);
      console.log(`  ${hours} hours → Partition: ${partition}, Rate: $${rate}/hr`);
    });
    
    await mongoose.disconnect();
    console.log('\nDisconnected');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkRateTiers();
