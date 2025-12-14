const dayjs = require('dayjs');
const LibraryAnnotationSnapshot = require('../models/library/LibraryAnnotationSnapshot');
const { httpError } = require('./libraryService');

const DEFAULT_TTL_HOURS = 6;

async function getSnapshot({ itemId, userId, pageNumber }) {
  if (!userId) {
    throw httpError(401, 'Authentication required', 'AUTH_REQUIRED');
  }
  return LibraryAnnotationSnapshot.findOne({ item: itemId, user: userId, pageNumber });
}

async function saveSnapshot({ itemId, userId, pageNumber, payload, activeTool, undoDepth, redoDepth, persist }) {
  if (!userId) {
    throw httpError(401, 'Authentication required', 'AUTH_REQUIRED');
  }
  if (!pageNumber || pageNumber < 1) {
    throw httpError(400, 'pageNumber must be >= 1', 'INVALID_PAGE');
  }

  const expiresAt = persist ? null : dayjs().add(DEFAULT_TTL_HOURS, 'hour').toDate();

  const snapshot = await LibraryAnnotationSnapshot.findOneAndUpdate(
    { item: itemId, user: userId, pageNumber },
    {
      $set: {
        payload,
        activeTool,
        undoDepth,
        redoDepth,
        lastInteractionAt: new Date(),
        expiresAt
      },
      $inc: { version: 1 }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  return snapshot;
}

async function clearSnapshot({ itemId, userId, pageNumber }) {
  if (!userId) {
    throw httpError(401, 'Authentication required', 'AUTH_REQUIRED');
  }
  await LibraryAnnotationSnapshot.deleteOne({ item: itemId, user: userId, pageNumber });
}

module.exports = {
  getSnapshot,
  saveSnapshot,
  clearSnapshot
};
