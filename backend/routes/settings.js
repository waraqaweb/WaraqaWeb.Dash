const express = require('express');
const router = express.Router();
const Setting = require('../models/Setting');
const User = require('../models/User');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const { uploadImage } = require('../services/cloudinaryService');
const dstService = require('../services/dstService');

const SUBJECTS_CATALOG_KEY = 'education.subjectsCatalog';

// Multer in-memory storage for uploads
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: Number(process.env.MAX_FILE_SIZE || 5 * 1024 * 1024) } });

// Known defaults for some settings — returned when setting not present in DB
const KNOWN_DEFAULTS = {
  firstClassWindowHours: 24,
  unreportedClassCleanupDays: 30,
  teacher_report_window_hours: 72,
  admin_extension_hours: 24,
  whiteboardScreenshotRetentionDays: 90,
  requestsVisibility: 'all_users',
  meetingFollowupPrompts: {
    enabled: true,
    guardian: {
      enabled: true,
      cadenceDays: 30,
      lookbackDays: 30,
      triggerAt: null,
    },
    teacher: {
      enabled: true,
      cadenceDays: 30,
      lookbackDays: 30,
      triggerAt: null,
    },
  },
  hijriOffsetDays: { default: 0, byRegion: {} },
  dashboardDecoration: {
    enabled: true,
    offsetX: 0,
    offsetY: 0,
    items: {
      crescents: { count: 2, scale: 1 },
      stars: { count: 4, scale: 1 },
      dots: { count: 6, scale: 1 },
      lanterns: { count: 3, scale: 0.8 },
    },
  },
  homepageAnnouncement: {
    message: '',
    fontSize: 'text-sm',
    fontWeight: 'font-medium',
    italic: false,
    align: 'left',
    tone: 'default',
    backgroundColor: 'card',
    borderColor: 'default',
  },
  timezoneDstOverrides: [],
  // add other well-known setting defaults here as needed
};

const REQUESTS_VISIBILITY_KEY = 'requestsVisibility';
const REQUESTS_VISIBILITY_ALLOWED = ['admin_only', 'admin_teacher', 'all_users'];
const normalizeRequestsVisibility = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return REQUESTS_VISIBILITY_ALLOWED.includes(normalized) ? normalized : 'all_users';
};

const HIJRI_OFFSET_KEY = 'hijriOffsetDays';
const normalizeHijriOffsetValue = (value) => {
  const base = value && typeof value === 'object' ? value : {};
  const defaultOffset = Number(base.default ?? base.defaultOffset ?? 0);
  const byRegionRaw = base.byRegion && typeof base.byRegion === 'object' ? base.byRegion : {};
  const byRegion = {};
  Object.keys(byRegionRaw).forEach((key) => {
    const cleaned = String(key || '').trim().toUpperCase();
    if (!cleaned) return;
    const offset = Number(byRegionRaw[key]);
    if (Number.isFinite(offset)) {
      byRegion[cleaned] = offset;
    }
  });

  return {
    default: Number.isFinite(defaultOffset) ? defaultOffset : 0,
    byRegion,
  };
};

const DASHBOARD_DECORATION_KEY = 'dashboardDecoration';
const MEETING_FOLLOWUP_PROMPTS_KEY = 'meetingFollowupPrompts';
const HOMEPAGE_ANNOUNCEMENT_KEY = 'homepageAnnouncement';
const WHATSAPP_AUDIENCE_ALLOWED = new Set([
  'active_guardians',
  'inactive_guardians',
  'all_guardians',
  'active_teachers',
  'inactive_teachers',
  'guardians_timezone',
  'guardians_country',
]);

