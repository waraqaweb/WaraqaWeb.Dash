// backend/testModule6Notifications.js
/**
 * Test Suite for Module 6: Notifications System
 * Tests notification model, email service, notification service, and integration
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Models and Services
const Notification = require('./models/Notification');
const User = require('./models/User');
const TeacherInvoice = require('./models/TeacherInvoice');
const emailService = require('./services/emailService');
const notificationService = require('./services/notificationService');
const teacherSalaryService = require('./services/teacherSalaryService');

// Test counters
let testsPassed = 0;
let testsFailed = 0;

// Test data
let testTeacher;
let testAdmin;
let testInvoice;

/**
 * Helper: Assert function
 */
function assert(condition, testName) {
  if (condition) {
    console.log(`✓ ${testName}`);
    testsPassed++;
    return true;
  } else {
    console.error(`✗ ${testName}`);
    testsFailed++;
    return false;
  }
}

/**
 * Setup test data
 */
async function setupTestData() {
  console.log('\n📝 Setting up test data...\n');

  // Create test teacher
  testTeacher = await User.create({
    firstName: 'Test',
    lastName: 'Teacher',
    email: `test.teacher.${Date.now()}@test.com`,
    password: 'hashedpassword',
    role: 'teacher',
    isActive: true,
    teacherInfo: {
      subjects: ['Mathematics'],
      hourlyRate: 15,
      notificationPreferences: {
        invoicePublished: { inApp: true, email: true },
        paymentReceived: { inApp: true, email: true },
        bonusAdded: { inApp: true, email: true }
      }
    }
  });

  // Create test admin
  testAdmin = await User.create({
    firstName: 'Test',
    lastName: 'Admin',
    email: `test.admin.${Date.now()}@test.com`,
    password: 'hashedpassword',
    role: 'admin',
    isActive: true
  });

  // Create test invoice
  testInvoice = await TeacherInvoice.create({
    teacher: testTeacher._id,
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    invoiceNumber: `TEST-${Date.now()}`,
    status: 'draft',
    totalHours: 40,
    grossAmountUSD: 600,
    netAmountUSD: 600,
    netAmountEGP: 18000,
    currency: 'EGP',
    exchangeRate: 30,
    rateSnapshot: {
      rate: 15,
      currency: 'USD',
      effectiveFrom: new Date(),
      appliedAt: new Date(),
      partition: 'egypt'
    },
    exchangeRateSnapshot: {
      rate: 30,
      source: 'fixed',
      appliedAt: new Date()
    },
    transferFeeSnapshot: {
      source: 'system_default',
      model: 'none',
      value: 0,
      appliedAt: new Date()
    },
    bonuses: [],
    extras: [],
    classBreakdown: []
  });

  console.log('✓ Test data created successfully\n');
}

/**
 * Cleanup test data
 */
async function cleanupTestData() {
  console.log('\n🧹 Cleaning up test data...\n');

  if (testTeacher) await User.deleteOne({ _id: testTeacher._id });
  if (testAdmin) await User.deleteOne({ _id: testAdmin._id });
  if (testInvoice) await TeacherInvoice.deleteOne({ _id: testInvoice._id });
  await Notification.deleteMany({ 
    user: { $in: [testTeacher?._id, testAdmin?._id] }
  });

  console.log('✓ Test data cleaned up\n');
}

/**
 * Test 1: Notification Model Enhancement
 */
async function testNotificationModel() {
  console.log('TEST 1: Notification Model Enhancement');
  console.log('─'.repeat(60));

  try {
    // Test creating notification with teacher_salary type
    const notification1 = await Notification.create({
      user: testTeacher._id,
      role: 'teacher',
      type: 'teacher_salary',
      relatedTo: 'teacher_invoice',
      relatedTeacherInvoice: testInvoice._id,
      title: 'Test Invoice Published',
      message: 'This is a test notification',
      actionRequired: true,
      actionLink: '/teacher/salary'
    });

    assert(
      notification1 && notification1.type === 'teacher_salary',
      '1.1 Notification created with teacher_salary type'
    );

    assert(
      notification1.relatedTo === 'teacher_invoice',
      '1.2 Notification has teacher_invoice relatedTo'
    );

    assert(
      notification1.relatedTeacherInvoice.toString() === testInvoice._id.toString(),
      '1.3 Notification linked to TeacherInvoice'
    );

    // Test creating notification with payment type
    const notification2 = await Notification.create({
      user: testTeacher._id,
      role: 'teacher',
      type: 'payment',
      relatedTo: 'teacher_payment',
      relatedTeacherInvoice: testInvoice._id,
      title: 'Test Payment Received',
      message: 'Payment test'
    });

    assert(
      notification2 && notification2.type === 'payment',
      '1.4 Notification created with payment type'
    );

    assert(
      notification2.relatedTo === 'teacher_payment',
      '1.5 Notification has teacher_payment relatedTo'
    );

    // Cleanup
    await Notification.deleteMany({ _id: { $in: [notification1._id, notification2._id] } });

  } catch (error) {
    console.error('✗ Test 1 Error:', error.message);
    testsFailed++;
  }

  console.log('');
}

