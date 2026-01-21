const LibraryItem = require('../models/library/LibraryItem');
const Class = require('../models/Class');
const Setting = require('../models/Setting');
const libraryService = require('../services/libraryService');

const DEFAULT_RETENTION_DAYS = 90;

async function resolveRetentionDays(options = {}) {
  const explicit = Number(options.retentionDays);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const dbSetting = await Setting.findOne({ key: 'whiteboardScreenshotRetentionDays' }).lean();
  const dbValue = Number(dbSetting?.value);
  if (Number.isFinite(dbValue) && dbValue > 0) return dbValue;

  const envValue = Number(process.env.WHITEBOARD_SCREENSHOT_RETENTION_DAYS);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;

  return DEFAULT_RETENTION_DAYS;
}

async function runWhiteboardScreenshotCleanup(options = {}) {
  const retentionDays = await resolveRetentionDays(options);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { success: false, message: 'Invalid retention days' };
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const candidates = await LibraryItem.find({
    'metadata.source': 'whiteboard'
  })
    .select('_id metadata createdAt')
    .limit(500)
    .lean();

  if (!candidates.length) {
    return { success: true, removed: 0 };
  }

  let removed = 0;
  for (const item of candidates) {
    try {
      let shouldRemove = false;
      const classId = item?.metadata?.classId;
      if (classId) {
        const classDoc = await Class.findById(classId).select('scheduledDate').lean();
        if (!classDoc?.scheduledDate || new Date(classDoc.scheduledDate) < cutoff) {
          shouldRemove = true;
        }
      } else if (item.createdAt && new Date(item.createdAt) < cutoff) {
        shouldRemove = true;
      }

      if (!shouldRemove) continue;

      await Class.updateMany(
        { 'materials.libraryItem': item._id },
        { $pull: { materials: { libraryItem: item._id } } }
      );
      await libraryService.deleteItem({ itemId: item._id });
      removed += 1;
    } catch (err) {
      console.warn('[whiteboardScreenshotCleanup] Failed to remove item', item._id, err && err.message);
    }
  }

  return { success: true, removed };
}

module.exports = { runWhiteboardScreenshotCleanup };
