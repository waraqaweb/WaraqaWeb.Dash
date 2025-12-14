const nodemailer = require('nodemailer');
const dateHelpers = require('../utils/dateHelpers');
require('dotenv').config();

// Simple email service wrapper using nodemailer and SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

async function sendMail({ to, subject, html, text }) {
  const from = process.env.EMAIL_FROM || 'no-reply@waraqa.local';
  const info = await transporter.sendMail({ from, to, subject, html, text });
  return info;
}

/**
 * Teacher Salary Email Templates
 */

/**
 * Send invoice published notification to teacher
 */
async function sendInvoicePublished(teacher, invoice) {
  try {
    const subject = `Your Invoice #${invoice.invoiceNumber} is Ready`;
    const html = generateInvoicePublishedHTML(teacher, invoice);
    
    await sendMail({ to: teacher.email, subject, html });
    console.log(`[EmailService] Invoice published email sent to ${teacher.email}`);
    return { sent: true };
  } catch (error) {
    console.error('[EmailService] Failed to send invoice published email:', error.message);
    return { sent: false, error: error.message };
  }
}

/**
 * Send payment received notification to teacher
 */
async function sendPaymentReceived(teacher, invoice) {
  try {
    const subject = `Payment Received - Invoice #${invoice.invoiceNumber}`;
    const html = generatePaymentReceivedHTML(teacher, invoice);
    
    await sendMail({ to: teacher.email, subject, html });
    console.log(`[EmailService] Payment received email sent to ${teacher.email}`);
    return { sent: true };
  } catch (error) {
    console.error('[EmailService] Failed to send payment received email:', error.message);
    return { sent: false, error: error.message };
  }
}

/**
 * Send bonus added notification to teacher
 */
async function sendBonusAdded(teacher, invoice, bonus) {
  try {
    const subject = `Bonus Added to Invoice #${invoice.invoiceNumber} 🎉`;
    const html = generateBonusAddedHTML(teacher, invoice, bonus);
    
    await sendMail({ to: teacher.email, subject, html });
    console.log(`[EmailService] Bonus added email sent to ${teacher.email}`);
    return { sent: true };
  } catch (error) {
    console.error('[EmailService] Failed to send bonus added email:', error.message);
    return { sent: false, error: error.message };
  }
}

/**
 * Send admin notification for monthly invoice generation summary
 */
async function sendAdminInvoiceGenerationSummary(admin, summary) {
  try {
    const subject = `Monthly Teacher Invoices Generated - ${summary.month}/${summary.year}`;
    const html = generateAdminSummaryHTML(admin, summary);
    
    await sendMail({ to: admin.email, subject, html });
    console.log(`[EmailService] Admin summary email sent to ${admin.email}`);
    return { sent: true };
  } catch (error) {
    console.error('[EmailService] Failed to send admin summary email:', error.message);
    return { sent: false, error: error.message };
  }
}

/**
 * HTML Template Generators
 */

