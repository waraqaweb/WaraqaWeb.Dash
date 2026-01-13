// backend/routes/invoices.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const InvoiceService = require('../services/invoiceService');
const { buildGuardianFinancialSnapshot } = require('../utils/guardianFinancial');
const { extractSequenceFromName, ensureSequenceAtLeast, formatSequence } = require('../utils/invoiceNaming');
const { allocateNextSequence, buildInvoiceIdentifiers } = require('../utils/invoiceNaming');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const roundCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

// Ensure every invoice fetch returns consistent class metadata for filtering
const CLASS_FIELDS_FOR_INVOICE = [
  'scheduledDate',
  'duration',
  'subject',
  'timezone',
  'anchoredTimezone',
  'status',
  'classReport.submittedAt',
  'reportSubmission.status',
  'reportSubmission.teacherDeadline',
  'reportSubmission.adminExtension.granted',
  'reportSubmission.adminExtension.expiresAt',
  'reportSubmission.markedUnreportedAt',
  'student.studentName',
  'student.studentId',
  'student.guardianId'
].join(' ');

// adjustments removed: no helper to sum adjustments

const applyPreviewTotals = (invoice, preview = {}) => {
  if (!invoice || typeof invoice !== 'object') return;

  const subtotalValue = preview.subtotal ?? preview.subtotalAmount;
  if (subtotalValue !== undefined) {
    invoice.subtotal = roundCurrency(subtotalValue);
  }

  const totalValue = preview.total ?? preview.totalAmount ?? preview.amount;
  if (totalValue !== undefined) {
    invoice.total = roundCurrency(totalValue);
  }

  if (!invoice.guardianFinancial || typeof invoice.guardianFinancial !== 'object') {
    invoice.guardianFinancial = {};
  }

  const transferFee = invoice.guardianFinancial.transferFee && typeof invoice.guardianFinancial.transferFee === 'object'
    ? invoice.guardianFinancial.transferFee
    : {};

  if (preview.transferFeeAmount !== undefined || preview.transferFee !== undefined) {
    const tfValue = preview.transferFeeAmount ?? preview.transferFee;
    transferFee.amount = roundCurrency(tfValue);
    if (transferFee.amount > 0) {
      transferFee.appliedAt = new Date();
    }
  }

  if (typeof preview.transferFeeWaived === 'boolean') {
    transferFee.waived = preview.transferFeeWaived;
  }
  if (typeof preview.transferFeeWaivedByCoverage === 'boolean') {
    transferFee.waivedByCoverage = preview.transferFeeWaivedByCoverage;
  }
  transferFee.mode = transferFee.mode || 'fixed';
  transferFee.source = transferFee.source || 'guardian_default';
  invoice.guardianFinancial.transferFee = transferFee;
  invoice.markModified?.('guardianFinancial');

  const rateValue = preview.guardianRate ?? preview.hourlyRate;
  if (rateValue !== undefined) {
    const numericRate = Number(rateValue);
    if (Number.isFinite(numericRate)) {
      invoice.guardianFinancial.hourlyRate = numericRate;
      invoice.markModified?.('guardianFinancial');
    }
  }

  if (preview.discount !== undefined) {
    invoice.discount = roundCurrency(preview.discount);
  }
  if (preview.lateFee !== undefined) {
    invoice.lateFee = roundCurrency(preview.lateFee);
  }
  if (preview.tip !== undefined) {
    invoice.tip = roundCurrency(preview.tip);
  }

  const hoursValue = preview.hours ?? preview.totalHours ?? preview.hoursCovered;
  if (hoursValue !== undefined) {
    const numericHours = Number(hoursValue);
    if (Number.isFinite(numericHours)) {
      invoice.hoursCovered = numericHours;
    }
  }

  if (preview.paidAmount !== undefined) {
    invoice.paidAmount = roundCurrency(preview.paidAmount);
  }

  invoice.amount = invoice.total;

  // adjustments removed: adjustedTotal mirrors total
  invoice.adjustedTotal = roundCurrency(invoice.total || 0);

  // When preview totals are intentionally applied from the UI we want to
  // persist them without the model's pre-save recalculation overriding
  // the values. Set a temporary flag that the Invoice pre-save hook will
  // check and skip automatic recalculation for this save operation.
  try {
    invoice._skipRecalculate = true;
  } catch (e) {
    // ignore
  }
};

// Compute billing window (start/end) from items and coverage
const updateBillingWindowFromItems = (invoice) => {
  try {
    if (!invoice) return;
    const dates = Array.isArray(invoice.items)
      ? invoice.items
          .map((it) => (it && it.date ? new Date(it.date) : null))
          .filter((d) => d && !Number.isNaN(d.getTime()))
      : [];
    const minDate = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : (invoice.billingPeriod?.startDate || invoice.createdAt || new Date());
    const maxDateBase = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : (invoice.billingPeriod?.endDate || invoice.dueDate || minDate);
    const coverageEnd = invoice.coverage && invoice.coverage.endDate ? new Date(invoice.coverage.endDate) : null;
    const endDate = coverageEnd && !Number.isNaN(coverageEnd.getTime()) ? coverageEnd : maxDateBase;

    if (!invoice.billingPeriod || typeof invoice.billingPeriod !== 'object') {
      invoice.billingPeriod = {};
    }
    invoice.billingPeriod.startDate = minDate;
    invoice.billingPeriod.endDate = endDate;
    // Ensure required month/year are present to avoid validation errors on save
    try {
      const basis = endDate || minDate || new Date();
      const yr = basis.getUTCFullYear();
      const mon = basis.getUTCMonth() + 1; // 1-12
      if (!Number.isFinite(Number(invoice.billingPeriod.year))) {
        invoice.billingPeriod.year = yr;
      }
      if (!Number.isFinite(Number(invoice.billingPeriod.month)) || invoice.billingPeriod.month < 1 || invoice.billingPeriod.month > 12) {
        invoice.billingPeriod.month = mon;
      }
    } catch (_) {
      // non-fatal
    }
    if (typeof invoice.markModified === 'function') invoice.markModified('billingPeriod');
  } catch (e) {
    // non-fatal
  }
};

// -----------------------------
// Routes ordering is important:
// - /stats MUST come before /:id
// - /:id/details MUST come before /:id
// - Only one GET / route
// -----------------------------

// GET stats overview (guardian invoices)
router.get('/stats/overview', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await InvoiceService.getInvoiceStats();
    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error });
    }
    res.json({ success: true, stats: result.stats });
  } catch (err) {
    console.error('Stats overview error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Legacy stats endpoint (kept for backwards compatibility)
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const result = await InvoiceService.getInvoiceStats();
    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error });
    }
    res.json({ success: true, stats: result.stats });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------
// Public read-only invoice view
// -----------------------------
router.get('/public/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const invoice = await Invoice.findOne({ invoiceSlug: slug })
      .populate('guardian', 'firstName lastName email phone')
      .populate('teacher', 'firstName lastName email')
      .populate('items.student', 'firstName lastName email')
      .populate('items.teacher', 'firstName lastName')
      .populate('items.class', CLASS_FIELDS_FOR_INVOICE);

    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (!invoice.invoiceSlug || !invoice.invoiceName) {
      await invoice.ensureIdentifiers({ forceNameRefresh: false });
      await invoice.save();
    }

    const snapshot = invoice.getExportSnapshot({ includeActivity: false });
    snapshot.invoiceName = invoice.invoiceName;
    snapshot.invoiceSlug = invoice.invoiceSlug;

    res.json({ success: true, invoice: snapshot, readOnly: true });
  } catch (err) {
    console.error('Public invoice fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch invoice', error: err.message });
  }
});

