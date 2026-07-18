const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { parse: parseCsv } = require('csv-parse/sync');
const emailService = require('../services/emailService');
const Setting = require('../models/Setting');
const TeacherContractSubmission = require('../models/TeacherContractSubmission');
const TeacherContractLead = require('../models/TeacherContractLead');
const RecruitmentCampaign = require('../models/RecruitmentCampaign');
const TrainingBatch = require('../models/TrainingBatch');
const User = require('../models/User');
const Class = require('../models/Class');
const { authenticateToken, requireTeacherOrAdmin, requireAdmin } = require('../middleware/auth');
const notificationService = require('../services/notificationService');
const { standardizeSubjects, STANDARD_SUBJECTS } = require('../utils/subjectStandardization');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = express.Router();
const storage = multer.memoryStorage();
// Teacher contract uploads include audio/video (English intro, Quran recitation, teaching demo).
// Use a dedicated env var with a 100 MB default, separate from the global MAX_FILE_SIZE.
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.TEACHER_CONTRACT_MAX_FILE_SIZE || 100 * 1024 * 1024) },
});

const fileFields = upload.fields([
  { name: 'identityDocument', maxCount: 1 },
  { name: 'educationDocuments', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 },
  { name: 'resume', maxCount: 1 },
  { name: 'englishIntroduction', maxCount: 1 },
  { name: 'quranRecitation', maxCount: 1 },
  { name: 'teachingTopicExplanation', maxCount: 1 },
]);

const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

const CONTRACT_TEMPLATE_KEY = 'teacher_contract_template_v1';
const LECTURE_TEMPLATE_KEY = 'teacher_training_lecture_template_v1';
const DEFAULT_LECTURE_TOPICS = [
  'Introduction to Waraqa',
  'Waraqa Curricula',
  'Effective Teaching',
  'Understanding Learners & Building Strong Educational Relationships',
  'Lesson Management, Time Management & Institutional Commitment',
  'Professional Lesson Preparation',
  'Practical Teaching Demos (optional)',
];
const RECRUITMENT_RATINGS = ['not_available', 'weak', 'good', 'very_good', 'excellent'];
const RECRUITMENT_STATUSES = ['new', 'under_review', 'shortlisted', 'interview_pending', 'interviewed', 'accepted', 'rejected', 'archived'];

// ─── Recruitment automation config keys + defaults ───────────────────────────
const RECRUITMENT_EMAIL_TEMPLATE_KEY = 'recruitment_email_templates_v1';
const CAPACITY_CONFIG_KEY = 'recruitment_capacity_config_v1';

const DEFAULT_CAPACITY_CONFIG = {
  targetHoursPerTeacherPerDay: 4,
  horizonDays: 14,
  hireThresholdPct: 75,
  urgentThresholdPct: 85,
  minFemaleTeachers: 3,
  minMaleTeachers: 3,
};

const RECRUITMENT_EMAIL_EVENTS = [
  'interview_invite',
  'missing_info',
  'passed',
  'passed_not_selected',
  'completed_unsuitable',
  'failed',
];

// Interview outcomes that automatically produce a "pending" outcome email.
// (interview_invite and missing_info are manual, ad-hoc events — not driven by outcome.)
const OUTCOME_TO_EMAIL_EVENT = {
  passed: 'passed',
  passed_not_selected: 'passed_not_selected',
  completed_unsuitable: 'completed_unsuitable',
  failed: 'failed',
};
const outcomeEmailEventFor = (outcome) => OUTCOME_TO_EMAIL_EVENT[String(outcome || '').trim()] || null;

const DEFAULT_RECRUITMENT_EMAIL_TEMPLATES = {
  interview_invite: {
    subject: 'Your Waraqa teacher interview',
    body: 'Dear {{name}},\n\nThank you for applying to teach with Waraqa. We would like to invite you to a short online interview.\n\nPlease book a convenient slot here:\n{{link}}\n\nWe look forward to speaking with you.\n\nWaraqa Recruitment Team',
  },
  missing_info: {
    subject: 'A little more information is needed for your Waraqa application',
    body: 'Dear {{name}},\n\nThank you for your application. Before we can proceed, we need the following details:\n\n{{notes}}\n\nPlease reply to this email or update your application here:\n{{link}}\n\nWaraqa Recruitment Team',
  },
  passed: {
    subject: 'Congratulations — welcome to Waraqa',
    body: 'Dear {{name}},\n\nCongratulations! You have successfully passed your interview and we are delighted to welcome you to the Waraqa teaching team.\n\nOur team will contact you shortly with the next onboarding steps.\n\nWaraqa Recruitment Team',
  },
  passed_not_selected: {
    subject: 'Update on your Waraqa application',
    body: 'Dear {{name}},\n\nThank you for taking the time to interview with us. You performed well, and while we are not able to offer a position at this moment, we would like to keep your profile on file and reach out as soon as a suitable opening becomes available.\n\nWith appreciation,\nWaraqa Recruitment Team',
  },
  completed_unsuitable: {
    subject: 'Update on your Waraqa application',
    body: 'Dear {{name}},\n\nThank you for completing the interview process with us. After careful consideration, we have concluded that this is not the right match at this time.\n\nWe wish you every success in your teaching career.\n\nWaraqa Recruitment Team',
  },
  failed: {
    subject: 'Update on your Waraqa application',
    body: 'Dear {{name}},\n\nThank you for your interest in teaching with Waraqa and for the time you invested in your application. On this occasion we will not be moving forward.\n\nWe wish you all the best.\n\nWaraqa Recruitment Team',
  },
};
const RATING_SCORE = {
  not_available: 0,
  weak: 1,
  good: 3,
  very_good: 4,
  excellent: 5,
};
const DEFAULT_CONTRACT_TEMPLATE = `بسم الله الرحمن الرحيم

يسر مؤسسة ورقة لتعليم القرآن الكريم واللغة العربية والدراسات الإسلامية أن تقدم إليك عرضا للانضمام إلى فريقها، سائلين الله التوفيق والسداد.

الأجر للساعة:
- من 1 إلى 60 ساعة: 3 دولار
- من 61 إلى 75 ساعة: 3.25 دولار
- من 76 إلى 90 ساعة: 3.50 دولار
- من 91 إلى 110 ساعة: 3.75 دولار
- من 111 إلى 130 ساعة: 4 دولار
- من 131 إلى 150 ساعة: 4.25 دولار
- أكثر من 150 ساعة: 4.50 دولار

بنود العقد:
1- بواقع ثلثي المبلغ للدرس والثلث أجر تسليم تقرير الدرس خلال أول 24 ساعة من انتهاء الدرس.
2- يعتد فقط بالدروس التي درسها المعلم فعليا في نفس شهر المحاسبة.
3- في حال التغيب عن الدرس دون اعتذار قبل الموعد بثلاث ساعات على الأقل تخصم مدة الدرس من إجمالي الساعات.
4- يلتزم الطرف الثاني بتقديم جميع البيانات المطلوبة لتحويل الراتب.
5- يلتزم الطرف الثاني بالاشتراك في خدمة إنترنت قوية ومميزة.
6- في حال ضعف الإنترنت عند المعلم بما يؤدي إلى إلغاء الدرس أو إعادته لا تتم محاسبة المعلم على الدرس.
7- يتعهد الطرف الثاني بعدم إفشاء أسرار المؤسسة وآلية العمل لأي طرف.
8- الأشهر الثلاثة الأولى فترة اختبار.
9- مدة هذا العقد سنتان من بداية التعاقد.`;

const splitName = (value = '') => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || 'Teacher',
    lastName: parts.slice(1).join(' ') || 'User',
  };
};

const resolveMeetingLink = (body = {}) => String(body.meetingLink || body.skypeId || '').trim();

const slugifyCampaign = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const toDataUri = (file) => `data:${file.mimetype || 'application/octet-stream'};base64,${file.buffer.toString('base64')}`;

async function uploadAsset(file, folder) {
  if (!file) return null;

  if (isCloudinaryConfigured) {
    const uploaded = await cloudinary.uploader.upload(toDataUri(file), {
      folder,
      resource_type: 'auto',
      overwrite: true,
      use_filename: true,
      unique_filename: true,
    });

    return {
      url: uploaded.secure_url || uploaded.url || '',
      publicId: uploaded.public_id || '',
      originalName: file.originalname || '',
      mimeType: file.mimetype || '',
      size: file.size || 0,
    };
  }

  return {
    url: toDataUri(file),
    publicId: '',
    originalName: file.originalname || '',
    mimeType: file.mimetype || '',
    size: file.size || 0,
  };
}

function buildResponse(doc) {
  if (!doc) return { submission: null };
  return {
    submission: doc,
  };
}

async function getContractTemplateValue() {
  const setting = await Setting.findOne({ key: CONTRACT_TEMPLATE_KEY }).lean();
  return String(setting?.value || DEFAULT_CONTRACT_TEMPLATE);
}

async function getLectureTopics() {
  const setting = await Setting.findOne({ key: LECTURE_TEMPLATE_KEY }).lean();
  const raw = setting?.value;
  if (Array.isArray(raw) && raw.length) {
    const cleaned = raw.map((t) => String(t || '').trim()).filter(Boolean);
    if (cleaned.length) return cleaned;
  }
  return [...DEFAULT_LECTURE_TOPICS];
}

async function getRecruitmentEmailTemplates() {
  const setting = await Setting.findOne({ key: RECRUITMENT_EMAIL_TEMPLATE_KEY }).lean();
  const stored = (setting && typeof setting.value === 'object' && setting.value) ? setting.value : {};
  const merged = {};
  RECRUITMENT_EMAIL_EVENTS.forEach((event) => {
    const fallback = DEFAULT_RECRUITMENT_EMAIL_TEMPLATES[event] || { subject: '', body: '' };
    const custom = stored[event] || {};
    merged[event] = {
      subject: String(custom.subject || fallback.subject || '').trim(),
      body: String(custom.body || fallback.body || ''),
    };
  });
  return merged;
}

