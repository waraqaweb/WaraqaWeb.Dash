// backend/services/teacherSalaryService.js
/**
 * TeacherSalaryService - Core business logic for teacher salary system
 * Handles rate calculations, invoice generation, hour aggregation, and payments
 */

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const TeacherInvoice = require('../models/TeacherInvoice');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');
const TeacherSalaryAudit = require('../models/TeacherSalaryAudit');
const User = require('../models/User');
const Class = require('../models/Class');
const notificationService = require('./notificationService');

const TEACHER_VISIBLE_STATUSES = ['published', 'paid', 'archived'];

class TeacherSalaryService {
  static getTeacherVisibleStatuses() {
    return [...TEACHER_VISIBLE_STATUSES];
  }

  /**
   * Aggregate hours for a teacher in a given month
   * @param {ObjectId|String} teacherId - Teacher ID
   * @param {Number} month - Month (1-12)
   * @param {Number} year - Year
   * @returns {Promise<Object>} { totalHours, classIds, classes }
   */
  static async aggregateTeacherHours(teacherId, month, year) {
    try {
      // Calculate UTC date range for the month
      const startDate = dayjs.utc(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month').toDate();
      const endDate = dayjs.utc(startDate).add(1, 'month').toDate();

      console.log(`[aggregateTeacherHours] Teacher: ${teacherId}, Period: ${startDate.toISOString()} to ${endDate.toISOString()}`);

      // Query classes: include current countable statuses used in production data.
      // We include 'completed' as some flows mark attended lessons that way.
      // Keep legacy 'absent' for backward compatibility.
      const classes = await Class.find({
        teacher: teacherId,
        scheduledDate: {
          $gte: startDate,
          $lt: endDate
        },
        status: { $in: ['attended', 'missed_by_student', 'completed', 'absent'] }, // Countable statuses
        deleted: { $ne: true }
      })
        .select('_id scheduledDate duration subject status student billedInTeacherInvoiceId')
        .lean();

      console.log(`[aggregateTeacherHours] Found ${classes.length} countable classes`);

      const { availableClasses, excludedIds } = await this.filterAlreadyBilledClasses(classes);
      if (excludedIds.length > 0) {
        console.log(`[aggregateTeacherHours] Skipping ${excludedIds.length} classes already billed in other invoices`);
      }

      // Calculate total hours
      const totalHours = availableClasses.reduce((sum, cls) => {
        const duration = Number(cls.duration || 0);
        return sum + (duration / 60);
      }, 0);

      const classIds = availableClasses.map(c => c._id);

      return {
        totalHours: Math.round(totalHours * 1000) / 1000, // Round to 3 decimals
        classIds,
        classes: availableClasses
      };
    } catch (error) {
      console.error('[aggregateTeacherHours] Error:', error);
      throw error;
    }
  }

  /**
   * Filter out classes that are already linked to another teacher invoice
   * @param {Array<Object>} classes
   * @returns {Promise<{availableClasses: Array<Object>, excludedIds: Array<string>}>}
   */
  static async filterAlreadyBilledClasses(classes = []) {
    if (!Array.isArray(classes) || classes.length === 0) {
      return { availableClasses: [], excludedIds: [] };
    }

    const exclusionSet = new Set();
    const candidateIds = [];

    for (const cls of classes) {
      if (cls.billedInTeacherInvoiceId) {
        exclusionSet.add(String(cls._id));
      } else {
        candidateIds.push(cls._id);
      }
    }

    if (candidateIds.length > 0) {
      const invoices = await TeacherInvoice.find({
        deleted: { $ne: true },
        classIds: { $in: candidateIds }
      })
        .select('classIds')
        .lean();

      invoices.forEach(inv => {
        inv.classIds.forEach(id => exclusionSet.add(String(id)));
      });
    }

    const availableClasses = classes.filter(cls => !exclusionSet.has(String(cls._id)));

    return {
      availableClasses,
      excludedIds: Array.from(exclusionSet)
    };
  }

  /**
   * Get rate information for a teacher
   * @param {Object} teacher - Teacher user document
   * @param {Number} hours - Hours to calculate rate for
   * @returns {Promise<Object>} { rate, partition, source }
   */
  static async getTeacherRate(teacher, hours) {
    try {
      // Check if teacher has custom rate override
      if (teacher.teacherInfo?.customRateOverride?.enabled) {
        return {
          rate: teacher.teacherInfo.customRateOverride.rateUSD,
          partition: 'custom',
          source: 'teacher_custom',
          description: 'Custom rate override'
        };
      }

      // Get global settings
      const settings = await SalarySettings.getGlobalSettings();
      
      // Use current month hours ONLY to determine partition (not YTD)
      // Rate is based on hours worked in this specific month
      const partition = settings.getPartitionForHours(hours);
      const rate = settings.getRateForHours(hours);

      console.log(`[getTeacherRate] Teacher hours this month: ${hours}, Partition: ${partition}, Rate: $${rate}/hr`);

      return {
        rate,
        partition,
        source: 'salary_settings',
        description: settings.ratePartitions.find(p => p.name === partition)?.description || ''
      };
    } catch (error) {
      console.error('[getTeacherRate] Error:', error);
      throw error;
    }
  }

  /**
   * Get exchange rate for a month
   * @param {Number} month - Month (1-12)
   * @param {Number} year - Year
   * @returns {Promise<Object>} { rate, source }
   */
  static async getExchangeRate(month, year) {
    try {
      const exchangeRate = await MonthlyExchangeRates.findOne({ month, year });
      
      if (!exchangeRate) {
        throw new Error(`No exchange rate found for ${year}-${String(month).padStart(2, '0')}. Please set the rate before generating invoices.`);
      }

      return {
        rate: exchangeRate.rate,
        source: `MonthlyExchangeRate ${year}-${String(month).padStart(2, '0')}`,
        setBy: exchangeRate.setBy,
        setAt: exchangeRate.setAt
      };
    } catch (error) {
      console.error('[getExchangeRate] Error:', error);
      throw error;
    }
  }

  /**
   * Get transfer fee for a teacher
   * @param {Object} teacher - Teacher user document
   * @returns {Object} { model, value, source }
   */
  static getTransferFee(teacher) {
    try {
      // Check if teacher has custom transfer fee
      if (teacher.teacherInfo?.customTransferFee?.enabled) {
        return {
          model: teacher.teacherInfo.customTransferFee.model,
          value: teacher.teacherInfo.customTransferFee.value,
          source: 'teacher_custom'
        };
      }

      // Use system default (will be loaded from settings during invoice generation)
      return null; // Will be populated from SalarySettings
    } catch (error) {
      console.error('[getTransferFee] Error:', error);
      throw error;
    }
  }

  /**
   * Create a draft invoice for a teacher
   * @param {ObjectId|String} teacherId - Teacher ID
   * @param {Number} month - Month (1-12)
   * @param {Number} year - Year
   * @param {Object} options - Additional options { userId, isAdjustment, adjustmentFor }
   * @returns {Promise<Object>} Created invoice
   */
  static async createTeacherInvoice(teacherId, month, year, options = {}) {
    try {
      const {
        userId = null,
        isAdjustment = false,
        adjustmentFor = null,
        adjustmentType = null,
        monthlyHoursSnapshot = null
      } = options;

      console.log(`[createTeacherInvoice] Creating invoice for teacher ${teacherId}, ${year}-${month}`);

      // Load teacher
      const teacher = await User.findById(teacherId);
      if (!teacher || teacher.role !== 'teacher') {
        throw new Error('Invalid teacher ID');
      }

      // Aggregate hours
      const { totalHours, classIds, classes } = await this.aggregateTeacherHours(teacherId, month, year);

      const parsedSnapshot = Number(monthlyHoursSnapshot);
      const snapshotHours = Number.isFinite(parsedSnapshot)
        ? Math.max(0, Math.round(parsedSnapshot * 1000) / 1000)
        : null;
      const hasBillableHours = totalHours > 0 || (snapshotHours !== null && snapshotHours > 0);

      if (!hasBillableHours && !isAdjustment) {
        console.log(`[createTeacherInvoice] Teacher ${teacherId} has 0 hours (aggregated & snapshot) for ${year}-${month}, skipping`);
        return null;
      }

      let invoiceHours = totalHours;
      if (snapshotHours !== null && snapshotHours > invoiceHours) {
        console.log(`[createTeacherInvoice] Overriding aggregated hours (${invoiceHours}) with snapshot (${snapshotHours}) for teacher ${teacherId}`);
        invoiceHours = snapshotHours;
      }

      invoiceHours = Math.round(invoiceHours * 1000) / 1000;

      // Get rate information
      const rateInfo = await this.getTeacherRate(teacher, totalHours);

      // Get exchange rate
      const exchangeRateInfo = await this.getExchangeRate(month, year);

      // Get transfer fee
      const customTransferFee = this.getTransferFee(teacher);
      
      // If no custom fee, get system default
      let transferFeeSnapshot;
      if (customTransferFee) {
        transferFeeSnapshot = {
          model: customTransferFee.model,
          value: customTransferFee.value,
          source: 'teacher_custom'
        };
      } else {
        const settings = await SalarySettings.getGlobalSettings();
        transferFeeSnapshot = {
          model: settings.defaultTransferFee.model,
          value: settings.defaultTransferFee.value,
          source: 'system_default'
        };
      }

      // Create invoice
      const invoiceData = {
        teacher: teacherId,
        month,
        year,
        status: 'draft',
        totalHours: invoiceHours,
        classIds,
        lockedMonthlyHours: snapshotHours !== null ? snapshotHours : invoiceHours,
        
        // Rate snapshot
        rateSnapshot: {
          partition: rateInfo.partition,
          rate: rateInfo.rate,
          effectiveFrom: new Date(),
          description: rateInfo.description
        },

        // Exchange rate snapshot
        exchangeRateSnapshot: {
          rate: exchangeRateInfo.rate,
          source: exchangeRateInfo.source,
          setBy: exchangeRateInfo.setBy,
          setAt: exchangeRateInfo.setAt
        },

        // Transfer fee snapshot
        transferFeeSnapshot,

        // Adjustment info
        isAdjustment,

        // Metadata
        createdBy: userId,
        updatedBy: userId,
        
        notes: isAdjustment 
          ? `Adjustment invoice for ${year}-${String(month).padStart(2, '0')}` 
          : `Draft invoice for ${year}-${String(month).padStart(2, '0')}`
      };

      // Only add adjustment fields if this is an adjustment
      if (isAdjustment) {
        if (adjustmentFor) invoiceData.adjustmentFor = adjustmentFor;
        if (adjustmentType) invoiceData.adjustmentType = adjustmentType;
      }

      const invoice = new TeacherInvoice(invoiceData);

      // Calculate amounts
      invoice.calculateAmounts();

      // Save
      await invoice.save();

      await this.markClassesAsBilled(classIds, invoice._id);

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'invoice_create',
        entityType: 'TeacherInvoice',
        entityId: invoice._id,
        actor: userId,
        actorRole: 'admin',
        after: {
          invoiceId: invoice._id,
          teacher: teacherId,
          month,
          year,
          totalHours: invoiceHours,
          lockedMonthlyHours: snapshotHours !== null ? snapshotHours : null,
          grossAmountUSD: invoice.grossAmountUSD,
          netAmountEGP: invoice.netAmountEGP,
          status: 'draft'
        },
        metadata: {
          classCount: classIds.length,
          ratePartition: rateInfo.partition,
          exchangeRate: exchangeRateInfo.rate
        }
      });

      console.log(`[createTeacherInvoice] Invoice created: ${invoice._id}`);

      return invoice;
    } catch (error) {
      console.error('[createTeacherInvoice] Error:', error);
      
      // Log failed action
      await TeacherSalaryAudit.logAction({
        action: 'invoice_create',
        entityType: 'TeacherInvoice',
        actor: options.userId,
        success: false,
        errorMessage: error.message,
        metadata: {
          teacherId,
          month,
          year
        }
      });

      throw error;
    }
  }

  /**
   * Generate invoices for all teachers for a given month
   * @param {Number} month - Month (1-12)
   * @param {Number} year - Year
   * @param {Object} options - { userId, dryRun }
   * @returns {Promise<Object>} { success, invoices, errors }
   */
  static async generateMonthlyInvoices(month, year, options = {}) {
    const { userId = null, teacherIds = null, dryRun = false } = options;

    try {
      console.log(`[generateMonthlyInvoices] Generating for ${year}-${month}, dryRun: ${dryRun}, teacherIds:`, teacherIds);

      // Validate exchange rate exists
      const exchangeRateExists = await MonthlyExchangeRates.hasRateForMonth(month, year);
      if (!exchangeRateExists) {
        throw new Error(`Exchange rate not set for ${year}-${String(month).padStart(2, '0')}. Please set the rate before generating invoices.`);
      }

      // Get teachers - either specific ones or all active
      const query = { role: 'teacher', isActive: true };
      if (teacherIds && Array.isArray(teacherIds) && teacherIds.length > 0) {
        query._id = { $in: teacherIds };
      }

      const teachers = await User.find(query).select('_id firstName lastName email teacherInfo');

      console.log(`[generateMonthlyInvoices] Found ${teachers.length} teachers to process`);

      const results = {
        success: true,
        invoices: [],
        skipped: [],
        adjusted: [],
        adjustmentsCreated: [],
        errors: [],
        summary: {
          total: teachers.length,
          created: 0,
          adjusted: 0,
          adjustmentsCreated: 0,
          skipped: 0,
          failed: 0
        }
      };

      for (const teacher of teachers) {
        try {
          // Check if invoice already exists
          const existing = await TeacherInvoice.findOne({
            teacher: teacher._id,
            month,
            year,
            isAdjustment: false,
            deleted: false
          });

          // Aggregate hours for this teacher
          const { totalHours, classes } = await this.aggregateTeacherHours(teacher._id, month, year);

          if (existing) {
            // Check if there are classes not included in any invoice
            const existingClassIds = existing.classIds.map(id => id.toString());
            const missingClasses = classes.filter(cls => !existingClassIds.includes(cls._id.toString()));

            if (missingClasses.length > 0) {
              const missingHours = missingClasses.reduce((sum, cls) => sum + (cls.duration || 0) / 60, 0);
              
              console.log(`[generateMonthlyInvoices] Found ${missingClasses.length} missing classes (${missingHours.toFixed(2)}h) for teacher ${teacher._id}`);

              // Check if there are unpaid invoices
              if (existing.status === 'draft' || existing.status === 'published') {
                // Adjust existing invoice to include missing classes
                if (!dryRun) {
                  const newClassIds = missingClasses
                    .map(cls => cls._id)
                    .filter(id => !existing.classIds.some(existingId => existingId.toString() === id.toString()));

                  if (newClassIds.length === 0) {
                    console.log(`[generateMonthlyInvoices] All missing classes were already linked to invoices for teacher ${teacher._id}`);
                  } else {
                    const newClassIdSet = new Set(newClassIds.map(id => id.toString()));
                    const addedHours = missingClasses.reduce((sum, cls) => (
                      newClassIdSet.has(cls._id.toString())
                        ? sum + (cls.duration || 0) / 60
                        : sum
                    ), 0);

                    existing.classIds.push(...newClassIds);
                    existing.totalHours += addedHours;
                    existing.totalUSD = (existing.totalHours * existing.rateSnapshot.rate).toFixed(2);
                    
                    // Recalculate EGP
                    const exchangeRate = await MonthlyExchangeRates.getRateForMonth(month, year);
                    existing.totalEGP = (existing.totalUSD * exchangeRate.rate).toFixed(2);
                    existing.netEGP = existing.totalEGP; // Will be recalculated if there are fees
                    
                    await existing.save();

                    await this.markClassesAsBilled(newClassIds, existing._id);
                    
                    results.adjusted.push({
                      invoiceId: existing._id,
                      teacherId: teacher._id,
                      teacherName: `${teacher.firstName} ${teacher.lastName}`,
                      addedHours,
                      newTotal: existing.totalHours
                    });
                    results.summary.adjusted++;
                  }
                } else {
                  results.adjusted.push({
                    teacherId: teacher._id,
                    teacherName: `${teacher.firstName} ${teacher.lastName}`,
                    status: 'would_adjust',
                    addedHours: missingHours
                  });
                }
              } else {
                // Invoice is paid: create an adjustment invoice for late submissions so the period stays closed
                // without polluting the new month's counters.
                if (dryRun) {
                  results.adjustmentsCreated.push({
                    teacherId: teacher._id,
                    teacherName: `${teacher.firstName} ${teacher.lastName}`,
                    status: 'would_create_adjustment',
                    adjustmentFor: existing._id,
                    addedHours: missingHours,
                    classCount: missingClasses.length
                  });
                  results.summary.adjustmentsCreated++;
                } else {
                  const newClassIds = missingClasses
                    .map(cls => cls._id)
                    .filter(id => !existing.classIds.some(existingId => existingId.toString() === id.toString()));

                  if (newClassIds.length === 0) {
                    console.log(`[generateMonthlyInvoices] Paid invoice missing classes were already linked elsewhere for teacher ${teacher._id}`);
                    results.skipped.push({
                      teacherId: teacher._id,
                      teacherName: `${teacher.firstName} ${teacher.lastName}`,
                      reason: 'Late-submission classes already billed'
                    });
                    results.summary.skipped++;
                  } else {
                    const newClassIdSet = new Set(newClassIds.map(id => id.toString()));
                    const addedHours = missingClasses.reduce((sum, cls) => (
                      newClassIdSet.has(cls._id.toString())
                        ? sum + (cls.duration || 0) / 60
                        : sum
                    ), 0);
                    const roundedHours = Math.round(addedHours * 1000) / 1000;

                    const adjustmentInvoice = new TeacherInvoice({
                      teacher: teacher._id,
                      month,
                      year,
                      status: 'draft',
                      isAdjustment: true,
                      adjustmentFor: existing._id,
                      adjustmentType: 'late_submission',
                      totalHours: roundedHours,
                      lockedMonthlyHours: roundedHours,
                      classIds: newClassIds,
                      rateSnapshot: existing.rateSnapshot,
                      exchangeRateSnapshot: existing.exchangeRateSnapshot,
                      transferFeeSnapshot: existing.transferFeeSnapshot,
                      createdBy: userId,
                      updatedBy: userId,
                      notes: `Late submission adjustment for ${existing.invoiceNumber || existing._id}`
                    });

                    adjustmentInvoice.calculateAmounts();
                    await adjustmentInvoice.save();
                    await this.markClassesAsBilled(newClassIds, adjustmentInvoice._id);

                    results.adjustmentsCreated.push({
                      invoiceId: adjustmentInvoice._id,
                      adjustmentFor: existing._id,
                      teacherId: teacher._id,
                      teacherName: `${teacher.firstName} ${teacher.lastName}`,
                      addedHours: roundedHours,
                      classCount: newClassIds.length
                    });
                    results.summary.adjustmentsCreated++;
                  }
                }
              }
            } else {
              console.log(`[generateMonthlyInvoices] Invoice already exists with all classes for teacher ${teacher._id}`);
              results.skipped.push({
                teacherId: teacher._id,
                teacherName: `${teacher.firstName} ${teacher.lastName}`,
                reason: 'Invoice already exists'
              });
              results.summary.skipped++;
            }
          } else {
            // No existing invoice
            if (totalHours === 0) {
              results.skipped.push({
                teacherId: teacher._id,
                teacherName: `${teacher.firstName} ${teacher.lastName}`,
                reason: 'Zero hours'
              });
              results.summary.skipped++;
              continue;
            }

            const beforeHours = (teacher && teacher.teacherInfo && typeof teacher.teacherInfo.monthlyHours === 'number')
              ? teacher.teacherInfo.monthlyHours
              : (typeof totalHours === 'number' ? totalHours : 0);

            if (dryRun) {
              results.invoices.push({
                teacherId: teacher._id,
                teacherName: `${teacher.firstName} ${teacher.lastName}`,
                totalHours,
                status: 'dry_run'
              });
            } else {
              // Create new invoice
                const invoice = await this.createTeacherInvoice(teacher._id, month, year, {
                  userId,
                  monthlyHoursSnapshot: beforeHours
                });

                if (invoice) {
                  results.invoices.push(invoice);
                  results.summary.created++;

                  // After successfully creating an invoice, zero the teacher's monthly counters
                  try {
                    console.log(`[generateMonthlyInvoices] Zeroing monthly hours for teacher ${teacher._id}. beforeHours=${beforeHours}`);

                    if (teacher && teacher.teacherInfo) {
                      teacher.teacherInfo.monthlyHours = 0;
                      teacher.teacherInfo.monthlyRate = 0;
                      teacher.teacherInfo.monthlyEarnings = 0;
                      teacher.teacherInfo.lastMonthlyReset = new Date();
                      await teacher.save();
                    } else {
                      // Fallback: update directly if teacher doc isn't populated fully
                      await User.updateOne({ _id: teacher._id }, {
                        $set: {
                          'teacherInfo.monthlyHours': 0,
                          'teacherInfo.monthlyRate': 0,
                          'teacherInfo.monthlyEarnings': 0,
                          'teacherInfo.lastMonthlyReset': new Date()
                        }
                      }).exec();
                    }

                    // Audit per-teacher change (non-blocking)
                    try {
                      await TeacherSalaryAudit.logAction({
                        action: 'bulk_operation',
                        entityType: 'User',
                        entityId: teacher._id,
                        actor: userId || null,
                        actorRole: userId ? 'admin' : 'system',
                        before: { monthlyHours: beforeHours },
                        after: { monthlyHours: 0 },
                        metadata: { reason: 'monthly_hours_zeroed_after_invoice_creation', month, year }
                      });
                      console.log(`[generateMonthlyInvoices] Audit logged for zeroing teacher ${teacher._id}`);
                    } catch (auditErr) {
                      console.warn(`[generateMonthlyInvoices] Audit log failed for teacher ${teacher._id}:`, auditErr && auditErr.message);
                    }

                    // Track zeroed count for summary
                    results.summary.zeroed = (results.summary.zeroed || 0) + 1;
                  } catch (zeroErr) {
                    console.warn(`[generateMonthlyInvoices] Failed to zero monthly hours for teacher ${teacher._id}:`, zeroErr && zeroErr.message);
                    results.errors.push({
                      teacherId: teacher._id,
                      teacherName: `${teacher.firstName} ${teacher.lastName}`,
                      error: `Zeroing failed: ${zeroErr.message}`
                    });
                    results.summary.failed++;
                  }

                } else {
                results.skipped.push({
                  teacherId: teacher._id,
                  teacherName: `${teacher.firstName} ${teacher.lastName}`,
                  reason: 'Zero hours'
                });
                results.summary.skipped++;
              }
            }
          }
        } catch (error) {
          console.error(`[generateMonthlyInvoices] Error for teacher ${teacher._id}:`, error);
          results.errors.push({
            teacherId: teacher._id,
            teacherName: `${teacher.firstName} ${teacher.lastName}`,
            error: error.message
          });
          results.summary.failed++;
        }
      }

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'job_run',
        entityType: 'System',
        actor: userId,
        actorRole: userId ? 'admin' : 'system',
        success: results.errors.length === 0,
        metadata: {
          month,
          year,
          dryRun,
          teacherIds,
          summary: results.summary
        }
      });

      console.log(`[generateMonthlyInvoices] Completed: ${results.summary.created} created, ${results.summary.adjusted} adjusted, ${results.summary.skipped} skipped, ${results.summary.failed} failed`);

      return results;
    } catch (error) {
      console.error('[generateMonthlyInvoices] Error:', error);
      
      // Log failed job
      await TeacherSalaryAudit.logAction({
        action: 'job_fail',
        entityType: 'System',
        actor: userId,
        success: false,
        errorMessage: error.message,
        metadata: { month, year, teacherIds }
      });

      throw error;
    }
  }

  /**
   * Soft delete an unpaid invoice (draft or published) and release linked classes
   * @param {ObjectId|String} invoiceId
   * @param {ObjectId|String} userId
   */
  static async deleteDraftInvoice(invoiceId, userId) {
    const invoice = await TeacherInvoice.findById(invoiceId);
    if (!invoice) {
      throw new Error('Invoice not found');
    }

    if (!['draft', 'published'].includes(invoice.status)) {
      throw new Error('Only unpaid (draft/published) invoices can be deleted');
    }

    invoice.deleted = true;
    invoice.updatedBy = userId;
    await invoice.save();

    await this.unmarkClassesForInvoice(invoice._id);

    await TeacherSalaryAudit.logAction({
      action: 'invoice_delete',
      entityType: 'TeacherInvoice',
      entityId: invoice._id,
      actor: userId,
      actorRole: 'admin',
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        teacher: invoice.teacher,
        month: invoice.month,
        year: invoice.year
      }
    });

    return invoice;
  }

  /**
   * Publish an invoice (freeze snapshot fields)
   * @param {ObjectId|String} invoiceId - Invoice ID
   * @param {ObjectId|String} userId - User performing action
   * @returns {Promise<Object>} Updated invoice
   */
  static async publishInvoice(invoiceId, userId) {
    try {
      const invoice = await TeacherInvoice.findById(invoiceId);
      if (!invoice) {
        throw new Error('Invoice not found');
      }

      const before = invoice.toObject();
      
      await invoice.publish(userId);

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'invoice_publish',
        entityType: 'TeacherInvoice',
        entityId: invoice._id,
        actor: userId,
        actorRole: 'admin',
        before: { status: before.status },
        after: { status: 'published' },
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          teacher: invoice.teacher,
          month: invoice.month,
          year: invoice.year,
          netAmountEGP: invoice.netAmountEGP
        }
      });

      // Send notification to teacher (don't block on failure)
      notificationService.notifyInvoicePublished(invoice.teacher, invoice)
        .catch(err => console.error('[publishInvoice] Notification error:', err.message));

      return invoice;
    } catch (error) {
      console.error('[publishInvoice] Error:', error);
      
      await TeacherSalaryAudit.logAction({
        action: 'invoice_publish',
        entityType: 'TeacherInvoice',
        entityId: invoiceId,
        actor: userId,
        success: false,
        errorMessage: error.message
      });

      throw error;
    }
  }

  /**
   * Mark invoice as paid
   * @param {ObjectId|String} invoiceId - Invoice ID
   * @param {Object} paymentDetails - { paymentMethod, transactionId, paidAt, note }
   * @param {ObjectId|String} userId - User performing action
   * @returns {Promise<Object>} Updated invoice
   */
  static async markInvoiceAsPaid(invoiceId, paymentDetails, userId) {
    try {
      const invoice = await TeacherInvoice.findById(invoiceId);
      if (!invoice) {
        throw new Error('Invoice not found');
      }

      const before = { status: invoice.status, paidAt: invoice.paidAt };

      await invoice.markAsPaid(paymentDetails, userId);

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'invoice_paid',
        entityType: 'TeacherInvoice',
        entityId: invoice._id,
        actor: userId,
        actorRole: 'admin',
        before,
        after: { 
          status: 'paid', 
          paidAt: invoice.paidAt,
          paymentMethod: invoice.paymentMethod,
          transactionId: invoice.transactionId
        },
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          teacher: invoice.teacher,
          amount: invoice.netAmountEGP
        }
      });

      // Send payment notification to teacher (don't block on failure)
      notificationService.notifyPaymentReceived(invoice.teacher, invoice)
        .catch(err => console.error('[markInvoiceAsPaid] Notification error:', err.message));

      return invoice;
    } catch (error) {
      console.error('[markInvoiceAsPaid] Error:', error);
      
      await TeacherSalaryAudit.logAction({
        action: 'invoice_paid',
        entityType: 'TeacherInvoice',
        entityId: invoiceId,
        actor: userId,
        success: false,
        errorMessage: error.message
      });

      throw error;
    }
  }

  /**
   * Add bonus to invoice
   * @param {ObjectId|String} invoiceId - Invoice ID
   * @param {Object} bonusData - { source, guardianId, amountUSD, reason }
   * @param {ObjectId|String} userId - User performing action
   * @returns {Promise<Object>} Updated invoice
   */
  static async addBonus(invoiceId, bonusData, userId) {
    try {
      const invoice = await TeacherInvoice.findById(invoiceId);
      if (!invoice) {
        throw new Error('Invoice not found');
      }

      invoice.addBonus(bonusData, userId);
      await invoice.save();

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'bonus_add',
        entityType: 'TeacherInvoice',
        entityId: invoice._id,
        actor: userId,
        actorRole: 'admin',
        after: bonusData,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          teacher: invoice.teacher,
          amount: bonusData.amountUSD
        }
      });

      // Send bonus notification to teacher (don't block on failure)
      notificationService.notifyBonusAdded(invoice.teacher, invoice, bonusData)
        .catch(err => console.error('[addBonus] Notification error:', err.message));

      return invoice;
    } catch (error) {
      console.error('[addBonus] Error:', error);
      throw error;
    }
  }

  /**
   * Add extra to invoice
   * @param {ObjectId|String} invoiceId - Invoice ID
   * @param {Object} extraData - { category, amountUSD, reason }
   * @param {ObjectId|String} userId - User performing action
   * @returns {Promise<Object>} Updated invoice
   */
  static async addExtra(invoiceId, extraData, userId) {
    try {
      const invoice = await TeacherInvoice.findById(invoiceId);
      if (!invoice) {
        throw new Error('Invoice not found');
      }

      invoice.addExtra(extraData, userId);
      await invoice.save();

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'extra_add',
        entityType: 'TeacherInvoice',
        entityId: invoice._id,
        actor: userId,
        actorRole: 'admin',
        after: extraData,
        metadata: {
          invoiceNumber: invoice.invoiceNumber,
          teacher: invoice.teacher,
          category: extraData.category,
          amount: extraData.amountUSD
        }
      });

      // Send extra notification to teacher (don't block on failure)
      notificationService.notifyExtraAdded(invoice.teacher, invoice, extraData)
        .catch(err => console.error('[addExtra] Notification error:', err.message));

      return invoice;
    } catch (error) {
      console.error('[addExtra] Error:', error);
      throw error;
    }
  }

  /**
   * Get teacher YTD summary
   * @param {ObjectId|String} teacherId - Teacher ID
   * @param {Number} year - Year
   * @returns {Promise<Object>} YTD summary
   */
  static async getTeacherYTDSummary(teacherId, year) {
    try {
      const summary = await TeacherInvoice.getTeacherYTDSummary(teacherId, year);
      return summary;
    } catch (error) {
      console.error('[getTeacherYTDSummary] Error:', error);
      throw error;
    }
  }

  /**
   * Get teacher's invoices for dashboard
   * @param {ObjectId|String} teacherId - Teacher ID
   * @param {Object} filters - { year, status, limit, skip }
   * @returns {Promise<Array>} Invoices
   */
  static async getTeacherInvoices(teacherId, filters = {}) {
    try {
      const query = {
        teacher: teacherId,
        deleted: false
      };

      if (filters.year) {
        query.year = filters.year;
      }

      if (filters.month) {
        query.month = filters.month;
      }

      if (filters.search) {
        const regex = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.invoiceNumber = regex;
      }

      const allowedStatuses = TEACHER_VISIBLE_STATUSES;
      if (filters.status && allowedStatuses.includes(filters.status)) {
        query.status = filters.status;
      } else {
        query.status = { $in: allowedStatuses };
      }

      const invoices = await TeacherInvoice.find(query)
        .sort({ year: -1, month: -1 })
        .limit(filters.limit || 50)
        .skip(filters.skip || 0)
        .lean();

      return invoices;
    } catch (error) {
      console.error('[getTeacherInvoices] Error:', error);
      throw error;
    }
  }

  /**
   * Update teacher's custom rate
   * @param {ObjectId|String} teacherId - Teacher ID
   * @param {Number} rateUSD - New rate in USD
   * @param {String} reason - Reason for change
   * @param {ObjectId|String} userId - User performing action
   * @returns {Promise<Object>} Updated teacher
   */
  static async setCustomRate(teacherId, rateUSD, reason, userId) {
    try {
      const teacher = await User.findById(teacherId);
      if (!teacher || teacher.role !== 'teacher') {
        throw new Error('Invalid teacher ID');
      }

      const before = teacher.teacherInfo?.customRateOverride;

      teacher.teacherInfo.customRateOverride = {
        enabled: true,
        rateUSD,
        setBy: userId,
        setAt: new Date(),
        reason
      };

      teacher.teacherInfo.effectiveRate = rateUSD;

      await teacher.save();

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'rate_update',
        entityType: 'User',
        entityId: teacher._id,
        actor: userId,
        actorRole: 'admin',
        before,
        after: teacher.teacherInfo.customRateOverride,
        reason,
        metadata: {
          teacherName: `${teacher.firstName} ${teacher.lastName}`,
          rateUSD
        }
      });

      return teacher;
    } catch (error) {
      console.error('[setCustomRate] Error:', error);
      throw error;
    }
  }

  /**
   * Update teacher's custom transfer fee
   * @param {ObjectId|String} teacherId - Teacher ID
   * @param {String} model - 'flat', 'percentage', or 'none'
   * @param {Number} value - Fee value
   * @param {ObjectId|String} userId - User performing action
   * @returns {Promise<Object>} Updated teacher
   */
  static async setCustomTransferFee(teacherId, model, value, userId) {
    try {
      const teacher = await User.findById(teacherId);
      if (!teacher || teacher.role !== 'teacher') {
        throw new Error('Invalid teacher ID');
      }

      const before = teacher.teacherInfo?.customTransferFee;

      teacher.teacherInfo.customTransferFee = {
        enabled: true,
        model,
        value,
        setBy: userId,
        setAt: new Date()
      };

      await teacher.save();

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'teacher_transfer_fee_set',
        entityType: 'User',
        entityId: teacher._id,
        actor: userId,
        actorRole: 'admin',
        before,
        after: teacher.teacherInfo.customTransferFee,
        metadata: {
          teacherName: `${teacher.firstName} ${teacher.lastName}`,
          model,
          value
        }
      });

      return teacher;
    } catch (error) {
      console.error('[setCustomTransferFee] Error:', error);
      throw error;
    }
  }

  /**
   * Reset YTD statistics for all teachers (run at year end)
   * @param {Number} year - Year to reset
   * @param {ObjectId|String} userId - User performing action
   * @returns {Promise<Object>} { success, teachersUpdated }
   */
  static async resetYTDStatistics(year, userId) {
    try {
      console.log(`[resetYTDStatistics] Resetting for year ${year}`);

      const result = await User.updateMany(
        { 
          role: 'teacher',
          isActive: true
        },
        {
          $set: {
            'teacherInfo.totalHoursYTD': 0,
            'teacherInfo.totalEarningsYTD': 0,
            'teacherInfo.lastYTDReset': new Date()
          }
        }
      );

      // Log audit
      await TeacherSalaryAudit.logAction({
        action: 'bulk_operation',
        entityType: 'System',
        actor: userId,
        actorRole: 'admin',
        metadata: {
          operation: 'resetYTDStatistics',
          year,
          teachersUpdated: result.modifiedCount
        }
      });

      console.log(`[resetYTDStatistics] Reset complete: ${result.modifiedCount} teachers updated`);

      return {
        success: true,
        teachersUpdated: result.modifiedCount
      };
    } catch (error) {
      console.error('[resetYTDStatistics] Error:', error);
      throw error;
    }
  }

  /**
   * Mark classes as billed into a specific teacher invoice
   * @param {Array<ObjectId>} classIds
   * @param {ObjectId} invoiceId
   */
  static async markClassesAsBilled(classIds = [], invoiceId) {
    if (!invoiceId || !Array.isArray(classIds) || classIds.length === 0) {
      return;
    }

    await Class.updateMany(
      {
        _id: { $in: classIds },
        $or: [
          { billedInTeacherInvoiceId: null },
          { billedInTeacherInvoiceId: { $exists: false } },
          { billedInTeacherInvoiceId: invoiceId }
        ]
      },
      {
        $set: {
          billedInTeacherInvoiceId: invoiceId,
          teacherInvoiceBilledAt: new Date()
        }
      }
    );
  }

  /**
   * Clear teacher invoice linkage for classes tied to a given invoice
   * @param {ObjectId} invoiceId
   */
  static async unmarkClassesForInvoice(invoiceId) {
    if (!invoiceId) return;

    await Class.updateMany(
      { billedInTeacherInvoiceId: invoiceId },
      {
        $set: {
          billedInTeacherInvoiceId: null,
          teacherInvoiceBilledAt: null
        }
      }
    );
  }
}

module.exports = TeacherSalaryService;
