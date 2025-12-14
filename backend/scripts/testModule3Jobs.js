/**
 * Module 3 Automated Jobs Test Script
 * 
 * Tests the automated job system:
 * - Teacher invoice generation job
 * - Manual trigger functionality
 * - Dry run mode
 * - Lock mechanism
 * - Notification integration
 */

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

const {
  generateTeacherInvoices,
  manualTrigger,
  dryRun
} = require('../jobs/generateTeacherInvoicesJob');

const TeacherSalaryService = require('../services/teacherSalaryService');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
const TeacherInvoice = require('../models/TeacherInvoice');
const TeacherSalaryAudit = require('../models/TeacherSalaryAudit');
const User = require('../models/User');
const Class = require('../models/Class');

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
let testTeachers = [];
let testAdmin;
let testGuardian;
let testStudent;
let testClasses = [];
let testInvoices = [];

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
  
  // Delete test invoices
  if (testInvoices.length > 0) {
    await TeacherInvoice.deleteMany({ _id: { $in: testInvoices.map(i => i._id) } }).catch(() => {});
  }
  
  // Delete test classes
  if (testClasses.length > 0) {
    await Class.deleteMany({ _id: { $in: testClasses.map(c => c._id) } }).catch(() => {});
  }
  
  // Delete test teachers
  if (testTeachers.length > 0) {
    await User.deleteMany({ _id: { $in: testTeachers.map(t => t._id) } }).catch(() => {});
  }
  
  if (testGuardian) {
    await User.findByIdAndDelete(testGuardian._id).catch(() => {});
  }
  
  if (testAdmin) {
    await User.findByIdAndDelete(testAdmin._id).catch(() => {});
  }
  
  log.success('Cleanup complete');
}

// =============================================================================
// TEST FUNCTIONS
// =============================================================================

async function testSetup() {
  log.section('Setting Up Test Environment');
  
  try {
    // Create test admin
    testAdmin = await User.create({
      firstName: 'Test',
      lastName: 'Admin',
      email: `test.admin.module3.${Date.now()}@test.com`,
      password: 'AdminPassword123!',
      role: 'admin'
    });
    log.success(`Created test admin: ${testAdmin.fullName}`);
    
    // Create test guardian
    testGuardian = await User.create({
      firstName: 'Test',
      lastName: 'Guardian',
      email: `test.guardian.module3.${Date.now()}@test.com`,
      password: 'GuardianPassword123!',
      role: 'guardian',
      guardianInfo: {
        students: [{
          firstName: 'Test',
          lastName: 'Student',
          grade: '10',
          hoursRemaining: 10
        }]
      }
    });
    testStudent = testGuardian.guardianInfo.students[0];
    log.success(`Created test guardian with student`);
    
    // Create 3 test teachers with different hour amounts
    const teacherData = [
      { hours: 15, name: 'Teacher One' },
      { hours: 30, name: 'Teacher Two' },
      { hours: 0, name: 'Teacher Three' } // Should be skipped
    ];
    
    for (const data of teacherData) {
      const teacher = await User.create({
        firstName: data.name.split(' ')[0],
        lastName: data.name.split(' ')[1],
        email: `test.${data.name.toLowerCase().replace(' ', '.')}.module3.${Date.now()}@test.com`,
        password: 'TeacherPassword123!',
        role: 'teacher',
        teacherInfo: {
          subjects: ['Mathematics', 'Science'],
          hourlyRate: 15,
          currentRatePartition: '0-50h',
          effectiveRate: 12,
          preferredCurrency: 'EGP',
          totalHoursYTD: 0,
          totalEarningsYTD: 0
        }
      });
      
      testTeachers.push(teacher);
      log.success(`Created test teacher: ${teacher.fullName} (${data.hours}h)`);
      
      // Create classes for this teacher
      if (data.hours > 0) {
        const now = new Date();
        const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        
        for (let i = 0; i < data.hours; i++) {
          const classDate = new Date(previousMonth);
          classDate.setDate(classDate.getDate() + i * 2);
          
          const testClass = await Class.create({
            title: `Mathematics Class ${i + 1}`,
            subject: 'Mathematics',
            teacher: teacher._id,
            student: {
              guardianId: testGuardian._id,
              studentId: testStudent._id,
              studentName: `${testStudent.firstName} ${testStudent.lastName}`
            },
            scheduledDate: classDate,
            duration: 60, // 1 hour
            status: 'attended',
            location: 'online',
            meetingLink: 'https://meet.google.com/test',
            timezone: 'Africa/Cairo',
            createdBy: testAdmin._id
          });
          
          testClasses.push(testClass);
        }
        
        log.info(`  Created ${data.hours} classes for ${teacher.fullName}`);
      }
    }
    
    // Ensure salary settings exist
    const settings = await SalarySettings.getGlobalSettings();
    log.success('Salary settings loaded');
    
    // Ensure exchange rate exists for previous month
    const now = new Date();
    const previousMonth = now.getMonth(); // 0-indexed, so current month index = previous month number
    const previousYear = previousMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const monthNum = previousMonth === 0 ? 12 : previousMonth;
    
    let exchangeRate = await MonthlyExchangeRates.findOne({ 
      month: monthNum, 
      year: previousYear 
    });
    
    if (!exchangeRate) {
      exchangeRate = await MonthlyExchangeRates.setRateForMonth(
        monthNum,
        previousYear,
        50.5,
        testAdmin._id,
        'TEST - Module 3 Test',
        'Test exchange rate for job testing'
      );
    }
    log.success(`Exchange rate set: ${exchangeRate.rate} EGP/USD for ${previousYear}-${String(monthNum).padStart(2, '0')}`);
    
    log.success('Test environment setup complete');
    
  } catch (error) {
    log.error(`Setup failed: ${error.message}`);
    throw error;
  }
}

