const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const { uploadImage } = require('../services/cloudinaryService');

const SUBJECTS_CATALOG_KEY = 'education.subjectsCatalog';

// Multer in-memory storage for uploads
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: Number(process.env.MAX_FILE_SIZE || 5 * 1024 * 1024) } });

// Known defaults for some settings — returned when setting not present in DB
const KNOWN_DEFAULTS = {
  firstClassWindowHours: 24,
  // add other well-known setting defaults here as needed
};

// Public branding info (logo, title, slogan) — accessible without admin auth so UI can show branding
router.get('/branding', async (req, res) => {
  try {
    const keys = ['branding.logo', 'branding.title', 'branding.slogan'];
    const docs = await Setting.find({ key: { $in: keys } });
    const result = {};
    docs.forEach(d => { result[d.key] = d.value; });
    res.json({ success: true, branding: {
      logo: result['branding.logo'] || null,
      title: result['branding.title'] || 'Waraqa',
      slogan: result['branding.slogan'] || ''
    }});
  } catch (err) {
    console.error('Failed to fetch branding', err);
    res.status(500).json({ message: 'Failed to fetch branding' });
  }
});

// Subjects/Courses/Levels catalog (authenticated read)
// Used by class create/edit dropdowns + class report topic dropdowns.
router.get('/subjects-catalog', authenticateToken, async (req, res) => {
  try {
    const s = await Setting.findOne({ key: SUBJECTS_CATALOG_KEY });
    res.json({
      success: true,
      catalog: s?.value || null,
      updatedAt: s?.updatedAt || null,
    });
  } catch (err) {
    console.error('Failed to fetch subjects catalog', err);
    res.status(500).json({ message: 'Failed to fetch subjects catalog' });
  }
});

// Subjects/Courses/Levels catalog (admin write)
router.put('/subjects-catalog', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { value, description } = req.body || {};
    // Keep validation intentionally permissive to allow gradual schema evolution.
    // Frontend normalizes supported shapes.
    const s = await Setting.findOneAndUpdate(
      { key: SUBJECTS_CATALOG_KEY },
      { value: value ?? null, description },
      { upsert: true, new: true }
    );
    res.json({ success: true, catalog: s?.value || null, setting: s });
  } catch (err) {
    console.error('Failed to upsert subjects catalog', err);
    res.status(500).json({ message: 'Failed to save subjects catalog' });
  }
});

// Upload a new branding logo (admin only). Accepts multipart/form-data with field 'file'.
router.post('/branding/logo', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    // Convert buffer to data URI for cloudinary
    const mime = req.file.mimetype || 'image/png';
    const dataUri = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    // If Cloudinary is configured, upload there. Otherwise fallback to storing base64 in DB.
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      try {
        const uploaded = await uploadImage(dataUri, { folder: 'waraqa/branding', transformation: [{ width: 1200, height: 1200, crop: 'limit' }] });
        const url = uploaded?.main?.secure_url || null;
        const publicId = uploaded?.main?.public_id || null;

        if (!url) throw new Error('Cloudinary upload returned no URL');

        const s = await Setting.findOneAndUpdate({ key: 'branding.logo' }, { value: { url, publicId } }, { upsert: true, new: true });
        return res.json({ success: true, setting: s });
      } catch (cloudErr) {
        // Log the Cloudinary error and FALLBACK to storing the base64 data in DB so admins can still upload without blocking the UI.
        console.error('Cloudinary upload failed, falling back to DB storage:', cloudErr && cloudErr.message);

        try {
          const s = await Setting.findOneAndUpdate({ key: 'branding.logo' }, { value: { dataUri, fallback: true } }, { upsert: true, new: true });
          // Include a hint that Cloudinary failed (only include detailed message in development)
          const resp = { success: true, setting: s, fallback: true, note: 'cloudinary_failed' };
          if (process.env.NODE_ENV === 'development') resp.cloudinaryError = cloudErr && cloudErr.message;
          return res.json(resp);
        } catch (dbErr) {
          console.error('Failed to store fallback branding logo in DB after Cloudinary failure:', dbErr);
          return res.status(500).json({ message: 'Failed to upload branding logo', error: dbErr.message || 'db_error' });
        }
      }
    } else {
      // Fallback: store base64 data in DB (not ideal for production, but safe when Cloudinary isn't set)
      const s = await Setting.findOneAndUpdate({ key: 'branding.logo' }, { value: { dataUri, fallback: true } }, { upsert: true, new: true });
      res.json({ success: true, setting: s, fallback: true });
    }
  } catch (err) {
    console.error('Branding upload error', err);
    res.status(500).json({ message: 'Failed to upload branding logo', error: err.message });
  }
});

// Get a setting by key
router.get('/:key', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const s = await Setting.findOne({ key });
    if (!s) {
      // If this is a known setting, return a sensible default instead of 404
      if (Object.prototype.hasOwnProperty.call(KNOWN_DEFAULTS, key)) {
        return res.json({
          success: true,
          setting: {
            key,
            value: KNOWN_DEFAULTS[key],
            description: `Default value for ${key}`
          },
          note: 'default'
        });
      }

      return res.status(404).json({ message: 'Setting not found' });
    }

    res.json({ success: true, setting: s });
  } catch (err) {
    console.error('Get setting error', err);
    res.status(500).json({ message: 'Failed to get setting' });
  }
});

// Upsert a setting
router.put('/:key', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;
    const s = await Setting.findOneAndUpdate({ key }, { value, description }, { upsert: true, new: true });
    res.json({ success: true, setting: s });
  } catch (err) {
    console.error('Upsert setting error', err);
    res.status(500).json({ message: 'Failed to upsert setting' });
  }
});

module.exports = router;

