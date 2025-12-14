const mongoose = require('mongoose');

const mediaAssetSchema = new mongoose.Schema(
  {
    originalName: { type: String, trim: true },
    url: { type: String, required: true, trim: true },
    thumbnailUrl: { type: String, trim: true },
    publicId: { type: String, trim: true },
    format: { type: String, trim: true },
    bytes: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    height: { type: Number, min: 0 },
    resourceType: { type: String, trim: true, default: 'image' },
    tags: [{ type: String, trim: true }],
    altText: { type: String, trim: true },
    attribution: { type: String, trim: true },
    usageLocations: [{ type: String, trim: true }],
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

mediaAssetSchema.index({ tags: 1, createdAt: -1 });

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