// -----------------------------
// List invoices with filters, pagination, sorting
// -----------------------------
router.get('/', authenticateToken, async (req, res) => {
  console.log('=== [Invoices API] GET /invoices START ===', { query: req.query, user: req.user?._id });
  try {
    const {
      page = 1,
      limit = 10,
      status,
      type,
      guardian,
      teacher,
      search,
      sortBy: rawSortBy,
      order: rawOrder
    } = req.query;

    const filter = {};

    const smartSort = ['1', 'true', 'yes'].includes(String(req.query.smartSort || '').toLowerCase());

    // Exclude soft-deleted invoices by default. Admins may request deleted via ?deleted=true
    const showDeleted = String(req.query.deleted || '').toLowerCase() === 'true';
    if (!showDeleted) {
      filter.deleted = { $ne: true };
    } else if (showDeleted && req.user.role !== 'admin') {
      // Non-admins are not allowed to view deleted invoices
      filter.deleted = { $ne: true };
    }

    // Apply filters
    // Support semantic status filters: 'paid' and 'unpaid'
    if (status) {
      if (String(status).toLowerCase() === 'paid') {
        // Treat refunded as paid as well per UX guidance
        filter.status = { $in: ['paid', 'refunded'] };
      } else if (String(status).toLowerCase() === 'unpaid') {
        // Unpaid = anything that is not paid/refunded
        filter.status = { $nin: ['paid', 'refunded'] };
      } else {
        filter.status = status;
      }
    }
    if (type) filter.type = type;
    if (guardian) filter.guardian = guardian;
    if (teacher) filter.teacher = teacher;
    
    // Role-based access
    if (req.user.role === 'guardian') filter.guardian = req.user._id;
    if (req.user.role === 'teacher') filter.teacher = req.user._id;
    
    // Date range filter (billingPeriod)
    if (req.query.startDate || req.query.endDate) {
      filter['billingPeriod.startDate'] = {};
      if (req.query.startDate) {
        filter['billingPeriod.startDate'].$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filter['billingPeriod.startDate'].$lte = new Date(req.query.endDate);
      }
    }
    
    // Text search
    const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const normalizedSearch = typeof search === 'string' ? search.trim() : '';
    if (normalizedSearch) {
      const regex = new RegExp(escapeRegExp(normalizedSearch), 'i');

      // Match on core invoice fields
      const orConditions = [
        { invoiceNumber: regex },
        { notes: regex },
        { 'items.description': regex },
      ];

      // Also match guardian/teacher/student names/emails by resolving user ids.
      // This enables "search by name" across tabs/pages.
      const [guardianMatches, teacherMatches, studentMatches] = await Promise.all([
        User.find({
          role: 'guardian',
          $or: [
            { firstName: regex },
            { lastName: regex },
            { email: regex },
            { phone: regex },
          ],
        }).select('_id').lean(),
        User.find({
          role: 'teacher',
          $or: [
            { firstName: regex },
            { lastName: regex },
            { email: regex },
            { phone: regex },
          ],
        }).select('_id').lean(),
        User.find({
          role: 'student',
          $or: [
            { firstName: regex },
            { lastName: regex },
            { email: regex },
            { phone: regex },
          ],
        }).select('_id').lean(),
      ]);

      const guardianIds = (guardianMatches || []).map((u) => u._id);
      const teacherIds = (teacherMatches || []).map((u) => u._id);
      const studentIds = (studentMatches || []).map((u) => u._id);

      if (guardianIds.length) {
        orConditions.push({ guardian: { $in: guardianIds } });
      }

      if (teacherIds.length) {
        orConditions.push({ teacher: { $in: teacherIds } });
        orConditions.push({ 'items.teacher': { $in: teacherIds } });
      }

      if (studentIds.length) {
        orConditions.push({ 'items.student': { $in: studentIds } });
      }

      filter.$or = orConditions;
    }
    

    // Pagination & sorting
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Determine effective sortBy and order. If client provided explicit sortBy/order use those.
    // Otherwise apply sensible defaults depending on the status filter:
    // - unpaid: sort ascending by dueDate (oldest first)
    // - paid: sort descending by paidDate (newest first)
    // - otherwise: default to createdAt desc
    let sortBy = rawSortBy || '';
    let order = rawOrder || '';

    if (!rawSortBy && !rawOrder) {
      if (String(status || '').toLowerCase() === 'unpaid') {
        sortBy = 'dueDate';
        order = 'asc';
      } else if (String(status || '').toLowerCase() === 'paid') {
        sortBy = 'paidDate';
        order = 'desc';
      } else {
        sortBy = 'createdAt';
        order = 'desc';
      }
    }

    const sortOrder = String(order).toLowerCase() === 'desc' ? -1 : 1;

    let invoices;
    if (smartSort) {
      // "Smart" global sorting:
      // - unpaid invoices first
      // - within each group: newest first (paidAt/paymentDate/createdAt fallback)
      const limitNum = parseInt(limit);
      const pipeline = [
        { $match: filter },
        {
          $addFields: {
            __unpaidRank: {
              $cond: [{ $in: ['$status', ['paid', 'refunded']] }, 1, 0],
            },
            __effectiveSortDate: {
              $ifNull: [
                '$paidAt',
                {
                  $ifNull: [
                    '$paidDate',
                    { $ifNull: ['$paymentDate', '$createdAt'] },
                  ],
                },
              ],
            },
          },
        },
        {
          $sort: {
            __unpaidRank: 1,
            __effectiveSortDate: -1,
            createdAt: -1,
            _id: -1,
          },
        },
        { $skip: skip },
        { $limit: limitNum },
        { $project: { _id: 1 } },
      ];

      const idRows = await Invoice.aggregate(pipeline);
      const ids = (idRows || []).map((r) => r._id).filter(Boolean);
      if (!ids.length) {
        invoices = [];
      } else {
        const docs = await Invoice.find({ _id: { $in: ids } })
          .populate('guardian', 'firstName lastName email guardianInfo.hourlyRate guardianInfo.transferFee')
          .populate('teacher', 'firstName lastName email')
          .populate('items.student', 'firstName lastName')
          .populate('items.teacher', 'firstName lastName')
          .populate('items.class', CLASS_FIELDS_FOR_INVOICE)
          .lean();

        const byId = new Map((docs || []).map((doc) => [String(doc._id), doc]));
        invoices = ids.map((id) => byId.get(String(id))).filter(Boolean);
      }
    } else {
      invoices = await Invoice.find(filter)
        .populate('guardian', 'firstName lastName email guardianInfo.hourlyRate guardianInfo.transferFee')
        .populate('teacher', 'firstName lastName email')
        .populate('items.student', 'firstName lastName')
        .populate('items.teacher', 'firstName lastName')
        .populate('items.class', CLASS_FIELDS_FOR_INVOICE)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();
    }

    // IMPORTANT: Do NOT mutate or resave invoices during a GET. Previously this
    // route reloaded each invoice, recalculated totals and saved the document.
    // That would overwrite UI-applied snapshot totals (from the view modal) and
    // cause numbers to "revert" after a refresh. We now simply return the
    // persisted values as-is. If identifiers ever need refresh, that should be
    // done explicitly via an admin action, not on read.
    const normalizedInvoices = await Promise.all(invoices.map(async (inv) => {
      try {
        const doc = await Invoice.findById(inv._id)
          .populate('guardian', 'firstName lastName email guardianInfo.hourlyRate guardianInfo.transferFee')
          .populate('teacher', 'firstName lastName email')
          .populate('items.student', 'firstName lastName')
          .populate('items.teacher', 'firstName lastName')
          .populate('items.class', CLASS_FIELDS_FOR_INVOICE);
        if (!doc) return inv;

        const invoiceObj = doc.toObject({ virtuals: true });

        if (invoiceObj.type === 'guardian_invoice') {
          try {
            const dynamicClasses = await InvoiceService.buildDynamicClassList(doc);
            invoiceObj.dynamicClasses = dynamicClasses;
          } catch (dynamicErr) {
            console.warn('[GET /invoices] dynamic class build failed', doc._id?.toString(), dynamicErr?.message || dynamicErr);
          }
        }

        return invoiceObj;
      } catch (err) {
        console.error('Failed to load invoice doc for list', inv._id, err && err.message);
        return inv;
      }
    }));

    const total = await Invoice.countDocuments(filter);
    const pages = Math.ceil(total / parseInt(limit));

    res.json({
      success: true,
      invoices: normalizedInvoices,
      pagination: {
        current: parseInt(page),
        pages,
        total,
        limit: parseInt(limit)
      }
    });
    console.log('=== [Invoices API] GET /invoices SUCCESS ===', { returned: normalizedInvoices.length, page: parseInt(page) });
  } catch (err) {
    console.error('Get invoices error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch invoices',
      error: err.message
    });
  }
});


