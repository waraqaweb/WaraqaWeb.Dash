// backend/models/SalarySettings.js
/**
 * SalarySettings Model - Global salary system configuration
 * Stores rate partitions, default transfer fees, and system-wide settings
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// Rate partition schema
const ratePartitionSchema = new Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    unique: true 
  }, // e.g., "0-50h", "51-100h", "101-200h", "200+h"
  minHours: { type: Number, required: true, min: 0 },
  maxHours: { type: Number, required: true, min: 0 }, // Use Infinity for open-ended
  rateUSD: { type: Number, required: true, min: 0 }, // USD per hour
  description: { type: String, trim: true, maxlength: 200 },
  isActive: { type: Boolean, default: true }
}, { _id: true });

// Change history entry
const changeHistoryEntrySchema = new Schema({
  changedAt: { type: Date, default: Date.now },
  changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  field: { type: String, required: true, trim: true },
  oldValue: { type: Schema.Types.Mixed },
  newValue: { type: Schema.Types.Mixed },
  affectedInvoices: { 
    type: Number, 
    default: 0 
  }, // Count of invoices updated
  note: { type: String, trim: true }
}, { _id: true });

// Main Salary Settings Schema
const salarySettingsSchema = new Schema({
  // Singleton pattern - only one document should exist
  _id: { 
    type: String, 
    default: 'global',
    immutable: true 
  },

  // Rate System
  rateModel: {
    type: String,
    enum: ['flat', 'progressive'],
    default: 'progressive',
    required: true
  },
  ratePartitions: [ratePartitionSchema],

  // Default Transfer Fee
  defaultTransferFee: {
    model: { 
      type: String, 
      enum: ['flat', 'percentage', 'none'],
      default: 'flat'
    },
    value: { type: Number, default: 50, min: 0 } // 50 EGP or 3%
  },

  // Default Payment Method
  defaultPaymentMethod: {
    type: String,
    enum: ['bank_transfer', 'cash', 'vodafone_cash', 'instapay', 'other'],
    default: 'bank_transfer'
  },

  // Invoice Generation Settings
  autoGenerateInvoices: { type: Boolean, default: true },
  generationDay: { type: Number, default: 1, min: 1, max: 28 }, // Day of month
  generationTime: { type: String, default: '00:05' }, // UTC time "HH:MM"

  // Notification Settings
  notifyTeachersOnPublish: { type: Boolean, default: true },
  notifyTeachersOnPayment: { type: Boolean, default: true },
  notifyAdminsOnGeneration: { type: Boolean, default: true },

  // Change History
  changeHistory: [changeHistoryEntrySchema],

  // Metadata
  lastModifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  lastModifiedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
salarySettingsSchema.index({ 'partitions.name': 1 });

// Methods

/**
 * Get rate for a given number of hours
 */
salarySettingsSchema.methods.getRateForHours = function(hours) {
  if (!this.ratePartitions || this.ratePartitions.length === 0) {
    return 0;
  }

  // Sort partitions by minHours
  const sorted = this.ratePartitions
    .filter(p => p.isActive)
    .sort((a, b) => a.minHours - b.minHours);

  if (this.rateModel === 'flat') {
    // Flat rate: find the partition that contains the hours
    for (const partition of sorted) {
      if (hours >= partition.minHours && hours <= partition.maxHours) {
        return partition.rateUSD;
      }
    }
    // If no match, return the highest tier rate
    return sorted[sorted.length - 1]?.rateUSD || 0;
  } else {
    // Progressive rate: calculate weighted average (not implemented in this version)
    // For now, return flat rate
    for (const partition of sorted) {
      if (hours >= partition.minHours && hours <= partition.maxHours) {
        return partition.rateUSD;
      }
    }
    return sorted[sorted.length - 1]?.rateUSD || 0;
  }
};

/**
 * Get partition name for hours
 */
salarySettingsSchema.methods.getPartitionForHours = function(hours) {
  if (!this.ratePartitions || this.ratePartitions.length === 0) {
    return null;
  }

  const sorted = this.ratePartitions
    .filter(p => p.isActive)
    .sort((a, b) => a.minHours - b.minHours);

  for (const partition of sorted) {
    if (hours >= partition.minHours && hours <= partition.maxHours) {
      return partition.name;
    }
  }

  return sorted[sorted.length - 1]?.name || null;
};

/**
 * Update rate partition
 */
