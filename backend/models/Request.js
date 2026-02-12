const mongoose = require('mongoose');
const {
  REQUEST_STATUSES,
  REQUEST_CATEGORIES,
  REQUEST_TYPE_KEYS,
} = require('../constants/requestTypes');

const requestTimelineSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    status: { type: String, enum: REQUEST_STATUSES, required: false },
    note: { type: String, default: '' },
    byUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    byRole: { type: String, enum: ['admin', 'teacher', 'guardian', 'student'], required: false },
  },
  { _id: false, timestamps: { createdAt: 'at', updatedAt: false } }
);

const requestSchema = new mongoose.Schema(
  {
    requestCode: { type: String, required: true, unique: true, index: true },
    category: { type: String, enum: REQUEST_CATEGORIES, required: true, index: true },
    type: { type: String, enum: REQUEST_TYPE_KEYS, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    status: { type: String, enum: REQUEST_STATUSES, default: 'pending', index: true },
    urgency: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },

    createdBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      role: { type: String, enum: ['admin', 'teacher', 'guardian', 'student'], required: true },
      name: { type: String, required: true },
    },

    student: {
      studentId: { type: mongoose.Schema.Types.ObjectId, required: false, index: true },
      name: { type: String, default: '' },
    },

    relatedClassId: { type: mongoose.Schema.Types.ObjectId, required: false, index: true },
    relatedInvoiceId: { type: mongoose.Schema.Types.ObjectId, required: false, index: true },

    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    adminNotes: { type: String, default: '' },

    timeline: { type: [requestTimelineSchema], default: [] },

    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

requestSchema.index({ status: 1, updatedAt: -1 });
requestSchema.index({ 'createdBy.userId': 1, updatedAt: -1 });
requestSchema.index({ category: 1, type: 1, updatedAt: -1 });

function buildRequestCode() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${yyyy}${mm}${dd}-${rand}`;
}

requestSchema.pre('validate', async function ensureRequestCode(next) {
  if (this.requestCode) return next();

  for (let i = 0; i < 5; i += 1) {
    const code = buildRequestCode();
    const exists = await this.constructor.exists({ requestCode: code });
    if (!exists) {
      this.requestCode = code;
      return next();
    }
  }

  this.requestCode = `${buildRequestCode()}-${Date.now().toString().slice(-4)}`;
  return next();
});

module.exports = mongoose.model('Request', requestSchema);
