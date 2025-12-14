/**
 * Module 9: Multi-Currency Support - Comprehensive Test Suite
 * 
 * This test suite validates all currency management functionality:
 * - Currency rate management (fetch, update, bulk operations)
 * - Currency conversion
 * - Teacher currency preferences
 * - Multi-source rate aggregation
 * - Cross-currency reporting
 * - Manual rate overrides
 * - Reliability scoring
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CurrencyRate = require('../models/CurrencyRate');
const CurrencyService = require('../services/currencyService');
const User = require('../models/User');

// Test configuration
const TEST_DB = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/waraqa-test-module9';
const TEST_YEAR = 2025;
const TEST_MONTH = 1;

// Test user IDs
let adminUserId;
let teacherUserId;

// Test results tracking
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Helper function to run a test
 */
async function runTest(testName, testFunc) {
  testsRun++;
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST ${testsRun}: ${testName}`);
  console.log(`${'='.repeat(70)}`);
  
  try {
    await testFunc();
    testsPassed++;
    console.log(`✅ PASSED: ${testName}`);
    return true;
  } catch (error) {
    testsFailed++;
    console.error(`❌ FAILED: ${testName}`);
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    return false;
  }
}

/**
 * Helper function to assert equality
 */
function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

/**
 * Helper function to assert truthiness
 */
function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`Assertion failed: ${message}\nExpected truthy value, got: ${value}`);
  }
}

/**
 * Helper function to assert object has property
 */
function assertHasProperty(obj, property, message = '') {
  if (!obj.hasOwnProperty(property)) {
    throw new Error(`Assertion failed: ${message}\nObject does not have property: ${property}`);
  }
}

/**
 * Helper function to assert value is within range
 */
function assertInRange(value, min, max, message = '') {
  if (value < min || value > max) {
    throw new Error(`Assertion failed: ${message}\nExpected ${value} to be between ${min} and ${max}`);
  }
}

async function ensureFreshConnection() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
}

/**
 * Setup: Connect to test database and create test users
 */
async function setup() {
  console.log('\n📦 Setting up test environment...');
  
  try {
    // Connect to test database
    await ensureFreshConnection();
    console.log('✅ Connected to test database');
    
    // Clear test data
    await CurrencyRate.deleteMany({});
    await User.deleteMany({ email: /test-currency/ });
    console.log('✅ Cleared test data');
    
    // Create test admin user
    const adminUser = new User({
      email: 'test-currency-admin@test.com',
      password: 'hashedpassword123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isActive: true
    });
    await adminUser.save();
    adminUserId = adminUser._id;
    console.log('✅ Created test admin user:', adminUserId);
    
    // Create test teacher user
    const teacherUser = new User({
      email: 'test-currency-teacher@test.com',
      password: 'hashedpassword123',
      firstName: 'Teacher',
      lastName: 'User',
      role: 'teacher',
      isActive: true,
      teacherInfo: {
        bio: 'Test teacher',
        subjects: ['Math'],
        hourlyRate: 100,
        preferredCurrency: 'USD'
      }
    });
    await teacherUser.save();
    teacherUserId = teacherUser._id;
    console.log('✅ Created test teacher user:', teacherUserId);
    
    console.log('✅ Setup complete\n');
  } catch (error) {
    console.error('❌ Setup failed:', error);
    throw error;
  }
}

/**
 * Teardown: Disconnect from database
 */
async function teardown() {
  console.log('\n🧹 Cleaning up...');
  
  try {
    // Clear test data
    await CurrencyRate.deleteMany({});
    await User.deleteMany({ email: /test-currency/ });
    
    // Disconnect
    await mongoose.disconnect();
    console.log('✅ Disconnected from test database');
  } catch (error) {
    console.error('❌ Teardown failed:', error);
    throw error;
  }
}

/**
 * Test 1: Get or create currency rate
 */
async function test1_getOrCreateRate() {
  const rate = await CurrencyRate.getOrCreate('USD', 'EGP', TEST_YEAR, TEST_MONTH);
  
  assertTrue(rate, 'Rate should be created');
  assertEqual(rate.baseCurrency, 'USD', 'Base currency should be USD');
  assertEqual(rate.targetCurrency, 'EGP', 'Target currency should be EGP');
  assertEqual(rate.year, TEST_YEAR, 'Year should match');
  assertEqual(rate.month, TEST_MONTH, 'Month should match');
  assertTrue(Array.isArray(rate.sources), 'Sources should be an array');
  
  // Get same rate again - should not create duplicate
  const rate2 = await CurrencyRate.getOrCreate('USD', 'EGP', TEST_YEAR, TEST_MONTH);
  assertEqual(rate._id.toString(), rate2._id.toString(), 'Should return same rate');
  
  console.log('✓ Currency rate created successfully');
}

/**
 * Test 2: Add rate source
 */
async function test2_addRateSource() {
  const rate = await CurrencyRate.getOrCreate('USD', 'EUR', TEST_YEAR, TEST_MONTH);
  
  // Add first source
  rate.addSource('exchangerate-api', 0.92, 'high');
  assertEqual(rate.sources.length, 1, 'Should have 1 source');
  assertEqual(rate.sources[0].source, 'exchangerate-api', 'Source name should match');
  assertEqual(rate.sources[0].rate, 0.92, 'Rate value should match');
  assertEqual(rate.sources[0].reliability, 'high', 'Reliability should match');
  
  // Add second source
  rate.addSource('fixer', 0.91, 'medium');
  assertEqual(rate.sources.length, 2, 'Should have 2 sources');
  
  // Update existing source
  rate.addSource('exchangerate-api', 0.93, 'high');
  assertEqual(rate.sources.length, 2, 'Should still have 2 sources');
  const updatedSource = rate.sources.find(s => s.source === 'exchangerate-api');
  assertEqual(updatedSource.rate, 0.93, 'Rate should be updated');
  
  await rate.save();
  console.log('✓ Rate sources added/updated successfully');
}

/**
 * Test 3: Set active rate
 */
async function test3_setActiveRate() {
  const rate = await CurrencyRate.getOrCreate('USD', 'GBP', TEST_YEAR, TEST_MONTH);
  
  rate.addSource('exchangerate-api', 0.79, 'high');
  rate.addSource('fixer', 0.78, 'medium');
  rate.setActiveRate(0.79, 'exchangerate-api', adminUserId, 'Using highest reliability source');
  
  assertTrue(rate.activeRate, 'Active rate should be set');
  assertEqual(rate.activeRate.value, 0.79, 'Active rate value should match');
  assertEqual(rate.activeRate.source, 'exchangerate-api', 'Active rate source should match');
  assertEqual(rate.activeRate.selectedBy.toString(), adminUserId.toString(), 'Selected by should match');
  assertEqual(rate.activeRate.note, 'Using highest reliability source', 'Note should match');
  assertTrue(rate.activeRate.selectedAt instanceof Date, 'Selected at should be a date');
  
  await rate.save();
  console.log('✓ Active rate set successfully');
}

/**
 * Test 4: Get recommended rate
 */
async function test4_getRecommendedRate() {
  const rate = await CurrencyRate.getOrCreate('USD', 'SAR', TEST_YEAR, TEST_MONTH);
  
  rate.addSource('exchangerate-api', 3.75, 'high');
  rate.addSource('fixer', 3.76, 'medium');
  rate.addSource('currencyapi', 3.74, 'low');
  
  const recommended = rate.getRecommendedRate();
  
  assertTrue(recommended, 'Recommended rate should exist');
  assertEqual(recommended.rate, 3.75, 'Should recommend highest reliability source');
  assertEqual(recommended.source, 'exchangerate-api', 'Source should match');
  
  await rate.save();
  console.log('✓ Recommended rate logic working correctly');
}

/**
 * Test 5: Fetch rate from ExchangeRate-API
 */
async function test5_fetchFromAPI() {
  console.log('Fetching rate from ExchangeRate-API (may take a few seconds)...');
  
  const result = await CurrencyService.fetchFromExchangeRateAPI('USD', 'EUR');
  
  assertTrue(result !== null, 'Result should be fetched');
  assertTrue(result.rate, 'Result should have rate');
  assertTrue(result.rate > 0, 'Rate should be positive');
  assertInRange(result.rate, 0.5, 2.0, 'EUR rate should be reasonable');
  assertEqual(result.reliability, 'high', 'ExchangeRate-API should have high reliability');
  
  console.log(`✓ Fetched USD/EUR rate: ${result.rate} (reliability: ${result.reliability})`);
}

/**
 * Test 6: Update currency rate from APIs
 */
async function test6_updateCurrencyRate() {
  console.log('Updating currency rate from APIs (may take a few seconds)...');
  
  const rate = await CurrencyService.updateCurrencyRate('USD', 'EGP', TEST_YEAR, TEST_MONTH, adminUserId);
  
  assertTrue(rate, 'Rate document should be created');
  assertEqual(rate.baseCurrency, 'USD', 'Base currency should match');
  assertEqual(rate.targetCurrency, 'EGP', 'Target currency should match');
  assertTrue(rate.sources.length > 0, 'Should have at least one source');
  assertTrue(rate.activeRate, 'Active rate should be set');
  assertTrue(rate.activeRate.value > 0, 'Active rate should be positive');
  
  console.log(`✓ Updated USD/EGP rate: ${rate.activeRate.value} (from ${rate.activeRate.source})`);
}

/**
 * Test 7: Get conversion rate
 */
async function test7_getConversionRate() {
  // First, set up a rate
  const rateDoc = await CurrencyRate.getOrCreate('USD', 'GBP', TEST_YEAR, TEST_MONTH);
  rateDoc.addSource('manual', 0.80, 'high');
  rateDoc.setActiveRate(0.80, 'manual', adminUserId, 'Test rate');
  await rateDoc.save();
  
  const rate = await CurrencyService.getConversionRate('USD', 'GBP', TEST_YEAR, TEST_MONTH);
  
  assertEqual(rate, 0.80, 'Conversion rate should match');
  
  // Test same currency (should be 1)
  const sameRate = await CurrencyService.getConversionRate('USD', 'USD', TEST_YEAR, TEST_MONTH);
  assertEqual(sameRate, 1, 'Same currency rate should be 1');
  
  console.log('✓ Conversion rate retrieval working correctly');
}

/**
 * Test 8: Convert amount between currencies
 */
async function test8_convertAmount() {
  // Set up rate
  const rateDoc = await CurrencyRate.getOrCreate('USD', 'EUR', TEST_YEAR, TEST_MONTH);
  rateDoc.addSource('manual', 0.90, 'high');
  rateDoc.setActiveRate(0.90, 'manual', adminUserId, 'Test rate');
  await rateDoc.save();
  
  const converted = await CurrencyService.convertAmount(100, 'USD', 'EUR', TEST_YEAR, TEST_MONTH);
  
  assertEqual(converted, 90, 'Converted amount should be correct');
  
  // Test reverse conversion
  const rateDocReverse = await CurrencyRate.getOrCreate('EUR', 'USD', TEST_YEAR, TEST_MONTH);
  rateDocReverse.addSource('manual', 1.11, 'high');
  rateDocReverse.setActiveRate(1.11, 'manual', adminUserId, 'Test rate');
  await rateDocReverse.save();
  
  const convertedBack = await CurrencyService.convertAmount(90, 'EUR', 'USD', TEST_YEAR, TEST_MONTH);
  assertInRange(convertedBack, 99, 101, 'Reverse conversion should be approximately correct');
  
  console.log('✓ Currency conversion working correctly');
}

/**
 * Test 9: Get teacher currency preference
 */
async function test9_getTeacherPreference() {
  const currency = await CurrencyService.getTeacherCurrencyPreference(teacherUserId);
  
  assertEqual(currency, 'USD', 'Default currency should be USD');
  
  console.log('✓ Teacher currency preference retrieved correctly');
}

/**
 * Test 10: Set teacher currency preference
 */
async function test10_setTeacherPreference() {
  const user = await CurrencyService.setTeacherCurrencyPreference(teacherUserId, 'EUR');
  
  assertTrue(user, 'User should be returned');
  assertEqual(user.teacherInfo.preferredCurrency, 'EUR', 'Currency should be updated');
  
  // Verify it persists
  const currency = await CurrencyService.getTeacherCurrencyPreference(teacherUserId);
  assertEqual(currency, 'EUR', 'Currency preference should persist');
  
  console.log('✓ Teacher currency preference set correctly');
}

/**
 * Test 11: Currency preference validation
 */
async function test11_currencyValidation() {
  let errorThrown = false;
  
  try {
    await CurrencyService.setTeacherCurrencyPreference(teacherUserId, 'INVALID');
  } catch (error) {
    errorThrown = true;
    assertTrue(error.message.includes('not supported'), 'Error message should mention unsupported currency');
  }
  
  assertTrue(errorThrown, 'Should throw error for invalid currency');
  
  console.log('✓ Currency validation working correctly');
}

/**
 * Test 12: Get all rates for period
 */
async function test12_getAllRatesForPeriod() {
  // Create multiple rates
  const rate1 = await CurrencyRate.getOrCreate('USD', 'EUR', TEST_YEAR, TEST_MONTH);
  rate1.addSource('manual', 0.90, 'high');
  rate1.setActiveRate(0.90, 'manual', adminUserId);
  await rate1.save();
  
  const rate2 = await CurrencyRate.getOrCreate('USD', 'GBP', TEST_YEAR, TEST_MONTH);
  rate2.addSource('manual', 0.80, 'high');
  rate2.setActiveRate(0.80, 'manual', adminUserId);
  await rate2.save();
  
  const rates = await CurrencyService.getAllRatesForPeriod(TEST_YEAR, TEST_MONTH);
  
  assertTrue(rates.length >= 2, 'Should have at least 2 rates');
  assertTrue(rates.every(r => r.year === TEST_YEAR), 'All rates should have correct year');
  assertTrue(rates.every(r => r.month === TEST_MONTH), 'All rates should have correct month');
  
  console.log(`✓ Retrieved ${rates.length} rates for period`);
}

/**
 * Test 13: Bulk update rates
 */
async function test13_bulkUpdateRates() {
  console.log('Bulk updating rates (may take up to 30 seconds)...');
  
  const results = await CurrencyService.bulkUpdateRates(TEST_YEAR, TEST_MONTH, adminUserId);
  
  assertTrue(results.success, 'Results should have success array');
  assertTrue(results.failed, 'Results should have failed array');
  assertTrue(results.success.length > 0, 'Should have some successful updates');
  
  console.log(`✓ Bulk update complete: ${results.success.length} succeeded, ${results.failed.length} failed`);
  
  // Verify rates were saved
  const rates = await CurrencyService.getAllRatesForPeriod(TEST_YEAR, TEST_MONTH);
  assertTrue(rates.length >= results.success.length, 'Rates should be saved to database');
}

/**
 * Test 14: Cross-currency report
 */
async function test14_crossCurrencyReport() {
  // Ensure we have rates
  const ratesExist = await CurrencyRate.countDocuments({
    year: TEST_YEAR,
    month: TEST_MONTH,
    activeRate: { $exists: true }
  });
  
  if (ratesExist === 0) {
    console.log('No rates exist, creating test rates...');
    const rate = await CurrencyRate.getOrCreate('USD', 'EUR', TEST_YEAR, TEST_MONTH);
    rate.addSource('manual', 0.90, 'high');
    rate.setActiveRate(0.90, 'manual', adminUserId);
    await rate.save();
  }
  
  const report = await CurrencyService.getCrossCurrencyReport(TEST_YEAR, TEST_MONTH);
  
  assertTrue(report, 'Report should be generated');
  assertTrue(report.period, 'Report should have period');
  assertTrue(report.rates, 'Report should have rates object');
  assertTrue(report.summary, 'Report should have summary');
  assertTrue(report.summary.totalPairs >= 0, 'Report summary should have totalPairs count');
  
  console.log(`✓ Cross-currency report generated: ${report.summary.totalPairs} pairs, ${Object.keys(report.rates).length} rates`);
}

/**
 * Test 15: Fallback to 1:1 rate on API failure
 */
async function test15_fallbackTo1on1() {
  // Test with non-existent currency pair
  const rate = await CurrencyService.getConversionRate('USD', 'XXX', TEST_YEAR, TEST_MONTH);
  
  assertEqual(rate, 1, 'Should fallback to 1:1 rate');
  
  const converted = await CurrencyService.convertAmount(100, 'USD', 'YYY', TEST_YEAR, TEST_MONTH);
  assertEqual(converted, 100, 'Should convert 1:1 as fallback');
  
  console.log('✓ Fallback to 1:1 rate working correctly');
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('MODULE 9: MULTI-CURRENCY SUPPORT - COMPREHENSIVE TEST SUITE');
  console.log('='.repeat(70));
  
  try {
    // Setup
    await setup();
    
    // Run all tests
    await runTest('Get or create currency rate', test1_getOrCreateRate);
    await runTest('Add rate source', test2_addRateSource);
    await runTest('Set active rate', test3_setActiveRate);
    await runTest('Get recommended rate', test4_getRecommendedRate);
    await runTest('Fetch rate from ExchangeRate-API', test5_fetchFromAPI);
    await runTest('Update currency rate from APIs', test6_updateCurrencyRate);
    await runTest('Get conversion rate', test7_getConversionRate);
    await runTest('Convert amount between currencies', test8_convertAmount);
    await runTest('Get teacher currency preference', test9_getTeacherPreference);
    await runTest('Set teacher currency preference', test10_setTeacherPreference);
    await runTest('Currency preference validation', test11_currencyValidation);
    await runTest('Get all rates for period', test12_getAllRatesForPeriod);
    await runTest('Bulk update rates', test13_bulkUpdateRates);
    await runTest('Cross-currency report', test14_crossCurrencyReport);
    await runTest('Fallback to 1:1 rate on API failure', test15_fallbackTo1on1);
    
    // Teardown
    await teardown();
    
    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total tests run: ${testsRun}`);
    console.log(`Tests passed: ${testsPassed} ✅`);
    console.log(`Tests failed: ${testsFailed} ❌`);
    console.log(`Success rate: ${((testsPassed / testsRun) * 100).toFixed(2)}%`);
    console.log('='.repeat(70) + '\n');
    
    // Exit with appropriate code
    process.exit(testsFailed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
    await teardown();
    process.exit(1);
  }
}

// Run tests
runAllTests();