// CREATE Teacher Salary Invoice (Draft)
router.post("/teacherInvoices", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { teacherId, exchangeRate, dueDate, notes, billingPeriod } = req.body;

    const teacher = await User.findById(teacherId);
    if (!teacher || teacher.role !== "teacher") {
      return res.status(400).json({ message: "Invalid teacher ID" });
    }

    const referenceDate = new Date(billingPeriod?.startDate || Date.now());
    const year = referenceDate.getFullYear();
    const month = referenceDate.getMonth() + 1;

    const invoice = new Invoice({
      teacher: teacherId,
      exchangeRate: exchangeRate || 1,
      dueDate: dueDate || new Date(),
      notes: notes || `Draft salary invoice for ${teacher.firstName} ${teacher.lastName}`,
      type: "teacher_payment",
      status: "draft", // ✅ Start as draft
      billingPeriod: {
        year,
        month,
        startDate: billingPeriod?.startDate,
        endDate: billingPeriod?.endDate,
      },
      items: [],       // ✅ no classes yet
      totalHours: 0,   // ✅ no hours
      totalAmount: 0,  // ✅ no pay calculated
    });

    await invoice.ensureIdentifiers({ forceNameRefresh: false });
    await invoice.save();
    res.status(201).json({ message: "Teacher invoice created (draft)", invoice });
  } catch (err) {
    console.error("Error creating teacher invoice:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// GENERATE Teacher Salary Invoices for All Teachers (Draft)
router.post("/teacherInvoices/generate", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { exchangeRate, dueDate, notes, billingPeriod } = req.body;

  const referenceDate = new Date(billingPeriod?.startDate || Date.now());
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth() + 1;

    const teachers = await User.find({ role: "teacher" });
    if (!teachers.length) {
      return res.status(400).json({ message: "No teachers found" });
    }

    const invoices = [];
    for (const teacher of teachers) {
      const invoice = new Invoice({
        teacher: teacher._id,
        exchangeRate: exchangeRate || 1,
        dueDate: dueDate || new Date(),
        notes: notes || `Auto-generated salary for ${teacher.firstName} ${teacher.lastName}`,
        type: "teacher_payment",
        status: "draft",
        billingPeriod: {
          year,
          month,
          startDate: billingPeriod?.startDate,
          endDate: billingPeriod?.endDate,
        },
        items: [],
        totalHours: 0,
        totalAmount: 0,
      });

      await invoice.ensureIdentifiers({ forceNameRefresh: false });
      await invoice.save();
      invoices.push(invoice);
    }

    res.status(201).json({ message: "Monthly teacher invoices generated", invoices });
  } catch (err) {
    console.error("Error generating teacher invoices:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// -----------------------------
// List uninvoiced lessons (admin) - place BEFORE catch-all '/:identifier'
// -----------------------------
router.get('/uninvoiced-lessons', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { sinceDays, includeCancelled } = req.query || {};
    const audit = require('../services/invoiceAuditService');
    const list = await audit.findUninvoicedLessons({ sinceDays, includeCancelled });
    res.json({ success: true, lessons: list });
  } catch (err) {
    console.error('List uninvoiced lessons error:', err);
    res.status(500).json({ success: false, message: 'Failed to list uninvoiced lessons', error: err.message });
  }
});

// -----------------------------
// GET invoice by ID (catch-all)
// -----------------------------
router.get('/:identifier', authenticateToken, async (req, res) => {
  console.log('=== [Invoices API] GET /invoices/:id START ===', { identifier: req.params.identifier, user: req.user?._id });
  try {
    const { identifier } = req.params;
    let invoiceDoc = await Invoice.findOne({ invoiceSlug: identifier })
      .populate('guardian', 'firstName lastName email phone guardianInfo.hourlyRate guardianInfo.transferFee')
      .populate('teacher', 'firstName lastName email')
      .populate('items.student', 'firstName lastName')
      .populate('items.teacher', 'firstName lastName')
      .populate('items.class', CLASS_FIELDS_FOR_INVOICE);

    if (!invoiceDoc && mongoose.Types.ObjectId.isValid(identifier)) {
      invoiceDoc = await Invoice.findById(identifier)
        .populate('guardian', 'firstName lastName email phone guardianInfo.hourlyRate guardianInfo.transferFee')
        .populate('teacher', 'firstName lastName email')
        .populate('items.student', 'firstName lastName')
        .populate('items.teacher', 'firstName lastName')
        .populate('items.class', CLASS_FIELDS_FOR_INVOICE);
    }

    if (!invoiceDoc) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // If invoice is soft-deleted, only admins may access it
    if (invoiceDoc.deleted && req.user.role !== 'admin') {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (!invoiceDoc.invoiceSlug || !invoiceDoc.invoiceName) {
      await invoiceDoc.ensureIdentifiers({ forceNameRefresh: false });
      await invoiceDoc.save();
    }

    const dynamicClasses = await InvoiceService.buildDynamicClassList(invoiceDoc);
    const invoice = invoiceDoc.toObject();
    invoice.dynamicClasses = dynamicClasses;

    if (Array.isArray(invoice.items)) {
      invoice.items = invoice.items.map((item) => {
        if (!item || !item.class || typeof item.class !== 'object') {
          return item;
        }

        const classData = { ...item.class };
        const reportSubmission = classData.reportSubmission || {};
        const adminExtension = reportSubmission.adminExtension || {};
        const classReport = classData.classReport || {};

        const dateTime = classData.scheduledDate || classData.dateTime || item.date || null;
        const allowance = reportSubmission.teacherDeadline || null;
        const extendedUntil = adminExtension.expiresAt || null;

        classData.dateTime = dateTime;
        classData.reportSubmissionAllowance = allowance;
        classData.reportSubmissionExtendedUntil = extendedUntil;
        classData.classReport = {
          ...classReport,
          submittedAt: classReport.submittedAt || (item.classReport && item.classReport.submittedAt) || null
        };
        classData.reportSubmission = {
          ...reportSubmission,
          allowance,
          adminExtension: {
            ...adminExtension,
            extendedUntil: extendedUntil || adminExtension.expiresAt || null
          }
        };

        return {
          ...item,
          class: classData
        };
      });
    }

    // Role-based access check
    if (req.user.role === 'guardian' && invoice.guardian && invoice.guardian._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (req.user.role === 'teacher' && invoice.teacher && invoice.teacher._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    console.log('=== [Invoices API] GET /invoices/:id SUCCESS ===', { id: invoice._id });
    console.log('=== [Invoices API] GET /invoices/:id - invoice totals ===', {
      id: invoice._id,
      subtotal: invoice.subtotal,
      total: invoice.total,
      adjustedTotal: invoice.adjustedTotal,
      paidAmount: invoice.paidAmount,
      remaining: invoice.remainingBalance !== undefined ? invoice.remainingBalance : (invoice.total ? roundCurrency(invoice.total - (invoice.paidAmount || 0)) : undefined),
      guardianTransferFee: invoice.guardianFinancial && invoice.guardianFinancial.transferFee ? invoice.guardianFinancial.transferFee : null
    });
    res.json({ success: true, invoice });
  } catch (err) {
    console.error('Get invoice error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch invoice', error: err.message });
  }
});



// -----------------------------
// Create manual invoice (Admin)
// -----------------------------
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('=== [Invoices API] POST /invoices START ===', { body: req.body, user: req.user?._id });
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can create invoices' });
    }

    const { type, guardian, teacher, items, dueDate, notes, isAdvancePayment, advancePaymentPeriod } = req.body;
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    let guardianFinancial = null;
    let coverageDefaults = null;
    if (type === 'guardian_invoice') {
      const guardianDoc = guardian ? await User.findById(guardian) : null;
      guardianFinancial = buildGuardianFinancialSnapshot(guardianDoc);
      coverageDefaults = { strategy: 'full_period', waiveTransferFee: false };
    }

    const invoice = new Invoice({
      type,
      guardian: type === 'guardian_invoice' ? guardian : undefined,
      teacher: type === 'teacher_payment' ? teacher : undefined,
      billingPeriod: {
        startDate: now,
        endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        month,
        year
      },
      items,
      dueDate: dueDate ? new Date(dueDate) : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      notes,
      isAdvancePayment,
      advancePaymentPeriod,
      createdBy: req.user._id,
      ...(type === 'guardian_invoice' ? {
        guardianFinancial,
        coverage: coverageDefaults
      } : {})
    });

    await invoice.ensureIdentifiers({ forceNameRefresh: false });
    await invoice.save();
  await invoice.populate('guardian', 'firstName lastName email guardianInfo.hourlyRate guardianInfo.transferFee');

    await invoice.recordAuditEntry({
      actor: req.user?._id,
      action: 'create',
      diff: {
        type,
        billingType: invoice.billingType,
        subtotal: invoice.subtotal,
        total: invoice.total,
        itemCount: Array.isArray(invoice.items) ? invoice.items.length : 0
      },
      meta: {
        route: 'POST /api/invoices',
        guardian: guardian ? guardian.toString?.() || guardian : undefined,
        teacher: teacher ? teacher.toString?.() || teacher : undefined
      }
    });

    // Notification trigger: invoice created
    try {
      const notificationService = require('../services/notificationService');
      notificationService.notifyInvoiceEvent({
        invoice,
        eventType: 'created'
      }).catch(console.error);
    } catch (e) { console.warn("Notification trigger failed", e.message); }

    // Realtime update: emit invoice created
    try {
      const io = req.app.get('io');
      if (io) io.emit('invoice:created', { invoice: invoice.toObject({ virtuals: true }) });
    } catch (emitErr) {
      console.warn('Failed to emit invoice:created socket event', emitErr.message);
    }

    res.status(201).json({ success: true, message: 'Invoice created successfully', invoice });
    console.log('=== [Invoices API] POST /invoices SUCCESS ===', { id: invoice._id, invoiceNumber: invoice.invoiceNumber });
  } catch (err) {
    console.error('Create invoice error:', err);
    res.status(500).json({ success: false, message: 'Failed to create invoice', error: err.message });
  }
});