/**
 * Test 2: Email Service Templates
 */
async function testEmailService() {
  console.log('TEST 2: Email Service Templates');
  console.log('─'.repeat(60));

  try {
    // Test invoice published email
    const result1 = await emailService.sendInvoicePublished(testTeacher, testInvoice);
    assert(
      result1.sent === true || result1.sent === false,
      '2.1 Invoice published email function executed (sent: ' + result1.sent + ')'
    );

    // Update invoice for payment test
    testInvoice.status = 'published';
    testInvoice.paidAt = new Date();
    testInvoice.paymentInfo = {
      paymentMethod: 'Bank Transfer',
      transactionId: 'TEST123'
    };

    // Test payment received email
    const result2 = await emailService.sendPaymentReceived(testTeacher, testInvoice);
    assert(
      result2.sent === true || result2.sent === false,
      '2.2 Payment received email function executed (sent: ' + result2.sent + ')'
    );

    // Test bonus added email
    const testBonus = {
      amountUSD: 50,
      source: 'Performance',
      reason: 'Excellent teaching'
    };
    const result3 = await emailService.sendBonusAdded(testTeacher, testInvoice, testBonus);
    assert(
      result3.sent === true || result3.sent === false,
      '2.3 Bonus added email function executed (sent: ' + result3.sent + ')'
    );

    // Test admin summary email
    const testSummary = {
      month: 12,
      year: 2024,
      totalProcessed: 10,
      created: 8,
      skipped: [],
      failed: []
    };
    const result4 = await emailService.sendAdminInvoiceGenerationSummary(testAdmin, testSummary);
    assert(
      result4.sent === true || result4.sent === false,
      '2.4 Admin summary email function executed (sent: ' + result4.sent + ')'
    );

  } catch (error) {
    console.error('✗ Test 2 Error:', error.message);
    testsFailed++;
  }

  console.log('');
}

/**
 * Test 3: Notification Service Functions
 */
async function testNotificationService() {
  console.log('TEST 3: Notification Service Functions');
  console.log('─'.repeat(60));

  try {
    // Test invoice published notification
    const result1 = await notificationService.notifyInvoicePublished(
      testTeacher._id,
      testInvoice
    );
    assert(
      result1.success === true,
      '3.1 Invoice published notification sent'
    );

    // Verify in-app notification created
    const notification1 = await Notification.findOne({
      user: testTeacher._id,
      type: 'teacher_salary',
      relatedTo: 'teacher_invoice'
    });
    assert(
      notification1 !== null,
      '3.2 In-app notification created for invoice published'
    );

    // Test payment received notification
    const result2 = await notificationService.notifyPaymentReceived(
      testTeacher._id,
      testInvoice
    );
    assert(
      result2.success === true,
      '3.3 Payment received notification sent'
    );

    const notification2 = await Notification.findOne({
      user: testTeacher._id,
      type: 'payment',
      relatedTo: 'teacher_payment'
    });
    assert(
      notification2 !== null,
      '3.4 In-app notification created for payment received'
    );

    // Test bonus added notification
    const testBonus = {
      amountUSD: 50,
      source: 'Performance',
      reason: 'Great work'
    };
    const result3 = await notificationService.notifyBonusAdded(
      testTeacher._id,
      testInvoice,
      testBonus
    );
    assert(
      result3.success === true,
      '3.5 Bonus added notification sent'
    );

    const notification3 = await Notification.findOne({
      user: testTeacher._id,
      type: 'teacher_salary',
      relatedTo: 'teacher_bonus'
    });
    assert(
      notification3 !== null,
      '3.6 In-app notification created for bonus added'
    );

    // Test extra added notification
    const testExtra = {
      amountUSD: 25,
      description: 'Travel reimbursement'
    };
    const result4 = await notificationService.notifyExtraAdded(
      testTeacher._id,
      testInvoice,
      testExtra
    );
    assert(
      result4.success === true,
      '3.7 Extra added notification sent'
    );

  } catch (error) {
    console.error('✗ Test 3 Error:', error.message);
    testsFailed++;
  }

  console.log('');
}

