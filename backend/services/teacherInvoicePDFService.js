/**
 * Teacher Invoice PDF Generation Service
 * Generates professional PDF invoices for teacher salary payments
 */

const PDFDocument = require('pdfkit');
const { formatDateDDMMMYYYY, formatDateRangeDDMMMYYYY, getMonthBounds } = require('../utils/dateHelpers');

class TeacherInvoicePDFService {
  /**
   * Generate PDF for teacher invoice
   * @param {Object} invoice - Teacher invoice document (should be populated with teacher details)
   * @returns {PDFDocument} PDF document stream
   */
  generateInvoicePDF(invoice) {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    this._addHeader(doc, invoice);
    this._addInvoiceDetails(doc, invoice);
    this._addClassesTable(doc, invoice);
    
    if (invoice.bonuses && invoice.bonuses.length > 0) {
      this._addBonusesSection(doc, invoice);
    }
    
    if (invoice.extras && invoice.extras.length > 0) {
      this._addExtrasSection(doc, invoice);
    }
    
    this._addFinancialSummary(doc, invoice);
    this._addFooter(doc, invoice);

    doc.end();
    return doc;
  }

  _addHeader(doc, invoice) {
    // Company Logo/Name (top left)
    doc.fontSize(20)
       .font('Helvetica-Bold')
       .text('Waraq Inc', 50, 50);
    
    doc.fontSize(10)
       .font('Helvetica')
       .text('Teacher Salary Invoice', 50, 75);

    // Invoice Number and Status (top right)
    const invoiceNumber = invoice.invoiceNumber || 'DRAFT';
    doc.fontSize(14)
       .font('Helvetica-Bold')
       .text(`Invoice #${invoiceNumber}`, 350, 50, { align: 'right' });
    
    doc.fontSize(10)
       .font('Helvetica')
       .text(`Status: ${invoice.status.toUpperCase()}`, 350, 70, { align: 'right' });

    // Horizontal line
    doc.moveTo(50, 95)
       .lineTo(545, 95)
       .stroke();
  }

  _addInvoiceDetails(doc, invoice) {
    const startY = 110;

    // Teacher Information (left side)
    doc.fontSize(11)
       .font('Helvetica-Bold')
       .text('Teacher Details:', 50, startY);

    const teacherName = invoice.teacher?.firstName && invoice.teacher?.lastName 
      ? `${invoice.teacher.firstName} ${invoice.teacher.lastName}`
      : 'Unknown Teacher';
    
    doc.fontSize(10)
       .font('Helvetica')
       .text(teacherName, 50, startY + 20);
    
    if (invoice.teacher?.email) {
      doc.text(invoice.teacher.email, 50, startY + 35);
    }

    // Invoice Period (right side)
    doc.fontSize(11)
       .font('Helvetica-Bold')
       .text('Invoice Period:', 350, startY);

    const { firstDay, lastDay } = getMonthBounds(invoice.year - 1970, invoice.month);
    const dateRange = formatDateRangeDDMMMYYYY(firstDay, lastDay, { separator: ' → ' });

    doc.fontSize(10)
       .font('Helvetica')
       .text(dateRange, 350, startY + 20);

    doc.text(`Total Hours: ${invoice.totalHours}h`, 350, startY + 35);
    doc.text(`Rate: $${invoice.rateSnapshot.rate}/hr (${invoice.rateSnapshot.partition})`, 350, startY + 50);

    if (invoice.publishedAt) {
      doc.text(`Published: ${formatDateDDMMMYYYY(invoice.publishedAt)}`, 350, startY + 65);
    }
  }

  _addClassesTable(doc, invoice) {
    const startY = 210;

    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('Classes Summary', 50, startY);

    // Table header
    const tableTop = startY + 20;
    doc.fontSize(9)
       .font('Helvetica-Bold');

    doc.text('Classes Taught', 50, tableTop);
    doc.text('Total Hours', 400, tableTop);

    // Horizontal line
    doc.moveTo(50, tableTop + 15)
       .lineTo(545, tableTop + 15)
       .stroke();

    // Table content
    doc.fontSize(9)
       .font('Helvetica');

    const classCount = invoice.classIds?.length || 0;
    doc.text(`${classCount} classes`, 50, tableTop + 25);
    doc.text(`${invoice.totalHours}h`, 400, tableTop + 25);

    // Bottom line
    doc.moveTo(50, tableTop + 45)
       .lineTo(545, tableTop + 45)
       .stroke();
  }

