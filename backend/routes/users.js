/**
 * User Management Routes
 * 
 * Handles:
 * - User CRUD operations
 * - User profile management
 * - Student management for guardians (embedded students)
 * - Teacher management
 * - Admin impersonation
 */
const { generateToken } = require('../utils/jwt');
const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const Notification = require('../models/Notification');
const Class = require('../models/Class');
const { isValidTimezone, DEFAULT_TIMEZONE } = require('../utils/timezoneUtils');
const { 
  authenticateToken, 
  requireAdmin, 
  requireResourceAccess 
} = require('../middleware/auth');

const router = express.Router();
const multer = require('multer');
const { uploadImage, deleteImage } = require('../services/cloudinaryService');

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
};

const normalize = (value = '') => String(value || '').trim().toLowerCase();
const normalizeDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const makeStudentKey = (student = {}) => {
  const guardianId = String(student.guardianId || student.guardian || '');
  if (!guardianId) return null;

  const first = normalize(student.firstName || student.studentInfo?.firstName);
  const last = normalize(student.lastName || student.studentInfo?.lastName);
  const fallbackName = normalize(student.studentName) || [first, last].filter(Boolean).join('|');
  const dob = normalizeDate(student.dateOfBirth || student.studentInfo?.dateOfBirth);

  const email = normalize(student.email || student.studentInfo?.email);
  if (email) {
    // Include additional identity cues with the email so siblings sharing a guardian email stay distinct
    const hasExtraIdentity = Boolean(fallbackName || dob);
    return hasExtraIdentity
      ? `${guardianId}|email:${email}|name:${fallbackName || 'unknown'}|dob:${dob || 'unknown'}`
      : `${guardianId}|email:${email}`;
  }

  if (fallbackName || dob) {
    return `${guardianId}|name:${fallbackName || 'unknown'}|dob:${dob || 'unknown'}`;
  }

  const idPart = student._id || student.id || student.studentId;
  if (idPart) {
    return `${guardianId}|id:${String(idPart)}`;
  }

  return `${guardianId}|hash:${Buffer.from(JSON.stringify(student)).toString('base64').slice(0, 24)}`;
};

const dedupeStudents = (students = []) => {
  const byKey = new Map();
  students.forEach((student) => {
    const key = makeStudentKey(student);
    if (!key) return;
    if (!byKey.has(key)) {
      byKey.set(key, student);
      return;
    }

    const existing = byKey.get(key);
    if (existing && existing._source === 'embedded' && student._source === 'standalone') {
      byKey.set(key, student);
    }
  });
  return Array.from(byKey.values());
};

const sanitizeStudentHours = (students = []) =>
  students.map((student) => {
    const copy = { ...student };
    delete copy.hoursRemaining;
    delete copy.hoursConsumed;
    delete copy.totalHours;
    delete copy.cumulativeConsumedHours;
    if (copy.studentInfo && typeof copy.studentInfo === 'object') {
      const info = { ...copy.studentInfo };
      delete info.hoursRemaining;
      delete info.hoursConsumed;
      copy.studentInfo = info;
    }
    return copy;
  });

const matchesStudentSearch = (student = {}, needle = '') => {
  if (!needle) return true;
  const normalizedNeedle = needle.toLowerCase();
  const haystacks = [
    student.firstName,
    student.lastName,
    student.email,
    student.studentName,
    student.guardianName,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return haystacks.some((value) => value.includes(normalizedNeedle));
};

const sortStudentsAlpha = (students = []) =>
  students.sort((a, b) => {
    const aFirst = (a.firstName || '').toLowerCase();
    const bFirst = (b.firstName || '').toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);
    const aLast = (a.lastName || '').toLowerCase();
    const bLast = (b.lastName || '').toLowerCase();
    return aLast.localeCompare(bLast);
  });

// Multer setup (in-memory)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

/**
 * Get all users (Admin only)
 * GET /api/users
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      role,
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'createdAt',
      order = 'desc',
      isActive,
    } = req.query;

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const query = {};
    if (role) {
      query.role = role;
    }

    if (typeof isActive !== 'undefined') {
      const normalized = String(isActive).toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) {
        query.isActive = true;
      } else if (['false', '0', 'no'].includes(normalized)) {
        query.isActive = false;
      }
    }

    const trimmedSearch = (search || '').trim();
    if (trimmedSearch) {
      const regex = new RegExp(escapeRegex(trimmedSearch), 'i');
      query.$or = [
        { firstName: regex },
        { lastName: regex },
        { email: regex },
        { phone: regex },
        { 'guardianInfo.students.firstName': regex },
        { 'guardianInfo.students.lastName': regex },
        { 'guardianInfo.students.email': regex },
      ];
    }

    const allowedSortFields = new Set(['createdAt', 'firstName', 'lastName', 'email']);
    const resolvedSortBy = allowedSortFields.has(sortBy) ? sortBy : 'createdAt';
    const sortDirection = String(order).toLowerCase() === 'asc' ? 1 : -1;
    const sortOptions = { [resolvedSortBy]: sortDirection, _id: sortDirection };

    const users = await User.find(query)
      .select('-password')
      .limit(parsedLimit)
      .skip(skip)
      .sort(sortOptions);

    const total = await User.countDocuments(query);

    // For the teachers list, compute hours this month from Class durations
    // (this matches the teacher dashboard aggregation and avoids relying on
    // teacherInfo.monthlyHours which can be a mutable snapshot).
    let usersPayload = users;
    if (String(role || '').toLowerCase() === 'teacher' && Array.isArray(users) && users.length) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const teacherIds = users.map((u) => u && u._id).filter(Boolean);

      let hoursByTeacherId = {};
      try {
        const rows = await Class.aggregate([
          {
            $match: {
              teacher: { $in: teacherIds },
              scheduledDate: { $gte: monthStart, $lt: monthEnd },
              status: { $in: ['attended', 'missed_by_student', 'completed'] }
            }
          },
          { $group: { _id: '$teacher', totalMinutes: { $sum: '$duration' } } }
        ]);
        hoursByTeacherId = (rows || []).reduce((acc, r) => {
          acc[String(r._id)] = (r.totalMinutes || 0) / 60;
          return acc;
        }, {});
      } catch (e) {
        console.warn('users: failed to aggregate teacher monthly hours', e && e.message);
      }

      usersPayload = users.map((u) => {
        const obj = u.toObject();
        const key = String(obj._id);
        const computed = hoursByTeacherId[key] ?? 0;
        obj.teacherInfo = obj.teacherInfo || {};
        obj.teacherInfo._computedMonthlyHours = computed;
        return obj;
      });
    }

    res.json({
      users: usersPayload,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit)
      }
    });
    
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      message: 'Failed to fetch users',
      error: error.message
    });
  }
});

/**
 * Get user by ID
 * GET /api/users/:id
 */
router.get('/:id', authenticateToken, requireResourceAccess('user'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    console.log("Fetching user with id:", req.params.id || req.body.user);

    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }
    
    res.json({ user });
    
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      message: 'Failed to fetch user',
      error: error.message
    });
  }
});

/**
 * Update user profile
 * PUT /api/users/:id
 */
