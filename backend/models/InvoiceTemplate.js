/**
 * Invoice Template Model
 * 
 * Stores customizable invoice templates with branding and layout options
 */

const mongoose = require('mongoose');

const invoiceTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  
  description: {
    type: String,
    trim: true
  },
  
  isDefault: {
    type: Boolean,
    default: false
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Branding
  branding: {
    logo: {
      url: String,
      width: { type: Number, default: 150 },
      height: { type: Number, default: 60 }
    },
    companyName: {
      type: String,
      default: 'Waraqa Education'
    },
    companyAddress: {
      type: String,
      default: ''
    },
    companyPhone: {
      type: String,
      default: ''
    },
    companyEmail: {
      type: String,
      default: ''
    },
    companyWebsite: {
      type: String,
      default: ''
    },
    taxId: {
      type: String,
      default: ''
    }
  },
  
  // Color scheme
  colors: {
    primary: { 
      type: String, 
      default: '#2C736C' // blue-600
    },
    secondary: {
      type: String,
      default: '#64748b' // slate-500
    },
    accent: {
      type: String,
      default: '#f59e0b' // amber-500
    },
    text: {
      type: String,
      default: '#1e293b' // slate-800
    },
    background: {
      type: String,
      default: '#ffffff'
    },
    headerBackground: {
      type: String,
      default: '#f8fafc' // slate-50
    }
  },
  
  // Typography
  typography: {
    fontFamily: {
      type: String,
      default: 'Inter, system-ui, sans-serif'
    },
    fontSize: {
      type: String,
      default: '14px'
    },
    headingFontFamily: {
      type: String,
      default: 'Inter, system-ui, sans-serif'
    }
  },
  
  // Layout options
  layout: {
    pageSize: {
      type: String,
      enum: ['A4', 'Letter', 'Legal'],
      default: 'A4'
    },
    orientation: {
      type: String,
      enum: ['portrait', 'landscape'],
      default: 'portrait'
    },
    margin: {
      top: { type: Number, default: 20 },
      right: { type: Number, default: 20 },
      bottom: { type: Number, default: 20 },
      left: { type: Number, default: 20 }
    },
    showLogo: {
      type: Boolean,
      default: true
    },
    showHeader: {
      type: Boolean,
      default: true
    },
    showFooter: {
      type: Boolean,
      default: true
    },
    showPageNumbers: {
      type: Boolean,
      default: true
    }
  },
  
  // Content sections
  sections: {
    // Header section
    header: {
      enabled: { type: Boolean, default: true },
      content: {
        type: String,
        default: ''
      }
    },
    
    // Invoice title
    title: {
      text: {
        type: String,
        default: 'INVOICE'
      },
      fontSize: {
        type: String,
        default: '24px'
      },
      color: {
        type: String,
        default: '#2C736C'
      },
      alignment: {
        type: String,
        enum: ['left', 'center', 'right'],
        default: 'left'
      }
    },
    
    // Customer/Teacher info section
    customerInfo: {
      enabled: { type: Boolean, default: true },
      label: {
        type: String,
        default: 'Bill To'
      }
    },
    
    // Invoice details section
    invoiceDetails: {
      enabled: { type: Boolean, default: true },
      showInvoiceNumber: { type: Boolean, default: true },
      showInvoiceDate: { type: Boolean, default: true },
      showDueDate: { type: Boolean, default: true },
      showBillingPeriod: { type: Boolean, default: true }
    },
    
    // Items table
    itemsTable: {
      enabled: { type: Boolean, default: true },
      showHeaders: { type: Boolean, default: true },
      alternateRowColors: { type: Boolean, default: true },
      columns: {
        description: { 
          enabled: { type: Boolean, default: true },
          label: { type: String, default: 'Description' },
          width: { type: String, default: '40%' }
        },
        date: {
          enabled: { type: Boolean, default: true },
          label: { type: String, default: 'Date' },
          width: { type: String, default: '15%' }
        },
        hours: {
          enabled: { type: Boolean, default: true },
          label: { type: String, default: 'Hours' },
          width: { type: String, default: '15%' }
        },
        rate: {
          enabled: { type: Boolean, default: true },
          label: { type: String, default: 'Rate' },
          width: { type: String, default: '15%' }
        },
        amount: {
          enabled: { type: Boolean, default: true },
          label: { type: String, default: 'Amount' },
          width: { type: String, default: '15%' }
        }
      }
    },
    
    // Totals section
    totals: {
      enabled: { type: Boolean, default: true },
      showSubtotal: { type: Boolean, default: true },
      showTax: { type: Boolean, default: true },
      showDiscount: { type: Boolean, default: true },
      showTotal: { type: Boolean, default: true },
      alignment: {
        type: String,
        enum: ['left', 'right'],
        default: 'right'
      }
    },
    
    // Payment info section
    paymentInfo: {
      enabled: { type: Boolean, default: true },
      title: {
        type: String,
        default: 'Payment Information'
      },
      content: {
        type: String,
        default: 'Please make payment within 7 days of invoice date.'
      }
    },
    
    // Notes section
    notes: {
      enabled: { type: Boolean, default: true },
      title: {
        type: String,
        default: 'Notes'
      },
      defaultContent: {
        type: String,
        default: 'Thank you for your business!'
      }
    },
    
    // Footer section
    footer: {
      enabled: { type: Boolean, default: true },
      content: {
        type: String,
        default: 'This is an automated invoice. For questions, please contact us.'
      },
      alignment: {
        type: String,
        enum: ['left', 'center', 'right'],
        default: 'center'
      }
    }
  },
  
  // Custom CSS
  customCss: {
    type: String,
    default: ''
  },
  
  // Template type
  templateType: {
    type: String,
    enum: ['guardian_invoice', 'teacher_payment', 'both'],
    default: 'both'
  },
  
  // Usage tracking
  usageCount: {
    type: Number,
    default: 0
  },
  
  lastUsed: {
    type: Date
  },
  
  // Audit
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
  
}, { timestamps: true });

// Indexes
invoiceTemplateSchema.index({ name: 1 });
invoiceTemplateSchema.index({ isDefault: 1, isActive: 1 });
invoiceTemplateSchema.index({ templateType: 1, isActive: 1 });

// Ensure only one default template per type
invoiceTemplateSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    // Unset other defaults of the same type
    const query = {
      _id: { $ne: this._id },
      isDefault: true,
      isActive: true
    };
    
    if (this.templateType !== 'both') {
      query.$or = [
        { templateType: this.templateType },
        { templateType: 'both' }
      ];
    }
    
    await this.constructor.updateMany(query, { $set: { isDefault: false } });
  }
  next();
});

// Static method to get default template
invoiceTemplateSchema.statics.getDefault = async function(templateType = 'both') {
  let template = await this.findOne({
    isDefault: true,
    isActive: true,
    templateType: { $in: [templateType, 'both'] }
  });
  
  if (!template) {
    // Return first active template
    template = await this.findOne({
      isActive: true,
      templateType: { $in: [templateType, 'both'] }
    });
  }
  
  return template;
};

// Method to increment usage count
invoiceTemplateSchema.methods.recordUsage = async function() {
  this.usageCount += 1;
  this.lastUsed = new Date();
  await this.save();
};

const InvoiceTemplate = mongoose.model('InvoiceTemplate', invoiceTemplateSchema);

module.exports = InvoiceTemplate;
