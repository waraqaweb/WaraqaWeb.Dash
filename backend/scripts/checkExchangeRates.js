/**
 * Fix Exchange Rates - Check and fix undefined rates
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');

async function fixRates() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    console.log('🔍 Checking existing rates...');
    const allRates = await MonthlyExchangeRates.find({}).sort({ year: -1, month: -1 });
    
    console.log(`Found ${allRates.length} exchange rate records:\n`);
    allRates.forEach(rate => {
      const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][rate.month - 1];
      console.log(`  ${monthName} ${rate.year}: ${rate.rate} EGP/USD (${rate.locked ? 'locked' : 'unlocked'})`);
    });

    console.log('\n✨ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixRates();
