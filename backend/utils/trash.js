const Trash = require('../models/Trash');
const Setting = require('../models/Setting');

const DEFAULT_RETENTION_HOURS = 24;

async function getRetentionHours() {
  try {
    const setting = await Setting.findOne({ key: 'trash.retentionHours' });
    const hours = Number(setting?.value);
    return hours > 0 ? hours : DEFAULT_RETENTION_HOURS;
  } catch {
    return DEFAULT_RETENTION_HOURS;
  }
}

/**
 * Save a document snapshot to the Trash collection before deleting it.
 *
 * @param {Object} opts
 * @param {'invoice'|'class'|'teacher_invoice'} opts.itemType
 * @param {Object} opts.doc - Mongoose document or plain object (must have _id)
 * @param {string} [opts.label] - Display label (invoice number, class subject, etc.)
 * @param {Object} [opts.meta] - Extra display info (names, dates, etc.)
 * @param {string|ObjectId} [opts.userId] - Who deleted
 */
async function saveToTrash({ itemType, doc, label, meta, userId }) {
  try {
    const retentionHours = await getRetentionHours();
    const expiresAt = new Date(Date.now() + retentionHours * 60 * 60 * 1000);

    const snapshot = doc.toObject ? doc.toObject() : (doc._doc || doc);

    await Trash.create({
      itemType,
      itemId: snapshot._id,
      label: label || '',
      meta: meta || {},
      snapshot,
      deletedBy: userId || null,
      deletedAt: new Date(),
      expiresAt,
    });
  } catch (err) {
    console.warn('[Trash] Failed to save item to trash:', err.message);
  }
}

/**
 * Save multiple documents to Trash in bulk.
 */
async function saveMultipleToTrash({ itemType, docs, labelFn, metaFn, userId }) {
  try {
    if (!docs || docs.length === 0) return;
    const retentionHours = await getRetentionHours();
    const expiresAt = new Date(Date.now() + retentionHours * 60 * 60 * 1000);
    const now = new Date();

    const entries = docs.map((doc) => {
      const snapshot = doc.toObject ? doc.toObject() : (doc._doc || doc);
      return {
        itemType,
        itemId: snapshot._id,
        label: labelFn ? labelFn(snapshot) : '',
        meta: metaFn ? metaFn(snapshot) : {},
        snapshot,
        deletedBy: userId || null,
        deletedAt: now,
        expiresAt,
      };
    });

    await Trash.insertMany(entries, { ordered: false });
  } catch (err) {
    console.warn('[Trash] Failed to save items to trash:', err.message);
  }
}

module.exports = { saveToTrash, saveMultipleToTrash, getRetentionHours, DEFAULT_RETENTION_HOURS };
