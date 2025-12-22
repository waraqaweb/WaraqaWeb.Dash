const express = require('express');
const multer = require('multer');
const MarketingSiteSettings = require('../models/MarketingSiteSettings');
const MarketingCourse = require('../models/MarketingCourse');
const MarketingLandingPage = require('../models/MarketingLandingPage');
const MarketingPricingPlan = require('../models/MarketingPricingPlan');
const MarketingTeacherProfile = require('../models/MarketingTeacherProfile');
const MarketingTestimonial = require('../models/MarketingTestimonial');
const MarketingBlogPost = require('../models/MarketingBlogPost');
const MarketingContactMessage = require('../models/MarketingContactMessage');
const MediaAsset = require('../models/MediaAsset');
const SeminarSchedule = require('../models/SeminarSchedule');
const SeminarRegistration = require('../models/SeminarRegistration');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { slugify } = require('../utils/slug');
const { uploadImage, deleteImage } = require('../services/cloudinaryService');
const meetingService = require('../services/meetingService');
const { MEETING_TYPES } = require('../constants/meetingConstants');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const buildDefaultSettings = () => ({
  hero: {
    eyebrow: 'Learning without limits',
    headline: 'Personalized Quran, Arabic, and Islamic studies',
    subheading: 'Trusted by families worldwide with dedicated teachers.',
    media: null,
    backgroundMedia: null,
    mediaMode: 'card',
    ctas: []
  },
  primaryNavigation: [],
  secondaryNavigation: [],
  contactInfo: {},
  socialLinks: [],
  seoDefaults: {},
  structuredData: { organization: true, courses: true, reviews: true },
  assetLibrary: {},
  announcement: {
    message: '',
    href: '',
    active: false
  },
  lastPublishedAt: null
});

const landingSectionBlueprints = [
  {
    key: 'hero',
    label: 'Hero spotlight',
    description: 'Above-the-fold hero block wired to site settings with optional overrides.',
    layout: 'full',
    theme: 'light',
    dataSource: 'site-hero',
    dataFilters: {},
    limit: 1,
    settings: {
      heroCopySource: 'site',
      kicker: '',
      headline: '',
      subheading: '',
      primaryCta: { label: '', href: '' },
      secondaryCta: { label: '', href: '' }
    }
  },
  {
    key: 'courses',
    label: 'Courses rail',
    description: 'Highlights featured courses curated in the Content Library.',
    layout: 'grid',
    theme: 'light',
    dataSource: 'courses',
    dataFilters: { featured: true },
    limit: 3,
    settings: {
      kicker: 'Courses',
      headline: 'Programs designed for every learner',
      subheading: 'Pulls directly from published marketing courses.',
      primaryCta: { label: 'View all courses', href: '/courses' }
    }
  },
  {
    key: 'pricing',
    label: 'Tuition snapshot',
    description: 'Surface the current highlight plans from the pricing catalog.',
    layout: 'split',
    theme: 'light',
    dataSource: 'pricing',
    dataFilters: { highlight: true },
    limit: 2,
    settings: {
      kicker: 'Pricing',
      headline: 'Transparent tuition',
      subheading: 'Families can see your highlight plan without leaving the page.',
      primaryCta: { label: 'Compare tuition', href: '/pricing' }
    }
  },
  {
    key: 'teachers',
    label: 'Teacher carousel',
    description: 'Showcase published instructor profiles marked as featured.',
    layout: 'carousel',
    theme: 'light',
    dataSource: 'teachers',
    dataFilters: { featured: true },
    limit: 6,
    settings: {
      kicker: 'Teachers',
      headline: 'Educators families meet before enrolling',
      subheading: 'Updates when admins publish new teacher profiles.',
      primaryCta: { label: 'Meet the team', href: '/teachers' }
    }
  },
  {
    key: 'testimonials',
    label: 'Testimonial wall',
    description: 'Social proof grid synced to the testimonial library.',
    layout: 'grid',
    theme: 'warm',
    dataSource: 'testimonials',
    dataFilters: { featured: true },
    limit: 4,
    settings: {
      kicker: 'Testimonials',
      headline: 'Proof from families worldwide',
      subheading: 'Quote cards reflect languages and ratings in the CMS.',
      primaryCta: { label: 'Read the stories', href: '/testimonials' }
    }
  },
  {
    key: 'blog',
    label: 'Blog digest',
    description: 'Latest thought leadership from the blog system.',
    layout: 'grid',
    theme: 'slate',
    dataSource: 'blog',
    dataFilters: { status: 'published' },
    limit: 3,
    settings: {
      kicker: 'Blog',
      headline: 'What the team is publishing',
      subheading: 'Reading time and categories sync automatically.',
      primaryCta: { label: 'Visit the blog', href: '/blog' }
    }
  },
  {
    key: 'contact',
    label: 'Contact + booking',
    description: 'Provides CTA for families to reach admissions.',
    layout: 'split',
    theme: 'dark',
    dataSource: 'contact',
    dataFilters: {},
    limit: 1,
    settings: {
      kicker: 'Next step',
      headline: 'Schedule a placement call',
      subheading: 'Connect families to admissions from any landing page.',
      primaryCta: { label: 'Talk to admissions', href: '/contact' },
      secondaryCta: { label: 'View FAQs', href: '/blog' }
    }
  }
];

const clamp01 = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
};

const clampNumber = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
};

const normalizeMediaValue = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeTextVariant = (value) => {
  const variant = typeof value === 'string' ? value.toLowerCase() : '';
  if (variant === 'light' || variant === 'dark' || variant === 'auto') return variant;
  return 'auto';
};