router.put('/:id', authenticateToken, requireResourceAccess('user'), async (req, res) => {
  try {
    const updates = req.body;
    console.log('Backend PUT /users/:id received updates:', updates);
    console.log('Backend received bio field:', updates.bio);

    // Remove sensitive fields that shouldn't be updated via this endpoint
    delete updates.password;
    delete updates.role;
    delete updates.email;

    console.log('Backend updates after filtering:', updates);
    console.log('Backend bio after filtering:', updates.bio);

    // Fetch current user document to compute diffs and preserve middleware hooks
    const originalUser = await User.findById(req.params.id).select('-password');
    if (!originalUser) return res.status(404).json({ message: 'User not found' });

    // If the stored document already has an invalid gender value (possible from earlier writes), clear it
    try {
      const allowedGenders = ['male', 'female'];
      if (originalUser.gender !== undefined && originalUser.gender !== null && !allowedGenders.includes(originalUser.gender)) {
        console.warn(`Backend: Clearing invalid stored gender value for user ${req.params.id}: ${originalUser.gender}`);
        originalUser.gender = undefined;
      }
    } catch (sanitErr) {
      console.warn('Failed to sanitize originalUser.gender', sanitErr);
    }

    // Remove guardian-specific fields that are no longer supported: top-level bio and instapayName
    try {
      if (originalUser.role === 'guardian') {
        if (originalUser.bio) {
          console.warn(`Backend: Removing stored top-level bio for guardian ${req.params.id}`);
          originalUser.bio = undefined;
        }
        if (originalUser.instapayName) {
          console.warn(`Backend: Removing stored top-level instapayName for guardian ${req.params.id}`);
          originalUser.instapayName = undefined;
        }
        // also guard against any guardianInfo.instapayName if it somehow exists
        if (originalUser.guardianInfo && originalUser.guardianInfo.instapayName) {
          console.warn(`Backend: Removing stored guardianInfo.instapayName for guardian ${req.params.id}`);
          delete originalUser.guardianInfo.instapayName;
        }
      }
    } catch (cleanuperr) {
      console.warn('Failed to cleanup guardian fields', cleanuperr);
    }
    console.log('Backend originalUser bio before update:', originalUser.bio);
    console.log('Backend originalUser role:', originalUser.role);
    console.log('Backend originalUser teacherInfo.bio before update:', originalUser.teacherInfo?.bio);

    // Handle bio field based on user role
    if (updates.bio !== undefined) {
      if (originalUser.role === 'teacher') {
        // For teachers, bio is stored in teacherInfo.bio
        if (!updates.teacherInfo) updates.teacherInfo = {};
        updates.teacherInfo.bio = updates.bio;
        console.log('Backend: Moving bio to teacherInfo.bio for teacher:', updates.bio);
      }
      // Remove top-level bio since it's not in the schema for any role
      delete updates.bio;
    }

    // Sanitize gender to avoid Mongoose enum validation errors
    if (updates.gender !== undefined) {
      const allowedGenders = ['male', 'female'];
      if (!allowedGenders.includes(updates.gender)) {
        console.warn(`Backend: Ignoring invalid gender value in update: ${updates.gender}`);
        delete updates.gender;
      }
    }

    // Handle spokenLanguages sent at top-level - map into role-specific nested object
    if (updates.spokenLanguages !== undefined) {
      try {
        if (originalUser.role === 'teacher') {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.spokenLanguages = updates.spokenLanguages;
          console.log('Backend: Mapped top-level spokenLanguages into teacherInfo.spokenLanguages');
        } else if (originalUser.role === 'guardian') {
          if (!updates.guardianInfo) updates.guardianInfo = {};
          updates.guardianInfo.spokenLanguages = updates.spokenLanguages;
          console.log('Backend: Mapped top-level spokenLanguages into guardianInfo.spokenLanguages');
        }
      } catch (mapErr) {
        console.warn('Failed mapping spokenLanguages into nested object', mapErr);
      }
      delete updates.spokenLanguages;
    }

    // Map paymentMethod (frontend sometimes sends top-level paymentMethod) into guardianInfo.paymentMethod
    if (updates.paymentMethod !== undefined) {
      if (originalUser.role === 'guardian') {
        if (!updates.guardianInfo) updates.guardianInfo = {};
        // Normalize common frontend values to backend enum
        let pm = updates.paymentMethod;
        if (pm === 'bank' || pm === 'wise') pm = 'bank_transfer';
        if (pm === 'card') pm = 'credit_card';
        updates.guardianInfo.paymentMethod = pm;
        console.log('Backend: Mapped top-level paymentMethod into guardianInfo.paymentMethod');
        delete updates.paymentMethod;
      }
    }

    if (updates.hourlyRate !== undefined && originalUser.role === 'guardian') {
      if (!updates.guardianInfo) updates.guardianInfo = {};
      const hrValue = Number(updates.hourlyRate);
      if (Number.isFinite(hrValue)) {
        updates.guardianInfo.hourlyRate = hrValue;
      }
      delete updates.hourlyRate;
    }

    const transferFeePayload = (() => {
      if (updates.transferFee !== undefined) return updates.transferFee;
      if (updates.transferFees !== undefined) return updates.transferFees;
      return undefined;
    })();

    if (transferFeePayload !== undefined && originalUser.role === 'guardian') {
      if (!updates.guardianInfo) updates.guardianInfo = {};

      let normalized = transferFeePayload;
      if (normalized && typeof normalized === 'object') {
        const mode = typeof normalized.mode === 'string' ? normalized.mode.toLowerCase() : undefined;
        const allowedModes = ['fixed', 'percent'];
        normalized = {
          mode: allowedModes.includes(mode) ? mode : 'fixed',
          value: Number.isFinite(Number(normalized.value)) ? Number(normalized.value) : 5
        };
      } else if (Number.isFinite(Number(normalized))) {
        normalized = { mode: 'fixed', value: Number(normalized) };
      } else {
        normalized = { mode: 'fixed', value: 5 };
      }

      updates.guardianInfo.transferFee = normalized;
      delete updates.transferFee;
      delete updates.transferFees;
    }

    // Allow admins to update teacher preference fields: preferredStudentAgeRange, preferredFemaleAgeRange, preferredMaleAgeRange, studentsTaught
    if (originalUser.role === 'teacher') {
      if (req.user.role === 'admin') {
        // Validate incoming ranges before mapping them
        const validateRange = (r) => {
          if (!r) return null;
          const min = Number(r.min);
          const max = Number(r.max);
          if (isNaN(min) || isNaN(max)) return 'min and max must be numbers';
          if (min < 0 || max < 0 || min > 120 || max > 120) return 'min/max must be between 0 and 120';
          if (min > max) return 'min cannot be greater than max';
          return null;
        };
        const errors = [];
        if (updates.preferredStudentAgeRange !== undefined) {
          const e = validateRange(updates.preferredStudentAgeRange);
          if (e) errors.push({ field: 'preferredStudentAgeRange', message: e });
        }
        if (updates.preferredFemaleAgeRange !== undefined) {
          const e = validateRange(updates.preferredFemaleAgeRange);
          if (e) errors.push({ field: 'preferredFemaleAgeRange', message: e });
        }
        if (updates.preferredMaleAgeRange !== undefined) {
          const e = validateRange(updates.preferredMaleAgeRange);
          if (e) errors.push({ field: 'preferredMaleAgeRange', message: e });
        }
        if (errors.length) {
          return res.status(400).json({ message: 'Invalid preference ranges', errors });
        }
        if (updates.preferredStudentAgeRange !== undefined) {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.preferredStudentAgeRange = updates.preferredStudentAgeRange;
          delete updates.preferredStudentAgeRange;
        }
        if (updates.preferredFemaleAgeRange !== undefined) {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.preferredFemaleAgeRange = updates.preferredFemaleAgeRange;
          delete updates.preferredFemaleAgeRange;
        }
        if (updates.preferredMaleAgeRange !== undefined) {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.preferredMaleAgeRange = updates.preferredMaleAgeRange;
          delete updates.preferredMaleAgeRange;
        }
        if (updates.studentsTaught !== undefined) {
          if (!updates.teacherInfo) updates.teacherInfo = {};
          updates.teacherInfo.studentsTaught = updates.studentsTaught;
          delete updates.studentsTaught;
        }
      } else {
        // Non-admins cannot change these fields; strip them if present
        delete updates.preferredStudentAgeRange;
        delete updates.preferredFemaleAgeRange;
        delete updates.preferredMaleAgeRange;
        delete updates.studentsTaught;
      }
    }

    // Helper to compute changed field paths between two objects
    function diffFields(oldObj, newObj, base = '') {
      const changed = [];
      const keys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
      keys.forEach((k) => {
        const oldVal = oldObj ? oldObj[k] : undefined;
        const newVal = newObj ? newObj[k] : undefined;
        const path = base ? `${base}.${k}` : k;
        if (oldVal === undefined && newVal !== undefined) {
          changed.push(path);
        } else if (newVal === undefined && oldVal !== undefined) {
          changed.push(path);
        } else if (oldVal && newVal && typeof oldVal === 'object' && typeof newVal === 'object' && !(oldVal instanceof Date) && !(newVal instanceof Date)) {
          changed.push(...diffFields(oldVal, newVal, path));
        } else if ((oldVal instanceof Date) && (newVal instanceof Date)) {
          if (oldVal.getTime() !== newVal.getTime()) changed.push(path);
        } else if (String(oldVal) !== String(newVal)) {
          changed.push(path);
        }
      });
      return changed;
    }

    // If bank details are included in the update, mark them as pendingApproval and stamp lastUpdated
    let notifyAdminForBank = false;
    if (updates.teacherInfo && updates.teacherInfo.bankDetails) {
      updates.teacherInfo.bankDetails = {
        ...(updates.teacherInfo.bankDetails || {}),
        pendingApproval: true,
        lastUpdated: new Date()
      };
      notifyAdminForBank = true;
    }
    if (updates.guardianInfo && updates.guardianInfo.bankDetails) {
      updates.guardianInfo.bankDetails = {
        ...(updates.guardianInfo.bankDetails || {}),
        pendingApproval: true,
        lastUpdated: new Date()
      };
      notifyAdminForBank = true;
    }

    // Normalize admin settings (used by admins to manage meeting links / booking text)
    if (Object.prototype.hasOwnProperty.call(updates, 'adminSettings')) {
      if (!updates.adminSettings || typeof updates.adminSettings !== 'object') {
        delete updates.adminSettings;
      } else {
        const sanitizedAdminSettings = { ...updates.adminSettings };
        if (Object.prototype.hasOwnProperty.call(sanitizedAdminSettings, 'meetingLink')) {
          const trimmedLink = (sanitizedAdminSettings.meetingLink || '').trim();
          sanitizedAdminSettings.meetingLink = trimmedLink;
          const previousLink = (originalUser.adminSettings?.meetingLink || '').trim();
          if (trimmedLink !== previousLink) {
            sanitizedAdminSettings.meetingLinkUpdatedAt = new Date();
          } else if (!sanitizedAdminSettings.meetingLinkUpdatedAt && originalUser.adminSettings?.meetingLinkUpdatedAt) {
            sanitizedAdminSettings.meetingLinkUpdatedAt = originalUser.adminSettings.meetingLinkUpdatedAt;
          }
        }
        updates.adminSettings = sanitizedAdminSettings;
      }
    }

    // If guardianInfo is being updated for a guardian, deep-merge to avoid wiping embedded students
    if (originalUser.role === 'guardian' && updates.guardianInfo && typeof updates.guardianInfo === 'object') {
      try {
        const existing = originalUser.guardianInfo && typeof originalUser.guardianInfo === 'object'
          ? (typeof originalUser.guardianInfo.toObject === 'function' ? originalUser.guardianInfo.toObject() : originalUser.guardianInfo)
          : {};
        const incoming = updates.guardianInfo;

        // Only overwrite students if explicitly provided AND explicitly allowed.
        // Many forms send guardianInfo with defaults (students: []) which would otherwise wipe data.
        // To prevent accidental loss, require a truthy replace flag to allow replacement.
        const willReplaceStudents = Object.prototype.hasOwnProperty.call(incoming, 'students');
        const allowReplaceStudents = (function() {
          try {
            const q = String(req.query.replaceStudents || '').toLowerCase();
            const b = String(incoming.replaceStudents || updates.replaceStudents || '').toLowerCase();
            return q === 'true' || b === 'true';
          } catch (_) { return false; }
        })();

        const merged = { ...existing, ...incoming };
        if (willReplaceStudents) {
          const incomingStudents = Array.isArray(incoming.students) ? incoming.students : null;
          const hasExisting = existing && Array.isArray(existing.students) && existing.students.length > 0;
          // Block accidental wipe: if incoming is [] and we have existing and not explicitly allowed, keep existing
          if (!allowReplaceStudents && hasExisting && incomingStudents && incomingStudents.length === 0) {
            merged.students = existing.students;
          }
        } else if (existing && Array.isArray(existing.students)) {
          // If students wasn't part of the payload, preserve it
          merged.students = existing.students;
        }

        // Remove the helper flag if present in the payload
        if (merged && Object.prototype.hasOwnProperty.call(merged, 'replaceStudents')) {
          delete merged.replaceStudents;
        }
        updates.guardianInfo = merged;
      } catch (mergeErr) {
        console.warn('GuardianInfo merge failed, falling back to shallow set', mergeErr && mergeErr.message);
      }
    }

    // Apply updates onto the Mongoose document to run hooks/validators
    Object.keys(updates).forEach((key) => {
      // Avoid accidentally nulling entire guardianInfo
      if (key === 'guardianInfo' && originalUser.role === 'guardian' && (updates.guardianInfo == null || typeof updates.guardianInfo !== 'object')) {
        return; // skip invalid guardianInfo payloads
      }
      originalUser[key] = updates[key];
    });

    console.log('Backend originalUser bio after applying updates:', originalUser.bio);
    console.log('Backend originalUser teacherInfo.bio after applying updates:', originalUser.teacherInfo?.bio);

    // Save updated user
    await originalUser.save();

    const updatedUser = await User.findById(req.params.id).select('-password');
    console.log('Backend final saved user bio:', updatedUser.bio);
    console.log('Backend final saved user teacherInfo.bio:', updatedUser.teacherInfo?.bio);

    // If profile now has key fields, mark onboarding completed
    try {
      const required = ['phone', 'timezone', 'dateOfBirth', 'gender', 'profilePicture'];
      const hasAll = required.every(f => {
        const v = updatedUser[f];
        return v !== undefined && v !== null && (String(v).length > 0);
      });
      if (hasAll && !updatedUser.onboarding?.completed) {
        updatedUser.onboarding = { ...(updatedUser.onboarding || {}), completed: true };
        await updatedUser.save();
      }
    } catch (e) {
      console.warn('Onboarding completion check failed', e.message || e);
    }

    // Compute changed fields for notification (compare before/after)
    const changedFields = diffFields(originalUser.toObject ? originalUser.toObject() : {}, updatedUser.toObject ? updatedUser.toObject() : {});

    res.json({ message: 'User updated successfully', user: updatedUser });

    // Notification handling
    try {
      const actorId = req.user.id;
      const actorRole = req.user.role;
      const who = `${updatedUser.firstName || ''} ${updatedUser.lastName || ''}`.trim() || updatedUser.email;

      // If the requestor updated their own profile, notify admins about changed fields
      if (actorId === String(updatedUser._id)) {
        if (changedFields.length) {
          const msg = `${who} updated their profile.${changedFields.length ? ` Updated: ${changedFields.join(', ')}.` : ''}`;
          // Notify admins via notificationService
          const notificationService = require('../services/notificationService');
          await notificationService.notifyRole({ role: 'admin', title: 'Profile updated', message: msg, type: 'request', related: { user: updatedUser._id }, actionRequired: false, actionLink: `/admin/users/${updatedUser._id}` });
        }
        // If bank details specifically updated, also notify admins (keeps prior behavior)
        if (notifyAdminForBank) {
          const instapayFromUser = (updatedUser.teacherInfo && updatedUser.teacherInfo.instapayName) || (updatedUser.guardianInfo && updatedUser.guardianInfo.instapayName);
          const messageBase = instapayFromUser
            ? `${who} updated their payment details (Instapay: ${instapayFromUser}). Please review.`
            : `${who} updated their payment details. Please review.`;
          await Notification.create({ role: 'admin', title: 'Payment details updated', message: messageBase, type: 'request', actionRequired: true, actionLink: `/admin/users/${updatedUser._id}` });
        }
      } else if (actorRole === 'admin') {
        // Admin edited a user -> notify that user which fields were changed
        if (changedFields.length) {
          const msg = `Your profile was updated by an administrator.${changedFields.length ? ` Updated: ${changedFields.join(', ')}.` : ''}`;
          const notificationService = require('../services/notificationService');
          await notificationService.createNotification({ userId: updatedUser._id, title: 'Profile updated', message: msg, type: 'info', actionRequired: false, actionLink: '/profile' });
        }
      }
    } catch (nerr) {
      console.error('Failed to create profile update notification:', nerr);
    }

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Failed to update user', error: error.message });
  }
});

