// backend/models/MonthlyExchangeRates.js
/**
 * MonthlyExchangeRates Model - Stores USD to EGP exchange rates per month
 * Admin sets one rate per month before invoice generation
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const monthlyExchangeRatesSchema = new Schema({
  // Month and Year
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2020, max: 2100 },

  // Exchange Rate (EGP per USD)
  rate: { 
    type: Number, 
    required: true, 
    min: 0.01,
    validate: {
      validator: function(v) {
        return v > 0 && v < 1000; // Reasonable bounds
      },
      message: 'Exchange rate must be between 0.01 and 1000'
    }
  },

  // Source/Notes
  source: { 
    type: String, 
    trim: true,
    default: 'Manual Entry' 
  }, // e.g., "Central Bank", "Market Rate", "Manual Entry"
  
  notes: { type: String, trim: true, maxlength: 500 },

  // Metadata
  setBy: { type: Schema.Types.ObjectId, ref: 'User' }, // Optional - system initialization may not have user
  setAt: { type: Date, default: Date.now },
  
  // Lock flag - prevents modification after invoices generated
  locked: { type: Boolean, default: false },
  lockedAt: { type: Date },
  lockedBy: { type: Schema.Types.ObjectId, ref: 'User' },

  // Modification history
  modificationHistory: [{
    modifiedAt: { type: Date, default: Date.now },
    modifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    oldRate: { type: Number },
    newRate: { type: Number },
    reason: { type: String, trim: true }
  }]
}, {
  timestamps: true
});

// Compound unique index
monthlyExchangeRatesSchema.index({ month: 1, year: 1 }, { unique: true });

// Indexes
monthlyExchangeRatesSchema.index({ year: 1, month: 1 });
monthlyExchangeRatesSchema.index({ setAt: -1 });

// Methods

/**
 * Lock the rate (prevent modifications)
 */
monthlyExchangeRatesSchema.methods.lock = function(userId) {
  if (this.locked) {
    throw new Error('Rate is already locked');
  }

  this.locked = true;
  this.lockedAt = new Date();
  this.lockedBy = userId;

  return this.save();
};

/**
 * Unlock the rate (allow modifications)
 */
monthlyExchangeRatesSchema.methods.unlock = function(userId) {
  if (!this.locked) {
    throw new Error('Rate is not locked');
  }

  this.locked = false;
  this.lockedAt = null;
  this.lockedBy = null;

  return this.save();
};

/**
 * Update rate
 */
monthlyExchangeRatesSchema.methods.updateRate = function(newRate, userId, reason = '') {
  if (this.locked) {
    throw new Error('Cannot update locked rate. Unlock first or create a new entry.');
  }

  const oldRate = this.rate;
  this.rate = newRate;

  // Record modification
  this.modificationHistory.push({
    modifiedAt: new Date(),
    modifiedBy: userId,
    oldRate,
    newRate,
    reason
  });

  return this.save();
};

// Static methods

/**
 * Get rate for a specific month/year
 */
monthlyExchangeRatesSchema.statics.getRateForMonth = async function(month, year) {
  const record = await this.findOne({ month, year });
  return record; // Return the full record, or null if not found
};

/**
 * Get or create rate for month
 */
monthlyExchangeRatesSchema.statics.getOrCreateRate = async function(month, year, defaultRate, userId) {
  let record = await this.findOne({ month, year });
  
  if (!record) {
    record = await this.create({
      month,
      year,
      rate: defaultRate || 50,
      source: 'System Default',
      setBy: userId,
      notes: 'Auto-created with default rate'
    });
  }

  return record;
};

/**
 * Set rate for month
 */
monthlyExchangeRatesSchema.statics.setRateForMonth = async function(month, year, rate, userId = null, source = 'Manual Entry', notes = '') {
  // Check if exists
  let record = await this.findOne({ month, year });

  if (record) {
    // Update existing
    if (record.locked) {
      throw new Error(`Exchange rate for ${year}-${String(month).padStart(2, '0')} is locked`);
    }
    
    const oldRate = record.rate;
    record.rate = rate;
    record.source = source;
    record.notes = notes;
    if (userId) record.setBy = userId; // Only set if userId provided
    record.setAt = new Date();

    record.modificationHistory.push({
      modifiedAt: new Date(),
      modifiedBy: userId || null,
      oldRate,
      newRate: rate,
      reason: notes || 'Rate updated'
    });

    await record.save();
  } else {
    // Create new
    const data = {
      month,
      year,
      rate,
      source,
      notes
    };
    if (userId) data.setBy = userId; // Only add setBy if userId provided
    record = await this.create(data);
  }

  return record;
};

/**
 * Get all rates for a year
 */
monthlyExchangeRatesSchema.statics.getRatesForYear = function(year) {
  return this.find({ year }).sort({ month: 1 });
};

/**
 * Get latest rate
 */
monthlyExchangeRatesSchema.statics.getLatestRate = async function() {
  const record = await this.findOne().sort({ year: -1, month: -1 });
  return record ? record.rate : null;
};

/**
 * Check if rate exists for month
 */
monthlyExchangeRatesSchema.statics.hasRateForMonth = async function(month, year) {
  const count = await this.countDocuments({ month, year });
  return count > 0;
};

/**
 * Get missing months in a year
 */
monthlyExchangeRatesSchema.statics.getMissingMonthsForYear = async function(year) {
  const existingRecords = await this.find({ year }).select('month');
  const existingMonths = new Set(existingRecords.map(r => r.month));
  
  const missingMonths = [];
  for (let month = 1; month <= 12; month++) {
    if (!existingMonths.has(month)) {
      missingMonths.push(month);
    }
  }

  return missingMonths;
};

/**
 * Bulk set rates for multiple months
 */
monthlyExchangeRatesSchema.statics.bulkSetRates = async function(ratesData, userId) {
  const results = [];
  const errors = [];

  for (const data of ratesData) {
    try {
      const record = await this.setRateForMonth(
        data.month,
        data.year,
        data.rate,
        userId,
        data.source || 'Bulk Import',
        data.notes || ''
      );
      results.push(record);
    } catch (err) {
      errors.push({
        month: data.month,
        year: data.year,
        error: err.message
      });
    }
  }

  return { results, errors };
};

const MonthlyExchangeRates = mongoose.model('MonthlyExchangeRates', monthlyExchangeRatesSchema);

module.exports = MonthlyExchangeRates;