async function getCapacityConfig() {
  const setting = await Setting.findOne({ key: CAPACITY_CONFIG_KEY }).lean();
  const stored = (setting && typeof setting.value === 'object' && setting.value) ? setting.value : {};
  const clampNum = (val, def, min, max) => {
    const n = Number(val);
    if (Number.isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  return {
    targetHoursPerTeacherPerDay: clampNum(stored.targetHoursPerTeacherPerDay, DEFAULT_CAPACITY_CONFIG.targetHoursPerTeacherPerDay, 0.5, 16),
    horizonDays: Math.round(clampNum(stored.horizonDays, DEFAULT_CAPACITY_CONFIG.horizonDays, 1, 60)),
    hireThresholdPct: Math.round(clampNum(stored.hireThresholdPct, DEFAULT_CAPACITY_CONFIG.hireThresholdPct, 10, 100)),
    urgentThresholdPct: Math.round(clampNum(stored.urgentThresholdPct, DEFAULT_CAPACITY_CONFIG.urgentThresholdPct, 10, 100)),
    minFemaleTeachers: Math.round(clampNum(stored.minFemaleTeachers, DEFAULT_CAPACITY_CONFIG.minFemaleTeachers, 0, 100)),
    minMaleTeachers: Math.round(clampNum(stored.minMaleTeachers, DEFAULT_CAPACITY_CONFIG.minMaleTeachers, 0, 100)),
  };
}

// Normalize any Google Sheets share/edit URL into a CSV export URL.
function toGoogleSheetCsvUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) return '';
  // Already a CSV export link
  if (/[?&]format=csv/i.test(url) || /\/export\?/i.test(url)) return url;
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const id = idMatch ? idMatch[1] : (/^[a-zA-Z0-9-_]{20,}$/.test(url) ? url : '');
  if (!id) return url; // Let the caller attempt the URL as-is (e.g. published CSV)
  const gidMatch = url.match(/[?#&]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

// Pick the first matching column value from a parsed CSV row (case/space-insensitive header match).
function pickColumn(row, candidates) {
  const keys = Object.keys(row || {});
  for (const cand of candidates) {
    const target = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    const foundKey = keys.find((k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '').includes(target));
    if (foundKey && String(row[foundKey] || '').trim()) return String(row[foundKey]).trim();
  }
  return '';
}

function renderEmailTemplate(text, vars = {}) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

function normalizeTeacherResponse(source, doc) {
  if (!doc) return null;

  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const recruitment = plain.recruitment || {};
  return {
    id: String(plain._id),
    source,
    status: recruitment.status || 'new',
    formStatus: plain.status || 'submitted',
    submittedAt: plain.submittedAt || plain.createdAt || plain.updatedAt || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    contract: plain.contract || {},
    verification: plain.verification || {},
    personalInfo: plain.personalInfo || {},
    application: plain.application || {},
    recruitment: {
      status: recruitment.status || 'new',
      reviewed: Boolean(recruitment.reviewed),
      reviewedAt: recruitment.reviewedAt || null,
      reviewedBy: recruitment.reviewedBy ? {
        _id: recruitment.reviewedBy._id || recruitment.reviewedBy,
        firstName: recruitment.reviewedBy.firstName,
        lastName: recruitment.reviewedBy.lastName,
        email: recruitment.reviewedBy.email,
      } : null,
      adminNotes: recruitment.adminNotes || '',
      rejectionCategory: recruitment.rejectionCategory || '',
      tags: Array.isArray(recruitment.tags) ? recruitment.tags : [],
      fit: recruitment.fit || {},
      evaluation: recruitment.evaluation || {},
      overall: recruitment.overall || {},
      interview: recruitment.interview || {},
      contract: recruitment.contract || {},
      history: Array.isArray(recruitment.history) ? recruitment.history : [],
    },
    user: plain.user ? {
      _id: plain.user._id,
      firstName: plain.user.firstName,
      lastName: plain.user.lastName,
      email: plain.user.email,
      phone: plain.user.phone,
    } : null,
  };
}

const normalizeRecruitmentRating = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return RECRUITMENT_RATINGS.includes(normalized) ? normalized : 'not_available';
};

const normalizeRecruitmentStatus = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return RECRUITMENT_STATUSES.includes(normalized) ? normalized : 'new';
};

const normalizeStringArray = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const getBodyArray = (body = {}, key) => {
  const direct = body[key];
  const indexed = Object.keys(body)
    .filter((entry) => entry === key || entry.startsWith(`${key}[`))
    .sort()
    .map((entry) => body[entry]);
  if (Array.isArray(direct)) return normalizeStringArray(direct);
  if (typeof direct === 'string' && direct.includes(',')) return normalizeStringArray(direct);
  if (typeof direct === 'string' && direct.trim()) return [direct.trim()];
  return normalizeStringArray(indexed);
};

const buildApplicationPayload = (body = {}, files = {}, existingApplication = null, uploadPrefix = '') => {
  const currentFiles = existingApplication?.files || {};
  return {
    positionsInterested: getBodyArray(body, 'positionsInterested'),
    education: {
      eligibilityPath: String(body.eligibilityPath || '').trim(),
      graduationStatus: String(body.graduationStatus || '').trim(),
      facultyUniversity: String(body.facultyUniversity || '').trim(),
      degree: String(body.degree || '').trim(),
      additionalCertificates: String(body.additionalCertificates || '').trim(),
    },
    experience: {
      teachingExperienceLevel: String(body.teachingExperienceLevel || '').trim(),
      currentJob: String(body.currentJob || '').trim(),
      profileSummary: String(body.profileSummary || '').trim(),
      specialRequests: String(body.specialRequests || '').trim(),
    },
    technicalSkills: {
      classTools: String(body.classTools || '').trim(),
      meetingApps: getBodyArray(body, 'meetingApps'),
      officeProducts: getBodyArray(body, 'officeProducts'),
    },
    teachingProfile: {
      subjectsCanTeach: getBodyArray(body, 'subjectsCanTeach'),
      preferredAvailability: String(body.preferredAvailability || '').trim(),
      alternativeAvailability: String(body.alternativeAvailability || '').trim(),
    },
    files: {
      resume: files.resume?.[0] ? null : (currentFiles.resume || {}),
      englishIntroduction: files.englishIntroduction?.[0] ? null : (currentFiles.englishIntroduction || {}),
      quranRecitation: files.quranRecitation?.[0] ? null : (currentFiles.quranRecitation || {}),
      teachingTopicExplanation: files.teachingTopicExplanation?.[0] ? null : (currentFiles.teachingTopicExplanation || {}),
    },
  };
};

const computeRecruitmentOverall = (evaluation = {}) => {
  const values = Object.values(evaluation || {}).map((value) => normalizeRecruitmentRating(value));
  const scored = values.filter((value) => value !== 'not_available').map((value) => RATING_SCORE[value] || 0);
  if (!scored.length) {
    return { score: null, label: 'Not rated', recommendation: 'review' };
  }

  const average = scored.reduce((sum, value) => sum + value, 0) / scored.length;
  const score = Math.round((average / 5) * 100);
  const requiredKeys = ['english', 'communication', 'professionalism', 'punctuality'];
  const hasWeakRequired = requiredKeys.some((key) => {
    const numeric = RATING_SCORE[normalizeRecruitmentRating(evaluation[key])] || 0;
    return numeric > 0 && numeric < 3;
  });

  let label = 'Needs review';
  if (score >= 85) label = 'Excellent';
  else if (score >= 70) label = 'Very good';
  else if (score >= 55) label = 'Good';
  else if (score >= 35) label = 'Weak';

  let recommendation = 'review';
  if (hasWeakRequired || score < 40) recommendation = 'reject';
  else if (score >= 70) recommendation = 'accept';

  return { score, label, recommendation };
};

const includesAny = (values = [], patterns = []) => {
  const text = (Array.isArray(values) ? values : []).join(' ').toLowerCase();
  return patterns.some((pattern) => pattern.test(text));
};

const buildRecruitmentUpdate = (current = {}, payload = {}, actorId = null) => {
  const nextStatus = payload.pipelineStatus != null
    ? normalizeRecruitmentStatus(payload.pipelineStatus)
    : normalizeRecruitmentStatus(current.status || 'new');
  const nextEvaluation = {
    english: normalizeRecruitmentRating(payload?.evaluation?.english ?? current?.evaluation?.english),
    quran: normalizeRecruitmentRating(payload?.evaluation?.quran ?? current?.evaluation?.quran),
    arabic: normalizeRecruitmentRating(payload?.evaluation?.arabic ?? current?.evaluation?.arabic),
    islamicStudies: normalizeRecruitmentRating(payload?.evaluation?.islamicStudies ?? current?.evaluation?.islamicStudies),
    teachingDemo: normalizeRecruitmentRating(payload?.evaluation?.teachingDemo ?? current?.evaluation?.teachingDemo),
    communication: normalizeRecruitmentRating(payload?.evaluation?.communication ?? current?.evaluation?.communication),
    punctuality: normalizeRecruitmentRating(payload?.evaluation?.punctuality ?? current?.evaluation?.punctuality),
    professionalism: normalizeRecruitmentRating(payload?.evaluation?.professionalism ?? current?.evaluation?.professionalism),
    flexibility: normalizeRecruitmentRating(payload?.evaluation?.flexibility ?? current?.evaluation?.flexibility),
  };
  const overall = computeRecruitmentOverall(nextEvaluation);
  const reviewed = payload.reviewed == null ? true : Boolean(payload.reviewed);
  const previousStatus = normalizeRecruitmentStatus(current.status || 'new');
  const adminNotes = String(payload.adminNotes ?? current.adminNotes ?? '').trim();
  const noteForHistory = String(payload.historyNote || adminNotes || '').trim().slice(0, 1000);
  const history = Array.isArray(current.history) ? [...current.history] : [];
  const statusChanged = previousStatus !== nextStatus;

  history.push({
    at: new Date(),
    actor: actorId || current.reviewedBy || null,
    action: statusChanged ? 'status_changed' : 'review_updated',
    fromStatus: previousStatus,
    toStatus: nextStatus,
    note: noteForHistory,
  });

  return {
    status: nextStatus,
    reviewed,
    reviewedAt: reviewed ? new Date() : current.reviewedAt || null,
    reviewedBy: reviewed ? (actorId || current.reviewedBy || null) : current.reviewedBy || null,
    adminNotes,
    rejectionCategory: String(payload.rejectionCategory ?? current.rejectionCategory ?? '').trim(),
    tags: normalizeStringArray(payload.tags ?? current.tags),
    fit: {
      campaignId: payload?.fit?.campaignId ?? current?.fit?.campaignId ?? null,
      subjects: normalizeStringArray(payload?.fit?.subjects ?? current?.fit?.subjects),
      genderRequirement: String(payload?.fit?.genderRequirement ?? current?.fit?.genderRequirement ?? '').trim(),
      preferredWindow: String(payload?.fit?.preferredWindow ?? current?.fit?.preferredWindow ?? '').trim(),
      timezoneNotes: String(payload?.fit?.timezoneNotes ?? current?.fit?.timezoneNotes ?? '').trim(),
      requiredHoursPerDay: payload?.fit?.requiredHoursPerDay == null
        ? (current?.fit?.requiredHoursPerDay ?? null)
        : Number(payload.fit.requiredHoursPerDay) || null,
    },
    evaluation: nextEvaluation,
    overall,
    history: history.slice(-50),
  };
};

const normalizeCampaign = (doc, applicationCount = 0) => {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const now = Date.now();
  const opensAt = plain.opensAt ? new Date(plain.opensAt) : null;
  const closesAt = plain.closesAt ? new Date(plain.closesAt) : null;
  const isOpenWindow = (!opensAt || opensAt.getTime() <= now) && (!closesAt || closesAt.getTime() >= now);
  return {
    id: String(plain._id),
    title: plain.title || '',
    slug: plain.slug || '',
    status: plain.status || 'draft',
    opensAt: plain.opensAt || null,
    closesAt: plain.closesAt || null,
    targetApplicants: plain.targetApplicants || 0,
    targetHires: plain.targetHires || 0,
    roles: plain.roles || { male: false, female: false },
    subjects: Array.isArray(plain.subjects) ? plain.subjects : [],
    preferredWindow: plain.preferredWindow || '',
    publicHeadline: plain.publicHeadline || '',
    publicDescription: plain.publicDescription || '',
    internalNotes: plain.internalNotes || '',
    reopenLimit: plain.reopenLimit || 0,
    applicationCount,
    isOpenWindow,
  };
};

const buildCampaignPayload = (payload = {}, actorId = null) => {
  const title = String(payload.title || '').trim();
  const slug = slugifyCampaign(payload.slug || payload.title || '');
  return {
    title,
    slug,
    status: ['draft', 'open', 'closed', 'archived'].includes(String(payload.status || '').trim().toLowerCase())
      ? String(payload.status || '').trim().toLowerCase()
      : 'draft',
    opensAt: payload.opensAt ? new Date(payload.opensAt) : null,
    closesAt: payload.closesAt ? new Date(payload.closesAt) : null,
    targetApplicants: Math.max(0, Number(payload.targetApplicants || 0) || 0),
    targetHires: Math.max(0, Number(payload.targetHires || 0) || 0),
    roles: {
      male: Boolean(payload?.roles?.male),
      female: Boolean(payload?.roles?.female),
    },
    subjects: normalizeStringArray(payload.subjects),
    preferredWindow: String(payload.preferredWindow || '').trim(),
    publicHeadline: String(payload.publicHeadline || '').trim(),
    publicDescription: String(payload.publicDescription || '').trim(),
    internalNotes: String(payload.internalNotes || '').trim(),
    reopenLimit: Math.max(0, Number(payload.reopenLimit || 0) || 0),
    updatedBy: actorId || null,
  };
};

const resolveResponseModel = (source) => {
  if (source === 'public') return TeacherContractLead;
  if (source === 'dashboard') return TeacherContractSubmission;
  return null;
};

router.get('/template', async (req, res) => {
  try {
    const value = await getContractTemplateValue();
    return res.json({ template: value });
  } catch (error) {
    console.error('Get teacher contract template error:', error);
    return res.status(500).json({ message: 'Failed to load contract template.' });
  }
});

router.get('/campaigns/public', async (req, res) => {
  try {
    const campaigns = await RecruitmentCampaign.find({ status: 'open' }).sort({ opensAt: -1, createdAt: -1 }).lean();
    return res.json({ campaigns: campaigns.map((item) => normalizeCampaign(item, 0)) });
  } catch (error) {
    console.error('List public recruitment campaigns error:', error);
    return res.status(500).json({ message: 'Failed to load recruitment campaigns.' });
  }
});

router.get('/campaigns', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const campaigns = await RecruitmentCampaign.find({}).sort({ createdAt: -1 }).lean();
    const campaignIds = campaigns.map((item) => item._id);
    const [publicCounts, dashboardCounts] = await Promise.all([
      TeacherContractLead.aggregate([
        { $match: { 'recruitment.fit.campaignId': { $in: campaignIds } } },
        { $group: { _id: '$recruitment.fit.campaignId', count: { $sum: 1 } } },
      ]),
      TeacherContractSubmission.aggregate([
        { $match: { 'recruitment.fit.campaignId': { $in: campaignIds }, status: 'submitted' } },
        { $group: { _id: '$recruitment.fit.campaignId', count: { $sum: 1 } } },
      ]),
    ]);
    const counts = new Map();
    [...publicCounts, ...dashboardCounts].forEach((row) => {
      const key = String(row._id || '');
      counts.set(key, (counts.get(key) || 0) + Number(row.count || 0));
    });
    return res.json({ campaigns: campaigns.map((item) => normalizeCampaign(item, counts.get(String(item._id)) || 0)) });
  } catch (error) {
    console.error('List recruitment campaigns error:', error);
    return res.status(500).json({ message: 'Failed to load recruitment campaigns.' });
  }
});