/**
 * Get students for a guardian
 * GET /api/users/:guardianId/students
 */
router.get('/:guardianId/students', authenticateToken, async (req, res) => {
  try {
    const { guardianId } = req.params;
    
    // Check if the requesting user is the guardian or an admin
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Access denied. You can only view your own students.'
      });
    }
    
  const guardian = await User.findById(guardianId).select('-password');
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }
    
    const embedded = Array.isArray(guardian.guardianInfo?.students) ? guardian.guardianInfo.students : [];
    let standalone = [];
    try {
      standalone = await Student.find({ guardian: guardianId }).lean();
    } catch (sErr) {
      console.warn('Failed to fetch standalone students for guardian', guardianId, sErr && sErr.message);
    }

    // Normalize items to a common shape and tag source
      const normEmbedded = embedded.map((s) => ({
        ...(typeof s.toObject === 'function' ? s.toObject() : s),
        guardianId: guardian._id,
        guardianName: guardian.fullName,
        guardianTimezone: guardian.timezone,
        _source: 'embedded'
      }));
      const normStandalone = standalone.map((s) => ({
        ...s,
        guardianId: guardian._id,
        guardianName: guardian.fullName,
        guardianTimezone: guardian.timezone,
        _source: 'standalone'
      }));

    // Deduplicate: prefer standalone when email matches; otherwise keep both
    const byKey = new Map();
    const makeKey = (s) => {
      const email = (s.email || '').toLowerCase();
      const dob = s.dateOfBirth ? new Date(s.dateOfBirth).toISOString().slice(0,10) : '';
      const name = `${(s.firstName||'').trim().toLowerCase()}|${(s.lastName||'').trim().toLowerCase()}`;
      const g = String(s.guardianId || guardianId);
      return `${g}|${email || name+'|'+dob}`;
    };
    for (const s of [...normEmbedded, ...normStandalone]) {
      const k = makeKey(s);
      if (!byKey.has(k)) {
        byKey.set(k, s);
      } else {
        // Prefer standalone over embedded
        const existing = byKey.get(k);
        if (existing._source === 'embedded' && s._source === 'standalone') {
          byKey.set(k, s);
        }
      }
    }

    const combinedStudents = Array.from(byKey.values());
    const totalHours = combinedStudents.reduce((sum, s) => sum + (Number(s.hoursRemaining) || 0), 0);
    const cumulativeConsumedHours = Number(guardian.guardianInfo?.cumulativeConsumedHours || 0);

    const trimmedSearch = (req.query.search || '').trim().toLowerCase();
    let students = combinedStudents;
    if (trimmedSearch) {
      students = students.filter((student) => matchesStudentSearch(student, trimmedSearch));
    }
    students = sortStudentsAlpha(students);

    res.json({ students, totalHours, cumulativeConsumedHours });
    
  } catch (error) {
    console.error('Get students error:', error);
    res.status(500).json({
      message: 'Failed to fetch students',
      error: error.message
    });
  }
});