const normalizeColor = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeFontFamily = (value) => {
  const font = typeof value === 'string' ? value.toLowerCase() : '';
  if (['sans', 'serif', 'display'].includes(font)) return font;
  return 'sans';
};

const normalizeAlignment = (value) => {
  const align = typeof value === 'string' ? value.toLowerCase() : '';
  if (['left', 'center', 'right'].includes(align)) return align;
  return 'left';
};

const sanitizeSections = (sections = []) =>
  sections.map((section, index) => {
    const limitValue = Number(section.limit);
    const rawSettings = section?.settings || {};
    const defaultHeroCopySource = section.dataSource === 'site-hero' ? 'site' : 'custom';
    const heroCopySource = rawSettings.heroCopySource === 'custom' || rawSettings.heroCopySource === 'site'
      ? rawSettings.heroCopySource
      : defaultHeroCopySource;
    const backgroundMedia = normalizeMediaValue(rawSettings.backgroundMedia || rawSettings.media);
    const boxMedia = normalizeMediaValue(rawSettings.boxMedia);
    return {
      key: section.key || `custom-${index + 1}`,
      label: section.label || `Section ${index + 1}`,
      description: section.description || '',
      enabled: section.enabled !== false,
      layout: section.layout || 'full',
      theme: section.theme || 'light',
      dataSource: section.dataSource || 'custom',
      dataFilters: section.dataFilters || {},
      limit: Number.isFinite(limitValue) ? limitValue : 0,
      settings: {
        heroCopySource,
        kicker: rawSettings.kicker || '',
        headline: rawSettings.headline || '',
        subheading: rawSettings.subheading || '',
        media: backgroundMedia,
        backgroundMedia,
        backgroundOpacity: clamp01(rawSettings.backgroundOpacity, 0.22),
        boxMedia,
        boxOpacity: clamp01(rawSettings.boxOpacity, 0.9),
        textVariant: normalizeTextVariant(rawSettings.textVariant),
        fontFamily: normalizeFontFamily(rawSettings.fontFamily),
        kickerColor: normalizeColor(rawSettings.kickerColor),
        headlineColor: normalizeColor(rawSettings.headlineColor),
        subheadingColor: normalizeColor(rawSettings.subheadingColor),
        kickerSize: clampNumber(rawSettings.kickerSize, 10, 20, 14),
        headlineSize: clampNumber(rawSettings.headlineSize, 28, 80, 48),
        subheadingSize: clampNumber(rawSettings.subheadingSize, 14, 32, 18),
        headingSpacing: clampNumber(rawSettings.headingSpacing, 0, 80, 24),
        subheadingSpacing: clampNumber(rawSettings.subheadingSpacing, 0, 64, 24),
        ctaSpacing: clampNumber(rawSettings.ctaSpacing, 12, 64, 32),
        heroMaxWidth: clampNumber(rawSettings.heroMaxWidth, 48, 120, 72),
        verticalPadding: clampNumber(rawSettings.verticalPadding, 2, 12, 4),
        gridGap: clampNumber(rawSettings.gridGap, 1, 6, 2.5),
        contentWidthRatio: clampNumber(rawSettings.contentWidthRatio, 0.3, 0.7, 0.55),
        contentAlignment: normalizeAlignment(rawSettings.contentAlignment),
        primaryCta: {
          label: rawSettings.primaryCta?.label || '',
          href: rawSettings.primaryCta?.href || ''
        },
        secondaryCta: {
          label: rawSettings.secondaryCta?.label || '',
          href: rawSettings.secondaryCta?.href || ''
        }
      }
    };
  });

const buildDefaultLandingPage = () => ({
  title: 'Homepage',
  slug: 'home',
  description: 'Controls the marketing homepage layout.',
  heroVariant: 'hero-a',
  status: 'draft',
  sections: sanitizeSections(landingSectionBlueprints)
});

const ensureLandingPageSeed = async () => {
  const existing = await MarketingLandingPage.findOne({ slug: 'home' });
  if (existing) return existing;
  return MarketingLandingPage.create(buildDefaultLandingPage());
};

const handleError = (res, error, fallback = 'Unexpected marketing service error') => {
  console.error(fallback, error && (error.stack || error.message || error));
  const status = error?.status || 500;
  // In development expose the error message/stack to aid debugging
  if (process.env.NODE_ENV !== 'production') {
    return res.status(status).json({ message: fallback, error: (error && (error.message || error)).toString(), stack: error && error.stack });
  }
  res.status(status).json({ message: fallback });
};

const isDuplicateKeyError = (error) => {
  if (!error) return false;
  if (error.code === 11000) return true;
  const msg = error.message || '';
  return typeof msg === 'string' && msg.includes('E11000 duplicate key');
};

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getUniqueSlug = async (Model, baseSlug, { excludeId } = {}) => {
  const cleanBase = String(baseSlug || '').trim().toLowerCase();
  const base = cleanBase.slice(0, 110) || `post-${Date.now().toString(36)}`;

  const baseQuery = excludeId ? { _id: { $ne: excludeId } } : {};
  const exists = await Model.findOne({ slug: base, ...baseQuery }).select('_id').lean();
  if (!exists) return base;

  // Try incrementing suffixes: my-title-2, my-title-3, ...
  const pattern = new RegExp(`^${escapeRegex(base)}-(\\d+)$`);
  const existing = await Model.find({ slug: { $regex: new RegExp(`^${escapeRegex(base)}(-\\d+)?$`) }, ...baseQuery })
    .select('slug')
    .lean();
  const used = new Set(existing.map((d) => d.slug));
  for (let n = 2; n <= 50; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }

  // Extremely unlikely fallback.
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
};

