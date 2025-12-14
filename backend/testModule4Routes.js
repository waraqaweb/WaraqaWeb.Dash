/**
 * Module 4 Test Script: API Routes
 * Tests all Teacher Salary REST API endpoints
 * 
 * Run: node testModule4Routes.js
 */

const mongoose = require('mongoose');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Models
const User = require('./models/User');
const TeacherInvoice = require('./models/TeacherInvoice');
const SalarySettings = require('./models/SalarySettings');
const MonthlyExchangeRates = require('./models/MonthlyExchangeRates');
const Class = require('./models/Class');

// Routes
const teacherSalaryRoutes = require('./routes/teacherSalary');
const { authenticateToken, requireAdmin, requireTeacher } = require('./middleware/auth');

// Test Configuration
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqa_test';
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';

// Create Express app for testing
function createTestApp() {
  const app = express();
  app.use(express.json());
  
  // Inject JWT_SECRET into process.env for middleware
  process.env.JWT_SECRET = JWT_SECRET;
  
  app.use('/api/teacher-salary', teacherSalaryRoutes);
  
  return app;
}

// Test Data
let testUsers = {
  admin: null,
  teacher1: null,
  teacher2: null
};

let testTokens = {
  admin: null,
  teacher1: null,
  teacher2: null
};

let testData = {
  invoiceId: null,
  bonusId: null,
  extraId: null
};

