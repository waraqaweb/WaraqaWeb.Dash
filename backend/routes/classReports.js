// backend/routes/classReports.js
const express = require('express');
const router = express.Router();

const ClassReport = require('../models/ClassReport');
const Class = require('../models/Class');
const User = require('../models/User');
const InvoiceService = require('../services/invoiceService');

// Submit a new class report and auto-create first invoice if needed
router.post('/', async (req, res) => {
  try {
    const { classId, teacherId, guardianId, duration, subject, notes } = req.body || {};

    if (!teacherId || !guardianId || !duration) {
      return res.status(400).json({ error: 'teacherId, guardianId and duration are required.' });
    }

    const dur = Number(duration);
    if (!Number.isFinite(dur) || dur <= 0) return res.status(400).json({ error: 'Invalid duration value' });

    // 1) Save the report (lightweight)
    const report = await ClassReport.create({
      classId,
      teacherId,
      guardianId,
      subject,
      notes,
      duration: dur,
      createdBy: req.user ? req.user._id : undefined,
    });

    // 2) Optionally align the referenced Class (if provided)
    let classDoc = null;
    try {
      if (classId) {
        classDoc = await Class.findById(classId);
        if (classDoc) {
          let needsSave = false;
          
          // Update duration if it differs
          if (Number(classDoc.duration || 0) !== dur) {
            classDoc.duration = dur;
            needsSave = true;
          }
          
          // CRITICAL: Update status to 'attended' if not already a completed status
          // This triggers onClassStateChanged which updates teacher/guardian hours
          const completedStatuses = ['attended', 'missed_by_student', 'absent', 'cancelled'];
          if (!completedStatuses.includes(classDoc.status)) {
            console.log(`[ClassReport] Updating class ${classId} status: ${classDoc.status} → attended`);
            classDoc.status = 'attended';
            classDoc.wasReportSubmitted = true;
            needsSave = true;
          }
          
          if (needsSave) {
            await classDoc.save();
            console.log(`[ClassReport] Class ${classId} updated: duration=${dur}min, status=${classDoc.status}`);
          }
        }
      }
    } catch (err) {
      console.error('[ClassReport] Error updating class:', err);
    }

    // 3) First-lesson auto-invoice creation
    try {
      const guardian = await User.findById(guardianId);
      if (guardian && guardian.role === 'guardian') {
        // Only create if this guardian has no prior guardian invoices
        const hasAnyInvoice = await require('../models/Invoice').exists({ guardian: guardian._id, type: 'guardian_invoice' });
        if (!hasAnyInvoice) {
          await InvoiceService.createInvoiceForFirstLesson(guardian, classDoc || { _id: classId, duration: dur, scheduledDate: new Date(), subject }, { createdBy: req.user?._id });
        }
      }
    } catch (invErr) {
      console.warn('Auto-create first-lesson invoice failed:', invErr && invErr.message);
    }

    return res.json({
      message: 'Report saved',
      report,
    });
  } catch (err) {
    console.error('Error creating class report:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
});

module.exports = router;