// -----------------------------
// Update invoice coverage (admin only)
// -----------------------------
router.put('/:id/coverage', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    strategy,
    maxHours,
    endDate,
    notes,
    filters,
    waiveTransferFee,
    transferFee,
    previewTotals
  } = req.body || {};

  try {
    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const previousCoverage = invoice.coverage && typeof invoice.coverage === 'object'
      ? {
          maxHours: invoice.coverage.maxHours,
          endDate: invoice.coverage.endDate
        }
      : {};

    if (!invoice.coverage || typeof invoice.coverage !== 'object') {
      invoice.coverage = {};
    }

    const coverage = invoice.coverage;
    const allowedStrategies = ['full_period', 'cap_hours', 'custom_end', 'custom'];
    if (typeof strategy === 'string' && strategy.trim()) {
      coverage.strategy = allowedStrategies.includes(strategy) ? strategy : 'custom';
    }

    if (maxHours === null || maxHours === undefined) {
      coverage.maxHours = undefined;
    } else if (Number.isFinite(Number(maxHours))) {
      const parsedMax = Number(maxHours);
      coverage.maxHours = parsedMax >= 0 ? parsedMax : undefined;
    }

    if (endDate === null) {
      coverage.endDate = undefined;
    } else if (endDate) {
      const parsedEnd = new Date(endDate);
      coverage.endDate = Number.isNaN(parsedEnd.getTime()) ? coverage.endDate : parsedEnd;
    }

    if (notes !== undefined) {
      coverage.notes = typeof notes === 'string' ? notes : undefined;
    }

    if (typeof waiveTransferFee === 'boolean') {
      coverage.waiveTransferFee = waiveTransferFee;
    }

    if (!coverage.filters || typeof coverage.filters !== 'object') {
      coverage.filters = {};
    }
    if (filters && typeof filters === 'object') {
      if (filters.statuses !== undefined) {
        coverage.filters.statuses = Array.isArray(filters.statuses)
          ? filters.statuses
              .map((status) => (typeof status === 'string' ? status.trim() : ''))
              .filter(Boolean)
          : [];
      }
      if (filters.maxDurationMinutes !== undefined) {
        const parsedDuration = Number(filters.maxDurationMinutes);
        coverage.filters.maxDurationMinutes = Number.isFinite(parsedDuration) && parsedDuration > 0
          ? parsedDuration
          : undefined;
      }
      if (filters.includeStudentIds !== undefined) {
        coverage.filters.includeStudentIds = Array.isArray(filters.includeStudentIds)
          ? filters.includeStudentIds.filter(Boolean)
          : [];
      }
      if (filters.excludeStudentIds !== undefined) {
        coverage.filters.excludeStudentIds = Array.isArray(filters.excludeStudentIds)
          ? filters.excludeStudentIds.filter(Boolean)
          : [];
      }
    }

  invoice.coverage = coverage;
  invoice.coverage.updatedAt = new Date();
  invoice.coverage.updatedBy = req.user._id;
  invoice.markModified('coverage');

    // ✅ CRITICAL: Refresh guardian data BEFORE recalculating to get latest rates
    const guardianDoc = invoice.guardian ? await User.findById(invoice.guardian) : null;
    if (guardianDoc) {
      invoice.guardianFinancial = buildGuardianFinancialSnapshot(guardianDoc);
      invoice.markModified('guardianFinancial');
    }

    if (transferFee && typeof transferFee === 'object') {
      const tf = invoice.guardianFinancial.transferFee || {};
      const allowedTFModes = ['fixed', 'percent'];
      if (transferFee.mode) {
        tf.mode = allowedTFModes.includes(transferFee.mode) ? transferFee.mode : tf.mode || 'fixed';
      }
      if (transferFee.value !== undefined) {
        const parsedValue = Number(transferFee.value);
        tf.value = Number.isFinite(parsedValue) ? parsedValue : tf.value || 0;
      }
      if (transferFee.notes !== undefined) {
        tf.notes = typeof transferFee.notes === 'string' ? transferFee.notes : undefined;
      }
      if (typeof transferFee.waived === 'boolean') {
        tf.waived = transferFee.waived;
      }
      tf.source = 'manual';
      invoice.guardianFinancial.transferFee = tf;
      invoice.markModified('guardianFinancial');
    }

    const prevMaxHours = Number(previousCoverage?.maxHours ?? 0) || 0;
    const nextMaxHours = Number(coverage?.maxHours ?? 0) || 0;
    const extendedByHours = nextMaxHours > prevMaxHours + 0.0005;

    const prevEndDate = previousCoverage?.endDate ? new Date(previousCoverage.endDate) : null;
    const nextEndDate = coverage?.endDate ? new Date(coverage.endDate) : null;
    const extendedByEndDate = nextEndDate && (!prevEndDate || nextEndDate > prevEndDate);

    let appendedDueToExtension = false;
    if (invoice.type === 'guardian_invoice' && (extendedByHours || extendedByEndDate)) {
      try {
        const extendResult = await InvoiceService.extendInvoiceWithScheduledClasses(invoice, {
          targetEndDate: coverage.endDate
        });
        if (extendResult?.added > 0) {
          appendedDueToExtension = true;
        }
      } catch (extendErr) {
        console.warn('Auto-extend invoice classes failed:', extendErr?.message || extendErr);
      }
    }

  const hasPreviewTotals = !appendedDueToExtension && previewTotals && typeof previewTotals === 'object';
  console.log('=== [Invoices API] PUT /invoices/:id/coverage - incoming previewTotals ===', { id, hasPreviewTotals, previewTotals });

  // Safety: if invoice already has recorded payments, avoid running a full
  // recalculation when no explicit `previewTotals` were provided by the UI.
  // This prevents unintended subtotal/total inflation that would turn a
  // previously-paid invoice into partially-unpaid and allow duplicate
  // crediting of guardian hours when admins re-save coverage.
  const hasRecordedPayments = Array.isArray(invoice.paymentLogs) && invoice.paymentLogs.some(l => l && Number(l.amount || 0) > 0 && l.method !== 'tip_distribution');

  if (hasPreviewTotals) {
    applyPreviewTotals(invoice, previewTotals);
  } else if (hasRecordedPayments) {
    console.log('=== [Invoices API] PUT /invoices/:id/coverage - skipping full recalc because invoice has payments and no previewTotals were provided', { id });
    // Only update guardianFinancial (transfer fee) if present, but do not recalc totals
    // so previously-applied payments remain consistent with the stored totals.
    // (guardianFinancial was refreshed earlier above.)
  } else if (typeof invoice.recalculateTotals === 'function') {
    invoice.recalculateTotals();
  }

    // ⚠️ DO NOT update billing window automatically - it should only be updated when explicitly requested
    // The billing window is set during invoice creation and should remain stable
    // updateBillingWindowFromItems(invoice);

    console.log('=== [Invoices API] PUT /invoices/:id/coverage - after apply/recalc totals ===', {
      id,
      subtotal: invoice.subtotal,
      total: invoice.total,
      adjustedTotal: invoice.adjustedTotal,
      paidAmount: invoice.paidAmount,
      guardianFinancial: invoice.guardianFinancial && invoice.guardianFinancial.transferFee ? invoice.guardianFinancial.transferFee : null
    });

    invoice.updatedBy = req.user._id;
    await invoice.ensureIdentifiers({ forceNameRefresh: !invoice.invoiceNameManual });
    await invoice.save();
  await invoice.populate('guardian', 'firstName lastName email phone guardianInfo.hourlyRate guardianInfo.transferFee');
    await invoice.populate('items.student', 'firstName lastName');

    // Attach dynamicClasses to the returned invoice object so the UI
    // receives the same dynamic class list as a GET /invoices/:id would.
    let invoiceObj = invoice.toObject({ virtuals: true });
    try {
      if (invoiceObj.type === 'guardian_invoice') {
        const dynamicClasses = await InvoiceService.buildDynamicClassList(invoice);
        invoiceObj.dynamicClasses = dynamicClasses;
      }
    } catch (dynErr) {
      console.warn('[PUT /invoices/:id/coverage] dynamic class build failed', id, dynErr?.message || dynErr);
    }

    res.json({
      success: true,
      invoice: invoiceObj,
      coverage: invoiceObj.coverage,
      guardianFinancial: invoiceObj.guardianFinancial
    });

    // Realtime update: emit invoice updated after coverage change
    try {
      const io = req.app.get('io');
      if (io) io.emit('invoice:updated', { invoice: invoice.toObject({ virtuals: true }) });
    } catch (emitErr) {
      console.warn('Failed to emit invoice:updated (coverage) socket event', emitErr.message);
    }
  } catch (err) {
    console.error('Update invoice coverage error:', err);
    res.status(500).json({ success: false, message: 'Failed to update invoice coverage', error: err.message });
  }
});

// -----------------------------
// Sync preview totals with invoice document (admin only)
// -----------------------------
router.put('/:id/snapshot', authenticateToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { previewTotals } = req.body || {};

  if (!previewTotals || typeof previewTotals !== 'object') {
    return res.status(400).json({ success: false, message: 'previewTotals object is required' });
  }

  try {
    console.log('=== [Invoices API] PUT /invoices/:id/snapshot - incoming previewTotals ===', { id, previewTotals });
    const invoice = await Invoice.findById(id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    applyPreviewTotals(invoice, previewTotals);
    invoice.updatedBy = req.user._id;

    await invoice.ensureIdentifiers({ forceNameRefresh: !invoice.invoiceNameManual });
    await invoice.save();
    console.log('=== [Invoices API] PUT /invoices/:id/snapshot - saved invoice totals ===', {
      id,
      subtotal: invoice.subtotal,
      total: invoice.total,
      adjustedTotal: invoice.adjustedTotal,
      paidAmount: invoice.paidAmount,
      guardianFinancial: invoice.guardianFinancial && invoice.guardianFinancial.transferFee ? invoice.guardianFinancial.transferFee : null
    });
    await invoice.populate('guardian', 'firstName lastName email phone guardianInfo.hourlyRate guardianInfo.transferFee');
    await invoice.populate('items.student', 'firstName lastName');

    // Mirror GET behavior: attach dynamicClasses so UI receives consistent class list
    let invoiceObj = invoice.toObject({ virtuals: true });
    try {
      if (invoiceObj.type === 'guardian_invoice') {
        const dynamicClasses = await InvoiceService.buildDynamicClassList(invoice);
        invoiceObj.dynamicClasses = dynamicClasses;
      }
    } catch (dynErr) {
      console.warn('[PUT /invoices/:id/snapshot] dynamic class build failed', id, dynErr?.message || dynErr);
    }

    res.json({ success: true, invoice: invoiceObj });

    // ⚠️ DO NOT update billing window - it should remain as set during invoice creation
    // try { updateBillingWindowFromItems(invoice); } catch (_) {}
    
    // Realtime update: emit invoice updated after snapshot save
    try {
      const io = req.app.get('io');
      if (io) io.emit('invoice:updated', { invoice: invoice.toObject({ virtuals: true }) });
    } catch (emitErr) {
      console.warn('Failed to emit invoice:updated (snapshot) socket event', emitErr.message);
    }
  } catch (err) {
    console.error('Sync invoice snapshot error:', err);
    res.status(500).json({ success: false, message: 'Failed to sync invoice snapshot', error: err.message });
  }
});

