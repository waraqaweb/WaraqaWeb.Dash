const mongoose = require('mongoose');
const Class = require('../models/Class');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Mariam's guardian ID
    const mariamId = new mongoose.Types.ObjectId('690c3c55c832ddfa9898c418');
    
    const classes = await Class.find({ 
      'student.guardianId': mariamId 
    })
    .select('_id scheduledDate billedInInvoiceId billedAt status subject')
    .sort({ scheduledDate: 1 });
    
    console.log(`\nFound ${classes.length} total classes for Mariam:\n`);
    
    classes.forEach(c => {
      console.log(`- ${c.scheduledDate?.toISOString()?.slice(0, 16)} | ${c.subject} | ${c.status} | Billed: ${c.billedInInvoiceId ? 'YES (' + c.billedInInvoiceId + ')' : 'NO'}`);
    });
    
    const unbilled = classes.filter(c => !c.billedInInvoiceId);
    console.log(`\n✅ Unbilled classes: ${unbilled.length}`);
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
