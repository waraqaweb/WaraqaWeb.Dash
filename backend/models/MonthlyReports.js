// backend/models/MonthlyReports.js
/**
 * MonthlyReports Model - Cached report snapshots for performance
 * Pre-calculated financial summaries to avoid heavy aggregations
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const monthlyReportsSchema = new Schema({
  // Report Period
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2020, max: 2100 },
  reportType: {
    type: String,
    required: true,
    enum: ['financial_summary', 'teacher_earnings', 'system_stats']
  },

  // Financial Summary Fields
  totalTeachers: { type: Number, default: 0 },
  totalInvoices: { type: Number, default: 0 },
  totalHours: { type: Number, default: 0 },
  totalAmountUSD: { type: Number, default: 0 },
  totalAmountEGP: { type: Number, default: 0 },
  totalPaidEGP: { type: Number, default: 0 },
  totalPendingEGP: { type: Number, default: 0 },
  avgHoursPerTeacher: { type: Number, default: 0 },
  avgEarningsPerTeacher: { type: Number, default: 0 },

  // Breakdown by Status
  invoicesByStatus: {
    draft: { type: Number, default: 0 },
    published: { type: Number, default: 0 },
    paid: { type: Number, default: 0 },
    archived: { type: Number, default: 0 }
  },

  // Rate Distribution
  rateDistribution: [{
    partition: { type: String },
    teacherCount: { type: Number },
    totalHours: { type: Number },
    totalAmount: { type: Number }
  }],

  // Top Earners (anonymized)
  topEarners: [{
    teacherId: { type: Schema.Types.ObjectId, ref: 'User' },
    hours: { type: Number },
    earnings: { type: Number }
  }],

  // Monthly Trends
  comparisonToPreviousMonth: {
    hoursChange: { type: Number }, // percentage
    earningsChange: { type: Number }, // percentage
    teachersChange: { type: Number } // absolute
  },

  // Cache Metadata
  generatedAt: { type: Date, default: Date.now, index: true },
  generatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  expiresAt: { type: Date, index: true }, // TTL for automatic cleanup
  isStale: { type: Boolean, default: false },

  // Raw Data (for detailed drill-downs)
  rawData: { type: Schema.Types.Mixed }
}, {
  timestamps: true
});

// Compound unique index
monthlyReportsSchema.index({ month: 1, year: 1, reportType: 1 }, { unique: true });

// TTL index for automatic expiration
monthlyReportsSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Methods

/**
 * Mark report as stale
 */
monthlyReportsSchema.methods.markAsStale = function() {
  this.isStale = true;
  return this.save();
};

/**
 * Refresh report (regenerate data)
 */
monthlyReportsSchema.methods.refresh = async function() {
  // This will be implemented by the report service
  // Placeholder for now
  this.generatedAt = new Date();
  this.isStale = false;
  
  // Set expiration to 24 hours from now
  const expirationDate = new Date();
  expirationDate.setHours(expirationDate.getHours() + 24);
  this.expiresAt = expirationDate;

  return this.save();
};

// Static methods

/**
 * Get or generate report
 */
monthlyReportsSchema.statics.getOrGenerateReport = async function(month, year, reportType, generateFn, userId = null) {
  // Try to find existing report
  let report = await this.findOne({ month, year, reportType });

  // Check if report is stale or expired
  const now = new Date();
  const isExpired = report && report.expiresAt && report.expiresAt < now;

  if (!report || report.isStale || isExpired) {
    // Generate new report
    const data = await generateFn(month, year);

    if (report) {
      // Update existing
      Object.assign(report, data);
      report.generatedAt = now;
      report.generatedBy = userId;
      report.isStale = false;
      
      // Set expiration to 24 hours from now
      const expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() + 24);
      report.expiresAt = expirationDate;

      await report.save();
    } else {
      // Create new
      const expirationDate = new Date();
      expirationDate.setHours(expirationDate.getHours() + 24);

      report = await this.create({
        month,
        year,
        reportType,
        ...data,
        generatedAt: now,
        generatedBy: userId,
        expiresAt: expirationDate,
        isStale: false
      });
    }
  }

  return report;
};

/**
 * Invalidate all reports for a month
 */
monthlyReportsSchema.statics.invalidateMonth = async function(month, year) {
  const result = await this.updateMany(
    { month, year },
    { $set: { isStale: true } }
  );

  return result;
};

/**
 * Invalidate all reports
 */
monthlyReportsSchema.statics.invalidateAll = async function() {
  const result = await this.updateMany(
    {},
    { $set: { isStale: true } }
  );

  return result;
};

/**
 * Get all reports for a year
 */
monthlyReportsSchema.statics.getYearReports = function(year, reportType) {
  return this.find({ year, reportType })
    .sort({ month: 1 });
};

/**
 * Get latest report
 */
monthlyReportsSchema.statics.getLatestReport = function(reportType) {
  return this.findOne({ reportType })
    .sort({ year: -1, month: -1 });
};

/**
 * Delete old reports
 */
monthlyReportsSchema.statics.deleteOldReports = async function(beforeDate) {
  const result = await this.deleteMany({
    generatedAt: { $lt: new Date(beforeDate) }
  });

  return result;
};

/**
 * Get cache statistics
 */
monthlyReportsSchema.statics.getCacheStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$reportType',
        total: { $sum: 1 },
        stale: {
          $sum: { $cond: ['$isStale', 1, 0] }
        },
        fresh: {
          $sum: { $cond: ['$isStale', 0, 1] }
        }
      }
    }
  ]);

  return stats;
};

const MonthlyReports = mongoose.model('MonthlyReports', monthlyReportsSchema);

module.exports = MonthlyReports;