const ensureSlug = (value, fallbackPrefix) => slugify(value || '', { fallbackPrefix });

const stripHtml = (value = '') =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeArticleSections = (sections = []) => {
  if (!Array.isArray(sections)) return [];
  return sections
    .map((section = {}, index) => {
      const normalized = {
        kicker: typeof section.kicker === 'string' ? section.kicker.trim().slice(0, 120) : '',
        heading: typeof section.heading === 'string' ? section.heading.trim().slice(0, 200) : '',
        body: typeof section.body === 'string' ? section.body : '',
        media: typeof section.media === 'string' ? section.media : undefined,
        align: section.align === 'left' ? 'left' : 'right',
        accent: typeof section.accent === 'string' ? section.accent : undefined,
        order: typeof section.order === 'number' ? section.order : index
      };
      return normalized;
    })
    .filter((section) => section.heading || section.body || section.media)
    .slice(0, 8);
};

const normalizeCourseLevels = (levels = []) => {
  if (!Array.isArray(levels)) return [];
  const used = new Set();
  const slugifyLocal = (value, fallbackPrefix) => slugify(value || '', { fallbackPrefix });
  const uniqueWithin = (base) => {
    let safe = base;
    let n = 2;
    while (used.has(safe) && n <= 50) {
      safe = `${base}-${n}`;
      n += 1;
    }
    used.add(safe);
    return safe;
  };

  return levels
    .map((item = {}, index) => {
      const title = typeof item.title === 'string' ? item.title.trim().slice(0, 160) : '';
      const providedSlug = typeof item.slug === 'string' ? item.slug.trim().toLowerCase() : '';
      const base = providedSlug || slugifyLocal(title, `level-${index + 1}`);
      const slug = uniqueWithin(base);

      return {
        title,
        slug,
        description: typeof item.description === 'string' ? item.description.trim().slice(0, 800) : '',
        thumbnailMedia: typeof item.thumbnailMedia === 'string' ? item.thumbnailMedia : undefined,
        heroMedia: typeof item.heroMedia === 'string' ? item.heroMedia : undefined,
        articleIntro: typeof item.articleIntro === 'string' ? item.articleIntro : '',
        articleSections: normalizeArticleSections(item.articleSections),
        published: typeof item.published === 'boolean' ? item.published : true,
        order: typeof item.order === 'number' ? item.order : index
      };
    })
    .filter((item) => item.title)
    .slice(0, 60);
};

const estimateReadingTime = (content) => {
  if (!content) return 1;
  let raw = '';
  if (typeof content === 'string') raw = content;
  else if (typeof content === 'object') raw = JSON.stringify(content);
  const words = stripHtml(raw).split(' ').filter(Boolean);
  return Math.max(1, Math.ceil(words.length / 180));
};

// Site settings -------------------------------------------------------------
router.get('/site-settings', async (req, res) => {
  try {
    const settings = await MarketingSiteSettings.findOne().lean();
    if (settings?.publishedSnapshot) {
      res.json({ ...settings.publishedSnapshot, lastPublishedAt: settings.lastPublishedAt });
      return;
    }
    // Backward-compatible fallback: until the first publish occurs, serve the draft document.
    res.json(settings || buildDefaultSettings());
  } catch (error) {
    handleError(res, error, 'Failed to load marketing site settings');
  }
});

router.put('/site-settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payload = { ...req.body, updatedBy: req.user._id };
    const settings = await MarketingSiteSettings.findOneAndUpdate({}, payload, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    });
    res.json(settings);
  } catch (error) {
    handleError(res, error, 'Failed to save marketing site settings');
  }
});

router.get('/admin/site-settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const settings = await MarketingSiteSettings.findOne().lean();
    res.json(settings || buildDefaultSettings());
  } catch (error) {
    handleError(res, error, 'Failed to load marketing site settings');
  }
});

router.put('/admin/site-settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payload = { ...req.body, updatedBy: req.user._id };
    const settings = await MarketingSiteSettings.findOneAndUpdate({}, payload, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true
    });
    res.json(settings);
  } catch (error) {
    handleError(res, error, 'Failed to save marketing site settings');
  }
});

const isPreviewAuthorized = (req) => {
  const token = typeof req.query?.token === 'string' ? req.query.token : '';
  const previewToken = process.env.MARKETING_PREVIEW_TOKEN;
  if (!previewToken) return process.env.NODE_ENV !== 'production';
  return Boolean(token) && token === previewToken;
};

const buildSettingsSnapshot = (settings) => {
  if (!settings) return buildDefaultSettings();
  return {
    hero: settings.hero,
    primaryNavigation: settings.primaryNavigation,
    secondaryNavigation: settings.secondaryNavigation,
    contactInfo: settings.contactInfo,
    socialLinks: settings.socialLinks,
    seoDefaults: settings.seoDefaults,
    structuredData: settings.structuredData,
    assetLibrary: settings.assetLibrary,
    announcement: settings.announcement,
    lastPublishedAt: settings.lastPublishedAt
  };
};

router.get('/site-settings/preview', async (req, res) => {
  try {
    if (!isPreviewAuthorized(req)) return res.status(403).json({ message: 'Preview not authorized' });
    const settings = await MarketingSiteSettings.findOne().lean();
    res.json(settings || buildDefaultSettings());
  } catch (error) {
    handleError(res, error, 'Failed to load preview marketing site settings');
  }
});

