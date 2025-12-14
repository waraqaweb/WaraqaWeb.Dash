// backend/test/testModule8SettingsManagement.js
/**
 * Test Suite for Module 8: Settings Management UI
 * 
 * Tests all settings management features including:
 * - Salary settings CRUD
 * - Rate partitions management
 * - Exchange rates management
 * - Transfer fee configuration
 * - Change history tracking
 */

require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');

// Test data
let testAdmin, testTeacher;

async function setup() {
  console.log('\n🔧 Setting up test environment...\n');

  // Create test users
  testAdmin = await User.create({
    email: 'admin.settings@test.com',
    password: 'hashedpassword',
    firstName: 'Settings',
    lastName: 'Admin',
    role: 'admin',
    isActive: true
  });

  testTeacher = await User.create({
    email: 'teacher.settings@test.com',
    password: 'hashedpassword',
    firstName: 'Test',
    lastName: 'Teacher',
    role: 'teacher',
    isActive: true
  });

  // Create salary settings
  await SalarySettings.create({
    _id: 'global',
    rateModel: 'progressive',
    ratePartitions: [
      {
        name: '0-50h',
        minHours: 0,
        maxHours: 50,
        rateUSD: 15.0,
        description: 'Base rate',
        isActive: true
      },
      {
        name: '51-100h',
        minHours: 51,
        maxHours: 100,
        rateUSD: 16.5,
        description: '10% bonus',
        isActive: true
      }
    ],
    defaultTransferFee: {
      model: 'flat',
      value: 10
    },
    autoGenerateInvoices: false,
    generationDay: 1,
    notifyTeachersOnPublish: true,
    lastModifiedBy: testAdmin._id
  });

  // Create some exchange rates
  await MonthlyExchangeRates.create({
    year: 2025,
    month: 1,
    rate: 30.5,
    source: 'System Default',
    setBy: testAdmin._id
  });

  await MonthlyExchangeRates.create({
    year: 2025,
    month: 2,
    rate: 31.0,
    source: 'Manual Override',
    setBy: testAdmin._id
  });

  console.log('✅ Test data created successfully');
  console.log(`   - Created salary settings with 2 rate partitions`);
  console.log(`   - Created 2 exchange rates`);
  console.log(`   - Created 1 admin, 1 teacher\n`);
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...\n');
  
  await User.deleteMany({ email: { $regex: /@test\.com$/ } });
  await SalarySettings.deleteMany({});
  await MonthlyExchangeRates.deleteMany({});
  
  console.log('✅ Cleanup complete\n');
}

// Test Cases