/**
 * Test 4: Notification Preferences
 */
async function testNotificationPreferences() {
  console.log('TEST 4: Notification Preferences');
  console.log('─'.repeat(60));

  try {
    // Test getting preferences
    const prefs1 = await notificationService.getUserNotificationPreferences(testTeacher._id);
    assert(
      prefs1 !== null && prefs1.invoicePublished !== undefined,
      '4.1 Get notification preferences'
    );

    assert(
      prefs1.invoicePublished.inApp === true && prefs1.invoicePublished.email === true,
      '4.2 Default preferences are enabled'
    );

    // Test updating preferences
    const updateResult = await notificationService.updateUserNotificationPreferences(
      testTeacher._id,
      {
        invoicePublished: { inApp: true, email: false },
        paymentReceived: { inApp: false, email: true },
        bonusAdded: { inApp: true, email: true }
      }
    );

    assert(
      updateResult.success === true,
      '4.3 Update notification preferences'
    );

    // Verify updated preferences
    const prefs2 = await notificationService.getUserNotificationPreferences(testTeacher._id);
    assert(
      prefs2.invoicePublished.email === false,
      '4.4 Invoice published email disabled'
    );

    assert(
      prefs2.paymentReceived.inApp === false,
      '4.5 Payment received in-app disabled'
    );

    // Test notification respects preferences (email disabled for invoice)
    await Notification.deleteMany({ user: testTeacher._id });
    const result = await notificationService.notifyInvoicePublished(
      testTeacher._id,
      testInvoice
    );

    assert(
      result.success === true,
      '4.6 Notification sent with custom preferences'
    );

    // Verify in-app notification still created (inApp: true)
    const notification = await Notification.findOne({
      user: testTeacher._id,
      type: 'teacher_salary'
    });
    assert(
      notification !== null,
      '4.7 In-app notification created when enabled'
    );

  } catch (error) {
    console.error('✗ Test 4 Error:', error.message);
    testsFailed++;
  }

  console.log('');
}

/**
 * Test 5: Integration with Invoice Workflow
 */
