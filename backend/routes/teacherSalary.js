// backend/routes/teacherSalary.js
/**
 * Teacher Salary Routes - API endpoints for teacher salary system
 * Handles invoice management, payments, bonuses, and teacher dashboard
 */

const express = require('express');
const router = express.Router();

const { authenticateToken, requireAdmin, requireTeacher } = require('../middleware/auth');
const TeacherSalaryService = require('../services/teacherSalaryService');
const teacherInvoicePDFService = require('../services/teacherInvoicePDFService');
const TeacherInvoice = require('../models/TeacherInvoice');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
const TeacherSalaryAudit = require('../models/TeacherSalaryAudit');
const MonthlyReports = require('../models/MonthlyReports');
const User = require('../models/User');

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const getPeriodLabel = (month, year) => {
  if (!month || !year) {
    return 'All periods';
  }
  const idx = Math.min(Math.max(month - 1, 0), 11);
  return `${MONTH_NAMES[idx]} ${year}`;
};

const getPreviousPeriod = (month, year) => {
  if (!month || !year) return null;
  let prevMonth = Number(month) - 1;
  let prevYear = Number(year);
  if (prevMonth < 1) {
    prevMonth = 12;
    prevYear -= 1;
  }
  if (prevYear < 2000) return null;
  return { month: prevMonth, year: prevYear };
};

const buildInvoiceSummary = async (match) => {
  const [aggregateResult, statusBreakdown, teacherIds] = await Promise.all([
    TeacherInvoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalHours: { $sum: { $ifNull: ['$totalHours', 0] } },
          totalNetEGP: { $sum: { $ifNull: ['$netAmountEGP', 0] } },
          totalBonusesEGP: { $sum: { $ifNull: ['$bonusesEGP', 0] } },
          totalBonusesUSD: { $sum: { $ifNull: ['$bonusesUSD', 0] } },
          weightedRateNumerator: {
            $sum: {
              $multiply: [
                { $ifNull: ['$totalHours', 0] },
                { $ifNull: ['$rateSnapshot.rate', 0] }
              ]
            }
          },
          invoiceCount: { $sum: 1 }
        }
      }
    ]),
    TeacherInvoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          netAmountEGP: { $sum: { $ifNull: ['$netAmountEGP', 0] } }
        }
      }
    ]),
    TeacherInvoice.distinct('teacher', match)
  ]);

  const totalHours = Number(aggregateResult?.[0]?.totalHours || 0);
  const statusData = Array.isArray(statusBreakdown) ? statusBreakdown : [];
  const summary = {
    totalHours,
    totalNetEGP: Number(aggregateResult?.[0]?.totalNetEGP || 0),
    totalBonusesEGP: Number(aggregateResult?.[0]?.totalBonusesEGP || 0),
    totalBonusesUSD: Number(aggregateResult?.[0]?.totalBonusesUSD || 0),
    averageRateUSD: totalHours > 0
      ? Number((aggregateResult?.[0]?.weightedRateNumerator || 0) / totalHours)
      : 0,
    invoiceCount: Number(aggregateResult?.[0]?.invoiceCount || 0),
    teacherCount: Array.isArray(teacherIds) ? teacherIds.length : 0,
    statusBreakdown: statusData.reduce((acc, item) => {
      acc[item._id] = {
        count: item.count,
        netAmountEGP: item.netAmountEGP
      };
      return acc;
    }, {})
  };

  return summary;
};

// ==================== ADMIN ROUTES ====================

/**
 * Generate invoices for all teachers for a specific month
 * POST /api/teacher-salary/admin/generate
 * Body: { month, year, teacherIds?: string[], dryRun?: boolean }
 */
router.post('/admin/generate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { month, year, teacherIds, dryRun = false } = req.body;

    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    if (month < 1 || month > 12) {
      return res.status(400).json({ error: 'Month must be between 1 and 12' });
    }

    const results = await TeacherSalaryService.generateMonthlyInvoices(month, year, {
      userId: req.user._id,
      teacherIds,
      dryRun
    });

    res.json({
      success: true,
      message: dryRun ? 'Dry run completed' : 'Invoices generated successfully',
      results
    });
  } catch (error) {
    console.error('[POST /admin/generate] Error:', error);
    const message = error?.message || 'Failed to generate invoices';
    const lower = message.toLowerCase();
    if (
      lower.includes('exchange rate') ||
      lower.includes('month') ||
      lower.includes('year')
    ) {
      return res.status(400).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

/**
 * Release linked classes for a teacher/month to allow regeneration
 * POST /api/teacher-salary/admin/release-linked-classes
 * Body: { teacherId, month, year }
 */
router.post('/admin/release-linked-classes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { teacherId, month, year } = req.body || {};

    if (!teacherId || !month || !year) {
      return res.status(400).json({ error: 'teacherId, month, and year are required' });
    }

    const result = await TeacherSalaryService.releaseTeacherClassesForPeriod(teacherId, month, year);

    res.json({
      success: true,
      message: 'Linked classes released',
      result
    });
  } catch (error) {
    console.error('[POST /admin/release-linked-classes] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to release linked classes' });
  }
});

