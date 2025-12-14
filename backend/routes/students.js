/**
 * Student Management Routes
 * 
 * Handles CRUD operations for students using the new standalone Student model
 * Students are managed by guardians and don't have separate user accounts
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Student = require('../models/Student');
const Guardian = require('../models/Guardian');
const {
  authenticateToken,
  authorizeRoles,
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

/**
 * Get all students with pagination, search, and filtering
 * GET /api/students
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = "", 
      sortBy = "createdAt", 
      order = "desc",
      status,
      guardianId 
    } = req.query;
    
    // Build query for search and filtering
    const query = {};
    
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    
    if (status) {
      query.status = status;
    }
    
    if (guardianId) {
      query.guardian = guardianId;
    }
    
    // If user is a guardian, only show their students
    if (req.user.role === 'guardian') {
      query.guardian = req.user._id;
    }
    
    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = order === "desc" ? -1 : 1;

    const students = await Student.find(query)
      .populate('guardian', 'firstName lastName email phone')
      .populate('currentTeachers', 'firstName lastName email')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort(sortOptions);
    
    const total = await Student.countDocuments(query);
    
    res.json({
      students,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
    
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({
      message: 'Failed to fetch students',
      error: error.message,
    });
  }
});

/**
 * Get student by ID
 * GET /api/students/:id
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const student = await Student.findById(req.params.id)
      .populate('guardian', 'firstName lastName email phone')
      .populate('currentTeachers', 'firstName lastName email');
    
    if (!student) {
      return res.status(404).json({
        message: 'Student not found',
      });
    }
    
    // Check authorization (guardians can only view their students, admins can view any)
    if (req.user.role === 'guardian') {
      const guardianId = student.guardian._id || student.guardian;
      if (guardianId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          message: 'You are not authorized to view this student',
        });
      }
    }
    
    res.json({ student });
    
  } catch (error) {
    console.error('Get student error:', error);
    res.status(500).json({
      message: 'Failed to fetch student',
      error: error.message,
    });
  }
});

/**
 * Create new student
 * POST /api/students
 */
router.post('/', authenticateToken, [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('guardian')
    .isMongoId()
    .withMessage('Valid guardian ID is required'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const {
      firstName,
      lastName,
      email,
      guardian: guardianId,
      spokenLanguages,
      learningPreferences,
      dateOfBirth,
      gender
    } = req.body;

    // Verify guardian exists and is actually a guardian
    const guardian = await User.findById(guardianId);
    if (!guardian || guardian.role !== 'guardian') {
      return res.status(404).json({
        message: 'Guardian not found or invalid',
      });
    }

    // Admin cannot enroll themselves as students
    if (req.user.role === 'admin' && req.user._id.toString() === guardianId) {
      return res.status(403).json({
        message: 'Admin cannot enroll themselves as students',
      });
    }

    // Teachers cannot add students
    if (req.user.role === 'teacher') {
      return res.status(403).json({
        message: 'Teachers cannot add new students',
      });
    }

    // Check authorization (guardians can only add to their own account, admins can add to any)
    if (req.user.role === 'guardian' && req.user._id.toString() !== guardianId) {
      return res.status(403).json({
        message: 'You can only add students to your own account',
      });
    }

    // Check for self-enrollment (guardian enrolling themselves)
    if (isSelfEnrollment) {
      // Check if guardian already enrolled themselves
      const existingSelfEnrollment = await Student.findOne({
        guardian: guardianId,
        selfGuardian: true
      });

      if (existingSelfEnrollment) {
        return res.status(409).json({
          message: 'You have already enrolled yourself as a student',
        });
      }

      // Use guardian's information for self-enrollment
      const student = new Student({
        firstName: guardian.firstName,
        lastName: guardian.lastName,
        email: guardian.email,
        guardian: guardianId,
        phone: guardian.phone,
        gender: guardian.gender || 'male',
        dateOfBirth: guardian.dateOfBirth,
        selfGuardian: true,
        spokenLanguages: spokenLanguages || [],
        subjects: subjects || [],
        learningPreferences: learningPreferences || '',
        status: 'active'
      });

      await student.save();

      // Update Guardian model to include this student
      await Guardian.findOneAndUpdate(
        { user: guardianId },
        { $push: { students: student._id } },
        { upsert: true }
      );

      res.status(201).json({
        message: 'Successfully enrolled yourself as a student',
        student,
      });
    } else {
      // Regular student creation
      const student = new Student({
        firstName,
        lastName,
        email,
        guardian: guardianId,
        spokenLanguages: spokenLanguages || [],
        subjects: subjects || [],
        phone: phone || '',
        learningPreferences: learningPreferences || '',
        dateOfBirth: dateOfBirth || null,
        gender: gender || 'male',
        selfGuardian: false,
        status: 'active'
      });

      await student.save();

      // Update Guardian model to include this student
      await Guardian.findOneAndUpdate(
        { user: guardianId },
        { $push: { students: student._id } },
        { upsert: true }
      );

      res.status(201).json({
        message: 'Student created successfully',
        student,
      });
    }
    
  } catch (error) {
    console.error('Create student error:', error);
    res.status(500).json({
      message: 'Failed to create student',
      error: error.message,
    });
  }
});