router.post('/campaigns', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payload = buildCampaignPayload(req.body || {}, req.user?._id || null);
    if (!payload.title || !payload.slug) {
      return res.status(400).json({ message: 'Campaign title is required.' });
    }
    const campaign = await RecruitmentCampaign.create({
      ...payload,
      createdBy: req.user?._id || null,
    });
    return res.status(201).json({ campaign: normalizeCampaign(campaign, 0) });
  } catch (error) {
    console.error('Create recruitment campaign error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Campaign slug already exists.' });
    }
    return res.status(500).json({ message: 'Failed to create recruitment campaign.' });
  }
});

router.put('/campaigns/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const payload = buildCampaignPayload(req.body || {}, req.user?._id || null);
    if (!payload.title || !payload.slug) {
      return res.status(400).json({ message: 'Campaign title is required.' });
    }
    const campaign = await RecruitmentCampaign.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true, runValidators: true });
    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }
    const [publicCount, dashboardCount] = await Promise.all([
      TeacherContractLead.countDocuments({ 'recruitment.fit.campaignId': campaign._id }),
      TeacherContractSubmission.countDocuments({ status: 'submitted', 'recruitment.fit.campaignId': campaign._id }),
    ]);
    return res.json({ campaign: normalizeCampaign(campaign, publicCount + dashboardCount) });
  } catch (error) {
    console.error('Update recruitment campaign error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Campaign slug already exists.' });
    }
    return res.status(500).json({ message: 'Failed to update recruitment campaign.' });
  }
});

router.put('/template', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const value = String(req.body?.template || '').trim();
    if (!value) {
      return res.status(400).json({ message: 'Template text is required.' });
    }
    const setting = await Setting.findOneAndUpdate(
      { key: CONTRACT_TEMPLATE_KEY },
      { value, description: 'Teacher contract text shown in public and dashboard forms' },
      { upsert: true, new: true }
    );
    return res.json({ message: 'Contract text saved.', template: String(setting.value || '') });
  } catch (error) {
    console.error('Update teacher contract template error:', error);
    return res.status(500).json({ message: 'Failed to save contract template.' });
  }
});

router.get('/responses', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [publicLeads, dashboardSubmissions] = await Promise.all([
      TeacherContractLead.find({})
        .populate('recruitment.reviewedBy', 'firstName lastName email')
        .sort({ submittedAt: -1, createdAt: -1 })
        .lean(),
      TeacherContractSubmission.find({ status: 'submitted' })
        .populate('user', 'firstName lastName email phone')
        .populate('recruitment.reviewedBy', 'firstName lastName email')
        .sort({ submittedAt: -1, createdAt: -1 })
        .lean(),
    ]);

    const responses = [
      ...(publicLeads || []).map((item) => normalizeTeacherResponse('public', item)).filter(Boolean),
      ...(dashboardSubmissions || []).map((item) => normalizeTeacherResponse('dashboard', item)).filter(Boolean),
    ].sort((a, b) => new Date(b.submittedAt || b.createdAt || 0).getTime() - new Date(a.submittedAt || a.createdAt || 0).getTime());

    return res.json({ responses });
  } catch (error) {
    console.error('List teacher contract responses error:', error);
    return res.status(500).json({ message: 'Failed to load teacher responses.' });
  }
});

router.get('/responses-summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const awaitingInterviewFilter = {
      'recruitment.interview.scheduledAt': { $ne: null },
      'recruitment.interview.outcome': 'pending',
    };
    const [publicTotal, dashboardTotal, publicUnread, dashboardUnread, publicAwaiting, dashboardAwaiting] = await Promise.all([
      TeacherContractLead.countDocuments({}),
      TeacherContractSubmission.countDocuments({ status: 'submitted' }),
      TeacherContractLead.countDocuments({ 'recruitment.reviewed': { $ne: true } }),
      TeacherContractSubmission.countDocuments({ status: 'submitted', 'recruitment.reviewed': { $ne: true } }),
      TeacherContractLead.countDocuments(awaitingInterviewFilter),
      TeacherContractSubmission.countDocuments({ status: 'submitted', ...awaitingInterviewFilter }),
    ]);

    const unreviewed = publicUnread + dashboardUnread;
    const interviewsAwaitingOutcome = publicAwaiting + dashboardAwaiting;

    return res.json({
      success: true,
      total: publicTotal + dashboardTotal,
      unreviewed,
      interviewsAwaitingOutcome,
      // Single consolidated recruitment counter for the sidebar badge.
      badge: unreviewed + interviewsAwaitingOutcome,
      publicTotal,
      dashboardTotal,
    });
  } catch (error) {
    console.error('Teacher contract response summary error:', error);
    return res.status(500).json({ message: 'Failed to load teacher response summary.' });
  }
});