salarySettingsSchema.methods.updatePartition = function(partitionName, newRate, userId, applyToDrafts = false) {
  const partition = this.ratePartitions.find(p => p.name === partitionName);
  if (!partition) {
    throw new Error(`Partition ${partitionName} not found`);
  }

  const oldRate = partition.rateUSD;
  partition.rateUSD = newRate;

  // Record change
  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    field: `ratePartitions.${partitionName}.rateUSD`,
    oldValue: oldRate,
    newValue: newRate,
    note: applyToDrafts ? 'Rate updated, applied to draft invoices' : 'Rate updated, drafts unchanged'
  });

  this.lastModifiedBy = userId;
  this.lastModifiedAt = new Date();

  return { partition, oldRate, newRate, applyToDrafts };
};

/**
 * Add new partition
 */
salarySettingsSchema.methods.addPartition = function(partitionData, userId) {
  // Validate no overlap
  const overlap = this.ratePartitions.find(p => 
    p.isActive &&
    !(partitionData.maxHours < p.minHours || partitionData.minHours > p.maxHours)
  );

  if (overlap) {
    throw new Error(`Partition overlaps with existing partition ${overlap.name}`);
  }

  this.ratePartitions.push({
    name: partitionData.name,
    minHours: partitionData.minHours,
    maxHours: partitionData.maxHours,
    rateUSD: partitionData.rateUSD,
    description: partitionData.description || '',
    isActive: true
  });

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    field: 'ratePartitions',
    newValue: partitionData,
    note: `Partition ${partitionData.name} added`
  });

  this.lastModifiedBy = userId;
  this.lastModifiedAt = new Date();
};

/**
 * Remove partition
 */
salarySettingsSchema.methods.removePartition = function(partitionName, userId) {
  const index = this.ratePartitions.findIndex(p => p.name === partitionName);
  if (index === -1) {
    throw new Error(`Partition ${partitionName} not found`);
  }

  const removed = this.ratePartitions.splice(index, 1)[0];

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    field: 'ratePartitions',
    oldValue: removed,
    note: `Partition ${partitionName} removed`
  });

  this.lastModifiedBy = userId;
  this.lastModifiedAt = new Date();
};

/**
 * Update default transfer fee
 */
salarySettingsSchema.methods.updateDefaultTransferFee = function(model, value, userId) {
  const oldValue = { ...this.defaultTransferFee };
  
  this.defaultTransferFee.model = model;
  this.defaultTransferFee.value = value;

  this.changeHistory.push({
    changedAt: new Date(),
    changedBy: userId,
    field: 'defaultTransferFee',
    oldValue,
    newValue: { model, value },
    note: `Default transfer fee updated to ${model}: ${value}`
  });

  this.lastModifiedBy = userId;
  this.lastModifiedAt = new Date();
};

// Static methods

/**
 * Get or create global settings
 */
salarySettingsSchema.statics.getGlobalSettings = async function() {
  let settings = await this.findById('global');
  
  if (!settings) {
    // Create default settings
    settings = await this.create({
      _id: 'global',
      rateModel: 'flat',
      ratePartitions: [
        { name: '0-50h', minHours: 0, maxHours: 50, rateUSD: 12, description: 'Beginner tier', isActive: true },
        { name: '51-100h', minHours: 51, maxHours: 100, rateUSD: 15, description: 'Intermediate tier', isActive: true },
        { name: '101-200h', minHours: 101, maxHours: 200, rateUSD: 18, description: 'Advanced tier', isActive: true },
        { name: '200+h', minHours: 201, maxHours: 999999, rateUSD: 20, description: 'Expert tier', isActive: true }
      ],
      defaultTransferFee: {
        model: 'flat',
        value: 50
      },
      autoGenerateInvoices: true,
      generationDayOfMonth: 1,
      generationTimeUTC: '00:05'
    });
  }

  return settings;
};

/**
 * Validate partition structure
 */
salarySettingsSchema.statics.validatePartitions = function(partitions) {
  const errors = [];

  // Check for gaps
  const sorted = partitions.slice().sort((a, b) => a.minHours - b.minHours);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].maxHours + 1 !== sorted[i + 1].minHours) {
      errors.push(`Gap between ${sorted[i].name} and ${sorted[i + 1].name}`);
    }
  }

  // Check for overlaps
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (!(a.maxHours < b.minHours || a.minHours > b.maxHours)) {
        errors.push(`Overlap between ${a.name} and ${b.name}`);
      }
    }
  }

  // Check for negative or invalid ranges
  for (const partition of partitions) {
    if (partition.minHours < 0) {
      errors.push(`${partition.name}: minHours cannot be negative`);
    }
    if (partition.maxHours < partition.minHours) {
      errors.push(`${partition.name}: maxHours must be >= minHours`);
    }
    if (partition.rateUSD <= 0) {
      errors.push(`${partition.name}: rate must be positive`);
    }
  }

  return errors;
};

const SalarySettings = mongoose.model('SalarySettings', salarySettingsSchema);

module.exports = SalarySettings;
