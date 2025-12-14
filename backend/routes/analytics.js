// backend/routes/analytics.js
/**
 * Analytics & Reporting Routes for Teacher Salary System
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const AnalyticsService = require('../services/analyticsService');

/**
 * @route   GET /api/analytics/dashboard
 * @desc    Get admin dashboard statistics
 * @access  Admin only
 */
router.get('/dashboard', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { year, startMonth, endMonth } = req.query;
    
    const options = {};
    if (year) options.year = parseInt(year);
    if (startMonth) options.startMonth = parseInt(startMonth);
    if (endMonth) options.endMonth = parseInt(endMonth);

    const stats = await AnalyticsService.getDashboardStats(options);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('[GET /api/analytics/dashboard] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard statistics',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/teacher/:teacherId/trends
 * @desc    Get teacher earning trends
 * @access  Admin or teacher (own data only)
 */
router.get('/teacher/:teacherId/trends', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { startYear, endYear } = req.query;

    // Authorization: admin or teacher viewing own data
    if (req.user.role !== 'admin' && req.user.id !== teacherId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this data'
      });
    }

    const options = {};
    if (startYear) options.startYear = parseInt(startYear);
    if (endYear) options.endYear = parseInt(endYear);

    const trends = await AnalyticsService.getTeacherEarningTrends(teacherId, options);

    res.json({
      success: true,
      data: trends
    });
  } catch (error) {
    console.error('[GET /api/analytics/teacher/:teacherId/trends] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get teacher trends',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/payment-history
 * @desc    Get payment history report
 * @access  Admin only
 */
router.get('/payment-history', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate, teacherId, status } = req.query;

    const options = {};
    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;
    if (teacherId) options.teacherId = teacherId;
    if (status) options.status = status;

    const history = await AnalyticsService.getPaymentHistory(options);

    res.json({
      success: true,
      data: history
    });
  } catch (error) {
    console.error('[GET /api/analytics/payment-history] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get payment history',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/forecast
 * @desc    Get financial forecast
 * @access  Admin only
 */
router.get('/forecast', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { months } = req.query;

    const options = {};
    if (months) options.months = parseInt(months);

    const forecast = await AnalyticsService.getFinancialForecast(options);

    res.json({
      success: true,
      data: forecast
    });
  } catch (error) {
    console.error('[GET /api/analytics/forecast] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get financial forecast',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/export/:type
 * @desc    Export data to Excel
 * @access  Admin only
 * @params  type: 'invoices', 'payments', 'teachers', 'dashboard'
 */
router.get('/export/:type', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { type } = req.params;
    const allowedTypes = ['invoices', 'payments', 'teachers', 'dashboard'];

    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid export type. Allowed: ${allowedTypes.join(', ')}`
      });
    }

    // Get filter options from query
    const options = {};
    if (req.query.year) options.year = parseInt(req.query.year);
    if (req.query.month) options.month = parseInt(req.query.month);
    if (req.query.startMonth) options.startMonth = parseInt(req.query.startMonth);
    if (req.query.endMonth) options.endMonth = parseInt(req.query.endMonth);
    if (req.query.status) options.status = req.query.status;
    if (req.query.teacherId) options.teacherId = req.query.teacherId;

    const buffer = await AnalyticsService.exportToExcel(type, options);

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `waraqa_${type}_${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('[GET /api/analytics/export/:type] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export data',
      error: error.message
    });
  }
});

module.exports = router;