router.get('/operations-summary', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const next14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const teacherDocs = await User.find({ role: 'teacher', isActive: true })
      .select('firstName lastName gender timezone teacherInfo createdAt')
      .lean();

    const teacherIds = teacherDocs.map((teacher) => teacher._id).filter(Boolean);

    const [publicRows, dashboardRows, upcomingAgg] = await Promise.all([
      TeacherContractLead.find({}).select('recruitment').lean(),
      TeacherContractSubmission.find({ status: 'submitted' }).select('recruitment').lean(),
      teacherIds.length
        ? Class.aggregate([
            {
              $match: {
                teacher: { $in: teacherIds },
                hidden: { $ne: true },
                status: { $in: ['scheduled', 'in_progress', 'attended'] },
                scheduledDate: { $gte: now, $lt: next14Days },
              },
            },
            {
              $group: {
                _id: '$teacher',
                hours: { $sum: { $divide: ['$duration', 60] } },
                classes: { $sum: 1 },
                students: { $addToSet: '$student.studentId' },
              },
            },
          ])
        : [],
    ]);

    const pipelineRows = [...publicRows, ...dashboardRows];
    const pipeline = {
      total: pipelineRows.length,
      unreviewed: pipelineRows.filter((row) => row?.recruitment?.reviewed !== true).length,
      byStatus: RECRUITMENT_STATUSES.reduce((acc, status) => {
        acc[status] = pipelineRows.filter((row) => normalizeRecruitmentStatus(row?.recruitment?.status) === status).length;
        return acc;
      }, {}),
    };

    const upcomingByTeacher = new Map(
      (upcomingAgg || []).map((row) => [
        String(row._id),
        {
          upcomingHours: Number(row.hours || 0),
          upcomingClasses: Number(row.classes || 0),
          studentCount: Array.isArray(row.students) ? row.students.length : 0,
        },
      ])
    );

    const teacherRows = teacherDocs.map((teacher) => {
      const teacherInfo = teacher.teacherInfo || {};
      const qualifications = Array.isArray(teacherInfo.qualifications) ? teacherInfo.qualifications : [];
      const subjects = Array.isArray(teacherInfo.subjects) ? teacherInfo.subjects.filter(Boolean) : [];
      const standardizedSubjects = standardizeSubjects(subjects);
      const upcoming = upcomingByTeacher.get(String(teacher._id)) || { upcomingHours: 0, upcomingClasses: 0, studentCount: 0 };
      // Tenure anchors on the admin-set joining date when available, otherwise
      // falls back to the account creation date.
      const joiningDate = teacherInfo.joiningDate ? new Date(teacherInfo.joiningDate) : null;
      const tenureStart = joiningDate || (teacher.createdAt ? new Date(teacher.createdAt) : null);
      const tenureMonths = tenureStart ? Math.max(0, Math.round((now.getTime() - tenureStart.getTime()) / (30.44 * 24 * 60 * 60 * 1000))) : null;
      let tenureLabel = 'Unknown';
      if (tenureMonths != null) {
        const years = Math.floor(tenureMonths / 12);
        const months = tenureMonths % 12;
        if (years > 0) tenureLabel = months > 0 ? `${years}y ${months}m` : `${years}y`;
        else if (months > 0) tenureLabel = `${months}m`;
        else tenureLabel = 'New';
      }
      return {
        id: String(teacher._id),
        name: `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim() || 'Teacher',
        gender: teacher.gender || '',
        timezone: teacher.timezone || 'Africa/Cairo',
        subjects,
        standardizedSubjects,
        spokenLanguages: Array.isArray(teacherInfo.spokenLanguages) ? teacherInfo.spokenLanguages.filter(Boolean) : [],
        monthlyHours: Number(teacherInfo.monthlyHours || 0),
        hourlyRate: Number(teacherInfo.hourlyRate || 0),
        availabilityStatus: teacherInfo.availabilityStatus || 'default_24_7',
        acceptingNewStudents: teacherInfo.acceptingNewStudents !== false,
        lifecycleStage: teacherInfo.lifecycle?.stage || 'active',
        hasGoogleMeetLink: Boolean(teacherInfo.googleMeetLink),
        qualificationText: qualifications.map((item) => `${item?.degree || ''} ${item?.institution || ''}`.trim()).filter(Boolean),
        upcomingHours14Days: Number(upcoming.upcomingHours || 0),
        upcomingClasses14Days: Number(upcoming.upcomingClasses || 0),
        studentCount14Days: Number(upcoming.studentCount || 0),
        joiningDate: joiningDate ? joiningDate.toISOString() : null,
        tenureStart: tenureStart ? tenureStart.toISOString() : null,
        tenureMonths,
        tenureLabel,
      };
    });

    const totalMonthlyHours = teacherRows.reduce((sum, teacher) => sum + (teacher.monthlyHours || 0), 0);
    const totalUpcomingHours14Days = teacherRows.reduce((sum, teacher) => sum + (teacher.upcomingHours14Days || 0), 0);
    const distinctStudents14Days = teacherRows.reduce((sum, teacher) => sum + (teacher.studentCount14Days || 0), 0);
    const singleSubjectCount = teacherRows.filter((teacher) => teacher.subjects.length <= 1).length;
    const multiSubjectCount = teacherRows.filter((teacher) => teacher.subjects.length > 1).length;
    const hasStd = (teacher, subject) => teacher.standardizedSubjects.includes(subject);
    const quranCount = teacherRows.filter((teacher) => hasStd(teacher, 'Quran (Memorization)') || hasStd(teacher, 'Quran (Recitation/Tajweed)')).length;
    const arabicCount = teacherRows.filter((teacher) => hasStd(teacher, 'Arabic Language') || hasStd(teacher, 'Reading Basics')).length;
    const islamicStudiesCount = teacherRows.filter((teacher) => hasStd(teacher, 'Islamic Studies')).length;
    const subjectBreakdown = STANDARD_SUBJECTS.reduce((acc, subject) => {
      acc[subject] = teacherRows.filter((teacher) => hasStd(teacher, subject)).length;
      return acc;
    }, {});
    const acceptingNewStudentsCount = teacherRows.filter((teacher) => teacher.acceptingNewStudents).length;
    const notAcceptingNewStudentsCount = teacherRows.length - acceptingNewStudentsCount;
    const englishSpeakingCount = teacherRows.filter((teacher) => includesAny(teacher.spokenLanguages, [/english/i])).length;
    const azharCount = teacherRows.filter((teacher) => includesAny(teacher.qualificationText, [/azhar/i])).length;
    const ijazahCount = teacherRows.filter((teacher) => includesAny(teacher.qualificationText, [/ijaz/i])).length;
    const femaleCount = teacherRows.filter((teacher) => String(teacher.gender).toLowerCase() === 'female').length;
    const maleCount = teacherRows.filter((teacher) => String(teacher.gender).toLowerCase() === 'male').length;

    // ─── Capacity decision engine ─────────────────────────────────────────────
    const capacityConfig = await getCapacityConfig();
    const capacityHours = teacherRows.length * capacityConfig.targetHoursPerTeacherPerDay * capacityConfig.horizonDays;
    const bookedHours = totalUpcomingHours14Days;
    const occupancyPct = capacityHours > 0 ? Math.round((bookedHours / capacityHours) * 100) : 0;

    let decision = 'ok';
    if (occupancyPct >= capacityConfig.urgentThresholdPct) decision = 'urgent';
    else if (occupancyPct >= capacityConfig.hireThresholdPct) decision = 'hire';

    const shortages = [];
    if (femaleCount < capacityConfig.minFemaleTeachers) shortages.push({ type: 'gender', label: `Female teachers below target (${femaleCount}/${capacityConfig.minFemaleTeachers})` });
    if (maleCount < capacityConfig.minMaleTeachers) shortages.push({ type: 'gender', label: `Male teachers below target (${maleCount}/${capacityConfig.minMaleTeachers})` });
    if (quranCount === 0) shortages.push({ type: 'subject', label: 'No Quran/Tajweed teachers configured' });
    if (arabicCount === 0) shortages.push({ type: 'subject', label: 'No Arabic teachers configured' });
    if (islamicStudiesCount === 0) shortages.push({ type: 'subject', label: 'No Islamic Studies teachers configured' });

    const capacity = {
      config: capacityConfig,
      capacityHours: +capacityHours.toFixed(1),
      bookedHours: +bookedHours.toFixed(1),
      occupancyPct,
      decision, // ok | hire | urgent
      recommendedAction: decision === 'urgent'
        ? 'Open urgent hiring — capacity is nearly full.'
        : decision === 'hire'
          ? 'Start hiring — capacity is filling up.'
          : 'Capacity is healthy. Keep the pipeline warm.',
      shortages,
      femaleCount,
      maleCount,
    };

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      pipeline,
      capacity,
      teachers: {
        activeCount: teacherRows.length,
        femaleCount,
        maleCount,
        totalMonthlyHours: +totalMonthlyHours.toFixed(2),
        averageMonthlyHours: teacherRows.length ? +(totalMonthlyHours / teacherRows.length).toFixed(2) : 0,
        totalUpcomingHours14Days: +totalUpcomingHours14Days.toFixed(2),
        distinctStudents14Days,
        withUpcomingClasses: teacherRows.filter((teacher) => teacher.upcomingClasses14Days > 0).length,
        withoutUpcomingClasses: teacherRows.filter((teacher) => teacher.upcomingClasses14Days === 0).length,
        withCustomAvailability: teacherRows.filter((teacher) => teacher.availabilityStatus === 'custom_set').length,
        pendingAvailability: teacherRows.filter((teacher) => teacher.availabilityStatus === 'pending_setup').length,
        defaultAvailability: teacherRows.filter((teacher) => teacher.availabilityStatus === 'default_24_7').length,
        singleSubjectCount,
        multiSubjectCount,
        quranCount,
        arabicCount,
        islamicStudiesCount,
        subjectBreakdown,
        acceptingNewStudentsCount,
        notAcceptingNewStudentsCount,
        englishSpeakingCount,
        azharCount,
        ijazahCount,
        googleMeetLinkCount: teacherRows.filter((teacher) => teacher.hasGoogleMeetLink).length,
      },
      teacherRows: teacherRows
        .sort((a, b) => (b.upcomingHours14Days || 0) - (a.upcomingHours14Days || 0) || (b.monthlyHours || 0) - (a.monthlyHours || 0)),
      dataCompleteness: {
        reserveAvailabilityTracked: false,
        backupTeacherCoverageTracked: false,
        note: 'Live teacher reserve hours and backup coverage are not stored yet, so this summary focuses on current pipeline, qualifications, configured availability status, and scheduled class load.',
      },
    });
  } catch (error) {
    console.error('Teacher operations summary error:', error);
    return res.status(500).json({ message: 'Failed to load teacher operations summary.' });
  }
});

router.patch('/responses/:source/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const source = String(req.params.source || '').trim().toLowerCase();
    const Model = resolveResponseModel(source);
    if (!Model) {
      return res.status(400).json({ message: 'Unsupported response source.' });
    }

    const doc = await Model.findById(req.params.id)
      .populate('user', 'firstName lastName email phone')
      .populate('recruitment.reviewedBy', 'firstName lastName email');

    if (!doc) {
      return res.status(404).json({ message: 'Teacher response not found.' });
    }

    doc.recruitment = buildRecruitmentUpdate(doc.recruitment || {}, req.body || {}, req.user?._id || null);
    await doc.save();
    await doc.populate('recruitment.reviewedBy', 'firstName lastName email');

    return res.json({
      message: 'Teacher response updated.',
      response: normalizeTeacherResponse(source, doc),
    });
  } catch (error) {
    console.error('Update teacher contract response error:', error);
    return res.status(500).json({ message: 'Failed to update teacher response.' });
  }
});

// Save an interview scorecard + outcome for a candidate
router.patch('/responses/:source/:id/interview', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const source = String(req.params.source || '').trim().toLowerCase();
    const Model = resolveResponseModel(source);
    if (!Model) return res.status(400).json({ message: 'Unsupported response source.' });

    const doc = await Model.findById(req.params.id)
      .populate('user', 'firstName lastName email phone')
      .populate('recruitment.reviewedBy', 'firstName lastName email');
    if (!doc) return res.status(404).json({ message: 'Teacher response not found.' });

    const body = req.body || {};
    const recruitment = doc.recruitment || {};
    const interview = recruitment.interview || {};

    const clampScore = (v) => {
      if (v == null || v === '') return null;
      const n = Number(v);
      if (Number.isNaN(n)) return null;
      return Math.max(0, Math.min(10, Math.round(n)));
    };

    if (body.scheduledAt != null) interview.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (body.completedAt != null) interview.completedAt = body.completedAt ? new Date(body.completedAt) : null;
    if (body.worksElsewhere != null) interview.worksElsewhere = Boolean(body.worksElsewhere);
    if (body.notes != null) interview.notes = String(body.notes || '').trim().slice(0, 2000);

    if (body.scores && typeof body.scores === 'object') {
      interview.scores = interview.scores || {};
      ['punctuality', 'english', 'subjectKnowledge', 'teaching', 'flexibility', 'professionalism'].forEach((key) => {
        if (body.scores[key] !== undefined) interview.scores[key] = clampScore(body.scores[key]);
      });
    }

    const validOutcomes = ['pending', 'passed', 'passed_not_selected', 'completed_unsuitable', 'failed'];
    if (body.outcome != null && validOutcomes.includes(body.outcome)) {
      interview.outcome = body.outcome;
    }

    recruitment.interview = interview;
    recruitment.history = Array.isArray(recruitment.history) ? recruitment.history : [];
    recruitment.history.push({
      at: new Date(),
      actor: req.user?._id || null,
      action: 'interview_updated',
      note: interview.outcome && interview.outcome !== 'pending' ? `Interview outcome: ${interview.outcome}` : 'Interview scorecard updated',
    });

    doc.recruitment = recruitment;
    doc.markModified('recruitment');
    await doc.save();
    await doc.populate('recruitment.reviewedBy', 'firstName lastName email');

    return res.json({
      message: 'Interview scorecard saved.',
      response: normalizeTeacherResponse(source, doc),
    });
  } catch (error) {
    console.error('Update interview scorecard error:', error);
    return res.status(500).json({ message: 'Failed to save interview scorecard.' });
  }
});

// Generate (or refresh) the public contract-acceptance link for a candidate.
// Sent to candidates after they pass the interview so they can review + accept
// the contract terms without needing a dashboard account.
router.post('/responses/:source/:id/contract-link', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const source = String(req.params.source || '').trim().toLowerCase();
    const Model = resolveResponseModel(source);
    if (!Model) return res.status(400).json({ message: 'Unsupported response source.' });

    const doc = await Model.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Teacher response not found.' });

    const recruitment = doc.recruitment || {};
    const contract = recruitment.contract || {};
    if (!contract.token) contract.token = crypto.randomBytes(24).toString('hex');
    contract.sentAt = new Date();
    recruitment.contract = contract;
    doc.recruitment = recruitment;
    doc.markModified('recruitment');
    await doc.save();

    return res.json({
      message: 'Contract link ready.',
      token: contract.token,
      sentAt: contract.sentAt,
      acceptedAt: contract.acceptedAt || null,
      acceptedName: contract.acceptedName || '',
    });
  } catch (error) {
    console.error('Generate contract link error:', error);
    return res.status(500).json({ message: 'Failed to generate contract link.' });
  }
});

const findByContractToken = async (token) => {
  const clean = String(token || '').trim();
  if (!clean) return null;
  for (const [source, Model] of [['public', TeacherContractLead], ['dashboard', TeacherContractSubmission]]) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await Model.findOne({ 'recruitment.contract.token': clean }).populate('user', 'firstName lastName email');
    if (doc) return { source, Model, doc };
  }
  return null;
};

// Public: fetch the contract text + acceptance status for a token.
router.get('/agreement/:token', async (req, res) => {
  try {
    const found = await findByContractToken(req.params.token);
    if (!found) return res.status(404).json({ message: 'This contract link is invalid or has expired.' });
    const { doc } = found;
    const personalInfo = doc.personalInfo || {};
    const name = String(personalInfo.fullName || `${doc.user?.firstName || ''} ${doc.user?.lastName || ''}`.trim() || '');
    const template = await getContractTemplateValue();
    const contract = doc.recruitment?.contract || {};
    return res.json({
      name,
      contractText: template,
      acceptedAt: contract.acceptedAt || null,
      acceptedName: contract.acceptedName || '',
    });
  } catch (error) {
    console.error('Get public teacher agreement error:', error);
    return res.status(500).json({ message: 'Failed to load the contract.' });
  }
});

// Public: record the candidate's acceptance of the contract.
router.post('/agreement/:token/accept', async (req, res) => {
  try {
    const found = await findByContractToken(req.params.token);
    if (!found) return res.status(404).json({ message: 'This contract link is invalid or has expired.' });
    const { doc } = found;
    const recruitment = doc.recruitment || {};
    const contract = recruitment.contract || {};
    if (contract.acceptedAt) {
      return res.json({
        message: 'This contract was already accepted.',
        acceptedAt: contract.acceptedAt,
        acceptedName: contract.acceptedName || '',
      });
    }
    const fullName = String(req.body?.fullName || '').trim().slice(0, 200);
    if (!fullName) return res.status(400).json({ message: 'Please write your full legal name to accept.' });

    contract.acceptedAt = new Date();
    contract.acceptedName = fullName;
    contract.acceptedIp = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 60);
    recruitment.contract = contract;
    doc.recruitment = recruitment;
    doc.markModified('recruitment');
    await doc.save();

    return res.json({
      message: 'Thank you. Your acceptance has been recorded.',
      acceptedAt: contract.acceptedAt,
      acceptedName: contract.acceptedName,
    });
  } catch (error) {
    console.error('Accept public teacher agreement error:', error);
    return res.status(500).json({ message: 'Failed to record your acceptance.' });
  }
});

router.post('/public', fileFields, async (req, res) => {
  try {
    const contractAccepted = String(req.body.contractAccepted || '') === 'true';
    const contractFullName = String(req.body.contractFullName || '').trim();
    const introEssay = String(req.body.introEssay || '').trim();
    const personalInfo = {
      fullName: String(req.body.fullName || '').trim(),
      email: String(req.body.email || '').trim().toLowerCase(),
      birthDate: req.body.birthDate ? new Date(req.body.birthDate) : null,
      mobileNumber: String(req.body.mobileNumber || '').trim(),
      whatsappNumber: String(req.body.whatsappNumber || '').trim(),
      meetingLink: resolveMeetingLink(req.body),
      skypeId: '',
      address: {
        street: String(req.body.street || '').trim(),
        city: String(req.body.city || '').trim(),
        country: String(req.body.country || '').trim() || 'Egypt',
      },
      gender: String(req.body.gender || '').trim(),
      nationality: String(req.body.nationality || '').trim(),
      occupation: String(req.body.occupation || '').trim(),
      epithet: String(req.body.epithet || '').trim(),
    };
    const files = req.files || {};
    const campaignId = String(req.body.campaignId || req.query.campaignId || '').trim();
    const campaignSlug = String(req.body.campaignSlug || req.query.campaign || '').trim().toLowerCase();
    let campaign = null;

    if (campaignId) {
      campaign = await RecruitmentCampaign.findById(campaignId).lean();
    } else if (campaignSlug) {
      campaign = await RecruitmentCampaign.findOne({ slug: campaignSlug }).lean();
    }

    const application = buildApplicationPayload(req.body, files);

    if (!contractAccepted || !contractFullName) {
      return res.status(400).json({ message: 'Please accept the contract and write the full name.' });
    }
    if (!personalInfo.fullName || !personalInfo.email || !personalInfo.birthDate || !personalInfo.mobileNumber || !personalInfo.gender || !personalInfo.nationality) {
      return res.status(400).json({ message: 'Please complete the required personal information.' });
    }
    if (!application.positionsInterested.length) {
      return res.status(400).json({ message: 'Please select at least one position of interest.' });
    }
    if (!application.education.eligibilityPath || !application.education.graduationStatus || !application.education.facultyUniversity || !application.education.degree) {
      return res.status(400).json({ message: 'Please complete the required education information.' });
    }
    if (!application.experience.teachingExperienceLevel || !application.experience.currentJob) {
      return res.status(400).json({ message: 'Please complete the experience section.' });
    }
    if (!application.technicalSkills.classTools || !application.technicalSkills.meetingApps.length || !application.technicalSkills.officeProducts.length) {
      return res.status(400).json({ message: 'Please complete the technical skills section.' });
    }
    if (!application.teachingProfile.subjectsCanTeach.length || !application.teachingProfile.preferredAvailability) {
      return res.status(400).json({ message: 'Please complete the teaching profile section.' });
    }
    if (!files.identityDocument?.[0]) {
      return res.status(400).json({ message: 'Identity document is required.' });
    }
    if (!files.educationDocuments?.[0]) {
      return res.status(400).json({ message: 'Educational documents are required.' });
    }
    if (!files.resume?.[0]) {
      return res.status(400).json({ message: 'Resume or cover letter is required.' });
    }
    if (!files.englishIntroduction?.[0] || !files.quranRecitation?.[0] || !files.teachingTopicExplanation?.[0]) {
      return res.status(400).json({ message: 'Please upload the required introduction, Quran recitation, and teaching explanation records.' });
    }

    const identityDocument = await uploadAsset(files.identityDocument[0], `waraqa/public-teacher-contracts/${Date.now()}/identity`);
    const educationDocuments = await uploadAsset(files.educationDocuments[0], `waraqa/public-teacher-contracts/${Date.now()}/education`);
    const profilePhoto = files.profilePhoto?.[0]
      ? await uploadAsset(files.profilePhoto[0], `waraqa/public-teacher-contracts/${Date.now()}/profile`)
      : {};
    const resume = await uploadAsset(files.resume[0], `waraqa/public-teacher-contracts/${Date.now()}/resume`);
    const englishIntroduction = await uploadAsset(files.englishIntroduction[0], `waraqa/public-teacher-contracts/${Date.now()}/english-introduction`);
    const quranRecitation = await uploadAsset(files.quranRecitation[0], `waraqa/public-teacher-contracts/${Date.now()}/quran-recitation`);
    const teachingTopicExplanation = await uploadAsset(files.teachingTopicExplanation[0], `waraqa/public-teacher-contracts/${Date.now()}/teaching-topic`);

    const lead = await TeacherContractLead.create({
      contract: {
        accepted: contractAccepted,
        fullName: contractFullName,
        agreedAt: new Date(),
      },
      verification: {
        identityDocument: identityDocument || {},
        educationDocuments: educationDocuments || {},
        profilePhoto: profilePhoto || {},
        introEssay,
      },
      application: {
        ...application,
        files: {
          resume: resume || {},
          englishIntroduction: englishIntroduction || {},
          quranRecitation: quranRecitation || {},
          teachingTopicExplanation: teachingTopicExplanation || {},
        },
      },
      recruitment: campaign ? {
        fit: { campaignId: campaign._id },
      } : undefined,
      personalInfo,
      submittedMeta: {
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
      },
      submittedAt: new Date(),
    });

    const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
    await Promise.allSettled((admins || []).map((admin) => notificationService.createNotification({
      userId: admin._id,
      title: 'New teacher contract',
      message: `${personalInfo.fullName || contractFullName} submitted a public teacher contract form.`,
      type: 'info',
      relatedTo: 'system',
      actionRequired: true,
      actionLink: '/dashboard/availability?section=teachers',
      metadata: { teacherContractLeadId: String(lead._id) },
    })));

    return res.status(201).json({
      message: 'Teacher contract submitted successfully.',
      leadId: lead._id,
      campaignId: campaign?._id || null,
    });
  } catch (error) {
    console.error('Public teacher contract submission error:', error);
    return res.status(500).json({ message: 'Failed to submit teacher contract form.' });
  }
});

router.get('/me', authenticateToken, requireTeacherOrAdmin, async (req, res) => {
  try {
    const submission = await TeacherContractSubmission.findOne({ user: req.user._id }).lean();
    return res.json(buildResponse(submission));
  } catch (error) {
    console.error('Get teacher contract submission error:', error);
    return res.status(500).json({ message: 'Failed to load teacher contract form.' });
  }
});

router.post('/me', authenticateToken, requireTeacherOrAdmin, fileFields, async (req, res) => {
  try {
    const status = String(req.body.status || 'submitted').toLowerCase() === 'draft' ? 'draft' : 'submitted';
    const contractAccepted = String(req.body.contractAccepted || '') === 'true';
    const contractFullName = String(req.body.contractFullName || '').trim();
    const introEssay = String(req.body.introEssay || '').trim();
    const personalInfo = {
      fullName: String(req.body.fullName || '').trim(),
      email: String(req.body.email || '').trim().toLowerCase(),
      birthDate: req.body.birthDate ? new Date(req.body.birthDate) : null,
      mobileNumber: String(req.body.mobileNumber || '').trim(),
      whatsappNumber: String(req.body.whatsappNumber || '').trim(),
      meetingLink: resolveMeetingLink(req.body),
      skypeId: '',
      address: {
        street: String(req.body.street || '').trim(),
        city: String(req.body.city || '').trim(),
        country: String(req.body.country || '').trim() || 'Egypt',
      },
      gender: String(req.body.gender || '').trim(),
      nationality: String(req.body.nationality || '').trim(),
      occupation: String(req.body.occupation || '').trim(),
      epithet: String(req.body.epithet || '').trim(),
    };

    const wordCount = introEssay ? introEssay.split(/\s+/).filter(Boolean).length : 0;
    const files = req.files || {};
    const existing = await TeacherContractSubmission.findOne({ user: req.user._id });

    if (status === 'submitted') {
      if (!contractAccepted || !contractFullName) {
        return res.status(400).json({ message: 'Please accept the contract and write the full name.' });
      }
      if (!introEssay || wordCount > 200) {
        return res.status(400).json({ message: 'Please add a short English introduction up to 200 words.' });
      }
      if (!personalInfo.fullName || !personalInfo.email || !personalInfo.birthDate || !personalInfo.mobileNumber || !personalInfo.gender || !personalInfo.nationality) {
        return res.status(400).json({ message: 'Please complete the required personal information.' });
      }
      if (!(files.identityDocument?.[0] || existing?.verification?.identityDocument?.url)) {
        return res.status(400).json({ message: 'Identity document is required.' });
      }
      if (!(files.educationDocuments?.[0] || existing?.verification?.educationDocuments?.url)) {
        return res.status(400).json({ message: 'Educational documents are required.' });
      }
    }

    const submission = existing || new TeacherContractSubmission({ user: req.user._id });

    const identityDocument = files.identityDocument?.[0]
      ? await uploadAsset(files.identityDocument[0], `waraqa/teacher-contracts/${req.user._id}/identity`)
      : submission.verification?.identityDocument;
    const educationDocuments = files.educationDocuments?.[0]
      ? await uploadAsset(files.educationDocuments[0], `waraqa/teacher-contracts/${req.user._id}/education`)
      : submission.verification?.educationDocuments;
    const profilePhoto = files.profilePhoto?.[0]
      ? await uploadAsset(files.profilePhoto[0], `waraqa/teacher-contracts/${req.user._id}/profile`)
      : submission.verification?.profilePhoto;

    submission.status = status;
    submission.contract = {
      accepted: contractAccepted,
      fullName: contractFullName,
      agreedAt: contractAccepted ? (submission.contract?.agreedAt || new Date()) : null,
    };
    submission.verification = {
      identityDocument: identityDocument || {},
      educationDocuments: educationDocuments || {},
      profilePhoto: profilePhoto || {},
      introEssay,
    };
    submission.personalInfo = personalInfo;
    submission.lastSavedAt = new Date();
    submission.submittedAt = status === 'submitted' ? new Date() : submission.submittedAt;
    await submission.save();

    try {
      const user = await User.findById(req.user._id);
      if (user) {
        const parsedName = splitName(personalInfo.fullName || contractFullName || user.fullName || '');
        user.firstName = parsedName.firstName;
        user.lastName = parsedName.lastName;
        if (personalInfo.email) user.email = personalInfo.email;
        if (personalInfo.mobileNumber) user.phone = personalInfo.mobileNumber;
        if (personalInfo.birthDate && !Number.isNaN(new Date(personalInfo.birthDate).getTime())) {
          user.dateOfBirth = new Date(personalInfo.birthDate);
        }
        if (personalInfo.gender === 'male' || personalInfo.gender === 'female') {
          user.gender = personalInfo.gender;
        }
        user.address = {
          ...(user.address || {}),
          street: personalInfo.address?.street || '',
          city: personalInfo.address?.city || '',
          country: personalInfo.address?.country || 'Egypt',
        };
        if (personalInfo.epithet) {
          user.teacherInfo = { ...(user.teacherInfo || {}), epithet: personalInfo.epithet };
        }
        await user.save();
      }
    } catch (syncError) {
      console.warn('Teacher contract user sync warning:', syncError.message || syncError);
    }

    if (status === 'submitted') {
      const admins = await User.find({ role: 'admin', isActive: true }).select('_id');
      await Promise.allSettled((admins || []).map((admin) => notificationService.createNotification({
        userId: admin._id,
        title: 'Teacher contract submitted',
        message: `${personalInfo.fullName || contractFullName || 'Teacher'} completed the contract form.`,
        type: 'info',
        relatedTo: 'system',
        actionRequired: false,
        actionLink: '/dashboard/availability?section=teachers',
      })));
    }

    return res.json({
      message: status === 'draft' ? 'Draft saved.' : 'Teacher contract submitted successfully.',
      ...buildResponse(submission.toObject()),
    });
  } catch (error) {
    console.error('Save teacher contract submission error:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'This email address is already in use.' });
    }
    return res.status(500).json({ message: 'Failed to save teacher contract form.' });
  }
});

// ─── Convert candidate to teacher account ────────────────────────────────────
router.post('/responses/:source/:id/convert-to-teacher', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { source, id } = req.params;
    const Model = resolveResponseModel(source);
    if (!Model) return res.status(400).json({ message: 'Invalid source.' });

    const candidate = await Model.findById(id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });

    const personalInfo = candidate.personalInfo || {};
    const email = String(req.body.email || personalInfo.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ message: 'Email is required to create a teacher account.' });

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'A user with this email already exists.', userId: String(existing._id) });
    }

    const { firstName, lastName } = splitName(personalInfo.fullName || '');
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const newUser = await User.create({
      firstName: String(req.body.firstName || firstName).trim() || 'Teacher',
      lastName: String(req.body.lastName || lastName).trim() || 'User',
      email,
      password: passwordHash,
      role: 'teacher',
      isActive: true,
      phone: String(personalInfo.phone || '').trim() || undefined,
      gender: String(personalInfo.gender || '').toLowerCase() === 'female' ? 'female' : 'male',
      timezone: String(personalInfo.timezone || '').trim() || undefined,
    });

    // Mark candidate as accepted + record conversion
    candidate.recruitment = candidate.recruitment || {};
    candidate.recruitment.status = 'accepted';
    candidate.recruitment.reviewed = true;
    candidate.recruitment.reviewedAt = new Date();
    candidate.recruitment.reviewedBy = req.user._id;
    if (!Array.isArray(candidate.recruitment.history)) candidate.recruitment.history = [];
    candidate.recruitment.history.push({
      at: new Date(),
      actor: req.user._id,
      action: 'converted_to_teacher',
      fromStatus: candidate.recruitment.status || 'accepted',
      toStatus: 'accepted',
      note: `Converted to teacher account: ${email}`,
    });
    candidate.markModified('recruitment');
    await candidate.save();

    return res.status(201).json({
      message: 'Teacher account created successfully.',
      userId: String(newUser._id),
      email,
      tempPassword,
    });
  } catch (error) {
    console.error('Convert candidate to teacher error:', error);
    if (error?.code === 11000) return res.status(409).json({ message: 'A user with this email already exists.' });
    return res.status(500).json({ message: 'Failed to create teacher account.' });
  }
});

// ─── Training Batches ────────────────────────────────────────────────────────

router.get('/training-batches', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const batches = await TrainingBatch.find({}).sort({ createdAt: -1 }).lean();
    return res.json({ batches });
  } catch (error) {
    console.error('List training batches error:', error);
    return res.status(500).json({ message: 'Failed to load training batches.' });
  }
});

router.get('/training-batches/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const batch = await TrainingBatch.findById(req.params.id).lean();
    if (!batch) return res.status(404).json({ message: 'Training batch not found.' });
    return res.json({ batch });
  } catch (error) {
    console.error('Get training batch error:', error);
    return res.status(500).json({ message: 'Failed to load training batch.' });
  }
});

router.post('/training-batches', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    if (!title) return res.status(400).json({ message: 'Batch title is required.' });

    const topics = await getLectureTopics();
    // Explicit list of topics takes priority; otherwise seed from the reusable template.
    const requestedTopics = Array.isArray(body.topics)
      ? body.topics.map((t) => String(t || '').trim()).filter(Boolean)
      : null;
    const sessionTopics = (requestedTopics && requestedTopics.length)
      ? requestedTopics
      : topics.slice(0, Math.min(30, Math.max(1, Number(body.totalSessions || topics.length) || topics.length)));
    const totalSessions = sessionTopics.length;
    const sessions = sessionTopics.map((topic, i) => ({
      sessionNumber: i + 1,
      title: topic || `Lecture ${i + 1}`,
      status: 'scheduled',
    }));

    const batch = await TrainingBatch.create({
      title,
      status: 'draft',
      campaignId: body.campaignId || null,
      totalSessions,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      trainerNotes: String(body.trainerNotes || '').trim(),
      candidates: [],
      sessions,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    return res.status(201).json({ batch: batch.toObject() });
  } catch (error) {
    console.error('Create training batch error:', error);
    return res.status(500).json({ message: 'Failed to create training batch.' });
  }
});

router.put('/training-batches/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const update = { updatedBy: req.user._id };

    if (body.title != null) update.title = String(body.title).trim();
    if (body.status != null && ['draft', 'active', 'completed', 'cancelled'].includes(body.status)) {
      update.status = body.status;
    }
    if (body.campaignId != null) update.campaignId = body.campaignId || null;
    if (body.startDate != null) update.startDate = body.startDate ? new Date(body.startDate) : null;
    if (body.endDate != null) update.endDate = body.endDate ? new Date(body.endDate) : null;
    if (body.trainerNotes != null) update.trainerNotes = String(body.trainerNotes || '').trim();

    const batch = await TrainingBatch.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!batch) return res.status(404).json({ message: 'Training batch not found.' });
    return res.json({ batch: batch.toObject() });
  } catch (error) {
    console.error('Update training batch error:', error);
    return res.status(500).json({ message: 'Failed to update training batch.' });
  }
});

// Add/remove a candidate from a training batch
router.post('/training-batches/:id/candidates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { candidateId, candidateSource, displayName, email } = req.body || {};
    if (!candidateId || !candidateSource) {
      return res.status(400).json({ message: 'candidateId and candidateSource are required.' });
    }
    const batch = await TrainingBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Training batch not found.' });

    const alreadyIn = batch.candidates.some((c) => String(c.candidateId) === String(candidateId));
    if (alreadyIn) return res.status(409).json({ message: 'Candidate already in this batch.' });

    batch.candidates.push({ candidateId, candidateSource, displayName: displayName || '', email: email || '' });
    batch.updatedBy = req.user._id;
    await batch.save();
    return res.json({ batch: batch.toObject() });
  } catch (error) {
    console.error('Add candidate to batch error:', error);
    return res.status(500).json({ message: 'Failed to add candidate.' });
  }
});

router.delete('/training-batches/:id/candidates/:candidateId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const batch = await TrainingBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Training batch not found.' });

    batch.candidates = batch.candidates.filter((c) => String(c.candidateId) !== String(req.params.candidateId));
    batch.updatedBy = req.user._id;
    await batch.save();
    return res.json({ batch: batch.toObject() });
  } catch (error) {
    console.error('Remove candidate from batch error:', error);
    return res.status(500).json({ message: 'Failed to remove candidate.' });
  }
});

// Update a session within a batch (schedule, notes, attendance)
router.put('/training-batches/:id/sessions/:sessionNumber', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const sessionNum = Number(req.params.sessionNumber);
    const batch = await TrainingBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Training batch not found.' });

    const session = batch.sessions.find((s) => s.sessionNumber === sessionNum);
    if (!session) return res.status(404).json({ message: 'Session not found in this batch.' });

    const body = req.body || {};
    if (body.title != null) session.title = String(body.title).trim();
    if (body.scheduledAt != null) session.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (body.durationMinutes != null) session.durationMinutes = Math.max(15, Math.min(480, Number(body.durationMinutes) || 60));
    if (body.meetingLink != null) session.meetingLink = String(body.meetingLink || '').trim();
    if (body.status != null && ['scheduled', 'completed', 'cancelled'].includes(body.status)) {
      session.status = body.status;
    }
    if (body.trainerNotes != null) session.trainerNotes = String(body.trainerNotes || '').trim();
    if (Array.isArray(body.materials)) session.materials = body.materials.map((m) => String(m || '').trim()).filter(Boolean);

    // Update per-candidate attendance records
    if (Array.isArray(body.attendance)) {
      body.attendance.forEach((entry) => {
        if (!entry.candidateId) return;
        const existing = session.attendance.find((a) => String(a.candidateId) === String(entry.candidateId));
        if (existing) {
          if (entry.attended != null) existing.attended = Boolean(entry.attended);
          if (entry.grade != null && ['not_graded', 'weak', 'good', 'very_good', 'excellent'].includes(entry.grade)) {
            existing.grade = entry.grade;
          }
          if (entry.trainerNotes != null) existing.trainerNotes = String(entry.trainerNotes || '').trim();
        } else {
          session.attendance.push({
            candidateId: entry.candidateId,
            candidateSource: entry.candidateSource || 'lead',
            attended: Boolean(entry.attended),
            grade: ['not_graded', 'weak', 'good', 'very_good', 'excellent'].includes(entry.grade) ? entry.grade : 'not_graded',
            trainerNotes: String(entry.trainerNotes || '').trim(),
          });
        }
      });
    }

    batch.updatedBy = req.user._id;
    batch.markModified('sessions');
    await batch.save();
    return res.json({ batch: batch.toObject() });
  } catch (error) {
    console.error('Update training batch session error:', error);
    return res.status(500).json({ message: 'Failed to update session.' });
  }
});

// Update candidate outcome within a batch (pass/fail/drop)
router.patch('/training-batches/:id/candidates/:candidateId/outcome', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { outcome, outcomeNotes } = req.body || {};
    if (!outcome || !['pending', 'passed', 'failed', 'dropped'].includes(outcome)) {
      return res.status(400).json({ message: 'Valid outcome is required (pending/passed/failed/dropped).' });
    }
    const batch = await TrainingBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Training batch not found.' });

    const candidate = batch.candidates.find((c) => String(c.candidateId) === String(req.params.candidateId));
    if (!candidate) return res.status(404).json({ message: 'Candidate not found in this batch.' });

    candidate.outcome = outcome;
    if (outcomeNotes != null) candidate.outcomeNotes = String(outcomeNotes || '').trim();
    batch.updatedBy = req.user._id;
    batch.markModified('candidates');
    await batch.save();
    return res.json({ batch: batch.toObject() });
  } catch (error) {
    console.error('Update candidate outcome error:', error);
    return res.status(500).json({ message: 'Failed to update candidate outcome.' });
  }
});

// ─── Lecture template (reusable training topics) ─────────────────────────────

router.get('/training-lecture-template', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const topics = await getLectureTopics();
    return res.json({ topics, defaults: DEFAULT_LECTURE_TOPICS });
  } catch (error) {
    console.error('Get lecture template error:', error);
    return res.status(500).json({ message: 'Failed to load lecture template.' });
  }
});

router.put('/training-lecture-template', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.topics) ? req.body.topics : [];
    const topics = incoming.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 30);
    if (!topics.length) return res.status(400).json({ message: 'At least one lecture topic is required.' });
    await Setting.findOneAndUpdate(
      { key: LECTURE_TEMPLATE_KEY },
      { $set: { key: LECTURE_TEMPLATE_KEY, value: topics, updatedBy: req.user._id } },
      { upsert: true, new: true }
    );
    return res.json({ message: 'Lecture template saved.', topics });
  } catch (error) {
    console.error('Save lecture template error:', error);
    return res.status(500).json({ message: 'Failed to save lecture template.' });
  }
});

// Add a session (lecture) to a batch
router.post('/training-batches/:id/sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const batch = await TrainingBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Training batch not found.' });
    if (batch.sessions.length >= 30) return res.status(400).json({ message: 'Maximum of 30 lectures reached.' });

    const nextNumber = batch.sessions.reduce((max, s) => Math.max(max, s.sessionNumber || 0), 0) + 1;
    const title = String(req.body?.title || '').trim() || `Lecture ${nextNumber}`;
    batch.sessions.push({
      sessionNumber: nextNumber,
      title,
      status: 'scheduled',
      scheduledAt: req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null,
    });
    batch.totalSessions = batch.sessions.length;
    batch.updatedBy = req.user._id;
    batch.markModified('sessions');
    await batch.save();
    return res.status(201).json({ batch: batch.toObject() });
  } catch (error) {
    console.error('Add training session error:', error);
    return res.status(500).json({ message: 'Failed to add lecture.' });
  }
});

// Remove a session (lecture) from a batch
router.delete('/training-batches/:id/sessions/:sessionNumber', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const sessionNum = Number(req.params.sessionNumber);
    const batch = await TrainingBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ message: 'Training batch not found.' });

    const before = batch.sessions.length;
    batch.sessions = batch.sessions.filter((s) => s.sessionNumber !== sessionNum);
    if (batch.sessions.length === before) return res.status(404).json({ message: 'Session not found in this batch.' });

    batch.totalSessions = batch.sessions.length;
    batch.updatedBy = req.user._id;
    batch.markModified('sessions');
    await batch.save();
    return res.json({ batch: batch.toObject() });
  } catch (error) {
    console.error('Remove training session error:', error);
    return res.status(500).json({ message: 'Failed to remove lecture.' });
  }
});

// ─── Recruitment email templates (per-outcome) ───────────────────────────────

router.get('/email-templates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const templates = await getRecruitmentEmailTemplates();
    return res.json({ templates, events: RECRUITMENT_EMAIL_EVENTS, defaults: DEFAULT_RECRUITMENT_EMAIL_TEMPLATES });
  } catch (error) {
    console.error('Get recruitment email templates error:', error);
    return res.status(500).json({ message: 'Failed to load email templates.' });
  }
});

router.put('/email-templates', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const incoming = (req.body && typeof req.body.templates === 'object') ? req.body.templates : {};
    const cleaned = {};
    RECRUITMENT_EMAIL_EVENTS.forEach((event) => {
      const entry = incoming[event] || {};
      cleaned[event] = {
        subject: String(entry.subject || '').trim().slice(0, 200),
        body: String(entry.body || '').slice(0, 8000),
      };
    });
    await Setting.findOneAndUpdate(
      { key: RECRUITMENT_EMAIL_TEMPLATE_KEY },
      { $set: { key: RECRUITMENT_EMAIL_TEMPLATE_KEY, value: cleaned, updatedBy: req.user._id, description: 'Per-outcome recruitment email templates' } },
      { upsert: true, new: true }
    );
    const templates = await getRecruitmentEmailTemplates();
    return res.json({ message: 'Email templates saved.', templates });
  } catch (error) {
    console.error('Save recruitment email templates error:', error);
    return res.status(500).json({ message: 'Failed to save email templates.' });
  }
});

// Build + enqueue a recruitment email for a single candidate document.
// Marks the outcome as emailed (interview.emailSentForOutcome) when the event
// is outcome-driven, and records the send in the candidate history.
// Returns { to, event }. Throws Error with .statusCode for expected failures.
async function sendRecruitmentEmailForDoc(doc, event, { notes = '', actorId = null, templates = null, branding = null } = {}) {
  if (!RECRUITMENT_EMAIL_EVENTS.includes(event)) {
    const err = new Error('Unsupported email template.');
    err.statusCode = 400;
    throw err;
  }
  const personalInfo = doc.personalInfo || {};
  const to = String(personalInfo.email || doc.user?.email || '').trim().toLowerCase();
  if (!to) {
    const err = new Error('This candidate has no email address on file.');
    err.statusCode = 400;
    throw err;
  }

  const resolvedTemplates = templates || (await getRecruitmentEmailTemplates());
  const template = resolvedTemplates[event] || DEFAULT_RECRUITMENT_EMAIL_TEMPLATES[event] || { subject: '', body: '' };
  const name = String(personalInfo.fullName || `${doc.user?.firstName || ''} ${doc.user?.lastName || ''}`.trim() || 'there');
  const baseUrl = (process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').split(',')[0].replace(/\/$/, '');
  const interviewLink = `${baseUrl}/public/meetings/evaluation?type=new_teacher_interview`;

  const vars = {
    name,
    link: event === 'missing_info' ? `${baseUrl}/teacher-contract` : interviewLink,
    notes: String(notes || '').trim(),
  };

  const subject = renderEmailTemplate(template.subject, vars) || 'Waraqa Recruitment';
  const bodyText = renderEmailTemplate(template.body, vars);

  let resolvedBranding = branding;
  if (!resolvedBranding) {
    try { resolvedBranding = await emailService.loadBrandingAndLogo(); } catch { resolvedBranding = {}; }
  }
  const htmlBody = `<div style="font-size:15px;line-height:1.6;color:#111827;">${bodyText.split('\n').map((line) => line.trim() ? `<p style="margin:0 0 12px;">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : '<br/>').join('')}</div>`;
  const html = emailService.baseEmailTemplate({ preheader: subject, body: htmlBody, branding: resolvedBranding });

  await emailService.enqueueEmail({
    to,
    subject,
    html,
    text: bodyText,
    type: 'recruitment',
    relatedId: String(doc._id),
    priority: 2,
  });

  doc.recruitment = doc.recruitment || {};
  // Mark this outcome as emailed so it drops out of the "pending emails" queue.
  const outcomeForEvent = Object.keys(OUTCOME_TO_EMAIL_EVENT).find((o) => OUTCOME_TO_EMAIL_EVENT[o] === event);
  if (outcomeForEvent) {
    doc.recruitment.interview = doc.recruitment.interview || {};
    doc.recruitment.interview.emailSentForOutcome = doc.recruitment.interview.outcome || outcomeForEvent;
    doc.recruitment.interview.outcomeEmailSentAt = new Date();
  }
  if (!Array.isArray(doc.recruitment.history)) doc.recruitment.history = [];
  doc.recruitment.history.push({
    at: new Date(),
    actor: actorId,
    action: 'email_sent',
    note: `Sent "${event}" email to ${to}`,
  });
  doc.markModified('recruitment');
  await doc.save();

  return { to, event };
}

// Collect candidates whose interview outcome maps to an email that has NOT
// been sent yet for that outcome.
async function collectPendingOutcomeEmails() {
  const pending = [];
  for (const [source, Model] of [['public', TeacherContractLead], ['dashboard', TeacherContractSubmission]]) {
    const query = source === 'dashboard' ? { status: 'submitted' } : {};
    const docs = await Model.find(query)
      .select('recruitment personalInfo user')
      .populate('user', 'firstName lastName email')
      .lean();
    for (const doc of docs) {
      const interview = doc?.recruitment?.interview || {};
      const outcome = String(interview.outcome || '').trim();
      const event = outcomeEmailEventFor(outcome);
      if (!event) continue;
      // Already emailed for the current outcome?
      if (interview.emailSentForOutcome && interview.emailSentForOutcome === outcome) continue;
      const email = String(doc?.personalInfo?.email || doc?.user?.email || '').trim().toLowerCase();
      if (!email) continue;
      pending.push({
        source,
        id: String(doc._id),
        name: String(doc?.personalInfo?.fullName || `${doc?.user?.firstName || ''} ${doc?.user?.lastName || ''}`.trim() || 'Candidate'),
        email,
        outcome,
        event,
      });
    }
  }
  return pending;
}

// List candidates awaiting an outcome email (for the "Send all pending" queue)
router.get('/pending-emails', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pending = await collectPendingOutcomeEmails();
    return res.json({ pending, count: pending.length });
  } catch (error) {
    console.error('List pending emails error:', error);
    return res.status(500).json({ message: 'Failed to load pending emails.' });
  }
});

// Send ALL pending outcome emails in one action
router.post('/send-pending-emails', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const pending = await collectPendingOutcomeEmails();
    if (!pending.length) return res.json({ message: 'No pending emails to send.', sent: 0, failed: 0, results: [] });

    const templates = await getRecruitmentEmailTemplates();
    let branding = {};
    try { branding = await emailService.loadBrandingAndLogo(); } catch { branding = {}; }

    const results = [];
    let sent = 0;
    let failed = 0;
    for (const item of pending) {
      const Model = resolveResponseModel(item.source);
      if (!Model) { failed += 1; results.push({ ...item, ok: false, error: 'Unsupported source' }); continue; }
      try {
        const doc = await Model.findById(item.id).populate('user', 'firstName lastName email');
        if (!doc) { failed += 1; results.push({ ...item, ok: false, error: 'Not found' }); continue; }
        await sendRecruitmentEmailForDoc(doc, item.event, { actorId: req.user._id, templates, branding });
        sent += 1;
        results.push({ ...item, ok: true });
      } catch (err) {
        failed += 1;
        results.push({ ...item, ok: false, error: err.message || 'Failed' });
      }
    }
    return res.json({ message: `Queued ${sent} email(s).`, sent, failed, results });
  } catch (error) {
    console.error('Send pending emails error:', error);
    return res.status(500).json({ message: 'Failed to send pending emails.' });
  }
});

// Send a per-outcome email to a candidate
router.post('/responses/:source/:id/send-email', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const source = String(req.params.source || '').trim().toLowerCase();
    const Model = resolveResponseModel(source);
    if (!Model) return res.status(400).json({ message: 'Unsupported response source.' });

    const event = String(req.body?.template || req.body?.event || '').trim();
    const doc = await Model.findById(req.params.id).populate('user', 'firstName lastName email');
    if (!doc) return res.status(404).json({ message: 'Teacher response not found.' });

    const { to } = await sendRecruitmentEmailForDoc(doc, event, {
      notes: req.body?.notes,
      actorId: req.user._id,
    });

    return res.json({ message: `Email queued to ${to}.`, sentTo: to, event });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    console.error('Send candidate email error:', error);
    return res.status(500).json({ message: 'Failed to send email.' });
  }
});