/**
 * Batch fetch students for multiple guardians
 * POST /api/users/students/batch
 * Body: { guardianIds: [id1, id2, ...] }
 * Returns: { map: { guardianId: ["First Last", ...], ... } }
 */
router.post('/students/batch', authenticateToken, async (req, res) => {
  try {
    const { guardianIds } = req.body;
    if (!Array.isArray(guardianIds)) {
      return res.status(400).json({ message: 'guardianIds must be an array' });
    }

    const uniqueIds = [...new Set(guardianIds.filter(Boolean))];

    // Authorization: non-admin users may only request their own guardian id
    if (req.user.role !== 'admin') {
      if (uniqueIds.length !== 1 || uniqueIds[0] !== req.user.id) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Fetch guardians and return names of their students
    const guardians = await User.find({ _id: { $in: uniqueIds }, role: 'guardian' }).select('firstName lastName guardianInfo');
    const map = {};
    guardians.forEach(g => {
      const students = g.guardianInfo?.students || [];
      map[g._id] = students.map(s => `${s.firstName || ''} ${s.lastName || ''}`.trim());
    });

    res.json({ map });
  } catch (error) {
    console.error('Batch fetch students error:', error);
    res.status(500).json({ message: 'Failed to fetch students batch', error: error.message });
  }
});
/**
 * Get all students for admin (supports search + pagination-style limit)
 * GET /api/users/admin/all-students
 */
router.get('/admin/all-students', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { search = '', limit, guardianId, studentId } = req.query;
    const trimmedSearch = (search || '').trim();
    const guardianObjectId = guardianId ? toObjectId(guardianId) : null;
    const studentObjectId = studentId ? toObjectId(studentId) : null;

    if (guardianId && !guardianObjectId) {
      return res.status(400).json({ message: 'Invalid guardianId' });
    }
    if (studentId && !studentObjectId) {
      return res.status(400).json({ message: 'Invalid studentId' });
    }

    const limitProvided = typeof limit !== 'undefined';
    const safeLimit = limitProvided ? Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200) : 0;
    const shouldUseFilteredFlow = Boolean(trimmedSearch || guardianObjectId || studentObjectId || limitProvided);

    if (shouldUseFilteredFlow) {
      const effectiveLimit = safeLimit || 200;
      const searchRegex = trimmedSearch ? new RegExp(escapeRegex(trimmedSearch), 'i') : null;
      const fetchLimit = Math.max(effectiveLimit * 3, 50);

      const guardianMatch = { role: 'guardian' };
      if (guardianObjectId) guardianMatch._id = guardianObjectId;
      if (studentObjectId) {
        guardianMatch['guardianInfo.students._id'] = studentObjectId;
      } else if (searchRegex) {
        guardianMatch.$or = [
          { 'guardianInfo.students.firstName': searchRegex },
          { 'guardianInfo.students.lastName': searchRegex },
          { 'guardianInfo.students.email': searchRegex },
        ];
      }

      const pipeline = [
        { $match: guardianMatch },
        { $project: { firstName: 1, lastName: 1, timezone: 1, students: '$guardianInfo.students' } },
        { $unwind: '$students' },
      ];

      if (studentObjectId) {
        pipeline.push({ $match: { 'students._id': studentObjectId } });
      } else if (searchRegex) {
        pipeline.push({
          $match: {
            $or: [
              { 'students.firstName': searchRegex },
              { 'students.lastName': searchRegex },
              { 'students.email': searchRegex },
            ],
          },
        });
      }

      pipeline.push(
        {
          $project: {
            guardianId: '$_id',
            guardianFirstName: '$firstName',
            guardianLastName: '$lastName',
            guardianTimezone: '$timezone',
            student: '$students',
          },
        },
        { $sort: { 'student.firstName': 1, 'student.lastName': 1 } },
        { $limit: fetchLimit },
      );

      const embeddedResults = await User.aggregate(pipeline);
      const embeddedStudents = embeddedResults.map((doc) => ({
        ...(doc.student || {}),
        guardianId: doc.guardianId,
        guardianName: `${doc.guardianFirstName || ''} ${doc.guardianLastName || ''}`.trim(),
        guardianTimezone: doc.guardianTimezone,
        _source: 'embedded',
      }));

      const standaloneQuery = {};
      if (guardianObjectId) standaloneQuery.guardian = guardianObjectId;
      if (studentObjectId) {
        standaloneQuery._id = studentObjectId;
      } else if (searchRegex) {
        standaloneQuery.$or = [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
        ];
      }

      const standaloneDocs = await Student.find(standaloneQuery)
        .sort({ firstName: 1, lastName: 1 })
        .limit(fetchLimit)
        .populate('guardian', 'firstName lastName timezone')
        .lean();

      const standaloneStudents = standaloneDocs.map((student) => ({
        ...student,
        guardianId: student.guardian?._id || student.guardian,
        guardianName: student.guardian
          ? `${student.guardian.firstName || ''} ${student.guardian.lastName || ''}`.trim()
          : undefined,
        guardianTimezone: student.guardian?.timezone,
        _source: 'standalone',
      }));

      let students = dedupeStudents([...embeddedStudents, ...standaloneStudents]);

      if (trimmedSearch && !studentObjectId) {
        students = students.filter((student) => matchesStudentSearch(student, trimmedSearch));
      }

      students = sortStudentsAlpha(students);

      if (studentObjectId) {
        students = students.filter((student) => String(student._id) === String(studentId));
      }

      if (effectiveLimit) {
        students = students.slice(0, effectiveLimit);
      }

      students = sanitizeStudentHours(students);

      return res.json({ students });
    }

    // Legacy full fetch (no filters applied)
    const guardians = await User.find({ role: 'guardian' }).select('firstName lastName guardianInfo timezone').lean();
    const guardianIdList = guardians.map((g) => g._id);

    const embeddedAll = [];
    guardians.forEach((guardian) => {
      const arr = Array.isArray(guardian.guardianInfo?.students) ? guardian.guardianInfo.students : [];
      arr.forEach((student) => {
        const base = student && typeof student === 'object' && typeof student.toObject === 'function' ? student.toObject() : student;
        embeddedAll.push({
          ...base,
          guardianId: guardian._id,
          guardianName: `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim(),
          guardianTimezone: guardian.timezone,
          _source: 'embedded',
        });
      });
    });

    let standaloneAll = [];
    try {
      standaloneAll = await Student.find({ guardian: { $in: guardianIdList } }).lean();
      standaloneAll = standaloneAll.map((student) => ({
        ...student,
        guardianId: student.guardian,
        guardianName: (() => {
          const guardian = guardians.find((g) => String(g._id) === String(student.guardian));
          return guardian ? `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim() : undefined;
        })(),
        guardianTimezone: (() => {
          const guardian = guardians.find((g) => String(g._id) === String(student.guardian));
          return guardian ? guardian.timezone : undefined;
        })(),
        _source: 'standalone',
      }));
    } catch (standaloneErr) {
      console.warn('Admin all-students: failed to fetch standalone students', standaloneErr && standaloneErr.message);
    }

    let students = dedupeStudents([...embeddedAll, ...standaloneAll]);
    students = sanitizeStudentHours(students);

    try {
      const guardianIds = [...new Set(students.map((student) => String(student.guardianId || student.guardian)).filter(Boolean))];
      if (guardianIds.length) {
        const guardianRecords = await User.find({ _id: { $in: guardianIds } }).select('firstName lastName timezone').lean();
        const gMap = {};
        guardianRecords.forEach((guardian) => {
          gMap[String(guardian._id)] = guardian;
        });
        students = students.map((student) => {
          const record = gMap[String(student.guardianId || student.guardian)];
          return {
            ...student,
            guardianName: student.guardianName || (record ? `${record.firstName || ''} ${record.lastName || ''}`.trim() : student.guardianName),
            guardianTimezone: student.guardianTimezone || record?.timezone,
          };
        });
      }
    } catch (enrichErr) {
      console.warn('Failed to enrich teacher students with guardian timezone', enrichErr && enrichErr.message);
    }

    res.json({ students });
  } catch (error) {
    console.error('Admin fetch all students error:', error);
    res.status(500).json({ message: 'Failed to fetch all students', error: error.message });
  }
});