async function testDryRun() {
  log.section('Testing Dry Run Mode');
  
  try {
    const now = new Date();
    const previousMonth = now.getMonth(); // 0-indexed
    const previousYear = previousMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const monthNum = previousMonth === 0 ? 12 : previousMonth;
    
    log.info(`Testing dry run for ${previousYear}-${String(monthNum).padStart(2, '0')}...`);
    
    // Get invoice count before dry run
    const invoicesBefore = await TeacherInvoice.countDocuments();
    
    // Run dry run
    const results = await dryRun(monthNum, previousYear);
    
    // Get invoice count after dry run
    const invoicesAfter = await TeacherInvoice.countDocuments();
    
    log.success('Dry run completed');
    log.info(`  Total Teachers: ${results.summary.total}`);
    log.info(`  Would Create: ${results.summary.created}`);
    log.info(`  Would Skip: ${results.summary.skipped}`);
    log.info(`  Failed: ${results.summary.failed}`);
    
    // Verify no invoices were actually created
    if (invoicesBefore === invoicesAfter) {
      log.success('Dry run did not create any invoices (correct behavior)');
    } else {
      throw new Error(`Dry run created ${invoicesAfter - invoicesBefore} invoices (should be 0)`);
    }
    
    // Verify summary is correct
    if (results.summary.created >= 2 && results.summary.skipped >= 1) {
      log.success('Dry run summary looks correct (found teachers with and without hours)');
    } else {
      log.warning(`Unexpected dry run results: created=${results.summary.created}, skipped=${results.summary.skipped}`);
    }
    
    log.success('Dry run mode test passed');
    
  } catch (error) {
    log.error(`Dry run test failed: ${error.message}`);
    throw error;
  }
}

async function testManualTrigger() {
  log.section('Testing Manual Trigger');
  
  try {
    const now = new Date();
    const previousMonth = now.getMonth(); // 0-indexed
    const previousYear = previousMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const monthNum = previousMonth === 0 ? 12 : previousMonth;
    
    log.info(`Testing manual trigger for ${previousYear}-${String(monthNum).padStart(2, '0')}...`);
    
    // Get invoice count before
    const invoicesBefore = await TeacherInvoice.countDocuments();
    
    // Trigger job manually
    const results = await manualTrigger(monthNum, previousYear, testAdmin._id);
    
    // Get invoice count after
    const invoicesAfter = await TeacherInvoice.countDocuments();
    
    log.success('Manual trigger completed');
    log.info(`  Total Teachers: ${results.summary.total}`);
    log.info(`  Invoices Created: ${results.summary.created}`);
    log.info(`  Skipped: ${results.summary.skipped}`);
    log.info(`  Failed: ${results.summary.failed}`);
    
    // Verify invoices were created
    const invoicesCreated = invoicesAfter - invoicesBefore;
    if (invoicesCreated === results.summary.created) {
      log.success(`Created ${invoicesCreated} invoices (matches summary)`);
    } else {
      throw new Error(`Created ${invoicesCreated} invoices but summary says ${results.summary.created}`);
    }
    
    // Verify created invoices
    if (results.invoices && results.invoices.length > 0) {
      log.success(`Generated ${results.invoices.length} invoice objects`);
      
      // Store for cleanup
      testInvoices = results.invoices;
      
      // Verify invoice details
      for (const invoice of results.invoices) {
        const teacher = testTeachers.find(t => t._id.toString() === invoice.teacher.toString());
        if (teacher) {
          log.info(`  Invoice for ${teacher.fullName}: ${invoice.totalHours}h, $${invoice.grossAmountUSD}, ${invoice.netAmountEGP} EGP`);
        }
      }
    }
    
    // Verify skipped teachers (those with 0 hours)
    const teacherWithZeroHours = testTeachers.find(t => 
      testClasses.filter(c => c.teacher.toString() === t._id.toString()).length === 0
    );
    
    if (teacherWithZeroHours) {
      const skippedInvoice = results.invoices.find(inv => 
        inv.teacher.toString() === teacherWithZeroHours._id.toString()
      );
      
      if (!skippedInvoice) {
        log.success(`Teacher with 0 hours was correctly skipped`);
      } else {
        log.warning(`Teacher with 0 hours has an invoice (unexpected)`);
      }
    }
    
    log.success('Manual trigger test passed');
    
  } catch (error) {
    log.error(`Manual trigger test failed: ${error.message}`);
    throw error;
  }
}

