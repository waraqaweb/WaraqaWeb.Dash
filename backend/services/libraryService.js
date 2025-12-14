const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs/promises');
const LibraryFolder = require('../models/library/LibraryFolder');
const LibraryItem = require('../models/library/LibraryItem');
const LibraryAsset = require('../models/library/LibraryAsset');
const { getUserAccessContext } = require('./libraryPermissionsService');
const { buildSignedDownloadUrl, deleteLibraryAsset } = require('./libraryStorageService');

const DOWNLOAD_TOKEN_SECRET = process.env.LIBRARY_DOWNLOAD_SECRET || process.env.JWT_SECRET || 'library-download-secret';
const DOWNLOAD_TOKEN_TTL_SECONDS = Number(process.env.LIBRARY_DOWNLOAD_TTL_SECONDS || 600);
const LOCAL_ASSET_ROOT = process.env.LIBRARY_LOCAL_ASSET_DIR || path.join(__dirname, '..', 'tmp', 'library-assets');
const EMBEDDED_ASSET_LIMIT = Number(process.env.LIBRARY_EMBEDDED_ASSET_LIMIT || 8 * 1024 * 1024);

async function ensureLocalAssetRoot() {
  await fs.mkdir(LOCAL_ASSET_ROOT, { recursive: true });
}

function sanitizeFileNameSegment(name = 'asset') {
  return (name || 'asset')
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(-120) || 'asset';
}

async function persistBufferToLocalStore(assetId, buffer, fileName) {
  await ensureLocalAssetRoot();
  const safeName = sanitizeFileNameSegment(fileName);
  const dir = path.join(LOCAL_ASSET_ROOT, assetId.toString().slice(0, 2), assetId.toString());
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, safeName);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

async function removeLocalAssetFile(asset) {
  if (!asset?.storagePath) return;
  try {
    await fs.rm(asset.storagePath, { force: true });
    const parent = path.dirname(asset.storagePath);
    if (parent.startsWith(LOCAL_ASSET_ROOT)) {
      const entries = await fs.readdir(parent);
      if (entries.length === 0) {
        await fs.rmdir(parent).catch(() => {});
      }
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Failed to clean up local asset', error.message || error);
    }
  }
}

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function asId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value === 'object' && value._id) return value._id.toString();
  if (typeof value === 'string') return value;
  return null;
}

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (mongoose.Types.ObjectId.isValid(id)) return new mongoose.Types.ObjectId(id);
  return null;
}

function buildFolderCandidate(access) {
  return {
    userId: access.userId,
    email: access.email,
    bypassSecret: access.isAdmin || access.share.spaceAccess,
    share: {
      spaceAccess: access.share.spaceAccess,
      folderIds: access.share.folderIds
    }
  };
}

function serializeTreeNode(folder) {
  return {
    _id: asId(folder._id),
    displayName: folder.displayName,
    subject: folder.subject,
    level: folder.level,
    tags: folder.tags,
    orderIndex: folder.orderIndex || 0,
    isSecret: folder.isSecret,
    isRoot: folder.isRoot,
    parentFolder: folder.parentFolder ? asId(folder.parentFolder) : null,
    stats: folder.stats || { folders: 0, items: 0, sizeBytes: 0 },
    children: []
  };
}

function canViewItem(item, folder, access) {
  if (!item.effectiveSecret) return true;
  if (access.isAdmin || access.share.spaceAccess) return true;

  const itemId = asId(item._id);
  if (itemId && access.share.itemIds.has(itemId)) {
    return true;
  }

  if (item.isSecret && !item.inheritsSecret) {
    return false;
  }

  if (folder && folder.allowsUser(buildFolderCandidate(access))) {
    return true;
  }

  const folderId = asId(folder?._id) || asId(item.folder);
  if (folderId && access.share.folderIds.has(folderId)) {
    return true;
  }

  return false;
}

function canDownloadItem(item, folder, access) {
  if (!item.allowDownload) return false;
  if (folder && folder.allowDownloads === false) return false;
  if (access.isAdmin) return true;
  if (access.share.spaceDownload) return true;

  const itemId = asId(item._id);
  if (itemId && access.share.downloadItemIds.has(itemId)) {
    return true;
  }

  const folderId = asId(folder?._id) || asId(item.folder);
  if (folderId && access.share.downloadFolderIds.has(folderId)) {
    return true;
  }

  return false;
}

