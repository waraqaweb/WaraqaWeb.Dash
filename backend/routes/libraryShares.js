const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const {
  authenticateToken,
  optionalAuth,
  requireAdmin
} = require('../middleware/auth');
const libraryShareService = require('../services/libraryShareService');
const { SHARE_PERMISSION_SCOPES, SHARE_PERMISSION_STATUSES } = require('../models/library/libraryConstants');

const router = express.Router();

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

const serializePermission = (permission, { includeAudit = false } = {}) => {
  if (!permission) return null;
  const obj = permission.toObject({ virtuals: true });
  if (!includeAudit) {
    delete obj.auditLog;
  }
  return obj;
};

router.post(
  '/requests',
  optionalAuth,
  body('scopeType').isIn(SHARE_PERMISSION_SCOPES),
  body('targetId').optional().isString(),
  body('includeDescendants').optional().isBoolean(),
  body('email').optional().isEmail(),
  body('fullName').optional().isString().trim().isLength({ min: 2 }),
  validate,
  async (req, res, next) => {
    try {
      const permission = await libraryShareService.submitShareRequest({
        scopeType: req.body.scopeType,
        targetId: req.body.targetId,
        includeDescendants: req.body.includeDescendants,
        reason: req.body.reason,
        requester: req.user,
        fullName: req.body.fullName,
        email: req.body.email
      });
      res.status(201).json({ permission: serializePermission(permission, { includeAudit: req.user?.role === 'admin' }) });
    } catch (error) {
      next(error);
    }
  }
);

const myRequestsHandler = async (req, res, next) => {
  try {
    const permissions = await libraryShareService.listMyRequests({ user: req.user });
    res.json({ permissions: permissions.map((perm) => serializePermission(perm)) });
  } catch (error) {
    next(error);
  }
};

router.get('/mine', authenticateToken, myRequestsHandler);
router.get('/requests/me', authenticateToken, myRequestsHandler);

router.get(
  '/requests',
  authenticateToken,
  requireAdmin,
  query('status').optional().isIn(SHARE_PERMISSION_STATUSES),
  validate,
  async (req, res, next) => {
    try {
      const permissions = await libraryShareService.listRequests({ status: req.query.status });
      res.json({ permissions: permissions.map((perm) => serializePermission(perm, { includeAudit: true })) });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:permissionId/decision',
  authenticateToken,
  requireAdmin,
  param('permissionId').isString(),
  body('status').isIn(SHARE_PERMISSION_STATUSES),
  body('downloadAllowed').optional().isBoolean(),
  body('expiresAt').optional().isISO8601(),
  body('note').optional().isString(),
  validate,
  async (req, res, next) => {
    try {
      const permission = await libraryShareService.decideRequest(req.params.permissionId, {
        status: req.body.status,
        actor: req.user,
        downloadAllowed: req.body.downloadAllowed,
        expiresAt: req.body.expiresAt,
        note: req.body.note
      });
      res.json({ permission: serializePermission(permission, { includeAudit: true }) });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/:permissionId/revoke',
  authenticateToken,
  requireAdmin,
  param('permissionId').isString(),
  validate,
  async (req, res, next) => {
    try {
      const permission = await libraryShareService.revokeShare(req.params.permissionId, req.user);
      res.json({ permission: serializePermission(permission, { includeAudit: true }) });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
