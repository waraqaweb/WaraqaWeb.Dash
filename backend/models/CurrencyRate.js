// backend/models/CurrencyRate.js
/**
 * CurrencyRate Model - Multi-source currency exchange rates
 * Supports fetching from multiple APIs and manual overrides
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// Currency rate snapshot from a specific source
const rateSourceSchema = new Schema({
  source: {
    type: String,
    required: true,
    enum: [
      'exchangerate-api',
      'fixer',
      'currencyapi',
      'manual',
      'system_default'
    ]
  },
  rate: { type: Number, required: true, min: 0 },
  fetchedAt: { type: Date, default: Date.now },
  reliability: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  }
}, { _id: false });

const currencyRateSchema = new Schema({
  // Base currency (e.g., USD)
  baseCurrency: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    length: 3
  },

  // Target currency (e.g., EGP, EUR, GBP)
  targetCurrency: {
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    length: 3
  },

  // Year and month for the rate
  year: { type: Number, required: true, min: 2000, max: 2100 },
  month: { type: Number, required: true, min: 1, max: 12 },

  // Multiple rate sources
  sources: [rateSourceSchema],

  // Selected/active rate (chosen from sources or manual)
  activeRate: {
    value: { type: Number, required: true, min: 0 },
    source: { type: String, required: true },
    selectedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    selectedAt: { type: Date, default: Date.now },
    note: { type: String, trim: true }
  },

  // Metadata
  lastUpdated: { type: Date, default: Date.now },
  autoUpdate: { type: Boolean, default: true }, // Auto-fetch from APIs
  updateFrequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly'],
    default: 'daily'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
currencyRateSchema.index({ baseCurrency: 1, targetCurrency: 1, year: 1, month: 1 }, { unique: true });
currencyRateSchema.index({ year: 1, month: 1 });
currencyRateSchema.index({ lastUpdated: 1 });

// Virtual: Period string
currencyRateSchema.virtual('period').get(function() {
  return `${this.year}-${String(this.month).padStart(2, '0')}`;
});

// Virtual: Average rate from all sources
currencyRateSchema.virtual('averageRate').get(function() {
  if (!this.sources || this.sources.length === 0) return this.activeRate.value;
  const sum = this.sources.reduce((acc, s) => acc + s.rate, 0);
  return sum / this.sources.length;
});

// Methods

/**
 * Add a rate source
 */
currencyRateSchema.methods.addSource = function(source, rate, reliability = 'medium') {
  // Check if source already exists
  const existingIndex = this.sources.findIndex(s => s.source === source);
  
  if (existingIndex >= 0) {
    // Update existing source
    this.sources[existingIndex].rate = rate;
    this.sources[existingIndex].fetchedAt = new Date();
    this.sources[existingIndex].reliability = reliability;
  } else {
    // Add new source
    this.sources.push({
      source,
      rate,
      fetchedAt: new Date(),
      reliability
    });
  }

  this.lastUpdated = new Date();
};

/**
 * Set active rate
 */
currencyRateSchema.methods.setActiveRate = function(value, source, userId, note) {
  this.activeRate = {
    value,
    source,
    selectedBy: userId,
    selectedAt: new Date(),
    note: note || ''
  };
  this.lastUpdated = new Date();
};

/**
 * Get recommended rate (highest reliability, most recent)
 */
currencyRateSchema.methods.getRecommendedRate = function() {
  if (!this.sources || this.sources.length === 0) {
    return {
      rate: this.activeRate?.value || 1,
      source: this.activeRate?.source || 'none'
    };
  }

  // Sort by reliability (high > medium > low) and recency
  const sorted = this.sources.slice().sort((a, b) => {
    const reliabilityOrder = { high: 3, medium: 2, low: 1 };
    const reliabilityDiff = reliabilityOrder[b.reliability] - reliabilityOrder[a.reliability];
    if (reliabilityDiff !== 0) return reliabilityDiff;
    return b.fetchedAt - a.fetchedAt;
  });

  return {
    rate: sorted[0].rate,
    source: sorted[0].source
  };
};

// Statics

/**
 * Get or create currency rate for a period
 */
currencyRateSchema.statics.getOrCreate = async function(baseCurrency, targetCurrency, year, month) {
  let rate = await this.findOne({ baseCurrency, targetCurrency, year, month });
  
  if (!rate) {
    rate = await this.create({
      baseCurrency,
      targetCurrency,
      year,
      month,
      sources: [],
      activeRate: {
        value: 1,
        source: 'system_default',
        selectedAt: new Date(),
        note: 'Default rate, please update'
      }
    });
  }

  return rate;
};

/**
 * Get active rate for conversion
 */
currencyRateSchema.statics.getActiveRate = async function(baseCurrency, targetCurrency, year, month) {
  const rate = await this.findOne({ baseCurrency, targetCurrency, year, month });
  
  if (!rate) {
    // Try to find most recent rate for this currency pair
    const recentRate = await this.findOne({ baseCurrency, targetCurrency })
      .sort({ year: -1, month: -1 })
      .limit(1);
    
    if (recentRate) {
      return recentRate.activeRate.value;
    }
    
    return 1; // Default fallback
  }

  return rate.activeRate.value;
};

const CurrencyRate = mongoose.model('CurrencyRate', currencyRateSchema);

module.exports = CurrencyRate;
