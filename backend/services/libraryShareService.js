const dayjs = require('dayjs');
const LibrarySharePermission = require('../models/library/LibrarySharePermission');
const LibraryFolder = require('../models/library/LibraryFolder');
const LibraryItem = require('../models/library/LibraryItem');
const { SHARE_PERMISSION_SCOPES, SHARE_PERMISSION_STATUSES } = require('../models/library/libraryConstants');
const notificationService = require('./notificationService');
const { httpError } = require('./libraryService');

function validateScope(scopeType) {
  if (!SHARE_PERMISSION_SCOPES.includes(scopeType)) {
    throw httpError(400, 'Invalid share scope requested', 'INVALID_SCOPE');
  }
}

async function ensureTargetExists(scopeType, targetId) {
  if (scopeType === 'space') return null;
  if (!targetId) {
    throw httpError(400, 'Target is required for this scope', 'TARGET_REQUIRED');
  }
  if (scopeType === 'folder') {
    const folder = await LibraryFolder.findById(targetId);
    if (!folder) throw httpError(404, 'Folder not found', 'FOLDER_NOT_FOUND');
    return folder;
  }
  const item = await LibraryItem.findById(targetId);
  if (!item) throw httpError(404, 'Item not found', 'ITEM_NOT_FOUND');
  return item;
}

function normalizeEmail(email) {
  return email ? email.trim().toLowerCase() : null;
}

function displayNameFromUser(user) {
  if (!user) return null;
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
}

async function submitShareRequest({
  scopeType,
  targetId,
  includeDescendants = false,
  reason,
  requester,
  fullName,
  email
}) {
  validateScope(scopeType);
  const normalizedEmail = normalizeEmail(email || requester?.email);
  if (!normalizedEmail) {
    throw httpError(400, 'Email is required to request access', 'EMAIL_REQUIRED');
  }

  await ensureTargetExists(scopeType, targetId);

  const filter = {
    scopeType,
    status: 'pending',
    grantedToEmail: normalizedEmail
  };

  if (scopeType === 'folder') filter.targetFolder = targetId;
  if (scopeType === 'item') filter.targetItem = targetId;
  if (requester?._id) filter.requester = requester._id;

  const existing = await LibrarySharePermission.findOne(filter);
  if (existing) {
    return existing;
  }

  const permission = new LibrarySharePermission({
    scopeType,
    targetFolder: scopeType === 'folder' ? targetId : undefined,
    targetItem: scopeType === 'item' ? targetId : undefined,
    includeDescendants,
    reason,
    requester: requester?._id,
    grantedToUser: requester?._id,
    grantedToEmail: normalizedEmail,
    grantedToName: fullName || displayNameFromUser(requester),
    status: 'pending',
    invitation: {
      fullName: fullName || displayNameFromUser(requester),
      email: normalizedEmail
    }
  });

  await permission.save();

  await notificationService.notifyRole({
    role: 'admin',
    title: 'Library access request',
    message: `${permission.grantedToName || normalizedEmail} requested ${scopeType} access`,
    type: 'library',
    related: { sharePermission: permission._id }
  });

  return permission;
}

async function listRequests({ status, requesterId }) {
  const filter = {};
  if (status) filter.status = status;
  if (requesterId) {
    filter.$or = [{ requester: requesterId }, { grantedToUser: requesterId }];
  }
  return LibrarySharePermission.find(filter).sort({ createdAt: -1 });
}

async function listMyRequests({ user }) {
  const email = normalizeEmail(user?.email);
  return LibrarySharePermission.find({
    $or: [
      { requester: user?._id },
      { grantedToUser: user?._id },
      { grantedToEmail: email }
    ]
  }).sort({ createdAt: -1 });
}

async function decideRequest(permissionId, {
  status,
  actor,
  downloadAllowed,
  expiresAt,
  note
}) {
  if (!SHARE_PERMISSION_STATUSES.includes(status)) {
    throw httpError(400, 'Invalid status', 'INVALID_STATUS');
  }
  const permission = await LibrarySharePermission.findById(permissionId);
  if (!permission) {
    throw httpError(404, 'Share permission not found', 'PERMISSION_NOT_FOUND');
  }

  permission.applyDecision({
    status,
    actor: actor?._id || actor,
    note,
    downloadAllowed,
    expiresAt: expiresAt ? dayjs(expiresAt).toDate() : permission.expiresAt
  });

  await permission.save();

  if (status === 'approved' && permission.grantedToUser) {
    await notificationService.createNotification({
      userId: permission.grantedToUser,
      title: 'Library access approved',
      message: 'You can now access the requested library resources.',
      type: 'library',
      relatedTo: 'library_share',
      relatedId: permission._id
    });
  }

  if (status === 'denied' && permission.requester) {
    await notificationService.createNotification({
      userId: permission.requester,
      title: 'Library access request denied',
      message: note || 'Your access request was denied by an administrator.',
      type: 'library',
      relatedTo: 'library_share',
      relatedId: permission._id
    });
  }

  return permission;
}

async function revokeShare(permissionId, actor) {
  return decideRequest(permissionId, {
    status: 'revoked',
    actor,
    note: 'Access revoked by administrator'
  });
}

module.exports = {
  submitShareRequest,
  listRequests,
  listMyRequests,
  decideRequest,
  revokeShare
};
