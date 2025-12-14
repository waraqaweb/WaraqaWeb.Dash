const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fs = require('fs');
const fsPromises = require('fs/promises');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const libraryService = require('../services/libraryService');
const libraryAnnotationService = require('../services/libraryAnnotationService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.LIBRARY_UPLOAD_MAX_BYTES || 25 * 1024 * 1024)
  }
});

const annotationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many annotation requests, please slow down.',
    error: 'ANNOTATION_RATE_LIMIT'
  }
});

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      error: 'VALIDATION_ERROR',
      details: errors.array()
    });
  }
  next();
};

const shareTokenFromRequest = (req) => req.query.shareToken || req.headers['x-library-share'];
const resolveFolderParam = (value) => {
  if (!value || value === 'root' || value === 'null') return null;
  return value;
};

router.get(
  '/folders/tree',
  authenticateToken,
  async (req, res, next) => {
    try {
      const tree = await libraryService.getFolderTree({
        user: req.user,
        shareToken: shareTokenFromRequest(req)
      });
      res.json({ tree });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/folders/:folderId/items',
  authenticateToken,
  async (req, res, next) => {
    try {
      const folderId = resolveFolderParam(req.params.folderId);
      const payload = await libraryService.getFolderContents({
        user: req.user,
        parentId: folderId,
        includeItems: true,
        page: Number(req.query.page) || 1,
        limit: Math.min(Number(req.query.limit) || 25, 100),
        search: req.query.search || '',
        shareToken: shareTokenFromRequest(req)
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/search',
  authenticateToken,
  query('q').optional().isString().isLength({ min: 1 }).trim(),
  validate,
  async (req, res, next) => {
    try {
      const payload = await libraryService.searchItems({
        user: req.user,
        shareToken: shareTokenFromRequest(req),
        query: req.query.q,
        limit: Number(req.query.limit) || 24
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { parentId = null, includeItems = 'true', page = 1, limit = 25, search = '' } = req.query;
      const payload = await libraryService.getFolderContents({
        user: req.user,
        parentId: parentId || null,
        includeItems: includeItems !== 'false',
        page: Number(page) || 1,
        limit: Math.min(Number(limit) || 25, 100),
        search,
        shareToken: shareTokenFromRequest(req)
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  }
);


router.get(
  '/folders/:folderId',
  authenticateToken,
  async (req, res, next) => {
    try {
      const payload = await libraryService.getFolderContents({
        user: req.user,
        parentId: resolveFolderParam(req.params.folderId),
        includeItems: req.query.includeItems !== 'false',
        page: Number(req.query.page) || 1,
        limit: Math.min(Number(req.query.limit) || 25, 100),
        search: req.query.search || '',
        shareToken: shareTokenFromRequest(req)
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/folders/:folderId/breadcrumbs',
  authenticateToken,
  async (req, res, next) => {
    try {
      const breadcrumb = await libraryService.getFolderBreadcrumb({
        folderId: req.params.folderId,
        user: req.user,
        shareToken: shareTokenFromRequest(req)
      });
      res.json({ breadcrumb });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/folders',
  authenticateToken,
  requireAdmin,
  body('displayName').isString().trim().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const folder = await libraryService.createFolder({ payload: req.body, user: req.user });
      res.status(201).json(folder);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/folders/:folderId',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const folder = await libraryService.updateFolder({ folderId: req.params.folderId, payload: req.body, user: req.user });
      res.json(folder);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/folders/:folderId',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      await libraryService.deleteFolder({ folderId: req.params.folderId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/items',
  authenticateToken,
  requireAdmin,
  body('folder').isString(),
  body('displayName').isString().trim().notEmpty(),
  body('storage').isObject(),
  validate,
  async (req, res, next) => {
    try {
      const item = await libraryService.createItem({ payload: req.body, user: req.user });
      res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/items/upload',
  authenticateToken,
  requireAdmin,
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded', error: 'FILE_REQUIRED' });
      }
      const folderId = resolveFolderParam(req.body.folderId);
      if (!folderId) {
        return res.status(400).json({ message: 'Destination folder is required', error: 'FOLDER_REQUIRED' });
      }

      const payload = await libraryService.uploadLibraryAsset({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        folderId,
        user: req.user
      });

      res.status(201).json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  '/items/:itemId',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const item = await libraryService.updateItem({ itemId: req.params.itemId, payload: req.body, user: req.user });
      res.json(item);
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/items/:itemId',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      await libraryService.deleteItem({ itemId: req.params.itemId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/items/:itemId',
  authenticateToken,
  async (req, res, next) => {
    try {
      const payload = await libraryService.getItem({
        itemId: req.params.itemId,
        user: req.user,
        shareToken: shareTokenFromRequest(req)
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/items/:itemId/pages',
  authenticateToken,
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validate,
  async (req, res, next) => {
    try {
      const payload = await libraryService.getItemPages({
        itemId: req.params.itemId,
        user: req.user,
        shareToken: shareTokenFromRequest(req),
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 5
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/items/:itemId/download-ticket',
  authenticateToken,
  async (req, res, next) => {
    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const payload = await libraryService.getDownloadUrl({
        itemId: req.params.itemId,
        user: req.user,
        shareToken: shareTokenFromRequest(req),
        attachment: req.body?.attachment !== false,
        format: req.body?.format,
        baseUrl
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/items/:itemId/download',
  authenticateToken,
  async (req, res, next) => {
    try {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const payload = await libraryService.getDownloadUrl({
        itemId: req.params.itemId,
        user: req.user,
        shareToken: shareTokenFromRequest(req),
        attachment: req.query.attachment !== 'false',
        format: req.query.format,
        baseUrl
      });
      res.json(payload);
    } catch (error) {
      next(error);
    }
  }
);

router.get('/assets/download', async (req, res, next) => {
  try {
    const { token } = req.query;
    const { asset, payload } = await libraryService.resolveLocalDownloadToken(token);
    const fileName = payload.fileName || asset.fileName || 'library-file';
    const disposition = payload.attachment === false ? 'inline' : 'attachment';

    res.setHeader('Content-Type', asset.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileName.replace(/"/g, '')}"`);

    if (asset.storagePath) {
      try {
        const stats = await fsPromises.stat(asset.storagePath);
        res.setHeader('Content-Length', stats.size);
        return fs.createReadStream(asset.storagePath).pipe(res);
      } catch (fileError) {
        if (!asset.data) {
          throw libraryService.httpError(500, 'Stored file is missing. Please re-upload.', 'ASSET_FILE_MISSING');
        }
        console.warn('Falling back to embedded asset data', fileError);
      }
    }

    res.setHeader('Content-Length', asset.bytes || asset.data?.length || 0);
    return res.send(asset.data);
  } catch (error) {
    next(error);
  }
});

const annotationValidators = [
  authenticateToken,
  annotationLimiter,
  body('payload').optional().isObject(),
  body('activeTool').optional().isString(),
  body('undoDepth').optional().isInt({ min: 0 }),
  body('redoDepth').optional().isInt({ min: 0 })
];

router.get(
  '/items/:itemId/annotations/:pageNumber',
  authenticateToken,
  param('pageNumber').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const snapshot = await libraryAnnotationService.getSnapshot({
        itemId: req.params.itemId,
        userId: req.user._id,
        pageNumber: Number(req.params.pageNumber)
      });
      res.json({ snapshot });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/items/:itemId/annotations/:pageNumber',
  annotationValidators,
  param('pageNumber').isInt({ min: 1 }),
  body('payload').isObject(),
  validate,
  async (req, res, next) => {
    try {
      const snapshot = await libraryAnnotationService.saveSnapshot({
        itemId: req.params.itemId,
        userId: req.user._id,
        pageNumber: Number(req.params.pageNumber),
        payload: req.body.payload,
        activeTool: req.body.activeTool,
        undoDepth: req.body.undoDepth,
        redoDepth: req.body.redoDepth,
        persist: req.body.persist === true
      });
      res.json({ snapshot });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/items/:itemId/annotations/:pageNumber',
  authenticateToken,
  annotationLimiter,
  param('pageNumber').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      await libraryAnnotationService.clearSnapshot({
        itemId: req.params.itemId,
        userId: req.user._id,
        pageNumber: Number(req.params.pageNumber)
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/items/:itemId/annotations',
  authenticateToken,
  query('pageNumber').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      const snapshot = await libraryAnnotationService.getSnapshot({
        itemId: req.params.itemId,
        userId: req.user._id,
        pageNumber: Number(req.query.pageNumber)
      });
      res.json({ snapshot });
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/items/:itemId/annotations',
  annotationValidators,
  body('pageNumber').isInt({ min: 1 }),
  body('payload').isObject(),
  validate,
  async (req, res, next) => {
    try {
      const snapshot = await libraryAnnotationService.saveSnapshot({
        itemId: req.params.itemId,
        userId: req.user._id,
        pageNumber: req.body.pageNumber,
        payload: req.body.payload,
        activeTool: req.body.activeTool,
        undoDepth: req.body.undoDepth,
        redoDepth: req.body.redoDepth,
        persist: req.body.persist === true
      });
      res.json({ snapshot });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  '/items/:itemId/annotations',
  authenticateToken,
  annotationLimiter,
  query('pageNumber').isInt({ min: 1 }),
  validate,
  async (req, res, next) => {
    try {
      await libraryAnnotationService.clearSnapshot({
        itemId: req.params.itemId,
        userId: req.user._id,
        pageNumber: Number(req.query.pageNumber)
      });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
