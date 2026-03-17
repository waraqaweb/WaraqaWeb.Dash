const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const Setting = require('../models/Setting');
const TeacherContractSubmission = require('../models/TeacherContractSubmission');
const TeacherContractLead = require('../models/TeacherContractLead');
const User = require('../models/User');
const { authenticateToken, requireTeacherOrAdmin, requireAdmin } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE || 8 * 1024 * 1024) },
});

const fileFields = upload.fields([
  { name: 'identityDocument', maxCount: 1 },
  { name: 'educationDocuments', maxCount: 1 },
  { name: 'profilePhoto', maxCount: 1 },
]);

const isCloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

const CONTRACT_TEMPLATE_KEY = 'teacher_contract_template_v1';
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

function normalizeTeacherResponse(source, doc) {
  if (!doc) return null;

  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: String(plain._id),
    source,
    status: plain.status || 'submitted',
    submittedAt: plain.submittedAt || plain.createdAt || plain.updatedAt || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    contract: plain.contract || {},
    verification: plain.verification || {},
    personalInfo: plain.personalInfo || {},
    user: plain.user ? {
      _id: plain.user._id,
      firstName: plain.user.firstName,
      lastName: plain.user.lastName,
      email: plain.user.email,
      phone: plain.user.phone,
    } : null,
  };
}

router.get('/template', async (req, res) => {
  try {
    const value = await getContractTemplateValue();
    return res.json({ template: value });
  } catch (error) {
    console.error('Get teacher contract template error:', error);
    return res.status(500).json({ message: 'Failed to load contract template.' });
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
        .sort({ submittedAt: -1, createdAt: -1 })
        .lean(),
      TeacherContractSubmission.find({ status: 'submitted' })
        .populate('user', 'firstName lastName email phone')
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
    };
    const wordCount = introEssay ? introEssay.split(/\s+/).filter(Boolean).length : 0;
    const files = req.files || {};

    if (!contractAccepted || !contractFullName) {
      return res.status(400).json({ message: 'Please accept the contract and write the full name.' });
    }
    if (!introEssay || wordCount > 200) {
      return res.status(400).json({ message: 'Please add a short English introduction up to 200 words.' });
    }
    if (!personalInfo.fullName || !personalInfo.email || !personalInfo.birthDate || !personalInfo.mobileNumber || !personalInfo.gender || !personalInfo.nationality) {
      return res.status(400).json({ message: 'Please complete the required personal information.' });
    }
    if (!files.identityDocument?.[0]) {
      return res.status(400).json({ message: 'Identity document is required.' });
    }
    if (!files.educationDocuments?.[0]) {
      return res.status(400).json({ message: 'Educational documents are required.' });
    }

    const identityDocument = await uploadAsset(files.identityDocument[0], `waraqa/public-teacher-contracts/${Date.now()}/identity`);
    const educationDocuments = await uploadAsset(files.educationDocuments[0], `waraqa/public-teacher-contracts/${Date.now()}/education`);
    const profilePhoto = files.profilePhoto?.[0]
      ? await uploadAsset(files.profilePhoto[0], `waraqa/public-teacher-contracts/${Date.now()}/profile`)
      : {};

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

module.exports = router;
