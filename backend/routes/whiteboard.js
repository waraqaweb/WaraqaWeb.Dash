const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const libraryService = require('../services/libraryService');
const LibraryFolder = require('../models/library/LibraryFolder');
const Class = require('../models/Class');

const router = express.Router();

const ensureWhiteboardFolder = async (user) => {
  const existing = await LibraryFolder.findOne({ displayName: 'Whiteboard Uploads', parentFolder: null });
  if (existing) return existing;

  const folder = new LibraryFolder({
    displayName: 'Whiteboard Uploads',
    description: 'Uploads from whiteboard screenshots.',
    parentFolder: null,
    ancestors: [],
    isRoot: true,
    isSecret: false,
    allowDownloads: true,
    createdBy: user?._id,
    updatedBy: user?._id,
    stats: { folders: 0, items: 0, sizeBytes: 0 }
  });

  await folder.save();
  return folder;
};

const buildUniqueFileName = (name, mimeType) => {
  const ext = mimeType && mimeType.includes('jpeg') ? 'jpg' : 'png';
  const base = typeof name === 'string' && name.trim() ? name.trim() : `whiteboard-${Date.now()}.${ext}`;
  const match = base.match(/^(.*?)(\.[a-z0-9]+)?$/i);
  const stem = match && match[1] ? match[1] : `whiteboard-${Date.now()}`;
  const suffix = Date.now().toString(36);
  const extension = match && match[2] ? match[2] : `.${ext}`;
  return `${stem}-${suffix}${extension}`;
};

