/**
 * Test Teacher Invoice Generation
 * 
 * This script tests the teacher invoice generation workflow:
 * - Generates invoices for a specific month
 * - Tests publish workflow
 * - Tests payment recording
 * - Validates calculations
 * 
 * Usage: node scripts/testTeacherInvoiceGeneration.js [month] [year]
 */

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
require('dotenv').config();

dayjs.extend(utc);

const TeacherSalaryService = require('../services/teacherSalaryService');
const TeacherInvoice = require('../models/TeacherInvoice');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
const SalarySettings = require('../models/SalarySettings');
const User = require('../models/User');
const Class = require('../models/Class');

/**
 * Get test parameters from command line or use defaults
 */
function getTestParameters() {
  const args = process.argv.slice(2);
  
  let month, year;
  
  if (args.length >= 2) {
    month = parseInt(args[0], 10);
    year = parseInt(args[1], 10);
  } else {
    // Default to last month
    const lastMonth = dayjs.utc().subtract(1, 'month');
    month = lastMonth.month() + 1;
    year = lastMonth.year();
  }

  if (isNaN(month) || month < 1 || month > 12) {
    console.error('❌ Invalid month. Must be 1-12.');
    process.exit(1);
  }

  if (isNaN(year) || year < 2020 || year > 2100) {
    console.error('❌ Invalid year. Must be between 2020 and 2100.');
    process.exit(1);
  }

  return { month, year };
}

/**
 * Validate prerequisites for invoice generation
 */
async function validatePrerequisites(month, year) {
  console.log('\n🔍 Validating prerequisites...');

  const issues = [];

  // Check exchange rate exists
  const exchangeRate = await MonthlyExchangeRates.getRateForMonth(month, year);
  if (!exchangeRate) {
    issues.push(`Exchange rate not set for ${dayjs.utc().month(month - 1).format('MMMM')} ${year}`);
  } else {
    console.log(`   ✅ Exchange rate: ${exchangeRate.rateEGPperUSD} EGP/USD`);
  }

  // Check salary settings exist
  const settings = await SalarySettings.getGlobalSettings();
  if (!settings) {
    issues.push('Salary settings not found');
  } else {
    const activePartitions = settings.ratePartitions.filter(p => p.isActive);
    console.log(`   ✅ Salary settings: ${activePartitions.length} active rate partitions`);
  }

  // Check if there are active teachers with classes
  // Count teachers who are active; some records use top-level `isActive`,
  // others use nested `teacherInfo.isActive`. Accept either for this test.
  const teacherCount = await User.countDocuments({ 
    role: 'teacher',
    $or: [ { isActive: true }, { 'teacherInfo.isActive': true } ]
  });
  console.log(`   ℹ️  Active teachers: ${teacherCount}`);

  if (teacherCount === 0) {
    issues.push('No active teachers found in system');
  }

  // Check if there are classes in the target month
  const startOfMonth = dayjs.utc().year(year).month(month - 1).startOf('month').toDate();
  const endOfMonth = dayjs.utc().year(year).month(month - 1).endOf('month').toDate();

  // Use `scheduledDate` (the Class model field) and include modern countable statuses
  const classCount = await Class.countDocuments({
    scheduledDate: { $gte: startOfMonth, $lte: endOfMonth },
    status: { $in: ['attended', 'missed_by_student', 'absent'] }
  });
  console.log(`   ℹ️  Attended/absent classes: ${classCount}`);

  if (classCount === 0) {
    console.log('   ⚠️  Warning: No attended/absent classes found in target month');
  }

  if (issues.length > 0) {
    console.log('\n❌ Prerequisites check failed:');
    issues.forEach(issue => console.log(`   - ${issue}`));
    return false;
  }

  console.log('✅ All prerequisites satisfied\n');
  return true;
}

/**
 * Test invoice generation for specific month
 */