// -----------------------------
// Update invoice (admin only)
// -----------------------------
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  console.log("=== [Invoices API] PUT /invoices/:id START ===");
  console.log("[Invoices API] Params.id:", req.params.id);
  console.log("[Invoices API] Request body:", req.body);

  try {
    const { id } = req.params;
    const updateData = req.body;

    console.log("[Invoices API] Fetching invoice from DB...");
    const invoice = await Invoice.findById(id);
    if (!invoice) {
      console.warn("[Invoices API] Invoice not found:", id);
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    console.log("[Invoices API] Invoice found:", invoice._id);

    const snapshotBefore = {
      status: invoice.status,
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
      exchangeRate: invoice.exchangeRate,
      notes: invoice.notes,
      internalNotes: invoice.internalNotes,
      billingPeriod: {
        startDate: invoice.billingPeriod?.startDate ? invoice.billingPeriod.startDate.toISOString() : null,
        endDate: invoice.billingPeriod?.endDate ? invoice.billingPeriod.endDate.toISOString() : null,
        month: invoice.billingPeriod?.month,
        year: invoice.billingPeriod?.year
      },
      excludedClassIds: Array.isArray(invoice.excludedClassIds) ? invoice.excludedClassIds.map((cid) => cid?.toString()) : [],
      subtotal: invoice.subtotal,
      total: invoice.total,
      adjustedTotal: invoice.adjustedTotal,
      invoiceName: invoice.invoiceName,
      invoiceSequence: invoice.invoiceSequence,
      invoiceNumber: invoice.invoiceNumber
    };

    if (Object.prototype.hasOwnProperty.call(updateData, 'invoiceName')) {
      const incomingName = typeof updateData.invoiceName === 'string' ? updateData.invoiceName.trim() : '';
      if (incomingName) {
        invoice.invoiceName = incomingName;
        invoice.invoiceNameManual = true;
        const manualSequence = extractSequenceFromName(incomingName);
        if (Number.isFinite(manualSequence)) {
          invoice.invoiceSequence = manualSequence;
          invoice.paypalInvoiceNumber = formatSequence(manualSequence);
          await ensureSequenceAtLeast(invoice.type || 'guardian_invoice', manualSequence);
        }
      } else {
        invoice.invoiceNameManual = false;
      }
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'paypalInvoiceNumber')) {
      const incomingPaypal = typeof updateData.paypalInvoiceNumber === 'string'
        ? updateData.paypalInvoiceNumber.trim()
        : '';
      invoice.paypalInvoiceNumber = incomingPaypal || null;
    }

    // --- Teacher Payment
    if (updateData.teacherPayment) {
      console.log("[Invoices API] Updating teacherPayment:", updateData.teacherPayment);
      invoice.teacherPayment = {
        ...invoice.teacherPayment?.toObject?.() || {},
        ...updateData.teacherPayment
      };
    }

    // --- Exchange Rate, Status, Notes
    if (updateData.exchangeRate !== undefined) invoice.exchangeRate = updateData.exchangeRate;
    if (updateData.status) invoice.status = updateData.status;
    if (updateData.dueDate) invoice.dueDate = new Date(updateData.dueDate);
    if (updateData.notes !== undefined) invoice.notes = updateData.notes;
  if (updateData.internalNotes !== undefined) invoice.internalNotes = updateData.internalNotes;

    // --- Billing Period
    if (updateData.billingPeriod) {
      console.log("[Invoices API] Updating billingPeriod:", updateData.billingPeriod);
      invoice.billingPeriod.startDate = updateData.billingPeriod.startDate || invoice.billingPeriod.startDate;
      invoice.billingPeriod.endDate = updateData.billingPeriod.endDate || invoice.billingPeriod.endDate;
      invoice.billingPeriod.month = updateData.billingPeriod.month || invoice.billingPeriod.month;
      invoice.billingPeriod.year = updateData.billingPeriod.year || invoice.billingPeriod.year;
    }

    // --- Excluded Classes & Adjustments
    if (Array.isArray(updateData.excludedClassIds)) {
      invoice.applyClassExclusions(updateData.excludedClassIds);
    }

    // adjustments removed: ignore any incoming adjustments data

  invoice.recalculateTotals();
  await invoice.ensureIdentifiers({ forceNameRefresh: !invoice.invoiceNameManual });

    const snapshotAfter = {
      status: invoice.status,
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
      exchangeRate: invoice.exchangeRate,
      notes: invoice.notes,
      internalNotes: invoice.internalNotes,
      billingPeriod: {
        startDate: invoice.billingPeriod?.startDate ? invoice.billingPeriod.startDate.toISOString() : null,
        endDate: invoice.billingPeriod?.endDate ? invoice.billingPeriod.endDate.toISOString() : null,
        month: invoice.billingPeriod?.month,
        year: invoice.billingPeriod?.year
      },
      excludedClassIds: Array.isArray(invoice.excludedClassIds) ? invoice.excludedClassIds.map((cid) => cid?.toString()) : [],
      subtotal: invoice.subtotal,
      total: invoice.total,
      adjustedTotal: invoice.adjustedTotal,
      invoiceName: invoice.invoiceName,
      invoiceSequence: invoice.invoiceSequence,
      invoiceNumber: invoice.invoiceNumber
    };

    const diff = {};
    Object.keys(snapshotAfter).forEach((key) => {
      const beforeValue = snapshotBefore[key];
      const afterValue = snapshotAfter[key];
      const isEqual = JSON.stringify(beforeValue) === JSON.stringify(afterValue);
      if (!isEqual) {
        diff[key] = { before: beforeValue, after: afterValue };
      }
    });

    invoice.updatedBy = req.user?._id;
    if (Object.keys(diff).length > 0) {
      invoice.pushActivity({
        actor: req.user?._id,
        action: 'update',
        note: updateData?.activityNote || 'Invoice fields updated',
        diff
      });

      await invoice.recordAuditEntry({
        actor: req.user?._id,
        action: 'update',
        diff,
        meta: {
          route: 'PUT /api/invoices/:id'
        }
      });
    }
    console.log("[Invoices API] Saving invoice...");
    await invoice.save();
    await invoice.populate([
      { path: 'guardian', select: 'firstName lastName email phone' },
      { path: 'teacher', select: 'firstName lastName email' },
      { path: 'items.student', select: 'firstName lastName' }
    ]);

    console.log("=== [Invoices API] PUT /invoices/:id SUCCESS ===");
    res.json({ success: true, invoice });

    // Realtime update: emit invoice updated after general update
    try {
      const io = req.app.get('io');
      if (io) io.emit('invoice:updated', { invoice: invoice.toObject({ virtuals: true }) });
    } catch (emitErr) {
      console.warn('Failed to emit invoice:updated (fields) socket event', emitErr.message);
    }
  } catch (err) {
    console.error("=== [Invoices API] PUT /invoices/:id ERROR ===", err);
    res.status(500).json({ success: false, message: err.message });
  }
});




// Edit invoice items (add/remove/modify) - Admin
router.post('/:id/items', authenticateToken, async (req, res) => {
  console.log('=== [Invoices API] POST /invoices/:id/items START ===', { id: req.params.id, body: req.body, user: req.user?._id });
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success:false, message: 'Only admins' });

    const updates = req.body; // { addItems: [], removeItemIds: [], modifyItems: [] }
    const result = await InvoiceService.updateInvoiceItems(req.params.id, updates, req.user._id);
    if (!result.success) return res.status(400).json(result);
    console.log('=== [Invoices API] POST /invoices/:id/items SUCCESS ===', { id: req.params.id });
    res.json(result);

    // Realtime update: emit invoice updated after items change
    try {
      const io = req.app.get('io');
      if (io && result.invoice) io.emit('invoice:updated', { invoice: result.invoice.toObject ? result.invoice.toObject({ virtuals: true }) : result.invoice });
    } catch (emitErr) {
      console.warn('Failed to emit invoice:updated (items) socket event', emitErr.message);
    }
  } catch (err) {
    console.error('Edit invoice items error:', err);
    res.status(500).json({ success: false, message: 'Failed to edit invoice items', error: err.message });
  }
});