/**
 * Get students for a teacher (based on classes - to be implemented)
 * GET /api/users/teacher/:teacherId/students
 */
router.get('/teacher/:teacherId/students', authenticateToken, async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (req.user.id !== teacherId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Collect standalone students taught by this teacher
    let standalone = [];
    try {
      standalone = await Student.find({ currentTeachers: teacherId }).lean();
    } catch (sErr) {
      console.warn('Teacher students: failed to fetch standalone', sErr && sErr.message);
    }

    // Collect embedded students taught by this teacher
    let embedded = [];
    try {
      const guardians = await User.find({ role: 'guardian', 'guardianInfo.students.currentTeachers': teacherId }).select('firstName lastName guardianInfo timezone').lean();
      guardians.forEach(g => {
        const arr = Array.isArray(g.guardianInfo?.students) ? g.guardianInfo.students : [];
        arr.forEach(s => {
          const teachers = Array.isArray(s.currentTeachers) ? s.currentTeachers.map(String) : [];
          if (teachers.includes(String(teacherId))) {
            embedded.push({ ...s, guardianId: g._id, guardianName: `${g.firstName || ''} ${g.lastName || ''}`.trim(), guardianTimezone: g.timezone, _source: 'embedded' });
          }
        });
      });
    } catch (eErr) {
      console.warn('Teacher students: failed to fetch embedded', eErr && eErr.message);
    }

    // Normalize standalone
    const normStandalone = standalone.map(s => ({ ...s, guardianId: s.guardian, _source: 'standalone' }));

    // Deduplicate: prefer standalone
    const byKey = new Map();
    const makeKey = (s) => {
      const email = (s.email || '').toLowerCase();
      const dob = s.dateOfBirth ? new Date(s.dateOfBirth).toISOString().slice(0,10) : '';
      const name = `${(s.firstName||'').trim().toLowerCase()}|${(s.lastName||'').trim().toLowerCase()}`;
      const g = String(s.guardianId || s.guardian || '');
      return `${g}|${email || name+'|'+dob}`;
    };
    for (const s of [...embedded, ...normStandalone]) {
      const k = makeKey(s);
      if (!byKey.has(k)) byKey.set(k, s);
      else {
        const existing = byKey.get(k);
        if (existing._source === 'embedded' && s._source === 'standalone') byKey.set(k, s);
      }
    }

    let students = Array.from(byKey.values());
    const totalHours = students.reduce((sum, s) => sum + (Number(s.hoursRemaining) || 0), 0);

    // Enrich with guardian timezone and guardianName when possible
    try {
      const guardianIds = [...new Set(students.map(s => String(s.guardianId || s.guardian)).filter(Boolean))];
      if (guardianIds.length) {
        const guardians = await User.find({ _id: { $in: guardianIds } }).select('firstName lastName timezone').lean();
        const gMap = {};
        guardians.forEach(g => { gMap[String(g._id)] = g; });
        students = students.map(s => {
          const g = gMap[String(s.guardianId || s.guardian)];
          return {
            ...s,
            guardianName: s.guardianName || (g ? `${g.firstName || ''} ${g.lastName || ''}`.trim() : s.guardianName),
            guardianTimezone: s.guardianTimezone || (g ? g.timezone : undefined)
          };
        });
      }
    } catch (enrichErr) {
      console.warn('Failed to enrich teacher students with guardian timezone', enrichErr && enrichErr.message);
    }

    res.json({ students, totalHours });
  } catch (error) {
    console.error('Teacher fetch students error:', error);
    res.status(500).json({ message: 'Failed to fetch teacher students', error: error.message });
  }
});

