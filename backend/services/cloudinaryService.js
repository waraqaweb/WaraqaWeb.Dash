const cloudinary = require('cloudinary').v2;
require('dotenv').config();

// Configure Cloudinary from env vars
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const looksLikePlaceholder = (v) => !v || /^(your[-_]|changeme|put-your|<|\s*$)/i.test(v);
const cloudinaryConfigured = !looksLikePlaceholder(process.env.CLOUDINARY_CLOUD_NAME) &&
  !looksLikePlaceholder(process.env.CLOUDINARY_API_KEY) &&
  !looksLikePlaceholder(process.env.CLOUDINARY_API_SECRET);

console.log('Cloudinary config:', {
  cloud_name: cloudinaryConfigured ? 'SET' : 'MISSING/INVALID',
  api_key: cloudinaryConfigured ? 'SET' : 'MISSING/INVALID',
  api_secret: cloudinaryConfigured ? 'SET' : 'MISSING/INVALID'
});

/**
 * Upload an image buffer or base64 string to Cloudinary
 * @param {string|Buffer} file - base64 data URI or file path
 * @param {Object} opts - optional upload options
 */
async function uploadImage(file, opts = {}) {
  if (!cloudinaryConfigured) {
    const err = new Error('Cloudinary credentials are not configured correctly. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
    err.code = 'CLOUDINARY_NOT_CONFIGURED';
    throw err;
  }

  console.log('uploadImage called with opts:', opts);
  try {
    // Upload main image (resized/limited)
    console.log('Uploading main image...');
    const mainRes = await cloudinary.uploader.upload(file, {
      folder: opts.folder || 'waraqa/profile_pictures',
      resource_type: 'image',
      overwrite: true,
      transformation: opts.transformation || [{ width: 1200, height: 1200, crop: 'limit' }],
      quality: opts.quality || 'auto:best'
    });
    console.log('Main image uploaded:', mainRes?.secure_url);

    // Create a small thumbnail transform
    console.log('Uploading thumbnail...');
    const thumbRes = await cloudinary.uploader.upload(file, {
      folder: opts.folder || 'waraqa/profile_pictures',
      resource_type: 'image',
      overwrite: false,
      transformation: [{ width: 200, height: 200, crop: 'thumb', gravity: 'face' }],
      quality: opts.thumbQuality || 'auto:good'
    });
    console.log('Thumbnail uploaded:', thumbRes?.secure_url);

    return { main: mainRes, thumb: thumbRes };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    console.error('Error details:', error.message);
    throw error;
  }
}

async function deleteImage(publicId) {
  if (!publicId) return null;
  // support array or string
  if (Array.isArray(publicId)) {
    const results = [];
    for (const id of publicId) {
      results.push(await cloudinary.uploader.destroy(id, { resource_type: 'image' }));
    }
    return results;
  }
  return cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
}

module.exports = {
  uploadImage,
  deleteImage,
};
