const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const axios = require('axios');
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth, requireAdmin } = require('../middleware/auth');
const libraryService = require('../services/libraryService');
const libraryAnnotationService = require('../services/libraryAnnotationService');
const LibraryAsset = require('../models/library/LibraryAsset');
const { normalizeUtf8FromLatin1 } = require('../utils/textEncoding');

const router = express.Router();

const getPublicBaseUrl = (req) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = String(forwardedProto || req.protocol || 'http')
    .split(',')[0]
    .trim();
  return `${proto}://${req.get('host')}`;
};

const makeLogger = (label) => (phase, details = {}) => {
  const base = {
    at: new Date().toISOString(),
    phase
  };
  console.log(label, JSON.stringify({ ...base, ...details }));
};

const logPreview = makeLogger('[library:preview]');
const logAssetDownload = makeLogger('[library:asset-download]');

const LIBRARY_UPLOAD_TMP_DIR =
  process.env.LIBRARY_UPLOAD_TMP_DIR || path.join(__dirname, '..', 'tmp', 'library-uploads');

try {
  fs.mkdirSync(LIBRARY_UPLOAD_TMP_DIR, { recursive: true });
} catch (e) {
  // ignore; multer will surface an error when it tries to write
}

const upload = multer({
  dest: LIBRARY_UPLOAD_TMP_DIR,
  limits: {
    // Default: 250MB (can be overridden via LIBRARY_UPLOAD_MAX_BYTES)
    fileSize: Number(process.env.LIBRARY_UPLOAD_MAX_BYTES || 250 * 1024 * 1024)
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

const parseNumberEnv = (key) => {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

router.get(
  '/storage/usage',
  authenticateToken,
  requireAdmin,
  async (req, res, next) => {
    try {
      const uploadMaxBytes =
        parseNumberEnv('LIBRARY_UPLOAD_MAX_BYTES') || 250 * 1024 * 1024;

      const maxBytes =
        parseNumberEnv('LIBRARY_STORAGE_LIMIT_BYTES') ||
        (parseNumberEnv('LIBRARY_STORAGE_LIMIT_MB')
          ? parseNumberEnv('LIBRARY_STORAGE_LIMIT_MB') * 1024 * 1024
          : null) ||
        20 * 1024 * 1024 * 1024;

      const warningPercent =
        parseNumberEnv('LIBRARY_STORAGE_WARNING_PERCENT') || 0.7;
      const criticalPercent =
        parseNumberEnv('LIBRARY_STORAGE_CRITICAL_PERCENT') || 0.9;

      const [usage] = await LibraryAsset.aggregate([
        {
          $group: {
            _id: null,
            usedBytes: { $sum: '$bytes' },
            assetCount: { $sum: 1 }
          }
        }
      ]);

      const usedBytes = Number(usage?.usedBytes || 0);
      const remainingBytes = Math.max(maxBytes - usedBytes, 0);
      const percentUsed = maxBytes > 0 ? usedBytes / maxBytes : 0;

      res.json({
        usedBytes,
        remainingBytes,
        maxBytes,
        percentUsed,
        assetCount: Number(usage?.assetCount || 0),
        uploadMaxBytes,
        thresholds: {
          warningPercent,
          criticalPercent
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/folders/tree',
  optionalAuth,
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
  optionalAuth,
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
  optionalAuth,
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
  optionalAuth,
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
  optionalAuth,
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
  optionalAuth,
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
    const tmpPath = req.file?.path;
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded', error: 'FILE_REQUIRED' });
      }
      const folderId = resolveFolderParam(req.body.folderId);
      if (!folderId) {
        return res.status(400).json({ message: 'Destination folder is required', error: 'FOLDER_REQUIRED' });
      }

      const originalName = normalizeUtf8FromLatin1(req.file.originalname);

      const payload = await libraryService.uploadLibraryAsset({
        filePath: req.file.path,
        fileName: originalName,
        mimeType: req.file.mimetype,
        bytes: req.file.size,
        folderId,
        user: req.user
      });

      res.status(201).json(payload);
    } catch (error) {
      next(error);
    } finally {
      if (tmpPath) {
        fsPromises.unlink(tmpPath).catch(() => {});
      }
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
  optionalAuth,
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
  optionalAuth,
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
      const total = typeof payload.total === 'number' ? payload.total : 0;
      const page = typeof payload.page === 'number' ? payload.page : Number(req.query.page) || 1;
      const limit = typeof payload.limit === 'number' ? payload.limit : Number(req.query.limit) || 5;
      const received = Array.isArray(payload.pages) ? payload.pages.length : 0;
      const startIndex = Math.max((page - 1) * limit, 0);
      const hasMore = total > 0 ? startIndex + received < total : received >= limit;
      res.json({ ...payload, hasMore });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/items/:itemId/download-ticket',
  optionalAuth,
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
  optionalAuth,
  async (req, res, next) => {
    try {
      const baseUrl = getPublicBaseUrl(req);
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

// Streams a previewable asset to the browser from a same-origin URL.
// This avoids CORS and iframe/header limitations for protected assets.
router.get(
  '/items/:itemId/preview',
  optionalAuth,
  async (req, res, next) => {
    try {
      const baseUrl = getPublicBaseUrl(req);
      const attachment = req.query.attachment === 'true';
      const logContext = {
        itemId: req.params.itemId,
        attachment,
        shareToken: Boolean(shareTokenFromRequest(req)),
        baseUrl
      };
      logPreview('start', logContext);
      const payload = await libraryService.getDownloadUrl({
        itemId: req.params.itemId,
        user: req.user,
        shareToken: shareTokenFromRequest(req),
        attachment,
        format: req.query.format,
        baseUrl
      });

      if (!payload?.url) {
        logPreview('no-url', logContext);
        return res.status(404).json({ message: 'Preview URL not found' });
      }

      // If we already generated a same-origin token URL (local provider), just redirect.
      if (payload.url.startsWith(`${baseUrl}/api/library/assets/download?`)) {
        logPreview('redirect-local', { ...logContext, target: payload.url });
        return res.redirect(302, payload.url);
      }

      // Otherwise proxy the remote stream (e.g., Cloudinary signed URL).
      const upstreamHeaders = {
        // Hint content-type selection to upstream; harmless if ignored.
        Accept: 'application/pdf,*/*'
      };

      // Forward Range when the browser opens the preview URL directly.
      // This makes large PDFs much more reliable in Chrome.
      if (req.headers.range) {
        upstreamHeaders.Range = req.headers.range;
      }

      const upstreamStarted = Date.now();
      const upstream = await axios.get(payload.url, {
        responseType: 'stream',
        // Remote storage can be slow; allow more time than the default 60s.
        timeout: 5 * 60_000,
        validateStatus: () => true,
        headers: upstreamHeaders
      });

      if (upstream.status < 200 || upstream.status >= 300) {
        logPreview('upstream-error-status', {
          ...logContext,
          upstreamStatus: upstream.status
        });
        return res.status(502).json({
          message: 'Preview upstream request failed',
          upstreamStatus: upstream.status
        });
      }

      logPreview('upstream-ok', {
        ...logContext,
        upstreamStatus: upstream.status,
        elapsedMs: Date.now() - upstreamStarted,
        contentLength: upstream.headers?.['content-length']
      });

      const contentType = upstream.headers?.['content-type'] || 'application/pdf';
      const contentLength = upstream.headers?.['content-length'];
      const contentRange = upstream.headers?.['content-range'];
      const acceptRanges = upstream.headers?.['accept-ranges'];

      res.setHeader('Content-Type', contentType);
      // Inline by default, but allow forcing download with ?attachment=true
      res.setHeader('Content-Disposition', attachment ? 'attachment' : 'inline');
      res.setHeader('Cache-Control', 'no-store');
      if (acceptRanges) {
        res.setHeader('Accept-Ranges', acceptRanges);
      }
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
        // If upstream served a partial response, mirror it.
        res.status(206);
      }
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      upstream.data.on('error', (err) => {
        logPreview('upstream-stream-error', {
          ...logContext,
          message: err?.message || 'stream error'
        });
        if (!res.headersSent) {
          res.status(502).json({ message: 'Preview stream failed' });
        } else {
          res.end();
        }
      });

      res.on('close', () => {
        logPreview('response-closed', {
          ...logContext,
          elapsedMs: Date.now() - upstreamStarted,
          finished: res.writableEnded
        });
      });

      return upstream.data.pipe(res);
    } catch (error) {
      logPreview('error', {
        itemId: req.params.itemId,
        message: error?.message || 'preview error',
        stack: error?.stack ? undefined : undefined
      });
      next(error);
    }
  }
);

router.get('/assets/download', async (req, res, next) => {
  const startedAt = Date.now();
  const { token } = req.query;
  logAssetDownload('start', { tokenPresent: Boolean(token) });
  try {
    const { asset, payload } = await libraryService.resolveLocalDownloadToken(token);
    const logContext = {
      assetId: payload.assetId,
      itemId: payload.itemId,
      attachment: payload.attachment !== false,
      hasStoragePath: Boolean(asset.storagePath),
      hasBuffer: Boolean(asset.data?.length)
    };
    logAssetDownload('resolved', logContext);
    const fileName = normalizeUtf8FromLatin1(payload.fileName || asset.fileName || 'library-file');
    const disposition = payload.attachment === false ? 'inline' : 'attachment';

    const encodeRFC5987 = (value) =>
      encodeURIComponent(value)
        .replace(/['()]/g, escape)
        .replace(/\*/g, '%2A')
        .replace(/%(7C|60|5E)/g, (match) => match.toLowerCase());

    const safeName = String(fileName)
      .replace(/[\\/]/g, '-')
      .replace(/"/g, '');
    const asciiFallback = safeName.replace(/[^\x20-\x7E]+/g, '_') || 'library-file';

    res.setHeader('Content-Type', asset.contentType || 'application/octet-stream');
    // Use RFC 5987 (filename*) for proper UTF-8 filenames (Arabic, etc.) with an ASCII fallback.
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(safeName)}`
    );

    res.on('close', () => {
      logAssetDownload('response-closed', {
        ...logContext,
        elapsedMs: Date.now() - startedAt,
        finished: res.writableEnded
      });
    });

    if (asset.storagePath) {
      try {
        const stats = await fsPromises.stat(asset.storagePath);
        res.setHeader('Content-Length', stats.size);
        const fileStream = fs.createReadStream(asset.storagePath);
        fileStream.on('error', (err) => {
          logAssetDownload('file-stream-error', {
            ...logContext,
            message: err?.message || 'file stream error'
          });
          if (!res.headersSent) {
            res.status(500).json({ message: 'Stored file stream failed.' });
          } else {
            res.end();
          }
        });
        logAssetDownload('stream-file', logContext);
        return fileStream.pipe(res);
      } catch (fileError) {
        if (!asset.data) {
          logAssetDownload('file-missing-no-buffer', {
            ...logContext,
            message: fileError?.message || 'file missing'
          });
          throw libraryService.httpError(
            500,
            'Stored file is missing. Please re-upload.',
            'ASSET_FILE_MISSING'
          );
        }
        logAssetDownload('file-missing-fallback-buffer', {
          ...logContext,
          message: fileError?.message || 'file missing'
        });
      }
    }

    const payloadBytes = asset.bytes || asset.data?.length || 0;
    res.setHeader('Content-Length', payloadBytes);
    logAssetDownload('send-buffer', { ...logContext, payloadBytes });
    return res.send(asset.data);
  } catch (error) {
    logAssetDownload('error', {
      tokenPresent: Boolean(token),
      message: error?.message || 'asset download error'
    });
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