async function testInvoiceGeneration(month, year) {
  const monthName = dayjs.utc().month(month - 1).format('MMMM');
  console.log(`\n📝 Generating invoices for ${monthName} ${year}...`);

  try {
    // Use a real admin user if available for audit entries; otherwise run as system (null)
    const adminUser = await User.findOne({ role: 'admin', $or: [ { isActive: true }, { 'teacherInfo.isActive': true } ] }).select('_id');
    const runAsUserId = adminUser ? adminUser._id : null;

    const result = await TeacherSalaryService.generateMonthlyInvoices(month, year, {
      userId: runAsUserId,
      dryRun: false
    });

    // Service returns { invoices, skipped, adjusted, errors, summary }
    const created = result.invoices || [];
    const errors = result.errors || [];
    const skipped = result.skipped || [];
    const adjusted = result.adjusted || [];
    const summary = result.summary || {};

    console.log('\n✅ Invoice generation completed:');
    console.log(`   - Created: ${summary.created || created.length || 0}`);
    console.log(`   - Adjusted: ${summary.adjusted || adjusted.length || 0}`);
    console.log(`   - Skipped: ${summary.skipped || skipped.length || 0}`);
    console.log(`   - Failed: ${summary.failed || errors.length || 0}`);

    if (created.length > 0) {
      console.log('\n📋 Created invoices:');
      for (const inv of created) {
        // inv may be a Mongoose doc (created invoice) or a dry-run object
        const invoiceNumber = inv.invoiceNumber || inv._id || '(no-number)';
        const teacherName = inv.teacherName || (inv.teacher && `${inv.teacher.firstName || ''} ${inv.teacher.lastName || ''}`) || 'Unknown';
        const totalHours = typeof inv.totalHours === 'number' ? inv.totalHours : (inv.totalHours ? Number(inv.totalHours) : 0);
        const rate = (inv.rateSnapshot && inv.rateSnapshot.rate) || (inv.rate || 'N/A');
        const totalUSD = inv.totalAmountUSD || inv.grossAmountUSD || inv.totalUSD || 0;
        const totalEGP = inv.totalAmountEGP || inv.totalEGP || 0;
        const classCount = Array.isArray(inv.classIds) ? inv.classIds.length : (inv.classIds ? (inv.classIds.length || 0) : 0);

        console.log(`   - ${invoiceNumber}: ${teacherName}`);
        console.log(`     • Hours: ${totalHours.toFixed ? totalHours.toFixed(2) : totalHours}`);
        console.log(`     • Rate: $${rate}/hour`);
        console.log(`     • Amount: $${Number(totalUSD).toFixed(2)} / ${Number(totalEGP).toFixed(2)} EGP`);
        console.log(`     • Classes: ${classCount}`);
      }
    }

    if (errors.length > 0) {
      console.log('\n❌ Failed invoices:');
      errors.forEach(failure => {
        console.log(`   - ${failure.teacherId || failure.teacher}: ${failure.error || failure.message || JSON.stringify(failure)}`);
      });
    }

    return result;
  } catch (error) {
    console.error('\n❌ Invoice generation failed:', error.message);
    throw error;
  }
}

/**
 * Test invoice publish workflow
 */
async function testPublishWorkflow() {
  console.log('\n🔄 Testing publish workflow...');

  try {
    // Find a draft invoice
    const draftInvoice = await TeacherInvoice.findOne({ status: 'draft' })
      .populate('teacher', 'firstName lastName');

    if (!draftInvoice) {
      console.log('   ℹ️  No draft invoices found to test publish workflow');
      return;
    }

    console.log(`   - Testing with invoice: ${draftInvoice.invoiceNumber}`);
    console.log(`   - Teacher: ${draftInvoice.teacher.firstName} ${draftInvoice.teacher.lastName}`);

    // Publish the invoice
    const published = await TeacherSalaryService.publishInvoice(
      draftInvoice._id.toString(),
      'test-script'
    );

    console.log('   ✅ Invoice published successfully');
    console.log(`      • Status: ${published.status}`);
    console.log(`      • Published at: ${published.publishedAt.toISOString()}`);
    console.log(`      • Share token: ${published.shareToken}`);
    console.log(`      • Snapshots frozen: Rate, Exchange, Transfer Fee`);

    return published;
  } catch (error) {
    console.error('   ❌ Publish workflow failed:', error.message);
    throw error;
  }
}

/**
 * Test payment recording workflow
 */
