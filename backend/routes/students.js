/**
 * Student Management Routes
 * 
 * Handles CRUD operations for students using the new standalone Student model
 * Students are managed by guardians and don't have separate user accounts
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const EvaluationSession = require('../models/EvaluationSession');
const Class = require('../models/Class');
const Guardian = require('../models/Guardian');
const notificationService = require('../services/notificationService');
const {
  authenticateToken,
  authorizeRoles,
  requireAdmin,
} = require('../middleware/auth');

const router = express.Router();

const buildStudentProfilePictureFromGuardian = (guardian) => {
  if (!guardian?.profilePicture && !guardian?.profilePicturePublicId && !guardian?.profilePictureThumbnail && !guardian?.profilePictureThumbnailPublicId) {
    return undefined;
  }

  return {
    url: guardian.profilePicture || null,
    publicId: guardian.profilePicturePublicId || null,
    thumbnail: guardian.profilePictureThumbnail || guardian.profilePicture || null,
    thumbnailPublicId: guardian.profilePictureThumbnailPublicId || null,
  };
};

const normalizeNameKey = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z]/g, '');

const splitNameParts = (value = '') => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .split(/\s+/)
  .map((part) => part.replace(/[^a-z]/g, ''))
  .filter(Boolean);

const stripVowels = (value = '') => String(value || '').replace(/[aeiou]/g, '');

const consonantSkeleton = (value = '') => normalizeNameKey(value).replace(/[aeiou]/g, '');

const escapeRegex = (value = '') => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const levenshteinDistance = (a = '', b = '') => {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[s.length][t.length];
};

const similarityScore = (a = '', b = '') => {
  const aa = normalizeNameKey(a);
  const bb = normalizeNameKey(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  const maxLen = Math.max(aa.length, bb.length) || 1;
  const base = 1 - (levenshteinDistance(aa, bb) / maxLen);
  const av = consonantSkeleton(aa);
  const bv = consonantSkeleton(bb);
  const vow = av && bv
    ? 1 - (levenshteinDistance(av, bv) / Math.max(av.length, bv.length, 1))
    : 0;
  return Math.max(base, vow * 0.95);
};

const tokenOverlapScore = (a = '', b = '') => {
  const aa = new Set(splitNameParts(a));
  const bb = new Set(splitNameParts(b));
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += 1;
  }
  return overlap / Math.max(Math.min(aa.size, bb.size), 1);
};

const formatEvalDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const buildEvaluationSummaryText = ({ session, sessionStudent }) => {
  const marker = `[[EVAL_SYNC:${session._id}:${sessionStudent._id}]]`;
  const lines = [marker];
  const when = formatEvalDate(session.endedAt || session.updatedAt || session.createdAt);
  lines.push(`Evaluation imported from ${session.title || 'Evaluation session'}${when ? ` (${when})` : ''}.`);
  lines.push(`Matched evaluation student: ${sessionStudent.name || 'Student'}.`);

  const recLevels = Array.isArray(sessionStudent.recommendedLevels) ? sessionStudent.recommendedLevels.filter(Boolean) : [];
  if (recLevels.length) lines.push(`Recommended levels: ${recLevels.join(', ')}.`);
  else if (sessionStudent.recommendedLevel) lines.push(`Recommended level: ${sessionStudent.recommendedLevel}.`);

  const strengths = Array.isArray(sessionStudent.strengths) ? sessionStudent.strengths.filter(Boolean) : [];
  if (strengths.length) lines.push(`Strengths: ${strengths.slice(0, 5).join(', ')}.`);

  const weaknesses = Array.isArray(sessionStudent.weaknesses)
    ? sessionStudent.weaknesses.map((w) => w?.area).filter(Boolean)
    : [];
  if (weaknesses.length) lines.push(`Weakness focus: ${weaknesses.slice(0, 6).join(', ')}.`);

  if (sessionStudent.adminSummary) lines.push(`Admin summary: ${sessionStudent.adminSummary}`);
  if (sessionStudent.generalNotes) lines.push(`Evaluation notes: ${sessionStudent.generalNotes}`);

  return lines.join('\n');
};

const mergeAdminEvaluationSummary = ({ existing = '', incoming = '' }) => {
  const current = String(existing || '').trim();
  const next = String(incoming || '').trim();
  if (!next) return current;
  const marker = next.split('\n')[0];
  if (marker && current.includes(marker)) return current;
  if (!current) return next;
  return `${current}\n\n${next}`;
};

const findBestEvaluationSummaryForStudent = async ({ guardian, firstName, lastName }) => {
  const guardianEmail = String(guardian?.email || '').trim().toLowerCase();
  const guardianName = `${guardian?.firstName || ''} ${guardian?.lastName || ''}`.trim();
  const targetFullName = `${firstName || ''} ${lastName || ''}`.trim();
  const targetFirstName = String(firstName || '').trim();
  const targetFirstNameKey = normalizeNameKey(targetFirstName);
  const firstRegex = targetFirstNameKey ? new RegExp(`^${escapeRegex(targetFirstName)}`, 'i') : null;

  const baseOr = [];
  if (guardianEmail) baseOr.push({ 'students.contactEmail': guardianEmail });
  if (firstRegex) baseOr.push({ 'students.name': firstRegex });
  if (!baseOr.length) return null;

  const sessions = await EvaluationSession.find({
    status: 'completed',
    $or: baseOr,
  })
    .sort({ endedAt: -1, updatedAt: -1 })
    .limit(120)
    .select('title endedAt updatedAt createdAt students.name students.contactName students.contactEmail students.adminSummary students.generalNotes students.recommendedLevel students.recommendedLevels students.weaknesses students.strengths')
    .lean();

  let best = null;
  for (const session of sessions) {
    for (const sessionStudent of (session.students || [])) {
      let score = 0;
      let strongSignal = false;
      const contactEmail = String(sessionStudent.contactEmail || '').trim().toLowerCase();
      if (guardianEmail && contactEmail && contactEmail === guardianEmail) {
        score += 6;
        strongSignal = true;
      }

      if (guardianName && sessionStudent.contactName) {
        const guardianSim = similarityScore(guardianName, sessionStudent.contactName);
        if (guardianSim >= 0.82) {
          score += 2.75;
          strongSignal = true;
        }
      }

      const fullSim = similarityScore(targetFullName, sessionStudent.name || '');
      const firstSim = similarityScore(targetFirstName || '', (sessionStudent.name || '').split(/\s+/)[0] || '');
      const tokenSim = tokenOverlapScore(targetFullName, sessionStudent.name || '');
      const skeletonSim = similarityScore(consonantSkeleton(targetFullName), consonantSkeleton(sessionStudent.name || ''));

      score += (fullSim * 6.5) + (firstSim * 3.25) + (tokenSim * 1.75) + (skeletonSim * 2.25);

      if (fullSim >= 0.88 || skeletonSim >= 0.92 || tokenSim >= 0.5) {
        strongSignal = true;
      }

      if (!strongSignal && fullSim < 0.55 && firstSim < 0.62 && skeletonSim < 0.75) continue;

      if (!best || score > best.score) {
        best = { score, session, sessionStudent };
      }
    }
  }

  if (!best || best.score < 8.25) return null;

  return {
    summaryText: buildEvaluationSummaryText({
      session: best.session,
      sessionStudent: best.sessionStudent,
    }),
    source: {
      sessionId: best.session._id,
      sessionTitle: best.session.title || 'Evaluation session',
      sessionStudentId: best.sessionStudent._id || null,
      linkedAt: new Date(),
      score: best.score,
    },
  };
};

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
  body('dateOfBirth')
    .notEmpty()
    .isISO8601()
    .withMessage('Date of birth is required'),
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
      phone,
      whatsapp,
      grade,
      school,
      language,
      timezone,
      subjects,
      learningPreferences,
      evaluationSummary,
      notes,
      dateOfBirth,
      gender,
      hoursRemaining,
      isActive,
      selfGuardian,
    } = req.body;

    const isSelfEnrollment = !!selfGuardian;

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
    const mirrorStandaloneToEmbedded = async (studentDoc) => {
      try {
        const guardianUser = await User.findById(guardianId);
        if (!guardianUser || guardianUser.role !== 'guardian') return;

        if (!guardianUser.guardianInfo || typeof guardianUser.guardianInfo !== 'object') {
          guardianUser.guardianInfo = { students: [] };
        }
        if (!Array.isArray(guardianUser.guardianInfo.students)) {
          guardianUser.guardianInfo.students = [];
        }

        const keyEmail = (studentDoc.email || '').trim().toLowerCase();
        const keyDob = studentDoc.dateOfBirth ? new Date(studentDoc.dateOfBirth).toISOString().slice(0, 10) : '';
        const keyFirst = (studentDoc.firstName || '').trim().toLowerCase();
        const keyLast = (studentDoc.lastName || '').trim().toLowerCase();

        let embedded = null;
        if (studentDoc.selfGuardian) {
          embedded = guardianUser.guardianInfo.students.find((s) => s.selfGuardian === true);
        } else if (keyEmail) {
          embedded = guardianUser.guardianInfo.students.find((s) => String(s.email || '').trim().toLowerCase() === keyEmail);
        } else if (keyDob) {
          embedded = guardianUser.guardianInfo.students.find((s) => {
            const sFirst = (s.firstName || '').trim().toLowerCase();
            const sLast = (s.lastName || '').trim().toLowerCase();
            const sDob = s.dateOfBirth ? new Date(s.dateOfBirth).toISOString().slice(0, 10) : '';
            return sFirst === keyFirst && sLast === keyLast && sDob === keyDob;
          });
        }

        if (!embedded) {
          guardianUser.guardianInfo.students.push({
            firstName: studentDoc.firstName,
            lastName: studentDoc.lastName,
            email: studentDoc.email,
            grade: studentDoc.grade,
            school: studentDoc.school,
            language: studentDoc.language,
            subjects: Array.isArray(studentDoc.subjects) ? studentDoc.subjects : [],
            phone: studentDoc.phone,
            whatsapp: studentDoc.whatsapp,
            learningPreferences: studentDoc.learningPreferences,
            evaluation: studentDoc.evaluation,
            evaluationSummary: studentDoc.evaluationSummary,
            dateOfBirth: studentDoc.dateOfBirth,
            gender: studentDoc.gender,
            timezone: studentDoc.timezone,
            profilePicture: studentDoc.profilePicture || undefined,
            isActive: typeof studentDoc.isActive === 'boolean' ? studentDoc.isActive : true,
            hoursRemaining: typeof studentDoc.hoursRemaining === 'number' ? studentDoc.hoursRemaining : 0,
            selfGuardian: !!studentDoc.selfGuardian,
            totalClassesAttended: studentDoc.totalClassesAttended || 0,
            currentTeachers: Array.isArray(studentDoc.currentTeachers) ? studentDoc.currentTeachers : [],
            notes: studentDoc.notes,
            standaloneStudentId: studentDoc._id,
          });
        } else if (!embedded.standaloneStudentId) {
          embedded.standaloneStudentId = studentDoc._id;
        }

        await guardianUser.save();
      } catch (mirrorErr) {
        console.warn('Failed to mirror standalone student into embedded guardianInfo.students', mirrorErr && mirrorErr.message);
      }
    };

    const importedEvaluationMatch = await findBestEvaluationSummaryForStudent({
      guardian,
      firstName,
      lastName,
    });
    const importedEvaluationSummary = importedEvaluationMatch?.summaryText || '';
    const mergedEvaluationSummary = mergeAdminEvaluationSummary({
      existing: evaluationSummary || '',
      incoming: importedEvaluationSummary || '',
    });

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
        dateOfBirth: guardian.dateOfBirth || dateOfBirth,
        selfGuardian: true,
        grade: grade || '',
        school: school || '',
        language: language || guardian.language || 'English',
        timezone: timezone || guardian.timezone || 'UTC',
        subjects: Array.isArray(subjects) ? subjects : [],
        learningPreferences: learningPreferences || '',
        evaluationSummary: mergedEvaluationSummary,
        evaluationImportSource: importedEvaluationMatch?.source || undefined,
        notes: notes || '',
        hoursRemaining: typeof hoursRemaining === 'number' ? hoursRemaining : 0,
        isActive: typeof isActive === 'boolean' ? isActive : true,
        profilePicture: buildStudentProfilePictureFromGuardian(guardian),
      });

      await student.save();

      // Update Guardian model to include this student
      await Guardian.findOneAndUpdate(
        { user: guardianId },
        { $addToSet: { students: student._id } },
        { upsert: true }
      );

      await mirrorStandaloneToEmbedded(student);

      try {
        await notificationService.notifyStudentCreated({
          student,
          guardian,
          createdBy: req.user,
        });
      } catch (notifyErr) {
        console.warn('Student created notification failed', notifyErr && notifyErr.message);
      }

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
        phone: phone || '',
        whatsapp: whatsapp || '',
        grade: grade || '',
        school: school || '',
        language: language || 'English',
        timezone: timezone || 'UTC',
        subjects: Array.isArray(subjects) ? subjects : [],
        learningPreferences: learningPreferences || '',
        evaluationSummary: mergedEvaluationSummary,
        evaluationImportSource: importedEvaluationMatch?.source || undefined,
        notes: notes || '',
        hoursRemaining: typeof hoursRemaining === 'number' ? hoursRemaining : 0,
        dateOfBirth: dateOfBirth || null,
        gender: gender || 'male',
        selfGuardian: false,
        isActive: typeof isActive === 'boolean' ? isActive : true,
      });

      await student.save();

      // Update Guardian model to include this student
      await Guardian.findOneAndUpdate(
        { user: guardianId },
        { $addToSet: { students: student._id } },
        { upsert: true }
      );

      await mirrorStandaloneToEmbedded(student);

      try {
        await notificationService.notifyStudentCreated({
          student,
          guardian,
          createdBy: req.user,
        });
      } catch (notifyErr) {
        console.warn('Student created notification failed', notifyErr && notifyErr.message);
      }

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

    const existingStudent = await Student.findById(id).select('guardian');
    if (!existingStudent) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Authorization: guardians can only update their own students, admins can update any
    if (req.user.role === 'teacher') {
      return res.status(403).json({ message: 'Teachers cannot update students' });
    }
    if (req.user.role === 'guardian') {
      if (String(existingStudent.guardian) !== String(req.user._id)) {
        return res.status(403).json({ message: 'You are not authorized to update this student' });
      }
    }

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
    )
      .populate('guardian', 'firstName lastName email phone')
      .populate('currentTeachers', 'firstName lastName email');

    if (!updatedStudent) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const nameWasUpdated = typeof filteredUpdates.firstName !== 'undefined' || typeof filteredUpdates.lastName !== 'undefined';
    if (nameWasUpdated) {
      const updatedName = `${updatedStudent.firstName || ''} ${updatedStudent.lastName || ''}`.trim();
      const guardianId = updatedStudent.guardian?._id || updatedStudent.guardian;

      if (guardianId) {
        try {
          const guardianDoc = await User.findById(guardianId);
          if (guardianDoc && Array.isArray(guardianDoc.guardianInfo?.students)) {
            guardianDoc.guardianInfo.students.forEach((student) => {
              const standaloneId = student.standaloneStudentId || student.studentInfo?.standaloneStudentId;
              const matchesStandalone = standaloneId && String(standaloneId) === String(updatedStudent._id);
              const matchesId = student._id && String(student._id) === String(updatedStudent._id);
              const matchesStudentId = student.studentId && String(student.studentId) === String(updatedStudent._id);
              if (matchesStandalone || matchesId || matchesStudentId) {
                student.firstName = updatedStudent.firstName;
                student.lastName = updatedStudent.lastName;
              }
            });
            await guardianDoc.save();
          }
        } catch (guardianErr) {
          console.warn('Failed to propagate student name to embedded guardian record', guardianErr?.message || guardianErr);
        }
      }

      if (updatedName && guardianId) {
        try {
          await Class.updateMany(
            {
              'student.guardianId': guardianId,
              'student.studentId': updatedStudent._id
            },
            { $set: { 'student.studentName': updatedName } }
          );
        } catch (classErr) {
          console.warn('Failed to propagate student name to classes', classErr?.message || classErr);
        }
      }
    }

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

    // Also remove any embedded references for this guardian to avoid ghost students.
    try {
      const idObj = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
      const ids = idObj ? [id, idObj] : [id];
      await User.updateOne(
        { _id: student.guardian, role: 'guardian' },
        {
          $pull: {
            'guardianInfo.students': {
              $or: [
                { standaloneStudentId: { $in: ids } },
                { _id: { $in: ids } }
              ]
            }
          }
        }
      );
    } catch (e) {
      console.warn('Failed to remove embedded student reference during standalone delete', e && e.message);
    }

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

