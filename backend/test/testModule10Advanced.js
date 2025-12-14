/**
 * Module 10: Advanced Features - Comprehensive Test Suite
 * 
 * Tests payment reminders, invoice templates, and advanced functionality
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Invoice = require('../models/Invoice');
const InvoiceTemplate = require('../models/InvoiceTemplate');
const User = require('../models/User');
const { checkOverduePayments, checkUpcomingPayments, runPaymentReminderJob } = require('../jobs/paymentReminderJob');
const TemplateService = require('../services/templateService');

// Test configuration
const TEST_DB = process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/waraqa-test-module10';

// Test user IDs
let adminUserId;
let teacherUserId;
let guardianUserId;

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
 * Helper functions for assertions
 */
function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`Assertion failed: ${message}\nExpected truthy value, got: ${value}`);
  }
}

function assertGreaterThan(value, threshold, message = '') {
  if (value <= threshold) {
    throw new Error(`Assertion failed: ${message}\nExpected ${value} to be greater than ${threshold}`);
  }
}

/**
 * Setup: Connect to test database and create test data
 */
async function setup() {
  console.log('\n📦 Setting up test environment...');
  
  try {
    await mongoose.connect(TEST_DB, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to test database');
    
    // Clear test data
    await Invoice.deleteMany({});
    await InvoiceTemplate.deleteMany({});
    await User.deleteMany({ email: /test-module10/ });
    console.log('✅ Cleared test data');
    
    // Create test users
    const adminUser = new User({
      email: 'test-module10-admin@test.com',
      password: 'hashedpassword123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      isActive: true
    });
    await adminUser.save();
    adminUserId = adminUser._id;
    console.log('✅ Created test admin user:', adminUserId);
    
    const teacherUser = new User({
      email: 'test-module10-teacher@test.com',
      password: 'hashedpassword123',
      firstName: 'Teacher',
      lastName: 'User',
      role: 'teacher',
      isActive: true,
      teacherInfo: {
        subjects: ['Math'],
        hourlyRate: 50,
        instapayName: 'teacher_test'
      }
    });
    await teacherUser.save();
    teacherUserId = teacherUser._id;
    console.log('✅ Created test teacher user:', teacherUserId);
    
    const guardianUser = new User({
      email: 'test-module10-guardian@test.com',
      password: 'hashedpassword123',
      firstName: 'Guardian',
      lastName: 'User',
      role: 'guardian',
      isActive: true
    });
    await guardianUser.save();
    guardianUserId = guardianUser._id;
    console.log('✅ Created test guardian user:', guardianUserId);
    
    console.log('✅ Setup complete\n');
  } catch (error) {
    console.error('❌ Setup failed:', error);
    throw error;
  }
}

/**
 * Teardown: Cleanup
 */
async function teardown() {
  console.log('\n🧹 Cleaning up...');
  
  try {
    await Invoice.deleteMany({});
    await InvoiceTemplate.deleteMany({});
    await User.deleteMany({ email: /test-module10/ });
    await mongoose.disconnect();
    console.log('✅ Disconnected from test database');
  } catch (error) {
    console.error('❌ Teardown failed:', error);
    throw error;
  }
}

/**
 * Test 1: Check overdue payments with no invoices
 */
async function test1_checkOverdueNoInvoices() {
  const results = await checkOverduePayments();
  
  assertEqual(results.overdueCount, 0, 'Should have 0 overdue invoices');
  assertEqual(results.remindersSent, 0, 'Should send 0 reminders');
  
  console.log('✓ Overdue check handles empty state correctly');
}

/**
 * Test 2: Check overdue payments with overdue invoices
 */
async function test2_checkOverdueWithInvoices() {
  // Create overdue invoice
  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - 10); // 10 days overdue
  
  const fourDaysAgo = new Date();
  fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
  
  const invoice = await Invoice.create({
    invoiceNumber: 'TEST-001',
    type: 'teacher_payment',
    teacher: teacherUserId,
    billingPeriod: {
      startDate: new Date(2025, 0, 1),
      endDate: new Date(2025, 0, 31),
      month: 1,
      year: 2025
    },
    subtotal: 500,
    total: 500,
    status: 'pending',
    dueDate: overdueDate,
    lastReminderSent: fourDaysAgo,
    items: []
  });
  
  const results = await checkOverduePayments();
  
  assertGreaterThan(results.overdueCount, 0, 'Should have overdue invoices');
  assertEqual(results.remindersSent, 1, 'Should send reminder to admin');
  
  console.log(`✓ Found ${results.overdueCount} overdue invoices, sent ${results.remindersSent} reminders`);
}

