// backend/services/analyticsService.js
/**
 * Analytics Service for Teacher Salary System
 * Provides reporting, analytics, and data export capabilities
 */

const mongoose = require('mongoose');
const dayjs = require('dayjs');
const ExcelJS = require('exceljs');

const TeacherInvoice = require('../models/TeacherInvoice');
const User = require('../models/User');
const Class = require('../models/Class');
const SalarySettings = require('../models/SalarySettings');
const MonthlyExchangeRates = require('../models/MonthlyExchangeRates');

class AnalyticsService {
  /**
   * Get admin dashboard statistics
   * @param {Object} options - { year, startMonth, endMonth }
   * @returns {Promise<Object>} Dashboard stats
   */
  static async getDashboardStats(options = {}) {
    try {
      const { year = new Date().getFullYear(), startMonth = 1, endMonth = 12 } = options;

      // Get all teachers
      const teachers = await User.find({ role: 'teacher', isActive: true }).select('_id firstName lastName');

      // Get invoices for the period
      const invoices = await TeacherInvoice.find({
        year,
        month: { $gte: startMonth, $lte: endMonth }
      }).lean();

      // Calculate totals
      const totalInvoices = invoices.length;
      const draftInvoices = invoices.filter(i => i.status === 'draft').length;
      const publishedInvoices = invoices.filter(i => i.status === 'published').length;
      const paidInvoices = invoices.filter(i => i.status === 'paid').length;

      const totalHours = invoices.reduce((sum, i) => sum + (i.totalHours || 0), 0);
      const totalAmountUSD = invoices.reduce((sum, i) => sum + (i.netAmountUSD || 0), 0);
      const totalAmountEGP = invoices.reduce((sum, i) => sum + (i.netAmountEGP || 0), 0);
      const totalBonuses = invoices.reduce((sum, i) => sum + (i.bonusesUSD || 0), 0);
      const totalExtras = invoices.reduce((sum, i) => sum + (i.extrasUSD || 0), 0);

      // Calculate payment metrics
      const paidAmount = invoices
        .filter(i => i.status === 'paid')
        .reduce((sum, i) => sum + (i.netAmountEGP || 0), 0);

      const unpaidAmount = invoices
        .filter(i => i.status !== 'paid')
        .reduce((sum, i) => sum + (i.netAmountEGP || 0), 0);

      // Get monthly breakdown
      const monthlyBreakdown = [];
      for (let month = startMonth; month <= endMonth; month++) {
        const monthInvoices = invoices.filter(i => i.month === month);
        monthlyBreakdown.push({
          month,
          invoiceCount: monthInvoices.length,
          totalHours: monthInvoices.reduce((sum, i) => sum + (i.totalHours || 0), 0),
          totalAmountUSD: monthInvoices.reduce((sum, i) => sum + (i.netAmountUSD || 0), 0),
          totalAmountEGP: monthInvoices.reduce((sum, i) => sum + (i.netAmountEGP || 0), 0),
          paidCount: monthInvoices.filter(i => i.status === 'paid').length
        });
      }

      // Get top earners
      const teacherEarnings = {};
      invoices.forEach(invoice => {
        const teacherId = invoice.teacher.toString();
        if (!teacherEarnings[teacherId]) {
          teacherEarnings[teacherId] = {
            teacherId,
            totalEarningsUSD: 0,
            totalHours: 0,
            invoiceCount: 0
          };
        }
        teacherEarnings[teacherId].totalEarningsUSD += invoice.netAmountUSD || 0;
        teacherEarnings[teacherId].totalHours += invoice.totalHours || 0;
        teacherEarnings[teacherId].invoiceCount += 1;
      });

      const topEarners = Object.values(teacherEarnings)
        .sort((a, b) => b.totalEarningsUSD - a.totalEarningsUSD)
        .slice(0, 10)
        .map(te => {
          const teacher = teachers.find(t => t._id.toString() === te.teacherId);
          return {
            ...te,
            teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}` : 'Unknown',
            avgHourlyRate: te.totalHours > 0 ? te.totalEarningsUSD / te.totalHours : 0
          };
        });

      return {
        period: { year, startMonth, endMonth },
        summary: {
          totalTeachers: teachers.length,
          totalInvoices,
          draftInvoices,
          publishedInvoices,
          paidInvoices,
          totalHours: Math.round(totalHours * 100) / 100,
          totalAmountUSD: Math.round(totalAmountUSD * 100) / 100,
          totalAmountEGP: Math.round(totalAmountEGP * 100) / 100,
          totalBonuses: Math.round(totalBonuses * 100) / 100,
          totalExtras: Math.round(totalExtras * 100) / 100,
          paidAmount: Math.round(paidAmount * 100) / 100,
          unpaidAmount: Math.round(unpaidAmount * 100) / 100,
          avgHourlyRate: totalHours > 0 ? Math.round((totalAmountUSD / totalHours) * 100) / 100 : 0
        },
        monthlyBreakdown,
        topEarners
      };
    } catch (error) {
      console.error('[getDashboardStats] Error:', error);
      throw error;
    }
  }

  /**
   * Get teacher earning trends
   * @param {String} teacherId - Teacher ID
   * @param {Object} options - { startYear, endYear }
   * @returns {Promise<Object>} Earning trends
   */
  static async getTeacherEarningTrends(teacherId, options = {}) {
    try {
      const currentYear = new Date().getFullYear();
      const { startYear = currentYear - 1, endYear = currentYear } = options;

      const invoices = await TeacherInvoice.find({
        teacher: teacherId,
        year: { $gte: startYear, $lte: endYear }
      }).sort({ year: 1, month: 1 }).lean();

      const monthlyTrends = [];
      for (let year = startYear; year <= endYear; year++) {
        for (let month = 1; month <= 12; month++) {
          const invoice = invoices.find(i => i.year === year && i.month === month);
          monthlyTrends.push({
            year,
            month,
            period: `${year}-${String(month).padStart(2, '0')}`,
            hours: invoice?.totalHours || 0,
            earningsUSD: invoice?.netAmountUSD || 0,
            earningsEGP: invoice?.netAmountEGP || 0,
            bonusesUSD: invoice?.bonusesUSD || 0,
            extrasUSD: invoice?.extrasUSD || 0,
            status: invoice?.status || null,
            invoiceId: invoice?._id || null
          });
        }
      }

      // Calculate statistics
      const totalEarningsUSD = invoices.reduce((sum, i) => sum + (i.netAmountUSD || 0), 0);
      const totalHours = invoices.reduce((sum, i) => sum + (i.totalHours || 0), 0);
      const avgMonthlyEarnings = invoices.length > 0 ? totalEarningsUSD / invoices.length : 0;
      const avgMonthlyHours = invoices.length > 0 ? totalHours / invoices.length : 0;

      // Find best and worst months
      const paidInvoices = invoices.filter(i => i.status === 'paid');
      let bestMonth = null;
      let worstMonth = null;

      if (paidInvoices.length > 0) {
        bestMonth = paidInvoices.reduce((max, i) => 
          (i.netAmountUSD > (max?.netAmountUSD || 0)) ? i : max
        );
        worstMonth = paidInvoices.reduce((min, i) => 
          (i.netAmountUSD < (min?.netAmountUSD || Infinity)) ? i : min
        );
      }

      return {
        teacherId,
        period: { startYear, endYear },
        monthlyTrends,
        statistics: {
          totalInvoices: invoices.length,
          totalEarningsUSD: Math.round(totalEarningsUSD * 100) / 100,
          totalHours: Math.round(totalHours * 100) / 100,
          avgMonthlyEarnings: Math.round(avgMonthlyEarnings * 100) / 100,
          avgMonthlyHours: Math.round(avgMonthlyHours * 100) / 100,
          avgHourlyRate: totalHours > 0 ? Math.round((totalEarningsUSD / totalHours) * 100) / 100 : 0,
          bestMonth: bestMonth ? {
            year: bestMonth.year,
            month: bestMonth.month,
            earnings: bestMonth.netAmountUSD,
            hours: bestMonth.totalHours
          } : null,
          worstMonth: worstMonth ? {
            year: worstMonth.year,
            month: worstMonth.month,
            earnings: worstMonth.netAmountUSD,
            hours: worstMonth.totalHours
          } : null
        }
      };
    } catch (error) {
      console.error('[getTeacherEarningTrends] Error:', error);
      throw error;
    }
  }

  /**
   * Get payment history report
   * @param {Object} options - { startDate, endDate, teacherId, status }
   * @returns {Promise<Object>} Payment history
   */
  static async getPaymentHistory(options = {}) {
    try {
      const { startDate, endDate, teacherId, status } = options;

      const query = {};
      
      if (startDate && endDate) {
        const [startYear, startMonth] = startDate.split('-').map(Number);
        const [endYear, endMonth] = endDate.split('-').map(Number);
        
        query.$and = [];
        
        // Handle single year case
        if (startYear === endYear) {
          query.$and.push({ year: startYear });
          query.$and.push({ month: { $gte: startMonth, $lte: endMonth } });
        } else {
          // Handle multi-year case
          query.$and.push({
            $or: [
              { year: startYear, month: { $gte: startMonth } },
              { year: endYear, month: { $lte: endMonth } },
              { year: { $gt: startYear, $lt: endYear } }
            ]
          });
        }
      } else if (startDate) {
        const [year, month] = startDate.split('-').map(Number);
        query.$or = [
          { year: { $gt: year } },
          { year: year, month: { $gte: month } }
        ];
      } else if (endDate) {
        const [year, month] = endDate.split('-').map(Number);
        query.$or = [
          { year: { $lt: year } },
          { year: year, month: { $lte: month } }
        ];
      }

      if (teacherId) {
        query.teacher = teacherId;
      }

      if (status) {
        query.status = status;
      }

      const invoices = await TeacherInvoice.find(query)
        .populate('teacher', 'firstName lastName email')
        .populate('paidBy', 'firstName lastName')
        .sort({ year: -1, month: -1 })
        .lean();

      const payments = invoices.map(invoice => ({
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        teacher: {
          id: invoice.teacher._id,
          name: `${invoice.teacher.firstName} ${invoice.teacher.lastName}`,
          email: invoice.teacher.email
        },
        period: `${invoice.year}-${String(invoice.month).padStart(2, '0')}`,
        status: invoice.status,
        hours: invoice.totalHours,
        amountUSD: invoice.netAmountUSD,
        amountEGP: invoice.netAmountEGP,
        bonusesUSD: invoice.bonusesUSD,
        extrasUSD: invoice.extrasUSD,
        paymentInfo: invoice.status === 'paid' ? {
          method: invoice.paymentMethod,
          transactionId: invoice.transactionId,
          paidAt: invoice.paidAt,
          paidBy: invoice.paidBy ? {
            id: invoice.paidBy._id,
            name: `${invoice.paidBy.firstName} ${invoice.paidBy.lastName}`
          } : null
        } : null,
        createdAt: invoice.createdAt,
        publishedAt: invoice.publishedAt
      }));

      // Calculate summary
      const totalPayments = payments.filter(p => p.status === 'paid').length;
      const totalAmount = payments
        .filter(p => p.status === 'paid')
        .reduce((sum, p) => sum + p.amountEGP, 0);

      return {
        filters: options,
        summary: {
          totalInvoices: payments.length,
          totalPayments,
          pendingPayments: payments.filter(p => p.status !== 'paid').length,
          totalAmountPaid: Math.round(totalAmount * 100) / 100
        },
        payments
      };
    } catch (error) {
      console.error('[getPaymentHistory] Error:', error);
      throw error;
    }
  }

  /**
   * Export data to Excel
   * @param {String} reportType - 'invoices', 'payments', 'teachers'
   * @param {Object} options - Filter options
   * @returns {Promise<Buffer>} Excel file buffer
   */
  static async exportToExcel(reportType, options = {}) {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Waraqa Teacher Salary System';
      workbook.created = new Date();

      if (reportType === 'invoices') {
        await this._addInvoicesSheet(workbook, options);
      } else if (reportType === 'payments') {
        await this._addPaymentsSheet(workbook, options);
      } else if (reportType === 'teachers') {
        await this._addTeachersSheet(workbook, options);
      } else if (reportType === 'dashboard') {
        await this._addDashboardSheet(workbook, options);
      }

      return await workbook.xlsx.writeBuffer();
    } catch (error) {
      console.error('[exportToExcel] Error:', error);
      throw error;
    }
  }

  /**
   * Private: Add invoices sheet to workbook
   */
  static async _addInvoicesSheet(workbook, options) {
    const { year, month, status, teacherId } = options;
    
    const query = {};
    if (year) query.year = year;
    if (month) query.month = month;
    if (status) query.status = status;
    if (teacherId) query.teacher = teacherId;

    const invoices = await TeacherInvoice.find(query)
      .populate('teacher', 'firstName lastName email')
      .sort({ year: -1, month: -1 })
      .lean();

    const sheet = workbook.addWorksheet('Invoices');

    // Add headers
    sheet.columns = [
      { header: 'Invoice Number', key: 'invoiceNumber', width: 15 },
      { header: 'Teacher', key: 'teacher', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Year', key: 'year', width: 10 },
      { header: 'Month', key: 'month', width: 10 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Hours', key: 'hours', width: 10 },
      { header: 'Amount USD', key: 'amountUSD', width: 15 },
      { header: 'Amount EGP', key: 'amountEGP', width: 15 },
      { header: 'Bonuses USD', key: 'bonusesUSD', width: 15 },
      { header: 'Extras USD', key: 'extrasUSD', width: 15 },
      { header: 'Created At', key: 'createdAt', width: 20 }
    ];

    // Style header row
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data
    invoices.forEach(invoice => {
      sheet.addRow({
        invoiceNumber: invoice.invoiceNumber,
        teacher: `${invoice.teacher.firstName} ${invoice.teacher.lastName}`,
        email: invoice.teacher.email,
        year: invoice.year,
        month: invoice.month,
        status: invoice.status,
        hours: invoice.totalHours,
        amountUSD: invoice.netAmountUSD,
        amountEGP: invoice.netAmountEGP,
        bonusesUSD: invoice.bonusesUSD || 0,
        extrasUSD: invoice.extrasUSD || 0,
        createdAt: dayjs(invoice.createdAt).format('YYYY-MM-DD HH:mm')
      });
    });

    // Add totals row
    const lastRow = sheet.rowCount + 2;
    sheet.getCell(`A${lastRow}`).value = 'TOTAL';
    sheet.getCell(`A${lastRow}`).font = { bold: true };
    sheet.getCell(`G${lastRow}`).value = { formula: `SUM(G2:G${lastRow - 2})` };
    sheet.getCell(`H${lastRow}`).value = { formula: `SUM(H2:H${lastRow - 2})` };
    sheet.getCell(`I${lastRow}`).value = { formula: `SUM(I2:I${lastRow - 2})` };
    sheet.getCell(`J${lastRow}`).value = { formula: `SUM(J2:J${lastRow - 2})` };
    sheet.getCell(`K${lastRow}`).value = { formula: `SUM(K2:K${lastRow - 2})` };
  }

  /**
   * Private: Add payments sheet to workbook
   */
  static async _addPaymentsSheet(workbook, options) {
    const payments = await this.getPaymentHistory({ ...options, status: 'paid' });

    const sheet = workbook.addWorksheet('Payments');

    sheet.columns = [
      { header: 'Invoice Number', key: 'invoiceNumber', width: 15 },
      { header: 'Teacher', key: 'teacher', width: 25 },
      { header: 'Period', key: 'period', width: 12 },
      { header: 'Amount EGP', key: 'amountEGP', width: 15 },
      { header: 'Payment Method', key: 'method', width: 15 },
      { header: 'Transaction ID', key: 'transactionId', width: 20 },
      { header: 'Paid At', key: 'paidAt', width: 20 },
      { header: 'Paid By', key: 'paidBy', width: 25 }
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF70AD47' }
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    payments.payments.forEach(payment => {
      sheet.addRow({
        invoiceNumber: payment.invoiceNumber,
        teacher: payment.teacher.name,
        period: payment.period,
        amountEGP: payment.amountEGP,
        method: payment.paymentInfo?.method || 'N/A',
        transactionId: payment.paymentInfo?.transactionId || 'N/A',
        paidAt: payment.paymentInfo?.paidAt ? dayjs(payment.paymentInfo.paidAt).format('YYYY-MM-DD HH:mm') : 'N/A',
        paidBy: payment.paymentInfo?.paidBy?.name || 'N/A'
      });
    });
  }

  /**
   * Private: Add teachers sheet to workbook
   */
  static async _addTeachersSheet(workbook, options) {
    const { year = new Date().getFullYear() } = options;

    const teachers = await User.find({ role: 'teacher', isActive: true })
      .select('firstName lastName email teacherInfo')
      .lean();

    const sheet = workbook.addWorksheet('Teachers Summary');

    sheet.columns = [
      { header: 'Teacher Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Hourly Rate', key: 'rate', width: 15 },
      { header: 'Total Hours', key: 'totalHours', width: 15 },
      { header: 'Total Earnings USD', key: 'totalUSD', width: 20 },
      { header: 'Total Earnings EGP', key: 'totalEGP', width: 20 },
      { header: 'Invoices Count', key: 'invoiceCount', width: 15 }
    ];

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC000' }
    };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FF000000' } };

    for (const teacher of teachers) {
      const invoices = await TeacherInvoice.find({
        teacher: teacher._id,
        year
      }).lean();

      const totalHours = invoices.reduce((sum, i) => sum + (i.totalHours || 0), 0);
      const totalUSD = invoices.reduce((sum, i) => sum + (i.netAmountUSD || 0), 0);
      const totalEGP = invoices.reduce((sum, i) => sum + (i.netAmountEGP || 0), 0);

      sheet.addRow({
        name: `${teacher.firstName} ${teacher.lastName}`,
        email: teacher.email,
        rate: teacher.teacherInfo?.hourlyRate || 0,
        totalHours: Math.round(totalHours * 100) / 100,
        totalUSD: Math.round(totalUSD * 100) / 100,
        totalEGP: Math.round(totalEGP * 100) / 100,
        invoiceCount: invoices.length
      });
    }
  }

  /**
   * Private: Add dashboard sheet to workbook
   */
  static async _addDashboardSheet(workbook, options) {
    const stats = await this.getDashboardStats(options);

    const sheet = workbook.addWorksheet('Dashboard');

    // Summary section
    sheet.addRow(['DASHBOARD SUMMARY']);
    sheet.getRow(1).font = { bold: true, size: 14 };
    sheet.addRow([]);
    
    sheet.addRow(['Period:', `${stats.period.year} (Months ${stats.period.startMonth}-${stats.period.endMonth})`]);
    sheet.addRow(['Total Teachers:', stats.summary.totalTeachers]);
    sheet.addRow(['Total Invoices:', stats.summary.totalInvoices]);
    sheet.addRow(['Draft Invoices:', stats.summary.draftInvoices]);
    sheet.addRow(['Published Invoices:', stats.summary.publishedInvoices]);
    sheet.addRow(['Paid Invoices:', stats.summary.paidInvoices]);
    sheet.addRow(['Total Hours:', stats.summary.totalHours]);
    sheet.addRow(['Total Amount USD:', stats.summary.totalAmountUSD]);
    sheet.addRow(['Total Amount EGP:', stats.summary.totalAmountEGP]);
    sheet.addRow(['Paid Amount:', stats.summary.paidAmount]);
    sheet.addRow(['Unpaid Amount:', stats.summary.unpaidAmount]);
    sheet.addRow(['Average Hourly Rate:', stats.summary.avgHourlyRate]);

    // Monthly breakdown
    sheet.addRow([]);
    sheet.addRow(['MONTHLY BREAKDOWN']);
    sheet.getRow(sheet.rowCount).font = { bold: true, size: 12 };
    
    sheet.addRow(['Month', 'Invoice Count', 'Total Hours', 'Amount USD', 'Amount EGP', 'Paid Count']);
    sheet.getRow(sheet.rowCount).font = { bold: true };

    stats.monthlyBreakdown.forEach(mb => {
      sheet.addRow([
        mb.month,
        mb.invoiceCount,
        mb.totalHours,
        mb.totalAmountUSD,
        mb.totalAmountEGP,
        mb.paidCount
      ]);
    });

    // Top earners
    sheet.addRow([]);
    sheet.addRow(['TOP EARNERS']);
    sheet.getRow(sheet.rowCount).font = { bold: true, size: 12 };
    
    sheet.addRow(['Teacher', 'Total USD', 'Total Hours', 'Invoices', 'Avg Hourly Rate']);
    sheet.getRow(sheet.rowCount).font = { bold: true };

    stats.topEarners.forEach(te => {
      sheet.addRow([
        te.teacherName,
        te.totalEarningsUSD,
        te.totalHours,
        te.invoiceCount,
        te.avgHourlyRate
      ]);
    });

    // Auto-fit columns
    sheet.columns.forEach(column => {
      column.width = 20;
    });
  }

  /**
   * Get financial forecasting data
   * @param {Object} options - { months }
   * @returns {Promise<Object>} Forecast data
   */
  static async getFinancialForecast(options = {}) {
    try {
      const { months = 3 } = options;
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth() + 1;

      // Get historical data (last 6 months)
      const historicalInvoices = await TeacherInvoice.find({
        $or: [
          { year: currentYear, month: { $lte: currentMonth } },
          { year: currentYear - 1, month: { $gte: 7 } }
        ]
      }).sort({ year: 1, month: 1 }).lean();

      // Calculate averages
      const avgMonthlyInvoices = historicalInvoices.length / 6;
      const avgMonthlyAmount = historicalInvoices.reduce((sum, i) => sum + (i.netAmountEGP || 0), 0) / 6;
      const avgMonthlyHours = historicalInvoices.reduce((sum, i) => sum + (i.totalHours || 0), 0) / 6;

      // Generate forecast
      const forecast = [];
      for (let i = 1; i <= months; i++) {
        let forecastMonth = currentMonth + i;
        let forecastYear = currentYear;
        
        if (forecastMonth > 12) {
          forecastMonth -= 12;
          forecastYear++;
        }

        forecast.push({
          year: forecastYear,
          month: forecastMonth,
          period: `${forecastYear}-${String(forecastMonth).padStart(2, '0')}`,
          estimatedInvoices: Math.round(avgMonthlyInvoices),
          estimatedAmount: Math.round(avgMonthlyAmount * 100) / 100,
          estimatedHours: Math.round(avgMonthlyHours * 100) / 100,
          confidence: 'medium' // Could be enhanced with ML models
        });
      }

      return {
        currentPeriod: { year: currentYear, month: currentMonth },
        historicalAverage: {
          invoices: Math.round(avgMonthlyInvoices * 100) / 100,
          amount: Math.round(avgMonthlyAmount * 100) / 100,
          hours: Math.round(avgMonthlyHours * 100) / 100
        },
        forecast
      };
    } catch (error) {
      console.error('[getFinancialForecast] Error:', error);
      throw error;
    }
  }
}

module.exports = AnalyticsService;