const timezoneCountryAliasMap = {
  cairo: 'Egypt',
  alexandria: 'Egypt',
  riyadh: 'Saudi Arabia',
  jeddah: 'Saudi Arabia',
  mecca: 'Saudi Arabia',
  makkah: 'Saudi Arabia',
  dammam: 'Saudi Arabia',
  dubai: 'United Arab Emirates',
  abu_dhabi: 'United Arab Emirates',
  sharjah: 'United Arab Emirates',
  doha: 'Qatar',
  kuwait: 'Kuwait',
  bahrain: 'Bahrain',
  muscat: 'Oman',
  amman: 'Jordan',
  beirut: 'Lebanon',
  damascus: 'Syria',
  baghdad: 'Iraq',
  jerusalem: 'Palestine',
  gaza: 'Palestine',
  istanbul: 'Turkey',
  london: 'United Kingdom',
  paris: 'France',
  berlin: 'Germany',
  rome: 'Italy',
  madrid: 'Spain',
  lisbon: 'Portugal',
  dublin: 'Ireland',
  new_york: 'United States',
  chicago: 'United States',
  denver: 'United States',
  los_angeles: 'United States',
  toronto: 'Canada',
  vancouver: 'Canada',
  sydney: 'Australia',
  melbourne: 'Australia',
  auckland: 'New Zealand',
  karachi: 'Pakistan',
  lahore: 'Pakistan',
  islamabad: 'Pakistan',
  delhi: 'India',
  kolkata: 'India',
  mumbai: 'India',
  dhaka: 'Bangladesh',
  jakarta: 'Indonesia',
  kuala_lumpur: 'Malaysia',
  singapore: 'Singapore',
};

const normalizeWhatsappPhone = (value) => String(value || '').replace(/\D+/g, '');

const deriveCountryFromTimezone = (timezone) => {
  const tz = String(timezone || '').trim();
  if (!tz || !tz.includes('/')) return '';
  const cityPart = tz.split('/').slice(1).join('/').toLowerCase();
  const candidateKey = cityPart.replace(/\s+/g, '_');
  if (timezoneCountryAliasMap[candidateKey]) return timezoneCountryAliasMap[candidateKey];

  const simple = candidateKey.split('/').pop();
  if (timezoneCountryAliasMap[simple]) return timezoneCountryAliasMap[simple];

  const fallback = simple.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return fallback || '';
};

