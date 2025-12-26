/**
 * Update Exchange Rate Utility
 * 
 * Allows admins to set or update monthly exchange rates via command line.
 * 
 * Usage: node scripts/updateExchangeRate.js <month> <year> <rate> [reason]
 * Example: node scripts/updateExchangeRate.js 12 2024 31.85 "Official central bank rate"
 */

const mongoose = require('mongoose');
const dayjs = require('dayjs');
require('dotenv').config();

const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');

/**
 * Parse and validate command line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('❌ Insufficient arguments');
    console.log('\nUsage: node scripts/updateExchangeRate.js <month> <year> <rate> [reason]');
    console.log('Example: node scripts/updateExchangeRate.js 12 2024 31.85 "Official central bank rate"');
    process.exit(1);
  }

  const month = parseInt(args[0], 10);
  const year = parseInt(args[1], 10);
  const rate = parseFloat(args[2]);
  const reason = args[3] || 'Manual update via script';

  // Validate month
  if (isNaN(month) || month < 1 || month > 12) {
    console.error('❌ Invalid month. Must be 1-12.');
    process.exit(1);
  }

  // Validate year
  if (isNaN(year) || year < 2020 || year > 2100) {
    console.error('❌ Invalid year. Must be between 2020 and 2100.');
    process.exit(1);
  }

  // Validate rate
  if (isNaN(rate) || rate <= 0) {
    console.error('❌ Invalid rate. Must be a positive number.');
    process.exit(1);
  }

  return { month, year, rate, reason };
}

/**
 * Update exchange rate
 */
async function updateExchangeRate(month, year, rate, reason) {
  const monthName = dayjs().month(month - 1).format('MMMM');

  console.log(`\n💱 Updating exchange rate for ${monthName} ${year}...`);
  console.log(`   Rate: ${rate} EGP/USD`);
  console.log(`   Reason: ${reason}`);

  try {
    // Check if rate already exists
    const existing = await MonthlyExchangeRates.getRateForMonth(month, year);

    if (existing) {
      console.log(`\n   ℹ️  Existing rate found: ${existing.rateEGPperUSD} EGP/USD`);
      
      if (existing.locked) {
        console.log('   ⚠️  WARNING: This rate is LOCKED!');
        console.log('   Locked rates have been used to generate invoices.');
        console.log('   Changing a locked rate may cause inconsistencies.\n');
        
        // Ask for confirmation (in production, you might want to prevent this entirely)
        console.log('   Please unlock the rate via admin panel before updating.');
        process.exit(1);
      }

      // Update existing rate
      await existing.updateRate(rate, 'System', reason);
      console.log('\n✅ Exchange rate updated successfully!');
      console.log(`   Previous rate: ${existing.rateEGPperUSD} EGP/USD`);
      console.log(`   New rate: ${rate} EGP/USD`);
      console.log(`   Modification count: ${existing.modificationHistory.length}`);
    } else {
      // Create new rate
      await MonthlyExchangeRates.setRateForMonth(month, year, rate, 'System', reason);
      console.log('\n✅ Exchange rate set successfully!');
      console.log(`   ${monthName} ${year}: ${rate} EGP/USD`);
    }

    return true;
  } catch (error) {
    console.error('\n❌ Failed to update exchange rate:', error.message);
    throw error;
  }
}

/**
 * Display all rates for a year
 */
async function displayYearRates(year) {
  console.log(`\n📊 Exchange rates for ${year}:`);

  try {
    const rates = await MonthlyExchangeRates.getRatesForYear(year);

    if (rates.length === 0) {
      console.log('   No rates set for this year');
      return;
    }

    rates.sort((a, b) => a.month - b.month);

    rates.forEach(rate => {
      const monthName = dayjs().month(rate.month - 1).format('MMMM');
      const lockStatus = rate.locked ? '🔒' : '🔓';
      const modCount = rate.modificationHistory.length;
      console.log(`   ${lockStatus} ${monthName}: ${rate.rateEGPperUSD} EGP/USD (${modCount} modifications)`);
    });

    // Check for missing months
    const setMonths = rates.map(r => r.month);
    const missingMonths = [];
    for (let m = 1; m <= 12; m++) {
      if (!setMonths.includes(m)) {
        missingMonths.push(dayjs().month(m - 1).format('MMMM'));
      }
    }

    if (missingMonths.length > 0) {
      console.log(`\n   ⚠️  Missing months: ${missingMonths.join(', ')}`);
    }
  } catch (error) {
    console.error('   ❌ Error fetching rates:', error.message);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Exchange Rate Update Utility                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const { month, year, rate, reason } = parseArguments();

  try {
    // Connect to MongoDB
    console.log('\n🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Update the rate
    await updateExchangeRate(month, year, rate, reason);

    // Display all rates for the year
    await displayYearRates(year);

    console.log('\n✨ Done!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Operation failed:', error);
    process.exit(1);
  }
}

// Run script
if (require.main === module) {
  main();
}

module.exports = { updateExchangeRate };
