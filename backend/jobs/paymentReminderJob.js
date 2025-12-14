/**
 * Payment Reminder Job
 * 
 * Sends automated reminders to admins about pending teacher payments
 * Runs daily to check for unpaid invoices that are due
 */

const cron = require('node-cron');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const { createNotification } = require('../services/notificationService');

/**
 * Check for overdue payments and send reminders
 */
async function checkOverduePayments() {
  try {
    console.log('[Payment Reminder] Starting overdue payment check...');
    
    const now = new Date();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    
    // Find unpaid invoices that are past due date
    const overdueInvoices = await Invoice.find({
      status: { $in: ['pending', 'overdue', 'partially_paid'] },
      dueDate: { $lt: now },
      $or: [
        { lastReminderSent: { $exists: false } },
        { lastReminderSent: { $lt: threeDaysAgo } }
      ]
    })
    .populate('teacher', 'firstName lastName email teacherInfo.instapayName')
    .sort({ dueDate: 1 })
    .limit(50);
    
    if (overdueInvoices.length === 0) {
      console.log('[Payment Reminder] No overdue invoices found');
      return { overdueCount: 0, remindersSent: 0 };
    }
    
    console.log(`[Payment Reminder] Found ${overdueInvoices.length} overdue invoices`);
    
    // Get all admin users
    const admins = await User.find({ role: 'admin', isActive: true });
    
    if (admins.length === 0) {
      console.log('[Payment Reminder] No active admins found to notify');
      return { overdueCount: overdueInvoices.length, remindersSent: 0 };
    }
    
    let remindersSent = 0;
    
    // Group invoices by severity
    const critical = []; // Over 14 days overdue
    const urgent = [];   // 7-14 days overdue
    const pending = [];  // 1-7 days overdue
    
    overdueInvoices.forEach(invoice => {
      const daysOverdue = Math.floor((now - invoice.dueDate) / (1000 * 60 * 60 * 24));
      
      if (daysOverdue > 14) {
        critical.push({ invoice, daysOverdue });
      } else if (daysOverdue > 7) {
        urgent.push({ invoice, daysOverdue });
      } else {
        pending.push({ invoice, daysOverdue });
      }
    });
    
    // Send notification to all admins
    for (const admin of admins) {
      try {
        // Create detailed message
        let message = '🔔 Payment Reminder Summary\n\n';
        
        if (critical.length > 0) {
          message += `🚨 CRITICAL (>14 days): ${critical.length} invoices\n`;
        }
        if (urgent.length > 0) {
          message += `⚠️ URGENT (7-14 days): ${urgent.length} invoices\n`;
        }
        if (pending.length > 0) {
          message += `📋 PENDING (1-7 days): ${pending.length} invoices\n`;
        }
        
        message += `\nTotal overdue: ${overdueInvoices.length} invoices\n`;
        message += `Total amount due: $${overdueInvoices.reduce((sum, inv) => sum + inv.total, 0).toFixed(2)}`;
        
        // Add top 5 most overdue
        message += '\n\n📌 Most Overdue:\n';
        const topOverdue = [...critical, ...urgent, ...pending].slice(0, 5);
        topOverdue.forEach(({ invoice, daysOverdue }) => {
          message += `- ${invoice.teacher.firstName} ${invoice.teacher.lastName}: $${invoice.total.toFixed(2)} (${daysOverdue} days overdue)\n`;
        });
        
      await createNotification({
        userId: admin._id,
        type: 'payment',
        title: '💰 Overdue Payment Reminder',
        message,
        priority: critical.length > 0 ? 'high' : 'medium',
        metadata: {
          overdueCount: overdueInvoices.length,
          criticalCount: critical.length,
          urgentCount: urgent.length,
          pendingCount: pending.length,
          totalAmount: overdueInvoices.reduce((sum, inv) => sum + inv.total, 0)
        }
      });        remindersSent++;
      } catch (error) {
        console.error(`[Payment Reminder] Failed to notify admin ${admin.email}:`, error);
      }
    }
    
    // Update lastReminderSent timestamp on invoices
    const invoiceIds = overdueInvoices.map(inv => inv._id);
    await Invoice.updateMany(
      { _id: { $in: invoiceIds } },
      { $set: { lastReminderSent: now } }
    );
    
    console.log(`[Payment Reminder] Sent ${remindersSent} reminders to admins`);
    
    return {
      overdueCount: overdueInvoices.length,
      remindersSent,
      critical: critical.length,
      urgent: urgent.length,
      pending: pending.length
    };
    
  } catch (error) {
    console.error('[Payment Reminder] Error:', error);
    throw error;
  }
}

/**
 * Check for upcoming payments (due soon)
 */
