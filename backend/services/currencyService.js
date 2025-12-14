// backend/services/currencyService.js
/**
 * Currency Service for Multi-Currency Support
 * Handles currency conversions, rate fetching, and preferences
 */

const axios = require('axios');
const CurrencyRate = require('../models/CurrencyRate');
const User = require('../models/User');

class CurrencyService {
  /**
   * Supported currencies
   */
  static SUPPORTED_CURRENCIES = ['USD', 'EGP', 'EUR', 'GBP', 'SAR', 'AED', 'QAR'];

  /**
   * Fetch rates from ExchangeRate-API
   * @param {String} baseCurrency - Base currency code
   * @param {String} targetCurrency - Target currency code
   * @returns {Promise<Number>} Exchange rate
   */
  static async fetchFromExchangeRateAPI(baseCurrency, targetCurrency) {
    try {
      // Free tier: https://api.exchangerate-api.com/v4/latest/{base}
      const url = `https://api.exchangerate-api.com/v4/latest/${baseCurrency}`;
      const response = await axios.get(url, { timeout: 5000 });
      
      if (response.data && response.data.rates && response.data.rates[targetCurrency]) {
        return {
          rate: response.data.rates[targetCurrency],
          reliability: 'high'
        };
      }

      throw new Error(`Rate for ${targetCurrency} not found in response`);
    } catch (error) {
      console.error('[fetchFromExchangeRateAPI] Error:', error.message);
      return null;
    }
  }

  /**
   * Fetch rates from Fixer.io (backup source)
   * @param {String} baseCurrency - Base currency code
   * @param {String} targetCurrency - Target currency code
   * @returns {Promise<Number>} Exchange rate
   */
  static async fetchFromFixer(baseCurrency, targetCurrency) {
    try {
      // Note: Fixer.io requires API key for production
      // Using free tier endpoint for demonstration
      const apiKey = process.env.FIXER_API_KEY || 'demo';
      const url = `http://data.fixer.io/api/latest?access_key=${apiKey}&base=${baseCurrency}&symbols=${targetCurrency}`;
      
      if (apiKey === 'demo') {
        // Skip if no API key configured
        return null;
      }

      const response = await axios.get(url, { timeout: 5000 });
      
      if (response.data && response.data.rates && response.data.rates[targetCurrency]) {
        return {
          rate: response.data.rates[targetCurrency],
          reliability: 'medium'
        };
      }

      return null;
    } catch (error) {
      console.error('[fetchFromFixer] Error:', error.message);
      return null;
    }
  }

  /**
   * Fetch rates from CurrencyAPI (backup source)
   * @param {String} baseCurrency - Base currency code
   * @param {String} targetCurrency - Target currency code
   * @returns {Promise<Number>} Exchange rate
   */
  static async fetchFromCurrencyAPI(baseCurrency, targetCurrency) {
    try {
      // Note: CurrencyAPI requires API key
      const apiKey = process.env.CURRENCYAPI_KEY || 'demo';
      
      if (apiKey === 'demo') {
        // Skip if no API key configured
        return null;
      }

      const url = `https://api.currencyapi.com/v3/latest?apikey=${apiKey}&base_currency=${baseCurrency}&currencies=${targetCurrency}`;
      const response = await axios.get(url, { timeout: 5000 });
      
      if (response.data && response.data.data && response.data.data[targetCurrency]) {
        return {
          rate: response.data.data[targetCurrency].value,
          reliability: 'medium'
        };
      }

      return null;
    } catch (error) {
      console.error('[fetchFromCurrencyAPI] Error:', error.message);
      return null;
    }
  }

  /**
   * Fetch rates from multiple sources
   * @param {String} baseCurrency - Base currency code
   * @param {String} targetCurrency - Target currency code
   * @returns {Promise<Array>} Array of rate sources
   */
  static async fetchFromMultipleSources(baseCurrency, targetCurrency) {
    const sources = [];

    // Fetch from all sources in parallel
    const [exchangeRateAPI, fixer, currencyAPI] = await Promise.all([
      this.fetchFromExchangeRateAPI(baseCurrency, targetCurrency),
      this.fetchFromFixer(baseCurrency, targetCurrency),
      this.fetchFromCurrencyAPI(baseCurrency, targetCurrency)
    ]);

    if (exchangeRateAPI) {
      sources.push({
        source: 'exchangerate-api',
        rate: exchangeRateAPI.rate,
        reliability: exchangeRateAPI.reliability
      });
    }

    if (fixer) {
      sources.push({
        source: 'fixer',
        rate: fixer.rate,
        reliability: fixer.reliability
      });
    }

    if (currencyAPI) {
      sources.push({
        source: 'currencyapi',
        rate: currencyAPI.rate,
        reliability: currencyAPI.reliability
      });
    }

    return sources;
  }

  /**
   * Update currency rate for a specific period
   * @param {String} baseCurrency - Base currency code
   * @param {String} targetCurrency - Target currency code
   * @param {Number} year - Year
   * @param {Number} month - Month
   * @param {String} userId - User ID (for audit)
   * @returns {Promise<Object>} Updated currency rate
   */
  static async updateCurrencyRate(baseCurrency, targetCurrency, year, month, userId) {
    try {
      // Get or create the rate document
      let currencyRate = await CurrencyRate.getOrCreate(baseCurrency, targetCurrency, year, month);

      // Fetch from multiple sources
      const sources = await this.fetchFromMultipleSources(baseCurrency, targetCurrency);

      if (sources.length === 0) {
        throw new Error('Failed to fetch rates from any source');
      }

      // Add all sources to the document
      sources.forEach(sourceData => {
        currencyRate.addSource(sourceData.source, sourceData.rate, sourceData.reliability);
      });

      // Set active rate to the recommended rate
      const recommended = currencyRate.getRecommendedRate();
      currencyRate.setActiveRate(recommended.rate, recommended.source, userId, 'Auto-updated from API');

      await currencyRate.save();

      return currencyRate;
    } catch (error) {
      console.error('[updateCurrencyRate] Error:', error);
      throw error;
    }
  }