/**
 * Test 3: Check upcoming payments
 */
async function test3_checkUpcomingPayments() {
  // Clear previous invoices
  await Invoice.deleteMany({});
  
  // Create invoice due in 2 days
  const twoDaysFromNow = new Date();
  twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
  
  await Invoice.create({
    invoiceNumber: 'TEST-002',
    type: 'teacher_payment',
    teacher: teacherUserId,
    billingPeriod: {
      startDate: new Date(2025, 0, 1),
      endDate: new Date(2025, 0, 31),
      month: 1,
      year: 2025
    },
    subtotal: 300,
    total: 300,
    status: 'pending',
    dueDate: twoDaysFromNow,
    items: []
  });
  
  const results = await checkUpcomingPayments();
  
  assertGreaterThan(results.upcomingCount, 0, 'Should have upcoming payments');
  assertEqual(results.remindersSent, 1, 'Should send notification to admin');
  
  console.log(`✓ Found ${results.upcomingCount} upcoming payments, sent ${results.remindersSent} notifications`);
}

/**
 * Test 4: Run complete payment reminder job
 */
async function test4_runPaymentReminderJob() {
  // Clear and create test data
  await Invoice.deleteMany({});
  
  // Create overdue invoice
  const overdueDate = new Date();
  overdueDate.setDate(overdueDate.getDate() - 5);
  
  await Invoice.create({
    invoiceNumber: 'TEST-003',
    type: 'teacher_payment',
    teacher: teacherUserId,
    billingPeriod: {
      startDate: new Date(2025, 0, 1),
      endDate: new Date(2025, 0, 31),
      month: 1,
      year: 2025
    },
    subtotal: 400,
    total: 400,
    status: 'pending',
    dueDate: overdueDate,
    lastReminderSent: new Date(2020, 0, 1), // Very old date
    items: []
  });
  
  const results = await runPaymentReminderJob();
  
  assertTrue(results.success, 'Job should complete successfully');
  assertTrue(results.overdue, 'Should have overdue results');
  assertTrue(results.upcoming, 'Should have upcoming results');
  
  console.log('✓ Payment reminder job executed successfully');
}

/**
 * Test 5: Create default invoice template
 */
async function test5_createDefaultTemplate() {
  const template = await TemplateService.ensureDefaultTemplate();
  
  assertTrue(template, 'Template should be created');
  assertEqual(template.isDefault, true, 'Should be default template');
  assertEqual(template.isActive, true, 'Should be active');
  assertTrue(template.name, 'Should have a name');
  
  console.log(`✓ Created default template: ${template.name}`);
}

/**
 * Test 6: Create custom template
 */
async function test6_createCustomTemplate() {
  const templateData = {
    name: 'Test Custom Template',
    description: 'A test template',
    isDefault: false,
    templateType: 'teacher_payment',
    branding: {
      companyName: 'Test Company'
    },
    colors: {
      primary: '#ff0000'
    }
  };
  
  const template = await TemplateService.createTemplate(templateData, adminUserId);
  
  assertTrue(template, 'Template should be created');
  assertEqual(template.name, 'Test Custom Template', 'Name should match');
  assertEqual(template.templateType, 'teacher_payment', 'Type should match');
  assertEqual(template.colors.primary, '#ff0000', 'Color should match');
  
  console.log('✓ Created custom template successfully');
}

/**
 * Test 7: Update template
 */
async function test7_updateTemplate() {
  // Get existing template
  const templates = await TemplateService.listTemplates();
  assertTrue(templates.length > 0, 'Should have templates');
  
  const template = templates[0];
  const updates = {
    description: 'Updated description',
    colors: {
      ...template.colors,
      primary: '#00ff00'
    }
  };
  
  const updated = await TemplateService.updateTemplate(template._id.toString(), updates, adminUserId);
  
  assertEqual(updated.description, 'Updated description', 'Description should be updated');
  assertEqual(updated.colors.primary, '#00ff00', 'Color should be updated');
  
  console.log('✓ Updated template successfully');
}

/**
 * Test 8: Set template as default
 */
