const mongoose = require('mongoose');
require('./LibraryItem');
const { annotationPayloadSchema } = require('./librarySubschemas');
const { ANNOTATION_TOOL_TYPES } = require('./libraryConstants');

const { Schema } = mongoose;

const annotationSnapshotSchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'LibraryItem', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    pageNumber: { type: Number, required: true, min: 1 },
    payload: { type: annotationPayloadSchema, default: () => ({}) },
    activeTool: { type: String, enum: ANNOTATION_TOOL_TYPES, default: 'pen' },
    undoDepth: { type: Number, default: 0 },
    redoDepth: { type: Number, default: 0 },
    checksum: { type: String, trim: true },
    sessionId: { type: String, trim: true },
    isEphemeral: { type: Boolean, default: true },
    expiresAt: { type: Date },
    lastInteractionAt: { type: Date, default: Date.now },
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
);

annotationSnapshotSchema.index({ item: 1, user: 1, pageNumber: 1 }, { unique: true });
annotationSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });

annotationSnapshotSchema.methods.isExpired = function isExpired(now = new Date()) {
  if (!this.expiresAt) return false;
  return this.expiresAt <= now;
};

annotationSnapshotSchema.methods.bumpVersion = function bumpVersion() {
  this.version = (this.version || 0) + 1;
  this.lastInteractionAt = new Date();
  return this.version;
};

module.exports = mongoose.model('LibraryAnnotationSnapshot', annotationSnapshotSchema);