// Preview invoice item edits (dry-run, no persistence) - Admin
router.post('/:id/items/preview', authenticateToken, async (req, res) => {
  console.log('=== [Invoices API] POST /invoices/:id/items/preview START ===', { id: req.params.id, body: req.body, user: req.user?._id });
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Only admins' });

    const updates = req.body; // same shape as /items
    const result = await InvoiceService.previewInvoiceChanges(req.params.id, updates, req.user._id);
    if (!result.success) return res.status(400).json(result);
    console.log('=== [Invoices API] POST /invoices/:id/items/preview SUCCESS ===', { id: req.params.id });
    res.json(result);
  } catch (err) {
    console.error('Preview invoice items error:', err);
    res.status(500).json({ success: false, message: 'Failed to preview invoice items', error: err.message });
  }
});

// Toggle send (Admin)
router.post('/:id/toggle-send', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success:false, message: 'Only admins' });

    const {
      send,
      via,
      templateId,
      meta,
      sentAt,
      messageHash,
      note,
      deliveryStatus,
      reminderType,
      force
    } = req.body || {};

    const result = await InvoiceService.toggleInvoiceSent(req.params.id, {
      sent: typeof send === 'boolean' ? send : undefined,
      via,
      templateId,
      meta,
      sentAt,
      messageHash,
      note,
      deliveryStatus,
      reminderType,
      force,
      adminUserId: req.user._id
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('Toggle send error:', err);
    res.status(500).json({ success:false, message: 'Failed to toggle send', error: err.message });
  }
});

// POST send invoice (mark as sent / record method)
router.post('/:id/send', authenticateToken, async (req, res) => {
  console.log('=== [Invoices API] POST /invoices/:id/send START ===', { id: req.params.id, body: req.body, user: req.user?._id });
  try {
    const { id } = req.params;
    const {
      method,
      templateId,
      meta,
      sentAt,
      messageHash,
      note,
      deliveryStatus,
      reminderType,
      force
    } = req.body || {};

    const result = await InvoiceService.toggleInvoiceSent(id, {
      sent: true,
      via: method,
      templateId,
      meta,
      sentAt,
      messageHash,
      note,
      deliveryStatus,
      reminderType,
      force,
      adminUserId: req.user?._id
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    console.log('=== [Invoices API] POST /invoices/:id/send SUCCESS ===', { id: req.params.id });
    if (result.alreadySent) {
      return res.json({ success: true, message: 'Already sent', alreadySent: true, invoice: result.invoice });
    }

    res.json({ success: true, message: 'Invoice marked as sent', invoice: result.invoice });

    // Realtime update: emit invoice updated after send
    try {
      const io = req.app.get('io');
      if (io && result.invoice) io.emit('invoice:updated', { invoice: result.invoice });
    } catch (emitErr) {
      console.warn('Failed to emit invoice:updated (send) socket event', emitErr.message);
    }
  } catch (err) {
    console.error('Send invoice error:', err);
    res.status(500).json({ success:false, message: 'Failed to send invoice', error: err.message });
  }
});

// Download invoice summary .docx
router.get('/:id/download-docx', authenticateToken, async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const invoice = await Invoice.findById(invoiceId)
      .populate('guardian','firstName lastName email guardianInfo.hourlyRate guardianInfo.transferFee')
      .populate('items.student','firstName lastName email');
    if (!invoice) return res.status(404).json({ success:false, message: 'Invoice not found' });

    if (req.user.role === 'guardian' && invoice.guardian && invoice.guardian._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success:false, message: 'Access denied' });
    }

    const docResult = await InvoiceService.generateInvoiceDocx(invoiceId);
    if (!docResult.success) return res.status(500).json({ success:false, message: docResult.error });

    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceNumber}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(Buffer.from(docResult.buffer));
  } catch (err) {
    console.error('Download docx error:', err);
    res.status(500).json({ success:false, message: 'Failed to generate docx', error: err.message });
  }
});

// Revert invoice payments and mark as unpaid
router.post('/:id/mark-unpaid', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('=== [Invoices API] POST /invoices/:id/mark-unpaid START ===', { id: req.params.id, user: req.user?._id });
    const result = await InvoiceService.revertInvoiceToUnpaid(req.params.id, req.user?._id, req.body || {});
    if (!result.success) {
      const statusCode = result.error === 'no_payments' ? 409 : 400;
      return res.status(statusCode).json(result);
    }

    const invoice = result.invoice;
    let guardian = null;
    try {
      if (result.guardianSnapshot) {
        guardian = result.guardianSnapshot;
      } else {
        const guardianId = result.guardianId || (invoice?.guardian && invoice.guardian._id) || invoice?.guardian;
        if (guardianId) {
          guardian = await User.findById(guardianId)
            .select('firstName lastName email phone guardianInfo')
            .lean();
        }
      }
    } catch (guardianErr) {
      console.warn('Failed to load guardian after mark-unpaid', guardianErr && guardianErr.message);
    }

    let dashboard = null;
    try {
      const { recomputeDashboardStats, CACHE_KEY } = require('../jobs/recomputeDashboardStats');
      const payload = await recomputeDashboardStats();
      dashboard = { refreshed: true, cacheKey: CACHE_KEY, timestamps: payload?.timestamps, summary: payload?.summary };
      try {
        const io = req.app.get('io');
        if (io && dashboard) io.emit('dashboard:statsUpdated', dashboard);
      } catch (_) {}
    } catch (dashErr) {
      console.warn('Dashboard recompute after mark-unpaid failed', dashErr && dashErr.message);
    }

    res.json({
      success: true,
      message: 'Invoice marked as unpaid',
      invoice,
      guardian,
      dashboard,
      amountReverted: result.amountReverted,
      hoursReverted: result.hoursReverted,
      tipReverted: result.tipReverted
    });

    try {
      const io = req.app.get('io');
      if (io && invoice) {
        io.emit('invoice:updated', { invoice });
      }
    } catch (emitErr) {
      console.warn('Failed to emit invoice update after mark-unpaid', emitErr && emitErr.message);
    }
  } catch (err) {
    console.error('Mark invoice unpaid error:', err);
    res.status(500).json({ success:false, message: 'Failed to mark invoice unpaid', error: err.message });
  }
});

// Register payment for invoice
router.post('/:id/payment', authenticateToken, async (req, res) => {
  try {
    console.log('=== [Invoices API] POST /invoices/:id/payment START ===', { id: req.params.id, body: req.body, user: req.user?._id });
    const invoiceId = req.params.id;
    const { amount, paymentMethod, transactionId, tip, paidHours, note, paidAt } = req.body;
    if (!amount || !paymentMethod) return res.status(400).json({ success:false, message: 'Must provide amount and paymentMethod' });

    // Build payment payload including optional tip and paidHours
    const paymentPayload = {
      amount: Number(amount),
      paymentMethod,
      transactionId,
      tip: tip !== undefined ? Number(tip) : undefined,
      paidHours: paidHours !== undefined ? Number(paidHours) : undefined,
      note: note !== undefined ? String(note) : undefined,
      paidAt: paidAt ? new Date(paidAt) : undefined
    };
    // Support Idempotency-Key header for safe retries
    const idempotencyKey = req.get('Idempotency-Key') || req.get('idempotency-key') || null;
    if (idempotencyKey) paymentPayload.idempotencyKey = String(idempotencyKey);

    // If the client included a paypalInvoiceNumber, persist it before processing payment
    if (req.body.paypalInvoiceNumber !== undefined) {
      try {
        const incoming = typeof req.body.paypalInvoiceNumber === 'string' ? req.body.paypalInvoiceNumber.trim() : String(req.body.paypalInvoiceNumber || '');
        if (incoming) {
          const invDoc = await Invoice.findById(invoiceId);
          if (invDoc) {
            invDoc.paypalInvoiceNumber = incoming;
            invDoc.updatedBy = req.user?._id;
            await invDoc.save();
            console.log('=== [Invoices API] POST /invoices/:id/payment - saved paypalInvoiceNumber ===', { id: invoiceId, paypalInvoiceNumber: incoming });
          }
        }
      } catch (saveErr) {
        console.error('Failed to persist paypalInvoiceNumber before payment:', saveErr);
      }
    }
    const result = await InvoiceService.processInvoicePayment(invoiceId, paymentPayload, req.user._id);
    if (!result.success) return res.status(400).json(result);

    console.log('=== [Invoices API] POST /invoices/:id/payment SUCCESS ===', { id: invoiceId, amount: paymentPayload.amount, method: paymentPayload.paymentMethod });

    // Load updated guardian snapshot to return immediately
    let guardian = null;
    try {
      const guardianId = (result.invoice?.guardian && result.invoice.guardian._id) || result.invoice?.guardian;
      if (guardianId) {
        guardian = await User.findById(guardianId)
          .select('firstName lastName email phone guardianInfo')
          .lean();
      }
    } catch (gErr) {
      console.warn('Failed to fetch guardian after payment', gErr && gErr.message);
    }

    // Recompute dashboard stats cache so UI reflects totals right away
    let dashboard = null;
    try {
      const { recomputeDashboardStats, CACHE_KEY } = require('../jobs/recomputeDashboardStats');
      const payload = await recomputeDashboardStats();
      dashboard = { refreshed: true, cacheKey: CACHE_KEY, timestamps: payload?.timestamps, summary: payload?.summary };
      try {
        const io = req.app.get('io');
        if (io && dashboard) io.emit('dashboard:statsUpdated', dashboard);
      } catch (_) {}
    } catch (dashErr) {
      console.warn('Dashboard recompute after payment failed', dashErr && dashErr.message);
    }

    res.json({ success: true, message: 'Payment recorded', invoice: result.invoice, guardian, dashboard });

    // Realtime update: emit invoice updated/paid
    try {
      const io = req.app.get('io');
      if (io && result.invoice) {
        io.emit('invoice:updated', { invoice: result.invoice });
        const status = String(result.invoice.status || '').toLowerCase();
        if (status === 'paid') io.emit('invoice:paid', { invoice: result.invoice });
        else if (status === 'partially_paid') io.emit('invoice:partially_paid', { invoice: result.invoice });
      }
    } catch (emitErr) {
      console.warn('Failed to emit invoice payment socket events', emitErr.message);
    }
  } catch (err) {
    console.error('Register payment error:', err);
    res.status(500).json({ success:false, message: 'Failed to register payment', error: err.message });
  }
});

