const express = require('express');
const mongoose = require('mongoose');
const Request = require('../models/Request');
const User = require('../models/User');
const Setting = require('../models/Setting');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const {
  REQUEST_STATUSES,
  REQUEST_CATEGORIES,
  REQUEST_TYPES,
  REQUEST_TYPE_KEYS,
} = require('../constants/requestTypes');

const router = express.Router();

const toObjectId = (value) => {
  if (!value) return null;
  try {
    if (value instanceof mongoose.Types.ObjectId) return value;
    if (mongoose.Types.ObjectId.isValid(String(value))) {
      return new mongoose.Types.ObjectId(String(value));
    }
  } catch (err) {
    return null;
  }
  return null;
};

const cleanString = (value) => String(value || '').trim();
const isAdminRole = (role) => role === 'admin';
const REQUESTS_VISIBILITY_KEY = 'requestsVisibility';
const REQUESTS_VISIBILITY_ALLOWED = ['admin_only', 'admin_teacher', 'all_users'];

const normalizeRequestsVisibility = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return REQUESTS_VISIBILITY_ALLOWED.includes(normalized) ? normalized : 'all_users';
};

const getAllowedRolesForVisibility = (visibility) => {
  if (visibility === 'admin_only') return ['admin'];
  if (visibility === 'admin_teacher') return ['admin', 'teacher'];
  return ['admin', 'teacher', 'guardian', 'student'];
};

const getCreatorRolesForVisibility = (visibility) => {
  if (visibility === 'admin_only') return ['admin'];
  if (visibility === 'admin_teacher') return ['admin', 'teacher'];
  return ['admin', 'teacher', 'guardian', 'student'];
};

const getRequestsVisibility = async () => {
  const setting = await Setting.findOne({ key: REQUESTS_VISIBILITY_KEY }).select('value').lean();
  return normalizeRequestsVisibility(setting?.value);
};

const enforceRequestsVisibility = async (req, res, next) => {
  try {
    const visibility = await getRequestsVisibility();
    const allowedRoles = getAllowedRolesForVisibility(visibility);
    if (!allowedRoles.includes(req.user?.role)) {
      return res.status(403).json({ message: 'Requests section is not available for your role' });
    }
    req.requestsVisibility = visibility;
    return next();
  } catch (error) {
    console.error('Requests visibility check failed:', error);
    return res.status(500).json({ message: 'Failed to validate requests access' });
  }
};

const isCreatorRoleAllowed = (role, visibility) => getCreatorRolesForVisibility(visibility).includes(role);

const buildDefaultTitle = (type) => REQUEST_TYPES[type]?.label || 'Request';

const canAccessRequest = (reqUser, requestDoc) => {
  if (!reqUser || !requestDoc) return false;
  if (isAdminRole(reqUser.role)) return true;
  return String(requestDoc.createdBy?.userId || '') === String(reqUser._id || '');
};

const pushTimeline = (requestDoc, timelineItem) => {
  const entry = {
    action: timelineItem.action,
    status: timelineItem.status,
    note: cleanString(timelineItem.note),
    byUser: timelineItem.byUser || null,
    byRole: timelineItem.byRole || null,
  };
  requestDoc.timeline = Array.isArray(requestDoc.timeline) ? requestDoc.timeline : [];
  requestDoc.timeline.push(entry);
};

const notifyAdminsAboutNewRequest = async (requestDoc) => {
  const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
  if (!admins.length) return;

  await Promise.allSettled(
    admins.map((admin) =>
      notificationService.createNotification({
        userId: admin._id,
        title: `New request: ${requestDoc.title}`,
        message: `${requestDoc.createdBy?.name || 'User'} submitted ${requestDoc.requestCode}.`,
        type: 'request',
        relatedTo: 'request',
        relatedId: requestDoc._id,
        actionRequired: true,
        actionLink: '/dashboard/requests',
        metadata: {
          kind: 'structured_request',
          requestId: String(requestDoc._id),
          requestCode: requestDoc.requestCode,
          status: requestDoc.status,
          category: requestDoc.category,
          type: requestDoc.type,
        },
      })
    )
  );
};

