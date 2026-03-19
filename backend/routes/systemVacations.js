const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const SystemVacation = require('../models/SystemVacation');
const Class = require('../models/Class');
const systemVacationService = require('../services/systemVacationService');

const buildAffectedClassesQuery = (startDate, endDate) => ({
  scheduledDate: {
    $gte: startDate,
    $lte: endDate,
  },
  status: { $in: ['scheduled', 'in_progress'] },
});

const buildImpactClassesQuery = (startDate, endDate) => ({
  scheduledDate: {
    $gte: startDate,
    $lte: endDate,
  },
  status: { $in: ['scheduled', 'in_progress', 'on_hold'] },
});

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

    const existingVacation = await systemVacationService.getOverlappingSystemVacation(start, end);
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
    const includeUpcoming = String(req.query?.includeUpcoming || '').trim().toLowerCase() === 'true';
    const vacation = includeUpcoming
      ? await systemVacationService.getCurrentOrUpcomingVacation(now)
      : await systemVacationService.getActiveSystemVacationForDate(now);

    if (vacation) {
      const isActive = vacation.startDate <= now && vacation.endDate >= now;
      res.json({ 
        isActive,
        isUpcoming: includeUpcoming ? !isActive : false,
        vacation,
      });
    } else {
      res.json({ 
        isActive: false,
        isUpcoming: false,
        vacation: null 
      });
    }
  } catch (err) {
    console.error('Error getting current system vacation:', err);
    res.status(500).json({ message: 'Failed to get current system vacation' });
  }
});

// Get impact details for a system vacation (admin only)
router.get('/:id/impact', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const systemVacation = await SystemVacation.findById(id)
      .populate('createdBy', 'firstName lastName fullName email');

    if (!systemVacation) {
      return res.status(404).json({ message: 'System vacation not found' });
    }

    const classes = await Class.find(buildImpactClassesQuery(systemVacation.startDate, systemVacation.endDate))
      .populate('teacher', 'firstName lastName fullName email')
      .select('_id scheduledDate duration subject teacher student status')
      .sort({ scheduledDate: 1 })
      .lean();

    const grouped = new Map();
    let totalMinutes = 0;

    for (const cls of classes) {
      const studentId = String(cls?.student?.studentId || 'unknown');
      const guardianId = String(cls?.student?.guardianId || '');
      const key = `${studentId}:${guardianId}`;
      const duration = Number(cls?.duration) || 0;
      totalMinutes += duration;

      if (!grouped.has(key)) {
        grouped.set(key, {
          studentId,
          studentName: cls?.student?.studentName || 'Student',
          guardianName: null,
          guardianEmail: null,
          configuredHandling: { handling: 'hold' },
          firstClassStart: cls?.scheduledDate || null,
          lastClassEnd: cls?.scheduledDate
            ? new Date(new Date(cls.scheduledDate).getTime() + duration * 60 * 1000)
            : null,
          classes: [],
        });
      }

      const entry = grouped.get(key);
      const classEnd = cls?.scheduledDate
        ? new Date(new Date(cls.scheduledDate).getTime() + duration * 60 * 1000)
        : null;

      if (!entry.firstClassStart || new Date(cls.scheduledDate) < new Date(entry.firstClassStart)) {
        entry.firstClassStart = cls.scheduledDate;
      }
      if (classEnd && (!entry.lastClassEnd || classEnd > new Date(entry.lastClassEnd))) {
        entry.lastClassEnd = classEnd;
      }

      entry.classes.push({
        classId: cls._id,
        scheduledDate: cls.scheduledDate,
        duration: cls.duration,
        subject: cls.subject,
        teacherName: cls.teacher
          ? (cls.teacher.fullName || `${cls.teacher.firstName || ''} ${cls.teacher.lastName || ''}`.trim() || cls.teacher.email)
          : null,
        status: cls.status,
      });
    }

    const impact = {
      totalStudents: grouped.size,
      totalClasses: classes.length,
      totalMinutes,
      students: Array.from(grouped.values()),
    };

    res.json({
      vacation: systemVacation,
      impact,
    });
  } catch (err) {
    console.error('Error fetching system vacation impact:', err);
    res.status(500).json({ message: 'Failed to load system vacation impact' });
  }
});

// Update a system vacation (admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, message, startDate, endDate, timezone } = req.body;

    const systemVacation = await SystemVacation.findById(id);
    if (!systemVacation) {
      return res.status(404).json({ message: 'System vacation not found' });
    }

    if (!name || !message || !startDate || !endDate || !timezone) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }

    const nextStart = new Date(startDate);
    const nextEnd = new Date(endDate);

    if (Number.isNaN(nextStart.getTime()) || Number.isNaN(nextEnd.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    if (nextEnd <= nextStart) {
      return res.status(400).json({ message: 'End date must be after start date' });
    }

    const overlappingVacation = await SystemVacation.findOne({
      _id: { $ne: systemVacation._id },
      isActive: true,
      startDate: { $lt: nextEnd },
      endDate: { $gt: nextStart },
    }).sort({ startDate: 1 });

    if (overlappingVacation) {
      return res.status(400).json({
        message: `There is already an active system vacation "${overlappingVacation.name}" during this period`
      });
    }

    const periodChanged = (
      systemVacation.startDate.getTime() !== nextStart.getTime() ||
      systemVacation.endDate.getTime() !== nextEnd.getTime()
    );

    systemVacation.name = name;
    systemVacation.message = message;
    systemVacation.startDate = nextStart;
    systemVacation.endDate = nextEnd;
    systemVacation.timezone = timezone;
    systemVacation.affectedClasses = await Class.countDocuments(buildAffectedClassesQuery(nextStart, nextEnd));
    await systemVacation.save();

    if (systemVacation.isActive && periodChanged) {
      await systemVacationService.restoreClassesAfterSystemVacation(systemVacation._id);
      await systemVacationService.putClassesOnHold(systemVacation);
    }

    res.json({
      message: 'System vacation updated successfully',
      systemVacation,
    });
  } catch (err) {
    console.error('Error updating system vacation:', err);
    res.status(500).json({ message: 'Failed to update system vacation' });
  }
});

// Delete a system vacation (admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const systemVacation = await SystemVacation.findById(id);

    if (!systemVacation) {
      return res.status(404).json({ message: 'System vacation not found' });
    }

    if (systemVacation.isActive) {
      await systemVacationService.endSystemVacation(id, req.user._id);
    }

    await SystemVacation.findByIdAndDelete(id);

    res.json({ message: 'System vacation deleted successfully' });
  } catch (err) {
    console.error('Error deleting system vacation:', err);
    res.status(500).json({ message: 'Failed to delete system vacation' });
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