// Pending invoices for current guardian
router.get('/my/pending', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'guardian') return res.status(403).json({ success:false, message: 'Only guardians' });
    const result = await InvoiceService.getPendingInvoicesForGuardian(req.user._id);
    if (!result.success) return res.status(500).json(result);
    res.json({ success: true, invoices: result.invoices });
  } catch (err) {
    console.error('Get my pending error:', err);
    res.status(500).json({ success:false, message: 'Failed to fetch', error: err.message });
  }
});

// check and create zero-hour invoices (trigger)
router.post('/check-zero-hours', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ success:false, message: 'Only admins' });
    const result = await InvoiceService.checkAndCreateZeroHourInvoices();
    res.json(result);
  } catch (err) {
    console.error('Check zero hours error:', err);
    res.status(500).json({ success:false, message: 'Failed to check zero hours', error: err.message });
  }
});

// Admin: resequence unpaid invoices to close numbering gaps
router.post('/admin/resequence-unpaid', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { startAfterInvoiceId } = req.body; // optional

    // Load unpaid invoices sorted by createdAt or sequence
    const unpaid = await Invoice.find({ status: { $in: ['draft','pending','sent','overdue','partially_paid'] } }).sort({ createdAt: 1 }).exec();

    if (!Array.isArray(unpaid) || unpaid.length === 0) {
      return res.json({ success: true, message: 'No unpaid invoices to resequence', updated: 0 });
    }

    // Determine starting sequence from settings or first invoice
    let nextSeq = await allocateNextSequence('guardian_invoice');

  let updatedCount = 0;
  const updatedList = [];
  for (const inv of unpaid) {
      if (startAfterInvoiceId && inv._id.toString() === startAfterInvoiceId) {
        // start resequencing after this one
        continue;
      }

      const ids = buildInvoiceIdentifiers({ sequence: nextSeq, monthContext: inv.items ? undefined : undefined });
      inv.sequence = ids.sequence;
      inv.invoiceNumber = ids.invoiceNumber;
      inv.invoiceName = ids.invoiceName;
      inv.invoiceSlug = ids.invoiceSlug;
      await inv.save();
      nextSeq++;
      updatedCount++;
      updatedList.push({ id: inv._id.toString(), invoiceNumber: inv.invoiceNumber, invoiceName: inv.invoiceName });
    }

    // Ensure setting is at least the last sequence used
    await ensureSequenceAtLeast('guardian_invoice', nextSeq - 1);
    console.info('[Invoices API] Resequence completed. Updated invoices:', updatedList);
    res.json({ success: true, message: 'Resequenced unpaid invoices', updated: updatedCount, updatedList });
  } catch (err) {
    console.error('Resequence unpaid invoices error:', err);
    res.status(500).json({ success:false, message: 'Failed to resequence', error: err.message });
  }
});

// Delete draft invoice (Admin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }
    const force = String(req.query.force || req.body?.force || '').toLowerCase() === 'true';
    // For safety, allow deleting drafts/pending normally. For paid/sent/overdue, require force to reverse hours and then soft-delete.
    if (!['draft', 'pending'].includes(invoice.status)) {
      if (!force) {
        return res.status(409).json({ success: false, message: 'Invoice is not draft/pending. Use force=true to void and reverse hours.' });
      }
      // If force and invoice has payments, reverse proportionate hours by issuing a refund equal to paidAmount
      try {
        const paidTotal = Number(invoice.paidAmount || 0);
        if (paidTotal > 0.009) {
          // Compute credited hours proportion based on payments vs. total
          const totalBase = Number(invoice.adjustedTotal || invoice.total || 0);
          const proportion = totalBase > 0 ? Math.min(1, paidTotal / totalBase) : 0;
          const hoursFromItems = (Array.isArray(invoice.items) ? invoice.items : []).reduce((s, it) => s + ((Number(it?.duration || 0) || 0) / 60), 0);
          const refundHours = Math.round((hoursFromItems * proportion) * 1000) / 1000;
          const { recordInvoiceRefund } = require('../services/invoiceService');
          try {
            await recordInvoiceRefund(String(invoice._id), { amount: paidTotal, refundHours, reason: 'void_invoice_refund' }, req.user._id);
          } catch (refundErr) {
            console.warn('Force delete refund failed:', refundErr && refundErr.message);
          }
        }
      } catch (forceErr) {
        console.warn('Force delete pre-processing failed:', forceErr && forceErr.message);
      }
    }

  // Soft-delete: mark invoice as deleted rather than removing from DB
    invoice.deleted = true;
    invoice.deletedAt = new Date();
    invoice.deletedBy = req.user._id;

    // ✅ Clear billedInInvoiceId from all classes in this invoice so they can be re-invoiced
    try {
      const Class = require('../models/Class');
      const classIds = (invoice.items || []).map(it => it.class || it.lessonId).filter(Boolean);
      if (classIds.length > 0) {
        await Class.updateMany(
          { _id: { $in: classIds }, billedInInvoiceId: invoice._id },
          { $unset: { billedInInvoiceId: 1, billedAt: 1 } }
        );
        console.log(`✅ Cleared billedInInvoiceId for ${classIds.length} classes from deleted invoice ${invoice._id}`);
      }
    } catch (clearErr) {
      console.warn('Failed to clear billedInInvoiceId from classes:', clearErr.message);
    }

    // Audit and activity entry (guarded with local try/catch so we can surface errors)
    try {
      invoice.pushActivity({
        actor: req.user._id,
        action: 'delete',
        note: 'Draft invoice soft-deleted by admin',
        diff: { status: invoice.status }
      });

      await invoice.recordAuditEntry({
        actor: req.user._id,
        action: 'delete',
        diff: { invoiceId: invoice._id.toString(), status: invoice.status, invoiceNumber: invoice.invoiceNumber, deleted: true },
        meta: { route: 'DELETE /api/invoices/:id' }
      });

      await invoice.save();
    } catch (innerErr) {
      // Log detailed info for debugging: include validation errors when present
      console.error('Delete invoice - inner error while pushing audit/saving:', innerErr);
      if (innerErr && innerErr.name === 'ValidationError' && innerErr.errors) {
        console.error('Validation errors:', Object.keys(innerErr.errors).reduce((acc, k) => {
          acc[k] = innerErr.errors[k].message;
          return acc;
        }, {}));
      }
      // Re-throw to be handled by outer catch which will return 500
      throw innerErr;
    }

    // Emit socket event for frontend listeners (keep legacy event name)
    try {
      const io = req.app.get('io');
      if (io) io.emit('invoice:deleted', { id: invoice._id.toString(), invoiceNumber: invoice.invoiceNumber, deleted: true });
    } catch (emitErr) {
      console.warn('Failed to emit invoice:deleted socket event', emitErr.message);
    }

    res.json({ success: true, message: 'Draft invoice soft-deleted', invoiceId: invoice._id });
  } catch (err) {
    console.error('Delete invoice error:', err);
    const response = { success: false, message: 'Failed to delete invoice', error: err.message };
    // In non-production environments include the stack to help debugging
    try {
      if (process.env.NODE_ENV !== 'production' && err && err.stack) response.errorStack = err.stack;
    } catch (e) {
      // ignore
    }
    res.status(500).json(response);
  }
});


// Restore a soft-deleted draft invoice (Admin)
router.post('/:id/restore', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    if (!invoice.deleted) return res.status(400).json({ success: false, message: 'Invoice is not deleted' });

    // Only drafts should be restorable in this flow — if status changed, still allow admins to restore
    invoice.deleted = false;
    invoice.deletedAt = null;
    invoice.deletedBy = null;

    invoice.pushActivity({
      actor: req.user._id,
      action: 'update',
      note: 'Draft invoice restored by admin',
      diff: { restored: true }
    });

    await invoice.recordAuditEntry({
      actor: req.user._id,
      action: 'restore',
      diff: { invoiceId: invoice._id.toString(), invoiceNumber: invoice.invoiceNumber },
      meta: { route: 'POST /api/invoices/:id/restore' }
    });

    await invoice.save();

    try {
      const io = req.app.get('io');
      if (io) io.emit('invoice:restored', { id: invoice._id.toString(), invoiceNumber: invoice.invoiceNumber });
    } catch (emitErr) {
      console.warn('Failed to emit invoice:restored socket event', emitErr.message);
    }

    res.json({ success: true, message: 'Invoice restored', invoice });
  } catch (err) {
    console.error('Restore invoice error:', err);
    res.status(500).json({ success: false, message: 'Failed to restore invoice', error: err.message });
  }
});