async function testPaymentWorkflow() {
  console.log('\n💰 Testing payment workflow...');

  try {
    // Find a published invoice
    const publishedInvoice = await TeacherInvoice.findOne({ status: 'published' })
      .populate('teacher', 'firstName lastName');

    if (!publishedInvoice) {
      console.log('   ℹ️  No published invoices found to test payment workflow');
      return;
    }

    console.log(`   - Testing with invoice: ${publishedInvoice.invoiceNumber}`);
    console.log(`   - Teacher: ${publishedInvoice.teacher.firstName} ${publishedInvoice.teacher.lastName}`);

    // Record payment
    const paid = await TeacherSalaryService.markInvoiceAsPaid(
      publishedInvoice._id.toString(),
      {
        paidAmount: publishedInvoice.totalAmountEGP,
        paidCurrency: 'EGP',
        paymentMethod: 'bank_transfer',
        transactionId: `TEST-${Date.now()}`,
        notes: 'Test payment from initialization script'
      },
      'test-script'
    );

    console.log('   ✅ Payment recorded successfully');
    console.log(`      • Status: ${paid.status}`);
    console.log(`      • Paid at: ${paid.paidAt.toISOString()}`);
    console.log(`      • Paid amount: ${paid.paidAmount} ${paid.paidCurrency}`);
    console.log(`      • YTD hours updated: ${paid.teacher.teacherInfo.totalHoursYTD}`);
    console.log(`      • YTD earnings updated: ${paid.teacher.teacherInfo.totalEarningsYTD}`);

    return paid;
  } catch (error) {
    console.error('   ❌ Payment workflow failed:', error.message);
    throw error;
  }
}

/**
 * Display statistics for generated invoices
 */
async function displayStatistics(month, year) {
  console.log('\n📊 Invoice Statistics:');

  try {
    const invoices = await TeacherInvoice.getInvoicesForMonth(month, year);

    if (invoices.length === 0) {
      console.log('   No invoices found for this month');
      return;
    }

    const stats = {
      total: invoices.length,
      byStatus: {},
      totalHours: 0,
      totalUSD: 0,
      totalEGP: 0,
      byPartition: {}
    };

    invoices.forEach(invoice => {
      // Count by status
      stats.byStatus[invoice.status] = (stats.byStatus[invoice.status] || 0) + 1;

      // Sum totals
      stats.totalHours += invoice.totalHours;
      stats.totalUSD += invoice.totalAmountUSD;
      stats.totalEGP += invoice.totalAmountEGP;

      // Count by partition
      if (invoice.rateSnapshot) {
        const partition = invoice.rateSnapshot.partition;
        stats.byPartition[partition] = (stats.byPartition[partition] || 0) + 1;
      }
    });

    console.log(`   - Total invoices: ${stats.total}`);
    console.log(`   - By status:`);
    Object.entries(stats.byStatus).forEach(([status, count]) => {
      console.log(`      • ${status}: ${count}`);
    });
    console.log(`   - Total hours: ${stats.totalHours.toFixed(2)}`);
    console.log(`   - Total amount: $${stats.totalUSD.toFixed(2)} / ${stats.totalEGP.toFixed(2)} EGP`);
    console.log(`   - By rate partition:`);
    Object.entries(stats.byPartition).forEach(([partition, count]) => {
      console.log(`      • ${partition}: ${count} teachers`);
    });
  } catch (error) {
    console.error('   ❌ Error calculating statistics:', error.message);
  }
}

/**
 * Main test function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   Teacher Invoice Generation Test                        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  const { month, year } = getTestParameters();
  const monthName = dayjs.utc().month(month - 1).format('MMMM');

  console.log(`\nTarget: ${monthName} ${year}`);

  try {
    // Connect to MongoDB
    console.log('\n🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Validate prerequisites
    const isValid = await validatePrerequisites(month, year);
    if (!isValid) {
      console.log('\n⚠️  Please resolve issues before generating invoices.');
      process.exit(1);
    }

    // Test invoice generation
    const result = await testInvoiceGeneration(month, year);

    if (result.successful.length > 0) {
      // Test publish workflow
      await testPublishWorkflow();

      // Test payment workflow
      await testPaymentWorkflow();
    }

    // Display statistics
    await displayStatistics(month, year);

    console.log('\n✅ All tests completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  main();
}

module.exports = { testInvoiceGeneration };
