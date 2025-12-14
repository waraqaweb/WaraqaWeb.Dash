const mongoose = require('mongoose');
require('./LibraryFolder');
const {
  previewAssetSchema,
  storageLocatorSchema,
  pagePreviewSchema
} = require('./librarySubschemas');
const {
  LIBRARY_CONTENT_TYPES,
  LIBRARY_ITEM_STATUSES
} = require('./libraryConstants');
const { slugify } = require('../../utils/slug');

const { Schema } = mongoose;

const MAX_TITLE_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_TAG_LENGTH = 60;

const itemSchema = new Schema(
  {
    folder: { type: Schema.Types.ObjectId, ref: 'LibraryFolder', required: true, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: MAX_TITLE_LENGTH },
    slug: { type: String, trim: true, lowercase: true },
    description: { type: String, trim: true, maxlength: MAX_DESCRIPTION_LENGTH },
    subject: { type: String, trim: true, maxlength: 120 },
    level: { type: String, trim: true, maxlength: 120 },
    tags: { type: [{ type: String, trim: true, maxlength: MAX_TAG_LENGTH }], default: [] },
    orderIndex: { type: Number, default: 0 },
    previewAsset: { type: previewAssetSchema, default: undefined },
    storage: { type: storageLocatorSchema, required: true },
    contentType: { type: String, enum: LIBRARY_CONTENT_TYPES, default: 'document' },
    mimeType: { type: String, trim: true },
    pageCount: { type: Number, default: 0 },
    pagePreviews: { type: [pagePreviewSchema], default: [] },
    allowDownload: { type: Boolean, default: true },
    status: { type: String, enum: LIBRARY_ITEM_STATUSES, default: 'ready' },
    isSecret: { type: Boolean, default: false },
    inheritsSecret: { type: Boolean, default: true },
    searchKeywords: { type: [{ type: String, trim: true }], default: [] },
    annotationsVersion: { type: Number, default: 0 },
    curriculum: { type: String, trim: true },
    language: { type: String, trim: true, default: 'en' },
    seriesKey: { type: String, trim: true },
    externalLink: { type: String, trim: true },
    downloadCount: { type: Number, default: 0 },
    lastOpenedAt: { type: Date },
    publishedAt: { type: Date },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

itemSchema.index({ folder: 1, slug: 1 }, { unique: true, sparse: true, name: 'library_item_folder_slug' });
itemSchema.index({ subject: 1, level: 1 });
itemSchema.index({ contentType: 1, status: 1 });
itemSchema.index({ isSecret: 1, inheritsSecret: 1 });
itemSchema.index(
  { displayName: 'text', description: 'text', subject: 'text', level: 'text', tags: 'text', searchKeywords: 'text' },
  { name: 'library_item_search' }
);

function normalizeSlug(base) {
  return slugify(base, { fallbackPrefix: 'item' });
}

itemSchema.pre('validate', function itemPreValidate(next) {
  if (!this.slug && this.displayName) {
    this.slug = normalizeSlug(this.displayName);
  }
  if (this.slug) {
    this.slug = normalizeSlug(this.slug);
  }
  if (!Array.isArray(this.tags)) {
    this.tags = [];
  }
  if (!Array.isArray(this.searchKeywords)) {
    this.searchKeywords = [];
  }
  if (!Array.isArray(this.pagePreviews)) {
    this.pagePreviews = [];
  }
  next();
});

itemSchema.virtual('effectiveSecret').get(function effectiveSecretGetter() {
  return Boolean(this.isSecret || this.inheritsSecret);
});

itemSchema.methods.isDownloadAllowed = function isDownloadAllowed(options = {}) {
  if (!this.allowDownload) return false;
  if (options?.forceDownload === true) return true;
  if (options?.hasExplicitPermission === true) return true;
  return true;
};

itemSchema.methods.bumpAnnotationsVersion = function bumpAnnotationsVersion() {
  this.annotationsVersion = (this.annotationsVersion || 0) + 1;
  return this.annotationsVersion;
};

module.exports = mongoose.model('LibraryItem', itemSchema);