async function testGetSalarySettings() {
  console.log('⚙️  Test 1: Get Salary Settings');
  
  try {
    const settings = await SalarySettings.findById('global')
      .populate('lastModifiedBy', 'firstName lastName');

    if (!settings) {
      throw new Error('Salary settings not found');
    }

    if (settings.rateModel !== 'progressive') {
      throw new Error(`Expected rate model 'progressive', got '${settings.rateModel}'`);
    }

    if (settings.ratePartitions.length !== 2) {
      throw new Error(`Expected 2 partitions, got ${settings.ratePartitions.length}`);
    }

    if (settings.defaultTransferFee.value !== 10) {
      throw new Error(`Expected transfer fee 10, got ${settings.defaultTransferFee.value}`);
    }

    console.log('✅ PASS - Salary settings retrieved successfully');
    console.log(`   Rate Model: ${settings.rateModel}`);
    console.log(`   Partitions: ${settings.ratePartitions.length}`);
    console.log(`   Transfer Fee: ${settings.defaultTransferFee.value} EGP (${settings.defaultTransferFee.model})\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testUpdateSalarySettings() {
  console.log('📝 Test 2: Update Salary Settings');
  
  try {
    const settings = await SalarySettings.findById('global');

    const originalAutoPublish = settings.autoGenerateInvoices;
    const originalGenerationDay = settings.generationDay;

    // Update settings
    settings.autoGenerateInvoices = !originalAutoPublish;
    settings.generationDay = 5;
    settings.changeHistory.push({
      field: 'autoGenerateInvoices',
      oldValue: originalAutoPublish,
      newValue: !originalAutoPublish,
      changedBy: testAdmin._id,
      note: 'Test update'
    });
    settings.lastModifiedBy = testAdmin._id;
    settings.lastModifiedAt = new Date();

    await settings.save();

    // Verify update
    const updated = await SalarySettings.findById('global');
    
    if (updated.autoGenerateInvoices === originalAutoPublish) {
      throw new Error('Auto publish setting not updated');
    }

    if (updated.generationDay !== 5) {
      throw new Error('Invoice generation day not updated');
    }

    if (updated.changeHistory.length === 0) {
      throw new Error('Change history not recorded');
    }

    console.log('✅ PASS - Salary settings updated successfully');
    console.log(`   Auto Generate: ${originalAutoPublish} → ${updated.autoGenerateInvoices}`);
    console.log(`   Generation Day: ${originalGenerationDay} → ${updated.generationDay}`);
    console.log(`   Change History: ${updated.changeHistory.length} entries\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testGetRatePartitions() {
  console.log('📊 Test 3: Get Rate Partitions');
  
  try {
    const settings = await SalarySettings.findById('global');

    const partitions = settings.ratePartitions;

    if (partitions.length !== 2) {
      throw new Error(`Expected 2 partitions, got ${partitions.length}`);
    }

    // Validate first partition
    const first = partitions[0];
    if (!first.name || !first.rateUSD || first.minHours === undefined) {
      throw new Error('Partition missing required fields');
    }

    console.log('✅ PASS - Rate partitions retrieved successfully');
    partitions.forEach((p, i) => {
      console.log(`   #${i + 1}: ${p.name} (${p.minHours}-${p.maxHours}h) @ $${p.rateUSD}/h`);
    });
    console.log('');
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testAddRatePartition() {
  console.log('➕ Test 4: Add Rate Partition');
  
  try {
    const settings = await SalarySettings.findById('global');

    const initialCount = settings.ratePartitions.length;

    // Add new partition
    settings.ratePartitions.push({
      name: '101+h',
      minHours: 101,
      maxHours: Infinity,
      rateUSD: 18.0,
      description: '20% bonus',
      isActive: true
    });

    settings.changeHistory.push({
      field: 'ratePartitions',
      oldValue: null,
      newValue: { name: '101+h', minHours: 101, maxHours: Infinity, rateUSD: 18.0 },
      changedBy: testAdmin._id,
      note: 'Added new rate partition'
    });

    settings.lastModifiedBy = testAdmin._id;
    settings.lastModifiedAt = new Date();

    await settings.save();

    // Verify addition
    const updated = await SalarySettings.findById('global');

    if (updated.ratePartitions.length !== initialCount + 1) {
      throw new Error('Partition not added');
    }

    const newPartition = updated.ratePartitions[updated.ratePartitions.length - 1];
    if (newPartition.name !== '101+h' || newPartition.rateUSD !== 18.0) {
      throw new Error('Partition data incorrect');
    }

    console.log('✅ PASS - Rate partition added successfully');
    console.log(`   Name: ${newPartition.name}`);
    console.log(`   Range: ${newPartition.minHours}-${newPartition.maxHours}h`);
    console.log(`   Rate: $${newPartition.rateUSD}/h\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testUpdateRatePartition() {
  console.log('✏️  Test 5: Update Rate Partition');
  
  try {
    const settings = await SalarySettings.findById('global');

    const partition = settings.ratePartitions[0];
    const originalRate = partition.rateUSD;

    // Update partition
    partition.rateUSD = 16.0;
    partition.description = 'Updated base rate';

    settings.changeHistory.push({
      field: 'ratePartitions',
      oldValue: { name: partition.name, rateUSD: originalRate },
      newValue: { name: partition.name, rateUSD: 16.0 },
      changedBy: testAdmin._id,
      note: 'Updated rate partition'
    });

    settings.lastModifiedBy = testAdmin._id;
    settings.lastModifiedAt = new Date();

    await settings.save();

    // Verify update
    const updated = await SalarySettings.findById('global');
    const updatedPartition = updated.ratePartitions[0];

    if (updatedPartition.rateUSD !== 16.0) {
      throw new Error('Partition rate not updated');
    }

    if (updatedPartition.description !== 'Updated base rate') {
      throw new Error('Partition description not updated');
    }

    console.log('✅ PASS - Rate partition updated successfully');
    console.log(`   Rate: $${originalRate} → $${updatedPartition.rateUSD}/h`);
    console.log(`   Description: ${updatedPartition.description}\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testDeleteRatePartition() {
  console.log('🗑️  Test 6: Delete Rate Partition');
  
  try {
    const settings = await SalarySettings.findById('global');

    const initialCount = settings.ratePartitions.length;
    
    if (initialCount <= 1) {
      throw new Error('Need at least 2 partitions to test deletion');
    }

    const partitionToDelete = settings.ratePartitions[settings.ratePartitions.length - 1];
    const deletedName = partitionToDelete.name;

    // Use MongoDB's pull method to remove
    settings.ratePartitions.pull(partitionToDelete._id);

    settings.changeHistory.push({
      field: 'ratePartitions',
      oldValue: { name: deletedName },
      newValue: null,
      changedBy: testAdmin._id,
      note: `Deleted partition: ${deletedName}`
    });

    settings.lastModifiedBy = testAdmin._id;
    settings.lastModifiedAt = new Date();

    await settings.save();

    // Verify deletion
    const updated = await SalarySettings.findById('global');

    if (updated.ratePartitions.length !== initialCount - 1) {
      throw new Error('Partition not deleted');
    }

    console.log('✅ PASS - Rate partition deleted successfully');
    console.log(`   Deleted: ${deletedName}`);
    console.log(`   Remaining: ${updated.ratePartitions.length} partitions\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testGetExchangeRates() {
  console.log('💱 Test 7: Get Exchange Rates');
  
  try {
    const rates = await MonthlyExchangeRates.find({
      year: 2025,
      month: { $in: [1, 2] }
    })
      .sort({ year: -1, month: -1 })
      .limit(12);

    if (rates.length < 2) {
      throw new Error(`Expected at least 2 rates, got ${rates.length}`);
    }

    // Validate first rate
    const first = rates[0];
    if (!first.year || !first.month || !first.rate) {
      throw new Error('Rate missing required fields');
    }

    console.log('✅ PASS - Exchange rates retrieved successfully');
    rates.forEach(r => {
      console.log(`   ${r.year}-${String(r.month).padStart(2, '0')}: ${r.rate} EGP/USD`);
    });
    console.log('');
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testSetExchangeRate() {
  console.log('💵 Test 8: Set Exchange Rate');
  
  try {
    // Create new rate
    const newRate = await MonthlyExchangeRates.create({
      year: 2025,
      month: 3,
      rate: 31.5,
      source: 'Test Source',
      setBy: testAdmin._id,
      note: 'Test rate'
    });

    if (!newRate || newRate.rate !== 31.5) {
      throw new Error('Exchange rate not created correctly');
    }

    // Verify it was saved
    const found = await MonthlyExchangeRates.findOne({ year: 2025, month: 3 });

    if (!found || found.rate !== 31.5) {
      throw new Error('Exchange rate not found in database');
    }

    console.log('✅ PASS - Exchange rate set successfully');
    console.log(`   Period: ${found.year}-${String(found.month).padStart(2, '0')}`);
    console.log(`   Rate: ${found.rate} EGP/USD`);
    console.log(`   Source: ${found.source}\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testUpdateExchangeRate() {
  console.log('🔄 Test 9: Update Exchange Rate');
  
  try {
    // Find existing rate
    const existingRate = await MonthlyExchangeRates.findOne({ year: 2025, month: 1 });

    if (!existingRate) {
      throw new Error('Existing rate not found');
    }

    const oldRate = existingRate.rate;

    // Update rate
    existingRate.rate = 30.75;
    existingRate.source = 'Updated Source';
    existingRate.setBy = testAdmin._id;
    existingRate.setAt = new Date();

    await existingRate.save();

    // Verify update
    const updated = await MonthlyExchangeRates.findOne({ year: 2025, month: 1 });

    if (updated.rate !== 30.75) {
      throw new Error('Rate not updated');
    }

    console.log('✅ PASS - Exchange rate updated successfully');
    console.log(`   Rate: ${oldRate} → ${updated.rate} EGP/USD\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testGetTransferFeeSettings() {
  console.log('💸 Test 10: Get Transfer Fee Settings');
  
  try {
    const settings = await SalarySettings.findById('global');

    if (!settings) {
      throw new Error('Settings not found');
    }

    if (!settings.defaultTransferFee.model) {
      throw new Error('Transfer fee model not set');
    }

    if (settings.defaultTransferFee.value === undefined) {
      throw new Error('Default transfer fee not set');
    }

    console.log('✅ PASS - Transfer fee settings retrieved successfully');
    console.log(`   Model: ${settings.defaultTransferFee.model}`);
    console.log(`   Default Fee: ${settings.defaultTransferFee.value} EGP\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testUpdateTransferFeeSettings() {
  console.log('📝 Test 11: Update Transfer Fee Settings');
  
  try {
    const settings = await SalarySettings.findById('global');

    const originalFee = settings.defaultTransferFee.value;
    const originalModel = settings.defaultTransferFee.model;

    // Update settings
    settings.defaultTransferFee.model = 'percentage';
    settings.defaultTransferFee.value = 5;

    settings.changeHistory.push({
      field: 'defaultTransferFee',
      oldValue: { model: originalModel, value: originalFee },
      newValue: { model: 'percentage', value: 5 },
      changedBy: testAdmin._id,
      note: 'Changed to percentage model'
    });

    settings.lastModifiedBy = testAdmin._id;
    settings.lastModifiedAt = new Date();

    await settings.save();

    // Verify update
    const updated = await SalarySettings.findById('global');

    if (updated.defaultTransferFee.model !== 'percentage') {
      throw new Error('Transfer fee model not updated');
    }

    if (updated.defaultTransferFee.value !== 5) {
      throw new Error('Default transfer fee not updated');
    }

    console.log('✅ PASS - Transfer fee settings updated successfully');
    console.log(`   Model: ${originalModel} → ${updated.defaultTransferFee.model}`);
    console.log(`   Fee: ${originalFee} → ${updated.defaultTransferFee.value}\n`);
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

async function testGetChangeHistory() {
  console.log('📜 Test 12: Get Change History');
  
  try {
    const settings = await SalarySettings.findById('global')
      .populate('changeHistory.changedBy', 'firstName lastName');

    if (!settings) {
      throw new Error('Settings not found');
    }

    const history = settings.changeHistory;

    if (history.length === 0) {
      throw new Error('No change history found');
    }

    // Validate history entries
    history.forEach(entry => {
      if (!entry.field || !entry.changedBy || !entry.changedAt) {
        throw new Error('History entry missing required fields');
      }
    });

    console.log('✅ PASS - Change history retrieved successfully');
    console.log(`   Total Changes: ${history.length}`);
    console.log(`   Recent Changes:`);
    history.slice(-3).forEach(entry => {
      console.log(`     - ${entry.field}: ${entry.note || 'No note'}`);
    });
    console.log('');
    return true;
  } catch (error) {
    console.log('❌ FAIL -', error.message, '\n');
    return false;
  }
}

// Main test runner
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  MODULE 8: SETTINGS MANAGEMENT - COMPREHENSIVE TEST SUITE     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Connect to test database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager');
    console.log('✅ Connected to MongoDB\n');

    await setup();

    const tests = [
      testGetSalarySettings,
      testUpdateSalarySettings,
      testGetRatePartitions,
      testAddRatePartition,
      testUpdateRatePartition,
      testDeleteRatePartition,
      testGetExchangeRates,
      testSetExchangeRate,
      testUpdateExchangeRate,
      testGetTransferFeeSettings,
      testUpdateTransferFeeSettings,
      testGetChangeHistory
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    }

    await cleanup();

    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  TEST SUMMARY: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (failed === 0) {
      console.log('🎉 ALL TESTS PASSED! Module 8 implementation is complete.\n');
    } else {
      console.log('⚠️  Some tests failed. Please review and fix.\n');
    }

    await mongoose.connection.close();
    process.exit(failed === 0 ? 0 : 1);

  } catch (error) {
    console.error('❌ Test suite error:', error);
    await cleanup().catch(console.error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run tests
runAllTests();
