// backend/routes/settingsManagement.js
/**
 * Settings Management Routes for Teacher Salary System
 * Provides admin interfaces for managing all salary-related settings
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');

const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');

/**
 * @route   GET /api/settings-management/salary-settings
 * @desc    Get current salary settings
 * @access  Admin only
 */
router.get('/salary-settings', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const settings = await SalarySettings.findById('global')
      .populate('lastModifiedBy', 'firstName lastName email');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found. Please initialize settings.'
      });
    }

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('[GET /api/settings-management/salary-settings] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch salary settings',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/settings-management/salary-settings
 * @desc    Update salary settings
 * @access  Admin only
 */
router.put('/salary-settings', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const {
      rateModel,
      defaultTransferFee,
      transferFeeModel,
      autoPublishInvoices,
      invoiceGenerationDay,
      allowManualRateOverride,
      requireApprovalForBonuses,
      bonusApprovalThreshold,
      notifyTeachersOnInvoicePublish,
      changeNote
    } = req.body;

    const settings = await SalarySettings.findById('global');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found'
      });
    }

    // Track changes for audit
    const changes = [];

    if (rateModel && rateModel !== settings.rateModel) {
      changes.push({
        field: 'rateModel',
        oldValue: settings.rateModel,
        newValue: rateModel,
        note: changeNote || 'Updated rate model'
      });
      settings.rateModel = rateModel;
    }

    if (defaultTransferFee !== undefined && defaultTransferFee !== settings.defaultTransferFee) {
      changes.push({
        field: 'defaultTransferFee',
        oldValue: settings.defaultTransferFee,
        newValue: defaultTransferFee,
        note: changeNote || 'Updated default transfer fee'
      });
      settings.defaultTransferFee = defaultTransferFee;
    }

    if (transferFeeModel && transferFeeModel !== settings.transferFeeModel) {
      changes.push({
        field: 'transferFeeModel',
        oldValue: settings.transferFeeModel,
        newValue: transferFeeModel,
        note: changeNote || 'Updated transfer fee model'
      });
      settings.transferFeeModel = transferFeeModel;
    }

    if (autoPublishInvoices !== undefined && autoPublishInvoices !== settings.autoPublishInvoices) {
      changes.push({
        field: 'autoPublishInvoices',
        oldValue: settings.autoPublishInvoices,
        newValue: autoPublishInvoices,
        note: changeNote || 'Updated auto-publish setting'
      });
      settings.autoPublishInvoices = autoPublishInvoices;
    }

    if (invoiceGenerationDay !== undefined && invoiceGenerationDay !== settings.invoiceGenerationDay) {
      changes.push({
        field: 'invoiceGenerationDay',
        oldValue: settings.invoiceGenerationDay,
        newValue: invoiceGenerationDay,
        note: changeNote || 'Updated invoice generation day'
      });
      settings.invoiceGenerationDay = invoiceGenerationDay;
    }

    if (allowManualRateOverride !== undefined && allowManualRateOverride !== settings.allowManualRateOverride) {
      changes.push({
        field: 'allowManualRateOverride',
        oldValue: settings.allowManualRateOverride,
        newValue: allowManualRateOverride,
        note: changeNote || 'Updated manual rate override setting'
      });
      settings.allowManualRateOverride = allowManualRateOverride;
    }

    if (requireApprovalForBonuses !== undefined && requireApprovalForBonuses !== settings.requireApprovalForBonuses) {
      changes.push({
        field: 'requireApprovalForBonuses',
        oldValue: settings.requireApprovalForBonuses,
        newValue: requireApprovalForBonuses,
        note: changeNote || 'Updated bonus approval requirement'
      });
      settings.requireApprovalForBonuses = requireApprovalForBonuses;
    }

    if (bonusApprovalThreshold !== undefined && bonusApprovalThreshold !== settings.bonusApprovalThreshold) {
      changes.push({
        field: 'bonusApprovalThreshold',
        oldValue: settings.bonusApprovalThreshold,
        newValue: bonusApprovalThreshold,
        note: changeNote || 'Updated bonus approval threshold'
      });
      settings.bonusApprovalThreshold = bonusApprovalThreshold;
    }

    if (notifyTeachersOnInvoicePublish !== undefined && notifyTeachersOnInvoicePublish !== settings.notifyTeachersOnInvoicePublish) {
      changes.push({
        field: 'notifyTeachersOnInvoicePublish',
        oldValue: settings.notifyTeachersOnInvoicePublish,
        newValue: notifyTeachersOnInvoicePublish,
        note: changeNote || 'Updated teacher notification setting'
      });
      settings.notifyTeachersOnInvoicePublish = notifyTeachersOnInvoicePublish;
    }

    // Add changes to history
    if (changes.length > 0) {
      changes.forEach(change => {
        settings.changeHistory.push({
          ...change,
          changedBy: req.user.id,
          changedAt: new Date()
        });
      });

      settings.lastModifiedBy = req.user.id;
      settings.lastModifiedAt = new Date();
    }

    await settings.save();

    // Populate for response
    await settings.populate('lastModifiedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: `Successfully updated ${changes.length} setting(s)`,
      data: settings,
      changes: changes.map(c => c.field)
    });
  } catch (error) {
    console.error('[PUT /api/settings-management/salary-settings] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update salary settings',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/settings-management/rate-partitions
 * @desc    Get all rate partitions
 * @access  Admin only
 */
router.get('/rate-partitions', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const settings = await SalarySettings.findById('global');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found'
      });
    }

    res.json({
      success: true,
      data: {
        rateModel: settings.rateModel,
        partitions: settings.ratePartitions
      }
    });
  } catch (error) {
    console.error('[GET /api/settings-management/rate-partitions] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rate partitions',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/settings-management/rate-partitions
 * @desc    Add a new rate partition
 * @access  Admin only
 */
router.post('/rate-partitions', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { name, minHours, maxHours, rateUSD, description } = req.body;

    // Validate required fields
    if (!name || minHours === undefined || maxHours === undefined || !rateUSD) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: name, minHours, maxHours, rateUSD'
      });
    }

    // Validate hour range
    if (minHours < 0 || maxHours < minHours) {
      return res.status(400).json({
        success: false,
        message: 'Invalid hour range. minHours must be >= 0 and maxHours must be >= minHours'
      });
    }

    // Validate rate
    if (rateUSD <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Rate must be greater than 0'
      });
    }

    const settings = await SalarySettings.findById('global');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found'
      });
    }

    // Check for duplicate name
    if (settings.ratePartitions.some(p => p.name === name)) {
      return res.status(400).json({
        success: false,
        message: `Rate partition with name "${name}" already exists`
      });
    }

    // Check for overlapping ranges
    const overlaps = settings.ratePartitions.some(p => {
      return (minHours >= p.minHours && minHours < p.maxHours) ||
             (maxHours > p.minHours && maxHours <= p.maxHours) ||
             (minHours <= p.minHours && maxHours >= p.maxHours);
    });

    if (overlaps) {
      return res.status(400).json({
        success: false,
        message: 'Hour range overlaps with existing partition'
      });
    }

    // Add new partition
    settings.ratePartitions.push({
      name,
      minHours,
      maxHours,
      rateUSD,
      description: description || '',
      isActive: true
    });

    // Add to change history
    settings.changeHistory.push({
      field: 'ratePartitions',
      oldValue: null,
      newValue: { name, minHours, maxHours, rateUSD },
      changedBy: req.user.id,
      note: `Added new rate partition: ${name}`
    });

    settings.lastModifiedBy = req.user.id;
    settings.lastModifiedAt = new Date();

    await settings.save();

    res.status(201).json({
      success: true,
      message: `Rate partition "${name}" created successfully`,
      data: settings.ratePartitions[settings.ratePartitions.length - 1]
    });
  } catch (error) {
    console.error('[POST /api/settings-management/rate-partitions] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create rate partition',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/settings-management/rate-partitions/:partitionId
 * @desc    Update a rate partition
 * @access  Admin only
 */
router.put('/rate-partitions/:partitionId', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { partitionId } = req.params;
    const { name, minHours, maxHours, rateUSD, description, isActive } = req.body;

    const settings = await SalarySettings.findById('global');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found'
      });
    }

    const partition = settings.ratePartitions.id(partitionId);

    if (!partition) {
      return res.status(404).json({
        success: false,
        message: 'Rate partition not found'
      });
    }

    const oldValues = { ...partition.toObject() };

    // Update fields
    if (name !== undefined) partition.name = name;
    if (minHours !== undefined) partition.minHours = minHours;
    if (maxHours !== undefined) partition.maxHours = maxHours;
    if (rateUSD !== undefined) partition.rateUSD = rateUSD;
    if (description !== undefined) partition.description = description;
    if (isActive !== undefined) partition.isActive = isActive;

    // Add to change history
    settings.changeHistory.push({
      field: 'ratePartitions',
      oldValue: oldValues,
      newValue: partition.toObject(),
      changedBy: req.user.id,
      note: `Updated rate partition: ${partition.name}`
    });

    settings.lastModifiedBy = req.user.id;
    settings.lastModifiedAt = new Date();

    await settings.save();

    res.json({
      success: true,
      message: `Rate partition "${partition.name}" updated successfully`,
      data: partition
    });
  } catch (error) {
    console.error('[PUT /api/settings-management/rate-partitions/:partitionId] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update rate partition',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/settings-management/rate-partitions/:partitionId
 * @desc    Delete a rate partition
 * @access  Admin only
 */
router.delete('/rate-partitions/:partitionId', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { partitionId } = req.params;

    const settings = await SalarySettings.findById('global');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found'
      });
    }

    const partition = settings.ratePartitions.id(partitionId);

    if (!partition) {
      return res.status(404).json({
        success: false,
        message: 'Rate partition not found'
      });
    }

    // Prevent deletion if it's the only partition
    if (settings.ratePartitions.length === 1) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the only rate partition. At least one partition is required.'
      });
    }

    const deletedPartition = partition.toObject();
    partition.remove();

    // Add to change history
    settings.changeHistory.push({
      field: 'ratePartitions',
      oldValue: deletedPartition,
      newValue: null,
      changedBy: req.user.id,
      note: `Deleted rate partition: ${deletedPartition.name}`
    });

    settings.lastModifiedBy = req.user.id;
    settings.lastModifiedAt = new Date();

    await settings.save();

    res.json({
      success: true,
      message: `Rate partition "${deletedPartition.name}" deleted successfully`
    });
  } catch (error) {
    console.error('[DELETE /api/settings-management/rate-partitions/:partitionId] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete rate partition',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/settings-management/exchange-rates
 * @desc    Get monthly exchange rates
 * @access  Admin only
 */
router.get('/exchange-rates', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { year, month } = req.query;

    const query = {};
    if (year) query.year = parseInt(year);
    if (month) query.month = parseInt(month);

    const rates = await MonthlyExchangeRates.find(query)
      .populate('setBy', 'firstName lastName email')
      .sort({ year: -1, month: -1 })
      .limit(12);

    res.json({
      success: true,
      count: rates.length,
      data: rates
    });
  } catch (error) {
    console.error('[GET /api/settings-management/exchange-rates] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exchange rates',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/settings-management/exchange-rates/:year/:month
 * @desc    Get exchange rate for specific month
 * @access  Admin only
 */
router.get('/exchange-rates/:year/:month', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { year, month } = req.params;

    const rate = await MonthlyExchangeRates.findOne({
      year: parseInt(year),
      month: parseInt(month)
    }).populate('setBy', 'firstName lastName email');

    if (!rate) {
      return res.status(404).json({
        success: false,
        message: `No exchange rate found for ${year}-${month}`
      });
    }

    res.json({
      success: true,
      data: rate
    });
  } catch (error) {
    console.error('[GET /api/settings-management/exchange-rates/:year/:month] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch exchange rate',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/settings-management/exchange-rates
 * @desc    Set exchange rate for a month
 * @access  Admin only
 */
router.post('/exchange-rates', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { year, month, rate, source, note } = req.body;

    // Validate required fields
    if (!year || !month || !rate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: year, month, rate'
      });
    }

    // Validate month range
    if (month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        message: 'Month must be between 1 and 12'
      });
    }

    // Validate rate
    if (rate <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Exchange rate must be greater than 0'
      });
    }

    // Check if rate already exists
    let existingRate = await MonthlyExchangeRates.findOne({ year, month });

    if (existingRate) {
      // Update existing rate
      const oldRate = existingRate.rate;
      existingRate.rate = rate;
      existingRate.source = source || 'Manual Override';
      existingRate.setBy = req.user.id;
      existingRate.setAt = new Date();
      if (note) existingRate.note = note;

      await existingRate.save();

      return res.json({
        success: true,
        message: `Exchange rate for ${year}-${String(month).padStart(2, '0')} updated from ${oldRate} to ${rate}`,
        data: existingRate
      });
    }

    // Create new rate
    const newRate = await MonthlyExchangeRates.create({
      year,
      month,
      rate,
      source: source || 'Manual Override',
      setBy: req.user.id,
      note: note || ''
    });

    await newRate.populate('setBy', 'firstName lastName email');

    res.status(201).json({
      success: true,
      message: `Exchange rate for ${year}-${String(month).padStart(2, '0')} set to ${rate}`,
      data: newRate
    });
  } catch (error) {
    console.error('[POST /api/settings-management/exchange-rates] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set exchange rate',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/settings-management/transfer-fees
 * @desc    Get transfer fee settings
 * @access  Admin only
 */
router.get('/transfer-fees', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const settings = await SalarySettings.findById('global')
      .populate('lastModifiedBy', 'firstName lastName email');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found'
      });
    }

    res.json({
      success: true,
      data: {
        transferFeeModel: settings.transferFeeModel,
        defaultTransferFee: settings.defaultTransferFee,
        lastModifiedBy: settings.lastModifiedBy,
        lastModifiedAt: settings.lastModifiedAt
      }
    });
  } catch (error) {
    console.error('[GET /api/settings-management/transfer-fees] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transfer fee settings',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/settings-management/transfer-fees
 * @desc    Update transfer fee settings
 * @access  Admin only
 */
router.put('/transfer-fees', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { transferFeeModel, defaultTransferFee, note } = req.body;

    const settings = await SalarySettings.findById('global');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found'
      });
    }

    const changes = [];

    if (transferFeeModel && transferFeeModel !== settings.transferFeeModel) {
      changes.push({
        field: 'transferFeeModel',
        oldValue: settings.transferFeeModel,
        newValue: transferFeeModel,
        changedBy: req.user.id,
        note: note || 'Updated transfer fee model'
      });
      settings.transferFeeModel = transferFeeModel;
    }

    if (defaultTransferFee !== undefined && defaultTransferFee !== settings.defaultTransferFee) {
      changes.push({
        field: 'defaultTransferFee',
        oldValue: settings.defaultTransferFee,
        newValue: defaultTransferFee,
        changedBy: req.user.id,
        note: note || 'Updated default transfer fee'
      });
      settings.defaultTransferFee = defaultTransferFee;
    }

    if (changes.length > 0) {
      changes.forEach(change => settings.changeHistory.push(change));
      settings.lastModifiedBy = req.user.id;
      settings.lastModifiedAt = new Date();
      await settings.save();
    }

    await settings.populate('lastModifiedBy', 'firstName lastName email');

    res.json({
      success: true,
      message: `Successfully updated ${changes.length} transfer fee setting(s)`,
      data: {
        transferFeeModel: settings.transferFeeModel,
        defaultTransferFee: settings.defaultTransferFee,
        lastModifiedBy: settings.lastModifiedBy,
        lastModifiedAt: settings.lastModifiedAt
      }
    });
  } catch (error) {
    console.error('[PUT /api/settings-management/transfer-fees] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update transfer fee settings',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/settings-management/change-history
 * @desc    Get settings change history
 * @access  Admin only
 */
router.get('/change-history', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;

    const settings = await SalarySettings.findById('global')
      .populate('changeHistory.changedBy', 'firstName lastName email');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Salary settings not found'
      });
    }

    // Get recent history (sorted newest first)
    const history = settings.changeHistory
      .sort((a, b) => b.changedAt - a.changedAt)
      .slice(parseInt(skip), parseInt(skip) + parseInt(limit));

    res.json({
      success: true,
      total: settings.changeHistory.length,
      count: history.length,
      data: history
    });
  } catch (error) {
    console.error('[GET /api/settings-management/change-history] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch change history',
      error: error.message
    });
  }
});

module.exports = router;
