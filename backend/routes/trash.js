const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Trash = require('../models/Trash');
const Setting = require('../models/Setting');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { getRetentionHours, DEFAULT_RETENTION_HOURS } = require('../utils/trash');

// ── GET /api/trash ── list all trash items (paginated) ──────────────
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const typeFilter = req.query.type; // optional: 'invoice', 'class', 'teacher_invoice'

    const query = {};
    if (typeFilter && ['invoice', 'class', 'teacher_invoice'].includes(typeFilter)) {
      query.itemType = typeFilter;
    }

    const [items, total] = await Promise.all([
      Trash.find(query)
        .sort({ deletedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('deletedBy', 'firstName lastName email')
        .lean(),
      Trash.countDocuments(query),
    ]);

    res.json({
      success: true,
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[Trash] list error:', err);
    res.status(500).json({ success: false, message: 'Failed to list trash', error: err.message });
  }
});

// ── GET /api/trash/settings ─────────────────────────────────────────
router.get('/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const hours = await getRetentionHours();
    res.json({ success: true, retentionHours: hours });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/trash/settings ─────────────────────────────────────────
router.put('/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const hours = Number(req.body.retentionHours);
    if (!hours || hours < 1 || hours > 8760) { // max 1 year
      return res.status(400).json({ success: false, message: 'retentionHours must be between 1 and 8760' });
    }
    await Setting.findOneAndUpdate(
      { key: 'trash.retentionHours' },
      { value: hours, description: 'Hours before trash items are permanently deleted' },
      { upsert: true, new: true }
    );
    res.json({ success: true, retentionHours: hours });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/trash/:id/restore ─────────────────────────────────────
router.post('/:id/restore', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid trash item id' });
    }

    const trashItem = await Trash.findById(req.params.id);
    if (!trashItem) return res.status(404).json({ success: false, message: 'Trash item not found' });

    const { itemType, snapshot, itemId } = trashItem;

    switch (itemType) {
      case 'invoice': {
        const Invoice = require('../models/Invoice');
        const existing = await Invoice.findById(itemId);
        if (existing) {
          // Soft-deleted invoice still in DB — just un-delete
          existing.deleted = false;
          existing.deletedAt = null;
          existing.deletedBy = null;
          await existing.save();
        } else {
          // Re-create from snapshot
          const data = { ...snapshot };
          delete data.__v;
          data.deleted = false;
          data.deletedAt = null;
          data.deletedBy = null;
          await Invoice.create(data);
        }
        break;
      }
      case 'class': {
        const Class = require('../models/Class');
        const existing = await Class.findById(itemId);
        if (!existing) {
          const data = { ...snapshot };
          delete data.__v;
          await Class.create(data);
        }
        break;
      }
      case 'teacher_invoice': {
        const TeacherInvoice = require('../models/TeacherInvoice');
        const existing = await TeacherInvoice.findById(itemId);
        if (existing) {
          existing.deleted = false;
          await existing.save();
        } else {
          const data = { ...snapshot };
          delete data.__v;
          data.deleted = false;
          await TeacherInvoice.create(data);
        }
        break;
      }
      default:
        return res.status(400).json({ success: false, message: `Unknown item type: ${itemType}` });
    }

    await Trash.findByIdAndDelete(trashItem._id);

    // Emit socket event
    try {
      const io = req.app.get('io');
      if (io) io.emit('trash:restored', { itemType, itemId: String(itemId) });
    } catch (_) {}

    res.json({ success: true, message: `${itemType} restored`, itemType, itemId });
  } catch (err) {
    console.error('[Trash] restore error:', err);
    res.status(500).json({ success: false, message: 'Failed to restore', error: err.message });
  }
});

// ── POST /api/trash/bulk/restore ────────────────────────────────────
router.post('/bulk/restore', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array required' });
    }
    if (ids.length > 200) {
      return res.status(400).json({ success: false, message: 'Max 200 items per batch' });
    }

    const trashItems = await Trash.find({ _id: { $in: ids } });
    const results = { restored: 0, failed: [] };

    for (const trashItem of trashItems) {
      try {
        const { itemType, snapshot, itemId } = trashItem;

        switch (itemType) {
          case 'invoice': {
            const Invoice = require('../models/Invoice');
            const existing = await Invoice.findById(itemId);
            if (existing) {
              existing.deleted = false;
              existing.deletedAt = null;
              existing.deletedBy = null;
              await existing.save();
            } else {
              const data = { ...snapshot };
              delete data.__v;
              data.deleted = false;
              data.deletedAt = null;
              data.deletedBy = null;
              await Invoice.create(data);
            }
            break;
          }
          case 'class': {
            const Class = require('../models/Class');
            const existing = await Class.findById(itemId);
            if (!existing) {
              const data = { ...snapshot };
              delete data.__v;
              await Class.create(data);
            }
            break;
          }
          case 'teacher_invoice': {
            const TeacherInvoice = require('../models/TeacherInvoice');
            const existing = await TeacherInvoice.findById(itemId);
            if (existing) {
              existing.deleted = false;
              await existing.save();
            } else {
              const data = { ...snapshot };
              delete data.__v;
              data.deleted = false;
              await TeacherInvoice.create(data);
            }
            break;
          }
        }

        await Trash.findByIdAndDelete(trashItem._id);
        results.restored++;
      } catch (e) {
        results.failed.push({ id: String(trashItem._id), error: e.message });
      }
    }

    try {
      const io = req.app.get('io');
      if (io) io.emit('trash:bulkRestored');
    } catch (_) {}

    res.json({ success: true, ...results });
  } catch (err) {
    console.error('[Trash] bulk restore error:', err);
    res.status(500).json({ success: false, message: 'Failed to bulk restore', error: err.message });
  }
});

// ── DELETE /api/trash/:id ── permanently delete from trash ──────────
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid trash item id' });
    }
    const item = await Trash.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Trash item not found' });
    res.json({ success: true, message: 'Permanently deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/trash/empty ── empty entire trash ─────────────────────
router.post('/empty', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await Trash.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/trash/bulk/delete ─────────────────────────────────────
router.post('/bulk/delete', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array required' });
    }
    const result = await Trash.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
