/**
 * Invoice Template Management Routes
 * Admin-only routes for managing invoice templates
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const TemplateService = require('../services/templateService');
const InvoiceTemplate = require('../models/InvoiceTemplate');
const Invoice = require('../models/Invoice');

/**
 * @route   GET /api/templates
 * @desc    List all invoice templates
 * @access  Admin only
 */
router.get('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { type, activeOnly } = req.query;
    
    const filter = {};
    if (type) filter.templateType = type;
    if (activeOnly === 'true') filter.isActive = true;
    
    const templates = await TemplateService.listTemplates(filter);
    
    res.json({
      success: true,
      count: templates.length,
      data: templates
    });
  } catch (error) {
    console.error('[GET /api/templates] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch templates',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/templates/:id
 * @desc    Get specific template
 * @access  Admin only
 */
router.get('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const template = await InvoiceTemplate.findById(req.params.id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('[GET /api/templates/:id] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch template',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/templates
 * @desc    Create new template
 * @access  Admin only
 */
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const templateData = req.body;
    
    // Validation
    if (!templateData.name) {
      return res.status(400).json({
        success: false,
        message: 'Template name is required'
      });
    }
    
    const template = await TemplateService.createTemplate(templateData, req.user.id);
    
    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template
    });
  } catch (error) {
    console.error('[POST /api/templates] Error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Template with this name already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create template',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/templates/:id
 * @desc    Update template
 * @access  Admin only
 */
router.put('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const updates = req.body;
    
    const template = await TemplateService.updateTemplate(
      req.params.id,
      updates,
      req.user.id
    );
    
    res.json({
      success: true,
      message: 'Template updated successfully',
      data: template
    });
  } catch (error) {
    console.error('[PUT /api/templates/:id] Error:', error);
    
    if (error.message === 'Template not found') {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update template',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/templates/:id
 * @desc    Delete template (soft delete)
 * @access  Admin only
 */
router.delete('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const template = await TemplateService.deleteTemplate(req.params.id);
    
    res.json({
      success: true,
      message: 'Template deleted successfully',
      data: template
    });
  } catch (error) {
    console.error('[DELETE /api/templates/:id] Error:', error);
    
    if (error.message.includes('not found') || error.message.includes('default')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to delete template',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/templates/:id/set-default
 * @desc    Set template as default
 * @access  Admin only
 */
router.post('/:id/set-default', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const template = await TemplateService.setDefaultTemplate(req.params.id);
    
    res.json({
      success: true,
      message: 'Template set as default',
      data: template
    });
  } catch (error) {
    console.error('[POST /api/templates/:id/set-default] Error:', error);
    
    if (error.message.includes('not found') || error.message.includes('inactive')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to set default template',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/templates/:id/preview
 * @desc    Preview template with sample data
 * @access  Admin only
 */
router.get('/:id/preview', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const template = await InvoiceTemplate.findById(req.params.id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    // Create sample invoice data
    const sampleInvoice = {
      invoiceNumber: 'INV-2025-001',
      type: template.templateType === 'both' ? 'guardian_invoice' : template.templateType,
      createdAt: new Date(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      billingPeriod: {
        startDate: new Date(2025, 0, 1),
        endDate: new Date(2025, 0, 31),
        month: 1,
        year: 2025
      },
      guardian: {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com'
      },
      teacher: {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com'
      },
      items: [
        {
          description: 'Math Class - Online Session',
          classDate: new Date(2025, 0, 5),
          hours: 1.5,
          rate: 50,
          amount: 75
        },
        {
          description: 'Math Class - Online Session',
          classDate: new Date(2025, 0, 12),
          hours: 2,
          rate: 50,
          amount: 100
        }
      ],
      subtotal: 175,
      tax: 0,
      discount: 0,
      total: 175,
      notes: 'Thank you for your business!'
    };
    
    // Generate PDF
    const pdfBuffer = await TemplateService.generatePDFBuffer(sampleInvoice, req.params.id);
    
    res.contentType('application/pdf');
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('[GET /api/templates/:id/preview] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate preview',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/templates/:id/duplicate
 * @desc    Duplicate template
 * @access  Admin only
 */
router.post('/:id/duplicate', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const original = await InvoiceTemplate.findById(req.params.id);
    
    if (!original) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    const duplicate = original.toObject();
    delete duplicate._id;
    delete duplicate.createdAt;
    delete duplicate.updatedAt;
    duplicate.name = `${original.name} (Copy)`;
    duplicate.isDefault = false;
    duplicate.usageCount = 0;
    duplicate.lastUsed = null;
    duplicate.createdBy = req.user.id;
    duplicate.updatedBy = req.user.id;
    
    const newTemplate = await TemplateService.createTemplate(duplicate, req.user.id);
    
    res.status(201).json({
      success: true,
      message: 'Template duplicated successfully',
      data: newTemplate
    });
  } catch (error) {
    console.error('[POST /api/templates/:id/duplicate] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate template',
      error: error.message
    });
  }
});

module.exports = router;