const resolveAudienceFilter = ({ audience, timezone, country }) => {
  const normalizedAudience = WHATSAPP_AUDIENCE_ALLOWED.has(audience) ? audience : 'active_guardians';

  if (normalizedAudience === 'active_guardians') {
    return { role: 'guardian', isActive: true };
  }
  if (normalizedAudience === 'inactive_guardians') {
    return { role: 'guardian', isActive: false };
  }
  if (normalizedAudience === 'all_guardians') {
    return { role: 'guardian' };
  }
  if (normalizedAudience === 'active_teachers') {
    return { role: 'teacher', isActive: true };
  }
  if (normalizedAudience === 'inactive_teachers') {
    return { role: 'teacher', isActive: false };
  }
  if (normalizedAudience === 'guardians_timezone') {
    const tz = String(timezone || '').trim();
    return tz ? { role: 'guardian', timezone: tz } : { role: 'guardian' };
  }
  if (normalizedAudience === 'guardians_country') {
    const c = String(country || '').trim();
    return { role: 'guardian', _derivedCountry: c };
  }
  return { role: 'guardian', isActive: true };
};
const normalizeHomepageAnnouncement = (value) => {
  const base = value && typeof value === 'object' ? value : {};
  const allowedFontSizes = new Set(['text-sm', 'text-base', 'text-lg']);
  const allowedFontWeights = new Set(['font-normal', 'font-medium', 'font-semibold']);
  const allowedAlign = new Set(['left', 'center', 'right']);
  const allowedTone = new Set(['default', 'primary', 'muted']);
  const allowedBackgroundColors = new Set(['card', 'muted', 'primary', 'success', 'warning', 'info']);
  const allowedBorderColors = new Set(['default', 'primary', 'success', 'warning', 'info', 'muted']);
  const defaults = KNOWN_DEFAULTS.homepageAnnouncement;

  return {
    message: String(base.message || '').trim(),
    fontSize: allowedFontSizes.has(base.fontSize) ? base.fontSize : defaults.fontSize,
    fontWeight: allowedFontWeights.has(base.fontWeight) ? base.fontWeight : defaults.fontWeight,
    italic: typeof base.italic === 'boolean' ? base.italic : defaults.italic,
    align: allowedAlign.has(base.align) ? base.align : defaults.align,
    tone: allowedTone.has(base.tone) ? base.tone : defaults.tone,
    backgroundColor: allowedBackgroundColors.has(base.backgroundColor) ? base.backgroundColor : defaults.backgroundColor,
    borderColor: allowedBorderColors.has(base.borderColor) ? base.borderColor : defaults.borderColor,
  };
};
const normalizeMeetingFollowupPrompts = (value) => {
  const base = value && typeof value === 'object' ? value : {};
  const normalizeCadence = (v, fallback) => {
    const num = Number(v);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(7, Math.min(365, Math.round(num)));
  };
  const normalizeLookback = (v, fallback) => {
    const num = Number(v);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(7, Math.min(365, Math.round(num)));
  };
  const normalizeTrigger = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const defaults = KNOWN_DEFAULTS.meetingFollowupPrompts;
  const guardian = base.guardian && typeof base.guardian === 'object' ? base.guardian : {};
  const teacher = base.teacher && typeof base.teacher === 'object' ? base.teacher : {};

  return {
    enabled: typeof base.enabled === 'boolean' ? base.enabled : Boolean(defaults.enabled),
    guardian: {
      enabled: typeof guardian.enabled === 'boolean' ? guardian.enabled : Boolean(defaults.guardian.enabled),
      cadenceDays: normalizeCadence(guardian.cadenceDays, defaults.guardian.cadenceDays),
      lookbackDays: normalizeLookback(guardian.lookbackDays, defaults.guardian.lookbackDays),
      triggerAt: normalizeTrigger(guardian.triggerAt),
    },
    teacher: {
      enabled: typeof teacher.enabled === 'boolean' ? teacher.enabled : Boolean(defaults.teacher.enabled),
      cadenceDays: normalizeCadence(teacher.cadenceDays, defaults.teacher.cadenceDays),
      lookbackDays: normalizeLookback(teacher.lookbackDays, defaults.teacher.lookbackDays),
      triggerAt: normalizeTrigger(teacher.triggerAt),
    },
  };
};
const normalizeDashboardDecorationValue = (value) => {
  const base = value && typeof value === 'object' ? value : {};
  const offsetX = Number(base.offsetX ?? 0);
  const offsetY = Number(base.offsetY ?? 0);
  const items = base.items && typeof base.items === 'object' ? base.items : {};
  const defaultEnabled = KNOWN_DEFAULTS.dashboardDecoration?.enabled ?? true;
  const withDefaults = (key, defaults) => {
    const item = items[key] && typeof items[key] === 'object' ? items[key] : {};
    const rawCount = Number(item.count ?? defaults.count);
    const rawScale = Number(item.scale ?? defaults.scale);
    return {
      count: Number.isFinite(rawCount) ? Math.max(0, Math.min(12, Math.round(rawCount))) : defaults.count,
      scale: Number.isFinite(rawScale) ? Math.max(0.3, Math.min(2, rawScale)) : defaults.scale,
    };
  };

  const defaults = KNOWN_DEFAULTS.dashboardDecoration?.items || {
    crescents: { count: 2, scale: 1 },
    stars: { count: 4, scale: 1 },
    dots: { count: 6, scale: 1 },
    lanterns: { count: 3, scale: 0.8 },
  };

  return {
    enabled: typeof base.enabled === 'boolean' ? base.enabled : Boolean(defaultEnabled),
    offsetX: Number.isFinite(offsetX) ? offsetX : 0,
    offsetY: Number.isFinite(offsetY) ? offsetY : 0,
    items: {
      crescents: withDefaults('crescents', defaults.crescents),
      stars: withDefaults('stars', defaults.stars),
      dots: withDefaults('dots', defaults.dots),
      lanterns: withDefaults('lanterns', defaults.lanterns),
    },
  };
};

