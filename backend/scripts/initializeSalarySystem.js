/**
 * Initialize Teacher Salary System
 * 
 * This script sets up the initial data required for the teacher salary system:
 * - Creates default salary settings with rate partitions
 * - Sets exchange rates for current and past 3 months
 * - Validates system is ready for invoice generation
 * 
 * Run this script once after deploying the teacher salary system.
 */

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
require('dotenv').config();

dayjs.extend(utc);

const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');

/**
 * Initialize salary settings with default rate partitions
 */
async function initializeSalarySettings() {
  console.log('\n📊 Initializing salary settings...');

  try {
    // This will create default settings if they don't exist
    const settings = await SalarySettings.getGlobalSettings();

    console.log('✅ Salary settings initialized:');
    console.log(`   - Auto-generate invoices: ${settings.autoGenerateInvoices ? 'Enabled' : 'Disabled'}`);
    console.log(`   - Generation day: ${settings.generationDayOfMonth || settings.generationDay || 1}`);
    console.log(`   - Default transfer fee: ${settings.defaultTransferFee.model} - ${settings.defaultTransferFee.value} ${settings.defaultTransferFee.model === 'percentage' ? '%' : 'USD'}`);
    
    if (settings.ratePartitions && settings.ratePartitions.length > 0) {
      console.log(`   - Rate partitions: ${settings.ratePartitions.length} configured`);
      
      settings.ratePartitions
        .filter(p => p.isActive)
        .sort((a, b) => a.minHours - b.minHours)
        .forEach(partition => {
          const hourRange = partition.maxHours > 500
            ? `${partition.minHours}+ hours` 
            : `${partition.minHours}-${partition.maxHours} hours`;
          console.log(`      • ${partition.name}: $${partition.rateUSD}/hour (${hourRange})`);
        });
    } else {
      console.log('   - Rate partitions: No partitions configured');
    }

    return settings;
  } catch (error) {
    console.error('❌ Error initializing salary settings:', error.message);
    throw error;
  }
}

/**
 * Initialize exchange rates for current and past months
 */
async function initializeExchangeRates(months = 4) {
  console.log(`\n💱 Initializing exchange rates for ${months} months...`);

  try {
    const currentDate = dayjs.utc();
    const ratesSet = [];
    const ratesSkipped = [];

    for (let i = 0; i < months; i++) {
      const date = currentDate.subtract(i, 'month');
      const month = date.month() + 1; // dayjs months are 0-indexed
      const year = date.year();

      // Check if rate already exists
      const existingRate = await MonthlyExchangeRates.getRateForMonth(month, year);

      if (existingRate) {
        ratesSkipped.push({
          month,
          year,
          rate: existingRate.rateEGPperUSD,
          locked: existingRate.locked
        });
      } else {
        // Set default rate (you should update this with actual rates)
        const defaultRate = 31.5; // Default USD to EGP rate - UPDATE THIS!
        
        await MonthlyExchangeRates.setRateForMonth(
          month,
          year,
          defaultRate,
          null, // No user ID for system initialization
          'Initial setup - default rate'
        );

        ratesSet.push({ month, year, rate: defaultRate });
      }
    }

    if (ratesSet.length > 0) {
      console.log('✅ Exchange rates set:');
      ratesSet.forEach(({ month, year, rate }) => {
        const monthName = dayjs.utc().month(month - 1).format('MMMM');
        console.log(`   - ${monthName} ${year}: ${rate} EGP/USD`);
      });
    }

    if (ratesSkipped.length > 0) {
      console.log('ℹ️  Exchange rates already exist (skipped):');
      ratesSkipped.forEach(({ month, year, rate, locked }) => {
        const monthName = dayjs.utc().month(month - 1).format('MMMM');
        const lockStatus = locked ? '🔒 locked' : '🔓 unlocked';
        console.log(`   - ${monthName} ${year}: ${rate} EGP/USD (${lockStatus})`);
      });
    }

    return { ratesSet, ratesSkipped };
  } catch (error) {
    console.error('❌ Error initializing exchange rates:', error.message);
    throw error;
  }
}

/**
 * Validate system is ready for invoice generation
 */
async function validateSystemReadiness() {
  console.log('\n🔍 Validating system readiness...');

  const issues = [];

  try {
    // Check salary settings exist
    const settings = await SalarySettings.findOne({ _id: 'global' });
    if (!settings) {
      issues.push('Salary settings not found');
    } else {
      if (!settings.ratePartitions || settings.ratePartitions.length === 0) {
        issues.push('No rate partitions configured');
      } else if (settings.ratePartitions.filter(p => p.isActive).length === 0) {
        issues.push('No active rate partitions configured');
      }
    }

    // Check exchange rates for current month
    const currentDate = dayjs.utc();
    const currentMonth = currentDate.month() + 1;
    const currentYear = currentDate.year();

    const currentRate = await MonthlyExchangeRates.getRateForMonth(currentMonth, currentYear);
    if (!currentRate) {
      issues.push(`Exchange rate missing for current month (${currentDate.format('MMMM YYYY')})`);
    }

    // Check exchange rates for last month (most likely generation target)
    const lastMonthDate = currentDate.subtract(1, 'month');
    const lastMonth = lastMonthDate.month() + 1;
    const lastYear = lastMonthDate.year();

    const lastMonthRate = await MonthlyExchangeRates.getRateForMonth(lastMonth, lastYear);
    if (!lastMonthRate) {
      issues.push(`Exchange rate missing for last month (${lastMonthDate.format('MMMM YYYY')})`);
    }

    if (issues.length === 0) {
      console.log('✅ System is ready for invoice generation!');
      console.log('   - Salary settings configured');
      console.log('   - Active rate partitions exist');
      console.log('   - Exchange rates set for current and last month');
      return true;
    } else {
      console.log('⚠️  System validation issues found:');
      issues.forEach(issue => console.log(`   - ${issue}`));
      return false;
    }
  } catch (error) {
    console.error('❌ Error validating system:', error.message);
    throw error;
  }
}

/**
 * Display helpful next steps
 */
function displayNextSteps() {
  console.log('\n📋 Next Steps:');
  console.log('   1. Review and update exchange rates with actual values');
  console.log('      - Run: node scripts/updateExchangeRate.js <month> <year> <rate>');
  console.log('   2. Adjust rate partitions if needed');
  console.log('      - Use admin API: PUT /api/teacher-salary/admin/settings/partitions/:name');
  console.log('   3. Test invoice generation');
  console.log('      - Run: node scripts/testTeacherInvoiceGeneration.js');
  console.log('   4. Enable auto-generation in production');
  console.log('      - Update SalarySettings.autoGenerateInvoices to true');
  console.log('   5. Configure notification templates for teacher salary events');
  console.log('   6. Update teacher profiles with preferred currency and custom rates');
  console.log('\n✨ Teacher salary system is now initialized!\n');
}

/**
 * Main initialization function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Teacher Salary System Initialization                   ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  try {
    // Connect to MongoDB
    console.log('\n🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Initialize salary settings
    await initializeSalarySettings();

    // Initialize exchange rates
    await initializeExchangeRates(4); // Current + 3 past months

    // Validate system readiness
    const isReady = await validateSystemReadiness();

    // Display next steps
    if (isReady) {
      displayNextSteps();
    } else {
      console.log('\n⚠️  Please resolve the validation issues before using the system.\n');
    }

    console.log('✅ Initialization complete!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Initialization failed:', error);
    process.exit(1);
  }
}

// Run initialization
if (require.main === module) {
  main();
}

module.exports = {
  initializeSalarySettings,
  initializeExchangeRates,
  validateSystemReadiness
};
