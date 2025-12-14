// Path: models/Teacher.js
/**
 * Full teacher schema with bonus, instapay, etc.
 * Overwrite the old Teacher model.
 */
const mongoose = require('mongoose');

const teacherSchema = new mongoose.Schema({
  /* identity links */
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  /* finance */
  bonus          : { type: Number, default: 0, min: 0 },   // admin‑only editable
  instapay       : { type: Number, default: 0, min: 0 },   // auto‑calculated
  hoursThisMonth : { type: Number, default: 0, min: 0 },

  /* profile */
  bio          : String,
  specialization: String,
  profilePhoto : {
    url      : String,
    publicId : String
  },
  hours: { type: Number, default: 0 },

}, { timestamps: true });

module.exports = mongoose.model('Teacher', teacherSchema);