  _addBonusesSection(doc, invoice) {
    doc.addPage();
    const startY = 50;

    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('Bonuses', 50, startY);

    const tableTop = startY + 20;
    let currentY = tableTop;

    // Table header
    doc.fontSize(9)
       .font('Helvetica-Bold');
    doc.text('Source', 50, currentY);
    doc.text('Amount (USD)', 300, currentY);
    doc.text('Reason', 400, currentY);

    currentY += 15;
    doc.moveTo(50, currentY)
       .lineTo(545, currentY)
       .stroke();
    currentY += 10;

    // Bonus entries
    doc.font('Helvetica');
    invoice.bonuses.forEach((bonus, index) => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }

      doc.text(bonus.source, 50, currentY);
      doc.text(`$${bonus.amountUSD.toFixed(2)}`, 300, currentY);
      doc.text(bonus.reason.substring(0, 30), 400, currentY);
      currentY += 20;
    });

    // Total bonuses
    currentY += 10;
    doc.moveTo(50, currentY)
       .lineTo(545, currentY)
       .stroke();
    currentY += 10;

    doc.font('Helvetica-Bold');
    doc.text('Total Bonuses:', 50, currentY);
    doc.text(`$${invoice.bonusesUSD.toFixed(2)}`, 300, currentY);
  }

  _addExtrasSection(doc, invoice) {
    let startY = 50;
    if (invoice.bonuses && invoice.bonuses.length === 0) {
      doc.addPage();
    } else {
      startY = doc.y + 40;
      if (startY > 650) {
        doc.addPage();
        startY = 50;
      }
    }

    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('Additional Items', 50, startY);

    const tableTop = startY + 20;
    let currentY = tableTop;

    // Table header
    doc.fontSize(9)
       .font('Helvetica-Bold');
    doc.text('Category', 50, currentY);
    doc.text('Amount (USD)', 300, currentY);
    doc.text('Reason', 400, currentY);

    currentY += 15;
    doc.moveTo(50, currentY)
       .lineTo(545, currentY)
       .stroke();
    currentY += 10;

    // Extra entries
    doc.font('Helvetica');
    invoice.extras.forEach((extra, index) => {
      if (currentY > 700) {
        doc.addPage();
        currentY = 50;
      }

      doc.text(extra.category, 50, currentY);
      const sign = extra.amountUSD >= 0 ? '+' : '';
      doc.text(`${sign}$${extra.amountUSD.toFixed(2)}`, 300, currentY);
      doc.text(extra.reason.substring(0, 30), 400, currentY);
      currentY += 20;
    });

    // Total extras
    currentY += 10;
    doc.moveTo(50, currentY)
       .lineTo(545, currentY)
       .stroke();
    currentY += 10;

    doc.font('Helvetica-Bold');
    doc.text('Total Extras:', 50, currentY);
    const extrasSign = invoice.extrasUSD >= 0 ? '+' : '';
    doc.text(`${extrasSign}$${invoice.extrasUSD.toFixed(2)}`, 300, currentY);
  }

  _addFinancialSummary(doc, invoice) {
    // Go to last page or add new page if needed
    if (doc.y > 550) {
      doc.addPage();
    }

    const startY = doc.y + 40;

    doc.fontSize(12)
       .font('Helvetica-Bold')
       .text('Financial Summary', 50, startY);

    // Summary box
    const boxStartY = startY + 25;
    doc.rect(350, boxStartY - 10, 195, 160).stroke();

    let currentY = boxStartY;

    // Gross Amount (USD)
    doc.fontSize(9)
       .font('Helvetica')
       .text('Base Salary (USD):', 360, currentY);
    doc.text(`$${invoice.grossAmountUSD.toFixed(2)}`, 460, currentY, { align: 'right' });
    currentY += 20;

    // Bonuses
    if (invoice.bonusesUSD > 0) {
      doc.text('Total Bonuses (USD):', 360, currentY);
      doc.text(`+$${invoice.bonusesUSD.toFixed(2)}`, 460, currentY, { align: 'right' });
      currentY += 20;
    }

    // Extras
    if (invoice.extrasUSD !== 0) {
      doc.text('Additional Items (USD):', 360, currentY);
      const extrasSign = invoice.extrasUSD >= 0 ? '+' : '';
      doc.text(`${extrasSign}$${invoice.extrasUSD.toFixed(2)}`, 460, currentY, { align: 'right' });
      currentY += 20;
    }

    // Total USD
    doc.font('Helvetica-Bold')
       .text('Total (USD):', 360, currentY);
    doc.text(`$${invoice.totalUSD.toFixed(2)}`, 460, currentY, { align: 'right' });
    currentY += 25;

    // Exchange Rate
    doc.font('Helvetica')
       .text(`Exchange Rate: ${invoice.exchangeRateSnapshot.rate.toFixed(2)} EGP/USD`, 360, currentY);
    currentY += 20;

    // Gross Amount (EGP)
    doc.text('Gross Amount (EGP):', 360, currentY);
    doc.text(`${invoice.grossAmountEGP.toFixed(2)} EGP`, 460, currentY, { align: 'right' });
    currentY += 20;

    // Transfer Fee
    const feeModel = invoice.transferFeeSnapshot.model;
    const feeValue = invoice.transferFeeSnapshot.value;
    const feeText = feeModel === 'percentage' 
      ? `Transfer Fee (${feeValue}%):`
      : feeModel === 'flat'
      ? `Transfer Fee (Flat):`
      : 'Transfer Fee:';
    
    doc.text(feeText, 360, currentY);
    doc.text(`-${invoice.transferFeeEGP.toFixed(2)} EGP`, 460, currentY, { align: 'right' });
    currentY += 25;

    // Net Amount (EGP)
    doc.fontSize(11)
       .font('Helvetica-Bold')
       .text('NET AMOUNT:', 360, currentY);
    doc.fontSize(12)
       .text(`${invoice.netAmountEGP.toFixed(2)} EGP`, 460, currentY, { align: 'right' });
  }

  _addFooter(doc, invoice) {
    const bottomY = 750;

    doc.fontSize(8)
       .font('Helvetica')
       .fillColor('#666666')
       .text('This is a system-generated invoice. Please verify all details before processing payment.', 50, bottomY, {
         align: 'center',
         width: 495
       });

    if (invoice.notes) {
      doc.text(`Notes: ${invoice.notes}`, 50, bottomY + 15, {
        align: 'center',
        width: 495
      });
    }
  }
}

module.exports = new TeacherInvoicePDFService();
