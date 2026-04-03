#!/usr/bin/env node
/**
 * check-removed-classes.js - Check the deleted classes
 */
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqadb');
  const Class = require('../models/Class');

  // Check the deleted classes from HATU and ARIF
  const ids = [
    '699d809ec5432a1df0ffeeac', // HATU removed class
    '69bb06c0b4f70197c08bc061', // ARIF removed class
  ];

  for (const id of ids) {
    const cls = await Class.findById(id).lean();
    if (cls) {
      console.log(JSON.stringify({
        found: true,
        id: cls._id,
        date: cls.scheduledDate,
        duration: cls.duration,
        subject: cls.subject,
        status: cls.status,
        deleted: cls.deleted,
        student: cls.student,
        teacher: cls.teacher,
        billedIn: cls.billedInInvoiceId
      }, null, 2));
    } else {
      // Try with deleted flag
      const cls2 = await Class.findOne({ _id: id }).setOptions({ strictQuery: false }).lean();
      console.log('Class ' + id + ': ' + (cls2 ? 'FOUND with options' : 'NOT FOUND IN DB'));
      if (cls2) console.log(JSON.stringify(cls2, null, 2));
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
