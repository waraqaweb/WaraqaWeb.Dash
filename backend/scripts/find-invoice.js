const mongoose = require('mongoose');
async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://mongo:27017/waraqadb');
  const db = mongoose.connection.db;
  const targetId = process.argv[2] || '69d184216d767f6489cc74e8';
  
  // Try direct collection query
  const { ObjectId } = require('mongodb');
  let oid;
  try { oid = new ObjectId(targetId); } catch(e) { console.log('Invalid ObjectId'); process.exit(1); }
  
  const inv = await db.collection('invoices').findOne({ _id: oid });
  if (!inv) {
    console.log('Invoice NOT FOUND by ObjectId:', targetId);
    // Try slug
    const bySlug = await db.collection('invoices').findOne({ invoiceSlug: targetId });
    if (bySlug) {
      console.log('Found by slug instead:', bySlug._id);
    } else {
      // Show all invoice IDs
      const all = await db.collection('invoices').find({}).project({ _id: 1, invoiceSlug: 1, invoiceNumber: 1 }).toArray();
      console.log('All invoices in DB:', all.length);
      all.forEach(i => console.log(' ', i._id.toString(), i.invoiceSlug || '', i.invoiceNumber || ''));
    }
    process.exit(0);
  }
  
  console.log('Found invoice:', inv._id, 'status:', inv.status);
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
