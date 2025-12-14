const mongoose = require('mongoose');
const Invoice = require('./models/Invoice');

mongoose.connect('mongodb://localhost:27017/waraqa-new').then(async () => {
  console.log('Connected to MongoDB');
  
  // Check the invoice from the logs
  const invoiceId = '690f0e6f79b36345cfbf67c4';
  const inv = await Invoice.findById(invoiceId)
    .select('invoiceNumber guardian status items coverage')
    .lean();
  
  if (!inv) {
    console.log('Invoice not found');
    process.exit(0);
  }
  
  console.log('\n📄 Invoice:', inv.invoiceNumber);
  console.log('📊 Status:', inv.status);
  console.log('🎯 Coverage Hours:', inv.coverage?.maxHours || 0);
  console.log('📦 Total Items:', inv.items.length);
  console.log('\n📚 Items:');
  
  inv.items.forEach((it, i) => {
    const date = new Date(it.date).toLocaleDateString();
    const attended = it.attended ? '✅ Attended' : '❌ Not attended';
    console.log(`  ${i+1}. Class ${it.class}`);
    console.log(`     Date: ${date}, Duration: ${it.duration}min`);
    console.log(`     ${attended}`);
    console.log('');
  });
  
  process.exit(0);
}).catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