router.post('/publish', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    let settings = await MarketingSiteSettings.findOne();
    if (!settings) {
      settings = await MarketingSiteSettings.create({ ...buildDefaultSettings(), updatedBy: req.user._id });
    }
    settings.lastPublishedAt = now;
    settings.updatedBy = req.user._id;
    settings.publishedSnapshot = buildSettingsSnapshot(settings.toObject());
    await settings.save();
    res.json({ message: 'Marketing content marked as published', lastPublishedAt: settings.lastPublishedAt });
  } catch (error) {
    handleError(res, error, 'Failed to publish marketing content');
  }
});

// Landing builder --------------------------------------------------------
router.get('/admin/landing-pages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureLandingPageSeed();
    const pages = await MarketingLandingPage.find().sort({ createdAt: 1 }).lean();
    res.json({ pages });
  } catch (error) {
    handleError(res, error, 'Failed to load landing pages');
  }
});

router.get('/admin/landing-pages/:slug', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await ensureLandingPageSeed();
    const page = await MarketingLandingPage.findOne({ slug: req.params.slug.toLowerCase() }).lean();
    if (!page) return res.status(404).json({ message: 'Landing page not found' });
    res.json(page);
  } catch (error) {
    handleError(res, error, 'Failed to load landing page');
  }
});

router.post('/landing-pages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const slug = ensureSlug(req.body.slug || req.body.title, 'landing');
    const payload = {
      ...buildDefaultLandingPage(),
      ...req.body,
      slug,
      sections: sanitizeSections(req.body.sections || landingSectionBlueprints),
      updatedBy: req.user._id
    };
    const page = await MarketingLandingPage.create(payload);
    res.status(201).json(page);
  } catch (error) {
    handleError(res, error, 'Failed to create landing page');
  }
});

router.put('/landing-pages/:pageId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const existing = await MarketingLandingPage.findById(req.params.pageId).lean();
    if (!existing) return res.status(404).json({ message: 'Landing page not found' });

    const snapshot = {
      title: existing.title,
      slug: existing.slug,
      description: existing.description,
      heroVariant: existing.heroVariant,
      status: existing.status,
      sections: existing.sections,
      lastPublishedAt: existing.lastPublishedAt
    };

    const set = {
      title: req.body.title,
      description: req.body.description,
      heroVariant: req.body.heroVariant,
      status: req.body.status,
      updatedBy: req.user._id
    };
    if (Array.isArray(req.body.sections)) {
      set.sections = sanitizeSections(req.body.sections);
    }

    const page = await MarketingLandingPage.findByIdAndUpdate(
      req.params.pageId,
      { $set: set, $push: { revisions: { snapshot, updatedAt: new Date(), updatedBy: req.user._id } } },
      { new: true }
    );
    if (!page) return res.status(404).json({ message: 'Landing page not found' });
    res.json(page);
  } catch (error) {
    handleError(res, error, 'Failed to update landing page');
  }
});

router.post('/landing-pages/:pageId/publish', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const existing = await MarketingLandingPage.findById(req.params.pageId).lean();
    if (!existing) return res.status(404).json({ message: 'Landing page not found' });

    const snapshot = {
      title: existing.title,
      slug: existing.slug,
      description: existing.description,
      heroVariant: existing.heroVariant,
      status: existing.status,
      sections: existing.sections,
      lastPublishedAt: existing.lastPublishedAt
    };

    const now = new Date();
    const page = await MarketingLandingPage.findByIdAndUpdate(
      req.params.pageId,
      {
        $set: { status: 'published', lastPublishedAt: now, updatedBy: req.user._id },
        $push: { revisions: { snapshot, updatedAt: now, updatedBy: req.user._id } }
      },
      { new: true }
    );
    if (!page) return res.status(404).json({ message: 'Landing page not found' });
    res.json(page);
  } catch (error) {
    handleError(res, error, 'Failed to publish landing page');
  }
});

router.get('/landing-pages/:slug', async (req, res) => {
  try {
    await ensureLandingPageSeed();
    const slug = req.params.slug.toLowerCase();
    const preview = req.query?.preview === '1' && isPreviewAuthorized(req);
    const query = preview ? { slug, status: { $ne: 'archived' } } : { slug, status: 'published' };

    let page = await MarketingLandingPage.findOne(query).lean();
    if (!page && !preview) {
      // Safe fallback for first-time setup: if nothing is published yet, serve the latest non-archived version.
      page = await MarketingLandingPage.findOne({ slug, status: { $ne: 'archived' } })
        .sort({ updatedAt: -1 })
        .lean();
    }

    if (!page) return res.status(404).json({ message: 'Landing page not found' });
    res.json(page);
  } catch (error) {
    handleError(res, error, 'Failed to fetch landing page');
  }
});

// Courses ------------------------------------------------------------------
router.get('/admin/courses', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const courses = await MarketingCourse.find().sort({ sortOrder: 1, updatedAt: -1 }).lean();
    res.json({ courses });
  } catch (error) {
    handleError(res, error, 'Failed to list courses');
  }
});

router.post('/courses', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payload = {
      ...req.body,
      slug: req.body.slug || ensureSlug(req.body.title, 'course'),
      updatedBy: req.user._id
    };
    if (typeof req.body.articleIntro === 'string') {
      payload.articleIntro = req.body.articleIntro;
    }
    payload.articleSections = normalizeArticleSections(req.body.articleSections);
    payload.curriculum = normalizeCourseLevels(req.body.curriculum);
    const course = await MarketingCourse.create(payload);
    res.status(201).json(course);
  } catch (error) {
    handleError(res, error, 'Failed to create course');
  }
});

