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
    'Teacher': [teacher.firstName, teacher.lastName].filter(Boolean).join(' '),
    'Student': [stu.studentFirstName || stu.firstName, stu.studentLastName || stu.lastName].filter(Boolean).join(' '),
    'Guardian': [guardian.firstName, guardian.lastName].filter(Boolean).join(' '),
    'Meeting Link': c.meetingLink || '',
    'Report Status': c.reportSubmission?.status || '',
    'Report Attendance': report.attendance || '',
    'Report Score': report.score ?? '',
    'Report Notes': report.notes || '',
    'Created': c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
  };
}

export function mapTeacherRow(t) {
  const td = t.teacherData || t.teacherInfo || {};
  return {
    'First Name': t.firstName || '',
    'Last Name': t.lastName || '',
    'Email': t.email || '',
    'Phone': t.phone || '',
    'Status': t.isActive ? 'Active' : 'Inactive',
    'Specialization': td.specialization || '',
    'Bio': td.bio || '',
    'Created': t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '',
  };
}

export function mapGuardianRow(g) {
  return {
    'First Name': g.firstName || '',
    'Last Name': g.lastName || '',
    'Email': g.email || '',
    'Phone': g.phone || '',
    'Status': g.isActive ? 'Active' : 'Inactive',
    'Hourly Rate': g.guardianInfo?.hourlyRate ?? '',
    'Transfer Fee': g.guardianInfo?.transferFee ?? '',
    'Currency': g.guardianInfo?.currency || '',
    'Created': g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '',
  };
}

export function mapStudentRow(s) {
  const guardian = s.guardian || {};
  return {
    'First Name': s.firstName || '',
    'Last Name': s.lastName || '',
    'Status': s.status || '',
    'Gender': s.gender || '',
    'Birth Date': s.birthDate ? new Date(s.birthDate).toLocaleDateString() : '',
    'Language': s.language || '',
    'Subjects': Array.isArray(s.subjects) ? s.subjects.join(', ') : (s.subjects || ''),
    'Guardian': [guardian.firstName, guardian.lastName].filter(Boolean).join(' '),
    'Guardian Email': guardian.email || '',
    'Notes': s.notes || '',
    'Created': s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '',
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
    'Guardian': [guardian.firstName, guardian.lastName].filter(Boolean).join(' '),
    'Guardian Email': guardian.email || '',
    'Teacher': [teacher.firstName, teacher.lastName].filter(Boolean).join(' '),
    'Billing Start': bp.startDate ? new Date(bp.startDate).toLocaleDateString() : '',
    'Billing End': bp.endDate ? new Date(bp.endDate).toLocaleDateString() : '',
    'Subtotal': inv.subtotal ?? '',
    'Total': inv.total ?? inv.adjustedTotal ?? '',
    'Paid Amount': inv.paidAmount ?? '',
    'Hours': inv.hoursCovered ?? '',
    'Due Date': inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '',
    'Paid At': inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : '',
    'Classes': inv.items?.length ?? '',
    'Created': inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '',
  };
}

export function mapSalaryRow(s) {
  const teacher = s.teacher || {};
  const bp = s.billingPeriod || {};
  return {
    'Invoice #': s.invoiceNumber || '',
    'Invoice Name': s.invoiceName || '',
    'Status': s.status || '',
    'Teacher': [teacher.firstName, teacher.lastName].filter(Boolean).join(' '),
    'Teacher Email': teacher.email || '',
    'Month': s.month || '',
    'Year': s.year || '',
    'Billing Start': bp.startDate ? new Date(bp.startDate).toLocaleDateString() : '',
    'Billing End': bp.endDate ? new Date(bp.endDate).toLocaleDateString() : '',
    'Total (USD)': s.totalUSD ?? s.total ?? '',
    'Net (EGP)': s.netEGP ?? '',
    'Bonus (USD)': s.bonusUSD ?? '',
    'Hours': s.totalHours ?? s.hoursCovered ?? '',
    'Rate (USD/hr)': s.rateUSD ?? '',
    'Currency': s.currency || '',
    'Paid At': s.paidAt ? new Date(s.paidAt).toLocaleDateString() : '',
    'Created': s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '',
  };
}