const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildOverrideId = () => `dst_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeTimezoneDstOverrideEntry = (value) => {
  const base = value && typeof value === 'object' ? value : {};
  const timezone = String(base.timezone || '').trim();
  const transitionAt = asDate(base.transitionAt);
  if (!timezone || !transitionAt) return null;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch (error) {
    return null;
  }

  const offsetBefore = Number(base.offsetBefore);
  const offsetAfter = Number(base.offsetAfter);
  const normalizedType = String(base.type || '').trim().toLowerCase();
  const type = normalizedType === 'fall_back' ? 'fall_back' : 'spring_forward';
  const rawDifference = Number(base.timeDifference);
  const timeDifference = Number.isFinite(rawDifference)
    ? Math.abs(rawDifference)
    : (Number.isFinite(offsetBefore) && Number.isFinite(offsetAfter)
      ? Math.abs(offsetAfter - offsetBefore)
      : 60);

  return {
    id: String(base.id || buildOverrideId()),
    timezone,
    transitionAt: transitionAt.toISOString(),
    offsetBefore: Number.isFinite(offsetBefore) ? offsetBefore : null,
    offsetAfter: Number.isFinite(offsetAfter) ? offsetAfter : null,
    type,
    timeDifference,
    note: String(base.note || base.label || '').trim(),
    enabled: base.enabled !== false,
    appliedAt: asDate(base.appliedAt)?.toISOString() || null,
    appliedBy: base.appliedBy || null,
    lastAppliedResult: base.lastAppliedResult && typeof base.lastAppliedResult === 'object'
      ? base.lastAppliedResult
      : null,
  };
};

const normalizeTimezoneDstOverrides = (value) => {
  const list = Array.isArray(value) ? value : [];
  const deduped = new Map();

  list.forEach((entry) => {
    const normalized = normalizeTimezoneDstOverrideEntry(entry);
    if (!normalized) return;
    const key = `${normalized.timezone}|${normalized.transitionAt}`;
    deduped.set(key, normalized);
  });

  return Array.from(deduped.values()).sort((a, b) => new Date(a.transitionAt) - new Date(b.transitionAt));
};

const getNormalizedTimezoneDstOverrides = async () => {
  const setting = await Setting.findOne({ key: 'timezoneDstOverrides' }).lean();
  return normalizeTimezoneDstOverrides(setting?.value ?? KNOWN_DEFAULTS.timezoneDstOverrides);
};

const toTransitionPayload = (override) => ({
  id: override.id,
  timezone: override.timezone,
  transitionAt: override.transitionAt,
  date: override.transitionAt,
  offsetBefore: override.offsetBefore,
  offsetAfter: override.offsetAfter,
  type: override.type,
  timeDifference: override.timeDifference,
  note: override.note,
  source: 'manual',
});

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

// Getter for presenter access (authenticated users)
// Used by sidebar to show/hide the Presenter menu item
router.get('/presenterAccess', authenticateToken, async (req, res) => {
  try {
    const key = 'presenterAccess';
    const s = await Setting.findOne({ key });
    // Default to 'admin' if not set
    const value = s?.value || 'admin';
    res.json({ success: true, setting: { key, value } });
  } catch (err) {
    console.error('Failed to fetch presenterAccess', err);
    res.status(500).json({ message: 'Failed to fetch presenter access' });
  }
});

// Getter for requests visibility (authenticated users)
// Controls who can access /dashboard/requests and /api/requests.
router.get('/requestsVisibility', authenticateToken, async (req, res) => {
  try {
    const s = await Setting.findOne({ key: REQUESTS_VISIBILITY_KEY }).lean();
    const value = normalizeRequestsVisibility(s?.value);
    return res.json({
      success: true,
      setting: {
        key: REQUESTS_VISIBILITY_KEY,
        value,
      },
    });
  } catch (err) {
    console.error('Failed to fetch requests visibility', err);
    return res.status(500).json({ message: 'Failed to fetch requests visibility' });
  }
});

// Getter for Hijri offset settings (authenticated users)
router.get('/hijri-offset', authenticateToken, async (req, res) => {
  try {
    const s = await Setting.findOne({ key: HIJRI_OFFSET_KEY }).lean();
    const value = normalizeHijriOffsetValue(s?.value ?? KNOWN_DEFAULTS.hijriOffsetDays);
    return res.json({
      success: true,
      setting: {
        key: HIJRI_OFFSET_KEY,
        value,
      },
    });
  } catch (err) {
    console.error('Failed to fetch Hijri offset setting', err);
    return res.status(500).json({ message: 'Failed to fetch Hijri offset setting' });
  }
});

// Getter for dashboard decoration (authenticated users)
router.get('/dashboardDecoration', authenticateToken, async (req, res) => {
  try {
    const s = await Setting.findOne({ key: DASHBOARD_DECORATION_KEY }).lean();
    const value = normalizeDashboardDecorationValue(s?.value ?? KNOWN_DEFAULTS.dashboardDecoration);
    return res.json({
      success: true,
      setting: {
        key: DASHBOARD_DECORATION_KEY,
        value,
      },
    });
  } catch (err) {
    console.error('Failed to fetch dashboard decoration setting', err);
    return res.status(500).json({ message: 'Failed to fetch dashboard decoration setting' });
  }
});

// Getter for homepage announcement (authenticated users)
router.get('/homepage-announcement', authenticateToken, async (req, res) => {
  try {
    const s = await Setting.findOne({ key: HOMEPAGE_ANNOUNCEMENT_KEY }).lean();
    const value = normalizeHomepageAnnouncement(s?.value ?? KNOWN_DEFAULTS.homepageAnnouncement);
    return res.json({
      success: true,
      setting: {
        key: HOMEPAGE_ANNOUNCEMENT_KEY,
        value,
      },
    });
  } catch (err) {
    console.error('Failed to fetch homepage announcement setting', err);
    return res.status(500).json({ message: 'Failed to fetch homepage announcement setting' });
  }
});

// Getter for meeting follow-up prompts (authenticated users)
router.get('/meetingFollowupPrompts', authenticateToken, async (req, res) => {
  try {
    const s = await Setting.findOne({ key: MEETING_FOLLOWUP_PROMPTS_KEY }).lean();
    const value = normalizeMeetingFollowupPrompts(s?.value ?? KNOWN_DEFAULTS.meetingFollowupPrompts);
    return res.json({
      success: true,
      setting: {
        key: MEETING_FOLLOWUP_PROMPTS_KEY,
        value,
      },
    });
  } catch (err) {
    console.error('Failed to fetch meeting follow-up prompts setting', err);
    return res.status(500).json({ message: 'Failed to fetch meeting follow-up prompts setting' });
  }
});

// Update dashboard decoration (admin)
router.put('/dashboardDecoration', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const value = normalizeDashboardDecorationValue(req.body?.value ?? {});
    const s = await Setting.findOneAndUpdate(
      { key: DASHBOARD_DECORATION_KEY },
      { value },
      { upsert: true, new: true }
    );
    return res.json({ success: true, setting: s });
  } catch (err) {
    console.error('Failed to update dashboard decoration setting', err);
    return res.status(500).json({ message: 'Failed to update dashboard decoration setting' });
  }
});

// Update meeting follow-up prompts (admin only)
router.put('/meetingFollowupPrompts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const value = normalizeMeetingFollowupPrompts(req.body?.value ?? {});
    const s = await Setting.findOneAndUpdate(
      { key: MEETING_FOLLOWUP_PROMPTS_KEY },
      { value },
      { upsert: true, new: true }
    );
    return res.json({ success: true, setting: s });
  } catch (err) {
    console.error('Failed to update meeting follow-up prompts setting', err);
    return res.status(500).json({ message: 'Failed to update meeting follow-up prompts setting' });
  }
});

// Update homepage announcement (admin only)
router.put('/homepage-announcement', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const value = normalizeHomepageAnnouncement(req.body?.value ?? {});
    const s = await Setting.findOneAndUpdate(
      { key: HOMEPAGE_ANNOUNCEMENT_KEY },
      { value },
      { upsert: true, new: true }
    );
    return res.json({ success: true, setting: s });
  } catch (err) {
    console.error('Failed to update homepage announcement setting', err);
    return res.status(500).json({ message: 'Failed to update homepage announcement setting' });
  }
});

// WhatsApp recipients for bulk/custom campaigns (admin only)
router.get('/whatsapp-recipients', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const audience = String(req.query?.audience || 'active_guardians').trim();
    const timezone = String(req.query?.timezone || '').trim();
    const country = String(req.query?.country || '').trim();
    const match = resolveAudienceFilter({ audience, timezone, country });

    const dbQuery = {
      role: match.role,
      ...(typeof match.isActive === 'boolean' ? { isActive: match.isActive } : {}),
      ...(match.timezone ? { timezone: match.timezone } : {}),
    };

    const users = await User.find(dbQuery)
      .select('firstName lastName role isActive phone whatsapp timezone guardianInfo.epithet uiPreferences.timezoneCountry')
      .lean();

    const updates = [];
    const normalizedRecipients = users.map((u) => {
      const timezoneValue = String(u?.timezone || '').trim();
      const derivedCountry = deriveCountryFromTimezone(timezoneValue);
      const storedCountry = String(u?.uiPreferences?.timezoneCountry || '').trim();
      const countryValue = derivedCountry || storedCountry;
      const phone = normalizeWhatsappPhone(u?.whatsapp || u?.phone);

      if (String(u?.role || '') === 'guardian' && countryValue && storedCountry !== countryValue) {
        updates.push({
          updateOne: {
            filter: { _id: u._id },
            update: { $set: { 'uiPreferences.timezoneCountry': countryValue } },
          },
        });
      }

      return {
        id: String(u._id),
        role: u.role,
        isActive: Boolean(u.isActive),
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        epithet: u?.guardianInfo?.epithet || '',
        timezone: timezoneValue,
        country: countryValue,
        phone,
      };
    });

    if (updates.length) {
      try {
        await User.bulkWrite(updates, { ordered: false });
      } catch (bulkErr) {
        console.warn('Failed to persist timezone-country mapping for some users:', bulkErr?.message || bulkErr);
      }
    }

    const filtered = match._derivedCountry
      ? normalizedRecipients.filter((r) => String(r.country || '').toLowerCase() === String(match._derivedCountry).toLowerCase())
      : normalizedRecipients;

    const guardianUniverse = await User.find({ role: 'guardian' }).select('timezone uiPreferences.timezoneCountry').lean();
    const timezoneOptions = Array.from(new Set(
      guardianUniverse.map((g) => String(g?.timezone || '').trim()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));
    const countryOptions = Array.from(new Set(
      guardianUniverse
        .map((g) => deriveCountryFromTimezone(g?.timezone) || String(g?.uiPreferences?.timezoneCountry || '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b));

    return res.json({
      success: true,
      audience,
      filters: { timezone, country },
      recipients: filtered,
      options: {
        guardianTimezones: timezoneOptions,
        guardianCountries: countryOptions,
      },
      stats: {
        total: filtered.length,
        withPhone: filtered.filter((r) => Boolean(r.phone)).length,
      },
    });
  } catch (err) {
    console.error('Failed to fetch WhatsApp recipients', err);
    return res.status(500).json({ message: 'Failed to fetch WhatsApp recipients' });
  }
});

// Upload optional WhatsApp message image (admin only)
router.post('/whatsapp-broadcast/image', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const mime = req.file.mimetype || 'image/png';
    const dataUri = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      const uploaded = await uploadImage(dataUri, {
        folder: 'waraqa/whatsapp',
        transformation: [{ width: 1600, height: 1600, crop: 'limit' }],
      });
      const url = uploaded?.main?.secure_url || null;
      if (!url) return res.status(500).json({ message: 'Upload failed: no image URL returned' });
      return res.json({ success: true, image: { url } });
    }

    return res.json({ success: true, image: { url: dataUri, fallback: true } });
  } catch (err) {
    console.error('Failed to upload WhatsApp image', err);
    return res.status(500).json({ message: 'Failed to upload WhatsApp image' });
  }
});

// Update Hijri offset settings (admin only)
router.put('/hijri-offset', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body?.value ?? req.body ?? {};
    const value = normalizeHijriOffsetValue(incoming);
    const s = await Setting.findOneAndUpdate(
      { key: HIJRI_OFFSET_KEY },
      { value },
      { upsert: true, new: true }
    );
    return res.json({ success: true, setting: s });
  } catch (err) {
    console.error('Failed to update Hijri offset setting', err);
    return res.status(500).json({ message: 'Failed to update Hijri offset setting' });
  }
});

// Update requests visibility (admin only)
router.put('/requestsVisibility', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const value = normalizeRequestsVisibility(req.body?.value);
    const s = await Setting.findOneAndUpdate(
      { key: REQUESTS_VISIBILITY_KEY },
      { value, description: 'Who can access Requests section' },
      { upsert: true, new: true }
    );
    return res.json({ success: true, setting: s });
  } catch (err) {
    console.error('Failed to update requests visibility', err);
    return res.status(500).json({ message: 'Failed to update requests visibility' });
  }
});

router.get('/timezoneDstOverrides', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const value = await getNormalizedTimezoneDstOverrides();
    return res.json({
      success: true,
      setting: {
        key: 'timezoneDstOverrides',
        value,
      },
    });
  } catch (err) {
    console.error('Failed to fetch timezone DST overrides', err);
    return res.status(500).json({ message: 'Failed to fetch timezone DST overrides' });
  }
});

router.put('/timezoneDstOverrides', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const value = normalizeTimezoneDstOverrides(req.body?.value ?? []);
    const s = await Setting.findOneAndUpdate(
      { key: 'timezoneDstOverrides' },
      { value },
      { upsert: true, new: true }
    );
    return res.json({ success: true, setting: s });
  } catch (err) {
    console.error('Failed to update timezone DST overrides', err);
    return res.status(500).json({ message: 'Failed to update timezone DST overrides' });
  }
});

router.post('/timezoneDstOverrides/preview', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const overrides = await getNormalizedTimezoneDstOverrides();
    const requestedId = String(req.body?.id || '').trim();
    const savedOverride = overrides.find((entry) => entry.id === requestedId) || null;
    const incomingOverride = savedOverride || normalizeTimezoneDstOverrideEntry(req.body?.override);
    if (!incomingOverride) {
      return res.status(400).json({ message: 'A valid timezone override is required' });
    }

    const preview = await dstService.buildTransitionImpactPreview(toTransitionPayload(incomingOverride));
    return res.json({
      success: true,
      override: incomingOverride,
      preview,
    });
  } catch (err) {
    console.error('Failed to preview timezone DST override', err);
    return res.status(500).json({ message: 'Failed to preview timezone DST override' });
  }
});

router.post('/timezoneDstOverrides/apply', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const requestedId = String(req.body?.id || '').trim();
    if (!requestedId) {
      return res.status(400).json({ message: 'Override id is required' });
    }

    const overrides = await getNormalizedTimezoneDstOverrides();
    const overrideIndex = overrides.findIndex((entry) => entry.id === requestedId);
    if (overrideIndex === -1) {
      return res.status(404).json({ message: 'Timezone override not found' });
    }

    const target = overrides[overrideIndex];
    const preview = await dstService.buildTransitionImpactPreview(toTransitionPayload(target));
    const result = await dstService.adjustClassTimesForDST(toTransitionPayload(target), {
      source: 'manual',
      overrideId: target.id,
    });

    overrides[overrideIndex] = {
      ...target,
      appliedAt: new Date().toISOString(),
      appliedBy: {
        id: String(req.user?._id || ''),
        name: `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || 'Admin',
      },
      lastAppliedResult: {
        adjustedCount: Number(result?.adjustedCount || 0),
        skippedAlreadyApplied: Number(result?.skippedAlreadyApplied || 0),
        pendingClassesAtApplyTime: Number(preview?.summary?.pendingClasses || 0),
      },
    };

    const s = await Setting.findOneAndUpdate(
      { key: 'timezoneDstOverrides' },
      { value: overrides },
      { upsert: true, new: true }
    );

    return res.json({
      success: true,
      setting: s,
      override: overrides[overrideIndex],
      preview,
      result,
      message: result?.adjustedCount
        ? `Applied timezone change to ${result.adjustedCount} class${result.adjustedCount === 1 ? '' : 'es'}`
        : 'No pending classes needed a timezone update',
    });
  } catch (err) {
    console.error('Failed to apply timezone DST override', err);
    return res.status(500).json({ message: 'Failed to apply timezone DST override' });
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