router.put('/courses/:courseId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const updates = {
      ...req.body,
      slug: req.body.slug || ensureSlug(req.body.title, 'course'),
      updatedBy: req.user._id
    };
    if (typeof req.body.articleIntro === 'string') {
      updates.articleIntro = req.body.articleIntro;
    }
    updates.articleSections = normalizeArticleSections(req.body.articleSections);
    updates.curriculum = normalizeCourseLevels(req.body.curriculum);
    const course = await MarketingCourse.findByIdAndUpdate(req.params.courseId, updates, { new: true });
    res.json(course);
  } catch (error) {
    handleError(res, error, 'Failed to update course');
  }
});

router.delete('/courses/:courseId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await MarketingCourse.findByIdAndDelete(req.params.courseId);
    res.json({ message: 'Course deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete course');
  }
});

router.get('/courses', async (req, res) => {
  try {
    const filter = { published: true };
    if (req.query.level) filter.level = req.query.level;
    if (req.query.tag) filter.tags = req.query.tag;
    if (req.query.featured === 'true') filter.featured = true;
    const courses = await MarketingCourse.find(filter).sort({ sortOrder: 1 }).lean();
    res.json({ courses });
  } catch (error) {
    handleError(res, error, 'Failed to fetch courses');
  }
});

router.get('/courses/:slug', async (req, res) => {
  try {
    const course = await MarketingCourse.findOne({ slug: req.params.slug, published: true })
      .populate('pricingPlan')
      .lean();
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
    res.json(course);
  } catch (error) {
    handleError(res, error, 'Failed to fetch course');
  }
});

// Pricing ------------------------------------------------------------------
router.get('/admin/pricing', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const plans = await MarketingPricingPlan.find().sort({ sortOrder: 1 }).lean();
    res.json({ plans });
  } catch (error) {
    handleError(res, error, 'Failed to list pricing plans');
  }
});

router.post('/pricing', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const plan = await MarketingPricingPlan.create({ ...req.body, updatedBy: req.user._id });
    res.status(201).json(plan);
  } catch (error) {
    handleError(res, error, 'Failed to create pricing plan');
  }
});

router.put('/pricing/:planId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const plan = await MarketingPricingPlan.findByIdAndUpdate(
      req.params.planId,
      { ...req.body, updatedBy: req.user._id },
      { new: true }
    );
    res.json(plan);
  } catch (error) {
    handleError(res, error, 'Failed to update pricing plan');
  }
});

router.delete('/pricing/:planId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await MarketingPricingPlan.findByIdAndDelete(req.params.planId);
    res.json({ message: 'Pricing plan deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete pricing plan');
  }
});

router.get('/pricing', async (req, res) => {
  try {
    const plans = await MarketingPricingPlan.find({ published: true }).sort({ sortOrder: 1 }).lean();
    res.json({ plans });
  } catch (error) {
    handleError(res, error, 'Failed to fetch pricing plans');
  }
});

// Teachers -----------------------------------------------------------------
router.get('/admin/teachers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const teachers = await MarketingTeacherProfile.find().sort({ updatedAt: -1 }).lean();
    res.json({ teachers });
  } catch (error) {
    handleError(res, error, 'Failed to list teachers');
  }
});

router.post('/teachers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const fullName = (req.body.name || [req.body.firstName, req.body.lastName].filter(Boolean).join(' ')).trim() || 'teacher';
    const payload = {
      ...req.body,
      name: fullName,
      slug: req.body.slug || ensureSlug(fullName, 'teacher'),
      updatedBy: req.user._id
    };
    const teacher = await MarketingTeacherProfile.create(payload);
    res.status(201).json(teacher);
  } catch (error) {
    handleError(res, error, 'Failed to create teacher profile');
  }
});

router.put('/teachers/:teacherId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const fullName = (req.body.name || [req.body.firstName, req.body.lastName].filter(Boolean).join(' ')).trim() || 'teacher';
    const updates = {
      ...req.body,
      name: fullName,
      slug: req.body.slug || ensureSlug(fullName, 'teacher'),
      updatedBy: req.user._id
    };
    const teacher = await MarketingTeacherProfile.findByIdAndUpdate(req.params.teacherId, updates, { new: true });
    res.json(teacher);
  } catch (error) {
    handleError(res, error, 'Failed to update teacher profile');
  }
});

router.delete('/teachers/:teacherId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await MarketingTeacherProfile.findByIdAndDelete(req.params.teacherId);
    res.json({ message: 'Teacher profile deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete teacher profile');
  }
});

router.get('/teachers', async (req, res) => {
  try {
    const filter = { published: true };
    if (req.query.featured === 'true') filter.featured = true;
    const teachers = await MarketingTeacherProfile.find(filter)
      .populate('featuredCourses', 'title slug level')
      .lean();
    res.json({ teachers });
  } catch (error) {
    handleError(res, error, 'Failed to fetch teachers');
  }
});

router.get('/teachers/:slug', async (req, res) => {
  try {
    const teacher = await MarketingTeacherProfile.findOne({ slug: req.params.slug, published: true })
      .populate('featuredCourses', 'title slug level')
      .lean();
    if (!teacher) return res.status(404).json({ message: 'Teacher profile not found' });
    res.json(teacher);
  } catch (error) {
    handleError(res, error, 'Failed to fetch teacher profile');
  }
});

// Testimonials --------------------------------------------------------------
router.get('/admin/testimonials', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const testimonials = await MarketingTestimonial.find()
      .sort({ updatedAt: -1 })
      .populate('course', 'title slug level')
      .lean();
    res.json({ testimonials });
  } catch (error) {
    handleError(res, error, 'Failed to list testimonials');
  }
});

router.post('/testimonials', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const testimonial = await MarketingTestimonial.create({ ...req.body, updatedBy: req.user._id });
    res.status(201).json(testimonial);
  } catch (error) {
    handleError(res, error, 'Failed to create testimonial');
  }
});