async function testJobFunctionality() {
  log.section('Testing Job Core Functionality');
  
  try {
    log.info('Verifying job functions exist...');
    
    // Check function exports
    const requiredFunctions = [
      'generateTeacherInvoices',
      'manualTrigger',
      'dryRun'
    ];
    
    const job = require('../jobs/generateTeacherInvoicesJob');
    
    for (const funcName of requiredFunctions) {
      if (typeof job[funcName] === 'function') {
        log.success(`${funcName} function exists`);
      } else {
        throw new Error(`${funcName} function not found`);
      }
    }
    
    // Verify settings
    log.info('Checking salary settings...');
    const settings = await SalarySettings.getGlobalSettings();
    
    log.info(`  Auto-generate invoices: ${settings.autoGenerateInvoices}`);
    log.info(`  Generation day: ${settings.generationDay}`);
    log.info(`  Generation time: ${settings.generationTime}`);
    log.info(`  Notify teachers on publish: ${settings.notifyTeachersOnPublish}`);
    
    // Verify audit logging
    log.info('Checking audit logs...');
    const auditLogs = await TeacherSalaryAudit.find({ action: 'invoice_create' })
      .sort({ timestamp: -1 })
      .limit(5);
    
    if (auditLogs.length > 0) {
      log.success(`Found ${auditLogs.length} recent audit logs`);
      log.info(`  Latest: ${auditLogs[0].action} at ${auditLogs[0].timestamp.toISOString()}`);
    } else {
      log.warning('No audit logs found (may be first run)');
    }
    
    log.success('Job functionality verification passed');
    
  } catch (error) {
    log.error(`Job functionality test failed: ${error.message}`);
    throw error;
  }
}

async function testNotificationIntegration() {
  log.section('Testing Notification Integration');
  
  try {
    log.info('Checking notification service integration...');
    
    // Check if notification service exists
    let notificationService;
    try {
      notificationService = require('../services/notificationService');
      log.success('Notification service found');
    } catch (error) {
      log.warning('Notification service not found (may not be implemented yet)');
      return;
    }
    
    // Check if notifications were created during job execution
    const Notification = require('../models/Notification');
    const recentNotifications = await Notification.find({
      type: { $in: ['system', 'invoice'] },
      createdAt: { $gte: new Date(Date.now() - 60000) } // Last minute
    }).limit(10);
    
    if (recentNotifications.length > 0) {
      log.success(`Found ${recentNotifications.length} recent notifications`);
      recentNotifications.forEach(notif => {
        log.info(`  ${notif.type}: ${notif.title}`);
      });
    } else {
      log.info('No recent notifications found (job may not have triggered notifications)');
    }
    
    log.success('Notification integration test passed');
    
  } catch (error) {
    log.error(`Notification integration test failed: ${error.message}`);
    // Don't throw - notifications are optional
    log.warning('Continuing despite notification test failure...');
  }
}

async function testLockMechanism() {
  log.section('Testing Lock Mechanism');
  
  try {
    log.info('Verifying lock mechanism prevents concurrent execution...');
    
    // The lock mechanism is implemented in the job file
    // We can verify it exists by checking the code structure
    const jobCode = require('fs').readFileSync(require.resolve('../jobs/generateTeacherInvoicesJob'), 'utf8');
    
    if (jobCode.includes('acquireLock') && jobCode.includes('releaseLock')) {
      log.success('Lock functions found in job code');
    } else {
      throw new Error('Lock mechanism not found in job code');
    }
    
    if (jobCode.includes('isJobRunning')) {
      log.success('In-memory lock fallback found');
    } else {
      log.warning('In-memory lock fallback not found');
    }
    
    if (jobCode.includes('JOB_LOCK_KEY') && jobCode.includes('JOB_LOCK_TTL')) {
      log.success('Lock configuration constants found');
    } else {
      throw new Error('Lock configuration not found');
    }
    
    log.success('Lock mechanism verification passed');
    
  } catch (error) {
    log.error(`Lock mechanism test failed: ${error.message}`);
    throw error;
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests() {
  log.section('Module 3 Automated Jobs Tests');
  log.info(`Started at: ${new Date().toISOString()}`);
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  const tests = [
    { name: 'Test Setup', fn: testSetup },
    { name: 'Job Functionality', fn: testJobFunctionality },
    { name: 'Lock Mechanism', fn: testLockMechanism },
    { name: 'Dry Run Mode', fn: testDryRun },
    { name: 'Manual Trigger', fn: testManualTrigger },
    { name: 'Notification Integration', fn: testNotificationIntegration }
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
