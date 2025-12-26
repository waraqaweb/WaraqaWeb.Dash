/**
 * Initialize Salary Settings and Exchange Rates
 * 
 * Run this script ONCE to set up initial salary settings and exchange rates.
 * This creates default values in the database so invoice generation works.
 * 
 * Usage:
 *   node scripts/initializeSalarySettings.js
 * 
 * What it does:
 * - Creates default salary rate partitions (if not exist)
 * - Creates default transfer fees (if not exist)
 * - Adds exchange rates for past 3 months and future 3 months (if not exist)
 */

const mongoose = require('mongoose');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
require('dotenv').config();

// Default exchange rate (ADJUST THIS TO YOUR ACTUAL RATE)
const DEFAULT_EXCHANGE_RATE = 31.50;

// Default hourly rate tiers (based on total monthly hours)
const DEFAULT_RATE_TIERS = [
  { minHours: 1, maxHours: 60, rateUSD: 3.00, name: '1-60 hours' },
  { minHours: 61, maxHours: 75, rateUSD: 3.25, name: '61-75 hours' },
  { minHours: 76, maxHours: 90, rateUSD: 3.50, name: '76-90 hours' },
  { minHours: 91, maxHours: 110, rateUSD: 3.75, name: '91-110 hours' },
  { minHours: 111, maxHours: 130, rateUSD: 4.00, name: '111-130 hours' },
  { minHours: 131, maxHours: 150, rateUSD: 4.25, name: '131-150 hours' },
  { minHours: 151, maxHours: 999999, rateUSD: 4.50, name: '150+ hours' }
];

// Default transfer fee (flat rate in EGP)
const DEFAULT_TRANSFER_FEE = 25; // EGP

async function initializeSalarySettings() {
  console.log('🚀 Starting salary settings initialization...\n');

  try {
    // 1. Check if settings already exist
    console.log('1️⃣  Checking for existing salary settings...');
    const existingSettings = await SalarySettings.findOne();
    
    if (existingSettings) {
      console.log('   ✅ Salary settings already exist');
      console.log('   📊 Current partitions:');
      existingSettings.ratePartitions.forEach(p => {
        console.log(`      - ${p.name}: $${p.rateUSD}/hr`);
      });
    } else {
      console.log('   ⚠️  No settings found, creating default settings...');
      
      const settings = new SalarySettings({
        ratePartitions: DEFAULT_RATE_TIERS.map(tier => ({
          name: tier.name,
          minHours: tier.minHours,
          maxHours: tier.maxHours,
          rateUSD: tier.rateUSD,
          description: `Hourly rate for ${tier.minHours}-${tier.maxHours === 999999 ? '150+' : tier.maxHours} hours per month`,
          isActive: true
        })),
        defaultTransferFee: {
          model: 'flat',
          value: DEFAULT_TRANSFER_FEE
        }
      });

      await settings.save();
      console.log('   ✅ Salary settings created successfully!');
      console.log('   📊 Partitions created:');
      settings.ratePartitions.forEach(p => {
        console.log(`      - ${p.name}: $${p.rateUSD}/hr`);
      });
      console.log('   💰 Transfer fees:');
      console.log(`      - Model: ${settings.defaultTransferFee.model}`);
      console.log(`      - Value: ${settings.defaultTransferFee.value}`);
    }

    // 2. Check and add exchange rates
    console.log('\n2️⃣  Checking exchange rates...');
    
    const now = new Date();
    const ratesToAdd = [];
    const existingRatesCount = await MonthlyExchangeRates.countDocuments();
    
    console.log(`   📈 Found ${existingRatesCount} existing exchange rates`);
    
    // Generate rates for past 3 months and future 3 months
    for (let i = -3; i <= 3; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const month = date.getMonth() + 1;
      const year = date.getFullYear();
      const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      
      const existingRate = await MonthlyExchangeRates.findOne({ month, year });
      
      if (existingRate) {
        console.log(`   ✅ ${monthName}: ${existingRate.rate} EGP/USD (exists)`);
      } else {
        ratesToAdd.push({
          month,
          year,
          rate: DEFAULT_EXCHANGE_RATE,
          source: "Initial Setup Script",
          notes: "Auto-generated default rate - please update to actual rate",
          setBy: null
        });
        console.log(`   ⚠️  ${monthName}: Will add default rate (${DEFAULT_EXCHANGE_RATE} EGP/USD)`);
      }
    }

    if (ratesToAdd.length > 0) {
      await MonthlyExchangeRates.insertMany(ratesToAdd);
      console.log(`\n   ✅ Added ${ratesToAdd.length} exchange rates`);
    } else {
      console.log('\n   ✅ All exchange rates already set');
    }

    // 3. Summary
    console.log('\n📋 Summary:');
    console.log('   ✅ Salary settings: Initialized');
    console.log('   ✅ Exchange rates: Initialized');
    console.log('\n🎉 Initialization complete!');
    console.log('\n📝 Next Steps:');
    console.log('   1. Review and adjust exchange rates in the UI (/admin/salary-settings)');
    console.log('   2. Review and adjust hourly rates if needed');
    console.log('   3. Review and adjust transfer fees if needed');
    console.log('   4. Generate test invoice to verify calculations');
    console.log('\n⚠️  IMPORTANT: Default exchange rate is set to ' + DEFAULT_EXCHANGE_RATE + ' EGP/USD');
    console.log('   Please update to actual rates in the Salary Settings page!\n');

  } catch (error) {
    console.error('\n❌ Error during initialization:', error);
    throw error;
  }
}

// Connect to database and run
async function main() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';
    
    console.log('🔌 Connecting to MongoDB...');
    console.log(`   URI: ${mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@')}`);
    
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    await initializeSalarySettings();

    console.log('✨ All done! Closing connection...\n');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { initializeSalarySettings };