  /**
   * Get conversion rate
   * @param {String} fromCurrency - From currency code
   * @param {String} toCurrency - To currency code
   * @param {Number} year - Year
   * @param {Number} month - Month
   * @returns {Promise<Number>} Conversion rate
   */
  static async getConversionRate(fromCurrency, toCurrency, year, month) {
    try {
      if (fromCurrency === toCurrency) {
        return 1;
      }

      const rate = await CurrencyRate.getActiveRate(fromCurrency, toCurrency, year, month);
      return rate;
    } catch (error) {
      console.error('[getConversionRate] Error:', error);
      return 1; // Fallback to 1:1
    }
  }

  /**
   * Convert amount between currencies
   * @param {Number} amount - Amount to convert
   * @param {String} fromCurrency - From currency code
   * @param {String} toCurrency - To currency code
   * @param {Number} year - Year
   * @param {Number} month - Month
   * @returns {Promise<Number>} Converted amount
   */
  static async convertAmount(amount, fromCurrency, toCurrency, year, month) {
    try {
      const rate = await this.getConversionRate(fromCurrency, toCurrency, year, month);
      return amount * rate;
    } catch (error) {
      console.error('[convertAmount] Error:', error);
      return amount; // Return original amount on error
    }
  }

  /**
   * Set teacher currency preference
   * @param {String} teacherId - Teacher ID
   * @param {String} currency - Currency code
   * @returns {Promise<Object>} Updated user
   */
  static async setTeacherCurrencyPreference(teacherId, currency) {
    try {
      if (!this.SUPPORTED_CURRENCIES.includes(currency)) {
        throw new Error(`Currency ${currency} is not supported`);
      }

      const user = await User.findById(teacherId);

      if (!user) {
        throw new Error('Teacher not found');
      }

      if (!user.teacherInfo) {
        user.teacherInfo = {};
      }

      user.teacherInfo.preferredCurrency = currency;
      user.markModified('teacherInfo'); // Mark nested object as modified
      await user.save();

      return user;
    } catch (error) {
      console.error('[setTeacherCurrencyPreference] Error:', error);
      throw error;
    }
  }

  /**
   * Get teacher currency preference
   * @param {String} teacherId - Teacher ID
   * @returns {Promise<String>} Currency code
   */
  static async getTeacherCurrencyPreference(teacherId) {
    try {
      const user = await User.findById(teacherId);

      if (!user || !user.teacherInfo) {
        return 'USD'; // Default
      }

      return user.teacherInfo.preferredCurrency || 'USD';
    } catch (error) {
      console.error('[getTeacherCurrencyPreference] Error:', error);
      return 'USD'; // Default fallback
    }
  }

  /**
   * Get all available rates for a period
   * @param {Number} year - Year
   * @param {Number} month - Month
   * @returns {Promise<Array>} Array of currency rates
   */
  static async getAllRatesForPeriod(year, month) {
    try {
      const rates = await CurrencyRate.find({ year, month })
        .sort({ baseCurrency: 1, targetCurrency: 1 });

      return rates;
    } catch (error) {
      console.error('[getAllRatesForPeriod] Error:', error);
      return [];
    }
  }

  /**
   * Bulk update all configured currency rates
   * @param {Number} year - Year
   * @param {Number} month - Month
   * @param {String} userId - User ID (for audit)
   * @returns {Promise<Object>} Update summary
   */
  static async bulkUpdateRates(year, month, userId) {
    try {
      const baseCurrency = 'USD';
      const targetCurrencies = this.SUPPORTED_CURRENCIES.filter(c => c !== baseCurrency);

      const results = {
        success: [],
        failed: []
      };

      for (const targetCurrency of targetCurrencies) {
        try {
          const rate = await this.updateCurrencyRate(baseCurrency, targetCurrency, year, month, userId);
          results.success.push({
            pair: `${baseCurrency}/${targetCurrency}`,
            rate: rate.activeRate.value
          });
        } catch (error) {
          results.failed.push({
            pair: `${baseCurrency}/${targetCurrency}`,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error('[bulkUpdateRates] Error:', error);
      throw error;
    }
  }

  /**
   * Get cross-currency report
   * @param {Number} year - Year
   * @param {Number} month - Month
   * @returns {Promise<Object>} Cross-currency report
   */
  static async getCrossCurrencyReport(year, month) {
    try {
      const rates = await this.getAllRatesForPeriod(year, month);

      const report = {
        period: `${year}-${String(month).padStart(2, '0')}`,
        baseCurrency: 'USD',
        rates: {},
        summary: {
          totalPairs: rates.length,
          lastUpdated: rates.length > 0 ? rates[0].lastUpdated : null
        }
      };

      rates.forEach(rate => {
        if (rate.baseCurrency === 'USD') {
          report.rates[rate.targetCurrency] = {
            rate: rate.activeRate.value,
            source: rate.activeRate.source,
            sources: rate.sources.length,
            averageRate: rate.averageRate,
            variance: rate.sources.length > 0 ? 
              Math.abs(rate.activeRate.value - rate.averageRate) / rate.activeRate.value * 100 : 0
          };
        }
      });

      return report;
    } catch (error) {
      console.error('[getCrossCurrencyReport] Error:', error);
      throw error;
    }
  }
}

module.exports = CurrencyService;
