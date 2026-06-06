import api from '../api/axios';

/**
 * Lazy-load SheetJS (xlsx) only when an export is triggered.
 */
let xlsxModule = null;
async function getXlsx() {
  if (!xlsxModule) {
    xlsxModule = await import('xlsx');
  }
  return xlsxModule;
}

/**
 * Fetch ALL records from a paginated API endpoint by requesting a large limit.
 * Uses the same params the page already sends, but overrides page/limit.
 */
export async function fetchAllForExport(url, params = {}) {
  const exportParams = { ...params, page: 1, limit: 10000 };
  const res = await api.get(url, { params: exportParams });
  return res.data;
}

/**
 * Build an Excel workbook from rows and trigger a browser download.
 *
 * @param {Array<Object>} rows   – flat objects (each key = column header)
 * @param {string}        name   – file name (without extension)
 * @param {string}       [sheet] – sheet name (default = "Data")
 */
export async function downloadExcel(rows, name, sheet = 'Data') {
  if (!rows?.length) {
    alert('No data to export.');
    return;
  }
  const XLSX = await getXlsx();
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31)); // sheet name max 31 chars
  XLSX.writeFile(wb, `${name}.xlsx`);
}

/* ─── Page-specific mappers ──────────────────────────────────────── */

// Small shared formatters so every export renders dates/lists consistently.
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString() : '');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString() : '');
const fmtList = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : (v || ''));
const yesNo = (v) => (v ? 'Yes' : 'No');
const fullName = (first, last) => [first, last].filter(Boolean).join(' ');

