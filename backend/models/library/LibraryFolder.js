const mongoose = require('mongoose');
const { previewAssetSchema, secretAccessEntrySchema } = require('./librarySubschemas');
const { slugify } = require('../../utils/slug');

const { Schema } = mongoose;

const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_TAG_LENGTH = 60;

const ancestorSchema = new Schema(
  {
    folder: { type: Schema.Types.ObjectId, ref: 'LibraryFolder' },
    slug: { type: String, trim: true },
    displayName: { type: String, trim: true }
  },
  { _id: false }
);

const folderSchema = new Schema(
  {
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_NAME_LENGTH
    },
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: MAX_NAME_LENGTH + 50
    },
    description: {
      type: String,
      trim: true,
      maxlength: MAX_DESCRIPTION_LENGTH
    },
    subject: { type: String, trim: true, maxlength: 120 },
    level: { type: String, trim: true, maxlength: 120 },
    tags: {
      type: [{ type: String, trim: true, maxlength: MAX_TAG_LENGTH }],
      default: []
    },
    orderIndex: { type: Number, default: 0 },
    previewAsset: { type: previewAssetSchema, default: undefined },
    parentFolder: { type: Schema.Types.ObjectId, ref: 'LibraryFolder', default: null, index: true },
    ancestors: { type: [ancestorSchema], default: [] },
    isRoot: { type: Boolean, default: false },
    isSecret: { type: Boolean, default: false },
    secretAccessList: { type: [secretAccessEntrySchema], default: [] },
    stats: {
      folders: { type: Number, default: 0 },
      items: { type: Number, default: 0 },
      sizeBytes: { type: Number, default: 0 }
    },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    allowDownloads: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastActivityAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

folderSchema.index({ parentFolder: 1, slug: 1 }, { unique: true, sparse: true, name: 'library_folder_parent_slug' });
folderSchema.index({ parentFolder: 1, orderIndex: 1 });
folderSchema.index({ subject: 1, level: 1 });
folderSchema.index({ isSecret: 1 });
folderSchema.index(
  { displayName: 'text', description: 'text', subject: 'text', level: 'text', 'tags': 'text' },
  { name: 'library_folder_search' }
);

function normalizeSlug(base, fallbackPrefix = 'folder') {
  if (!base) return slugify(null, { fallbackPrefix });
  return slugify(base, { fallbackPrefix });
}

folderSchema.pre('validate', function folderPreValidate(next) {
  if (!this.slug && this.displayName) {
    this.slug = normalizeSlug(this.displayName, 'folder');
  }
  if (this.slug) {
    this.slug = normalizeSlug(this.slug, 'folder');
  }
  if (this.isRoot) {
    this.parentFolder = null;
    this.ancestors = [];
  }
  if (!Array.isArray(this.tags)) {
    this.tags = [];
  }
  next();
});

folderSchema.methods.userHasSecretAccess = function userHasSecretAccess(candidate = {}) {
  if (!this.isSecret) return true;
  if (!Array.isArray(this.secretAccessList)) return false;
  const { userId = null, email = null } = candidate;
  if (this.secretAccessList.some((entry) => entry?.user && entry.user.toString() === String(userId || ''))) {
    return true;
  }
  if (email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    return this.secretAccessList.some((entry) => entry?.email && entry.email === normalizedEmail);
  }
  return false;
};

folderSchema.methods.allowsUser = function allowsUser(candidate = {}) {
  if (!this.isSecret) return true;
  if (candidate?.bypassSecret === true) return true;

  const shareContext = candidate?.share || {};
  if (shareContext.spaceAccess) return true;

  const folderIdStr = this._id?.toString();
  const allowedFolders = shareContext.folderIds
    ? Array.from(shareContext.folderIds).map((id) => id.toString())
    : [];

  if (folderIdStr && allowedFolders.includes(folderIdStr)) {
    return true;
  }

  if (Array.isArray(this.ancestors) && allowedFolders.length) {
    const ancestorHasShare = this.ancestors.some((ancestor) => {
      const ancestorId = ancestor?.folder?.toString();
      return ancestorId && allowedFolders.includes(ancestorId);
    });
    if (ancestorHasShare) return true;
  }

  return this.userHasSecretAccess(candidate);
};

folderSchema.methods.toBreadcrumb = function toBreadcrumb() {
  const breadcrumb = Array.isArray(this.ancestors) ? [...this.ancestors] : [];
  breadcrumb.push({ folder: this._id, slug: this.slug, displayName: this.displayName });
  return breadcrumb;
};

module.exports = mongoose.model('LibraryFolder', folderSchema);