router.get('/recent-classes', authenticateToken, async (req, res, next) => {
  try {
    if (!['admin', 'teacher'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const now = new Date();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const query = {
      $and: [
        { scheduledDate: { $type: 'date' } },
        { scheduledDate: { $gte: since, $lte: now } }
      ],
      status: { $ne: 'pattern' }
    };

    if (req.user?.role === 'teacher') {
      query.teacher = req.user._id;
    }

    const search = String(req.query.q || '').trim();
    if (search) {
      query['student.studentName'] = { $regex: escapeRegex(search), $options: 'i' };
    }

    let classes = [];
    try {
      classes = await Class.find(query)
        .select('_id scheduledDate duration status teacher student.studentName student.studentId student.guardianId')
        .populate('teacher', 'firstName lastName')
        .sort({ scheduledDate: -1 })
        .limit(50)
        .lean();
    } catch (err) {
      console.warn('whiteboard recent-classes fallback:', err && err.message);
      classes = await Class.find(query)
        .select('_id scheduledDate duration status teacher student.studentName student.studentId student.guardianId')
        .sort({ scheduledDate: -1 })
        .limit(50)
        .lean();
    }

    res.json({ success: true, classes });
  } catch (error) {
    console.error('whiteboard recent-classes error:', error && (error.stack || error));
    res.json({ success: true, classes: [] });
  }
});

router.post('/screenshot', authenticateToken, async (req, res, next) => {
  try {
    const { imageData, fileName } = req.body || {};
    if (!imageData || typeof imageData !== 'string') {
      return res.status(400).json({ success: false, message: 'imageData is required' });
    }

    const match = imageData.match(/^data:(image\/(png|jpeg));base64,(.+)$/i);
    if (!match) {
      return res.status(400).json({ success: false, message: 'imageData must be a base64 data URL (png or jpeg)' });
    }

    const mimeType = match[1].toLowerCase();
    const buffer = Buffer.from(match[3], 'base64');
    const folder = await ensureWhiteboardFolder(req.user);

    const normalizedName = buildUniqueFileName(fileName, mimeType);

    const uploadPayload = await libraryService.uploadLibraryAsset({
      buffer,
      bytes: buffer.length,
      fileName: normalizedName,
      mimeType,
      folderId: folder._id,
      user: req.user
    });

    const item = await libraryService.createItem({
      payload: {
        folder: folder._id.toString(),
        displayName: normalizedName,
        storage: uploadPayload.storage,
        contentType: 'image',
        mimeType,
        allowDownload: true,
        status: 'ready',
        metadata: {
          source: 'whiteboard',
          uploadedBy: req.user?._id,
          uploadedAt: new Date().toISOString()
        }
      },
      user: req.user
    });
    const itemId = item?.id || item?._id;

    try {
      await notificationService.notifyRole({
        role: 'admin',
        title: 'Whiteboard screenshot received',
        message: `A whiteboard screenshot was sent by ${req.user?.firstName || 'a user'}. Open the library to attach it to a class from the last 24 hours.`,
        type: 'info',
        related: {
          relatedTo: 'library_share',
          relatedId: itemId,
          metadata: {
            kind: 'whiteboard_screenshot',
            itemId,
            fileName: normalizedName,
            uploadedBy: req.user?._id
          }
        }
      });
    } catch (notifyErr) {
      console.warn('Failed to notify admins about whiteboard screenshot:', notifyErr && notifyErr.message);
    }

    res.json({ success: true, itemId });
  } catch (error) {
    next(error);
  }
});

router.post('/screenshot/class', authenticateToken, async (req, res, next) => {
  try {
    if (!['admin', 'teacher'].includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Not allowed' });
    }
    const { imageData, fileName, classId } = req.body || {};
    if (!classId) {
      return res.status(400).json({ success: false, message: 'classId is required' });
    }
    if (!imageData || typeof imageData !== 'string') {
      return res.status(400).json({ success: false, message: 'imageData is required' });
    }

    const classDoc = await Class.findById(classId);
    if (!classDoc) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }
    if (classDoc.status === 'pattern') {
      return res.status(400).json({ success: false, message: 'Cannot attach to recurring pattern classes' });
    }

    const match = imageData.match(/^data:(image\/(png|jpeg));base64,(.+)$/i);
    if (!match) {
      return res.status(400).json({ success: false, message: 'imageData must be a base64 data URL (png or jpeg)' });
    }

    const mimeType = match[1].toLowerCase();
    const buffer = Buffer.from(match[3], 'base64');
    const folder = await ensureWhiteboardFolder(req.user);

    const normalizedName = buildUniqueFileName(fileName, mimeType);

    const uploadPayload = await libraryService.uploadLibraryAsset({
      buffer,
      bytes: buffer.length,
      fileName: normalizedName,
      mimeType,
      folderId: folder._id,
      user: req.user
    });

    const item = await libraryService.createItem({
      payload: {
        folder: folder._id.toString(),
        displayName: normalizedName,
        storage: uploadPayload.storage,
        contentType: 'image',
        mimeType,
        allowDownload: true,
        status: 'ready',
        metadata: {
          source: 'whiteboard',
          classId: classDoc._id,
          uploadedByRole: req.user?.role || null,
          uploadedBy: req.user?._id,
          uploadedAt: new Date().toISOString()
        }
      },
      user: req.user
    });
    const itemId = item?.id || item?._id;

    classDoc.materials = Array.isArray(classDoc.materials) ? classDoc.materials : [];
    classDoc.materials.push({
      name: normalizedName,
      url: `/api/library/items/${itemId}/download?attachment=false`,
      libraryItem: itemId,
      kind: 'whiteboard',
      type: 'document',
      uploadedBy: req.user?._id || null,
      uploadedByRole: req.user?.role || null,
      uploadedAt: new Date()
    });
    await classDoc.save();

    res.json({ success: true, itemId, classId: classDoc._id });
  } catch (error) {
    next(error);
  }
});

router.delete('/screenshot/class/:classId/:materialId', authenticateToken, requireAdmin, async (req, res, next) => {
  try {
    const { classId, materialId } = req.params;
    const classDoc = await Class.findById(classId);
    if (!classDoc) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    const material = (classDoc.materials || []).find((m) => String(m._id) === String(materialId));
    if (!material) {
      return res.status(404).json({ success: false, message: 'Material not found' });
    }

    if (material.libraryItem) {
      try {
        await libraryService.deleteItem({ itemId: material.libraryItem });
      } catch (err) {
        console.warn('Failed to delete library item for whiteboard material:', err && err.message);
      }
    }

    await Class.updateOne(
      { _id: classDoc._id },
      { $pull: { materials: { _id: material._id } } }
    );

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