const notifyRequestOwner = async (requestDoc, title, message) => {
  const ownerId = requestDoc?.createdBy?.userId;
  if (!ownerId) return;
  await notificationService.createNotification({
    userId: ownerId,
    title,
    message,
    type: 'request',
    relatedTo: 'request',
    relatedId: requestDoc._id,
    actionRequired: false,
    actionLink: '/dashboard/requests',
    metadata: {
      kind: 'structured_request',
      requestId: String(requestDoc._id),
      requestCode: requestDoc.requestCode,
      status: requestDoc.status,
      category: requestDoc.category,
      type: requestDoc.type,
    },
  });
};

router.use(requireAuth, enforceRequestsVisibility);

router.get('/summary', async (req, res) => {
  try {
    const match = { deletedAt: null };
    if (!isAdminRole(req.user.role)) {
      match['createdBy.userId'] = req.user._id;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [statusRows, doneToday] = await Promise.all([
      Request.aggregate([
        { $match: match },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Request.countDocuments({ ...match, status: 'done', updatedAt: { $gte: todayStart } }),
    ]);

    const statusMap = REQUEST_STATUSES.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});

    statusRows.forEach((row) => {
      statusMap[row._id] = row.count;
    });

    const total = Object.values(statusMap).reduce((sum, value) => sum + Number(value || 0), 0);

    return res.json({
      summary: {
        total,
        ...statusMap,
        doneToday,
      },
    });
  } catch (error) {
    console.error('GET /requests/summary error:', error);
    return res.status(500).json({ message: 'Failed to load request summary' });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filters = { deletedAt: null };

    if (!isAdminRole(req.user.role)) {
      filters['createdBy.userId'] = req.user._id;
    }

    const status = cleanString(req.query.status).toLowerCase();
    if (status && REQUEST_STATUSES.includes(status)) {
      filters.status = status;
    }

    const category = cleanString(req.query.category).toLowerCase();
    if (category && REQUEST_CATEGORIES.includes(category)) {
      filters.category = category;
    }

    const type = cleanString(req.query.type).toLowerCase();
    if (type && REQUEST_TYPE_KEYS.includes(type)) {
      filters.type = type;
    }

    if (isAdminRole(req.user.role)) {
      const createdByUserId = toObjectId(req.query.createdByUserId);
      if (createdByUserId) {
        filters['createdBy.userId'] = createdByUserId;
      }

      const studentId = toObjectId(req.query.studentId);
      if (studentId) {
        filters['student.studentId'] = studentId;
      }
    }

    const q = cleanString(req.query.q);
    if (q) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filters.$or = [
        { requestCode: regex },
        { title: regex },
        { description: regex },
        { 'createdBy.name': regex },
        { 'student.name': regex },
      ];
    }

    const [items, total] = await Promise.all([
      Request.find(filters).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Request.countDocuments(filters),
    ]);

    return res.json({
      requests: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('GET /requests error:', error);
    return res.status(500).json({ message: 'Failed to load requests' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const requestDoc = await Request.findById(req.params.id).lean();
    if (!requestDoc || requestDoc.deletedAt) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!canAccessRequest(req.user, requestDoc)) {
      return res.status(403).json({ message: 'Not allowed to access this request' });
    }

    return res.json({ request: requestDoc });
  } catch (error) {
    console.error('GET /requests/:id error:', error);
    return res.status(500).json({ message: 'Failed to load request' });
  }
});

router.post('/', async (req, res) => {
  try {
    const visibility = req.requestsVisibility || 'all_users';
    if (!isCreatorRoleAllowed(req.user.role, visibility)) {
      return res.status(403).json({ message: 'You are not allowed to submit requests' });
    }

    const type = cleanString(req.body.type).toLowerCase();
    const category = cleanString(req.body.category).toLowerCase();

    if (!REQUEST_TYPE_KEYS.includes(type)) {
      return res.status(400).json({ message: 'Invalid request type' });
    }

    const expectedCategory = REQUEST_TYPES[type]?.category;
    if (!REQUEST_CATEGORIES.includes(category) || category !== expectedCategory) {
      return res.status(400).json({ message: 'Invalid request category for selected type' });
    }

    const title = cleanString(req.body.title) || buildDefaultTitle(type);
    const description = cleanString(req.body.description);
    if (!description) {
      return res.status(400).json({ message: 'Description is required' });
    }

    const studentId = toObjectId(req.body.studentId);
    const relatedClassId = toObjectId(req.body.relatedClassId);
    const relatedInvoiceId = toObjectId(req.body.relatedInvoiceId);

    const requestDoc = new Request({
      category,
      type,
      title,
      description,
      status: 'pending',
      urgency: ['low', 'normal', 'high', 'urgent'].includes(req.body.urgency) ? req.body.urgency : 'normal',
      createdBy: {
        userId: req.user._id,
        role: req.user.role,
        name: req.user.fullName || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'User',
      },
      student: {
        studentId,
        name: cleanString(req.body.studentName),
      },
      relatedClassId,
      relatedInvoiceId,
      details: req.body.details && typeof req.body.details === 'object' ? req.body.details : {},
      adminNotes: '',
      timeline: [],
    });

    pushTimeline(requestDoc, {
      action: 'created',
      status: 'pending',
      note: 'Request submitted',
      byUser: req.user._id,
      byRole: req.user.role,
    });

    await requestDoc.save();

    await Promise.allSettled([
      notifyAdminsAboutNewRequest(requestDoc),
      notifyRequestOwner(
        requestDoc,
        `Request submitted: ${requestDoc.requestCode}`,
        `Your request is now pending review.`
      ),
    ]);

    return res.status(201).json({
      message: 'Request submitted successfully',
      request: requestDoc,
    });
  } catch (error) {
    console.error('POST /requests error:', error);
    return res.status(500).json({ message: 'Failed to submit request' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const requestDoc = await Request.findById(req.params.id);
    if (!requestDoc || requestDoc.deletedAt) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!canAccessRequest(req.user, requestDoc)) {
      return res.status(403).json({ message: 'Not allowed to update this request' });
    }

    const isAdmin = isAdminRole(req.user.role);

    if (req.body.category || req.body.type) {
      const nextType = cleanString(req.body.type || requestDoc.type).toLowerCase();
      const nextCategory = cleanString(req.body.category || requestDoc.category).toLowerCase();
      const expectedCategory = REQUEST_TYPES[nextType]?.category;
      if (!REQUEST_TYPE_KEYS.includes(nextType) || !REQUEST_CATEGORIES.includes(nextCategory) || nextCategory !== expectedCategory) {
        return res.status(400).json({ message: 'Invalid category/type combination' });
      }
      requestDoc.type = nextType;
      requestDoc.category = nextCategory;
    }

    if (req.body.title !== undefined) {
      requestDoc.title = cleanString(req.body.title) || buildDefaultTitle(requestDoc.type);
    }

    if (req.body.description !== undefined) {
      const description = cleanString(req.body.description);
      if (!description) {
        return res.status(400).json({ message: 'Description is required' });
      }
      requestDoc.description = description;
    }

    if (req.body.urgency !== undefined) {
      const urgency = cleanString(req.body.urgency).toLowerCase();
      if (!['low', 'normal', 'high', 'urgent'].includes(urgency)) {
        return res.status(400).json({ message: 'Invalid urgency level' });
      }
      requestDoc.urgency = urgency;
    }

    if (req.body.studentId !== undefined || req.body.studentName !== undefined) {
      requestDoc.student = requestDoc.student || {};
      requestDoc.student.studentId = toObjectId(req.body.studentId);
      requestDoc.student.name = cleanString(req.body.studentName || requestDoc.student?.name);
    }

    if (req.body.relatedClassId !== undefined) {
      requestDoc.relatedClassId = toObjectId(req.body.relatedClassId);
    }

    if (req.body.relatedInvoiceId !== undefined) {
      requestDoc.relatedInvoiceId = toObjectId(req.body.relatedInvoiceId);
    }

    if (req.body.details !== undefined) {
      requestDoc.details = req.body.details && typeof req.body.details === 'object' ? req.body.details : {};
    }

    if (isAdmin && req.body.adminNotes !== undefined) {
      requestDoc.adminNotes = cleanString(req.body.adminNotes);
    }

    if (isAdmin && req.body.status !== undefined) {
      const nextStatus = cleanString(req.body.status).toLowerCase();
      if (!REQUEST_STATUSES.includes(nextStatus)) {
        return res.status(400).json({ message: 'Invalid status value' });
      }
      requestDoc.status = nextStatus;
    }

    const updateNote = cleanString(req.body.updateNote) || 'Request updated';
    pushTimeline(requestDoc, {
      action: 'updated',
      status: requestDoc.status,
      note: updateNote,
      byUser: req.user._id,
      byRole: req.user.role,
    });

    await requestDoc.save();

    if (isAdmin && String(requestDoc.createdBy?.userId || '') !== String(req.user._id || '')) {
      await notifyRequestOwner(
        requestDoc,
        `Request updated: ${requestDoc.requestCode}`,
        `Admin updated your request. Current status: ${requestDoc.status}.`
      );
    }

    return res.json({
      message: 'Request updated successfully',
      request: requestDoc,
    });
  } catch (error) {
    console.error('PUT /requests/:id error:', error);
    return res.status(500).json({ message: 'Failed to update request' });
  }
});

router.post('/:id/status', requireAdmin, async (req, res) => {
  try {
    const requestDoc = await Request.findById(req.params.id);
    if (!requestDoc || requestDoc.deletedAt) {
      return res.status(404).json({ message: 'Request not found' });
    }

    const status = cleanString(req.body.status).toLowerCase();
    const note = cleanString(req.body.note);

    if (!REQUEST_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    requestDoc.status = status;
    if (note) {
      requestDoc.adminNotes = note;
    }

    pushTimeline(requestDoc, {
      action: 'status_changed',
      status,
      note: note || `Status changed to ${status}`,
      byUser: req.user._id,
      byRole: req.user.role,
    });

    await requestDoc.save();

    await notifyRequestOwner(
      requestDoc,
      `Request ${requestDoc.requestCode}: ${status}`,
      note || `Your request status changed to ${status}.`
    );

    return res.json({
      message: 'Request status updated successfully',
      request: requestDoc,
    });
  } catch (error) {
    console.error('POST /requests/:id/status error:', error);
    return res.status(500).json({ message: 'Failed to update request status' });
  }
});

router.post('/:id/follow-up', async (req, res) => {
  try {
    const requestDoc = await Request.findById(req.params.id);
    if (!requestDoc || requestDoc.deletedAt) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!canAccessRequest(req.user, requestDoc)) {
      return res.status(403).json({ message: 'Not allowed to update this request' });
    }

    const note = cleanString(req.body.note);
    if (!note) {
      return res.status(400).json({ message: 'Follow-up note is required' });
    }

    pushTimeline(requestDoc, {
      action: 'follow_up',
      status: requestDoc.status,
      note,
      byUser: req.user._id,
      byRole: req.user.role,
    });

    await requestDoc.save();

    if (!isAdminRole(req.user.role)) {
      await notifyAdminsAboutNewRequest(requestDoc);
    } else {
      await notifyRequestOwner(
        requestDoc,
        `Follow-up on ${requestDoc.requestCode}`,
        note
      );
    }

    return res.json({ message: 'Follow-up added', request: requestDoc });
  } catch (error) {
    console.error('POST /requests/:id/follow-up error:', error);
    return res.status(500).json({ message: 'Failed to add follow-up' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const requestDoc = await Request.findById(req.params.id);
    if (!requestDoc || requestDoc.deletedAt) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!canAccessRequest(req.user, requestDoc)) {
      return res.status(403).json({ message: 'Not allowed to delete this request' });
    }

    requestDoc.deletedAt = new Date();
    requestDoc.deletedBy = req.user._id;

    pushTimeline(requestDoc, {
      action: 'deleted',
      status: requestDoc.status,
      note: 'Request deleted',
      byUser: req.user._id,
      byRole: req.user.role,
    });

    await requestDoc.save();

    if (isAdminRole(req.user.role) && String(requestDoc.createdBy?.userId || '') !== String(req.user._id || '')) {
      await notifyRequestOwner(
        requestDoc,
        `Request deleted: ${requestDoc.requestCode}`,
        'An admin deleted your request.'
      );
    }

    return res.json({ message: 'Request deleted successfully' });
  } catch (error) {
    console.error('DELETE /requests/:id error:', error);
    return res.status(500).json({ message: 'Failed to delete request' });
  }
});

module.exports = router;
