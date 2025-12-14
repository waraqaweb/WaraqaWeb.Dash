/**
 * Invoice Template Service
 * 
 * Handles invoice template management and custom PDF generation
 */

const InvoiceTemplate = require('../models/InvoiceTemplate');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class TemplateService {
  
  /**
   * Create default template if none exists
   */
  static async ensureDefaultTemplate() {
    const existingDefault = await InvoiceTemplate.findOne({ isDefault: true, isActive: true });
    
    if (!existingDefault) {
      const defaultTemplate = new InvoiceTemplate({
        name: 'Default Template',
        description: 'Standard invoice template with professional design',
        isDefault: true,
        isActive: true,
        templateType: 'both'
      });
      
      await defaultTemplate.save();
      console.log('✅ Created default invoice template');
      return defaultTemplate;
    }
    
    return existingDefault;
  }
  
  /**
   * Get template by ID or default
   */
  static async getTemplate(templateId = null, invoiceType = 'both') {
    if (templateId) {
      const template = await InvoiceTemplate.findById(templateId);
      if (template && template.isActive) {
        return template;
      }
    }
    
    // Get default template
    return await InvoiceTemplate.getDefault(invoiceType);
  }
  
  /**
   * Create a new template
   */
  static async createTemplate(templateData, userId) {
    const template = new InvoiceTemplate({
      ...templateData,
      createdBy: userId,
      updatedBy: userId
    });
    
    await template.save();
    return template;
  }
  
  /**
   * Update template
   */
  static async updateTemplate(templateId, updates, userId) {
    const template = await InvoiceTemplate.findById(templateId);
    
    if (!template) {
      throw new Error('Template not found');
    }
    
    Object.assign(template, updates);
    template.updatedBy = userId;
    
    await template.save();
    return template;
  }
  
  /**
   * Delete template (soft delete)
   */
  static async deleteTemplate(templateId) {
    const template = await InvoiceTemplate.findById(templateId);
    
    if (!template) {
      throw new Error('Template not found');
    }
    
    if (template.isDefault) {
      throw new Error('Cannot delete default template. Set another template as default first.');
    }
    
    template.isActive = false;
    await template.save();
    
    return template;
  }
  
  /**
   * Set template as default
   */
  static async setDefaultTemplate(templateId) {
    const template = await InvoiceTemplate.findById(templateId);
    
    if (!template) {
      throw new Error('Template not found');
    }
    
    if (!template.isActive) {
      throw new Error('Cannot set inactive template as default');
    }
    
    template.isDefault = true;
    await template.save();
    
    return template;
  }
  
  /**
   * List all active templates
   */
  static async listTemplates(filter = {}) {
    const query = { isActive: true, ...filter };
    return await InvoiceTemplate.find(query).sort({ isDefault: -1, name: 1 });
  }
  
  /**
   * Generate PDF with custom template
   */
  static async generateCustomPDF(invoice, templateId = null, outputPath = null) {
    const template = await this.getTemplate(templateId, invoice.type);
    
    if (!template) {
      throw new Error('No template available');
    }
    
    // Record template usage
    await template.recordUsage();
    
    // Create PDF document
    const doc = new PDFDocument({
      size: template.layout.pageSize,
      layout: template.layout.orientation,
      margins: {
        top: template.layout.margin.top,
        right: template.layout.margin.right,
        bottom: template.layout.margin.bottom,
        left: template.layout.margin.left
      }
    });
    
    // If outputPath provided, write to file
    if (outputPath) {
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
    }
    
    // Generate content using template
    await this._renderInvoice(doc, invoice, template);
    
    doc.end();
    
    return doc;
  }
  
  /**
   * Render invoice content with template
   */
  static async _renderInvoice(doc, invoice, template) {
    const { branding, colors, sections, layout } = template;
    
    let y = doc.y;
    
    // Header with logo
    if (layout.showLogo && layout.showHeader && branding.logo?.url) {
      // In production, load logo from URL
      // For now, just add company name
      doc.fontSize(20)
         .fillColor(colors.primary)
         .text(branding.companyName, 50, y, { align: 'left' });
      
      y += 40;
    }
    
    // Company details
    if (sections.header.enabled) {
      doc.fontSize(10)
         .fillColor(colors.text)
         .text(branding.companyAddress || '', 50, y)
         .text(branding.companyPhone || '', 50, y + 15)
         .text(branding.companyEmail || '', 50, y + 30);
      
      y += 60;
    }
    
    // Invoice title
    doc.fontSize(parseInt(sections.title.fontSize))
       .fillColor(sections.title.color || colors.primary)
       .text(sections.title.text, 50, y, { 
         align: sections.title.alignment,
         width: doc.page.width - 100
       });
    
    y += 40;
    
    // Invoice details and customer info side by side
    const leftCol = 50;
    const rightCol = doc.page.width / 2 + 50;
    
    // Left: Customer/Teacher info
    if (sections.customerInfo.enabled) {
      doc.fontSize(12)
         .fillColor(colors.secondary)
         .text(sections.customerInfo.label, leftCol, y);
      
      y += 20;
      
      doc.fontSize(10)
         .fillColor(colors.text);
      
      if (invoice.type === 'guardian_invoice' && invoice.guardian) {
        doc.text(`${invoice.guardian.firstName} ${invoice.guardian.lastName}`, leftCol, y)
           .text(invoice.guardian.email || '', leftCol, y + 15);
      } else if (invoice.type === 'teacher_payment' && invoice.teacher) {
        doc.text(`${invoice.teacher.firstName} ${invoice.teacher.lastName}`, leftCol, y)
           .text(invoice.teacher.email || '', leftCol, y + 15);
      }
    }
    
    // Right: Invoice details
    if (sections.invoiceDetails.enabled) {
      let detailY = y - 20;
      
      doc.fontSize(10)
         .fillColor(colors.text);
      
      if (sections.invoiceDetails.showInvoiceNumber) {
        doc.text('Invoice Number:', rightCol, detailY, { continued: true, width: 100 })
           .text(invoice.invoiceNumber, { align: 'right', width: 150 });
        detailY += 15;
      }
      
      if (sections.invoiceDetails.showInvoiceDate) {
        doc.text('Invoice Date:', rightCol, detailY, { continued: true, width: 100 })
           .text(new Date(invoice.createdAt).toLocaleDateString(), { align: 'right', width: 150 });
        detailY += 15;
      }
      
      if (sections.invoiceDetails.showDueDate) {
        doc.text('Due Date:', rightCol, detailY, { continued: true, width: 100 })
           .text(new Date(invoice.dueDate).toLocaleDateString(), { align: 'right', width: 150 });
        detailY += 15;
      }
      
      if (sections.invoiceDetails.showBillingPeriod && invoice.billingPeriod) {
        const period = `${new Date(invoice.billingPeriod.startDate).toLocaleDateString()} - ${new Date(invoice.billingPeriod.endDate).toLocaleDateString()}`;
        doc.text('Billing Period:', rightCol, detailY, { continued: true, width: 100 })
           .text(period, { align: 'right', width: 150 });
      }
    }
    
    y += 80;
    
    // Items table
    if (sections.itemsTable.enabled && invoice.items && invoice.items.length > 0) {
      y += 20;
      
      // Table header
      if (sections.itemsTable.showHeaders) {
        doc.fontSize(10)
           .fillColor(colors.primary);
        
        let x = 50;
        const cols = sections.itemsTable.columns;
        
        if (cols.description.enabled) {
          doc.text(cols.description.label, x, y, { width: 200 });
          x += 210;
        }
        if (cols.date.enabled) {
          doc.text(cols.date.label, x, y, { width: 80 });
          x += 90;
        }
        if (cols.hours.enabled) {
          doc.text(cols.hours.label, x, y, { width: 60 });
          x += 70;
        }
        if (cols.rate.enabled) {
          doc.text(cols.rate.label, x, y, { width: 60 });
          x += 70;
        }
        if (cols.amount.enabled) {
          doc.text(cols.amount.label, x, y, { width: 80, align: 'right' });
        }
        
        y += 20;
        
        // Separator line
        doc.strokeColor(colors.secondary)
           .lineWidth(1)
           .moveTo(50, y)
           .lineTo(doc.page.width - 50, y)
           .stroke();
        
        y += 10;
      }
      
      // Table rows
      doc.fillColor(colors.text);
      
      invoice.items.forEach((item, index) => {
        if (y > doc.page.height - 100) {
          doc.addPage();
          y = 50;
        }
        
        // Alternate row colors
        if (sections.itemsTable.alternateRowColors && index % 2 === 1) {
          doc.rect(50, y - 5, doc.page.width - 100, 20)
             .fillColor(template.colors.headerBackground)
             .fill();
        }
        
        doc.fontSize(9)
           .fillColor(colors.text);
        
        let x = 50;
        const cols = sections.itemsTable.columns;
        
        if (cols.description.enabled) {
          doc.text(item.description || '', x, y, { width: 200 });
          x += 210;
        }
        if (cols.date.enabled && item.classDate) {
          doc.text(new Date(item.classDate).toLocaleDateString(), x, y, { width: 80 });
          x += 90;
        }
        if (cols.hours.enabled) {
          doc.text(item.hours?.toFixed(2) || '0.00', x, y, { width: 60 });
          x += 70;
        }
        if (cols.rate.enabled) {
          doc.text(`$${item.rate?.toFixed(2) || '0.00'}`, x, y, { width: 60 });
          x += 70;
        }
        if (cols.amount.enabled) {
          doc.text(`$${item.amount?.toFixed(2) || '0.00'}`, x, y, { width: 80, align: 'right' });
        }
        
        y += 25;
      });
      
      y += 10;
    }
    
    // Totals section
    if (sections.totals.enabled) {
      y += 20;
      
      const totalsX = sections.totals.alignment === 'right' 
        ? doc.page.width - 250 
        : 50;
      
      doc.fontSize(10)
         .fillColor(colors.text);
      
      if (sections.totals.showSubtotal) {
        doc.text('Subtotal:', totalsX, y, { continued: true, width: 150 })
           .text(`$${invoice.subtotal?.toFixed(2) || '0.00'}`, { align: 'right', width: 100 });
        y += 20;
      }
      
      if (sections.totals.showTax && invoice.tax > 0) {
        doc.text('Tax:', totalsX, y, { continued: true, width: 150 })
           .text(`$${invoice.tax?.toFixed(2) || '0.00'}`, { align: 'right', width: 100 });
        y += 20;
      }
      
      if (sections.totals.showDiscount && invoice.discount > 0) {
        doc.text('Discount:', totalsX, y, { continued: true, width: 150 })
           .text(`-$${invoice.discount?.toFixed(2) || '0.00'}`, { align: 'right', width: 100 });
        y += 20;
      }
      
      if (sections.totals.showTotal) {
        doc.fontSize(12)
           .fillColor(colors.primary)
           .text('Total:', totalsX, y, { continued: true, width: 150 })
           .text(`$${invoice.total?.toFixed(2) || '0.00'}`, { align: 'right', width: 100 });
      }
    }
    
    // Notes section
    if (sections.notes.enabled && (invoice.notes || sections.notes.defaultContent)) {
      y += 40;
      
      if (y > doc.page.height - 150) {
        doc.addPage();
        y = 50;
      }
      
      doc.fontSize(11)
         .fillColor(colors.secondary)
         .text(sections.notes.title, 50, y);
      
      y += 20;
      
      doc.fontSize(9)
         .fillColor(colors.text)
         .text(invoice.notes || sections.notes.defaultContent, 50, y, { width: doc.page.width - 100 });
    }
    
    // Footer
    if (layout.showFooter && sections.footer.enabled) {
      const footerY = doc.page.height - 50;
      
      doc.fontSize(8)
         .fillColor(colors.secondary)
         .text(sections.footer.content, 50, footerY, {
           width: doc.page.width - 100,
           align: sections.footer.alignment
         });
    }
    
    // Page numbers
    if (layout.showPageNumbers) {
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(8)
           .fillColor(colors.secondary)
           .text(
             `Page ${i + 1} of ${pages.count}`,
             50,
             doc.page.height - 30,
             { align: 'center', width: doc.page.width - 100 }
           );
      }
    }
  }
  
  /**
   * Generate invoice buffer (for sending via email, etc.)
   */
  static async generatePDFBuffer(invoice, templateId = null) {
    return new Promise(async (resolve, reject) => {
      try {
        const chunks = [];
        const doc = await this.generateCustomPDF(invoice, templateId);
        
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = TemplateService;