router.put('/testimonials/:testimonialId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const testimonial = await MarketingTestimonial.findByIdAndUpdate(
      req.params.testimonialId,
      { ...req.body, updatedBy: req.user._id },
      { new: true }
    );
    res.json(testimonial);
  } catch (error) {
    handleError(res, error, 'Failed to update testimonial');
  }
});

router.delete('/testimonials/:testimonialId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await MarketingTestimonial.findByIdAndDelete(req.params.testimonialId);
    res.json({ message: 'Testimonial deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete testimonial');
  }
});

router.get('/testimonials', async (req, res) => {
  try {
    const filter = { published: true };
    if (req.query.locale) filter.locale = req.query.locale;
    if (req.query.featured === 'true') filter.featured = true;
    const testimonials = await MarketingTestimonial.find(filter)
      .limit(Number(req.query.limit) || 30)
      .populate('course', 'title slug level')
      .lean();
    res.json({ testimonials });
  } catch (error) {
    handleError(res, error, 'Failed to fetch testimonials');
  }
});

// Blog ---------------------------------------------------------------------
router.get('/admin/blog', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const posts = await MarketingBlogPost.find().sort({ updatedAt: -1 }).lean();
    res.json({ posts });
  } catch (error) {
    handleError(res, error, 'Failed to list blog posts');
  }
});

router.post('/blog', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rawSlug = typeof req.body.slug === 'string' ? req.body.slug.trim() : '';
    const hasExplicitSlug = Boolean(rawSlug);
    const baseSlug = hasExplicitSlug ? ensureSlug(rawSlug, 'post') : ensureSlug(req.body.title, 'post');
    const slug = hasExplicitSlug
      ? baseSlug
      : await getUniqueSlug(MarketingBlogPost, baseSlug);

    if (hasExplicitSlug) {
      const conflict = await MarketingBlogPost.findOne({ slug }).select('_id').lean();
      if (conflict) {
        return res.status(409).json({ message: 'Slug already exists. Please choose a different slug.' });
      }
    }

    const payload = {
      ...req.body,
      slug,
      updatedBy: req.user._id
    };
    payload.language = payload.language || 'en';
    payload.contentDirection = payload.contentDirection || (payload.language === 'ar' ? 'rtl' : 'ltr');
    if (typeof req.body.articleIntro === 'string') {
      payload.articleIntro = req.body.articleIntro;
    }
    payload.articleSections = normalizeArticleSections(req.body.articleSections);
    payload.readingTime = estimateReadingTime(payload.content);
    const post = await MarketingBlogPost.create(payload);
    res.status(201).json(post);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ message: 'A blog post with this slug already exists. Please choose a different slug.' });
    }
    handleError(res, error, 'Failed to create blog post');
  }
});

router.put('/blog/:postId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rawSlug = typeof req.body.slug === 'string' ? req.body.slug.trim() : '';
    const hasExplicitSlug = Boolean(rawSlug);
    const baseSlug = hasExplicitSlug ? ensureSlug(rawSlug, 'post') : ensureSlug(req.body.title, 'post');
    const slug = hasExplicitSlug
      ? baseSlug
      : await getUniqueSlug(MarketingBlogPost, baseSlug, { excludeId: req.params.postId });

    if (hasExplicitSlug) {
      const conflict = await MarketingBlogPost.findOne({ slug, _id: { $ne: req.params.postId } }).select('_id').lean();
      if (conflict) {
        return res.status(409).json({ message: 'Slug already exists. Please choose a different slug.' });
      }
    }

    const updates = {
      ...req.body,
      slug,
      updatedBy: req.user._id
    };
    updates.language = updates.language || 'en';
    updates.contentDirection = updates.contentDirection || (updates.language === 'ar' ? 'rtl' : 'ltr');
    if (typeof req.body.articleIntro === 'string') {
      updates.articleIntro = req.body.articleIntro;
    }
    updates.articleSections = normalizeArticleSections(req.body.articleSections);
    if (updates.content) {
      updates.readingTime = estimateReadingTime(updates.content);
    }
    const post = await MarketingBlogPost.findByIdAndUpdate(req.params.postId, updates, { new: true });
    res.json(post);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({ message: 'A blog post with this slug already exists. Please choose a different slug.' });
    }
    handleError(res, error, 'Failed to update blog post');
  }
});

router.delete('/blog/:postId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await MarketingBlogPost.findByIdAndDelete(req.params.postId);
    res.json({ message: 'Blog post deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete blog post');
  }
});

router.get('/blog', async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const skip = (page - 1) * limit;
    const filter = { status: 'published' };
    if (req.query.tag) filter.tags = req.query.tag;
    if (req.query.language) filter.language = req.query.language;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.featured === 'true') filter.featured = true;
    const [posts, total] = await Promise.all([
      MarketingBlogPost.find(filter)
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      MarketingBlogPost.countDocuments(filter)
    ]);
    res.json({ posts, page, total });
  } catch (error) {
    handleError(res, error, 'Failed to fetch blog posts');
  }
});

router.get('/blog/:slug', async (req, res) => {
  try {
    const post = await MarketingBlogPost.findOne({ slug: req.params.slug, status: 'published' }).lean();
    if (!post) return res.status(404).json({ message: 'Blog post not found' });
    res.json(post);
  } catch (error) {
    handleError(res, error, 'Failed to fetch blog post');
  }
});

// Media library -------------------------------------------------------------
router.get('/media', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.tag) filter.tags = req.query.tag;
    const assets = await MediaAsset.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ assets });
  } catch (error) {
    handleError(res, error, 'Failed to list media assets');
  }
});

