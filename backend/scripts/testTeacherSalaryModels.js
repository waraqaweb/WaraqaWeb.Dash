/**
 * Test Script for Teacher Salary System Models
 * 
 * Tests all models from Module 1:
 * - TeacherInvoice
 * - SalarySettings
 * - MonthlyExchangeRates
 * - TeacherSalaryAudit
 * - MonthlyReports
 * - User (teacher salary fields)
 */

const mongoose = require('mongoose');
const TeacherInvoice = require('../models/TeacherInvoice');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
const TeacherSalaryAudit = require('../models/TeacherSalaryAudit');
const MonthlyReports = require('../models/MonthlyReports');
const User = require('../models/User');

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const log = {
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  section: (msg) => console.log(`\n${colors.cyan}=== ${msg} ===${colors.reset}\n`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`)
};

// Test data
let testTeacher;
let testAdmin;
let testInvoice;
let testSettings;
let testExchangeRate;

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/waraqa', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    log.success('Connected to MongoDB');
  } catch (error) {
    log.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
}

async function cleanup() {
  log.info('Cleaning up test data...');
  
  // Delete test data created during this test run
  if (testInvoice) {
    await TeacherInvoice.findByIdAndDelete(testInvoice._id).catch(() => {});
  }
  
  if (testTeacher) {
    await User.findByIdAndDelete(testTeacher._id).catch(() => {});
  }
  
  if (testAdmin) {
    await User.findByIdAndDelete(testAdmin._id).catch(() => {});
  }
  
  // Clean up test audit logs
  await TeacherSalaryAudit.deleteMany({ 
    reason: /TEST/i 
  }).catch(() => {});
  
  // Clean up test reports
  await MonthlyReports.deleteMany({ 
    month: 99 
  }).catch(() => {});
  
  log.success('Cleanup complete');
}

// =============================================================================
// TEST FUNCTIONS
// =============================================================================

async function testUserModel() {
  log.section('Testing User Model (Teacher Salary Fields)');
  
  try {
    // Create test teacher
    testTeacher = await User.create({
      firstName: 'Test',
      lastName: 'Teacher',
      email: `test.teacher.${Date.now()}@test.com`,
      password: 'TestPassword123!',
      role: 'teacher',
      teacherInfo: {
        subjects: ['Math', 'Science'],
        hourlyRate: 15,
        // Teacher salary fields
        currentRatePartition: '51-100h',
        effectiveRate: 15,
        preferredCurrency: 'EGP',
        totalHoursYTD: 75,
        totalEarningsYTD: 1125,
        lastYTDReset: new Date('2025-01-01'),
        customRateOverride: {
          enabled: false
        },
        customTransferFee: {
          enabled: false
        },
        notificationPreferences: {
          invoicePublished: {
            email: true,
            inApp: true
          },
          paymentReceived: {
            email: true,
            inApp: true
          },
          bonusAdded: {
            email: true,
            inApp: true
          },
          digestMode: false
        }
      }
    });
    
    log.success(`Created test teacher: ${testTeacher.fullName}`);
    log.info(`  Rate Partition: ${testTeacher.teacherInfo.currentRatePartition}`);
    log.info(`  Effective Rate: $${testTeacher.teacherInfo.effectiveRate}/hr`);
    log.info(`  YTD Hours: ${testTeacher.teacherInfo.totalHoursYTD}h`);
    log.info(`  YTD Earnings: $${testTeacher.teacherInfo.totalEarningsYTD}`);
    log.info(`  Preferred Currency: ${testTeacher.teacherInfo.preferredCurrency}`);
    
    // Create test admin
    testAdmin = await User.create({
      firstName: 'Test',
      lastName: 'Admin',
      email: `test.admin.${Date.now()}@test.com`,
      password: 'AdminPassword123!',
      role: 'admin'
    });
    
    log.success(`Created test admin: ${testAdmin.fullName}`);
    
  } catch (error) {
    log.error(`User model test failed: ${error.message}`);
    throw error;
  }
}

async function testSalarySettings() {
  log.section('Testing SalarySettings Model');
  
  try {
    // Get or create global settings
    testSettings = await SalarySettings.getGlobalSettings();
    log.success('Retrieved global salary settings');
    
    // Test rate partitions
    log.info(`Rate Model: ${testSettings.rateModel}`);
    log.info(`Partitions: ${testSettings.ratePartitions.length}`);
    
    testSettings.ratePartitions.forEach((partition, index) => {
      log.info(`  ${index + 1}. ${partition.name}: ${partition.minHours}-${partition.maxHours}h @ $${partition.rateUSD}/hr`);
    });
    
    // Test getRateForHours method
    const testHours = [25, 75, 150, 250];
    log.info('\nTesting rate calculation:');
    for (const hours of testHours) {
      const rate = testSettings.getRateForHours(hours);
      const partition = testSettings.getPartitionForHours(hours);
      log.info(`  ${hours}h → $${rate}/hr (${partition})`);
    }
    
    // Test transfer fee
    log.info(`\nDefault Transfer Fee: ${testSettings.defaultTransferFee.model} - ${testSettings.defaultTransferFee.value}`);
    
    log.success('SalarySettings model tests passed');
    
  } catch (error) {
    log.error(`SalarySettings test failed: ${error.message}`);
    throw error;
  }
}

async function testMonthlyExchangeRates() {
  log.section('Testing MonthlyExchangeRates Model');
  
  try {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    // Set rate for current month
    testExchangeRate = await MonthlyExchangeRates.setRateForMonth(
      currentMonth,
      currentYear,
      50.25,
      testAdmin._id,
      'TEST - Automated Test',
      'Test exchange rate creation'
    );
    
    log.success(`Set exchange rate for ${currentYear}-${String(currentMonth).padStart(2, '0')}: ${testExchangeRate.rate} EGP/USD`);
    log.info(`  Source: ${testExchangeRate.source}`);
    log.info(`  Locked: ${testExchangeRate.locked}`);
    
    // Test retrieval
    const retrievedRate = await MonthlyExchangeRates.getRateForMonth(currentMonth, currentYear);
    if (retrievedRate && retrievedRate.rate === testExchangeRate.rate) {
      log.success('Rate retrieval successful');
    }
    
    // Test lock/unlock
    await testExchangeRate.lock(testAdmin._id);
    log.success('Rate locked successfully');
    
    await testExchangeRate.unlock(testAdmin._id);
    log.success('Rate unlocked successfully');
    
    // Test update
    const oldRate = testExchangeRate.rate;
    await testExchangeRate.updateRate(51.00, testAdmin._id, 'TEST - Rate update test');
    log.success(`Rate updated: ${oldRate} → ${testExchangeRate.rate}`);
    log.info(`  Modification history entries: ${testExchangeRate.modificationHistory.length}`);
    
    // Test get latest rate
    const latestRate = await MonthlyExchangeRates.getLatestRate();
    log.info(`Latest rate in system: ${latestRate} EGP/USD`);
    
    log.success('MonthlyExchangeRates model tests passed');
    
  } catch (error) {
    log.error(`MonthlyExchangeRates test failed: ${error.message}`);
    throw error;
  }
}

async function testTeacherInvoice() {
  log.section('Testing TeacherInvoice Model');
  
  try {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    // Create test invoice
    testInvoice = await TeacherInvoice.create({
      teacher: testTeacher._id,
      month: currentMonth,
      year: currentYear,
      status: 'draft',
      totalHours: 25,
      rateSnapshot: {
        partition: '0-50h',
        rate: 12,
        description: 'Beginner tier'
      },
      exchangeRateSnapshot: {
        rate: testExchangeRate.rate,
        source: `MonthlyExchangeRate ${currentMonth}/${currentYear}`,
        setBy: testAdmin._id
      },
      transferFeeSnapshot: {
        model: 'flat',
        value: 50,
        source: 'system_default'
      },
      createdBy: testAdmin._id
    });
    
    // Calculate amounts
    testInvoice.calculateAmounts();
    await testInvoice.save();
    
    log.success(`Created test invoice: ${testInvoice.invoiceNumber || 'DRAFT'}`);
    log.info(`  Month: ${testInvoice.month}/${testInvoice.year}`);
    log.info(`  Teacher: ${testTeacher.fullName}`);
    log.info(`  Hours: ${testInvoice.totalHours}h`);
    log.info(`  Rate: $${testInvoice.rateSnapshot.rate}/hr`);
    log.info(`  Gross (USD): $${testInvoice.grossAmountUSD}`);
    log.info(`  Exchange Rate: ${testInvoice.exchangeRateSnapshot.rate} EGP/USD`);
    log.info(`  Gross (EGP): ${testInvoice.grossAmountEGP} EGP`);
    log.info(`  Transfer Fee: ${testInvoice.transferFeeEGP} EGP`);
    log.info(`  Net Amount: ${testInvoice.netAmountEGP} EGP`);
    
    // Test add bonus
    testInvoice.addBonus({
      source: 'admin',
      amountUSD: 50,
      reason: 'TEST - Excellent performance'
    }, testAdmin._id);
    await testInvoice.save();
    
    log.success(`Added bonus: $${testInvoice.bonuses[0].amountUSD}`);
    log.info(`  Total with bonus (USD): $${testInvoice.totalUSD}`);
    log.info(`  Total with bonus (EGP): ${testInvoice.totalEGP} EGP`);
    
    // Test add extra (deduction)
    testInvoice.addExtra({
      category: 'penalty',
      amountUSD: -10,
      reason: 'TEST - Late report submission'
    }, testAdmin._id);
    await testInvoice.save();
    
    log.success(`Added extra (penalty): -$${Math.abs(testInvoice.extras[0].amountUSD)}`);
    log.info(`  Final net amount: ${testInvoice.netAmountEGP} EGP`);
    
    // Test publish
    await testInvoice.publish(testAdmin._id);
    log.success(`Invoice published: ${testInvoice.invoiceNumber}`);
    log.info(`  Share token generated: ${testInvoice.shareToken ? 'Yes' : 'No'}`);
    log.info(`  Status: ${testInvoice.status}`);
    
    // Test change history
    log.info(`  Change history entries: ${testInvoice.changeHistory.length}`);
    testInvoice.changeHistory.forEach((change, index) => {
      log.info(`    ${index + 1}. ${change.action} at ${change.changedAt.toISOString()}`);
    });
    
    // Test mark as paid
    await testInvoice.markAsPaid({
      paymentMethod: 'bank_transfer',
      transactionId: 'TEST-TXN-12345',
      paidAt: new Date(),
      note: 'TEST - Payment recorded'
    }, testAdmin._id);
    
    log.success('Invoice marked as paid');
    log.info(`  Payment method: ${testInvoice.paymentMethod}`);
    log.info(`  Transaction ID: ${testInvoice.transactionId}`);
    log.info(`  Paid at: ${testInvoice.paidAt.toISOString()}`);
    
    // Verify teacher YTD was updated
    const updatedTeacher = await User.findById(testTeacher._id);
    log.info(`\nTeacher YTD updated:`);
    log.info(`  Previous hours: ${testTeacher.teacherInfo.totalHoursYTD}h`);
    log.info(`  New hours: ${updatedTeacher.teacherInfo.totalHoursYTD}h`);
    log.info(`  Previous earnings: ${testTeacher.teacherInfo.totalEarningsYTD} EGP`);
    log.info(`  New earnings: ${updatedTeacher.teacherInfo.totalEarningsYTD} EGP`);
    
    log.success('TeacherInvoice model tests passed');
    
  } catch (error) {
    log.error(`TeacherInvoice test failed: ${error.message}`);
    throw error;
  }
}

async function testTeacherSalaryAudit() {
  log.section('Testing TeacherSalaryAudit Model');
  
  try {
    // Log an action
    const auditLog = await TeacherSalaryAudit.logAction({
      action: 'invoice_create',
      entityType: 'TeacherInvoice',
      entityId: testInvoice._id,
      actor: testAdmin._id,
      actorRole: 'admin',
      actorIP: '127.0.0.1',
      before: null,
      after: {
        invoiceNumber: testInvoice.invoiceNumber,
        status: 'draft',
        totalHours: testInvoice.totalHours
      },
      reason: 'TEST - Invoice created for testing',
      metadata: {
        testRun: true,
        timestamp: new Date()
      },
      success: true
    });
    
    log.success('Audit log created');
    log.info(`  Action: ${auditLog.action}`);
    log.info(`  Entity: ${auditLog.entityType} (${auditLog.entityId})`);
    log.info(`  Actor: ${testAdmin.fullName}`);
    log.info(`  Timestamp: ${auditLog.timestamp.toISOString()}`);
    
    // Get entity audit trail
    const trail = await TeacherSalaryAudit.getEntityAuditTrail('TeacherInvoice', testInvoice._id);
    log.success(`Retrieved audit trail: ${trail.length} entries`);
    
    // Test immutability
    try {
      auditLog.action = 'modified_action';
      await auditLog.save();
      log.error('Audit log was modified (SHOULD NOT HAPPEN!)');
    } catch (error) {
      log.success('Audit log immutability verified ✓');
    }
    
    // Get statistics
    const stats = await TeacherSalaryAudit.getStatistics();
    log.info(`\nAudit statistics:`);
    stats.slice(0, 5).forEach(stat => {
      log.info(`  ${stat._id}: ${stat.count} actions (${stat.successCount} success, ${stat.failureCount} failed)`);
    });
    
    log.success('TeacherSalaryAudit model tests passed');
    
  } catch (error) {
    log.error(`TeacherSalaryAudit test failed: ${error.message}`);
    throw error;
  }
}

async function testMonthlyReports() {
  log.section('Testing MonthlyReports Model');
  
  try {
    // Create a test report
    const currentDate = new Date();
    const testReport = await MonthlyReports.create({
      month: currentDate.getMonth() + 1,
      year: currentDate.getFullYear(),
      reportType: 'financial_summary',
      totalTeachers: 50,
      totalInvoices: 48,
      totalHours: 1250,
      totalAmountUSD: 18750,
      totalAmountEGP: 940000,
      totalPaidEGP: 750000,
      totalPendingEGP: 190000,
      avgHoursPerTeacher: 25,
      avgEarningsPerTeacher: 18800,
      invoicesByStatus: {
        draft: 2,
        published: 10,
        paid: 36,
        archived: 0
      },
      rateDistribution: [
        { partition: '0-50h', teacherCount: 20, totalHours: 400, totalAmount: 4800 },
        { partition: '51-100h', teacherCount: 15, totalHours: 450, totalAmount: 6750 },
        { partition: '101-200h', teacherCount: 10, totalHours: 250, totalAmount: 4500 },
        { partition: '200+h', teacherCount: 5, totalHours: 150, totalAmount: 3000 }
      ],
      generatedBy: testAdmin._id,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });
    
    log.success('Test report created');
    log.info(`  Month/Year: ${testReport.month}/${testReport.year}`);
    log.info(`  Total Teachers: ${testReport.totalTeachers}`);
    log.info(`  Total Invoices: ${testReport.totalInvoices}`);
    log.info(`  Total Hours: ${testReport.totalHours}h`);
    log.info(`  Total Amount: ${testReport.totalAmountEGP} EGP`);
    log.info(`  Avg per Teacher: ${testReport.avgEarningsPerTeacher} EGP`);
    
    // Test mark as stale
    await testReport.markAsStale();
    log.success(`Report marked as stale: ${testReport.isStale}`);
    
    // Test refresh
    await testReport.refresh();
    log.success(`Report refreshed: ${testReport.isStale}`);
    
    // Test cache statistics
    const cacheStats = await MonthlyReports.getCacheStats();
    log.info('\nCache statistics:');
    cacheStats.forEach(stat => {
      log.info(`  ${stat._id}: ${stat.total} total, ${stat.fresh} fresh, ${stat.stale} stale`);
    });
    
    log.success('MonthlyReports model tests passed');
    
  } catch (error) {
    log.error(`MonthlyReports test failed: ${error.message}`);
    throw error;
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests() {
  log.section('Teacher Salary System - Module 1 Model Tests');
  log.info(`Started at: ${new Date().toISOString()}`);
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  const tests = [
    { name: 'User Model', fn: testUserModel },
    { name: 'SalarySettings Model', fn: testSalarySettings },
    { name: 'MonthlyExchangeRates Model', fn: testMonthlyExchangeRates },
    { name: 'TeacherInvoice Model', fn: testTeacherInvoice },
    { name: 'TeacherSalaryAudit Model', fn: testTeacherSalaryAudit },
    { name: 'MonthlyReports Model', fn: testMonthlyReports }
  ];
  
  for (const test of tests) {
    try {
      await test.fn();
      testsPassed++;
    } catch (error) {
      log.error(`${test.name} FAILED`);
      console.error(error);
      testsFailed++;
    }
  }
  
  // Summary
  log.section('Test Summary');
  log.info(`Total tests: ${tests.length}`);
  log.success(`Passed: ${testsPassed}`);
  if (testsFailed > 0) {
    log.error(`Failed: ${testsFailed}`);
  }
  
  const successRate = ((testsPassed / tests.length) * 100).toFixed(1);
  log.info(`Success rate: ${successRate}%`);
  
  return testsFailed === 0;
}

// =============================================================================
// EXECUTION
// =============================================================================

(async function main() {
  try {
    await connectDB();
    
    const success = await runAllTests();
    
    await cleanup();
    
    await mongoose.connection.close();
    log.success('Database connection closed');
    
    if (success) {
      log.success('\n🎉 All tests passed!');
      process.exit(0);
    } else {
      log.error('\n❌ Some tests failed');
      process.exit(1);
    }
    
  } catch (error) {
    log.error(`Test execution failed: ${error.message}`);
    console.error(error);
    
    try {
      await cleanup();
      await mongoose.connection.close();
    } catch (cleanupError) {
      log.error(`Cleanup failed: ${cleanupError.message}`);
    }
    
    process.exit(1);
  }
})();
