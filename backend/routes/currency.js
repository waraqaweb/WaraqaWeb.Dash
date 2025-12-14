// backend/routes/currency.js
/**
 * Currency Management Routes
 * Provides endpoints for multi-currency support
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');

const CurrencyService = require('../services/currencyService');
const CurrencyRate = require('../models/CurrencyRate');

/**
 * @route   GET /api/currency/supported
 * @desc    Get list of supported currencies
 * @access  Authenticated
 */
router.get('/supported', authenticateToken, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        currencies: CurrencyService.SUPPORTED_CURRENCIES,
        default: 'USD'
      }
    });
  } catch (error) {
    console.error('[GET /api/currency/supported] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get supported currencies',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/currency/rates/:year/:month
 * @desc    Get all currency rates for a period
 * @access  Admin only
 */
router.get('/rates/:year/:month', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { year, month } = req.params;

    const rates = await CurrencyService.getAllRatesForPeriod(
      parseInt(year),
      parseInt(month)
    );

    res.json({
      success: true,
      count: rates.length,
      data: rates
    });
  } catch (error) {
    console.error('[GET /api/currency/rates/:year/:month] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get currency rates',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/currency/rate/:base/:target/:year/:month
 * @desc    Get specific currency rate
 * @access  Authenticated
 */
router.get('/rate/:base/:target/:year/:month', authenticateToken, async (req, res) => {
  try {
    const { base, target, year, month } = req.params;

    const rate = await CurrencyRate.findOne({
      baseCurrency: base.toUpperCase(),
      targetCurrency: target.toUpperCase(),
      year: parseInt(year),
      month: parseInt(month)
    }).populate('activeRate.selectedBy', 'firstName lastName');

    if (!rate) {
      return res.status(404).json({
        success: false,
        message: `No rate found for ${base}/${target} in ${year}-${month}`
      });
    }

    res.json({
      success: true,
      data: rate
    });
  } catch (error) {
    console.error('[GET /api/currency/rate/:base/:target/:year/:month] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get currency rate',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/currency/rate/update
 * @desc    Update currency rate from APIs
 * @access  Admin only
 */
router.post('/rate/update', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { baseCurrency, targetCurrency, year, month } = req.body;

    if (!baseCurrency || !targetCurrency || !year || !month) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: baseCurrency, targetCurrency, year, month'
      });
    }

    const rate = await CurrencyService.updateCurrencyRate(
      baseCurrency.toUpperCase(),
      targetCurrency.toUpperCase(),
      parseInt(year),
      parseInt(month),
      req.user.id
    );

    res.json({
      success: true,
      message: `Currency rate updated for ${baseCurrency}/${targetCurrency}`,
      data: rate
    });
  } catch (error) {
    console.error('[POST /api/currency/rate/update] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update currency rate',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/currency/rate/set-active
 * @desc    Set active rate manually
 * @access  Admin only
 */
router.post('/rate/set-active', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { baseCurrency, targetCurrency, year, month, rate, source, note } = req.body;

    if (!baseCurrency || !targetCurrency || !year || !month || !rate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: baseCurrency, targetCurrency, year, month, rate'
      });
    }

    if (rate <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Rate must be greater than 0'
      });
    }

    let currencyRate = await CurrencyRate.getOrCreate(
      baseCurrency.toUpperCase(),
      targetCurrency.toUpperCase(),
      parseInt(year),
      parseInt(month)
    );

    currencyRate.setActiveRate(
      rate,
      source || 'manual',
      req.user.id,
      note
    );

    await currencyRate.save();

    res.json({
      success: true,
      message: `Active rate set to ${rate} for ${baseCurrency}/${targetCurrency}`,
      data: currencyRate
    });
  } catch (error) {
    console.error('[POST /api/currency/rate/set-active] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set active rate',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/currency/rates/bulk-update
 * @desc    Bulk update all currency rates for a period
 * @access  Admin only
 */
router.post('/rates/bulk-update', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { year, month } = req.body;

    if (!year || !month) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: year, month'
      });
    }

    const results = await CurrencyService.bulkUpdateRates(
      parseInt(year),
      parseInt(month),
      req.user.id
    );

    res.json({
      success: true,
      message: `Bulk update complete: ${results.success.length} succeeded, ${results.failed.length} failed`,
      data: results
    });
  } catch (error) {
    console.error('[POST /api/currency/rates/bulk-update] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bulk update rates',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/currency/convert
 * @desc    Convert amount between currencies
 * @access  Authenticated
 */
router.post('/convert', authenticateToken, async (req, res) => {
  try {
    const { amount, fromCurrency, toCurrency, year, month } = req.body;

    if (!amount || !fromCurrency || !toCurrency || !year || !month) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: amount, fromCurrency, toCurrency, year, month'
      });
    }

    const convertedAmount = await CurrencyService.convertAmount(
      parseFloat(amount),
      fromCurrency.toUpperCase(),
      toCurrency.toUpperCase(),
      parseInt(year),
      parseInt(month)
    );

    const rate = await CurrencyService.getConversionRate(
      fromCurrency.toUpperCase(),
      toCurrency.toUpperCase(),
      parseInt(year),
      parseInt(month)
    );

    res.json({
      success: true,
      data: {
        originalAmount: parseFloat(amount),
        fromCurrency: fromCurrency.toUpperCase(),
        toCurrency: toCurrency.toUpperCase(),
        rate,
        convertedAmount: Math.round(convertedAmount * 100) / 100,
        period: `${year}-${String(month).padStart(2, '0')}`
      }
    });
  } catch (error) {
    console.error('[POST /api/currency/convert] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to convert currency',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/currency/teacher/:teacherId/preference
 * @desc    Get teacher currency preference
 * @access  Admin or teacher (own data)
 */
router.get('/teacher/:teacherId/preference', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;

    // Authorization: admin or teacher viewing own data
    if (req.user.role !== 'admin' && req.user.id !== teacherId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this data'
      });
    }

    const currency = await CurrencyService.getTeacherCurrencyPreference(teacherId);

    res.json({
      success: true,
      data: {
        teacherId,
        currency
      }
    });
  } catch (error) {
    console.error('[GET /api/currency/teacher/:teacherId/preference] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get currency preference',
      error: error.message
    });
  }
});

/**
 * @route   PUT /api/currency/teacher/:teacherId/preference
 * @desc    Set teacher currency preference
 * @access  Admin or teacher (own data)
 */
router.put('/teacher/:teacherId/preference', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { currency } = req.body;

    // Authorization: admin or teacher updating own data
    if (req.user.role !== 'admin' && req.user.id !== teacherId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this data'
      });
    }

    if (!currency) {
      return res.status(400).json({
        success: false,
        message: 'Currency is required'
      });
    }

    const user = await CurrencyService.setTeacherCurrencyPreference(
      teacherId,
      currency.toUpperCase()
    );

    res.json({
      success: true,
      message: `Currency preference updated to ${currency.toUpperCase()}`,
      data: {
        teacherId: user._id,
        currency: user.teacherInfo.preferredCurrency
      }
    });
  } catch (error) {
    console.error('[PUT /api/currency/teacher/:teacherId/preference] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update currency preference',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/currency/report/:year/:month
 * @desc    Get cross-currency report
 * @access  Admin only
 */
router.get('/report/:year/:month', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const { year, month } = req.params;

    const report = await CurrencyService.getCrossCurrencyReport(
      parseInt(year),
      parseInt(month)
    );

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('[GET /api/currency/report/:year/:month] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate cross-currency report',
      error: error.message
    });
  }
});

module.exports = router;
