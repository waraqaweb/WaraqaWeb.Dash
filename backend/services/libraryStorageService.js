const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();
const { DEFAULT_STORAGE_PROVIDER } = require('../models/library/libraryConstants');

const DEFAULT_LIBRARY_FOLDER = process.env.CLOUDINARY_LIBRARY_FOLDER || 'waraqa/library';
let isConfigured = false;

function ensureConfigured() {
  if (isConfigured) return;
  const config = cloudinary.config();
  if (!config.cloud_name && process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
  }
  isConfigured = true;
}

function sanitizeSegment(segment) {
  if (!segment) return 'general';
  return segment
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'general';
}

function resolveFolderPath({ subject, level, customPath }) {
  const parts = [DEFAULT_LIBRARY_FOLDER];
  if (customPath) {
    parts.push(customPath.replace(/(^\/|\/$)/g, ''));
  } else {
    parts.push(sanitizeSegment(subject), sanitizeSegment(level));
  }
  return parts.filter(Boolean).join('/');
}

function inferResourceType(mimeType) {
  if (!mimeType) return 'auto';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'video';
  return 'raw';
}

function generatePublicId({ folderPath, fileName }) {
  const safeName = (fileName || 'asset').replace(/[^a-zA-Z0-9-_\.]+/g, '-');
  const suffix = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(6).toString('hex');
  return `${folderPath}/${safeName}-${suffix}`.replace(/\/{2,}/g, '/');
}

function createUploadSignature({ subject, level, fileName, resourceType, customPath }) {
  ensureConfigured();
  const folderPath = resolveFolderPath({ subject, level, customPath });
  const publicId = generatePublicId({ folderPath, fileName });
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = {
    folder: folderPath,
    public_id: publicId,
    timestamp,
    resource_type: resourceType || 'auto'
  };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, cloudinary.config().api_secret);
  return {
    provider: DEFAULT_STORAGE_PROVIDER,
    cloudName: cloudinary.config().cloud_name,
    apiKey: cloudinary.config().api_key,
    timestamp,
    signature,
    folderPath,
    publicId,
    resourceType: paramsToSign.resource_type,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudinary.config().cloud_name}/${paramsToSign.resource_type}/upload`
  };
}

function createResumableUploadParams(options = {}) {
  const signaturePayload = createUploadSignature(options);
  return {
    ...signaturePayload,
    chunkSize: options.chunkSize || 20 * 1024 * 1024,
    resumable: true
  };
}

function mapUploadResultToStorage(uploadResult, overrides = {}) {
  return {
    provider: DEFAULT_STORAGE_PROVIDER,
    resourceType: uploadResult.resource_type,
    publicId: uploadResult.public_id,
    folderPath: uploadResult.folder,
    fileName: uploadResult.original_filename,
    format: uploadResult.format,
    bytes: uploadResult.bytes,
    checksum: uploadResult.signature || uploadResult.etag,
    uploadedAt: new Date(uploadResult.created_at || Date.now()),
    metadata: {
      secureUrl: uploadResult.secure_url,
      pages: uploadResult?.pages,
      width: uploadResult?.width,
      height: uploadResult?.height
    },
    ...overrides
  };
}

function buildSignedDownloadUrl(publicId, { expiresInSeconds = 900, format = 'pdf', attachment = false, resourceType = 'raw' } = {}) {
  ensureConfigured();
  if (!publicId) throw new Error('publicId is required');
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const url = cloudinary.utils.private_download_url(publicId, format, {
    resource_type: resourceType,
    expires_at: expiresAt,
    attachment
  });
  return { url, expiresAt: new Date(expiresAt * 1000) };
}

async function deleteLibraryAsset(publicId, { resourceType = 'raw' } = {}) {
  ensureConfigured();
  if (!publicId) return null;
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

module.exports = {
  resolveFolderPath,
  inferResourceType,
  createUploadSignature,
  createResumableUploadParams,
  mapUploadResultToStorage,
  buildSignedDownloadUrl,
  deleteLibraryAsset
};
