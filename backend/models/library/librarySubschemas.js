const mongoose = require('mongoose');
const { DEFAULT_STORAGE_PROVIDER } = require('./libraryConstants');

const { Schema } = mongoose;

const previewAssetSchema = new Schema(
  {
    url: { type: String, trim: true },
    publicId: { type: String, trim: true },
    width: Number,
    height: Number,
    dominantColor: { type: String, trim: true },
    blurHash: { type: String, trim: true },
    generatedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const storageLocatorSchema = new Schema(
  {
    provider: { type: String, default: DEFAULT_STORAGE_PROVIDER, trim: true },
    resourceType: { type: String, default: 'auto', trim: true },
    publicId: { type: String, trim: true },
    folderPath: { type: String, trim: true },
    fileName: { type: String, trim: true },
    format: { type: String, trim: true },
    bytes: { type: Number, default: 0 },
    checksum: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    signedUrl: {
      url: { type: String, trim: true },
      expiresAt: { type: Date }
    },
    uploadSessionId: { type: String, trim: true },
    resumableToken: { type: String, trim: true },
    metadata: Schema.Types.Mixed
  },
  { _id: false }
);

const secretAccessEntrySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    email: { type: String, trim: true, lowercase: true },
    fullName: { type: String, trim: true },
    grantedAt: { type: Date, default: Date.now },
    grantedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true }
  },
  { _id: false }
);

const shareAuditEntrySchema = new Schema(
  {
    action: { type: String, trim: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, trim: true },
    at: { type: Date, default: Date.now }
  },
  { _id: true }
);

const pagePreviewSchema = new Schema(
  {
    pageNumber: { type: Number, min: 1 },
    url: { type: String, trim: true },
    width: Number,
    height: Number,
    extractedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const annotationPayloadSchema = new Schema(
  {
    strokes: { type: Schema.Types.Mixed, default: () => ({}) },
    textEntries: { type: Schema.Types.Mixed, default: () => ({}) },
    extras: { type: Schema.Types.Mixed, default: () => ({}) }
  },
  { _id: false }
);

module.exports = {
  previewAssetSchema,
  storageLocatorSchema,
  secretAccessEntrySchema,
  shareAuditEntrySchema,
  pagePreviewSchema,
  annotationPayloadSchema
};