router.post('/media', authenticateToken, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'file is required' });
    }

    const { normalizeUtf8FromLatin1 } = require('../utils/textEncoding');
    const originalName = normalizeUtf8FromLatin1(req.file.originalname);

    // Convert buffer to data URI for potential Cloudinary upload or DB fallback
    const fileEncoded = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Try Cloudinary if configured; otherwise fall back to storing the data URI in DB
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      try {
        const uploadResult = await uploadImage(fileEncoded, { folder: 'waraqa/marketing_assets' });
        const asset = await MediaAsset.create({
          originalName,
          url: uploadResult.main.secure_url,
          thumbnailUrl: uploadResult.thumb?.secure_url,
          publicId: uploadResult.main.public_id,
          format: uploadResult.main.format,
          bytes: uploadResult.main.bytes,
          width: uploadResult.main.width,
          height: uploadResult.main.height,
          resourceType: uploadResult.main.resource_type,
          tags: req.body.tags ? req.body.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
          altText: req.body.altText,
          attribution: req.body.attribution,
          uploadedBy: req.user._id
        });
        return res.status(201).json(asset);
      } catch (cloudErr) {
        // Log and fall back to DB storage so admin uploads don't block the UI
        console.error('Cloudinary upload failed for marketing media, falling back to DB storage:', cloudErr && (cloudErr.message || cloudErr));
        if (process.env.NODE_ENV === 'development') console.error('Cloudinary error stack:', cloudErr && cloudErr.stack);
        // Continue to fallback below
      }
    }

    // Fallback: store base64 data URI in DB. Not ideal for production but safe for admin uploads.
    try {
      const dataUri = fileEncoded;
      const asset = await MediaAsset.create({
        originalName,
        url: dataUri,
        thumbnailUrl: null,
        publicId: null,
        format: 'datauri',
        bytes: req.file.size || (req.file.buffer && req.file.buffer.length) || 0,
        width: null,
        height: null,
        resourceType: 'datauri',
        tags: req.body.tags ? req.body.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [],
        altText: req.body.altText,
        attribution: req.body.attribution,
        uploadedBy: req.user._id
      });
      const resp = { ...asset.toObject(), fallback: true };
      if (process.env.NODE_ENV === 'development') resp.note = 'cloudinary_not_available_or_failed';
      return res.status(201).json(resp);
    } catch (dbErr) {
      console.error('Failed to store media asset in DB fallback:', dbErr);
      return res.status(500).json({ message: 'Failed to upload media', error: dbErr.message });
    }
  } catch (error) {
    console.error('Media upload failed. Request file:', req.file && ({ originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size }), 'body:', req.body);
    handleError(res, error, 'Failed to upload media');
  }
});

router.delete('/media/:assetId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const asset = await MediaAsset.findById(req.params.assetId);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    if (asset.publicId) {
      await deleteImage(asset.publicId);
    }
    await asset.deleteOne();
    res.json({ message: 'Asset deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete media asset');
  }
});

// Seminars -----------------------------------------------------------------
router.get('/admin/seminars', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const seminars = await SeminarSchedule.find().sort({ updatedAt: -1 }).lean();
    res.json({ seminars });
  } catch (error) {
    handleError(res, error, 'Failed to list seminars');
  }
});

router.post('/seminars', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payload = {
      ...req.body,
      slug: req.body.slug || ensureSlug(req.body.topic, 'seminar'),
      updatedBy: req.user._id
    };
    const seminar = await SeminarSchedule.create(payload);
    res.status(201).json(seminar);
  } catch (error) {
    handleError(res, error, 'Failed to create seminar');
  }
});

router.put('/seminars/:seminarId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const updates = {
      ...req.body,
      slug: req.body.slug || ensureSlug(req.body.topic, 'seminar'),
      updatedBy: req.user._id
    };
    const seminar = await SeminarSchedule.findByIdAndUpdate(req.params.seminarId, updates, { new: true });
    res.json(seminar);
  } catch (error) {
    handleError(res, error, 'Failed to update seminar');
  }
});

router.delete('/seminars/:seminarId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await SeminarSchedule.findByIdAndDelete(req.params.seminarId);
    res.json({ message: 'Seminar deleted' });
  } catch (error) {
    handleError(res, error, 'Failed to delete seminar');
  }
});

router.get('/seminars', async (req, res) => {
  try {
    const seminars = await SeminarSchedule.find({ published: true, status: 'active' })
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ seminars });
  } catch (error) {
    handleError(res, error, 'Failed to fetch seminars');
  }
});

router.post('/seminars/:slug/book', async (req, res) => {
  try {
    const seminar = await SeminarSchedule.findOne({ slug: req.params.slug, published: true, status: 'active' });
    if (!seminar) return res.status(404).json({ message: 'Seminar not found' });
    const currentCount = await SeminarRegistration.countDocuments({ seminar: seminar._id, status: { $ne: 'cancelled' } });
    if (seminar.capacity && currentCount >= seminar.capacity) {
      return res.status(400).json({ message: 'Seminar is at capacity' });
    }
    const confirmationNumber = `SEM-${Date.now().toString(36).toUpperCase()}`;
    const registration = await SeminarRegistration.create({
      seminar: seminar._id,
      guardian: req.body.guardian,
      answers: req.body.answers,
      source: req.body.source,
      confirmationNumber
    });
    res.status(201).json({ message: 'Registration received', registration });
  } catch (error) {
    handleError(res, error, 'Failed to book seminar');
  }
});

// Contact & evaluation -----------------------------------------------------
router.post('/contact', async (req, res) => {
  try {
    const message = await MarketingContactMessage.create({
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      message: req.body.message,
      source: req.body.source,
      meta: req.body.meta || {}
    });
    res.status(201).json({ message: 'Contact request received', record: message });
  } catch (error) {
    handleError(res, error, 'Failed to submit contact request');
  }
});