async function test8_setDefaultTemplate() {
  // Create non-default template
  const template = await TemplateService.createTemplate({
    name: 'New Default Template',
    isDefault: false,
    templateType: 'both'
  }, adminUserId);
  
  // Set as default
  const updated = await TemplateService.setDefaultTemplate(template._id.toString());
  
  assertEqual(updated.isDefault, true, 'Should be set as default');
  
  // Verify only one default
  const defaults = await InvoiceTemplate.find({ isDefault: true, isActive: true });
  assertEqual(defaults.length, 1, 'Should have only one default template');
  
  console.log('✓ Set template as default successfully');
}

/**
 * Test 9: List templates with filters
 */
async function test9_listTemplates() {
  const allTemplates = await TemplateService.listTemplates();
  assertTrue(allTemplates.length > 0, 'Should have templates');
  
  const teacherTemplates = await TemplateService.listTemplates({ templateType: 'teacher_payment' });
  assertTrue(teacherTemplates.every(t => t.templateType === 'teacher_payment' || t.templateType === 'both'), 
    'Should filter by type');
  
  console.log(`✓ Listed ${allTemplates.length} total templates, ${teacherTemplates.length} teacher templates`);
}

/**
 * Test 10: Delete template
 */
async function test10_deleteTemplate() {
  // Create template to delete
  const template = await TemplateService.createTemplate({
    name: 'Template to Delete',
    isDefault: false,
    templateType: 'guardian_invoice'
  }, adminUserId);
  
  const deleted = await TemplateService.deleteTemplate(template._id.toString());
  
  assertEqual(deleted.isActive, false, 'Should be marked as inactive');
  
  // Verify it's not in active list
  const activeTemplates = await TemplateService.listTemplates({ isActive: true });
  const found = activeTemplates.find(t => t._id.toString() === template._id.toString());
  assertEqual(found, undefined, 'Should not appear in active list');
  
  console.log('✓ Deleted template successfully');
}

/**
 * Test 11: Cannot delete default template
 */
async function test11_cannotDeleteDefault() {
  const defaultTemplate = await InvoiceTemplate.findOne({ isDefault: true, isActive: true });
  assertTrue(defaultTemplate, 'Should have default template');
  
  let errorThrown = false;
  try {
    await TemplateService.deleteTemplate(defaultTemplate._id.toString());
  } catch (error) {
    errorThrown = true;
    assertTrue(error.message.includes('default'), 'Error should mention default template');
  }
  
  assertTrue(errorThrown, 'Should throw error when deleting default');
  
  console.log('✓ Correctly prevented deletion of default template');
}

/**
 * Test 12: Template usage tracking
 */
async function test12_templateUsageTracking() {
  const template = await InvoiceTemplate.findOne({ isActive: true });
  assertTrue(template, 'Should have active template');
  
  const initialUsage = template.usageCount || 0;
  
  // Record usage
  await template.recordUsage();
  
  // Reload and check
  const updated = await InvoiceTemplate.findById(template._id);
  assertEqual(updated.usageCount, initialUsage + 1, 'Usage count should increment');
  assertTrue(updated.lastUsed, 'Last used should be set');
  
  console.log(`✓ Usage tracking works: ${initialUsage} -> ${updated.usageCount}`);
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('\n' + '='.repeat(70));
  console.log('MODULE 10: ADVANCED FEATURES - COMPREHENSIVE TEST SUITE');
  console.log('='.repeat(70));
  
  try {
    await setup();
    
    // Run all tests
    await runTest('Check overdue payments with no invoices', test1_checkOverdueNoInvoices);
    await runTest('Check overdue payments with overdue invoices', test2_checkOverdueWithInvoices);
    await runTest('Check upcoming payments', test3_checkUpcomingPayments);
    await runTest('Run complete payment reminder job', test4_runPaymentReminderJob);
    await runTest('Create default invoice template', test5_createDefaultTemplate);
    await runTest('Create custom template', test6_createCustomTemplate);
    await runTest('Update template', test7_updateTemplate);
    await runTest('Set template as default', test8_setDefaultTemplate);
    await runTest('List templates with filters', test9_listTemplates);
    await runTest('Delete template', test10_deleteTemplate);
    await runTest('Cannot delete default template', test11_cannotDeleteDefault);
    await runTest('Template usage tracking', test12_templateUsageTracking);
    
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
    
    process.exit(testsFailed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error('\n❌ Test suite failed with error:', error);
    await teardown();
    process.exit(1);
  }
}

// Run tests
runAllTests();