// Permanently delete an invoice from the database (Admin only, for deleted drafts)
router.delete('/:id/permanent', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    // Only allow permanent deletion of already soft-deleted invoices
    if (!invoice.deleted) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invoice must be soft-deleted first. Only deleted invoices can be permanently removed.' 
      });
    }

    // Store info for logging and response
    const invoiceId = invoice._id.toString();
    const invoiceNumber = invoice.invoiceNumber;
    const guardianId = invoice.guardian;

    // Log the permanent deletion in audit trail before deleting
    try {
      const InvoiceAudit = require('../models/InvoiceAudit');
      await InvoiceAudit.create({
        invoiceId: invoice._id,
        actor: req.user._id,
        action: 'permanent_delete',
        diff: {
          invoiceNumber: invoice.invoiceNumber,
          guardian: guardianId,
          total: invoice.total,
          status: invoice.status,
          deletedBy: req.user._id,
          deletedAt: new Date()
        },
        meta: { 
          route: 'DELETE /api/invoices/:id/permanent',
          warning: 'Invoice permanently removed from database'
        }
      });
    } catch (auditErr) {
      console.error('Failed to create permanent deletion audit entry:', auditErr);
      // Continue with deletion even if audit fails
    }

    // Permanently delete the invoice from database
    await Invoice.deleteOne({ _id: invoice._id });

    console.log(`[Invoices API] Invoice ${invoiceNumber} (${invoiceId}) permanently deleted by admin ${req.user._id}`);

    // Emit socket event
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('invoice:permanentlyDeleted', { 
          id: invoiceId, 
          invoiceNumber: invoiceNumber 
        });
      }
    } catch (emitErr) {
      console.warn('Failed to emit invoice:permanentlyDeleted socket event', emitErr.message);
    }

    res.json({ 
      success: true, 
      message: 'Invoice permanently deleted from database', 
      invoiceId,
      invoiceNumber 
    });
  } catch (err) {
    console.error('Permanent delete invoice error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to permanently delete invoice', 
      error: err.message 
    });
  }
});

// Cancel invoice (Admin)
router.post('/:id/cancel', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    if (['paid', 'refunded'].includes(invoice.status)) {
      return res.status(400).json({ success: false, message: 'Cannot cancel a paid or refunded invoice' });
    }

    const reason = (req.body?.reason || 'Cancelled by admin').trim();
    const timestamp = new Date().toISOString();
    invoice.status = 'cancelled';
    invoice.internalNotes = `${invoice.internalNotes || ''}\n[${timestamp}] Cancelled: ${reason}`.trim();
    invoice.updatedBy = req.user._id;
    await invoice.save();

    try {
      const notificationService = require('../services/notificationService');
      notificationService.notifyInvoiceEvent({
        invoice,
        eventType: 'cancelled'
      }).catch(console.error);
    } catch (notifyErr) {
      console.warn('Invoice cancellation notification failed', notifyErr.message);
    }

    res.json({ success: true, message: 'Invoice cancelled', invoice });
  } catch (err) {
    console.error('Cancel invoice error:', err);
    res.status(500).json({ success: false, message: 'Failed to cancel invoice', error: err.message });
  }
});

// PUT mark as paid / log payment (Admin)
// PUT mark as paid / log payment (Admin)
router.put('/:id/pay', authenticateToken, async (req, res) => {
  try {
    console.log('=== [Invoices API] PUT /invoices/:id/pay START ===', { id: req.params.id, body: req.body, user: req.user?._id });
    if (req.user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Only admins can mark payments' });

    const { id } = req.params;
    const {
      amountPaid,
      tip = 0,
      paymentMethod = 'manual',
      transactionId,
      paidHours,
      note
    } = req.body;

    const amountValue = Number(amountPaid);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid payment amount' });
    }

    const paymentPayload = {
      amount: amountValue,
      paymentMethod,
      transactionId,
      tip: Number.isFinite(Number(tip)) ? Number(tip) : 0,
      paidHours: typeof paidHours !== 'undefined' ? Number(paidHours) : undefined,
      note
    };
    const idempotencyKey = req.get('Idempotency-Key') || req.get('idempotency-key') || null;
    if (idempotencyKey) paymentPayload.idempotencyKey = String(idempotencyKey);

    const result = await InvoiceService.processInvoicePayment(id, paymentPayload, req.user._id);
    if (!result.success) {
      return res.status(400).json(result);
    }

    console.log('=== [Invoices API] PUT /invoices/:id/pay SUCCESS ===', { id, amount: paymentPayload.amount, method: paymentPayload.paymentMethod });

    // Load updated guardian snapshot
    let guardian = null;
    try {
      const guardianId = (result.invoice?.guardian && result.invoice.guardian._id) || result.invoice?.guardian;
      if (guardianId) {
        guardian = await User.findById(guardianId)
          .select('firstName lastName email phone guardianInfo')
          .lean();
      }
    } catch (gErr) {
      console.warn('Failed to fetch guardian after admin pay', gErr && gErr.message);
    }

    // Recompute dashboard stats cache for immediate UI refresh
    let dashboard = null;
    try {
      const { recomputeDashboardStats, CACHE_KEY } = require('../jobs/recomputeDashboardStats');
      const payload = await recomputeDashboardStats();
      dashboard = { refreshed: true, cacheKey: CACHE_KEY, timestamps: payload?.timestamps, summary: payload?.summary };
      try {
        const io = req.app.get('io');
        if (io && dashboard) io.emit('dashboard:statsUpdated', dashboard);
      } catch (_) {}
    } catch (dashErr) {
      console.warn('Dashboard recompute after admin pay failed', dashErr && dashErr.message);
    }

    res.json({ success: true, message: 'Payment recorded and guardian balance updated', invoice: result.invoice, guardian, dashboard });

    // Realtime update: emit invoice updated/paid
    try {
      const io = req.app.get('io');
      if (io && result.invoice) {
        io.emit('invoice:updated', { invoice: result.invoice });
        const status = String(result.invoice.status || '').toLowerCase();
        if (status === 'paid') io.emit('invoice:paid', { invoice: result.invoice });
        else if (status === 'partially_paid') io.emit('invoice:partially_paid', { invoice: result.invoice });
      }
    } catch (emitErr) {
      console.warn('Failed to emit invoice payment socket events', emitErr.message);
    }
  } catch (err) {
    console.error('Payment logging error:', err);
    res.status(500).json({ success: false, message: 'Failed to log payment', error: err.message });
  }
});


// Refund invoice (Admin)
router.post('/:id/refund', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { refundAmount, refundHours, reason, refundReference } = req.body || {};
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ success: false, message: 'Refund reason is required' });
    }
    const amountValue = Number(refundAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid refund amount' });
    }
    const hoursValue = Number(refundHours);
    if (!Number.isFinite(hoursValue) || hoursValue <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid refund hours' });
    }

    const result = await InvoiceService.recordInvoiceRefund(req.params.id, {
      amount: amountValue,
      refundHours: hoursValue,
      reason,
      refundReference
    }, req.user._id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const responseMessage = result.summary?.message || 'Refund recorded';
    res.json({ success: true, message: responseMessage, invoice: result.invoice, summary: result.summary });

    console.log('✅ [Invoices API] Refund processed', {
      invoiceId: req.params.id,
      message: responseMessage,
      summary: result.summary
    });

    // Realtime update: emit invoice updated/refunded
    try {
      const io = req.app.get('io');
      if (io && result.invoice) {
        io.emit('invoice:updated', { invoice: result.invoice });
        io.emit('invoice:refunded', { invoice: result.invoice });
      }
    } catch (emitErr) {
      console.warn('Failed to emit invoice refund socket events', emitErr.message);
    }
  } catch (err) {
    console.error('Refund invoice error:', err);
    res.status(500).json({ success: false, message: 'Failed to refund invoice', error: err.message });
  }
});

// Apply post-payment adjustment (reduce/increase/removeLessons) - Admin
router.post('/:id/adjustments', authenticateToken, requireAdmin, async (req, res) => {
  try {
    console.log('=== [Invoices API] POST /invoices/:id/adjustments START ===', { id: req.params.id, body: req.body, user: req.user?._id });
    const { id } = req.params;
    const payload = req.body || {};
    const result = await InvoiceService.applyPostPaymentAdjustment(id, payload, req.user._id);
    if (!result.success) return res.status(400).json(result);
    console.log('=== [Invoices API] POST /invoices/:id/adjustments SUCCESS ===', { id });
    res.json(result);
  } catch (err) {
    console.error('Apply post-payment adjustment error:', err);
    res.status(500).json({ success: false, message: 'Failed to apply post-payment adjustment', error: err.message });
  }
});

// Rollback an invoice change to a specific audit entry (admin)
router.post('/:id/rollback', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { auditId } = req.body || {};
    if (!auditId) return res.status(400).json({ success: false, message: 'auditId is required' });
    const result = await InvoiceService.rollbackInvoiceChange(id, auditId, req.user._id);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('Rollback invoice error:', err);
    res.status(500).json({ success: false, message: 'Failed to rollback invoice', error: err.message });
  }
});



module.exports = router;
