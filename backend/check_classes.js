const mongoose = require('mongoose');
const Class = require('./models/Class');

mongoose.connect('mongodb://localhost:27017/waraqa-new').then(async () => {
  const count = await Class.countDocuments();
  console.log('Total classes:', count);
  
  if (count > 0) {
    const sample = await Class.findOne()
      .select('_id status teacher student duration scheduledDate')
      .lean();
    console.log('\nSample class:', JSON.stringify(sample, null, 2));
  }
  
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
