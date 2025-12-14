/**
 * Invoice Check Middleware
 * 
 * Automatically checks for zero-hour balances and creates invoices
 * when student hours are updated or classes are attended
 */

const InvoiceService = require('../services/invoiceService');
const User = require('../models/User');

/**
 * Middleware to check for zero-hour balances after student hour updates
 */
const checkZeroHourBalances = async (req, res, next) => {
  try {
    // Store the original response.json method
    const originalJson = res.json;
    
    // Override res.json to intercept the response
    res.json = function(data) {
      // Call the original json method first
      originalJson.call(this, data);
      
      // Then perform our check asynchronously (don't block the response)
      setImmediate(async () => {
        try {
          // Only check if the operation was successful
          if (data && data.success) {
            // Check if this was a student hour update
            const isStudentUpdate = req.route && req.route.path && 
              (req.route.path.includes('/users/:id') || req.route.path.includes('/students'));
            
            const isClassAttendance = req.route && req.route.path && 
              req.route.path.includes('/classes') && req.route.path.includes('/attendance');
            
            if (isStudentUpdate || isClassAttendance) {
              console.log('Checking for zero-hour balances after student update...');
              await InvoiceService.checkAndCreateZeroHourInvoices();
            }
          }
        } catch (error) {
          console.error('Error in zero-hour balance check:', error);
          // Don't throw error as this is a background process
        }
      });
    };
    
    next();
  } catch (error) {
    console.error('Error in invoice check middleware:', error);
    next(); // Continue with the request even if middleware fails
  }
};

/**
 * Middleware to check specific student for zero hours
 */
const checkStudentZeroHours = async (studentId) => {
  try {
    const student = await User.findById(studentId).populate('guardian');
    
    if (!student || student.role !== 'student') {
      return { success: false, message: 'Student not found' };
    }
    
    if (student.studentInfo && student.studentInfo.hoursLeft <= 0) {
      console.log(`Student ${student.firstName} ${student.lastName} has zero hours, checking for invoice generation...`);
      
      // Check if there's already a recent invoice
      const Invoice = require('../models/Invoice');
      const recentInvoice = await Invoice.findOne({
        guardian: student.guardian._id,
        'items.student': student._id,
        status: { $in: ['draft', 'sent'] },
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      });
      
      if (!recentInvoice) {
        const invoice = await InvoiceService.createZeroHourInvoice(student);
        return { 
          success: true, 
          invoiceCreated: true, 
          invoice,
          message: `Invoice created for ${student.firstName} ${student.lastName}` 
        };
      } else {
        return { 
          success: true, 
          invoiceCreated: false, 
          message: 'Recent invoice already exists' 
        };
      }
    }
    
    return { 
      success: true, 
      invoiceCreated: false, 
      message: 'Student has sufficient hours' 
    };
    
  } catch (error) {
    console.error('Error checking student zero hours:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Scheduled task to check all students for zero hours
 */
const scheduleZeroHourCheck = () => {
  // Run every hour
  setInterval(async () => {
    try {
      console.log('Running scheduled zero-hour check...');
      const result = await InvoiceService.scheduleInvoiceGeneration();
      
      if (result.success && result.invoicesCreated > 0) {
        console.log(`Scheduled check: Created ${result.invoicesCreated} new invoices`);
      }
    } catch (error) {
      console.error('Error in scheduled zero-hour check:', error);
    }
  }, 60 * 60 * 1000); // 1 hour in milliseconds
};

/**
 * Manual trigger for zero-hour check (for testing or admin use)
 */
const triggerZeroHourCheck = async () => {
  try {
    console.log('Manually triggering zero-hour check...');
    const result = await InvoiceService.checkAndCreateZeroHourInvoices();
    return result;
  } catch (error) {
    console.error('Error in manual zero-hour check:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Check if student needs invoice after class attendance
 */
const checkAfterClassAttendance = async (classData) => {
  try {
    if (!classData || !classData.students) {
      return { success: false, message: 'Invalid class data' };
    }
    
    const invoicesCreated = [];
    
    for (const studentId of classData.students) {
      const result = await checkStudentZeroHours(studentId);
      if (result.success && result.invoiceCreated) {
        invoicesCreated.push(result.invoice);
      }
    }
    
    return {
      success: true,
      invoicesCreated: invoicesCreated.length,
      invoices: invoicesCreated
    };
    
  } catch (error) {
    console.error('Error checking after class attendance:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  checkZeroHourBalances,
  checkStudentZeroHours,
  scheduleZeroHourCheck,
  triggerZeroHourCheck,
  checkAfterClassAttendance
};

