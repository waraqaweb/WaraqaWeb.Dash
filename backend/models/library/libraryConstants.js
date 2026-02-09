const LIBRARY_CONTENT_TYPES = Object.freeze([
  'document',
  'presentation',
  'image',
  'audio',
  'video',
  'interactive',
  'link',
  'archive',
  'other',
  'code',
  'lesson'
]);

const LIBRARY_ITEM_STATUSES = Object.freeze(['draft', 'ready', 'archived']);

const SHARE_PERMISSION_STATUSES = Object.freeze(['pending', 'approved', 'denied', 'revoked', 'expired']);

const SHARE_PERMISSION_SCOPES = Object.freeze(['item', 'folder', 'space']);

const ANNOTATION_TOOL_TYPES = Object.freeze(['pen', 'highlighter', 'text', 'shape', 'eraser']);

const ALLOWED_STORAGE_PROVIDERS = Object.freeze(['cloudinary', 's3', 'local']);

const DEFAULT_STORAGE_PROVIDER = 'cloudinary';

module.exports = {
  LIBRARY_CONTENT_TYPES,
  LIBRARY_ITEM_STATUSES,
  SHARE_PERMISSION_STATUSES,
  SHARE_PERMISSION_SCOPES,
  ANNOTATION_TOOL_TYPES,
  ALLOWED_STORAGE_PROVIDERS,
  DEFAULT_STORAGE_PROVIDER
};