function serializeFolder(folder, { includeSecretMeta = false } = {}) {
  if (!folder) return null;
  const base = {
    id: asId(folder._id),
    displayName: folder.displayName,
    slug: folder.slug,
    description: folder.description,
    subject: folder.subject,
    level: folder.level,
    tags: folder.tags,
    orderIndex: folder.orderIndex,
    previewAsset: folder.previewAsset,
    parentFolder: folder.parentFolder ? asId(folder.parentFolder) : null,
    isSecret: folder.isSecret,
    allowDownloads: folder.allowDownloads,
    stats: folder.stats,
    isRoot: folder.isRoot,
    updatedAt: folder.updatedAt,
    createdAt: folder.createdAt,
    lastActivityAt: folder.lastActivityAt
  };

  if (includeSecretMeta) {
    base.secretAccessList = folder.secretAccessList;
  }

  return base;
}

function serializeItem(item, { includeStorageSecrets = false, folder, permissions } = {}) {
  if (!item) return null;
  const storage = item.storage || {};
  const storagePayload = includeStorageSecrets
    ? storage
    : {
        provider: storage.provider,
        resourceType: storage.resourceType,
        folderPath: storage.folderPath,
        fileName: storage.fileName,
        format: storage.format,
        bytes: storage.bytes,
        metadata: storage.metadata
      };

  return {
    id: asId(item._id),
    folder: asId(item.folder),
    displayName: item.displayName,
    slug: item.slug,
    description: item.description,
    subject: item.subject,
    level: item.level,
    tags: item.tags,
    orderIndex: item.orderIndex,
    previewAsset: item.previewAsset,
    storage: storagePayload,
    contentType: item.contentType,
    mimeType: item.mimeType,
    pageCount: item.pageCount,
    allowDownload: item.allowDownload,
    status: item.status,
    isSecret: item.isSecret,
    inheritsSecret: item.inheritsSecret,
    language: item.language,
    seriesKey: item.seriesKey,
    downloadCount: item.downloadCount,
    lastOpenedAt: item.lastOpenedAt,
    publishedAt: item.publishedAt,
    permissions: permissions || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

async function ensureFolderReadable(folderId, access) {
  const folder = await LibraryFolder.findById(folderId);
  if (!folder) {
    throw httpError(404, 'Folder not found', 'FOLDER_NOT_FOUND');
  }
  if (!folder.allowsUser(buildFolderCandidate(access))) {
    throw httpError(403, 'Folder access denied', 'FOLDER_FORBIDDEN');
  }
  return folder;
}

async function loadItemWithFolder(itemId) {
  const lookupId = toObjectId(itemId);
  if (!lookupId) {
    throw httpError(404, 'Item not found', 'ITEM_NOT_FOUND');
  }

  const item = await LibraryItem.findById(lookupId).populate('folder');
  if (!item) {
    throw httpError(404, 'Item not found', 'ITEM_NOT_FOUND');
  }
  if (!item.folder) {
    throw httpError(404, 'Parent folder missing for item', 'ITEM_FOLDER_MISSING');
  }
  return { item, folder: item.folder };
}

async function getFolderContents({
  user,
  parentId = null,
  includeItems = true,
  page = 1,
  limit = 25,
  search = '',
  shareToken
}) {
  const access = await getUserAccessContext({ user, shareToken });
  const parentFolderId = parentId ? toObjectId(parentId) : null;
  let parentFolderDoc = null;

  if (parentFolderId) {
    parentFolderDoc = await ensureFolderReadable(parentFolderId, access);
  }

  const folderFilter = { parentFolder: parentFolderId };
  if (search) {
    folderFilter.displayName = { $regex: search, $options: 'i' };
  }

  const folderDocs = await LibraryFolder.find(folderFilter).sort({ orderIndex: 1, displayName: 1 });
  const candidate = buildFolderCandidate(access);
  const visibleFolders = folderDocs.filter((folder) => folder.allowsUser(candidate));

  let items = [];
  let pagination = { page, limit, total: 0 };

  if (includeItems && parentFolderId) {
    const itemFilter = { folder: parentFolderId };
    if (search) {
      itemFilter.displayName = { $regex: search, $options: 'i' };
    }

    const totalItems = await LibraryItem.countDocuments(itemFilter);
    const itemDocs = await LibraryItem.find(itemFilter)
      .sort({ orderIndex: 1, displayName: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    items = itemDocs.filter((item) => canViewItem(item, parentFolderDoc, access));
    pagination = { page, limit, total: totalItems, returned: items.length };
  }

  return {
    parent: serializeFolder(parentFolderDoc, { includeSecretMeta: access.isAdmin }),
    breadcrumb: parentFolderDoc ? parentFolderDoc.toBreadcrumb() : [],
    folders: visibleFolders.map((folder) => serializeFolder(folder, { includeSecretMeta: access.isAdmin })),
    items: items.map((item) =>
      serializeItem(item, {
        folder: parentFolderDoc,
        permissions: {
          canDownload: canDownloadItem(item, parentFolderDoc, access)
        }
      })
    ),
    pagination
  };
}

async function getFolderTree({ user, shareToken }) {
  const access = await getUserAccessContext({ user, shareToken });
  const candidate = buildFolderCandidate(access);
  const folders = await LibraryFolder.find({}).sort({ orderIndex: 1, displayName: 1 });
  const visibleMap = new Map();

  folders.forEach((folder) => {
    if (folder.allowsUser(candidate)) {
      visibleMap.set(asId(folder._id), serializeTreeNode(folder));
    }
  });

  const roots = [];
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => {
      if (a.orderIndex !== b.orderIndex) {
        return a.orderIndex - b.orderIndex;
      }
      return (a.displayName || '').localeCompare(b.displayName || '');
    });
    nodes.forEach((node) => {
      if (node.children?.length) {
        sortNodes(node.children);
      }
    });
  };

  visibleMap.forEach((node) => {
    if (node.parentFolder && visibleMap.has(node.parentFolder)) {
      visibleMap.get(node.parentFolder).children.push(node);
    } else {
      roots.push(node);
    }
  });

  sortNodes(roots);
  return roots;
}

async function getFolderBreadcrumb({ folderId, user, shareToken }) {
  const access = await getUserAccessContext({ user, shareToken });
  const folder = await ensureFolderReadable(folderId, access);
  return folder.toBreadcrumb();
}

function sanitizeTags(tags = []) {
  return Array.from(
    new Set(
      tags
        .filter(Boolean)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .slice(0, 20)
    )
  );
}

function sanitizeSearchKeywords(keywords = []) {
  if (!Array.isArray(keywords)) return [];
  return Array.from(
    new Set(
      keywords
        .filter(Boolean)
        .map((keyword) => keyword.toString().trim().toLowerCase())
        .filter((keyword) => keyword.length > 0)
        .slice(0, 30)
    )
  );
}

function sanitizeSecretAccessList(secretAccessList = []) {
  return secretAccessList
    .filter(Boolean)
    .slice(0, 100)
    .map((entry) => ({
      user: entry.user || null,
      email: entry.email ? entry.email.trim().toLowerCase() : undefined,
      fullName: entry.fullName?.trim(),
      notes: entry.notes?.trim(),
      grantedBy: entry.grantedBy || entry.user || null,
      grantedAt: entry.grantedAt || new Date()
    }));
}

function buildAncestors(parentFolder) {
  if (!parentFolder) return [];
  const ancestors = Array.isArray(parentFolder.ancestors) ? [...parentFolder.ancestors] : [];
  ancestors.push({
    folder: parentFolder._id,
    slug: parentFolder.slug,
    displayName: parentFolder.displayName
  });
  return ancestors;
}

async function createFolder({ payload, user }) {
  const parentFolderId = payload.parentFolder ? toObjectId(payload.parentFolder) : null;
  let parentFolder = null;

  if (parentFolderId) {
    parentFolder = await LibraryFolder.findById(parentFolderId);
    if (!parentFolder) {
      throw httpError(404, 'Parent folder not found', 'PARENT_NOT_FOUND');
    }
  }

  const folder = new LibraryFolder({
    displayName: payload.displayName,
    description: payload.description,
    subject: payload.subject,
    level: payload.level,
    tags: sanitizeTags(payload.tags),
    orderIndex: payload.orderIndex || 0,
    previewAsset: payload.previewAsset,
    parentFolder: parentFolder ? parentFolder._id : null,
    ancestors: buildAncestors(parentFolder),
    isRoot: !parentFolder,
    isSecret: payload.isSecret || false,
    allowDownloads: payload.allowDownloads !== undefined ? payload.allowDownloads : true,
    secretAccessList: sanitizeSecretAccessList(payload.secretAccessList),
    createdBy: user?._id,
    updatedBy: user?._id
  });

  await folder.save();

  if (parentFolder) {
    await LibraryFolder.findByIdAndUpdate(parentFolder._id, {
      $inc: { 'stats.folders': 1 },
      lastActivityAt: new Date(),
      updatedBy: user?._id
    });
  }

  return serializeFolder(folder, { includeSecretMeta: true });
}

function guardFolderMove(folder, newParent) {
  if (!newParent || !folder) return;
  if (folder._id.equals(newParent._id)) {
    throw httpError(400, 'Folder cannot be its own parent', 'INVALID_PARENT');
  }
  const isAncestor = newParent.ancestors?.some((ancestor) => ancestor.folder?.equals(folder._id));
  if (isAncestor) {
    throw httpError(400, 'Cannot move folder inside its descendant', 'INVALID_PARENT');
  }
}

async function updateFolder({ folderId, payload, user }) {
  const folder = await LibraryFolder.findById(folderId);
  if (!folder) {
    throw httpError(404, 'Folder not found', 'FOLDER_NOT_FOUND');
  }

  let parentFolder = null;
  if (payload.parentFolder !== undefined) {
    const parentId = payload.parentFolder ? toObjectId(payload.parentFolder) : null;
    if (parentId) {
      parentFolder = await LibraryFolder.findById(parentId);
      if (!parentFolder) {
        throw httpError(404, 'New parent folder not found', 'PARENT_NOT_FOUND');
      }
      guardFolderMove(folder, parentFolder);
      folder.parentFolder = parentFolder._id;
      folder.ancestors = buildAncestors(parentFolder);
      folder.isRoot = false;
    } else {
      folder.parentFolder = null;
      folder.ancestors = [];
      folder.isRoot = true;
    }
  }

  if (payload.displayName !== undefined) folder.displayName = payload.displayName;
  if (payload.description !== undefined) folder.description = payload.description;
  if (payload.subject !== undefined) folder.subject = payload.subject;
  if (payload.level !== undefined) folder.level = payload.level;
  if (payload.tags !== undefined) folder.tags = sanitizeTags(payload.tags);
  if (payload.orderIndex !== undefined) folder.orderIndex = payload.orderIndex;
  if (payload.previewAsset !== undefined) folder.previewAsset = payload.previewAsset;
  if (payload.isSecret !== undefined) folder.isSecret = payload.isSecret;
  if (payload.allowDownloads !== undefined) folder.allowDownloads = payload.allowDownloads;
  if (Array.isArray(payload.secretAccessList)) {
    folder.secretAccessList = sanitizeSecretAccessList(payload.secretAccessList);
  }

  folder.updatedBy = user?._id;
  folder.lastActivityAt = new Date();

  await folder.save();
  return serializeFolder(folder, { includeSecretMeta: true });
}

async function deleteFolder({ folderId }) {
  const folder = await LibraryFolder.findById(folderId);
  if (!folder) {
    throw httpError(404, 'Folder not found', 'FOLDER_NOT_FOUND');
  }
  const childFolders = await LibraryFolder.countDocuments({ parentFolder: folder._id });
  if (childFolders > 0) {
    throw httpError(400, 'Folder has subfolders', 'FOLDER_NOT_EMPTY');
  }
  const items = await LibraryItem.countDocuments({ folder: folder._id });
  if (items > 0) {
    throw httpError(400, 'Folder has items', 'FOLDER_NOT_EMPTY');
  }
  await folder.deleteOne();
}

async function createItem({ payload, user }) {
  const folderId = toObjectId(payload.folder);
  if (!folderId) {
    throw httpError(400, 'Folder is required', 'FOLDER_REQUIRED');
  }
  const folder = await LibraryFolder.findById(folderId);
  if (!folder) {
    throw httpError(404, 'Folder not found', 'FOLDER_NOT_FOUND');
  }
  if (!payload.storage || !payload.storage.publicId) {
    throw httpError(400, 'Storage details are required', 'STORAGE_REQUIRED');
  }

  const item = new LibraryItem({
    folder: folder._id,
    displayName: payload.displayName,
    description: payload.description,
    subject: payload.subject,
    level: payload.level,
    tags: sanitizeTags(payload.tags),
    orderIndex: payload.orderIndex || 0,
    previewAsset: payload.previewAsset,
    storage: payload.storage,
    contentType: payload.contentType,
    mimeType: payload.mimeType,
    pageCount: payload.pageCount,
    allowDownload: payload.allowDownload !== undefined ? payload.allowDownload : true,
    status: payload.status || 'ready',
    isSecret: payload.isSecret || false,
    inheritsSecret: payload.inheritsSecret !== undefined ? payload.inheritsSecret : true,
    searchKeywords: sanitizeSearchKeywords(payload.searchKeywords),
    language: payload.language,
    seriesKey: payload.seriesKey,
    createdBy: user?._id,
    updatedBy: user?._id,
    metadata: payload.metadata
  });

  await item.save();

  await LibraryFolder.findByIdAndUpdate(folder._id, {
    $inc: { 'stats.items': 1, 'stats.sizeBytes': payload.storage.bytes || 0 },
    lastActivityAt: new Date(),
    updatedBy: user?._id
  });

  return serializeItem(item, { includeStorageSecrets: true, folder });
}

async function updateItem({ itemId, payload, user }) {
  const { item, folder } = await loadItemWithFolder(itemId);

  if (payload.displayName !== undefined) item.displayName = payload.displayName;
  if (payload.description !== undefined) item.description = payload.description;
  if (payload.subject !== undefined) item.subject = payload.subject;
  if (payload.level !== undefined) item.level = payload.level;
  if (payload.tags !== undefined) item.tags = sanitizeTags(payload.tags);
  if (payload.orderIndex !== undefined) item.orderIndex = payload.orderIndex;
  if (payload.previewAsset !== undefined) item.previewAsset = payload.previewAsset;
  if (payload.storage !== undefined) item.storage = payload.storage;
  if (payload.contentType !== undefined) item.contentType = payload.contentType;
  if (payload.mimeType !== undefined) item.mimeType = payload.mimeType;
  if (payload.pageCount !== undefined) item.pageCount = payload.pageCount;
  if (payload.allowDownload !== undefined) item.allowDownload = payload.allowDownload;
  if (payload.status !== undefined) item.status = payload.status;
  if (payload.isSecret !== undefined) item.isSecret = payload.isSecret;
  if (payload.inheritsSecret !== undefined) item.inheritsSecret = payload.inheritsSecret;
  if (payload.language !== undefined) item.language = payload.language;
  if (payload.seriesKey !== undefined) item.seriesKey = payload.seriesKey;
  if (payload.metadata !== undefined) item.metadata = payload.metadata;
  if (payload.searchKeywords !== undefined) item.searchKeywords = sanitizeSearchKeywords(payload.searchKeywords);

  item.updatedBy = user?._id;
  await item.save();

  return serializeItem(item, { includeStorageSecrets: true, folder });
}

async function deleteItem({ itemId }) {
  const { item, folder } = await loadItemWithFolder(itemId);
  const storageProvider = item.storage?.provider || 'cloudinary';
  const publicId = item.storage?.publicId;
  const resourceType = item.storage?.resourceType;

  await item.deleteOne();

  await LibraryFolder.findByIdAndUpdate(folder._id, {
    $inc: { 'stats.items': -1, 'stats.sizeBytes': -(item.storage?.bytes || 0) },
    lastActivityAt: new Date()
  });

  if (storageProvider === 'local') {
    const assetId = item.storage?.metadata?.assetId || publicId;
    if (assetId) {
      const asset = await LibraryAsset.findById(assetId);
      if (asset) {
        await removeLocalAssetFile(asset);
        await asset.deleteOne();
      }
    }
  } else if (publicId) {
    await deleteLibraryAsset(publicId, { resourceType: resourceType || 'raw' });
  }
}

async function uploadLibraryAsset({ buffer, fileName, mimeType, folderId, user }) {
  if (!buffer) {
    throw httpError(400, 'File upload payload missing', 'FILE_REQUIRED');
  }

  const resolvedFolderId = toObjectId(folderId);
  if (!resolvedFolderId) {
    throw httpError(400, 'Destination folder is required', 'FOLDER_REQUIRED');
  }

  const folder = await LibraryFolder.findById(resolvedFolderId);
  if (!folder) {
    throw httpError(404, 'Folder not found', 'FOLDER_NOT_FOUND');
  }

  const normalizedName = fileName || 'library-file';
  const assetId = new mongoose.Types.ObjectId();
  const storagePath = await persistBufferToLocalStore(assetId, buffer, normalizedName);
  const shouldEmbed = buffer.length <= EMBEDDED_ASSET_LIMIT;

  const assetPayload = {
    _id: assetId,
    storagePath,
    contentType: mimeType || 'application/octet-stream',
    fileName: normalizedName,
    bytes: buffer.length,
    folder: folder._id,
    createdBy: user?._id,
    metadata: {
      storage: 'local',
      assetId: assetId.toString(),
      mimeType: mimeType || 'application/octet-stream',
      embedded: shouldEmbed
    }
  };

  if (shouldEmbed) {
    assetPayload.data = buffer;
  }

  await LibraryAsset.create(assetPayload);

  const storage = {
    provider: 'local',
    resourceType: 'raw',
    publicId: assetId.toString(),
    folderPath: folder._id.toString(),
    fileName: normalizedName,
    format: (normalizedName.split('.').pop() || 'bin').toLowerCase(),
    bytes: buffer.length,
    metadata: {
      assetId: assetId.toString(),
      mimeType: mimeType || 'application/octet-stream',
      storage: 'local'
    }
  };

  return {
    storage,
    pageCount: null,
    bytes: buffer.length,
    fileName: normalizedName
  };
}

async function getItem({ itemId, user, shareToken }) {
  const access = await getUserAccessContext({ user, shareToken });
  const { item, folder } = await loadItemWithFolder(itemId);

  if (!canViewItem(item, folder, access)) {
    throw httpError(403, 'Item access denied', 'ITEM_FORBIDDEN');
  }

  return {
    item: serializeItem(item, {
      includeStorageSecrets: access.isAdmin,
      folder,
      permissions: {
        canDownload: canDownloadItem(item, folder, access)
      }
    }),
    folder: serializeFolder(folder, { includeSecretMeta: access.isAdmin })
  };
}

async function getItemPages({ itemId, user, shareToken, page = 1, limit = 10 }) {
  const access = await getUserAccessContext({ user, shareToken });
  const { item, folder } = await loadItemWithFolder(itemId);

  if (!canViewItem(item, folder, access)) {
    throw httpError(403, 'Item access denied', 'ITEM_FORBIDDEN');
  }

  const previews = Array.isArray(item.pagePreviews) ? item.pagePreviews : [];
  const start = Math.max((page - 1) * limit, 0);
  const slice = previews.slice(start, start + limit);

  await LibraryItem.findByIdAndUpdate(item._id, {
    lastOpenedAt: new Date()
  });

  return {
    item: serializeItem(item, {
      folder,
      permissions: {
        canDownload: canDownloadItem(item, folder, access)
      }
    }),
    pages: slice,
    page,
    limit,
    total: previews.length
  };
}

async function getDownloadUrl({ itemId, user, shareToken, attachment = true, format, baseUrl }) {
  const access = await getUserAccessContext({ user, shareToken });
  const { item, folder } = await loadItemWithFolder(itemId);

  if (!canViewItem(item, folder, access)) {
    throw httpError(403, 'Item access denied', 'ITEM_FORBIDDEN');
  }

  const canDownload = canDownloadItem(item, folder, access);
  const inlinePreview = attachment === false;

  if (!canDownload && !inlinePreview) {
    throw httpError(403, 'Download not permitted', 'DOWNLOAD_FORBIDDEN');
  }

  const storage = item.storage || {};
  const provider = storage.provider || 'cloudinary';

  let downloadPayload;

  if (provider === 'local') {
    if (!baseUrl) {
      throw httpError(500, 'Download base URL missing', 'DOWNLOAD_BASE_URL');
    }
    const assetId = storage.metadata?.assetId || storage.publicId;
    if (!assetId) {
      throw httpError(404, 'Stored asset missing', 'ASSET_NOT_FOUND');
    }
    const token = jwt.sign(
      {
        assetId,
        itemId: item._id.toString(),
        attachment: Boolean(attachment),
        fileName: storage.fileName || `${item.slug || 'library-file'}.${storage.format || 'bin'}`
      },
      DOWNLOAD_TOKEN_SECRET,
      { expiresIn: DOWNLOAD_TOKEN_TTL_SECONDS }
    );

    downloadPayload = {
      url: `${baseUrl}/api/library/assets/download?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + DOWNLOAD_TOKEN_TTL_SECONDS * 1000),
      fileName: storage.fileName
    };
  } else {
    const publicId = storage.publicId;
    if (!publicId) {
      throw httpError(400, 'Item has no stored asset', 'MISSING_ASSET');
    }
    const signed = buildSignedDownloadUrl(publicId, {
      resourceType: storage.resourceType || 'raw',
      format: format || storage.format || 'pdf',
      attachment
    });
    downloadPayload = {
      url: signed.url,
      expiresAt: signed.expiresAt,
      fileName: storage.fileName
    };
  }

  const updateOps = {
    $set: { lastOpenedAt: new Date() }
  };
  if (attachment !== false) {
    updateOps.$inc = { downloadCount: 1 };
  }
  await LibraryItem.findByIdAndUpdate(item._id, updateOps);

  return {
    ...downloadPayload,
    item: serializeItem(item, {
      folder,
      permissions: { canDownload }
    })
  };
}

async function searchItems({ user, shareToken, query = '', limit = 24 }) {
  const trimmedQuery = (query || '').trim();
  if (!trimmedQuery) {
    return { items: [], total: 0, query: '' };
  }

  const access = await getUserAccessContext({ user, shareToken });
  const regex = new RegExp(trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const filter = {
    $or: [
      { displayName: regex },
      { description: regex },
      { subject: regex },
      { level: regex },
      { tags: regex }
    ]
  };

  const docs = await LibraryItem.find(filter)
    .sort({ updatedAt: -1 })
    .limit(Math.min(limit, 50))
    .populate('folder');

  const results = docs
    .filter((doc) => canViewItem(doc, doc.folder, access))
    .map((doc) =>
      serializeItem(doc, {
        folder: doc.folder,
        permissions: {
          canDownload: canDownloadItem(doc, doc.folder, access)
        }
      })
    );

  return {
    query: trimmedQuery,
    total: results.length,
    items: results
  };
}

async function resolveLocalDownloadToken(token) {
  if (!token) {
    throw httpError(400, 'Download token is required', 'DOWNLOAD_TOKEN_REQUIRED');
  }
  let payload;
  try {
    payload = jwt.verify(token, DOWNLOAD_TOKEN_SECRET);
  } catch (error) {
    throw httpError(401, 'Download token invalid or expired', 'DOWNLOAD_TOKEN_INVALID');
  }

  const asset = await LibraryAsset.findById(payload.assetId);
  if (!asset) {
    throw httpError(404, 'Asset not found', 'ASSET_NOT_FOUND');
  }

  return { asset, payload };
}

module.exports = {
  getFolderContents,
  getFolderBreadcrumb,
  getFolderTree,
  createFolder,
  updateFolder,
  deleteFolder,
  createItem,
  updateItem,
  deleteItem,
  uploadLibraryAsset,
  getItem,
  getItemPages,
  getDownloadUrl,
  searchItems,
  resolveLocalDownloadToken,
  httpError
};
