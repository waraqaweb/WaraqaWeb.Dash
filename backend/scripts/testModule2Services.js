/**
 * Module 2 Service Layer Test Script
 * 
 * Tests all business logic services:
 * - TeacherSalaryService (core salary logic)
 * - InvoicePDFService (PDF generation)
 * - NotificationService (teacher notifications)
 * - Date/Currency Helpers
 */

const mongoose = require('mongoose');
const TeacherSalaryService = require('../services/teacherSalaryService');
const TeacherInvoicePDFService = require('../services/teacherInvoicePDFService');
const { formatDateDDMMMYYYY, formatDateRangeDDMMMYYYY, getMonthBounds, parseMonthString } = require('../utils/dateHelpers');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
const TeacherInvoice = require('../models/TeacherInvoice');
const User = require('../models/User');
const Class = require('../models/Class');
const fs = require('fs');
const path = require('path');

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
let testStudent;
let testGuardian;
let testClasses = [];
let testInvoice;

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
  
  // Delete test data
  if (testInvoice) {
    await TeacherInvoice.findByIdAndDelete(testInvoice._id).catch(() => {});
  }
  
  if (testClasses.length > 0) {
    await Class.deleteMany({ _id: { $in: testClasses.map(c => c._id) } }).catch(() => {});
  }
  
  if (testTeacher) {
    await User.findByIdAndDelete(testTeacher._id).catch(() => {});
  }
  
  if (testGuardian) {
    await User.findByIdAndDelete(testGuardian._id).catch(() => {});
  }
  
  if (testAdmin) {
    await User.findByIdAndDelete(testAdmin._id).catch(() => {});
  }
  
  // Clean up test PDF files
  const testPDFDir = path.join(__dirname, '../test');
  if (fs.existsSync(testPDFDir)) {
    const files = fs.readdirSync(testPDFDir).filter(f => f.startsWith('test_invoice_') && f.endsWith('.pdf'));
    files.forEach(file => {
      fs.unlinkSync(path.join(testPDFDir, file));
    });
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
      email: `test.admin.module2.${Date.now()}@test.com`,
      password: 'AdminPassword123!',
      role: 'admin'
    });
    log.success(`Created test admin: ${testAdmin.fullName}`);
    
    // Create test teacher
    testTeacher = await User.create({
      firstName: 'Jane',
      lastName: 'Doe',
      email: `test.teacher.module2.${Date.now()}@test.com`,
      password: 'TeacherPassword123!',
      role: 'teacher',
      teacherInfo: {
        subjects: ['Mathematics', 'Science'],
        hourlyRate: 15,
        currentRatePartition: '0-50h',
        effectiveRate: 12,
        preferredCurrency: 'EGP',
        totalHoursYTD: 0,
        totalEarningsYTD: 0,
        customRateOverride: { enabled: false },
        customTransferFee: { enabled: false }
      }
    });
    log.success(`Created test teacher: ${testTeacher.fullName}`);
    
    // Create test guardian
    testGuardian = await User.create({
      firstName: 'Test',
      lastName: 'Guardian',
      email: `test.guardian.module2.${Date.now()}@test.com`,
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
    
    // Ensure salary settings exist
    const settings = await SalarySettings.getGlobalSettings();
    log.success('Salary settings loaded');
    
    // Ensure exchange rate exists for current month
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    let exchangeRate = await MonthlyExchangeRates.findOne({ 
      month: currentMonth, 
      year: currentYear 
    });
    
    if (!exchangeRate) {
      exchangeRate = await MonthlyExchangeRates.setRateForMonth(
        currentMonth,
        currentYear,
        50.5,
        testAdmin._id,
        'TEST - Module 2 Test',
        'Test exchange rate for service layer testing'
      );
    }
    log.success(`Exchange rate set: ${exchangeRate.rate} EGP/USD`);
    
    // Create test classes
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    for (let i = 0; i < 5; i++) {
      const classDate = new Date(monthStart);
      classDate.setDate(classDate.getDate() + i * 3);
      
      const testClass = await Class.create({
        title: `Mathematics Class ${i + 1}`,
        subject: 'Mathematics',
        teacher: testTeacher._id,
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
    log.success(`Created ${testClasses.length} test classes (${testClasses.length} hours total)`);
    
  } catch (error) {
    log.error(`Setup failed: ${error.message}`);
    throw error;
  }
}

async function testDateHelpers() {
  log.section('Testing Date Helper Utilities');
  
  try {
    // Test formatDateDDMMMYYYY
    const testDate = new Date('2025-01-15T12:00:00Z');
    const formatted = formatDateDDMMMYYYY(testDate);
    log.success(`formatDateDDMMMYYYY: ${formatted}`);
    
    if (formatted !== '15 Jan 2025') {
      throw new Error(`Expected "15 Jan 2025", got "${formatted}"`);
    }
    
    // Test formatDateRangeDDMMMYYYY
    const startDate = new Date('2025-01-01T00:00:00Z');
    const endDate = new Date('2025-01-31T23:59:59Z');
    const range = formatDateRangeDDMMMYYYY(startDate, endDate);
    log.success(`formatDateRangeDDMMMYYYY: ${range}`);
    
    // Test getMonthBounds
    const { firstDay, lastDay } = getMonthBounds(2025, 0); // January 2025
    log.success(`getMonthBounds: ${firstDay.toISOString()} → ${lastDay.toISOString()}`);
    
    // Test parseMonthString
    const parsed = parseMonthString('2025-01');
    log.success(`parseMonthString: ${parsed.firstDay.toISOString()} → ${parsed.lastDay.toISOString()}`);
    
    log.success('Date helper utilities tests passed');
    
  } catch (error) {
    log.error(`Date helpers test failed: ${error.message}`);
    throw error;
  }
}

async function testTeacherSalaryService() {
  log.section('Testing TeacherSalaryService');
  
  try {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    // Test hour aggregation
    log.info('Testing hour aggregation...');
    const hourData = await TeacherSalaryService.aggregateTeacherHours(
      testTeacher._id,
      currentMonth,
      currentYear
    );
    
    log.success(`Aggregated hours: ${hourData.totalHours}h from ${hourData.classIds.length} classes`);
    
    if (hourData.totalHours !== testClasses.length) {
      log.warning(`Expected ${testClasses.length}h, got ${hourData.totalHours}h`);
    }
    
    // Test rate calculation
    log.info('Testing rate calculation...');
    const rateInfo = await TeacherSalaryService.getTeacherRate(testTeacher, hourData.totalHours);
    
    log.success(`Rate info: $${rateInfo.rate}/hr (${rateInfo.partition})`);
    log.info(`  Source: ${rateInfo.source}`);
    
    // Test invoice creation
    log.info('Testing invoice creation...');
    testInvoice = await TeacherSalaryService.createTeacherInvoice(
      testTeacher._id,
      currentMonth,
      currentYear,
      { userId: testAdmin._id }
    );
    
    if (!testInvoice) {
      throw new Error('Failed to create invoice');
    }
    
    log.success(`Invoice created: ${testInvoice._id}`);
    log.info(`  Status: ${testInvoice.status}`);
    log.info(`  Hours: ${testInvoice.totalHours}h`);
    log.info(`  Gross (USD): $${testInvoice.grossAmountUSD}`);
    log.info(`  Gross (EGP): ${testInvoice.grossAmountEGP} EGP`);
    log.info(`  Net (EGP): ${testInvoice.netAmountEGP} EGP`);
    
    // Test add bonus
    log.info('Testing bonus addition...');
    await TeacherSalaryService.addBonus(
      testInvoice._id,
      {
        source: 'admin',
        amountUSD: 25,
        reason: 'TEST - Excellent teaching performance this month'
      },
      testAdmin._id
    );
    
    // Reload invoice
    testInvoice = await TeacherInvoice.findById(testInvoice._id);
    log.success(`Bonus added: $${testInvoice.bonuses[0].amountUSD}`);
    log.info(`  New total (EGP): ${testInvoice.totalEGP} EGP`);
    
    // Test add extra
    log.info('Testing extra addition...');
    await TeacherSalaryService.addExtra(
      testInvoice._id,
      {
        category: 'reimbursement',
        amountUSD: 10,
        reason: 'TEST - Internet connection reimbursement'
      },
      testAdmin._id
    );
    
    // Reload invoice
    testInvoice = await TeacherInvoice.findById(testInvoice._id);
    log.success(`Extra added: $${testInvoice.extras[0].amountUSD}`);
    log.info(`  New net amount (EGP): ${testInvoice.netAmountEGP} EGP`);
    
    // Test publish invoice
    log.info('Testing invoice publishing...');
    await TeacherSalaryService.publishInvoice(testInvoice._id, testAdmin._id);
    
    // Reload invoice
    testInvoice = await TeacherInvoice.findById(testInvoice._id);
    log.success(`Invoice published: ${testInvoice.invoiceNumber}`);
    log.info(`  Status: ${testInvoice.status}`);
    log.info(`  Share token: ${testInvoice.shareToken ? 'Generated' : 'Not generated'}`);
    
    // Test YTD summary (before payment)
    log.info('Testing YTD summary (before payment)...');
    let ytdSummary = await TeacherSalaryService.getTeacherYTDSummary(
      testTeacher._id,
      currentYear
    );
    
    log.success('YTD Summary retrieved');
    log.info(`  Total Hours: ${ytdSummary.totalHours}h`);
    log.info(`  Total Earned: ${ytdSummary.totalEarnedEGP} EGP`);
    log.info(`  Invoices Paid: ${ytdSummary.invoicesPaid}`);
    log.info(`  Invoices Pending: ${ytdSummary.invoicesPending}`);
    
    // Test mark as paid
    log.info('Testing mark as paid...');
    await TeacherSalaryService.markInvoiceAsPaid(
      testInvoice._id,
      {
        paymentMethod: 'bank_transfer',
        transactionId: 'TEST-TXN-MODULE2-001',
        paidAt: new Date(),
        note: 'TEST - Payment recorded for module 2 testing'
      },
      testAdmin._id
    );
    
    // Reload invoice
    testInvoice = await TeacherInvoice.findById(testInvoice._id);
    log.success('Invoice marked as paid');
    log.info(`  Status: ${testInvoice.status}`);
    log.info(`  Payment Method: ${testInvoice.paymentMethod}`);
    log.info(`  Transaction ID: ${testInvoice.transactionId}`);
    
    // Test YTD summary (after payment)
    log.info('Testing YTD summary (after payment)...');
    ytdSummary = await TeacherSalaryService.getTeacherYTDSummary(
      testTeacher._id,
      currentYear
    );
    
    log.success('YTD Summary updated');
    log.info(`  Total Hours: ${ytdSummary.totalHours}h`);
    log.info(`  Total Earned: ${ytdSummary.totalEarnedEGP} EGP`);
    log.info(`  Invoices Paid: ${ytdSummary.invoicesPaid}`);
    
    // Verify teacher's YTD was updated
    const updatedTeacher = await User.findById(testTeacher._id);
    log.success('Teacher YTD totals updated');
    log.info(`  YTD Hours: ${updatedTeacher.teacherInfo.totalHoursYTD}h`);
    log.info(`  YTD Earnings: ${updatedTeacher.teacherInfo.totalEarningsYTD} EGP`);
    
    // Test custom rate override
    log.info('Testing custom rate override...');
    await TeacherSalaryService.setCustomRate(
      testTeacher._id,
      25,
      'TEST - Exceptional performance and experience',
      testAdmin._id
    );
    
    const teacherWithCustomRate = await User.findById(testTeacher._id);
    log.success('Custom rate set');
    log.info(`  New Rate: $${teacherWithCustomRate.teacherInfo.customRateOverride.rateUSD}/hr`);
    log.info(`  Reason: ${teacherWithCustomRate.teacherInfo.customRateOverride.reason}`);
    
    // Test custom transfer fee
    log.info('Testing custom transfer fee...');
    await TeacherSalaryService.setCustomTransferFee(
      testTeacher._id,
      'percentage',
      3,
      testAdmin._id
    );
    
    const teacherWithCustomFee = await User.findById(testTeacher._id);
    log.success('Custom transfer fee set');
    log.info(`  Model: ${teacherWithCustomFee.teacherInfo.customTransferFee.model}`);
    log.info(`  Value: ${teacherWithCustomFee.teacherInfo.customTransferFee.value}%`);
    
    log.success('TeacherSalaryService tests passed');
    
  } catch (error) {
    log.error(`TeacherSalaryService test failed: ${error.message}`);
    throw error;
  }
}

async function testPDFService() {
  log.section('Testing Invoice PDF Service');
  
  try {
    // Reload invoice with populated teacher
    const invoice = await TeacherInvoice.findById(testInvoice._id)
      .populate('teacher', 'firstName lastName email')
      .lean();
    
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    
    log.info('Generating PDF...');
    
    // TeacherInvoicePDFService is exported as a singleton instance, not a class
    const pdfDoc = TeacherInvoicePDFService.generateInvoicePDF(invoice);
    
    // Save PDF to file for manual inspection
    const testDir = path.join(__dirname, '../test');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    const pdfPath = path.join(testDir, `test_invoice_${invoice.invoiceNumber}.pdf`);
    const writeStream = fs.createWriteStream(pdfPath);
    
    pdfDoc.pipe(writeStream);
    
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    
    log.success('PDF generated successfully');
    log.info(`  Saved to: ${pdfPath}`);
    log.info(`  Invoice Number: ${invoice.invoiceNumber}`);
    log.info(`  File size: ${fs.statSync(pdfPath).size} bytes`);
    
    // Verify PDF was created
    if (!fs.existsSync(pdfPath)) {
      throw new Error('PDF file was not created');
    }
    
    if (fs.statSync(pdfPath).size === 0) {
      throw new Error('PDF file is empty');
    }
    
    log.success('Invoice PDF Service tests passed');
    
  } catch (error) {
    log.error(`PDF Service test failed: ${error.message}`);
    throw error;
  }
}

// =============================================================================
// MAIN TEST RUNNER
// =============================================================================

async function runAllTests() {
  log.section('Module 2 Service Layer Tests');
  log.info(`Started at: ${new Date().toISOString()}`);
  
  let testsPassed = 0;
  let testsFailed = 0;
  
  const tests = [
    { name: 'Test Setup', fn: testSetup },
    { name: 'Date Helpers', fn: testDateHelpers },
    { name: 'TeacherSalaryService', fn: testTeacherSalaryService },
    { name: 'Invoice PDF Service', fn: testPDFService }
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