// ─── Capacity decision config ─────────────────────────────────────────────────

router.get('/capacity-config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const config = await getCapacityConfig();
    return res.json({ config, defaults: DEFAULT_CAPACITY_CONFIG });
  } catch (error) {
    console.error('Get capacity config error:', error);
    return res.status(500).json({ message: 'Failed to load capacity config.' });
  }
});

router.put('/capacity-config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body?.config || req.body || {};
    await Setting.findOneAndUpdate(
      { key: CAPACITY_CONFIG_KEY },
      { $set: { key: CAPACITY_CONFIG_KEY, value: incoming, updatedBy: req.user._id, description: 'Recruitment capacity decision thresholds' } },
      { upsert: true, new: true }
    );
    const config = await getCapacityConfig();
    return res.json({ message: 'Capacity settings saved.', config });
  } catch (error) {
    console.error('Save capacity config error:', error);
    return res.status(500).json({ message: 'Failed to save capacity config.' });
  }
});

// ─── Import applicants from a Google Sheet (CSV) with dedup ────────────────────

router.post('/import-sheet', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const rawUrl = String(req.body?.sheetUrl || req.body?.url || '').trim();
    if (!rawUrl) return res.status(400).json({ message: 'A Google Sheet URL is required.' });

    const csvUrl = toGoogleSheetCsvUrl(rawUrl);
    let csvText = '';
    try {
      const response = await axios.get(csvUrl, {
        responseType: 'text',
        timeout: 20000,
        maxRedirects: 5,
        headers: { 'User-Agent': 'Waraqa-Recruitment-Import/1.0' },
      });
      csvText = String(response.data || '');
    } catch (fetchErr) {
      return res.status(422).json({ message: 'Could not read the sheet. Make sure it is shared as "Anyone with the link (Viewer)" or published to the web.' });
    }

    if (/<html/i.test(csvText.slice(0, 500))) {
      return res.status(422).json({ message: 'The sheet is not publicly readable. Share it as "Anyone with the link" or publish it as CSV.' });
    }

    let rows = [];
    try {
      rows = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
    } catch (parseErr) {
      return res.status(422).json({ message: 'The sheet could not be parsed as a table. Ensure the first row contains column headers.' });
    }

    if (!rows.length) return res.json({ message: 'No rows found in the sheet.', imported: 0, skipped: 0, duplicates: 0, invalid: 0 });

    // Preload existing emails for dedup (leads + submissions + users).
    const [existingLeads, existingSubs, existingUsers] = await Promise.all([
      TeacherContractLead.find({}).select('personalInfo.email').lean(),
      TeacherContractSubmission.find({}).select('personalInfo.email user').populate('user', 'email').lean(),
      User.find({ role: { $in: ['teacher', 'admin', 'guardian', 'student'] } }).select('email').lean(),
    ]);
    const existingEmails = new Set();
    existingLeads.forEach((l) => { if (l?.personalInfo?.email) existingEmails.add(String(l.personalInfo.email).toLowerCase()); });
    existingSubs.forEach((s) => {
      if (s?.personalInfo?.email) existingEmails.add(String(s.personalInfo.email).toLowerCase());
      if (s?.user?.email) existingEmails.add(String(s.user.email).toLowerCase());
    });
    existingUsers.forEach((u) => { if (u?.email) existingEmails.add(String(u.email).toLowerCase()); });

    let imported = 0;
    let duplicates = 0;
    let invalid = 0;
    const seenInBatch = new Set();
    const toInsert = [];

    for (const row of rows) {
      const email = pickColumn(row, ['email', 'e-mail', 'emailaddress']).toLowerCase();
      const fullName = pickColumn(row, ['fullname', 'name', 'applicantname']);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { invalid += 1; continue; }
      if (existingEmails.has(email) || seenInBatch.has(email)) { duplicates += 1; continue; }
      seenInBatch.add(email);

      const phone = pickColumn(row, ['phone', 'whatsapp', 'mobile', 'phonenumber']);
      const gender = pickColumn(row, ['gender', 'sex']).toLowerCase();
      const country = pickColumn(row, ['country', 'nationality']);
      const subjects = pickColumn(row, ['subjects', 'subject', 'positions', 'positionsinterested']);
      const summary = pickColumn(row, ['summary', 'about', 'experience', 'profile', 'notes', 'message']);

      toInsert.push({
        source: 'public',
        status: 'submitted',
        submittedAt: new Date(),
        personalInfo: {
          fullName: fullName || email,
          email,
          mobileNumber: phone,
          whatsappNumber: phone,
          gender: gender === 'female' ? 'female' : (gender === 'male' ? 'male' : ''),
          nationality: country,
          address: { country: country || 'Egypt' },
        },
        application: {
          positionsInterested: subjects ? subjects.split(/[,;/]/).map((s) => s.trim()).filter(Boolean) : [],
          experience: { profileSummary: summary },
        },
        recruitment: {
          status: 'new',
          reviewed: false,
          tags: ['imported'],
          history: [{ at: new Date(), actor: req.user._id, action: 'imported', note: 'Imported from Google Sheet' }],
        },
      });
    }

    if (toInsert.length) {
      const inserted = await TeacherContractLead.insertMany(toInsert, { ordered: false });
      imported = inserted.length;
    }

    return res.json({
      message: `Imported ${imported} applicant${imported === 1 ? '' : 's'}.`,
      imported,
      duplicates,
      invalid,
      totalRows: rows.length,
    });
  } catch (error) {
    console.error('Import sheet error:', error);
    return res.status(500).json({ message: 'Failed to import applicants from the sheet.' });
  }
});

module.exports = router;
