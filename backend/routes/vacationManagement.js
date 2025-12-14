/**
 * Unified Vacation Routes
 * 
 * Handles both individual teacher vacations and system-wide vacations
 * Provides a single API endpoint for all vacation management
 */

const express = require('express');
const router = express.Router();
const { 
  authenticateToken, 
  requireAdmin, 
  requireTeacherOrAdmin 
} = require('../middleware/auth');
const Vacation = require('../models/Vacation');
const SystemVacation = require('../models/SystemVacation');
const User = require('../models/User');
const Class = require('../models/Class');
const vacationService = require('../services/vacationService');
const systemVacationService = require('../services/systemVacationService');
const notificationService = require('../services/notificationService');

// ============================================================================
// INDIVIDUAL VACATION ROUTES
// ============================================================================

/**
 * GET /api/vacation-management/individual
 * Get all individual vacations (admin) or my vacations (teacher)
 */
router.get('/individual', authenticateToken, async (req, res) => {
  try {
    let vacations;
    
    if (req.user.role === 'admin') {
      // Admin can see all vacations
      vacations = await Vacation.find()
        .populate('teacher', 'firstName lastName email')
        .populate('substituteTeacher', 'firstName lastName email')
        .sort({ createdAt: -1 });
    } else if (req.user.role === 'teacher') {
      // Teacher can only see their own vacations
      vacations = await Vacation.find({ teacher: req.user.id })
        .populate('substituteTeacher', 'firstName lastName email')
        .sort({ createdAt: -1 });
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json(vacations);
  } catch (error) {
    console.error('Error fetching individual vacations:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/vacation-management/individual
 * Create a new individual vacation request
 */
router.post('/individual', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, reason, studentHandling } = req.body;

    // Validate required fields
    if (!startDate || !endDate || !reason) {
      return res.status(400).json({ 
        message: 'Start date, end date, and reason are required' 
      });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({ 
        message: 'End date must be after start date' 
      });
    }

    if (start < new Date()) {
      return res.status(400).json({ 
        message: 'Start date cannot be in the past' 
      });
    }

    // For teachers creating their own vacation
    const teacherId = req.user.role === 'admin' && req.body.teacherId 
      ? req.body.teacherId 
      : req.user.id;

    // Check for overlapping vacations
    const overlapping = await Vacation.findOne({
      teacher: teacherId,
      status: { $ne: 'rejected' },
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } }
      ]
    });

    if (overlapping) {
      return res.status(400).json({ 
        message: 'You already have a vacation request for this period' 
      });
    }

    // Create vacation
    const vacation = new Vacation({
      teacher: teacherId,
      startDate: start,
      endDate: end,
      reason,
      studentHandling: studentHandling || [],
      status: req.user.role === 'admin' ? 'approved' : 'pending'
    });

    await vacation.save();
    await vacation.populate('teacher', 'firstName lastName email');

    // Send notification to admin if created by teacher
    if (req.user.role === 'teacher') {
      await notificationService.createNotification({
        recipients: { role: 'admin' },
        title: 'New Vacation Request',
        message: `${req.user.firstName} ${req.user.lastName} has requested vacation from ${start.toDateString()} to ${end.toDateString()}`,
        type: 'info',
        relatedTo: 'vacation',
        relatedId: vacation._id
      });
    }

    res.status(201).json(vacation);
  } catch (error) {
    console.error('Error creating individual vacation:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * PUT /api/vacation-management/individual/:id
 * Update individual vacation (approve/reject for admin, edit for teacher if pending)
 */
router.put('/individual/:id', authenticateToken, async (req, res) => {
  try {
    const vacation = await Vacation.findById(req.params.id)
      .populate('teacher', 'firstName lastName email');

    if (!vacation) {
      return res.status(404).json({ message: 'Vacation not found' });
    }

    // Check permissions
    if (req.user.role === 'admin') {
      // Admin can approve/reject any vacation
      const { status, rejectionReason, studentHandling } = req.body;
      
      if (status === 'approved') {
        vacation.status = 'approved';
        if (studentHandling) {
          vacation.studentHandling = studentHandling;
        }
        
        // Apply vacation effects
        await vacationService.applyVacationEffects(vacation);
        
        // Send approval notification
        await notificationService.createNotification({
          recipients: [vacation.teacher._id],
          title: 'Vacation Approved',
          message: `Your vacation request from ${vacation.startDate.toDateString()} to ${vacation.endDate.toDateString()} has been approved`,
          type: 'success',
          relatedTo: 'vacation',
          relatedId: vacation._id
        });
        
      } else if (status === 'rejected') {
        vacation.status = 'rejected';
        vacation.rejectionReason = rejectionReason;
        
        // Send rejection notification
        await notificationService.createNotification({
          recipients: [vacation.teacher._id],
          title: 'Vacation Rejected',
          message: `Your vacation request has been rejected. Reason: ${rejectionReason}`,
          type: 'error',
          relatedTo: 'vacation',
          relatedId: vacation._id
        });
      }
      
    } else if (req.user.role === 'teacher') {
      // Teacher can only edit their own pending vacations
      if (vacation.teacher._id.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      if (vacation.status !== 'pending') {
        return res.status(400).json({ 
          message: 'Cannot edit vacation that is not pending' 
        });
      }
      
      // Update vacation details
      const { startDate, endDate, reason, studentHandling } = req.body;
      
      if (startDate) vacation.startDate = new Date(startDate);
      if (endDate) vacation.endDate = new Date(endDate);
      if (reason) vacation.reason = reason;
      if (studentHandling) vacation.studentHandling = studentHandling;
      
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    await vacation.save();
    res.json(vacation);
  } catch (error) {
    console.error('Error updating individual vacation:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * DELETE /api/vacation-management/individual/:id
 * Delete individual vacation (admin only, or teacher if pending)
 */
router.delete('/individual/:id', authenticateToken, async (req, res) => {
  try {
    const vacation = await Vacation.findById(req.params.id)
      .populate('teacher', 'firstName lastName email');

    if (!vacation) {
      return res.status(404).json({ message: 'Vacation not found' });
    }

    // Check permissions
    if (req.user.role === 'admin') {
      // Admin can delete any vacation
      if (vacation.status === 'approved') {
        // Reverse vacation effects
        await vacationService.reverseVacationEffects(vacation);
      }
    } else if (req.user.role === 'teacher') {
      // Teacher can only delete their own pending vacations
      if (vacation.teacher._id.toString() !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      if (vacation.status !== 'pending') {
        return res.status(400).json({ 
          message: 'Cannot delete vacation that is not pending' 
        });
      }
    } else {
      return res.status(403).json({ message: 'Access denied' });
    }

    await Vacation.findByIdAndDelete(req.params.id);
    res.json({ message: 'Vacation deleted successfully' });
  } catch (error) {
    console.error('Error deleting individual vacation:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================================
// SYSTEM VACATION ROUTES
// ============================================================================

/**
 * GET /api/vacation-management/system
 * Get all system vacations (admin only)
 */
router.get('/system', requireAdmin, async (req, res) => {
  try {
    const systemVacations = await SystemVacation.find()
      .sort({ createdAt: -1 });

    res.json(systemVacations);
  } catch (error) {
    console.error('Error fetching system vacations:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * GET /api/vacation-management/system/current
 * Get currently active system vacation (all users)
 */
router.get('/system/current', authenticateToken, async (req, res) => {
  try {
    const currentVacation = await systemVacationService.getCurrentVacation();
    
    if (currentVacation) {
      res.json({
        isActive: true,
        vacation: currentVacation
      });
    } else {
      res.json({
        isActive: false,
        vacation: null
      });
    }
  } catch (error) {
    console.error('Error getting current system vacation:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message
    });
  }
});

/**
 * POST /api/vacation-management/system
 * Create a new system vacation (admin only)
 */
router.post('/system', requireAdmin, async (req, res) => {
  try {
    const { name, message, startDate, endDate, timezone = 'UTC' } = req.body;

    // Validate required fields
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ 
        message: 'Name, start date, and end date are required' 
      });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({ 
        message: 'End date must be after start date' 
      });
    }

    // Check for overlapping system vacations
    const overlapping = await SystemVacation.findOne({
      $or: [
        { startDate: { $lte: end }, endDate: { $gte: start } }
      ]
    });

    if (overlapping) {
      return res.status(400).json({ 
        message: 'There is already a system vacation for this period' 
      });
    }

    // Create system vacation
    const systemVacation = new SystemVacation({
      name,
      message: message || `${name} - All classes are on hold during this period.`,
      startDate: start,
      endDate: end,
      timezone,
      createdBy: req.user.id
    });

    await systemVacation.save();

    // Apply system vacation effects
    await systemVacationService.applySystemVacation(systemVacation);

    res.status(201).json(systemVacation);
  } catch (error) {
    console.error('Error creating system vacation:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * PUT /api/vacation-management/system/:id
 * Update system vacation (admin only)
 */
router.put('/system/:id', requireAdmin, async (req, res) => {
  try {
    const systemVacation = await SystemVacation.findById(req.params.id);

    if (!systemVacation) {
      return res.status(404).json({ message: 'System vacation not found' });
    }

    const { name, message, startDate, endDate, timezone } = req.body;

    // Update fields if provided
    if (name) systemVacation.name = name;
    if (message) systemVacation.message = message;
    if (timezone) systemVacation.timezone = timezone;
    
    // Handle date changes
    if (startDate || endDate) {
      const newStart = startDate ? new Date(startDate) : systemVacation.startDate;
      const newEnd = endDate ? new Date(endDate) : systemVacation.endDate;
      
      if (newStart >= newEnd) {
        return res.status(400).json({ 
          message: 'End date must be after start date' 
        });
      }
      
      systemVacation.startDate = newStart;
      systemVacation.endDate = newEnd;
    }

    await systemVacation.save();

    // Re-apply system vacation effects if it's currently active
    if (systemVacation.isActive) {
      await systemVacationService.applySystemVacation(systemVacation);
    }

    res.json(systemVacation);
  } catch (error) {
    console.error('Error updating system vacation:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * POST /api/vacation-management/system/:id/terminate
 * Terminate system vacation early (admin only)
 */
router.post('/system/:id/terminate', requireAdmin, async (req, res) => {
  try {
    const systemVacation = await SystemVacation.findById(req.params.id);

    if (!systemVacation) {
      return res.status(404).json({ message: 'System vacation not found' });
    }

    if (!systemVacation.isActive) {
      return res.status(400).json({ 
        message: 'System vacation is not currently active' 
      });
    }

    // Terminate the vacation
    await systemVacationService.endSystemVacation(systemVacation);

    res.json({ message: 'System vacation terminated successfully' });
  } catch (error) {
    console.error('Error terminating system vacation:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

/**
 * DELETE /api/vacation-management/system/:id
 * Delete system vacation (admin only)
 */
router.delete('/system/:id', requireAdmin, async (req, res) => {
  try {
    const systemVacation = await SystemVacation.findById(req.params.id);

    if (!systemVacation) {
      return res.status(404).json({ message: 'System vacation not found' });
    }

    // If vacation is active, end it first
    if (systemVacation.isActive) {
      await systemVacationService.endSystemVacation(systemVacation);
    }

    await SystemVacation.findByIdAndDelete(req.params.id);
    res.json({ message: 'System vacation deleted successfully' });
  } catch (error) {
    console.error('Error deleting system vacation:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================================
// COMBINED/UTILITY ROUTES
// ============================================================================

/**
 * GET /api/vacation-management/stats
 * Get vacation statistics (admin only)
 */
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const individualStats = await Vacation.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const systemStats = await SystemVacation.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: {
            $sum: {
              $cond: ['$isActive', 1, 0]
            }
          }
        }
      }
    ]);

    const currentSystemVacation = await systemVacationService.getCurrentVacation();

    res.json({
      individual: individualStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      system: systemStats[0] || { total: 0, active: 0 },
      currentSystemVacation
    });
  } catch (error) {
    console.error('Error fetching vacation stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;