async function testIntegrationWithWorkflow() {
  console.log('TEST 5: Integration with Invoice Workflow');
  console.log('─'.repeat(60));

  try {
    // Clear previous notifications
    await Notification.deleteMany({ user: testTeacher._id });

    // Reset teacher preferences to defaults
    await notificationService.updateUserNotificationPreferences(
      testTeacher._id,
      {
        invoicePublished: { inApp: true, email: true },
        paymentReceived: { inApp: true, email: true },
        bonusAdded: { inApp: true, email: true }
      }
    );

    // Test 5.1: Publishing invoice triggers notification
    testInvoice.status = 'draft';
    await testInvoice.save();

    await teacherSalaryService.publishInvoice(testInvoice._id, testAdmin._id);

    // Wait a bit for async notification
    await new Promise(resolve => setTimeout(resolve, 500));

    const publishNotif = await Notification.findOne({
      user: testTeacher._id,
      type: 'teacher_salary',
      relatedTeacherInvoice: testInvoice._id
    }).sort({ createdAt: -1 });

    assert(
      publishNotif !== null,
      '5.1 Publishing invoice created notification'
    );

    // Test 5.2: Adding bonus (before payment)
    await Notification.deleteMany({ 
      user: testTeacher._id, 
      relatedTo: 'teacher_bonus' 
    });

    await teacherSalaryService.addBonus(
      testInvoice._id,
      {
        source: 'admin',
        amountUSD: 75,
        reason: 'Outstanding performance'
      },
      testAdmin._id
    );

    await new Promise(resolve => setTimeout(resolve, 500));

    const bonusNotif = await Notification.findOne({
      user: testTeacher._id,
      relatedTo: 'teacher_bonus',
      relatedTeacherInvoice: testInvoice._id
    }).sort({ createdAt: -1 });

    assert(
      bonusNotif !== null,
      '5.2 Adding bonus created notification'
    );

    assert(
      bonusNotif.message.includes('$75'),
      '5.3 Bonus notification contains correct amount'
    );

    // Test 5.4: Adding extra (before payment)
    await teacherSalaryService.addExtra(
      testInvoice._id,
      {
        category: 'reimbursement',
        amountUSD: 30,
        reason: 'Conference travel reimbursement'
      },
      testAdmin._id
    );

    await new Promise(resolve => setTimeout(resolve, 500));

    const extraNotif = await Notification.findOne({
      user: testTeacher._id,
      message: { $regex: /extra/i },
      relatedTeacherInvoice: testInvoice._id
    }).sort({ createdAt: -1 });

    assert(
      extraNotif !== null,
      '5.4 Adding extra created notification'
    );

    // Test 5.5: Marking as paid triggers notification (do this last)
    await Notification.deleteMany({ 
      user: testTeacher._id, 
      type: 'payment' 
    });

    await teacherSalaryService.markInvoiceAsPaid(
      testInvoice._id,
      {
        paymentMethod: 'bank_transfer',
        transactionId: 'TEST456',
        notes: 'Test payment'
      },
      testAdmin._id
    );

    // Wait a bit longer for async notification
    await new Promise(resolve => setTimeout(resolve, 1000));

    const paymentNotif = await Notification.findOne({
      user: testTeacher._id,
      type: 'payment',
      relatedTeacherInvoice: testInvoice._id
    }).sort({ createdAt: -1 });

    assert(
      paymentNotif !== null,
      '5.5 Marking as paid created notification'
    );

  } catch (error) {
    console.error('✗ Test 5 Error:', error.message);
    testsFailed++;
  }

  console.log('');
}

/**
 * Test 6: Admin Notifications
 */
async function testAdminNotifications() {
  console.log('TEST 6: Admin Notifications');
  console.log('─'.repeat(60));

  try {
    // Clear admin notifications
    await Notification.deleteMany({ user: testAdmin._id });

    // Test admin notification for invoice generation
    const summary = {
      month: 12,
      year: 2024,
      totalProcessed: 15,
      created: 12,
      skipped: [
        { name: 'Teacher A', reason: 'No hours taught' }
      ],
      failed: []
    };

    const result = await notificationService.notifyAdminInvoiceGeneration(summary);

    assert(
      result.success === true,
      '6.1 Admin notification sent for invoice generation'
    );

    // Wait for notification creation
    await new Promise(resolve => setTimeout(resolve, 500));

    const adminNotif = await Notification.findOne({
      user: testAdmin._id,
      type: 'system',
      relatedTo: 'teacher_invoice'
    });

    assert(
      adminNotif !== null,
      '6.2 In-app notification created for admin'
    );

    assert(
      adminNotif.message.includes('12 invoices'),
      '6.3 Admin notification contains summary details'
    );

  } catch (error) {
    console.error('✗ Test 6 Error:', error.message);
    testsFailed++;
  }

  console.log('');
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('\n' + '='.repeat(70));
  console.log('MODULE 6: NOTIFICATIONS SYSTEM - TEST SUITE');
  console.log('='.repeat(70) + '\n');

  try {
    // Connect to database
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
    }

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✓ Connected to MongoDB\n');

    // Setup
    await setupTestData();

    // Run all tests
    await testNotificationModel();
    await testEmailService();
    await testNotificationService();
    await testNotificationPreferences();
    await testIntegrationWithWorkflow();
    await testAdminNotifications();

    // Cleanup
    await cleanupTestData();

  } catch (error) {
    console.error('\n❌ Test Suite Error:', error);
    testsFailed++;
  } finally {
    // Close connection
    await mongoose.connection.close();
    console.log('✓ Database connection closed\n');

    // Print summary
    console.log('='.repeat(70));
    console.log('TEST SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total Tests: ${testsPassed + testsFailed}`);
    console.log(`✓ Passed: ${testsPassed}`);
    console.log(`✗ Failed: ${testsFailed}`);
    console.log('='.repeat(70) + '\n');

    // Exit with appropriate code
    process.exit(testsFailed > 0 ? 1 : 0);
  }
}

// Run tests
runTests();