router.post('/evaluation', async (req, res) => {
  try {
    const result = await meetingService.bookMeeting({
      meetingType: MEETING_TYPES.NEW_STUDENT_EVALUATION,
      requestedStart: req.body.startTime,
      timezone: req.body.timezone,
      students: Array.isArray(req.body.students) ? req.body.students : [],
      guardianPayload: req.body.guardian || {},
      notes: req.body.notes,
      adminId: req.body.adminId,
      calendarPreference: req.body.calendarPreference
    });
    res.status(201).json({
      message: 'Evaluation booked successfully',
      meeting: result.meeting,
      calendar: result.calendarLinks
    });
  } catch (error) {
    handleError(res, error, 'Failed to book evaluation');
  }
});

// SEO helpers --------------------------------------------------------------
router.get('/sitemap', async (req, res) => {
  try {
    const [courses, posts, teachers, landingPages] = await Promise.all([
      MarketingCourse.find({ published: true }, 'slug updatedAt').lean(),
      MarketingBlogPost.find({ status: 'published' }, 'slug updatedAt publishedAt').lean(),
      MarketingTeacherProfile.find({ published: true }, 'slug updatedAt').lean(),
      MarketingLandingPage.find({ status: 'published' }, 'slug updatedAt lastPublishedAt').lean()
    ]);

    const baseUrl = process.env.PUBLIC_MARKETING_URL || 'https://www.waraqaschool.com';
    const now = new Date();
    const sitemapEntries = new Map();

    const normalizePath = (path = '/') => (path.startsWith('/') ? path : `/${path}`);
    const registerUrl = (path, updatedAt) => {
      if (!path) return;
      const normalized = normalizePath(path);
      const timestamp = updatedAt instanceof Date ? updatedAt : new Date(updatedAt || now);
      if (Number.isNaN(timestamp.getTime())) return;
      const existing = sitemapEntries.get(normalized);
      if (existing && existing >= timestamp) {
        return;
      }
      sitemapEntries.set(normalized, timestamp);
    };

    const getLatestTimestamp = (docs, preferredFields = []) =>
      docs.reduce((latest, doc) => {
        const candidateValue = [...preferredFields, 'updatedAt', 'createdAt'].reduce(
          (value, field) => value || doc[field],
          null
        );
        if (!candidateValue) return latest;
        const candidateDate = new Date(candidateValue);
        if (!latest || candidateDate > latest) return candidateDate;
        return latest;
      }, null);

    const latestCoursesUpdate = getLatestTimestamp(courses);
    const latestPostsUpdate = getLatestTimestamp(posts, ['publishedAt']);
    const latestTeachersUpdate = getLatestTimestamp(teachers);
    const latestLandingUpdate = getLatestTimestamp(landingPages, ['lastPublishedAt']);
    const homePage = landingPages.find((page) => page.slug === 'home');

    const staticRoutes = [
      { path: '/', updatedAt: homePage?.lastPublishedAt || homePage?.updatedAt || latestLandingUpdate || now },
      { path: '/courses', updatedAt: latestCoursesUpdate || now },
      { path: '/pricing', updatedAt: now },
      { path: '/teachers', updatedAt: latestTeachersUpdate || now },
      { path: '/testimonials', updatedAt: now },
      { path: '/blog', updatedAt: latestPostsUpdate || now },
      { path: '/contact', updatedAt: now }
    ];

    staticRoutes.forEach(({ path, updatedAt }) => registerUrl(path, updatedAt));

    landingPages.forEach((page) => {
      const path = page.slug === 'home' ? '/' : `/${page.slug}`;
      registerUrl(path, page.lastPublishedAt || page.updatedAt);
    });

    courses.forEach((course) => registerUrl(`/courses/${course.slug}`, course.updatedAt));
    posts.forEach((post) => registerUrl(`/blog/${post.slug}`, post.publishedAt || post.updatedAt));
    teachers.forEach((teacher) => registerUrl(`/teachers/${teacher.slug}`, teacher.updatedAt));

    const urls = Array.from(sitemapEntries.entries()).map(
      ([path, lastmod]) => `<url><loc>${baseUrl}${path}</loc><lastmod>${lastmod.toISOString()}</lastmod></url>`
    );

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
    res.type('application/xml').send(sitemap);
  } catch (error) {
    handleError(res, error, 'Failed to generate sitemap');
  }
});

router.get('/feeds', async (req, res) => {
  try {
    const posts = await MarketingBlogPost.find({ status: 'published' })
      .sort({ publishedAt: -1 })
      .limit(30)
      .lean();
    const baseUrl = process.env.PUBLIC_MARKETING_URL || 'https://www.waraqaschool.com';
    const entries = posts
      .map((post) => `\n  <entry>\n    <title>${post.title}</title>\n    <link href="${baseUrl}/blog/${post.slug}" />\n    <updated>${new Date(post.publishedAt || post.updatedAt).toISOString()}</updated>\n    <id>${baseUrl}/blog/${post.slug}</id>\n    <summary>${post.summary || ''}</summary>\n  </entry>`)
      .join('');
    const feed = `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n  <title>Waraqa Blog</title>\n  <link href="${baseUrl}/blog" />\n  <updated>${new Date().toISOString()}</updated>\n  <id>${baseUrl}/blog</id>${entries}\n</feed>`;
    res.type('application/atom+xml').send(feed);
  } catch (error) {
    handleError(res, error, 'Failed to generate feed');
  }
});

module.exports = router;
