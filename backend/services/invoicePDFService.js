/**
 * Invoice PDF Service
 * 
 * Generates professional PDF invoices for teacher salaries using PDFKit
 */

const PDFDocument = require('pdfkit');
const { formatDateDDMMMYYYY } = require('../utils/dateHelpers');

class InvoicePDFService {
  /**
   * Generate PDF for a teacher invoice
   * @param {Object} invoice - Complete invoice object from database
   * @returns {PDFDocument} PDF document stream
   */
  generateInvoicePDF(invoice) {
    // Create PDF document
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: `Invoice ${invoice.invoiceNumber}`,
        Author: 'Waraq Inc',
        Subject: `Teacher Salary Invoice for ${invoice.teacher?.firstName} ${invoice.teacher?.lastName}`,
        Creator: 'Class Management System'
      }
    });

    // Header
    this._addHeader(doc, invoice);
    
    // Invoice Details
    this._addInvoiceDetails(doc, invoice);
    
    // Classes Table
    this._addClassesTable(doc, invoice);
    
    // Bonuses (if any)
    if (invoice.bonuses && invoice.bonuses.length > 0) {
      this._addBonusesSection(doc, invoice);
    }
    
    // Extras (if any)
    if (invoice.extras && invoice.extras.length > 0) {
      this._addExtrasSection(doc, invoice);
    }
    
    // Financial Summary
    this._addFinancialSummary(doc, invoice);
    
    // Footer
    this._addFooter(doc, invoice);

    // Finalize PDF
    doc.end();

    return doc;
  }

  /**
   * Add company header and logo
   */
  _addHeader(doc, invoice) {
    // Company name
    doc.fontSize(24)
       .font('Helvetica-Bold')
       .text('Waraq Inc', 50, 50);
    
    doc.fontSize(10)
       .font('Helvetica')
       .text('Online Class Management System', 50, 80)
       .text('Email: support@waraq.com', 50, 95);

    // Invoice title and number
    doc.fontSize(20)
       .font('Helvetica-Bold')
       .text('SALARY INVOICE', 400, 50, { align: 'right' });
    
    doc.fontSize(12)
       .font('Helvetica')
       .text(invoice.invoiceNumber, 400, 75, { align: 'right' });

    // Draw horizontal line
    doc.moveTo(50, 120)
       .lineTo(545, 120)
       .stroke();

    doc.moveDown(2);
  }

  /**
   * Add invoice details section
   */
  _addInvoiceDetails(doc, invoice) {
    const startY = 140;
    
    // Teacher Details (Left column)
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('BILL TO:', 50, startY);
    
    doc.fontSize(11)
       .font('Helvetica')
       .text(`${invoice.teacher?.firstName} ${invoice.teacher?.lastName}`, 50, startY + 20)
       .text(invoice.teacher?.email || '', 50, startY + 35);
    
    if (invoice.teacher?.phone) {
      doc.text(invoice.teacher.phone, 50, startY + 50);
    }

    // Invoice Details (Right column)
    const rightCol = 350;
    doc.fontSize(10)
       .font('Helvetica-Bold')
       .text('Invoice Month:', rightCol, startY);
    doc.font('Helvetica')
       .text(formatDateDDMMMYYYY(invoice.invoiceMonth), rightCol + 100, startY);

    doc.font('Helvetica-Bold')
       .text('Issue Date:', rightCol, startY + 20);
    doc.font('Helvetica')
       .text(formatDateDDMMMYYYY(invoice.createdAt), rightCol + 100, startY + 20);

    doc.font('Helvetica-Bold')
       .text('Status:', rightCol, startY + 40);
    doc.font('Helvetica')
       .text(invoice.status.toUpperCase(), rightCol + 100, startY + 40);

    if (invoice.status === 'paid' && invoice.paidAt) {
      doc.font('Helvetica-Bold')
         .text('Payment Date:', rightCol, startY + 60);
      doc.font('Helvetica')
         .text(formatDateDDMMMYYYY(invoice.paidAt), rightCol + 100, startY + 60);
    }

    doc.moveDown(3);
  }

  /**
   * Add classes table
   */
  _addClassesTable(doc, invoice) {
    const startY = doc.y + 20;
    
    // Section title
    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('Classes Taught', 50, startY);

    // Table headers
    const tableTop = startY + 25;
    const colWidths = {
      date: 80,
      student: 150,
      hours: 60,
      rate: 60,
      amount: 80
    };

    doc.fontSize(9)
       .font('Helvetica-Bold');
    
    doc.text('Date', 50, tableTop);
    doc.text('Student', 50 + colWidths.date, tableTop);
    doc.text('Hours', 50 + colWidths.date + colWidths.student, tableTop, { width: colWidths.hours, align: 'right' });
    doc.text('Rate (USD)', 50 + colWidths.date + colWidths.student + colWidths.hours, tableTop, { width: colWidths.rate, align: 'right' });
    doc.text('Amount (USD)', 50 + colWidths.date + colWidths.student + colWidths.hours + colWidths.rate, tableTop, { width: colWidths.amount, align: 'right' });

    // Draw line under headers
    doc.moveTo(50, tableTop + 15)
       .lineTo(545, tableTop + 15)
       .stroke();

    // Table rows
    let currentY = tableTop + 25;
    doc.font('Helvetica').fontSize(9);

    if (invoice.classes && invoice.classes.length > 0) {
      invoice.classes.forEach((cls, index) => {
        // Check if we need a new page
        if (currentY > 700) {
          doc.addPage();
          currentY = 50;
        }

        const amount = (cls.hours * cls.rateUSD).toFixed(2);

        doc.text(formatDateDDMMMYYYY(cls.date), 50, currentY, { width: colWidths.date });
        doc.text(cls.studentName || 'N/A', 50 + colWidths.date, currentY, { width: colWidths.student });
        doc.text(cls.hours.toFixed(2), 50 + colWidths.date + colWidths.student, currentY, { width: colWidths.hours, align: 'right' });
        doc.text(`$${cls.rateUSD.toFixed(2)}`, 50 + colWidths.date + colWidths.student + colWidths.hours, currentY, { width: colWidths.rate, align: 'right' });
        doc.text(`$${amount}`, 50 + colWidths.date + colWidths.student + colWidths.hours + colWidths.rate, currentY, { width: colWidths.amount, align: 'right' });

        currentY += 20;
      });
    } else {
      doc.text('No classes recorded', 50, currentY);
      currentY += 20;
    }

    // Draw line after table
    doc.moveTo(50, currentY + 5)
       .lineTo(545, currentY + 5)
       .stroke();

    doc.y = currentY + 15;
  }

  /**
   * Add bonuses section
   */
  _addBonusesSection(doc, invoice) {
    const startY = doc.y + 20;

    doc.fontSize(11)
       .font('Helvetica-Bold')
       .text('Bonuses', 50, startY);

    let currentY = startY + 20;
    doc.fontSize(9).font('Helvetica');

    invoice.bonuses.forEach((bonus) => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }

      doc.text(bonus.description, 50, currentY, { width: 400 });
      doc.text(this._formatCurrency(bonus.amountInTargetCurrency, invoice.currency), 450, currentY, { align: 'right' });
      currentY += 20;
    });

    doc.y = currentY;
  }

  /**
   * Add extras section
   */
  _addExtrasSection(doc, invoice) {
    const startY = doc.y + 20;

    doc.fontSize(11)
       .font('Helvetica-Bold')
       .text('Additional Items', 50, startY);

    let currentY = startY + 20;
    doc.fontSize(9).font('Helvetica');

    invoice.extras.forEach((extra) => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }

      doc.text(extra.description, 50, currentY, { width: 400 });
      doc.text(this._formatCurrency(extra.amountInTargetCurrency, invoice.currency), 450, currentY, { align: 'right' });
      currentY += 20;
    });

    doc.y = currentY;
  }

  /**
   * Add financial summary
   */
  _addFinancialSummary(doc, invoice) {
    const startY = doc.y + 30;
    
    // Draw box for summary
    doc.rect(350, startY - 10, 195, 150).stroke();

    let currentY = startY;

    // Base Salary
    doc.fontSize(9)
       .font('Helvetica')
       .text('Base Salary (USD):', 360, currentY);
    doc.text(`$${invoice.baseSalaryUSD.toFixed(2)}`, 460, currentY, { align: 'right' });
    currentY += 20;

    // Currency conversion (if EGP)
    if (invoice.currency === 'EGP') {
      doc.text(`Converted to EGP (${invoice.snapshotExchangeRate?.rateEGPPerUSD?.toFixed(2)}):`, 360, currentY);
      doc.text(this._formatCurrency(invoice.baseSalaryInTargetCurrency, 'EGP'), 460, currentY, { align: 'right' });
      currentY += 20;
    }

    // Bonuses
    if (invoice.totalBonuses > 0) {
      doc.text('Total Bonuses:', 360, currentY);
      doc.text(`+${this._formatCurrency(invoice.totalBonuses, invoice.currency)}`, 460, currentY, { align: 'right' });
      currentY += 20;
    }

    // Extras
    if (invoice.totalExtras > 0) {
      doc.text('Additional Items:', 360, currentY);
      doc.text(`+${this._formatCurrency(invoice.totalExtras, invoice.currency)}`, 460, currentY, { align: 'right' });
      currentY += 20;
    }

    // Subtotal
    doc.font('Helvetica-Bold')
       .text('Subtotal:', 360, currentY);
    doc.text(this._formatCurrency(invoice.subtotal, invoice.currency), 460, currentY, { align: 'right' });
    currentY += 20;

    // Transfer Fee
    if (invoice.transferFee > 0) {
      doc.font('Helvetica')
         .text(`Transfer Fee (${invoice.snapshotTransferFee?.model}):`, 360, currentY);
      doc.text(`-${this._formatCurrency(invoice.transferFee, invoice.currency)}`, 460, currentY, { align: 'right' });
      currentY += 25;
    }

    // Final Total
    doc.fontSize(11)
       .font('Helvetica-Bold')
       .text('TOTAL AMOUNT:', 360, currentY);
    doc.fontSize(12)
       .text(this._formatCurrency(invoice.finalTotal, invoice.currency), 460, currentY, { align: 'right' });

    doc.y = currentY + 40;
  }

  /**
   * Add footer with payment info and notes
   */
  _addFooter(doc, invoice) {
    const pageBottom = 750;

    // Payment status
    if (invoice.status === 'paid') {
      doc.fontSize(10)
         .font('Helvetica-Bold')
         .fillColor('green')
         .text('✓ PAYMENT CONFIRMED', 50, pageBottom - 50);
      
      doc.fontSize(9)
         .font('Helvetica')
         .fillColor('black')
         .text(`Payment Date: ${formatDateDDMMMYYYY(invoice.paidAt)}`, 50, pageBottom - 35);
      
      if (invoice.paymentMethod) {
        doc.text(`Payment Method: ${invoice.paymentMethod}`, 50, pageBottom - 20);
      }
    }

    // Footer line
    doc.moveTo(50, pageBottom)
       .lineTo(545, pageBottom)
       .stroke();

    // Company footer
    doc.fontSize(8)
       .font('Helvetica')
       .fillColor('gray')
       .text('This is a computer-generated invoice. No signature required.', 50, pageBottom + 10, { align: 'center', width: 495 });
    
    doc.text('Waraq Inc © 2025 | support@waraq.com', 50, pageBottom + 25, { align: 'center', width: 495 });
  }

  /**
   * Format currency helper
   */
  _formatCurrency(amount, currency = 'EGP') {
    const value = Number(amount) || 0;
    if (currency === 'USD') {
      return `$${value.toFixed(2)}`;
    }
    return `${value.toFixed(2)} EGP`;
  }
}

module.exports = new InvoicePDFService();