/**
 * Add a student to a guardian's account
 * POST /api/users/:guardianId/students
 */
router.post('/:guardianId/students', [
  authenticateToken,
  body('firstName').notEmpty().trim().withMessage('First name is required'),
  body('lastName').notEmpty().trim().withMessage('Last name is required'),
  body('email').optional().isEmail().withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage('Please provide a valid phone number'),
  body('whatsapp')
    .optional()
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage('Please provide a valid WhatsApp number'),
  body('dateOfBirth').optional().isISO8601().withMessage('Please provide a valid date of birth'),
  body('gender').optional().isIn(['male', 'female']).withMessage('Invalid gender'),
  body('timezone').optional().isString().withMessage('Timezone must be a string'),
  body('grade').optional().isString().withMessage('Grade must be a string'),
  body('school').optional().isString().withMessage('School must be a string'),
  body('language').optional().isString().withMessage('Language must be a string'),
  body('hoursRemaining').optional().isNumeric().withMessage('Hours remaining must be a number'),
  body('selfGuardian').optional().isBoolean().withMessage('Self guardian must be a boolean'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { guardianId } = req.params;
    const studentData = req.body;
    
    // Check if the requesting user is the guardian or an admin
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Access denied. You can only add students to your own account.'
      });
    }
    
    const guardian = await User.findById(guardianId);
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }
    
    // If self-enrollment, populate with guardian's data
    if (studentData.selfGuardian) {
      studentData.firstName = guardian.firstName;
      studentData.lastName = guardian.lastName;
      studentData.email = guardian.email;
      studentData.phone = guardian.phone;
      studentData.whatsapp = guardian.phone; // Default to guardian's phone
      studentData.dateOfBirth = guardian.dateOfBirth;
      studentData.gender = guardian.gender;
      studentData.timezone = guardian.timezone;
    }
    
    // Add the student using the User model method
    await guardian.addStudent(studentData);
    
    // Fetch the updated guardian to get the new student with _id
    const updatedGuardian = await User.findById(guardianId).select('-password');
    const newStudent = updatedGuardian.guardianInfo.students[updatedGuardian.guardianInfo.students.length - 1];
    
    res.status(201).json({
      message: 'Student added successfully',
      student: newStudent,
      totalHours: updatedGuardian.guardianInfo?.totalHours || 0
    });
    
  } catch (error) {
    console.error('Add student error:', error);
    
    if (error.message === 'Guardian is already enrolled as a student') {
      return res.status(400).json({
        message: error.message
      });
    }
    
    res.status(500).json({
      message: 'Failed to add student',
      error: error.message
    });
  }
});

/**
 * Update a student in a guardian's account
 * PUT /api/users/:guardianId/students/:studentId
 */
router.put('/:guardianId/students/:studentId', [
  authenticateToken,
  body('firstName').optional({ nullable: true }).notEmpty().trim().withMessage('First name cannot be empty'),
  body('lastName').optional({ nullable: true }).notEmpty().trim().withMessage('Last name cannot be empty'),
  body('email').optional({ nullable: true }).isEmail().withMessage('Please provide a valid email'),
  body('phone')
    .optional({ nullable: true })
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage('Please provide a valid phone number'),
  body('whatsapp')
    .optional({ nullable: true })
    .matches(/^\+?[0-9]{7,15}$/)
    .withMessage('Please provide a valid WhatsApp number'),
  body('dateOfBirth').optional({ nullable: true }).isISO8601().withMessage('Please provide a valid date of birth'),
  body('gender').optional({ nullable: true }).isIn(['male', 'female']).withMessage('Invalid gender'),
  body('hoursRemaining').optional({ nullable: true }).isNumeric().withMessage('Hours remaining must be a number'),
  body('isActive').optional({ nullable: true }).isBoolean().withMessage('Active status must be a boolean'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { guardianId, studentId } = req.params;
    const updateData = req.body;
    
    // Check if the requesting user is the guardian or an admin
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Access denied. You can only update your own students.'
      });
    }
    
    const guardian = await User.findById(guardianId);
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }
    
    // Update the student using the User model method
    await guardian.updateStudent(studentId, updateData);
    
    // Fetch the updated guardian to get the updated student
    const updatedGuardian = await User.findById(guardianId).select('-password');
    const updatedStudent = updatedGuardian.guardianInfo.students.id(studentId);
    
    res.json({
      message: 'Student updated successfully',
      student: updatedStudent,
      totalHours: updatedGuardian.guardianInfo?.totalHours || 0
    });
    
  } catch (error) {
    console.error('Update student error:', error);
    
    if (error.message === 'Student not found') {
      return res.status(404).json({
        message: error.message
      });
    }
    
    res.status(500).json({
      message: 'Failed to update student',
      error: error.message
    });
  }
});

/**
 * Remove a student from a guardian's account
 * DELETE /api/users/:guardianId/students/:studentId
 */
router.delete('/:guardianId/students/:studentId', authenticateToken, async (req, res) => {
  try {
    const { guardianId, studentId } = req.params;
    
    // Check if the requesting user is the guardian or an admin
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({
        message: 'Access denied. You can only remove your own students.'
      });
    }
    
    const guardian = await User.findById(guardianId);
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }
    
    // Remove the student using the User model method
    await guardian.removeStudent(studentId);
    
    // Fetch the updated guardian to get the updated total hours
    const updatedGuardian = await User.findById(guardianId).select('-password');
    
    res.json({
      message: 'Student removed successfully',
      totalHours: updatedGuardian.guardianInfo?.totalHours || 0
    });
    
  } catch (error) {
    console.error('Remove student error:', error);
    res.status(500).json({
      message: 'Failed to remove student',
      error: error.message
    });
  }
});

