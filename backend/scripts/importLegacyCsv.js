/*
  Legacy CSV Importer

  Imports old dashboard CSV exports into the current MongoDB schema.

  Safety principles:
  - Default is DRY RUN (no writes) unless --apply is passed.
  - Idempotent: uses deterministic keys (email, legacy invoice numbers) to avoid duplicates.
  - Does not overwrite existing users with mismatched roles.
  - Does not overwrite passwords for existing users unless --update-existing-passwords.

  Usage (examples):
    node scripts/importLegacyCsv.js --help

    # Dry run (recommended first)
    node scripts/importLegacyCsv.js \
      --guardians "C:\\Users\\...\\guardians.csv" \
      --students "C:\\Users\\...\\students.csv" \
      --teachers "C:\\Users\\...\\teachers.csv" \
      --guardian-invoices "C:\\Users\\...\\guardianinvoices.csv" \
      --teacher-invoices "C:\\Users\\...\\teacherinvoices.csv"

    # Apply to DB
    node scripts/importLegacyCsv.js ... --apply
*/

const fs = require('fs');
const path = require('path');

require('dotenv').config({
  path: process.env.DOTENV_PATH || path.join(__dirname, '..', '.env')
});

const mongoose = require('mongoose');
const moment = require('moment');
const { parse } = require('csv-parse/sync');

const User = require('../models/User');
const Guardian = require('../models/Guardian');
const Student = require('../models/Student');
const Teacher = require('../models/Teacher');
const Invoice = require('../models/Invoice');
const TeacherInvoice = require('../models/TeacherInvoice');

const DEFAULT_TEMP_PASSWORD = 'TempPassword123!';

const parseArgs = (argv) => {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok) continue;
    if (!tok.startsWith('--')) {
      out._.push(tok);
      continue;
    }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
};

const HELP = `
Legacy CSV Importer

Required flags depend on what you want to import:
  --guardians <path>          guardians.csv
  --students <path>           students.csv
  --teachers <path>           teachers.csv
  --guardian-invoices <path>  guardianinvoices.csv
  --teacher-invoices <path>   teacherinvoices.csv

Database:
  --mongo-uri <uri>           defaults to MONGODB_URI env or mongodb://localhost:27017/online-class-manager

Safety:
  --apply                     actually write to DB (default is dry run)
  --update-existing-users      allow updating existing user profile fields (default: false)
  --update-existing-passwords overwrite passwords for existing users too (NOT recommended unless you intend it)

Examples:
  node scripts/importLegacyCsv.js --guardians "C:\\path\\guardians.csv" --students "C:\\path\\students.csv"
  node scripts/importLegacyCsv.js --guardians ... --students ... --apply
`;

const asString = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const normalizeEmail = (value) => {
  const e = asString(value).toLowerCase();
  return e || null;
};

const isValidEmailLoose = (value) => {
  const v = asString(value);
  if (!v) return false;
  // Loose validation: avoid whitespace and require @ + dot.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const toInt = (value) => {
  const num = toNumber(value);
  if (num === null) return null;
  return Math.trunc(num);
};

const toBool01 = (value) => {
  const s = asString(value);
  if (s === '') return false;
  if (s === '1') return true;
  if (s === '0') return false;
  if (s.toLowerCase() === 'true') return true;
  if (s.toLowerCase() === 'false') return false;
  return Boolean(value);
};

const safeParseDate = (value) => {
  const s = asString(value);
  if (!s) return null;

  // Common legacy formats: "YYYY-MM-DD HH:mm:ss" and "YYYY-MM-DD HH:mm:ss.S"
  const m = moment(s, [
    moment.ISO_8601,
    'YYYY-MM-DD HH:mm:ss',
    'YYYY-MM-DD HH:mm:ss.S',
    'YYYY-MM-DD HH:mm:ss.SSS',
    'YYYY-MM-DD'
  ], true);

  if (m.isValid()) return m.toDate();

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const splitName = (fullName) => {
  const raw = asString(fullName).replace(/\s+/g, ' ').trim();
  if (!raw) return { firstName: 'Unknown', lastName: 'User' };
  const parts = raw.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: 'User' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
};

const isValidTimezone = (tz) => {
  const v = asString(tz);
  if (!v) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

const normalizeTimezone = (tz, fallback = 'Africa/Cairo') => {
  const v = asString(tz);
  if (!v) return fallback;
  return isValidTimezone(v) ? v : fallback;
};

const parseCsvFile = (filePath) => {
  if (!filePath) throw new Error('Missing CSV path');
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) throw new Error(`CSV file not found: ${abs}`);
  const content = fs.readFileSync(abs, 'utf8');

  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true
  });
};