/**
 * Update student
 * PUT /api/students/:id
 */
router.put('/:id', authenticateToken, [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array(),
      });
    }

    const { id } = req.params;
    const updates = req.body;

    // Filter out undefined fields to avoid overwriting with undefined values
    const filteredUpdates = Object.keys(updates).reduce((acc, key) => {
      if (updates[key] !== undefined && updates[key] !== null) {
        acc[key] = updates[key];
      }
      return acc;
    }, {});

    // Update student
    const updatedStudent = await Student.findByIdAndUpdate(
      id, 
      filteredUpdates, 
      { new: true, runValidators: true }
    ).populate('guardian', 'firstName lastName email phone')
     .populate('currentTeachers', 'firstName lastName email');

    res.json({
      message: 'Student updated successfully',
      student: updatedStudent,
    });
    
  } catch (error) {
    console.error('Update student error:', error);
    res.status(500).json({
      message: 'Failed to update student',
      error: error.message,
    });
  }
});

/**
 * Admin: Update student status
 * PUT /api/students/:id/status
 */
router.put('/:id/status', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ 
        message: 'Status must be active, inactive, or suspended' 
      });
    }

    const student = await Student.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    ).populate('guardian', 'firstName lastName email phone');

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json({
      message: `Student status updated to ${status}`,
      student,
    });
  } catch (error) {
    console.error('Update student status error:', error);
    res.status(500).json({
      message: 'Failed to update student status',
      error: error.message,
    });
  }
});

/**
 * Admin: Update student hours
 * PUT /api/students/:id/hours
 */
router.put('/:id/hours', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    // Removed hours logic for students
    return res.status(400).json({ message: 'Student hours management is no longer supported.' });
  } catch (error) {
    console.error('Update student hours error:', error);
    res.status(500).json({
      message: 'Failed to update student hours',
      error: error.message,
    });
  }
});

/**
 * Get students by guardian ID
 * GET /api/students/guardian/:guardianId
 */
router.get('/guardian/:guardianId', authenticateToken, async (req, res) => {
  try {
    const { guardianId } = req.params;

    // Check authorization
    if (req.user.role === 'guardian' && req.user._id.toString() !== guardianId) {
      return res.status(403).json({
        message: 'You can only view your own students',
      });
    }

    const students = await Student.findByGuardian(guardianId);
    
    res.json({ students });
    
  } catch (error) {
    console.error('Get students by guardian error:', error);
    res.status(500).json({
      message: 'Failed to fetch students for guardian',
      error: error.message,
    });
  }
});


// GET /students?guardianId=xxx
router.get('/', async (req, res) => {
  const { guardianId, page = 1, limit = 100 } = req.query;

  if (!guardianId) {
    return res.status(400).json({ message: 'guardianId query parameter is required' });
  }

  try {
    // Query only students belonging to this guardian
    const query = { guardian: guardianId };

    // Fetch students with pagination and sorting by lastName ascending by default
    const students = await Student.find(query)
      .select('firstName lastName email') // add fields you want to send
      .sort({ lastName: 1, firstName: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean({ virtuals: true }); // enables virtuals like fullName

    // If you want to explicitly add fullName on each (if virtuals don't work for some reason):
    // const studentsWithFullName = students.map(s => ({
    //   ...s,
    //   fullName: `${s.firstName} ${s.lastName}`
    // }));

    res.json({ students }); // or { students: studentsWithFullName }
  } catch (err) {
    console.error('Error fetching students by guardian:', err);
    res.status(500).json({ message: 'Failed to fetch students' });
  }
});
/**
 * Delete student (Admin only)
 * DELETE /api/students/:id
 */
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const student = await Student.findById(id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Remove student from Guardian model
    await Guardian.findOneAndUpdate(
      { user: student.guardian },
      { $pull: { students: student._id } }
    );

    // Delete the student
    await Student.findByIdAndDelete(id);

    res.json({
      message: 'Student deleted successfully',
    });
  } catch (error) {
    console.error('Delete student error:', error);
    res.status(500).json({
      message: 'Failed to delete student',
      error: error.message,
    });
  }
});

module.exports = router;