/**
 * Update student hours (Admin only)
 * PUT /api/users/:guardianId/students/:studentId/hours
 */
router.put('/:guardianId/students/:studentId/hours', [
  authenticateToken,
  requireAdmin,
  body('action').isIn(['add', 'subtract', 'set']).withMessage('Action must be add, subtract, or set'),
  body('hours').isNumeric().withMessage('Hours must be a number'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { guardianId, studentId } = req.params;
    const { action, hours } = req.body;
    
    const guardian = await User.findById(guardianId);
    
    if (!guardian) {
      return res.status(404).json({
        message: 'Guardian not found'
      });
    }
    
    if (guardian.role !== 'guardian') {
      return res.status(400).json({
        message: 'User is not a guardian'
      });
    }
    
    const student = guardian.guardianInfo.students.id(studentId);
    if (!student) {
      return res.status(404).json({
        message: 'Student not found'
      });
    }
    
    // Update hours based on action
    let newHours = student.hoursRemaining || 0;
    
    switch (action) {
      case 'add':
        newHours += parseFloat(hours);
        break;
      case 'subtract':
        newHours -= parseFloat(hours);
        break;
      case 'set':
        newHours = parseFloat(hours);
        break;
    }
    
    // Update the student's hours
    await guardian.updateStudent(studentId, { hoursRemaining: newHours });
    
    // Fetch the updated guardian to get the updated student and total hours
    const updatedGuardian = await User.findById(guardianId).select('-password');
    const updatedStudent = updatedGuardian.guardianInfo.students.id(studentId);
    
    res.json({
      message: 'Student hours updated successfully',
      student: updatedStudent,
      totalHours: updatedGuardian.guardianInfo?.totalHours || 0
    });
    
  } catch (error) {
    console.error('Update student hours error:', error);
    res.status(500).json({
      message: 'Failed to update student hours',
      error: error.message
    });
  }
});

/**
 * Upload student profile picture
 * POST /api/users/:guardianId/students/:studentId/profile-picture
 * multipart/form-data { file }
 */
router.post('/:guardianId/students/:studentId/profile-picture', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { guardianId, studentId } = req.params;

    // Authorization: guardian can upload for their students, admins can upload for any
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    // Convert buffer to data URI
    const mime = file.mimetype || 'image/jpeg';
    const dataUri = `data:${mime};base64,${file.buffer.toString('base64')}`;

    let pictureUrl = dataUri;
    let picturePublicId = null;
    let pictureThumb = dataUri;
    let pictureThumbPublicId = null;

    // Try to upload to Cloudinary if configured
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      try {
        const { main, thumb } = await uploadImage(dataUri, { folder: `waraqa/student_pictures/${guardianId}/${studentId}` });
        pictureUrl = main.secure_url || main.url;
        picturePublicId = main.public_id;
        pictureThumb = thumb.secure_url || thumb.url;
        pictureThumbPublicId = thumb.public_id;
      } catch (uErr) {
        console.warn('Cloudinary upload failed for student picture, falling back to base64:', uErr && uErr.message);
      }
    }

    // Try updating embedded student first
    const guardian = await User.findById(guardianId);
    if (!guardian) return res.status(404).json({ message: 'Guardian not found' });

    let updatedStudent = null;

    // If student exists embedded in guardian, update that
    if (guardian.guardianInfo && Array.isArray(guardian.guardianInfo.students)) {
      const s = guardian.guardianInfo.students.id(studentId);
      if (s) {
        // Delete old images if public ids exist
        try {
          const toDelete = [];
          if (s.profilePicturePublicId) toDelete.push(s.profilePicturePublicId);
          if (s.profilePictureThumbnailPublicId) toDelete.push(s.profilePictureThumbnailPublicId);
          if (toDelete.length) await deleteImage(toDelete);
        } catch (dErr) { console.warn('Failed to delete old student images', dErr && dErr.message); }

  s.profilePicture = { url: pictureUrl, publicId: picturePublicId, thumbnail: pictureThumb, thumbnailPublicId: pictureThumbPublicId };

        await guardian.save();
        updatedStudent = guardian.guardianInfo.students.id(studentId);
        return res.json({ message: 'Student picture uploaded', student: updatedStudent });
      }
    }

    // If not embedded, try standalone Student collection
    const student = await Student.findById(studentId);
    if (student && String(student.guardian) === String(guardianId)) {
      try {
        const toDelete = [];
        if (student.profilePicture && student.profilePicture.publicId) toDelete.push(student.profilePicture.publicId);
        if (student.profilePicture && student.profilePicture.thumbnailPublicId) toDelete.push(student.profilePicture.thumbnailPublicId);
        if (toDelete.length) await deleteImage(toDelete);
      } catch (dErr) { console.warn('Failed to delete old standalone student images', dErr && dErr.message); }

  student.profilePicture = { url: pictureUrl, publicId: picturePublicId, thumbnail: pictureThumb, thumbnailPublicId: pictureThumbPublicId };
      await student.save();
      return res.json({ message: 'Student picture uploaded', student });
    }

    return res.status(404).json({ message: 'Student not found for this guardian' });
  } catch (error) {
    console.error('Upload student picture error:', error);
    res.status(500).json({ message: 'Failed to upload student picture', error: error.message });
  }
});

/**
 * Delete student profile picture
 * DELETE /api/users/:guardianId/students/:studentId/profile-picture
 */
router.delete('/:guardianId/students/:studentId/profile-picture', authenticateToken, async (req, res) => {
  try {
    const { guardianId, studentId } = req.params;
    if (req.user.id !== guardianId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const guardian = await User.findById(guardianId);
    if (!guardian) return res.status(404).json({ message: 'Guardian not found' });

    if (guardian.guardianInfo && Array.isArray(guardian.guardianInfo.students)) {
      const s = guardian.guardianInfo.students.id(studentId);
      if (s) {
        try {
          const toDelete = [];
          if (s.profilePicturePublicId) toDelete.push(s.profilePicturePublicId);
          if (s.profilePictureThumbnailPublicId) toDelete.push(s.profilePictureThumbnailPublicId);
          if (toDelete.length) await deleteImage(toDelete);
        } catch (dErr) { console.warn('Failed to delete old student images', dErr && dErr.message); }

  s.profilePicture = null;
        await guardian.save();
        return res.json({ message: 'Student picture removed', student: guardian.guardianInfo.students.id(studentId) });
      }
    }

    const student = await Student.findById(studentId);
    if (student && String(student.guardian) === String(guardianId)) {
      try {
        const toDelete = [];
        if (student.profilePicture && student.profilePicture.publicId) toDelete.push(student.profilePicture.publicId);
        if (student.profilePicture && student.profilePicture.thumbnailPublicId) toDelete.push(student.profilePicture.thumbnailPublicId);
        if (toDelete.length) await deleteImage(toDelete);
      } catch (dErr) { console.warn('Failed to delete standalone student images', dErr && dErr.message); }

  student.profilePicture = null;
      await student.save();
      return res.json({ message: 'Student picture removed', student });
    }

    return res.status(404).json({ message: 'Student not found for this guardian' });
  } catch (error) {
    console.error('Delete student picture error:', error);
    res.status(500).json({ message: 'Failed to delete student picture', error: error.message });
  }
});

/**
 * Update user active status (Admin only)
 * PUT /api/users/:id/status
 */
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  try {
    const user = await User.findByIdAndUpdate(id, { isActive }, { new: true });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User status updated successfully', user });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ message: 'Failed to update status', error: error.message });
  }
});