async function checkUpcomingPayments() {
  try {
    console.log('[Payment Reminder] Starting upcoming payment check...');
    
    const now = new Date();
    const threeDaysFromNow = new Date(now);
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    
    // Find unpaid invoices due in next 7 days
    const upcomingInvoices = await Invoice.find({
      status: 'pending',
      dueDate: { 
        $gte: now,
        $lte: sevenDaysFromNow 
      },
      upcomingReminderSent: { $ne: true } // Only send once
    })
    .populate('teacher', 'firstName lastName email teacherInfo.instapayName')
    .sort({ dueDate: 1 });
    
    if (upcomingInvoices.length === 0) {
      console.log('[Payment Reminder] No upcoming payments in next 7 days');
      return { upcomingCount: 0, remindersSent: 0 };
    }
    
    console.log(`[Payment Reminder] Found ${upcomingInvoices.length} upcoming payments`);
    
    // Get all admin users
    const admins = await User.find({ role: 'admin', isActive: true });
    
    if (admins.length === 0) {
      console.log('[Payment Reminder] No active admins found to notify');
      return { upcomingCount: upcomingInvoices.length, remindersSent: 0 };
    }
    
    let remindersSent = 0;
    
    // Group by due date proximity
    const dueSoon = upcomingInvoices.filter(inv => inv.dueDate <= threeDaysFromNow);
    const dueLater = upcomingInvoices.filter(inv => inv.dueDate > threeDaysFromNow);
    
    // Send notification to all admins
    for (const admin of admins) {
      try {
        let message = '📅 Upcoming Payments Alert\n\n';
        
        if (dueSoon.length > 0) {
          message += `⚡ Due in 1-3 days: ${dueSoon.length} invoices\n`;
        }
        if (dueLater.length > 0) {
          message += `📋 Due in 4-7 days: ${dueLater.length} invoices\n`;
        }
        
        message += `\nTotal upcoming: ${upcomingInvoices.length} invoices\n`;
        message += `Total amount: $${upcomingInvoices.reduce((sum, inv) => sum + inv.total, 0).toFixed(2)}`;
        
        // Add details of imminent payments
        if (dueSoon.length > 0) {
          message += '\n\n⚡ Imminent Payments:\n';
          dueSoon.slice(0, 5).forEach(invoice => {
            const daysUntil = Math.ceil((invoice.dueDate - now) / (1000 * 60 * 60 * 24));
            message += `- ${invoice.teacher.firstName} ${invoice.teacher.lastName}: $${invoice.total.toFixed(2)} (due in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'})\n`;
          });
        }
        
      await createNotification({
        userId: admin._id,
        type: 'payment',
        title: '📅 Upcoming Payment Alert',
        message,
        priority: dueSoon.length > 0 ? 'medium' : 'low',
        metadata: {
          upcomingCount: upcomingInvoices.length,
          dueSoonCount: dueSoon.length,
          dueLaterCount: dueLater.length,
          totalAmount: upcomingInvoices.reduce((sum, inv) => sum + inv.total, 0)
        }
      });        remindersSent++;
      } catch (error) {
        console.error(`[Payment Reminder] Failed to notify admin ${admin.email}:`, error);
      }
    }
    
    // Mark invoices as notified
    const invoiceIds = upcomingInvoices.map(inv => inv._id);
    await Invoice.updateMany(
      { _id: { $in: invoiceIds } },
      { $set: { upcomingReminderSent: true } }
    );
    
    console.log(`[Payment Reminder] Sent ${remindersSent} upcoming payment notifications`);
    
    return {
      upcomingCount: upcomingInvoices.length,
      remindersSent,
      dueSoon: dueSoon.length,
      dueLater: dueLater.length
    };
    
  } catch (error) {
    console.error('[Payment Reminder] Error:', error);
    throw error;
  }
}

/**
 * Main payment reminder job
 * Runs both overdue and upcoming checks
 */
async function runPaymentReminderJob() {
  console.log('\n' + '='.repeat(70));
  console.log('PAYMENT REMINDER JOB - Starting');
  console.log(new Date().toISOString());
  console.log('='.repeat(70));
  
  try {
    // Check overdue payments
    const overdueResults = await checkOverduePayments();
    
    // Check upcoming payments
    const upcomingResults = await checkUpcomingPayments();
    
    console.log('\n' + '='.repeat(70));
    console.log('PAYMENT REMINDER JOB - Complete');
    console.log(`Overdue: ${overdueResults.overdueCount} invoices, ${overdueResults.remindersSent} reminders sent`);
    console.log(`Upcoming: ${upcomingResults.upcomingCount} invoices, ${upcomingResults.remindersSent} notifications sent`);
    console.log('='.repeat(70) + '\n');
    
    return {
      overdue: overdueResults,
      upcoming: upcomingResults,
      success: true
    };
    
  } catch (error) {
    console.error('[Payment Reminder Job] Failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Schedule payment reminder job
 * Runs daily at 9:00 AM
 */
function schedulePaymentReminders() {
  // Run every day at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    await runPaymentReminderJob();
  }, {
    scheduled: true,
    timezone: "Africa/Cairo" // Adjust timezone as needed
  });
  
  console.log('✅ Payment reminder job scheduled (daily at 9:00 AM)');
}

module.exports = {
  checkOverduePayments,
  checkUpcomingPayments,
  runPaymentReminderJob,
  schedulePaymentReminders
};