function generateInvoicePublishedHTML(teacher, invoice) {
  const formatDate = (date) => {
    return dateHelpers.formatDateDDMMMYYYY ? 
      dateHelpers.formatDateDDMMMYYYY(date) : 
      new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const periodDate = new Date(invoice.year, invoice.month - 1);
  
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .invoice-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-label { font-weight: bold; color: #6b7280; }
    .detail-value { color: #111827; font-weight: 600; }
    .total-row { background: #f3f4f6; padding: 15px; margin-top: 10px; border-radius: 5px; }
    .total-amount { font-size: 24px; color: #10b981; font-weight: bold; }
    .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 6px; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✨ New Invoice Published</h1>
      <p>Your monthly salary invoice is now available</p>
    </div>
    <div class="content">
      <p>Hi ${teacher.firstName},</p>
      <p>Great news! Your salary invoice for <strong>${formatDate(periodDate)}</strong> has been published and is now available for your review.</p>
      
      <div class="invoice-details">
        <h3>Invoice Summary</h3>
        <div class="detail-row">
          <span class="detail-label">Invoice Number:</span>
          <span class="detail-value">#${invoice.invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Period:</span>
          <span class="detail-value">${formatDate(periodDate)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Hours Taught:</span>
          <span class="detail-value">${invoice.totalHours?.toFixed(2) || '0.00'} hours</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Hourly Rate:</span>
          <span class="detail-value">$${invoice.rateSnapshot?.rate?.toFixed(2) || '0.00'}/hour</span>
        </div>
        ${invoice.bonusesUSD > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Bonuses:</span>
          <span class="detail-value" style="color: #10b981;">+$${invoice.bonusesUSD.toFixed(2)}</span>
        </div>
        ` : ''}
        ${invoice.extrasUSD > 0 ? `
        <div class="detail-row">
          <span class="detail-label">Extras:</span>
          <span class="detail-value" style="color: #3b82f6;">+$${invoice.extrasUSD.toFixed(2)}</span>
        </div>
        ` : ''}
        <div class="total-row">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 18px; font-weight: bold;">Total Amount:</span>
            <span class="total-amount">${invoice.netAmountEGP?.toFixed(2) || '0.00'} EGP</span>
          </div>
        </div>
      </div>

      <p><strong>What's Next?</strong></p>
      <ul>
        <li>Review your invoice details in the dashboard</li>
        <li>Download a PDF copy for your records</li>
        <li>Payment will be processed shortly</li>
      </ul>

      <center>
        <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/teacher/salary" class="button">View Invoice</a>
      </center>

      <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
        If you have any questions about this invoice, please contact your administrator.
      </p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Waraqa. All rights reserved.</p>
      <p style="font-size: 12px; color: #9ca3af;">This is an automated notification. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
  `;
}

function generatePaymentReceivedHTML(teacher, invoice) {
  const formatDate = (date) => {
    return dateHelpers.formatDateDDMMMYYYY ? 
      dateHelpers.formatDateDDMMMYYYY(date) : 
      new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const periodDate = new Date(invoice.year, invoice.month - 1);
  
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .success-badge { background: #d1fae5; color: #065f46; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0; font-weight: bold; }
    .payment-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10b981; }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-label { font-weight: bold; color: #6b7280; }
    .detail-value { color: #111827; font-weight: 600; }
    .amount-paid { font-size: 28px; color: #10b981; font-weight: bold; text-align: center; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💰 Payment Received!</h1>
      <p>Your payment has been successfully processed</p>
    </div>
    <div class="content">
      <div class="success-badge">
        ✓ Payment Confirmed
      </div>

      <p>Hi ${teacher.firstName},</p>
      <p>Excellent news! The payment for invoice <strong>#${invoice.invoiceNumber}</strong> has been successfully processed and should arrive in your account shortly.</p>
      
      <div class="amount-paid">
        ${invoice.netAmountEGP?.toFixed(2) || '0.00'} EGP
      </div>

      <div class="payment-details">
        <h3>Payment Details</h3>
        <div class="detail-row">
          <span class="detail-label">Invoice Number:</span>
          <span class="detail-value">#${invoice.invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Period:</span>
          <span class="detail-value">${formatDate(periodDate)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Payment Date:</span>
          <span class="detail-value">${formatDate(invoice.paidAt || new Date())}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Payment Method:</span>
          <span class="detail-value">${invoice.paymentInfo?.paymentMethod || 'Bank Transfer'}</span>
        </div>
        ${invoice.paymentInfo?.transactionId ? `
        <div class="detail-row">
          <span class="detail-label">Transaction ID:</span>
          <span class="detail-value">${invoice.paymentInfo.transactionId}</span>
        </div>
        ` : ''}
      </div>

      <p><strong>Transaction Summary:</strong></p>
      <ul>
        <li>Hours Taught: ${invoice.totalHours?.toFixed(2)} hours</li>
        <li>Base Salary: $${invoice.grossAmountUSD?.toFixed(2)} USD</li>
        ${invoice.bonusesUSD > 0 ? `<li>Bonuses: $${invoice.bonusesUSD.toFixed(2)} USD</li>` : ''}
        ${invoice.extrasUSD > 0 ? `<li>Extras: $${invoice.extrasUSD.toFixed(2)} USD</li>` : ''}
        <li><strong>Total Paid: ${invoice.netAmountEGP?.toFixed(2)} EGP</strong></li>
      </ul>

      <p style="margin-top: 30px; background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b;">
        <strong>📌 Note:</strong> Depending on your bank, it may take 1-3 business days for the funds to appear in your account.
      </p>

      <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
        Thank you for your dedication and hard work! If you have any questions about this payment, please contact your administrator.
      </p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Waraqa. All rights reserved.</p>
      <p style="font-size: 12px; color: #9ca3af;">This is an automated notification. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
  `;
}

function generateBonusAddedHTML(teacher, invoice, bonus) {
  const formatDate = (date) => {
    return dateHelpers.formatDateDDMMMYYYY ? 
      dateHelpers.formatDateDDMMMYYYY(date) : 
      new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const periodDate = new Date(invoice.year, invoice.month - 1);
  
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .bonus-badge { background: #fef3c7; color: #92400e; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; border: 2px dashed #f59e0b; }
    .bonus-amount { font-size: 32px; color: #f59e0b; font-weight: bold; margin: 10px 0; }
    .bonus-details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b; }
    .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .detail-label { font-weight: bold; color: #6b7280; }
    .detail-value { color: #111827; font-weight: 600; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Bonus Added!</h1>
      <p>You've earned an additional bonus</p>
    </div>
    <div class="content">
      <div class="bonus-badge">
        <div>✨ Congratulations! ✨</div>
        <div class="bonus-amount">$${bonus.amountUSD.toFixed(2)} USD</div>
        <div>Bonus Added to Your Invoice</div>
      </div>

      <p>Hi ${teacher.firstName},</p>
      <p>Great news! A <strong>${bonus.source}</strong> bonus has been added to your invoice <strong>#${invoice.invoiceNumber}</strong>.</p>
      
      <div class="bonus-details">
        <h3>Bonus Details</h3>
        <div class="detail-row">
          <span class="detail-label">Bonus Type:</span>
          <span class="detail-value">${bonus.source}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount:</span>
          <span class="detail-value" style="color: #f59e0b;">$${bonus.amountUSD.toFixed(2)} USD</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Reason:</span>
          <span class="detail-value">${bonus.reason}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Invoice:</span>
          <span class="detail-value">#${invoice.invoiceNumber}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Period:</span>
          <span class="detail-value">${formatDate(periodDate)}</span>
        </div>
      </div>

      <p><strong>Updated Invoice Total:</strong></p>
      <p style="font-size: 24px; color: #10b981; font-weight: bold; text-align: center; background: #f3f4f6; padding: 15px; border-radius: 8px;">
        ${invoice.netAmountEGP?.toFixed(2) || '0.00'} EGP
      </p>

      <p style="background: #dbeafe; padding: 15px; border-radius: 8px; border-left: 4px solid #3b82f6;">
        <strong>💡 Tip:</strong> This bonus has been automatically added to your invoice and will be included in your next payment.
      </p>

      <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
        Keep up the excellent work! If you have any questions, please contact your administrator.
      </p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Waraqa. All rights reserved.</p>
      <p style="font-size: 12px; color: #9ca3af;">This is an automated notification. Please do not reply to this email.</p>
    </div>
  </div>
</body>
</html>
  `;
}

function generateAdminSummaryHTML(admin, summary) {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
    .summary-card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e5e7eb; }
    .stat-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
    .stat-label { font-weight: bold; color: #6b7280; }
    .stat-value { color: #111827; font-weight: 600; font-size: 18px; }
    .success { color: #10b981; }
    .warning { color: #f59e0b; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 Invoice Generation Complete</h1>
      <p>Monthly teacher salary invoices have been generated</p>
    </div>
    <div class="content">
      <p>Hi ${admin.firstName},</p>
      <p>The automated invoice generation job has completed for <strong>${summary.month}/${summary.year}</strong>.</p>
      
      <div class="summary-card">
        <h3>Generation Summary</h3>
        <div class="stat-row">
          <span class="stat-label">Total Teachers Processed:</span>
          <span class="stat-value">${summary.totalProcessed || 0}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Invoices Created:</span>
          <span class="stat-value success">${summary.created || 0}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Skipped (No Hours):</span>
          <span class="stat-value warning">${summary.skipped?.length || 0}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Failed:</span>
          <span class="stat-value" style="color: #ef4444;">${summary.failed?.length || 0}</span>
        </div>
      </div>

      ${summary.skipped && summary.skipped.length > 0 ? `
      <div style="background: #fef3c7; padding: 15px; border-radius: 8px; border-left: 4px solid #f59e0b; margin: 20px 0;">
        <strong>⚠️ Skipped Teachers:</strong>
        <ul style="margin: 10px 0;">
          ${summary.skipped.slice(0, 5).map(t => `<li>${t.name || 'Unknown'} - ${t.reason}</li>`).join('')}
          ${summary.skipped.length > 5 ? `<li><em>... and ${summary.skipped.length - 5} more</em></li>` : ''}
        </ul>
      </div>
      ` : ''}

      <p><strong>Next Steps:</strong></p>
      <ul>
        <li>Review draft invoices in the admin dashboard</li>
        <li>Add any bonuses or extras as needed</li>
        <li>Publish invoices to make them visible to teachers</li>
        <li>Process payments once published</li>
      </ul>

      <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
        This is an automated summary from the teacher salary system.
      </p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Waraqa. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
}

module.exports = { 
  sendMail,
  sendInvoicePublished,
  sendPaymentReceived,
  sendBonusAdded,
  sendAdminInvoiceGenerationSummary
};