/**
 * Admin logs in as another user
 */
router.post('/:id/login-as', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userToImpersonate = await User.findById(req.params.id);
    if (!userToImpersonate) {
      return res.status(404).json({ message: 'User not found' });
    }

    const token = generateToken(userToImpersonate._id);

    res.json({
      user: userToImpersonate,
      token,
      originalAdmin: true,
    });
  } catch (err) {
    console.error('Login as user failed:', err);
    res.status(500).json({ message: 'Server error during login as user' });
  }
});

/**
 * Update teacher bonus (Admin only)
 * PUT /api/users/:id/bonus
 */
router.put('/:id/bonus', [
  authenticateToken,
  requireAdmin,
  body('bonus').isNumeric().withMessage('Bonus must be a number'),
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }
    
    const { id } = req.params;
    const { bonus } = req.body;
    
    const user = await User.findById(id);
    
    if (!user) {
      return res.status(404).json({
        message: 'User not found'
      });
    }
    
    if (user.role !== 'teacher') {
      return res.status(400).json({
        message: 'User is not a teacher'
      });
    }
    
    // Update teacher's bonus
    if (!user.teacherInfo) {
      user.teacherInfo = {};
    }
    
    user.teacherInfo.bonus = parseFloat(bonus);
    
    // Recalculate monthly earnings
    user.teacherInfo.monthlyEarnings = 
      (user.teacherInfo.monthlyHours || 0) * (user.teacherInfo.monthlyRate || 0) + user.teacherInfo.bonus;
    
    await user.save();
    
    res.json({
      message: 'Teacher bonus updated successfully',
      user: await User.findById(id).select('-password')
    });
    
  } catch (error) {
    console.error('Update teacher bonus error:', error);
    res.status(500).json({
      message: 'Failed to update teacher bonus',
      error: error.message
    });
  }
});

/**
 * Get guardians with zero hours (for invoice generation)
 * GET /api/users/guardians/zero-hours
 */
router.get('/guardians/zero-hours', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const guardians = await User.findGuardiansWithZeroHours();
    
    res.json({
      guardians,
      count: guardians.length
    });
    
  } catch (error) {
    console.error('Get zero hours guardians error:', error);
    res.status(500).json({
      message: 'Failed to fetch guardians with zero hours',
      error: error.message
    });
  }
});

/**
 * Update user timezone
 * PUT /api/users/timezone
 */
router.put('/timezone', 
  authenticateToken,
  [
    body('timezone')
      .notEmpty()
      .withMessage('Timezone is required')
      .custom((value) => {
        if (!isValidTimezone(value)) {
          throw new Error('Invalid timezone');
        }
        return true;
      })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { timezone } = req.body;
      const userId = req.user.id;

      // Update user timezone
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { timezone },
        { new: true, runValidators: true }
      ).select('-password');

      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json({
        message: 'Timezone updated successfully',
        user: updatedUser,
        timezone
      });
    } catch (error) {
      console.error('Update timezone error:', error);
      res.status(500).json({
        message: 'Failed to update timezone',
        error: error.message
      });
    }
  }
);

/**
 * Get available timezones
 * GET /api/users/timezones
 */
router.get('/timezones', authenticateToken, async (req, res) => {
  try {
    const { getAvailableTimezones } = require('../utils/timezoneUtils');
    const timezones = getAvailableTimezones();
    
    res.json({
      timezones,
      defaultTimezone: DEFAULT_TIMEZONE
    });
  } catch (error) {
    console.error('Get timezones error:', error);
    res.status(500).json({
      message: 'Failed to fetch timezones',
      error: error.message
    });
  }
});

/**
 * Upload profile picture
 * POST /api/users/:id/profile-picture
 * multipart/form-data { file }
 */
router.post('/:id/profile-picture', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const userId = req.params.id;

    // Authorization: user can upload for themselves or admins
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const file = req.file;
    if (!file) return res.status(400).json({ message: 'No file uploaded' });

    console.log('File received:', { 
      originalname: file.originalname, 
      mimetype: file.mimetype, 
      size: file.size,
      buffer: !!file.buffer 
    });

    // Convert buffer to base64 data URI
    const mime = file.mimetype || 'image/jpeg';
    const dataUri = `data:${mime};base64,${file.buffer.toString('base64')}`;

    let profilePictureUrl = dataUri;
    let profilePicturePublicId = null;
    let profilePictureThumbnail = dataUri;
    let profilePictureThumbnailPublicId = null;

    // Try to upload to Cloudinary if configured
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      try {
        console.log('Attempting to upload to Cloudinary...');
        const { main, thumb } = await uploadImage(dataUri, { folder: `waraqa/profile_pictures/${userId}` });
        console.log('Cloudinary upload successful:', { main: main?.secure_url, thumb: thumb?.secure_url });
        
        profilePictureUrl = main.secure_url || main.url;
        profilePicturePublicId = main.public_id;
        profilePictureThumbnail = thumb.secure_url || thumb.url;
        profilePictureThumbnailPublicId = thumb.public_id;
      } catch (cloudinaryError) {
        console.warn('Cloudinary upload failed, falling back to base64 storage:', cloudinaryError.message);
        // Continue with base64 fallback
      }
    } else {
      console.log('Cloudinary not configured, using base64 storage');
    }

    // Update user with new picture URL and public ids
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // If existing pictures exist and we have public IDs, remove them (best-effort)
    if (user.profilePicturePublicId || user.profilePictureThumbnailPublicId) {
      try {
        const toDelete = [];
        if (user.profilePicturePublicId) toDelete.push(user.profilePicturePublicId);
        if (user.profilePictureThumbnailPublicId) toDelete.push(user.profilePictureThumbnailPublicId);
        if (toDelete.length) await deleteImage(toDelete);
      } catch (derr) {
        console.warn('Failed to delete old profile pictures', derr.message || derr);
      }
    }

    user.profilePicture = profilePictureUrl;
    user.profilePicturePublicId = profilePicturePublicId;
    user.profilePictureThumbnail = profilePictureThumbnail;
    user.profilePictureThumbnailPublicId = profilePictureThumbnailPublicId;
    await user.save();

    console.log('User updated with new profile picture');

    res.json({ message: 'Profile picture uploaded', user: await User.findById(userId).select('-password') });
  } catch (error) {
    console.error('Upload profile picture error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Failed to upload profile picture', error: error.message, stack: error.stack });
  }
});

/**
 * Delete profile picture
 * DELETE /api/users/:id/profile-picture
 */
router.delete('/:id/profile-picture', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.id;
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const toDelete = [];
    if (user.profilePicturePublicId) toDelete.push(user.profilePicturePublicId);
    if (user.profilePictureThumbnailPublicId) toDelete.push(user.profilePictureThumbnailPublicId);
    if (toDelete.length) await deleteImage(toDelete);

    user.profilePicture = null;
    user.profilePicturePublicId = null;
    user.profilePictureThumbnail = null;
    user.profilePictureThumbnailPublicId = null;
    await user.save();

    res.json({ message: 'Profile picture removed', user: await User.findById(userId).select('-password') });
  } catch (error) {
    console.error('Delete profile picture error:', error);
    res.status(500).json({ message: 'Failed to delete profile picture', error: error.message });
  }
});

module.exports = router;
