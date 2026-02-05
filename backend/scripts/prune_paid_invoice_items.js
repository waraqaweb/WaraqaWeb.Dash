const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');
const Class = require('../models/Class');
const InvoiceService = require('../services/invoiceService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb';

const ELIGIBLE_STATUSES = new Set(['attended', 'missed_by_student', 'absent']);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.replace(/^--/, '');
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
};

const normalizeId = (value) => {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return value.toString();
  if (typeof value === 'object') {
    if (value._id) return value._id.toString();
    if (typeof value.toString === 'function') {
      const str = value.toString();
      return str && str !== '[object Object]' ? str : null;
    }
  }
  return null;
};

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

async function run() {
  const args = parseArgs();
  const guardianId = args.guardianId || args.guardian || null;
  const sinceDays = Number.isFinite(Number(args.sinceDays)) ? Number(args.sinceDays) : 365;
  const dryRun = Boolean(args['dry-run'] || args.dryRun);

  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const filter = {
    deleted: { $ne: true },
    status: { $in: ['paid', 'refunded'] },
    ...(guardianId ? { guardian: guardianId } : {}),
    createdAt: { $gte: sinceDate }
  };

  const invoices = await Invoice.find(filter).sort({ createdAt: 1 });
  if (!invoices.length) {
    console.log('No paid invoices found.');
    await mongoose.connection.close();
    return;
  }

  let pruned = 0;
  for (const invoice of invoices) {
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const classIds = items.map((it) => normalizeId(it.class || it.lessonId)).filter(Boolean);
    if (!classIds.length) continue;

    const classDocs = await Class.find({ _id: { $in: classIds } })
      .select('status scheduledDate duration')
      .lean();

    const classMap = new Map(classDocs.map((cls) => [String(cls._id), cls]));

    const maxHours = Number(invoice?.coverage?.maxHours || 0) || 0;
    const coverageEnd = invoice?.coverage?.endDate ? toDate(invoice.coverage.endDate) : null;

    const eligible = items.filter((it) => {
      const id = normalizeId(it.class || it.lessonId);
      if (!id) return true; // keep non-class items
      const cls = classMap.get(id);
      if (!cls) return false;
      const status = String(cls.status || '').toLowerCase();
      if (!ELIGIBLE_STATUSES.has(status)) return false;
      if (coverageEnd && (!maxHours || maxHours <= 0)) {
        const itemDate = toDate(it.date || it.scheduledDate || cls?.scheduledDate);
        if (!itemDate || itemDate > coverageEnd) return false;
      }
      return true;
    });
    let kept = eligible;
    if (maxHours > 0) {
      const sorted = eligible
        .map((it) => {
          const id = normalizeId(it.class || it.lessonId);
          const cls = id ? classMap.get(id) : null;
          const date = toDate(it.date || it.scheduledDate || cls?.scheduledDate);
          const minutes = Number(it.duration || cls?.duration || 0) || 0;
          return { item: it, date, minutes };
        })
        .sort((a, b) => {
          const da = a.date ? a.date.getTime() : 0;
          const db = b.date ? b.date.getTime() : 0;
          return da - db;
        });

      const capMinutes = Math.round(maxHours * 60);
      const selected = [];
      let used = 0;
      for (const entry of sorted) {
        if (used + entry.minutes > capMinutes + 0.0001) break;
        selected.push(entry.item);
        used += entry.minutes;
      }
      kept = selected;
    }

    const keepIds = new Set(kept.map((it) => String(it._id)).filter(Boolean));
    const removeItemIds = items
      .filter((it) => it?._id && !keepIds.has(String(it._id)))
      .map((it) => String(it._id));

    if (!removeItemIds.length) continue;

    if (dryRun) {
      console.log(`[dry-run] ${invoice.invoiceNumber || invoice._id} remove=${removeItemIds.length}`);
      continue;
    }

    const result = await InvoiceService.updateInvoiceItems(
      String(invoice._id),
      { removeItemIds, note: 'Pruned non-attended classes from paid invoice', allowPaidModification: true },
      null
    );

    if (result?.success) {
      pruned += 1;
      console.log(`✅ Pruned ${invoice.invoiceNumber || invoice._id} (removed ${removeItemIds.length})`);
    } else {
      console.log(`⚠️ Failed to prune ${invoice.invoiceNumber || invoice._id}: ${result?.error || 'unknown error'}`);
    }
  }

  console.log(`Done. Pruned ${pruned} paid invoice(s).`);
  await mongoose.connection.close();
}

run().catch((err) => {
  console.error('Prune failed:', err);
  process.exit(1);
});