/**
 * Get all invoices for a month
 * GET /api/teacher-salary/admin/invoices?month=10&year=2025&status=draft
 */
router.get('/admin/invoices', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { month, year, status, page = 1, limit = 50, search, includeSummary, teacherId, currency } = req.query;

    const query = { deleted: false };

    // Support both (month=10&year=2025) and (month=2025-10) formats coming from <input type="month">
    const rawMonth = month ? String(month) : '';
    if (rawMonth && rawMonth.includes('-') && !year) {
      const [y, m] = rawMonth.split('-').map(v => parseInt(v, 10));
      if (Number.isFinite(y) && Number.isFinite(m)) {
        query.year = y;
        query.month = m;
      }
    } else {
      if (month) query.month = parseInt(month);
      if (year) query.year = parseInt(year);
    }
    if (status) {
      const normalized = String(status).toLowerCase();
      if (normalized === 'unpaid') {
        query.status = { $in: ['draft', 'published'] };
      } else if (normalized === 'paid') {
        query.status = 'paid';
      } else {
        query.status = status;
      }
    }

    if (teacherId) {
      query.teacher = teacherId;
    }

    if (currency) {
      query.currency = String(currency).toUpperCase();
    }

    if (search && search.trim()) {
      const trimmed = search.trim();
      const regex = new RegExp(escapeRegex(trimmed), 'i');

      query.$or = [{ invoiceNumber: regex }];

      const teacherMatches = await User.find({
        role: 'teacher',
        $or: [
          { firstName: regex },
          { lastName: regex },
          { email: regex }
        ]
      }).select('_id').lean();

      if (teacherMatches.length > 0) {
        query.$or.push({ teacher: { $in: teacherMatches.map(t => t._id) } });
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    let summary = null;
    if (includeSummary === 'true') {
      const summaryMatch = { ...query };
      let summaryMonth = summaryMatch.month || null;
      let summaryYear = summaryMatch.year || null;

      if (!summaryMonth || !summaryYear) {
        const now = new Date();
        summaryMonth = summaryMonth || now.getMonth() + 1;
        summaryYear = summaryYear || now.getFullYear();
        summaryMatch.month = summaryMonth;
        summaryMatch.year = summaryYear;
      }

      const periodSummary = await buildInvoiceSummary(summaryMatch);
      const periodInfo = {
        month: summaryMonth,
        year: summaryYear,
        label: getPeriodLabel(summaryMonth, summaryYear)
      };

      summary = {
        period: {
          ...periodInfo,
          ...periodSummary
        }
      };

      const prevPeriod = getPreviousPeriod(summaryMonth, summaryYear);
      if (prevPeriod) {
        const previousMatch = { ...summaryMatch, month: prevPeriod.month, year: prevPeriod.year };
        const previousSummary = await buildInvoiceSummary(previousMatch);
        summary.previousPeriod = {
          ...prevPeriod,
          label: getPeriodLabel(prevPeriod.month, prevPeriod.year),
          ...previousSummary
        };
      }
    }

    const [invoices, total] = await Promise.all([
      TeacherInvoice.find(query)
        .populate('teacher', 'firstName lastName email teacherInfo')
        .sort({ year: -1, month: -1, createdAt: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      TeacherInvoice.countDocuments(query)
    ]);

    res.json({
      success: true,
      invoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
        totalPages: Math.ceil(total / parseInt(limit))
      },
      summary
    });
  } catch (error) {
    console.error('[GET /admin/invoices] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get single invoice by ID
 * GET /api/teacher-salary/admin/invoices/:id
 */
router.get('/admin/invoices/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findById(req.params.id)
      .populate('teacher', 'firstName lastName email teacherInfo')
      .populate('bonuses.addedBy', 'firstName lastName')
      .populate('extras.addedBy', 'firstName lastName')
      .populate('bonuses.guardianId', 'firstName lastName')
      .populate('changeHistory.changedBy', 'firstName lastName')
      .populate({
        path: 'classIds',
        populate: [
          { path: 'student', select: 'firstName lastName' },
          { path: 'teacher', select: 'firstName lastName' }
        ]
      })
      .lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Format classes for frontend display
    const classes = (invoice.classIds || []).map(cls => ({
      _id: cls._id,
      date: cls.scheduledDate,
      studentName: cls.student ? `${cls.student.firstName} ${cls.student.lastName}` : 'N/A',
      teacherName: cls.teacher ? `${cls.teacher.firstName} ${cls.teacher.lastName}` : 'N/A',
      subject: cls.subject || '-',
      duration: cls.duration || 0,
      hours: (cls.duration || 0) / 60,
      status: cls.status || 'scheduled',
      rateUSD: invoice.rateSnapshot?.rate || 0
    }));

    res.json({ 
      success: true, 
      invoice: {
        ...invoice,
        classes
      }
    });
  } catch (error) {
    console.error('[GET /admin/invoices/:id] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Publish an invoice
 * POST /api/teacher-salary/admin/invoices/:id/publish
 */
router.post('/admin/invoices/:id/publish', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await TeacherSalaryService.publishInvoice(req.params.id, req.user._id);

    res.json({
      success: true,
      message: 'Invoice published successfully',
      invoice
    });
  } catch (error) {
    console.error('[POST /admin/invoices/:id/publish] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Unpublish an invoice
 * POST /api/teacher-salary/admin/invoices/:id/unpublish
 */
router.post('/admin/invoices/:id/unpublish', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    await invoice.unpublish(req.user._id);

    res.json({
      success: true,
      message: 'Invoice unpublished successfully',
      invoice
    });
  } catch (error) {
    console.error('[POST /admin/invoices/:id/unpublish] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Mark invoice as paid
 * POST /api/teacher-salary/admin/invoices/:id/mark-paid
 */
router.post('/admin/invoices/:id/mark-paid', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { paymentMethod, transactionId, paidAt, note, notes } = req.body;
    const resolvedNote = note || notes || null;

    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method is required' });
    }

    const invoice = await TeacherSalaryService.markInvoiceAsPaid(
      req.params.id,
      { paymentMethod, transactionId, paidAt: paidAt || new Date(), note: resolvedNote },
      req.user._id
    );

    res.json({
      success: true,
      message: 'Invoice marked as paid successfully',
      invoice
    });
  } catch (error) {
    console.error('[POST /admin/invoices/:id/mark-paid] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add bonus to invoice
 * POST /api/teacher-salary/admin/invoices/:id/bonuses
 */
router.post('/admin/invoices/:id/bonuses', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { source, guardianId, amountUSD, grossAmountUSD, reason } = req.body;

    // Basic validation for source and reason
    if (!source || !reason) {
      return res.status(400).json({ error: 'Source and reason are required' });
    }

    if (reason.length < 5 || reason.length > 200) {
      return res.status(400).json({ error: 'Reason must be between 5 and 200 characters' });
    }

    let finalAmountUSD = Number(amountUSD || 0);

    // If guardian is paying, accept grossAmountUSD and compute net (95%) unless explicit amountUSD provided
    if (source === 'guardian') {
      const gross = Number(grossAmountUSD || 0);
      if (!gross || gross <= 0) {
        return res.status(400).json({ error: 'grossAmountUSD is required and must be positive for guardian bonuses' });
      }
      // Apply 5% transfer fee deduction (gross -> net)
      finalAmountUSD = Math.round((gross * 0.95) * 100) / 100;
    } else {
      // For admin (or other) sources, amountUSD must be provided and positive
      if (!finalAmountUSD || finalAmountUSD <= 0) {
        return res.status(400).json({ error: 'amountUSD is required and must be positive for non-guardian bonuses' });
      }
    }

    const payload = {
      source,
      guardianId: guardianId || null,
      amountUSD: finalAmountUSD,
      reason
    };

    const invoice = await TeacherSalaryService.addBonus(
      req.params.id,
      payload,
      req.user._id
    );

    res.json({
      success: true,
      message: 'Bonus added successfully',
      invoice
    });
  } catch (error) {
    console.error('[POST /admin/invoices/:id/bonuses] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete invoice (soft delete for unpaid invoices only: draft/published)
 * DELETE /api/teacher-salary/admin/invoices/:id
 */
router.delete('/admin/invoices/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findById(req.params.id).select('status').lean();
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const preserveHours = (() => {
      const raw = req.query.preserveHours ?? req.body?.preserveHours ?? req.headers['x-preserve-hours'];
      if (raw === undefined || raw === null) {
        return ['draft', 'published'].includes(invoice.status) ? false : true;
      }
      const normalized = String(raw).trim().toLowerCase();
      if (!normalized) return true;
      if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
      return ['1', 'true', 'yes', 'y'].includes(normalized);
    })();
    await TeacherSalaryService.deleteInvoice(req.params.id, req.user._id, { preserveHours });

    res.json({
      success: true,
      message: 'Invoice deleted successfully'
    });
  } catch (error) {
    console.error('[DELETE /admin/invoices/:id] Error:', error);
    if (error.message === 'Invoice not found') {
      return res.status(404).json({ error: error.message });
    }
    if (
      error.message === 'Only draft invoices can be deleted'
      || error.message === 'Only unpaid (draft/published) invoices can be deleted'
      || error.message === 'Only unpaid (draft/published) invoices can be deleted unless preserveHours=true'
    ) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * Remove bonus from invoice
 * DELETE /api/teacher-salary/admin/invoices/:id/bonuses/:bonusId
 */
router.delete('/admin/invoices/:id/bonuses/:bonusId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    invoice.removeBonus(req.params.bonusId, req.user._id);
    await invoice.save();

    res.json({
      success: true,
      message: 'Bonus removed successfully',
      invoice
    });
  } catch (error) {
    console.error('[DELETE /admin/invoices/:id/bonuses/:bonusId] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Apply admin overrides to invoice amounts
 * POST /api/teacher-salary/admin/invoices/:id/overrides
 */
router.post('/admin/invoices/:id/overrides', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { overrides } = req.body;

    if (!overrides || typeof overrides !== 'object') {
      return res.status(400).json({ error: 'Overrides object is required' });
    }

    const invoice = await TeacherInvoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Store original values for change history
    const originalValues = {
      grossAmountUSD: invoice.grossAmountUSD,
      bonusesUSD: invoice.bonusesUSD,
      extrasUSD: invoice.extrasUSD,
      totalUSD: invoice.totalUSD,
      grossAmountEGP: invoice.grossAmountEGP,
      bonusesEGP: invoice.bonusesEGP,
      extrasEGP: invoice.extrasEGP,
      totalEGP: invoice.totalEGP,
      transferFeeEGP: invoice.transferFeeEGP,
      netAmountEGP: invoice.netAmountEGP,
      exchangeRate: invoice.exchangeRateSnapshot?.rate
    };

    // Apply overrides
    invoice.overrides = invoice.overrides || {};
    Object.keys(overrides).forEach(key => {
      if (overrides[key] !== null && overrides[key] !== undefined && overrides[key] !== '') {
        invoice.overrides[key] = Number(overrides[key]);
      } else {
        invoice.overrides[key] = null;
      }
    });

    invoice.overrides.appliedBy = req.user._id;
    invoice.overrides.appliedAt = new Date();
    invoice.markModified('overrides');

    // Recalculate with overrides
    invoice.calculateAmounts();
    invoice.updatedBy = req.user._id;

    // Log in change history
    invoice.changeHistory.push({
      changedAt: new Date(),
      changedBy: req.user._id,
      action: 'override_amounts',
      oldValue: originalValues,
      newValue: {
        grossAmountUSD: invoice.grossAmountUSD,
        bonusesUSD: invoice.bonusesUSD,
        extrasUSD: invoice.extrasUSD,
        totalUSD: invoice.totalUSD,
        grossAmountEGP: invoice.grossAmountEGP,
        bonusesEGP: invoice.bonusesEGP,
        extrasEGP: invoice.extrasEGP,
        totalEGP: invoice.totalEGP,
        transferFeeEGP: invoice.transferFeeEGP,
        netAmountEGP: invoice.netAmountEGP
      },
      note: 'Admin manual override applied'
    });

    await invoice.save();

    res.json({
      success: true,
      message: 'Overrides applied successfully',
      invoice
    });
  } catch (error) {
    console.error('[POST /admin/invoices/:id/overrides] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Add extra to invoice
 * POST /api/teacher-salary/admin/invoices/:id/extras
 */
router.post('/admin/invoices/:id/extras', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { category, amountUSD, reason, description } = req.body;
    const resolvedReason = reason || description;
    const resolvedCategory = category || 'other';

    if (amountUSD === undefined || !resolvedReason) {
      return res.status(400).json({ error: 'amountUSD and reason are required' });
    }

    if (resolvedReason.length < 5 || resolvedReason.length > 200) {
      return res.status(400).json({ error: 'Reason must be between 5 and 200 characters' });
    }

    const invoice = await TeacherSalaryService.addExtra(
      req.params.id,
      { category: resolvedCategory, amountUSD, reason: resolvedReason },
      req.user._id
    );

    res.json({
      success: true,
      message: 'Extra added successfully',
      invoice
    });
  } catch (error) {
    console.error('[POST /admin/invoices/:id/extras] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Remove extra from invoice
 * DELETE /api/teacher-salary/admin/invoices/:id/extras/:extraId
 */
router.delete('/admin/invoices/:id/extras/:extraId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    invoice.removeExtra(req.params.extraId, req.user._id);
    await invoice.save();

    res.json({
      success: true,
      message: 'Extra removed successfully',
      invoice
    });
  } catch (error) {
    console.error('[DELETE /admin/invoices/:id/extras/:extraId] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SALARY SETTINGS ROUTES ====================

/**
 * Get salary settings (auto-create if not found)
 * GET /api/teacher-salary/admin/settings
 */
router.get('/admin/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    let settings = await SalarySettings.findOne();
    
    if (!settings) {
      // Auto-create default settings
      const DEFAULT_RATE_TIERS = [
        { minHours: 1, maxHours: 60, rateUSD: 3.00, name: '1-60 hours' },
        { minHours: 61, maxHours: 75, rateUSD: 3.25, name: '61-75 hours' },
        { minHours: 76, maxHours: 90, rateUSD: 3.50, name: '76-90 hours' },
        { minHours: 91, maxHours: 110, rateUSD: 3.75, name: '91-110 hours' },
        { minHours: 111, maxHours: 130, rateUSD: 4.00, name: '111-130 hours' },
        { minHours: 131, maxHours: 150, rateUSD: 4.25, name: '131-150 hours' },
        { minHours: 151, maxHours: 999999, rateUSD: 4.50, name: '150+ hours' }
      ];

      settings = await SalarySettings.create({
        ratePartitions: DEFAULT_RATE_TIERS.map(tier => ({
          name: tier.name,
          minHours: tier.minHours,
          maxHours: tier.maxHours,
          rateUSD: tier.rateUSD,
          description: `Hourly rate for ${tier.minHours}-${tier.maxHours === 999999 ? '150+' : tier.maxHours} hours per month`,
          isActive: true
        })),
        defaultTransferFee: {
          model: 'flat',
          value: 25
        }
      });
    }
    
    res.json({ success: true, settings });
  } catch (error) {
    console.error('[GET /admin/settings] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update rate partition
 * PUT /api/teacher-salary/admin/settings/partitions/:partitionName
 */
router.put('/admin/settings/partitions/:partitionName', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { rateUSD, applyToDrafts = false } = req.body;

    if (!rateUSD || rateUSD <= 0) {
      return res.status(400).json({ error: 'Valid rate is required' });
    }

    const settings = await SalarySettings.getGlobalSettings();
    const result = settings.updatePartition(req.params.partitionName, rateUSD, req.user._id, applyToDrafts);
    await settings.save();

    // If applyToDrafts, update all draft invoices
    if (applyToDrafts) {
      const { partition, newRate } = result;
      const updated = await TeacherInvoice.updateMany(
        {
          status: 'draft',
          'rateSnapshot.partition': partition.name
        },
        {
          $set: {
            'rateSnapshot.rate': newRate,
            updatedBy: req.user._id
          }
        }
      );

      result.affectedInvoices = updated.modifiedCount;
    }

    res.json({
      success: true,
      message: 'Rate updated successfully',
      result,
      settings
    });
  } catch (error) {
    console.error('[PUT /admin/settings/partitions/:partitionName] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update all rate partitions (hour-based tiers)
 * PUT /api/teacher-salary/admin/settings/rate-partitions
 */
router.put('/admin/settings/rate-partitions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ratePartitions } = req.body;

    if (!ratePartitions || !Array.isArray(ratePartitions) || ratePartitions.length === 0) {
      return res.status(400).json({ error: 'Valid rate partitions array is required' });
    }

    // Validate each partition
    for (let i = 0; i < ratePartitions.length; i++) {
      const p = ratePartitions[i];
      if (!p.minHours && p.minHours !== 0 || !p.maxHours || !p.rateUSD || p.rateUSD <= 0) {
        return res.status(400).json({ 
          error: `Invalid partition at index ${i}: minHours, maxHours, and rateUSD are required` 
        });
      }
      if (p.minHours < 0 || p.maxHours < p.minHours) {
        return res.status(400).json({ 
          error: `Invalid partition at index ${i}: ensure minHours >= 0 and maxHours >= minHours` 
        });
      }
    }

    const settings = await SalarySettings.getGlobalSettings();
    settings.ratePartitions = ratePartitions;
    settings.updatedBy = req.user._id;
    await settings.save();

    res.json({
      success: true,
      message: 'Rate partitions updated successfully',
      settings
    });
  } catch (error) {
    console.error('[PUT /admin/settings/rate-partitions] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update default transfer fee
 * PUT /api/teacher-salary/admin/settings/transfer-fee
 */
router.put('/admin/settings/transfer-fee', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { model, value } = req.body;

    if (!model || value === undefined) {
      return res.status(400).json({ error: 'Model and value are required' });
    }

    // Validate model
    if (!['flat', 'percentage', 'none'].includes(model)) {
      return res.status(400).json({ error: 'Model must be either "flat", "percentage", or "none"' });
    }

    // Validate value
    const numValue = parseFloat(value);
    if (isNaN(numValue) || numValue < 0) {
      return res.status(400).json({ error: 'Value must be a non-negative number' });
    }

    const settings = await SalarySettings.findOne();
    
    if (!settings) {
      return res.status(404).json({ error: 'Salary settings not found. Please run initialization script.' });
    }

    // Update transfer fee with simple structure
    settings.defaultTransferFee = {
      model: model,
      value: numValue
    };

    settings.markModified('defaultTransferFee');
    await settings.save();

    res.json({
      success: true,
      message: 'Default transfer fee updated successfully',
      settings
    });
  } catch (error) {
    console.error('[PUT /admin/settings/transfer-fee] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== EXCHANGE RATE ROUTES ====================

/**
 * Get exchange rates for a year
 * GET /api/teacher-salary/admin/exchange-rates?year=2025
 */
router.get('/admin/exchange-rates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { year } = req.query;

    if (!year) {
      return res.status(400).json({ error: 'Year is required' });
    }

    const rates = await MonthlyExchangeRates.getRatesForYear(parseInt(year));

    res.json({ success: true, rates });
  } catch (error) {
    console.error('[GET /admin/exchange-rates] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Set exchange rate for a month
 * POST /api/teacher-salary/admin/exchange-rates
 */
router.post('/admin/exchange-rates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { month, year, rate, source, notes } = req.body;

    if (!month || !year || !rate) {
      return res.status(400).json({ error: 'Month, year, and rate are required' });
    }

    if (rate <= 0 || rate > 1000) {
      return res.status(400).json({ error: 'Rate must be between 0.01 and 1000' });
    }

    const record = await MonthlyExchangeRates.setRateForMonth(
      month,
      year,
      rate,
      req.user._id,
      source || 'Manual Entry',
      notes || ''
    );

    const monthLabel = String(month).padStart(2, '0');
    const updatedInvoices = [];
    try {
      const unpaidInvoices = await TeacherInvoice.find({
        month: Number(month),
        year: Number(year),
        deleted: { $ne: true },
        status: { $in: ['draft', 'published'] }
      });

      for (const invoice of unpaidInvoices) {
        invoice.exchangeRateSnapshot = {
          rate: record.rate,
          source: `MonthlyExchangeRate ${year}-${monthLabel}`,
          setBy: record.setBy,
          setAt: record.setAt
        };
        invoice.calculateAmounts();
        await invoice.save();
        updatedInvoices.push(invoice._id);
      }
    } catch (updateErr) {
      console.warn('[POST /admin/exchange-rates] Failed to refresh unpaid invoices:', updateErr?.message || updateErr);
    }

    res.json({
      success: true,
      message: 'Exchange rate set successfully',
      rate: record,
      updatedInvoices: updatedInvoices.length
    });
  } catch (error) {
    console.error('[POST /admin/exchange-rates] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Zero monthly hours for selected teachers (always creates invoices before zeroing)
 * POST /api/teacher-salary/admin/zero-monthly-hours
 * Body: { month, year, teacherIds?: string[], includeInactive?: boolean }
 */
router.post('/admin/zero-monthly-hours', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { month, year, teacherIds, includeInactive = false, createInvoices = true } = req.body;

    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    if (createInvoices === false) {
      return res.status(400).json({ error: 'Creating invoices before zeroing is now mandatory to preserve teacher hours.' });
    }

    const monthNumber = parseInt(month, 10);
    const yearNumber = parseInt(year, 10);

    const query = { role: 'teacher' };
    if (!includeInactive) query.isActive = true;
    if (Array.isArray(teacherIds) && teacherIds.length > 0) {
      query._id = { $in: teacherIds };
    }

    const teachers = await User.find(query).select('_id firstName lastName teacherInfo');

    const results = {
      zeroed: [],
      invoicesCreated: [],
      failed: [],
      summary: { total: teachers.length, zeroed: 0, invoicesCreated: 0, failed: 0 }
    };

    for (const teacher of teachers) {
      try {
        const currentHours = Number(teacher.teacherInfo?.monthlyHours || 0);
        // Also compute aggregated class hours for the month to cross-check
        let aggregated = null;
        try {
          aggregated = await TeacherSalaryService.aggregateTeacherHours(teacher._id, monthNumber, yearNumber);
        } catch (aggErr) {
          console.warn('[zero-monthly-hours] aggregateTeacherHours failed for', teacher._id, aggErr && aggErr.message);
        }

        const aggregatedHours = Number(aggregated?.totalHours || 0);
        const shouldCreateInvoice = (currentHours > 0) || (aggregatedHours > 0);
        let invoice = null;
        let invoiceError = null;

        if (shouldCreateInvoice) {
          try {
            invoice = await TeacherSalaryService.createTeacherInvoice(
              teacher._id,
              monthNumber,
              yearNumber,
              { userId: req.user._id, monthlyHoursSnapshot: currentHours }
            );
          } catch (invErr) {
            invoiceError = invErr;
          }

          if (!invoice) {
            const message = invoiceError
              ? `Invoice creation failed: ${invoiceError.message}`
              : 'Invoice creation skipped because no billable hours were detected.';
            results.failed.push({ teacherId: teacher._id, error: message });
            results.summary.failed++;
            // Never zero hours if invoice creation failed
            continue;
          }

          results.invoicesCreated.push({
            teacherId: teacher._id,
            invoiceId: invoice._id,
            lockedMonthlyHours: invoice.lockedMonthlyHours,
            totalHours: invoice.totalHours
          });
          results.summary.invoicesCreated++;
        }

        // Zero monthly fields
        teacher.teacherInfo = teacher.teacherInfo || {};
        const beforeSnapshot = { monthlyHours: teacher.teacherInfo.monthlyHours || 0 };

        console.log(`[zero-monthly-hours] Zeroing teacher ${teacher._id}. beforeMonthlyHours=${beforeSnapshot.monthlyHours}, aggregatedHours=${aggregated?.totalHours ?? 'N/A'}, invoiceId=${invoice?._id || 'none'}`);

        teacher.teacherInfo.monthlyHours = 0;
        teacher.teacherInfo.monthlyRate = 0;
        teacher.teacherInfo.monthlyEarnings = 0;
        teacher.teacherInfo.lastMonthlyReset = new Date();
        await teacher.save();

        // Audit per-teacher change (non-blocking)
        try {
          const audit = await TeacherSalaryAudit.logAction({
            action: 'bulk_operation',
            entityType: 'User',
            entityId: teacher._id,
            actor: req.user._id,
            actorRole: 'admin',
            before: beforeSnapshot,
            after: { monthlyHours: 0 },
            metadata: {
              reason: 'monthly_hours_zeroed_via_admin_endpoint',
              month,
              year,
              invoiceId: invoice?._id || null,
              lockedMonthlyHours: invoice?.lockedMonthlyHours ?? null
            }
          });
          console.log('[zero-monthly-hours] Audit logged for teacher', teacher._id, 'auditId=', audit?._id || '(no-id)');
        } catch (auditErr) {
          console.warn('[zero-monthly-hours] Audit log failed for teacher', teacher._id, auditErr && auditErr.message);
        }

        results.zeroed.push({
          teacherId: teacher._id,
          beforeMonthlyHours: beforeSnapshot.monthlyHours,
          aggregatedHours: aggregated?.totalHours ?? null,
          after: 0,
          invoiceId: invoice?._id || null,
          lockedMonthlyHours: invoice?.lockedMonthlyHours ?? null
        });
        results.summary.zeroed++;
      } catch (error) {
        results.failed.push({ teacherId: teacher._id, error: error.message });
        results.summary.failed++;
      }
    }

    // Audit the bulk operation
    await TeacherSalaryAudit.logAction({
      action: 'bulk_operation',
      entityType: 'System',
      actor: req.user._id,
      actorRole: 'admin',
      success: results.summary.failed === 0,
      metadata: { month, year, includeInactive, createInvoices: true, summary: results.summary }
    });

    res.json({ success: true, results });
  } catch (error) {
    console.error('[POST /admin/zero-monthly-hours] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== TEACHER ROUTES ====================

/**
 * Get teacher's own invoices
 * GET /api/teacher-salary/teacher/invoices
 */
router.get('/teacher/invoices', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const { year, month, status, search, page = 1, limit = 20 } = req.query;
    const visibleStatuses = TeacherSalaryService.getTeacherVisibleStatuses();

    let normalizedYear = year ? parseInt(year, 10) : undefined;
    let normalizedMonth = month ? parseInt(month, 10) : undefined;
    const rawMonth = month ? String(month) : '';
    if (rawMonth && rawMonth.includes('-')) {
      const [y, m] = rawMonth.split('-').map(v => parseInt(v, 10));
      if (Number.isFinite(y)) normalizedYear = y;
      if (Number.isFinite(m)) normalizedMonth = m;
    }
    const normalizedStatus = status && visibleStatuses.includes(status) ? status : undefined;
    const parsedLimit = parseInt(limit, 10);
    const paginationLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20;
    const parsedPage = parseInt(page, 10);
    const currentPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const paginationSkip = (currentPage - 1) * paginationLimit;

    const filters = {
      year: normalizedYear,
      month: normalizedMonth,
      status: normalizedStatus,
      search: search && String(search).trim() ? String(search).trim() : undefined,
      limit: paginationLimit,
      skip: paginationSkip
    };

    const invoices = await TeacherSalaryService.getTeacherInvoices(req.user._id, filters);

    const statusCriteria = normalizedStatus || { $in: visibleStatuses };

    const total = await TeacherInvoice.countDocuments({
      teacher: req.user._id,
      deleted: false,
      ...(normalizedYear && { year: normalizedYear }),
      ...(normalizedMonth && { month: normalizedMonth }),
      ...(filters.search && { invoiceNumber: new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }),
      status: statusCriteria
    });

    res.json({
      success: true,
      invoices,
      pagination: {
        page: currentPage,
        limit: paginationLimit,
        total,
        pages: Math.ceil(total / paginationLimit)
      }
    });
  } catch (error) {
    console.error('[GET /teacher/invoices] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get teacher's single invoice detail
 * GET /api/teacher-salary/teacher/invoices/:id
 */
router.get('/teacher/invoices/:id', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findById(req.params.id)
      .populate('teacher', 'firstName lastName email teacherInfo')
      .populate('bonuses.addedBy', 'firstName lastName')
      .populate('extras.addedBy', 'firstName lastName')
      .populate('bonuses.guardianId', 'firstName lastName')
      .populate({
        path: 'classIds',
        populate: [
          { path: 'student', select: 'firstName lastName' },
          { path: 'teacher', select: 'firstName lastName' }
        ]
      })
      .lean();

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Verify this teacher owns the invoice
    if (invoice.teacher._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const visibleStatuses = TeacherSalaryService.getTeacherVisibleStatuses();
    if (!visibleStatuses.includes(invoice.status)) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Format classes for frontend display
    const classes = (invoice.classIds || []).map(cls => ({
      _id: cls._id,
      date: cls.scheduledDate,
      studentName: cls.student ? `${cls.student.firstName} ${cls.student.lastName}` : 'N/A',
      teacherName: cls.teacher ? `${cls.teacher.firstName} ${cls.teacher.lastName}` : 'N/A',
      subject: cls.subject || '-',
      duration: cls.duration || 0,
      hours: (cls.duration || 0) / 60,
      status: cls.status || 'scheduled',
      rateUSD: invoice.rateSnapshot?.rate || 0
    }));

    res.json({ 
      success: true, 
      invoice: {
        ...invoice,
        classes
      }
    });
  } catch (error) {
    console.error('[GET /teacher/invoices/:id] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get teacher's YTD summary
 * GET /api/teacher-salary/teacher/ytd?year=2025
 */
router.get('/teacher/ytd', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

    const summary = await TeacherSalaryService.getTeacherYTDSummary(req.user._id, year);

    res.json({ success: true, summary });
  } catch (error) {
    console.error('[GET /teacher/ytd] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Download invoice PDF (teacher can download their own)
 * GET /api/teacher-salary/teacher/invoices/:id/pdf
 */
router.get('/teacher/invoices/:id/pdf', authenticateToken, requireTeacher, async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findById(req.params.id)
      .populate('teacher', 'firstName lastName email phone')
      .populate('publishedBy', 'firstName lastName');

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Verify this teacher owns the invoice
    if (invoice.teacher._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Only published or paid invoices can be downloaded
    if (invoice.status === 'draft') {
      return res.status(400).json({ error: 'Draft invoices cannot be downloaded' });
    }

    // Generate PDF
    const pdfDoc = teacherInvoicePDFService.generateInvoicePDF(invoice);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${invoice.invoiceNumber}.pdf"`);

    // Pipe PDF to response
    pdfDoc.pipe(res);
  } catch (error) {
    console.error('[GET /teacher/invoices/:id/pdf] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Download invoice PDF (admin can download any)
 * GET /api/teacher-salary/admin/invoices/:id/pdf
 */
router.get('/admin/invoices/:id/pdf', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findById(req.params.id)
      .populate('teacher', 'firstName lastName email phone')
      .populate('publishedBy', 'firstName lastName');

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Generate PDF
    const pdfDoc = teacherInvoicePDFService.generateInvoicePDF(invoice);

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${invoice.invoiceNumber}.pdf"`);

    // Pipe PDF to response
    pdfDoc.pipe(res);
  } catch (error) {
    console.error('[GET /admin/invoices/:id/pdf] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get invoice by share token (public access)
 * GET /api/teacher-salary/shared/:token
 */
router.get('/shared/:token', async (req, res) => {
  try {
    const invoice = await TeacherInvoice.findByShareToken(req.params.token);

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found or link expired' });
    }

    // Populate teacher info
    await invoice.populate('teacher', 'firstName lastName email');

    res.json({ success: true, invoice });
  } catch (error) {
    console.error('[GET /shared/:token] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================================================================================
// NOTIFICATION PREFERENCES
// ==================================================================================

/**
 * Get notification preferences for current user
 * GET /api/teacher-salary/notification-preferences
 */
router.get('/notification-preferences', authenticateToken, async (req, res) => {
  try {
    const notificationService = require('../services/notificationService');
    const preferences = await notificationService.getUserNotificationPreferences(req.user.userId);

    if (!preferences) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, preferences });
  } catch (error) {
    console.error('[GET /notification-preferences] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update notification preferences for current user
 * PUT /api/teacher-salary/notification-preferences
 * Body: {
 *   invoicePublished: { inApp: true, email: true },
 *   paymentReceived: { inApp: true, email: true },
 *   bonusAdded: { inApp: true, email: true }
 * }
 */
router.put('/notification-preferences', authenticateToken, async (req, res) => {
  try {
    const notificationService = require('../services/notificationService');
    const result = await notificationService.updateUserNotificationPreferences(
      req.user.userId,
      req.body
    );

    if (!result.success) {
      return res.status(400).json({ error: result.reason || 'Failed to update preferences' });
    }

    res.json({ 
      success: true, 
      preferences: result.preferences,
      message: 'Notification preferences updated successfully'
    });
  } catch (error) {
    console.error('[PUT /notification-preferences] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