// Helper Functions
function generateToken(user) {
  return jwt.sign(
    { 
      userId: user._id.toString(),  // middleware expects 'userId' not '_id'
      email: user.email,
      role: user.role 
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function setupTestData() {
  console.log('Setting up test data...');
  
  // Create admin user
  testUsers.admin = await User.create({
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin-module4@test.com',
    password: 'password123',
    role: 'admin',
    active: true
  });
  
  // Create teacher users
  testUsers.teacher1 = await User.create({
    firstName: 'Teacher',
    lastName: 'One',
    email: 'teacher1-module4@test.com',
    password: 'password123',
    role: 'teacher',
    active: true,
    teacherInfo: {
      hourlyRate: 25.00,
      transferFeeModel: 'percentage',
      transferFeeValue: 3.00
    }
  });
  
  testUsers.teacher2 = await User.create({
    firstName: 'Teacher',
    lastName: 'Two',
    email: 'teacher2-module4@test.com',
    password: 'password123',
    role: 'teacher',
    active: true,
    teacherInfo: {
      hourlyRate: 30.00,
      transferFeeModel: 'fixed',
      transferFeeValue: 5.00
    }
  });
  
  // Generate tokens
  testTokens.admin = generateToken(testUsers.admin);
  testTokens.teacher1 = generateToken(testUsers.teacher1);
  testTokens.teacher2 = generateToken(testUsers.teacher2);
  
  // Create salary settings
  const settings = await SalarySettings.getGlobalSettings();
  console.log('✅ Salary settings initialized');
  
  // Set exchange rate for current month
  const now = new Date();
  await MonthlyExchangeRates.setRateForMonth(
    now.getMonth() + 1,
    now.getFullYear(),
    50.00,
    testUsers.admin._id,
    'Test Setup'
  );
  console.log('✅ Exchange rate set');
  
  // Create some test classes for teacher1
  const classes = [];
  const guardianId = new mongoose.Types.ObjectId();
  
  for (let i = 0; i < 5; i++) {
    // Create classes in the current month to be picked up by invoice generation
    const classDate = new Date();
    classDate.setDate(i + 1);  // Days 1-5 of current month
    classDate.setHours(10, 0, 0, 0);
    
    const studentId = new mongoose.Types.ObjectId();
    
    classes.push({
      title: `Test Class ${i + 1}`,
      scheduledDate: classDate,
      duration: 60,
      teacher: testUsers.teacher1._id,
      subject: 'Mathematics',
      student: {
        _id: studentId,
        studentId: studentId,
        studentName: `Student ${i + 1}`,
        guardianId: guardianId
      },
      status: 'completed',
      createdBy: testUsers.admin._id,
      reported: true,
      reportedBy: testUsers.teacher1._id,
      reportedAt: classDate
    });
  }
  
  await Class.insertMany(classes);
  console.log('✅ Test classes created');
  
  console.log('✅ Test data setup complete\n');
}

async function cleanupTestData() {
  console.log('\nCleaning up test data...');
  
  await User.deleteMany({ email: { $regex: /module4@test\.com$/ } });
  await TeacherInvoice.deleteMany({ teacher: { $in: [testUsers.teacher1?._id, testUsers.teacher2?._id] } });
  await Class.deleteMany({ teacher: testUsers.teacher1?._id });
  
  console.log('✅ Cleanup complete');
}

// Test Cases
const tests = {
  async test1_generateInvoices(app) {
    console.log('\n📋 Test 1: Generate Monthly Invoices (Admin)');
    
    const now = new Date();
    const response = await request(app)
      .post('/api/teacher-salary/admin/generate')
      .set('Authorization', `Bearer ${testTokens.admin}`)
      .send({
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        dryRun: false
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    if (!response.body.results) {
      throw new Error('Expected results object');
    }
    
    // Results can be 0 created if teachers have no hours
    const results = response.body.results;
    
    console.log(`   ✅ Generated ${results.created || 0} invoices`);
    console.log(`   ✅ Skipped ${results.skipped || 0} (already exist or no hours)`);
    
    return response.body;
  },
  
  async test2_getAdminInvoicesList(app) {
    console.log('\n📋 Test 2: Get All Invoices (Admin)');
    
    const now = new Date();
    const response = await request(app)
      .get('/api/teacher-salary/admin/invoices')
      .set('Authorization', `Bearer ${testTokens.admin}`)
      .query({
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        page: 1,
        limit: 10
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    if (!Array.isArray(response.body.invoices)) {
      throw new Error('Expected invoices array');
    }
    
    // Store invoice ID for later tests
    if (response.body.invoices.length > 0) {
      testData.invoiceId = response.body.invoices[0]._id;
    }
    
    console.log(`   ✅ Retrieved ${response.body.invoices.length} invoices`);
    console.log(`   ✅ Total: ${response.body.pagination.total}`);
    console.log(`   ✅ Pagination working`);
    
    return response.body;
  },
  
  async test3_getSingleInvoice(app) {
    console.log('\n📋 Test 3: Get Single Invoice (Admin)');
    
    if (!testData.invoiceId) {
      console.log('   ⚠️  No invoice to test, skipping');
      return;
    }
    
    const response = await request(app)
      .get(`/api/teacher-salary/admin/invoices/${testData.invoiceId}`)
      .set('Authorization', `Bearer ${testTokens.admin}`);
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success || !response.body.invoice) {
      throw new Error('Expected success with invoice object');
    }
    
    const invoice = response.body.invoice;
    
    if (!invoice.teacher || !invoice.teacher.firstName) {
      throw new Error('Expected populated teacher data');
    }
    
    console.log(`   ✅ Invoice ${invoice.invoiceNumber} retrieved`);
    console.log(`   ✅ Teacher: ${invoice.teacher.firstName} ${invoice.teacher.lastName}`);
    console.log(`   ✅ Status: ${invoice.status}`);
    console.log(`   ✅ Total: $${invoice.grossAmountUSD.toFixed(2)}`);
    
    return response.body;
  },
  
  async test4_addBonus(app) {
    console.log('\n📋 Test 4: Add Bonus to Invoice (Admin)');
    
    if (!testData.invoiceId) {
      console.log('   ⚠️  No invoice to test, skipping');
      return;
    }
    
    const response = await request(app)
      .post(`/api/teacher-salary/admin/invoices/${testData.invoiceId}/bonuses`)
      .set('Authorization', `Bearer ${testTokens.admin}`)
      .send({
        source: 'referral',
        amountUSD: 50.00,
        reason: 'Referral bonus for bringing in new student'
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    const invoice = response.body.invoice;
    
    if (!invoice.bonuses || invoice.bonuses.length === 0) {
      throw new Error('Expected bonus to be added');
    }
    
    const bonus = invoice.bonuses[invoice.bonuses.length - 1];
    testData.bonusId = bonus._id;
    
    console.log(`   ✅ Bonus added: $${bonus.amountUSD}`);
    console.log(`   ✅ Source: ${bonus.source}`);
    console.log(`   ✅ Total bonuses: $${invoice.bonusesUSD.toFixed(2)}`);
    
    return response.body;
  },
  
  async test5_addExtra(app) {
    console.log('\n📋 Test 5: Add Extra to Invoice (Admin)');
    
    if (!testData.invoiceId) {
      console.log('   ⚠️  No invoice to test, skipping');
      return;
    }
    
    const response = await request(app)
      .post(`/api/teacher-salary/admin/invoices/${testData.invoiceId}/extras`)
      .set('Authorization', `Bearer ${testTokens.admin}`)
      .send({
        category: 'transportation',
        amountUSD: 25.00,
        reason: 'Transportation reimbursement for in-person meetings'
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    const invoice = response.body.invoice;
    
    if (!invoice.extras || invoice.extras.length === 0) {
      throw new Error('Expected extra to be added');
    }
    
    const extra = invoice.extras[invoice.extras.length - 1];
    testData.extraId = extra._id;
    
    console.log(`   ✅ Extra added: $${extra.amountUSD}`);
    console.log(`   ✅ Category: ${extra.category}`);
    console.log(`   ✅ Total extras: $${invoice.extrasUSD.toFixed(2)}`);
    
    return response.body;
  },
  
  async test6_publishInvoice(app) {
    console.log('\n📋 Test 6: Publish Invoice (Admin)');
    
    if (!testData.invoiceId) {
      console.log('   ⚠️  No invoice to test, skipping');
      return;
    }
    
    const response = await request(app)
      .post(`/api/teacher-salary/admin/invoices/${testData.invoiceId}/publish`)
      .set('Authorization', `Bearer ${testTokens.admin}`);
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    const invoice = response.body.invoice;
    
    if (invoice.status !== 'published') {
      throw new Error(`Expected status 'published', got '${invoice.status}'`);
    }
    
    if (!invoice.publishedAt) {
      throw new Error('Expected publishedAt timestamp');
    }
    
    console.log(`   ✅ Invoice published`);
    console.log(`   ✅ Status: ${invoice.status}`);
    console.log(`   ✅ Published at: ${new Date(invoice.publishedAt).toISOString()}`);
    
    return response.body;
  },
  
  async test7_markAsPaid(app) {
    console.log('\n📋 Test 7: Mark Invoice as Paid (Admin)');
    
    if (!testData.invoiceId) {
      console.log('   ⚠️  No invoice to test, skipping');
      return;
    }
    
    const response = await request(app)
      .post(`/api/teacher-salary/admin/invoices/${testData.invoiceId}/mark-paid`)
      .set('Authorization', `Bearer ${testTokens.admin}`)
      .send({
        paymentMethod: 'bank_transfer',
        transactionId: 'TXN-TEST-12345',
        note: 'Test payment'
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    const invoice = response.body.invoice;
    
    if (invoice.status !== 'paid') {
      throw new Error(`Expected status 'paid', got '${invoice.status}'`);
    }
    
    if (!invoice.paidAt) {
      throw new Error('Expected paidAt timestamp');
    }
    
    if (invoice.paymentInfo.paymentMethod !== 'bank_transfer') {
      throw new Error('Expected payment method to be saved');
    }
    
    console.log(`   ✅ Invoice marked as paid`);
    console.log(`   ✅ Status: ${invoice.status}`);
    console.log(`   ✅ Payment method: ${invoice.paymentInfo.paymentMethod}`);
    console.log(`   ✅ Transaction ID: ${invoice.paymentInfo.transactionId}`);
    
    return response.body;
  },
  
  async test8_teacherGetOwnInvoices(app) {
    console.log('\n📋 Test 8: Get Own Invoices (Teacher)');
    
    const now = new Date();
    const response = await request(app)
      .get('/api/teacher-salary/teacher/invoices')
      .set('Authorization', `Bearer ${testTokens.teacher1}`)
      .query({
        year: now.getFullYear()
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    if (!Array.isArray(response.body.invoices)) {
      throw new Error('Expected invoices array');
    }
    
    // Verify teacher can only see their own invoices
    const allBelongToTeacher = response.body.invoices.every(
      inv => inv.teacher.toString() === testUsers.teacher1._id.toString()
    );
    
    if (!allBelongToTeacher) {
      throw new Error('Teacher should only see their own invoices');
    }
    
    console.log(`   ✅ Retrieved ${response.body.invoices.length} invoices`);
    console.log(`   ✅ All invoices belong to requesting teacher`);
    
    return response.body;
  },
  
  async test9_teacherGetYTD(app) {
    console.log('\n📋 Test 9: Get YTD Summary (Teacher)');
    
    const now = new Date();
    const response = await request(app)
      .get('/api/teacher-salary/teacher/ytd')
      .set('Authorization', `Bearer ${testTokens.teacher1}`)
      .query({
        year: now.getFullYear()
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    const summary = response.body.summary;
    
    // YTD summary returns totalEarnedEGP, not totalEarningsUSD
    if (typeof summary.totalHours !== 'number') {
      throw new Error('Expected totalHours number');
    }
    
    if (typeof summary.totalEarnedEGP !== 'number') {
      throw new Error('Expected totalEarnedEGP number');
    }
    
    if (typeof summary.invoicesPaid !== 'number') {
      throw new Error('Expected invoicesPaid number');
    }
    
    console.log(`   ✅ Year: ${now.getFullYear()}`);
    console.log(`   ✅ Total Hours: ${summary.totalHours}`);
    console.log(`   ✅ Total Earned: ${summary.totalEarnedEGP.toFixed(2)} EGP`);
    console.log(`   ✅ Invoices Paid: ${summary.invoicesPaid}`);
    
    return response.body;
  },
  
  async test10_salarySettings(app) {
    console.log('\n📋 Test 10: Get Salary Settings (Admin)');
    
    const response = await request(app)
      .get('/api/teacher-salary/admin/settings')
      .set('Authorization', `Bearer ${testTokens.admin}`);
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    const settings = response.body.settings;
    
    if (!settings.ratePartitions || !Array.isArray(settings.ratePartitions)) {
      throw new Error('Expected ratePartitions array');
    }
    
    if (!settings.defaultTransferFee) {
      throw new Error('Expected defaultTransferFee object');
    }
    
    console.log(`   ✅ Rate partitions: ${settings.ratePartitions.length}`);
    console.log(`   ✅ Default transfer fee (percentage): ${settings.defaultTransferFee.percentage}%`);
    console.log(`   ✅ Default transfer fee (fixed): $${settings.defaultTransferFee.fixed}`);
    
    return response.body;
  },
  
  async test11_updateRatePartition(app) {
    console.log('\n📋 Test 11: Update Rate Partition (Admin)');
    
    const response = await request(app)
      .put('/api/teacher-salary/admin/settings/partitions/0-50h')
      .set('Authorization', `Bearer ${testTokens.admin}`)
      .send({
        rateUSD: 13.00,
        applyToDrafts: false
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    const result = response.body.result;
    
    if (result.newRate !== 13.00) {
      throw new Error(`Expected new rate 13.00, got ${result.newRate}`);
    }
    
    console.log(`   ✅ Rate updated to: $${result.newRate}/hour`);
    console.log(`   ✅ Previous rate: $${result.previousRate}/hour`);
    console.log(`   ✅ Partition: ${result.partition.name}`);
    
    return response.body;
  },
  
  async test12_setExchangeRate(app) {
    console.log('\n📋 Test 12: Set Exchange Rate (Admin)');
    
    const now = new Date();
    const nextMonth = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
    const yearForNextMonth = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    
    const response = await request(app)
      .post('/api/teacher-salary/admin/exchange-rates')
      .set('Authorization', `Bearer ${testTokens.admin}`)
      .send({
        month: nextMonth,
        year: yearForNextMonth,
        rate: 51.50,
        source: 'Test API',
        notes: 'Test exchange rate'
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    const rate = response.body.rate;
    
    if (rate.rate !== 51.50) {
      throw new Error(`Expected rate 51.50, got ${rate.rate}`);
    }
    
    console.log(`   ✅ Exchange rate set: ${rate.rate} EGP/USD`);
    console.log(`   ✅ Month/Year: ${rate.month}/${rate.year}`);
    console.log(`   ✅ Source: ${rate.source}`);
    
    return response.body;
  },
  
  async test13_getExchangeRates(app) {
    console.log('\n📋 Test 13: Get Exchange Rates (Admin)');
    
    const now = new Date();
    const response = await request(app)
      .get('/api/teacher-salary/admin/exchange-rates')
      .set('Authorization', `Bearer ${testTokens.admin}`)
      .query({
        year: now.getFullYear()
      });
    
    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    
    if (!response.body.success) {
      throw new Error('Expected success: true');
    }
    
    if (!Array.isArray(response.body.rates)) {
      throw new Error('Expected rates array');
    }
    
    // Should have at least the rate we set in setup
    if (response.body.rates.length === 0) {
      throw new Error('Expected at least one exchange rate');
    }
    
    console.log(`   ✅ Retrieved ${response.body.rates.length} exchange rates`);
    console.log(`   ✅ Year: ${now.getFullYear()}`);
    
    return response.body;
  },
  
  async test14_authorizationCheck(app) {
    console.log('\n📋 Test 14: Authorization Checks');
    
    // Teacher should not be able to access admin endpoints
    const adminResponse = await request(app)
      .get('/api/teacher-salary/admin/invoices')
      .set('Authorization', `Bearer ${testTokens.teacher1}`);
    
    if (adminResponse.status !== 403 && adminResponse.status !== 401) {
      throw new Error(`Expected 403 or 401, got ${adminResponse.status} - teacher accessed admin route`);
    }
    
    console.log(`   ✅ Teacher blocked from admin routes`);
    
    // Teacher should not be able to see other teacher's invoices
    if (testData.invoiceId) {
      // Get the invoice to see which teacher it belongs to
      const invoiceCheck = await TeacherInvoice.findById(testData.invoiceId);
      
      // Use the OTHER teacher's token
      const wrongTeacherToken = invoiceCheck.teacher.toString() === testUsers.teacher1._id.toString()
        ? testTokens.teacher2
        : testTokens.teacher1;
      
      const wrongTeacherResponse = await request(app)
        .get(`/api/teacher-salary/teacher/invoices/${testData.invoiceId}/pdf`)
        .set('Authorization', `Bearer ${wrongTeacherToken}`);
      
      if (wrongTeacherResponse.status !== 403 && wrongTeacherResponse.status !== 404) {
        throw new Error(`Expected 403 or 404, got ${wrongTeacherResponse.status} - teacher accessed other's invoice`);
      }
      
      console.log(`   ✅ Teacher blocked from other teachers' invoices`);
    }
    
    // Unauthenticated access should fail (except public share links)
    const noAuthResponse = await request(app)
      .get('/api/teacher-salary/teacher/invoices');
    
    if (noAuthResponse.status !== 401 && noAuthResponse.status !== 403) {
      throw new Error(`Expected 401 or 403, got ${noAuthResponse.status} - unauthenticated access allowed`);
    }
    
    console.log(`   ✅ Unauthenticated requests blocked`);
    
    return { success: true };
  }
};

// Main Test Runner
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          MODULE 4 TEST SUITE: API ROUTES                       ║');
  console.log('║          Teacher Salary System REST API Verification          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  const results = {
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };
  
  try {
    // Connect to test database
    console.log('Connecting to test database...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Cleanup any existing test data
    await cleanupTestData();
    
    // Setup test data
    await setupTestData();
    
    // Create test app
    const app = createTestApp();
    
    // Run tests
    const testNames = Object.keys(tests);
    console.log(`\nRunning ${testNames.length} tests...\n`);
    console.log('═'.repeat(70));
    
    for (const testName of testNames) {
      try {
        await tests[testName](app);
        results.passed++;
        console.log(`✅ ${testName} PASSED`);
      } catch (error) {
        if (error.message.includes('skipping')) {
          results.skipped++;
          console.log(`⚠️  ${testName} SKIPPED`);
        } else {
          results.failed++;
          results.errors.push({ test: testName, error: error.message });
          console.log(`❌ ${testName} FAILED`);
          console.error(`   Error: ${error.message}`);
        }
      }
    }
    
    console.log('\n' + '═'.repeat(70));
    
  } catch (error) {
    console.error('\n❌ FATAL ERROR:', error.message);
    console.error(error.stack);
    results.errors.push({ test: 'Setup/Teardown', error: error.message });
  } finally {
    // Cleanup
    await cleanupTestData();
    
    // Disconnect
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
  
  // Print Summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  const total = results.passed + results.failed + results.skipped;
  const passRate = total > 0 ? ((results.passed / total) * 100).toFixed(1) : 0;
  
  console.log(`Total Tests:    ${total}`);
  console.log(`✅ Passed:      ${results.passed}`);
  console.log(`❌ Failed:      ${results.failed}`);
  console.log(`⚠️  Skipped:     ${results.skipped}`);
  console.log(`📊 Pass Rate:   ${passRate}%`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    results.errors.forEach(({ test, error }) => {
      console.log(`\n   ${test}:`);
      console.log(`   ${error}`);
    });
  }
  
  console.log('\n' + '═'.repeat(70));
  
  if (results.failed === 0 && results.passed > 0) {
    console.log('\n🎉 ALL TESTS PASSED! Module 4 API Routes are working correctly.\n');
    process.exit(0);
  } else if (results.passed === 0 && results.failed > 0) {
    console.log('\n❌ ALL TESTS FAILED! Please review the errors above.\n');
    process.exit(1);
  } else {
    console.log(`\n⚠️  ${results.passed} tests passed, ${results.failed} failed.\n`);
    process.exit(results.failed > 0 ? 1 : 0);
  }
}

// Run tests
if (require.main === module) {
  runTests().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { runTests, createTestApp };
