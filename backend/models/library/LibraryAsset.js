const mongoose = require('mongoose');

const { Schema } = mongoose;

const libraryAssetSchema = new Schema(
  {
    data: { type: Buffer },
    storagePath: { type: String, trim: true },
    contentType: { type: String, trim: true, default: 'application/octet-stream' },
    fileName: { type: String, trim: true, required: true },
    bytes: { type: Number, required: true },
    folder: { type: Schema.Types.ObjectId, ref: 'LibraryFolder' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

module.exports = mongoose.model('LibraryAsset', libraryAssetSchema);
