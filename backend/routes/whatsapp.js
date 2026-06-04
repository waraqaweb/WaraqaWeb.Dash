const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const whatsapp = require('../services/whatsappService');
const User = require('../models/User');
const Class = require('../models/Class');

// All WhatsApp endpoints are admin-only
router.use(authenticateToken, requireRole('admin'));

// GET /api/whatsapp/status — check if client is ready
router.get('/status', (_req, res) => {
  res.json(whatsapp.getStatus());
});

// POST /api/whatsapp/init — start client, return QR or ready
router.post('/init', async (_req, res) => {
  try {
    const result = await whatsapp.initialize();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/whatsapp/qr — poll for current QR (or ready)
router.get('/qr', async (_req, res) => {
  try {
    const result = await whatsapp.getQr();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/create-group — create group for a class
router.post('/create-group', async (req, res) => {
  try {
    const { classId } = req.body;
    if (!classId) return res.status(400).json({ error: 'classId required' });

    const cls = await Class.findById(classId).lean();
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    // Resolve teacher & guardian phone numbers
    const [teacher, guardian, studentUser] = await Promise.all([
      cls.teacher ? User.findById(cls.teacher).select('phone firstName lastName').lean() : null,
      cls.student?.guardianId ? User.findById(cls.student.guardianId).select('phone firstName lastName guardianInfo.students').lean() : null,
      cls.student?.studentId ? User.findOne({ _id: cls.student.studentId, role: 'student' }).select('phone whatsapp firstName lastName').lean() : null,
    ]);

    const teacherPhone = teacher?.phone || null;
    const guardianPhone = guardian?.phone || null;
    let embeddedStudent = null;
    if (guardian?.guardianInfo?.students && cls.student?.studentId) {
      embeddedStudent = guardian.guardianInfo.students.find(
        (student) => String(student._id) === String(cls.student.studentId)
      ) || null;
    }
    const studentPhone = studentUser?.whatsapp || studentUser?.phone || embeddedStudent?.whatsapp || embeddedStudent?.phone || null;

    // Resolve student name from guardian's embedded students
    let studentName = cls.student?.studentName || 'Student';
    if (embeddedStudent) {
      studentName = `${embeddedStudent.firstName || ''} ${embeddedStudent.lastName || ''}`.trim() || studentName;
    } else if (studentUser) {
      studentName = `${studentUser.firstName || ''} ${studentUser.lastName || ''}`.trim() || studentName;
    }

    const result = await whatsapp.createGroup({ teacherPhone, guardianPhone, studentPhone, studentName });
    res.json({
      ...result,
      participantPreview: {
        teacher: Boolean(teacherPhone),
        student: Boolean(studentPhone),
        guardian: Boolean(guardianPhone),
      },
    });
  } catch (err) {
    console.error('[WhatsApp] create-group error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/destroy — tear down client
router.post('/destroy', async (_req, res) => {
  await whatsapp.destroy();
  res.json({ ok: true });
});

module.exports = router;