export function mapClassRow(c) {
  const teacher = c.teacher || {};
  const stu = c.student || {};
  const guardian = stu.guardianId || {};
  const report = c.classReport || {};
  return {
    'Status': c.status || '',
    'Subject': c.subject || '',
    'Date': c.scheduledDate ? new Date(c.scheduledDate).toLocaleDateString() : '',
    'Time': c.scheduledDate ? new Date(c.scheduledDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    'Duration (min)': c.duration || '',
    'Teacher': fullName(teacher.firstName, teacher.lastName),
    'Teacher Email': teacher.email || '',
    'Student': fullName(stu.studentFirstName || stu.firstName, stu.studentLastName || stu.lastName),
    'Guardian': fullName(guardian.firstName, guardian.lastName),
    'Guardian Email': guardian.email || '',
    'Meeting Link': c.meetingLink || '',
    'Recurring': yesNo(c.isRecurring || c.recurring),
    'Trial': yesNo(c.isTrial),
    'Report Status': c.reportSubmission?.status || '',
    'Report Attendance': report.attendance || '',
    'Report Score': report.score ?? '',
    'Report Progress': report.progress || '',
    'Report Notes': report.notes || '',
    'Cancelled By': c.cancelledBy || c.cancellation?.cancelledBy || '',
    'Cancel Reason': c.cancellation?.reason || c.cancelReason || '',
    'Created': fmtDate(c.createdAt),
    'Updated': fmtDate(c.updatedAt),
  };
}

export function mapTeacherRow(t) {
  const td = t.teacherData || t.teacherInfo || {};
  const bank = td.bankDetails || {};
  const addr = t.address || {};
  return {
    'First Name': t.firstName || '',
    'Last Name': t.lastName || '',
    'Email': t.email || '',
    'Phone': t.phone || '',
    'Gender': t.gender || '',
    'Status': t.isActive ? 'Active' : 'Inactive',
    'Email Verified': yesNo(t.isEmailVerified),
    'Timezone': t.timezone || '',
    'Country': addr.country || '',
    'City': addr.city || '',
    'Subjects': fmtList(td.subjects),
    'Specialization': td.specialization || '',
    'Spoken Languages': fmtList(td.spokenLanguages),
    'Hourly Rate (USD)': td.hourlyRate ?? '',
    'Bonus (USD)': td.bonus ?? '',
    'Monthly Hours': td.monthlyHours ?? '',
    'Total Classes Taught': td.totalClassesTaught ?? '',
    'Preferred Currency': td.preferredCurrency || '',
    'Instapay Name': td.instapayName || '',
    'Bank Name': bank.bankName || '',
    'Account Number': bank.accountNumber || '',
    'IBAN': bank.iban || '',
    'SWIFT': bank.swift || '',
    'Google Meet Link': td.googleMeetLink || '',
    'Vacation Days/Year': td.vacationAllowance?.defaultDaysPerYear ?? '',
    'Bio': td.bio || '',
    'Date of Birth': fmtDate(t.dateOfBirth),
    'Created': fmtDate(t.createdAt),
    'Updated': fmtDate(t.updatedAt),
  };
}

/**
 * Guardian export: one flat row per guardian with every student summarized into
 * its own set of columns (Student 1 …, Student 2 …). Use buildGuardianExportRows
 * so every row shares the same student columns (padded to the largest family).
 */
export function buildGuardianExportRows(guardians = []) {
  const maxStudents = guardians.reduce(
    (max, g) => Math.max(max, (g.guardianInfo?.students || []).length),
    0
  );
  return guardians.map((g) => {
    const gi = g.guardianInfo || {};
    const tf = gi.transferFee || {};
    const addr = g.address || {};
    const billing = gi.billingAddress || {};
    const bank = gi.bankDetails || {};
    const students = Array.isArray(gi.students) ? gi.students : [];
    const row = {
      'First Name': g.firstName || '',
      'Last Name': g.lastName || '',
      'Email': g.email || '',
      'Phone': g.phone || '',
      'Status': g.isActive ? 'Active' : 'Inactive',
      'Email Verified': yesNo(g.isEmailVerified),
      'Relationship': gi.relationship || '',
      'Timezone': g.timezone || gi.timezone || '',
      'Country': addr.country || billing.country || '',
      'City': addr.city || billing.city || '',
      'State': addr.state || billing.state || '',
      'Hourly Rate': gi.hourlyRate ?? '',
      'Transfer Fee Mode': tf.mode || '',
      'Transfer Fee Value': tf.value ?? '',
      'Currency': gi.currency || '',
      'Payment Method': gi.paymentMethod || '',
      'Total Hours': gi.totalHours ?? '',
      'Cumulative Hours': gi.cumulativeConsumedHours ?? '',
      'Spoken Languages': fmtList(gi.spokenLanguages),
      'Emergency Contact': gi.emergencyContact?.name
        ? `${gi.emergencyContact.name}${gi.emergencyContact.phone ? ` (${gi.emergencyContact.phone})` : ''}`
        : '',
      'Bank Name': bank.bankName || '',
      'IBAN': bank.iban || '',
      '# Students': students.length,
      'Created': fmtDate(g.createdAt),
      'Updated': fmtDate(g.updatedAt),
    };
    for (let i = 0; i < maxStudents; i += 1) {
      const s = students[i] || {};
      const n = i + 1;
      row[`Student ${n} Name`] = fullName(s.firstName, s.lastName);
      row[`Student ${n} Gender`] = s.gender || '';
      row[`Student ${n} Birth Date`] = fmtDate(s.dateOfBirth);
      row[`Student ${n} Subjects`] = fmtList(s.subjects);
      row[`Student ${n} Language`] = s.language || '';
      row[`Student ${n} Grade`] = s.grade || '';
      row[`Student ${n} Hours Left`] = s.hoursRemaining ?? '';
      row[`Student ${n} Status`] = s.isActive === false ? 'Inactive' : 'Active';
      row[`Student ${n} Classes Attended`] = s.totalClassesAttended ?? '';
      row[`Student ${n} Timezone`] = s.timezone || '';
      row[`Student ${n} Notes`] = s.notes || '';
    }
    return row;
  });
}

// Kept for backward compatibility (single guardian, no student columns).
export function mapGuardianRow(g) {
  return buildGuardianExportRows([g])[0];
}

export function mapStudentRow(s) {
  const guardian = s.guardian || s.guardianId || {};
  return {
    'First Name': s.firstName || s.studentFirstName || '',
    'Last Name': s.lastName || s.studentLastName || '',
    'Status': s.status || (s.isActive === false ? 'Inactive' : 'Active'),
    'Gender': s.gender || '',
    'Birth Date': fmtDate(s.birthDate || s.dateOfBirth),
    'Language': s.language || '',
    'Grade': s.grade || '',
    'School': s.school || '',
    'Subjects': fmtList(s.subjects),
    'Hours Remaining': s.hoursRemaining ?? '',
    'Classes Attended': s.totalClassesAttended ?? '',
    'Timezone': s.timezone || '',
    'Phone': s.phone || '',
    'WhatsApp': s.whatsapp || '',
    'Email': s.email || '',
    'Guardian': fullName(guardian.firstName, guardian.lastName),
    'Guardian Email': guardian.email || '',
    'Guardian Phone': guardian.phone || '',
    'Learning Preferences': s.learningPreferences || '',
    'Notes': s.notes || '',
    'Created': fmtDate(s.createdAt),
  };
}

export function mapInvoiceRow(inv) {
  const guardian = inv.guardian || {};
  const teacher = inv.teacher || {};
  const bp = inv.billingPeriod || {};
  return {
    'Invoice #': inv.invoiceNumber || inv.invoiceSlug || '',
    'Status': inv.status || '',
    'Type': inv.type || '',
    'Guardian': fullName(guardian.firstName, guardian.lastName),
    'Guardian Email': guardian.email || '',
    'Guardian Phone': guardian.phone || '',
    'Teacher': fullName(teacher.firstName, teacher.lastName),
    'Teacher Email': teacher.email || '',
    'Billing Start': fmtDate(bp.startDate),
    'Billing End': fmtDate(bp.endDate),
    'Currency': inv.currency || '',
    'Subtotal': inv.subtotal ?? '',
    'Discount': inv.discount ?? inv.discountAmount ?? '',
    'Transfer Fee': inv.transferFee ?? '',
    'Total': inv.total ?? inv.adjustedTotal ?? '',
    'Adjusted Total': inv.adjustedTotal ?? '',
    'Paid Amount': inv.paidAmount ?? '',
    'Balance Due': inv.balanceDue ?? ((inv.total ?? 0) - (inv.paidAmount ?? 0)),
    'Hours': inv.hoursCovered ?? '',
    'Hourly Rate': inv.hourlyRate ?? '',
    'Classes': inv.items?.length ?? '',
    'Due Date': fmtDate(inv.dueDate),
    'Paid At': fmtDate(inv.paidAt),
    'Payment Method': inv.paymentMethod || '',
    'Notes': inv.notes || inv.adminNotes || '',
    'Created': fmtDate(inv.createdAt),
    'Updated': fmtDate(inv.updatedAt),
  };
}


export function mapSalaryRow(s) {
  const teacher = s.teacher || {};
  const bp = s.billingPeriod || {};
  return {
    'Invoice #': s.invoiceNumber || '',
    'Invoice Name': s.invoiceName || '',
    'Status': s.status || '',
    'Teacher': fullName(teacher.firstName, teacher.lastName),
    'Teacher Email': teacher.email || '',
    'Teacher Phone': teacher.phone || '',
    'Month': s.month || '',
    'Year': s.year || '',
    'Billing Start': fmtDate(bp.startDate),
    'Billing End': fmtDate(bp.endDate),
    'Total (USD)': s.totalUSD ?? s.total ?? '',
    'Net (EGP)': s.netEGP ?? s.netAmountEGP ?? '',
    'Total (EGP)': s.totalEGP ?? '',
    'Bonus (USD)': s.bonusUSD ?? '',
    'Extras (USD)': Array.isArray(s.extras) ? s.extras.reduce((sum, e) => sum + (e.amountUSD || 0), 0) : '',
    'Hours': s.totalHours ?? s.hoursCovered ?? s.lockedMonthlyHours ?? '',
    'Rate (USD/hr)': s.rateUSD ?? s.rateSnapshot?.hourlyRate ?? '',
    'Currency': s.currency || '',
    'Paid At': fmtDate(s.paidAt),
    'Created': fmtDate(s.createdAt),
    'Updated': fmtDate(s.updatedAt),
  };
}

