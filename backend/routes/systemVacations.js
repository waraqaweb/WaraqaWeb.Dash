const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const systemVacationService = require('../services/systemVacationService');

// Create a system vacation (admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, message, startDate, endDate, timezone } = req.body;

    // Validate required fields
    if (!name || !message || !startDate || !endDate || !timezone) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    if (end <= start) {
      return res.status(400).json({ message: 'End date must be after start date' });
    }

    // Check for overlapping system vacations
    const existingVacation = await systemVacationService.getActiveSystemVacationForDate(start);
    if (existingVacation) {
      return res.status(400).json({ 
        message: `There is already an active system vacation "${existingVacation.name}" during this period` 
      });
    }

    const systemVacation = await systemVacationService.createSystemVacation({
      name,
      message,
      startDate: start,
      endDate: end,
      timezone,
      createdBy: req.user._id
    });

    res.status(201).json({
      message: 'System vacation created successfully',
      systemVacation
    });
  } catch (err) {
    console.error('Error creating system vacation:', err);
    res.status(500).json({ message: 'Failed to create system vacation' });
  }
});

// Get all system vacations (admin only)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { active } = req.query;
    const filters = {};
    
    if (active === 'true') {
      filters.isActive = true;
    } else if (active === 'false') {
      filters.isActive = false;
    }

    const systemVacations = await systemVacationService.getAllSystemVacations(filters);
    res.json({ systemVacations });
  } catch (err) {
    console.error('Error getting system vacations:', err);
    res.status(500).json({ message: 'Failed to get system vacations' });
  }
});

// Get current active system vacation (for all users)
router.get('/current', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const activeVacation = await systemVacationService.getActiveSystemVacationForDate(now);
    
    if (activeVacation) {
      res.json({ 
        isActive: true,
        vacation: activeVacation 
      });
    } else {
      res.json({ 
        isActive: false,
        vacation: null 
      });
    }
  } catch (err) {
    console.error('Error getting current system vacation:', err);
    res.status(500).json({ message: 'Failed to get current system vacation' });
  }
});

// End a system vacation early (admin only)
router.post('/:id/end', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await systemVacationService.endSystemVacation(id, req.user._id);
    
    res.json({
      message: 'System vacation ended successfully',
      restoredClasses: result.restoredCount,
      vacation: result.systemVacation
    });
  } catch (err) {
    console.error('Error ending system vacation:', err);
    res.status(500).json({ message: err.message || 'Failed to end system vacation' });
  }
});

// Check and restore expired system vacations (admin only)
router.post('/check-expired', requireAuth, requireAdmin, async (req, res) => {
  try {
    await systemVacationService.checkAndRestoreExpiredSystemVacations();
    res.json({ message: 'Expired system vacations checked and processed' });
  } catch (err) {
    console.error('Error checking expired system vacations:', err);
    res.status(500).json({ message: 'Failed to check expired system vacations' });
  }
});

module.exports = router;