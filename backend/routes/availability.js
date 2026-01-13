/**
 * Teacher Availability Routes
 * 
 * Handles CRUD operations for teacher availability schedules
 * and availability-based teacher searches.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const AvailabilitySlot = require('../models/AvailabilitySlot');
const UnavailablePeriod = require('../models/UnavailablePeriod');
const User = require('../models/User');
const Class = require('../models/Class');
const availabilityService = require('../services/availabilityService');

// Helper function to convert time string to minutes
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// Helper function to check if time range fits within availability slot
function canFitInSlot(slotStart, slotEnd, requestedStart, requestedEnd) {
  const slotStartMin = timeToMinutes(slotStart);
  const slotEndMin = timeToMinutes(slotEnd);
  const reqStartMin = timeToMinutes(requestedStart);
  const reqEndMin = timeToMinutes(requestedEnd);
  
  return reqStartMin >= slotStartMin && reqEndMin <= slotEndMin;
}

// Helper function to convert day name to number
function dayNameToNumber(dayName) {
  const days = {
    'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
    'thursday': 4, 'friday': 5, 'saturday': 6
  };
  return days[dayName.toLowerCase()];
}

/* ===========================
   AVAILABILITY SLOT ROUTES
   =========================== */

// GET /api/availability/slots/:teacherId - Get teacher's availability slots
router.get('/slots/:teacherId', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;
    
    // Check authorization (teacher can only view own, admin can view any)
    if (req.user.role !== 'admin' && req.user._id.toString() !== teacherId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const [slots, teacher] = await Promise.all([
      AvailabilitySlot.findActiveByTeacher(teacherId),
      User.findById(teacherId).select('role timezone teacherInfo.availabilityStatus')
    ]);

    // If teacher has no active slots, automatically revert to default 24/7 status
    let availabilityStatus = teacher?.teacherInfo?.availabilityStatus || 'default_24_7';
    if (slots.length === 0 && availabilityStatus !== 'default_24_7') {
      availabilityStatus = 'default_24_7';
      await User.findByIdAndUpdate(teacherId, {
        'teacherInfo.availabilityStatus': 'default_24_7'
      });
    }
    
    // Group slots by day for easier frontend handling
    const slotsByDay = slots.reduce((acc, slot) => {
      if (!acc[slot.dayOfWeek]) {
        acc[slot.dayOfWeek] = [];
      }
      acc[slot.dayOfWeek].push(slot);
      return acc;
    }, {});
    
    res.json({
      slots,
      slotsByDay,
      totalSlots: slots.length,
      availabilityStatus,
      isDefaultAvailability: availabilityStatus === 'default_24_7',
      timezone: teacher?.timezone || 'Africa/Cairo'
    });
  } catch (error) {
    console.error('Error fetching availability slots:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /api/availability/slots - Create new availability slot
router.post('/slots', authenticateToken, async (req, res) => {
  try {
    const {
      teacherId,
      dayOfWeek,
      startTime,
      endTime,
      timezone,
      effectiveFrom,
      effectiveTo
    } = req.body;
    
    // Authorization check
    if (req.user.role !== 'admin' && req.user._id.toString() !== teacherId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Validate required fields
    if (!teacherId || dayOfWeek === undefined || !startTime || !endTime) {
      return res.status(400).json({ 
        message: 'teacherId, dayOfWeek, startTime, and endTime are required' 
      });
    }
    
    // Check for overlapping slots
    const existingSlots = await AvailabilitySlot.find({
      teacherId,
      dayOfWeek,
      isActive: true
    });
    
    const hasOverlap = existingSlots.some(slot => 
      slot.hasTimeConflict(startTime, endTime)
    );
    
    if (hasOverlap) {
      return res.status(400).json({ 
        message: 'Time slot conflicts with existing availability' 
      });
    }
    
    const newSlot = new AvailabilitySlot({
      teacherId,
      dayOfWeek,
      startTime,
      endTime,
      timezone: timezone || 'Africa/Cairo',
      effectiveFrom: effectiveFrom || new Date(),
      effectiveTo: effectiveTo || null
    });
    
    await newSlot.save();
    
    // Update teacher's availability status
    await User.findByIdAndUpdate(teacherId, {
      'teacherInfo.availabilityStatus': 'custom_set'
    });
    
    res.status(201).json({
      message: 'Availability slot created successfully',
      slot: newSlot
    });
  } catch (error) {
    console.error('Error creating availability slot:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PUT /api/availability/slots/:slotId - Update availability slot
router.put('/slots/:slotId', authenticateToken, async (req, res) => {
  try {
    const { slotId } = req.params;
    const updates = req.body;
    
    const slot = await AvailabilitySlot.findById(slotId);
    if (!slot) {
      return res.status(404).json({ message: 'Availability slot not found' });
    }
    
    // Authorization check
    if (req.user.role !== 'admin' && req.user._id.toString() !== slot.teacherId.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Check for overlaps if time is being changed
    if (updates.startTime || updates.endTime) {
      const startTime = updates.startTime || slot.startTime;
      const endTime = updates.endTime || slot.endTime;
      
      const existingSlots = await AvailabilitySlot.find({
        _id: { $ne: slotId },
        teacherId: slot.teacherId,
        dayOfWeek: updates.dayOfWeek || slot.dayOfWeek,
        isActive: true
      });
      
      const hasOverlap = existingSlots.some(existingSlot => 
        existingSlot.hasTimeConflict(startTime, endTime)
      );
      
      if (hasOverlap) {
        return res.status(400).json({ 
          message: 'Updated time slot conflicts with existing availability' 
        });
      }
    }
    
    Object.assign(slot, updates);
    await slot.save();
    
    res.json({
      message: 'Availability slot updated successfully',
      slot
    });
  } catch (error) {
    console.error('Error updating availability slot:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE /api/availability/slots/:slotId - Delete availability slot
router.delete('/slots/:slotId', authenticateToken, async (req, res) => {
  try {
    const { slotId } = req.params;
    
    const slot = await AvailabilitySlot.findById(slotId);
    if (!slot) {
      return res.status(404).json({ message: 'Availability slot not found' });
    }
    
    // Authorization check
    if (req.user.role !== 'admin' && req.user._id.toString() !== slot.teacherId.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Check if this deletion would violate minimum requirements
    const teacher = await User.findById(slot.teacherId);
    if (teacher?.teacherInfo?.availabilityConfig?.isAvailabilityRequired) {
      const remainingSlots = await AvailabilitySlot.find({
        _id: { $ne: slotId },
        teacherId: slot.teacherId,
        isActive: true
      });
      
      // Check minimum requirements (simplified validation)
      const { minDaysPerWeek, minHoursPerDay } = teacher.teacherInfo.availabilityConfig;
      const slotsPerDay = remainingSlots.reduce((acc, s) => {
        acc[s.dayOfWeek] = (acc[s.dayOfWeek] || 0) + s.durationMinutes;
        return acc;
      }, {});
      
      const daysWithMinHours = Object.values(slotsPerDay).filter(
        minutes => minutes >= minHoursPerDay * 60
      ).length;
      
      if (daysWithMinHours < minDaysPerWeek) {
        return res.status(400).json({
          message: `Cannot delete slot: Would violate minimum requirement of ${minDaysPerWeek} days per week with ${minHoursPerDay} hours each`
        });
      }
    }
    
    slot.isActive = false;
    await slot.save();

    // If no active slots remain, revert teacher to default 24/7 availability
    const remainingActiveSlots = await AvailabilitySlot.countDocuments({
      teacherId: slot.teacherId,
      isActive: true,
      $or: [
        { effectiveTo: null },
        { effectiveTo: { $gte: new Date() } }
      ]
    });

    if (remainingActiveSlots === 0) {
      await User.findByIdAndUpdate(slot.teacherId, {
        'teacherInfo.availabilityStatus': 'default_24_7'
      });
    }
    
    res.json({
      message: 'Availability slot deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting availability slot:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/* ===========================
   UNAVAILABLE PERIOD ROUTES
   =========================== */

// GET /api/availability/unavailable/:teacherId - Get teacher's unavailable periods
router.get('/unavailable/:teacherId', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;
    const { dateFrom, dateTo } = req.query;
    
    // Authorization check
    if (req.user.role !== 'admin' && req.user._id.toString() !== teacherId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    let dateRange = null;
    if (dateFrom && dateTo) {
      dateRange = {
        start: new Date(dateFrom),
        end: new Date(dateTo)
      };
    }
    
    const periods = await UnavailablePeriod.findActiveByTeacher(teacherId, dateRange);
    
    res.json({
      periods,
      totalPeriods: periods.length
    });
  } catch (error) {
    console.error('Error fetching unavailable periods:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /api/availability/unavailable - Create unavailable period
router.post('/unavailable', authenticateToken, async (req, res) => {
  try {
    const {
      teacherId,
      startDateTime,
      endDateTime,
      reason,
      description
    } = req.body;
    
    // Authorization check
    if (req.user.role !== 'admin' && req.user._id.toString() !== teacherId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const newPeriod = new UnavailablePeriod({
      teacherId,
      startDateTime: new Date(startDateTime),
      endDateTime: new Date(endDateTime),
      reason: reason || 'personal',
      description,
      approvedBy: req.user._id
    });
    
    await newPeriod.save();
    
    res.status(201).json({
      message: 'Unavailable period created successfully',
      period: newPeriod
    });
  } catch (error) {
    console.error('Error creating unavailable period:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/* ===========================
   TEACHER SEARCH ROUTES
   =========================== */

// POST /api/availability/search-teachers - Search for available teachers (now powered by service)
router.post('/search-teachers', authenticateToken, async (req, res) => {
  try {
    const {
      studentAvailability,
      additionalCriteria = {},
      flexibility = {},
      teacherId = null,
      targetTimezone = null
    } = req.body;

    const payload = { studentAvailability, additionalCriteria, flexibility, teacherId };

    // Use service to perform search so behavior is consistent with sharing endpoint
    const { results, message } = await availabilityService.searchTeachersForSharing(payload, targetTimezone);

    return res.json({
      searchCriteria: {
        studentAvailability,
        additionalCriteria,
        searchTimestamp: new Date().toISOString(),
        teacherId: teacherId || undefined,
        targetTimezone: targetTimezone || undefined
      },
      results,
      message
    });
  } catch (error) {
    console.error('Error searching teachers (service):', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /api/availability/share - Build a timezone-converted shareable message with available teachers
router.post('/share', authenticateToken, async (req, res) => {
  try {
    const { studentAvailability, additionalCriteria = {}, flexibility = {}, targetTimezone, teacherId = null } = req.body;
    // Only allow sharing when user is authenticated; teachers and admins allowed
    if (!req.user) return res.status(401).json({ message: 'Unauthorized' });

    const payload = { studentAvailability, additionalCriteria, flexibility, teacherId };
    const { results, message } = await availabilityService.searchTeachersForSharing(payload, targetTimezone);

    res.json({ message, results });
  } catch (error) {
    console.error('Error building share message:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/* ===========================
   VALIDATION ROUTES
   =========================== */

// GET /api/availability/compliance/:teacherId - Check availability compliance
router.get('/compliance/:teacherId', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;
    
    // Authorization check
    if (req.user.role !== 'admin' && req.user._id.toString() !== teacherId) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const availabilityService = require('../services/availabilityService');
    const compliance = await availabilityService.checkAvailabilityCompliance(teacherId);
    
    res.json(compliance);
  } catch (error) {
    console.error('Error checking availability compliance:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /api/availability/validate-class-time - Validate if teacher is available for class
router.post('/validate-class-time', authenticateToken, async (req, res) => {
  try {
    const {
      teacherId,
      startDateTime,
      endDateTime,
      excludeClassId = null
    } = req.body;
    
    const startDate = new Date(startDateTime);
    const endDate = new Date(endDateTime);
    const dayOfWeek = startDate.getUTCDay();
    const startTime = `${String(startDate.getUTCHours()).padStart(2, '0')}:${String(startDate.getUTCMinutes()).padStart(2, '0')}`;
    const endTime = `${String(endDate.getUTCHours()).padStart(2, '0')}:${String(endDate.getUTCMinutes()).padStart(2, '0')}`;
    
    // Check availability slots
    const availableSlots = await AvailabilitySlot.find({
      teacherId,
      dayOfWeek,
      isActive: true,
      startTime: { $lte: startTime },
      endTime: { $gte: endTime }
    });
    
    if (availableSlots.length === 0) {
      return res.json({
        isAvailable: false,
        reason: 'Teacher not available during this time',
        conflictType: 'no_availability'
      });
    }
    
    // Check for unavailable periods
    const unavailableConflict = await UnavailablePeriod.hasConflictForTeacher(
      teacherId,
      startDate,
      endDate
    );
    
    if (unavailableConflict) {
      return res.json({
        isAvailable: false,
        reason: `Teacher marked unavailable: ${unavailableConflict.reason}`,
        conflictType: 'unavailable_period',
        conflictDetails: unavailableConflict
      });
    }
    
    // Check for existing class conflicts
    const classConflicts = await Class.find({
      teacher: teacherId,
      status: { $in: ['scheduled', 'in_progress'] },
      _id: excludeClassId ? { $ne: excludeClassId } : undefined,
      // Half-open interval overlap: existingStart < requestedEnd AND existingEnd > requestedStart
      scheduledDate: { $lt: endDate },
      $expr: {
        $gt: [
          { $add: ['$scheduledDate', { $multiply: ['$duration', 60000] }] },
          startDate
        ]
      }
    }).populate('student.studentId', 'firstName lastName');
    
    if (classConflicts.length > 0) {
      const conflict = classConflicts[0];
      return res.json({
        isAvailable: false,
        reason: `Teacher has existing class with ${conflict.student.studentName} from ${conflict.scheduledDate.toLocaleTimeString()} to ${new Date(conflict.scheduledDate.getTime() + conflict.duration * 60000).toLocaleTimeString()}`,
        conflictType: 'existing_class',
        conflictDetails: conflict
      });
    }
    
    res.json({
      isAvailable: true,
      reason: 'Teacher is available',
      availableSlots
    });
    
  } catch (error) {
    console.error('Error validating class time:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;