const roundCurrency = (value) => {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

const startOfMonth = (d) => moment(d).startOf('month').toDate();
const endOfMonth = (d) => moment(d).endOf('month').toDate();

const normalizePaymentMethodLegacy = (value, roleDefault = 'paypal') => {
  // Legacy CSV may use numeric codes.
  const num = toInt(value);
  if (num !== null) {
    // Heuristic mapping based on legacy data.
    if (num === 1) return 'paypal';
    if (num === 2) return 'bank_transfer';
    if (num === 3) return 'credit_card';
    if (num === 4) return 'cash';
    if (num === 5) return 'bank_transfer';
    return roleDefault;
  }

  const s = asString(value).toLowerCase();
  if (!s) return roleDefault;
  if (s.includes('paypal')) return 'paypal';
  if (s.includes('bank')) return 'bank_transfer';
  if (s.includes('transfer')) return 'bank_transfer';
  if (s.includes('credit')) return 'credit_card';
  if (s.includes('cash')) return 'cash';
  if (s.includes('check')) return 'check';
  return roleDefault;
};

const normalizeGuardianUserPaymentMethod = (value) => {
  const method = normalizePaymentMethodLegacy(value, 'paypal');
  if (method === 'paypal') return 'paypal';
  if (method === 'credit_card') return 'credit_card';
  if (method === 'bank_transfer') return 'bank_transfer';
  // legacy may contain cash/check; guardianInfo does not support them
  return 'bank_transfer';
};

const normalizeTeacherInvoicePaymentMethod = (value) => {
  // TeacherInvoice.paymentMethod enum: ['bank_transfer', 'cash', 'vodafone_cash', 'instapay', 'other']
  const num = toInt(value);
  if (num !== null) {
    if (num === 1) return 'bank_transfer';
    if (num === 2) return 'cash';
    if (num === 3) return 'vodafone_cash';
    if (num === 4) return 'instapay';
    if (num === 5) return 'bank_transfer';
    return 'other';
  }

  const s = asString(value).toLowerCase();
  if (!s) return 'other';
  if (s.includes('insta')) return 'instapay';
  if (s.includes('vodafone')) return 'vodafone_cash';
  if (s.includes('cash')) return 'cash';
  if (s.includes('bank') || s.includes('transfer')) return 'bank_transfer';
  return 'other';
};

const normalizeHours = (value) => {
  const n = toNumber(value);
  if (n === null) return 0;
  // Heuristic: legacy exports often store minutes.
  // If it looks like minutes, convert to hours.
  if (n > 100) return Math.round((n / 60) * 1000) / 1000;
  return Math.round(n * 1000) / 1000;
};

const main = async () => {
  const args = parseArgs(process.argv);

  if (args.help || args.h) {
    // eslint-disable-next-line no-console
    console.log(HELP);
    process.exit(0);
  }

  const apply = Boolean(args.apply);
  const updateExistingUsers = Boolean(args['update-existing-users']);
  const updateExistingPasswords = Boolean(args['update-existing-passwords']);

  const mongoUri = args['mongo-uri'] || process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager';

  const guardianCsvPath = args.guardians;
  const studentCsvPath = args.students;
  const teacherCsvPath = args.teachers;
  const guardianInvoiceCsvPath = args['guardian-invoices'];
  const teacherInvoiceCsvPath = args['teacher-invoices'];

  if (!guardianCsvPath && !studentCsvPath && !teacherCsvPath && !guardianInvoiceCsvPath && !teacherInvoiceCsvPath) {
    throw new Error('No input CSV provided. Pass at least one of: --guardians, --students, --teachers, --guardian-invoices, --teacher-invoices');
  }

  // eslint-disable-next-line no-console
  console.log(`\n=== Legacy CSV Importer ===`);
  // eslint-disable-next-line no-console
  console.log(`Mode: ${apply ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
  // eslint-disable-next-line no-console
  console.log(`Mongo URI: ${mongoUri}`);

  await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

  const stats = {
    guardians: { seen: 0, created: 0, updated: 0, skipped: 0, conflicts: 0 },
    teachers: { seen: 0, created: 0, updated: 0, skipped: 0, conflicts: 0 },
    embeddedStudents: { seen: 0, added: 0, skipped: 0 },
    students: { seen: 0, created: 0, skipped: 0 },
    guardianInvoices: { seen: 0, created: 0, skipped: 0 },
    teacherInvoices: { seen: 0, created: 0, skipped: 0 }
  };

  const guardianLegacyIdToUserId = new Map();
  const teacherLegacyIdToUserId = new Map();
  const guardianLegacyIdToEmail = new Map();
  const teacherLegacyIdToEmail = new Map();

  // --- Guardians ---
  if (guardianCsvPath) {
    const rows = parseCsvFile(guardianCsvPath);
    for (const row of rows) {
      stats.guardians.seen++;

      const legacyId = asString(row.id);
      const email = normalizeEmail(row.email);
      if (!email) {
        stats.guardians.skipped++;
        continue;
      }

      guardianLegacyIdToEmail.set(legacyId, email);

      const name = splitName(row.name);
      const timezone = normalizeTimezone(row.timeZone || row.timezone || row.time_zone, 'Africa/Cairo');
      const phone = asString(row.phone);
      const isActive = asString(row.status) === '1' || toBool01(row.status);

      const hourlyRate = toNumber(row.hoursPrice);
      const transferPrice = toNumber(row.transferPrice);
      const paymentMethod = normalizeGuardianUserPaymentMethod(row.paymentMethod);
      const spokenLanguages = asString(row.language)
        ? asString(row.language).split(',').map((s) => s.trim()).filter(Boolean)
        : [];

      const passwordHash = asString(row.password);

      const existing = await User.findOne({ email }).select('_id email role password guardianInfo firstName lastName');

      if (existing && existing.role !== 'guardian') {
        // eslint-disable-next-line no-console
        console.warn(`Guardian email conflict (role=${existing.role}): ${email} (legacyId=${legacyId})`);
        stats.guardians.conflicts++;
        continue;
      }

      // DRY RUN accounting
      if (!apply) {
        if (!existing) stats.guardians.created++;
        else if (updateExistingUsers) stats.guardians.updated++;

        if (existing) guardianLegacyIdToUserId.set(legacyId, existing._id.toString());
        continue;
      }

      let guardianUser = existing;
      if (!guardianUser) {
        guardianUser = await User.create({
          firstName: name.firstName,
          lastName: name.lastName,
          email,
          password: DEFAULT_TEMP_PASSWORD,
          role: 'guardian',
          phone,
          timezone,
          isActive,
          guardianInfo: {
            paymentMethod,
            hourlyRate: hourlyRate ?? 10,
            transferFee: { mode: 'fixed', value: transferPrice ?? 5 },
            spokenLanguages,
            students: []
          }
        });

        if (passwordHash && passwordHash.startsWith('$2')) {
          await User.updateOne({ _id: guardianUser._id }, { $set: { password: passwordHash } });
        }

        stats.guardians.created++;
      } else {
        if (!updateExistingUsers) {
          stats.guardians.skipped++;
          guardianLegacyIdToUserId.set(legacyId, guardianUser._id.toString());
          // Still ensure the Guardian model exists for compatibility.
          await Guardian.updateOne(
            { user: guardianUser._id },
            { $setOnInsert: { user: guardianUser._id } },
            { upsert: true }
          );
          continue;
        }

        const updates = {
          firstName: guardianUser.firstName || name.firstName,
          lastName: guardianUser.lastName || name.lastName,
          phone: guardianUser.phone || phone,
          timezone: guardianUser.timezone || timezone,
          isActive: isActive
        };

        // Merge guardianInfo safely
        updates.guardianInfo = guardianUser.guardianInfo && typeof guardianUser.guardianInfo === 'object'
          ? guardianUser.guardianInfo
          : {};

        if (!updates.guardianInfo.paymentMethod) updates.guardianInfo.paymentMethod = paymentMethod;
        if (typeof updates.guardianInfo.hourlyRate === 'undefined' || updates.guardianInfo.hourlyRate === null) {
          updates.guardianInfo.hourlyRate = hourlyRate ?? 10;
        }
        if (!updates.guardianInfo.transferFee || typeof updates.guardianInfo.transferFee !== 'object') {
          updates.guardianInfo.transferFee = { mode: 'fixed', value: transferPrice ?? 5 };
        }
        if (!Array.isArray(updates.guardianInfo.spokenLanguages) || updates.guardianInfo.spokenLanguages.length === 0) {
          updates.guardianInfo.spokenLanguages = spokenLanguages;
        }
        if (!Array.isArray(updates.guardianInfo.students)) updates.guardianInfo.students = [];

        if (updateExistingPasswords && passwordHash && passwordHash.startsWith('$2')) {
          updates.password = passwordHash;
          await User.updateOne({ _id: guardianUser._id }, { $set: updates });
        } else {
          // Avoid touching password.
          delete updates.password;
          await User.updateOne({ _id: guardianUser._id }, { $set: updates });
        }

        stats.guardians.updated++;
      }

      await Guardian.updateOne(
        { user: guardianUser._id },
        { $setOnInsert: { user: guardianUser._id } },
        { upsert: true }
      );

      guardianLegacyIdToUserId.set(legacyId, guardianUser._id.toString());
    }
  }

  // --- Teachers ---
  if (teacherCsvPath) {
    const rows = parseCsvFile(teacherCsvPath);
    for (const row of rows) {
      stats.teachers.seen++;

      const legacyId = asString(row.id);
      const email = normalizeEmail(row.email);
      if (!email) {
        stats.teachers.skipped++;
        continue;
      }

      teacherLegacyIdToEmail.set(legacyId, email);

      const name = splitName(row.name);
      const timezone = normalizeTimezone(row.timeZone || row.timezone || row.time_zone, 'Africa/Cairo');
      const phone = asString(row.phone);
      const isActive = asString(row.status) === '1' || toBool01(row.status);
      const passwordHash = asString(row.password);

      const existing = await User.findOne({ email }).select('_id email role password firstName lastName');
      if (existing && existing.role !== 'teacher') {
        // eslint-disable-next-line no-console
        console.warn(`Teacher email conflict (role=${existing.role}): ${email} (legacyId=${legacyId})`);
        stats.teachers.conflicts++;
        continue;
      }

      // DRY RUN accounting
      if (!apply) {
        if (!existing) stats.teachers.created++;
        else if (updateExistingUsers) stats.teachers.updated++;

        if (existing) teacherLegacyIdToUserId.set(legacyId, existing._id.toString());
        continue;
      }

      let teacherUser = existing;
      if (!teacherUser) {
        teacherUser = await User.create({
          firstName: name.firstName,
          lastName: name.lastName,
          email,
          password: DEFAULT_TEMP_PASSWORD,
          role: 'teacher',
          phone,
          timezone,
          isActive
        });

        if (passwordHash && passwordHash.startsWith('$2')) {
          await User.updateOne({ _id: teacherUser._id }, { $set: { password: passwordHash } });
        }

        stats.teachers.created++;
      } else {
        if (!updateExistingUsers) {
          stats.teachers.skipped++;
          teacherLegacyIdToUserId.set(legacyId, teacherUser._id.toString());
          await Teacher.updateOne(
            { user: teacherUser._id },
            { $setOnInsert: { user: teacherUser._id } },
            { upsert: true }
          );
          continue;
        }

        const updates = {
          firstName: teacherUser.firstName || name.firstName,
          lastName: teacherUser.lastName || name.lastName,
          phone: teacherUser.phone || phone,
          timezone: teacherUser.timezone || timezone,
          isActive: isActive
        };

        if (updateExistingPasswords && passwordHash && passwordHash.startsWith('$2')) {
          updates.password = passwordHash;
          await User.updateOne({ _id: teacherUser._id }, { $set: updates });
        } else {
          delete updates.password;
          await User.updateOne({ _id: teacherUser._id }, { $set: updates });
        }

        stats.teachers.updated++;
      }

      await Teacher.updateOne(
        { user: teacherUser._id },
        { $setOnInsert: { user: teacherUser._id } },
        { upsert: true }
      );

      teacherLegacyIdToUserId.set(legacyId, teacherUser._id.toString());
    }
  }

  // --- Students (embedded + standalone) ---
  if (studentCsvPath) {
    const rows = parseCsvFile(studentCsvPath);

    // Group students by guardian for fewer writes
    const grouped = new Map();
    for (const row of rows) {
      stats.embeddedStudents.seen++;
      stats.students.seen++;

      const legacyGuardianId = asString(row.guardianID || row.guardianId || row.guardian_id);
      const guardianUserId = guardianLegacyIdToUserId.get(legacyGuardianId) || null;

      const entry = {
        row,
        legacyGuardianId,
        guardianUserId
      };

      const key = guardianUserId || legacyGuardianId || 'UNKNOWN';
      const list = grouped.get(key) || [];
      list.push(entry);
      grouped.set(key, list);
    }

    for (const [groupKey, entries] of grouped.entries()) {
      // Resolve guardian user
      let guardianUser = null;

      const first = entries[0];
      if (first.guardianUserId) {
        guardianUser = await User.findById(first.guardianUserId).select('_id role email guardianInfo');
      }

      if (!guardianUser) {
        // Preferred fallback: resolve guardian legacy id -> guardian email -> user
        const legacyGuardianId = asString(first?.legacyGuardianId);
        const guardianEmail = guardianLegacyIdToEmail.get(legacyGuardianId) || null;
        if (guardianEmail) {
          const found = await User.findOne({ email: guardianEmail, role: 'guardian' }).select('_id role email guardianInfo timezone');
          if (found) guardianUser = found;
        }

        // Secondary fallback: sometimes student email == guardian email in legacy exports
        if (!guardianUser) {
          const fallbackEmail = normalizeEmail(first?.row?.email);
          if (fallbackEmail) {
            const found = await User.findOne({ email: fallbackEmail, role: 'guardian' }).select('_id role email guardianInfo timezone');
            if (found) guardianUser = found;
          }
        }
      }

      if (!guardianUser || guardianUser.role !== 'guardian') {
        // eslint-disable-next-line no-console
        console.warn(`Skipping students for guardian group=${groupKey}: guardian not found in target DB`);
        // Mark all as skipped
        stats.embeddedStudents.skipped += entries.length;
        stats.students.skipped += entries.length;
        continue;
      }

      // Ensure guardianInfo.students exists
      if (!guardianUser.guardianInfo || typeof guardianUser.guardianInfo !== 'object') guardianUser.guardianInfo = {};
      if (!Array.isArray(guardianUser.guardianInfo.students)) guardianUser.guardianInfo.students = [];

      const existingEmbedded = guardianUser.guardianInfo.students;

      let embeddedChanged = false;

      for (const { row } of entries) {
        const legacyStudentId = asString(row.id);
        const legacyStudentToken = legacyStudentId ? `legacy_student_id:${legacyStudentId}` : null;
        const studentName = splitName(row.name);
        let studentEmail = normalizeEmail(row.email);
        if (studentEmail && !isValidEmailLoose(studentEmail)) studentEmail = null;
        const dob = safeParseDate(row.birthday);
        const studentTimezone = normalizeTimezone(row.timeZone || row.timezone, guardianUser.timezone || 'Africa/Cairo');
        const phone = asString(row.phone);

        const already = existingEmbedded.some((s) => {
          // Prefer a stable marker (legacy id) to avoid skipping siblings who share an email.
          if (legacyStudentToken && asString(s.notes) === legacyStudentToken) return true;

          const fn = asString(s.firstName);
          const ln = asString(s.lastName);
          if (fn && ln && fn.toLowerCase() === studentName.firstName.toLowerCase() && ln.toLowerCase() === studentName.lastName.toLowerCase()) {
            return true;
          }
          return false;
        });

        if (already) {
          stats.embeddedStudents.skipped++;
        } else {
          stats.embeddedStudents.added++;
          embeddedChanged = true;

          if (apply) {
            guardianUser.guardianInfo.students.push({
              firstName: studentName.firstName,
              lastName: studentName.lastName,
              email: studentEmail,
              phone,
              dateOfBirth: dob,
              timezone: studentTimezone,
              isActive: asString(row.status) === '1' || toBool01(row.status),
              hoursRemaining: 0,
              totalClassesAttended: 0,
              notes: legacyStudentToken || ''
            });
          }
        }

        // Standalone Student model
        if (apply) {
          const match = legacyStudentToken
            ? { guardian: guardianUser._id, notes: legacyStudentToken }
            : { guardian: guardianUser._id, firstName: studentName.firstName, lastName: studentName.lastName };

          const existingStudent = await Student.findOne(match).select('_id notes');
          if (existingStudent) {
            stats.students.skipped++;
          } else {
            const studentDoc = await Student.create({
              firstName: studentName.firstName,
              lastName: studentName.lastName,
              email: studentEmail,
              guardian: guardianUser._id,
              phone,
              dateOfBirth: dob,
              timezone: studentTimezone,
              gender: 'male',
              isActive: asString(row.status) === '1' || toBool01(row.status),
              hoursRemaining: 0,
              notes: legacyStudentToken || ''
            });

            await Guardian.updateOne(
              { user: guardianUser._id },
              { $addToSet: { students: studentDoc._id } },
              { upsert: true }
            );

            stats.students.created++;
          }
        }
      }

      if (apply && embeddedChanged) {
        await guardianUser.save();
      }
    }
  }

  // --- Guardian invoices (legacy) ---
  if (guardianInvoiceCsvPath) {
    const rows = parseCsvFile(guardianInvoiceCsvPath);

    for (const row of rows) {
      stats.guardianInvoices.seen++;

      const legacyId = asString(row.id);
      const legacyGuardianId = asString(row.guardianID || row.guardianId || row.guardian_id);
      let guardianUserId = guardianLegacyIdToUserId.get(legacyGuardianId) || null;

      if (!guardianUserId) {
        const guardianEmail = guardianLegacyIdToEmail.get(legacyGuardianId) || null;
        if (guardianEmail) {
          const found = await User.findOne({ email: guardianEmail, role: 'guardian' }).select('_id');
          if (found) guardianUserId = found._id.toString();
        }
      }

      if (!guardianUserId) {
        stats.guardianInvoices.skipped++;
        continue;
      }

      const legacyMarker = `legacy_guardian_invoice_id:${legacyId}`;
      const exists = await Invoice.findOne({ paymentReference: legacyMarker }).select('_id');
      if (exists) {
        stats.guardianInvoices.skipped++;
        continue;
      }

      if (!apply) {
        stats.guardianInvoices.created++;
        continue;
      }

      const createdAt = safeParseDate(row.createdAt) || safeParseDate(row.establishedAt) || new Date();
      const baseDate = safeParseDate(row.establishedAt) || createdAt;

      const totalAmountPaid = roundCurrency(toNumber(row.totalAmountPaid) || 0);
      const transferFeeAmount = roundCurrency(toNumber(row.transferFess) || 0);
      const extraAmount = roundCurrency(toNumber(row.extraAmount) || 0);

      const subtotal = roundCurrency(totalAmountPaid - transferFeeAmount);

      const paid = toBool01(row.paid);
      const isSent = toBool01(row.isSent);
      const paymentDate = safeParseDate(row.paymentDate);

      const month = moment(baseDate).month() + 1;
      const year = moment(baseDate).year();

      await Invoice.create({
        // Note: Invoice model may override invoiceNumber using its own sequencing.
        invoiceNumber: `LEGACY-GRD-${legacyId}`,
        invoiceName: asString(row.invoiceNumber) || null,
        paypalInvoiceNumber: asString(row.invoiceNumber) || null,
        type: 'guardian_invoice',
        billingType: 'manual',
        generationSource: 'manual',
        guardian: new mongoose.Types.ObjectId(guardianUserId),
        billingPeriod: {
          startDate: startOfMonth(baseDate),
          endDate: endOfMonth(baseDate),
          month,
          year
        },
        subtotal,
        tax: 0,
        discount: 0,
        total: totalAmountPaid,
        adjustedTotal: totalAmountPaid,
        currency: 'USD',
        exchangeRate: 1,
        dueDate: paymentDate || createdAt,
        paidDate: paid ? (paymentDate || createdAt) : null,
        paidAmount: paid ? totalAmountPaid : 0,
        paymentMethod: normalizePaymentMethodLegacy(row.paymentMethod, 'paypal'),
        sentVia: isSent ? 'manual' : 'none',
        status: paid ? 'paid' : (isSent ? 'sent' : 'draft'),
        hoursCovered: normalizeHours(row.savedPaidHours),
        guardianFinancial: {
          hourlyRate: null,
          transferFee: {
            mode: 'fixed',
            value: transferFeeAmount,
            amount: transferFeeAmount,
            waived: false,
            waivedByCoverage: false,
            source: 'manual',
            appliedAt: createdAt,
            notes: 'Legacy import'
          }
        },
        paymentReference: legacyMarker,
        createdAt,
        updatedAt: createdAt
      });

      stats.guardianInvoices.created++;
    }
  }

  // --- Teacher invoices (legacy) ---
  if (teacherInvoiceCsvPath) {
    const rows = parseCsvFile(teacherInvoiceCsvPath);

    for (const row of rows) {
      stats.teacherInvoices.seen++;

      const legacyId = asString(row.id);
      const legacyTeacherId = asString(row.teacherID || row.teacherId || row.teacher_id);
      let teacherUserId = teacherLegacyIdToUserId.get(legacyTeacherId) || null;

      if (!teacherUserId) {
        const teacherEmail = teacherLegacyIdToEmail.get(legacyTeacherId) || null;
        if (teacherEmail) {
          const found = await User.findOne({ email: teacherEmail, role: 'teacher' }).select('_id');
          if (found) teacherUserId = found._id.toString();
        }
      }

      if (!teacherUserId) {
        stats.teacherInvoices.skipped++;
        continue;
      }

      const invoiceNumber = `LEGACY-TCH-${legacyId}`;
      const exists = await TeacherInvoice.findOne({ invoiceNumber }).select('_id');
      if (exists) {
        stats.teacherInvoices.skipped++;
        continue;
      }

      if (!apply) {
        stats.teacherInvoices.created++;
        continue;
      }

      const createdAt = safeParseDate(row.createdAt) || new Date();
      const baseDate = safeParseDate(row.activatedAt) || safeParseDate(row.paymentDate) || createdAt;

      const paid = toBool01(row.paid);
      const paymentDate = safeParseDate(row.paymentDate);

      const totalHours = normalizeHours(row.teachingHours);
      const totalAmountPaid = roundCurrency(toNumber(row.totalAmountPaid) || 0);
      const bonus = roundCurrency(toNumber(row.bonus) || 0);

      const grossAmountUSD = roundCurrency(Math.max(totalAmountPaid - bonus, 0));
      const bonusesUSD = roundCurrency(Math.max(bonus, 0));
      const extrasUSD = 0;
      const totalUSD = roundCurrency(grossAmountUSD + bonusesUSD + extrasUSD);

      const exchangeRate = 1;
      const computedRate = totalHours > 0 ? roundCurrency(grossAmountUSD / totalHours) : 0;

      await TeacherInvoice.create({
        teacher: new mongoose.Types.ObjectId(teacherUserId),
        month: moment(baseDate).month() + 1,
        year: moment(baseDate).year(),
        invoiceNumber,
        status: paid ? 'paid' : 'archived',
        isAdjustment: false,
        totalHours,
        rateSnapshot: {
          partition: 'legacy',
          rate: computedRate,
          effectiveFrom: baseDate,
          description: 'Legacy import (computed rate)'
        },
        grossAmountUSD,
        bonusesUSD,
        extrasUSD,
        totalUSD,
        exchangeRateSnapshot: {
          rate: exchangeRate,
          source: 'Legacy CSV import',
          setAt: createdAt
        },
        grossAmountEGP: roundCurrency(grossAmountUSD * exchangeRate),
        bonusesEGP: roundCurrency(bonusesUSD * exchangeRate),
        extrasEGP: 0,
        totalEGP: roundCurrency(totalUSD * exchangeRate),
        transferFeeSnapshot: {
          model: 'none',
          value: 0,
          source: 'system_default'
        },
        transferFeeEGP: 0,
        netAmountEGP: roundCurrency(totalUSD * exchangeRate),
        paymentMethod: normalizeTeacherInvoicePaymentMethod(row.paymentMethod),
        transactionId: `legacy_teacher_invoice_id:${legacyId}`,
        paidAt: paid ? (paymentDate || createdAt) : null,
        notes: `Legacy import: teacherInvoice.id=${legacyId}, legacyInvoiceNumber=${asString(row.invoiceNumber)}`,
        createdAt,
        updatedAt: createdAt
      });

      stats.teacherInvoices.created++;
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n=== Summary ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(stats, null, 2));

  await mongoose.disconnect();
};

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('\n❌ Import failed:', err && err.stack ? err.stack : err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
