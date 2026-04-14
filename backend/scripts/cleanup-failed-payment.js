#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const Payment = require('../models/Payment');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // Remove the orphaned failed payment so it doesn't interfere with retry
  const result = await Payment.deleteOne({
    _id: '69db86a53e1bfba118857d54',
    status: 'failed'
  });
  console.log('Deleted failed payment:', result.deletedCount ? 'yes' : 'no (not found or not failed)');

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
