const mongoose = require('mongoose');
const LibraryFolder = require('../models/library/LibraryFolder');
const LibrarySharePermission = require('../models/library/LibrarySharePermission');

const folderDescendantCache = new Map();

function normalizeId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'string') return value;
  return null;
}

async function fetchFolderAndDescendants(folderId) {
  const cacheKey = normalizeId(folderId);
  if (!cacheKey) return [];
  if (folderDescendantCache.has(cacheKey)) {
    return folderDescendantCache.get(cacheKey);
  }
  const docs = await LibraryFolder.find({
    $or: [
      { _id: folderId },
      { 'ancestors.folder': folderId }
    ]
  }).select('_id');
  const ids = docs.map((doc) => doc._id.toString());
  folderDescendantCache.set(cacheKey, ids);
  setTimeout(() => folderDescendantCache.delete(cacheKey), 5 * 60 * 1000);
  return ids;
}

async function loadActiveSharePermissions({ userId, email, shareToken }) {
  const orClauses = [];
  if (userId) {
    orClauses.push({ grantedToUser: userId });
    orClauses.push({ requester: userId });
  }
  if (email) {
    orClauses.push({ grantedToEmail: email });
    orClauses.push({ 'invitation.email': email });
  }
  if (shareToken) {
    orClauses.push({ token: shareToken });
  }
  if (!orClauses.length) return [];
  const permissions = await LibrarySharePermission.find({
    status: 'approved',
    $or: orClauses
  });
  return permissions.filter((permission) => permission.isActive());
}

async function buildShareContext({ userId, email, shareToken }) {
  const context = {
    spaceAccess: false,
    spaceDownload: false,
    folderIds: new Set(),
    downloadFolderIds: new Set(),
    itemIds: new Set(),
    downloadItemIds: new Set()
  };

  const permissions = await loadActiveSharePermissions({ userId, email, shareToken });
  if (!permissions.length) {
    return context;
  }

  for (const permission of permissions) {
    if (permission.scopeType === 'space') {
      context.spaceAccess = true;
      if (permission.downloadAllowed) {
        context.spaceDownload = true;
      }
      continue;
    }

    if (permission.scopeType === 'folder' && permission.targetFolder) {
      const folderIds = permission.includeDescendants
        ? await fetchFolderAndDescendants(permission.targetFolder)
        : [permission.targetFolder.toString()];

      folderIds.forEach((id) => context.folderIds.add(id));
      if (permission.downloadAllowed) {
        folderIds.forEach((id) => context.downloadFolderIds.add(id));
      }
      continue;
    }

    if (permission.scopeType === 'item' && permission.targetItem) {
      const itemId = permission.targetItem.toString();
      context.itemIds.add(itemId);
      if (permission.downloadAllowed) {
        context.downloadItemIds.add(itemId);
      }
    }
  }

  return context;
}

async function getUserAccessContext({ user, email, shareToken } = {}) {
  const normalizedEmail = (email || user?.email || '').trim().toLowerCase() || null;
  const userId = user?._id ? user._id.toString() : null;
  const share = await buildShareContext({ userId, email: normalizedEmail, shareToken });
  return {
    userId,
    email: normalizedEmail,
    role: user?.role || null,
    isAdmin: user?.role === 'admin',
    share
  };
}

module.exports = {
  getUserAccessContext
};
