// backend/utils/generateInvoiceDoc.js
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  WidthType
} = require('docx');

const buildCurrencyFormatter = (locale, currency) => {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  } catch (err) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
};

const buildNumberFormatter = (locale) => {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  } catch (err) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }
};

const paragraphSpacer = () => new Paragraph({ spacing: { after: 200 } });

const kvParagraph = (label, value) => new Paragraph({
  children: [
    new TextRun({ text: `${label}: `, bold: true }),
    new TextRun({ text: value || '—' })
  ],
  spacing: { after: 100 }
});

const createTableFromMatrix = (headers, rows) => {
  if (!Array.isArray(headers) || !headers.length) return null;

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((header) => new TableCell({
      children: [new Paragraph({ text: header, bold: true })],
      shading: { fill: 'EFEFEF' }
    }))
  });

  const dataRows = (rows || []).map((row) => new TableRow({
    children: headers.map((_, index) => {
      const cellValue = row[index];
      const textValue = cellValue === null || cellValue === undefined || cellValue === '' ? '—' : String(cellValue);
      return new TableCell({ children: [new Paragraph({ text: textValue })] });
    })
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.LEFT,
    rows: [headerRow, ...dataRows]
  });
};

module.exports = async function generateInvoiceDoc(invoice, context = {}) {
  if (!invoice) {
    throw new Error('Invoice document is required');
  }

  const timezone = context.timezone
    || context.snapshot?.metadata?.timezone
    || context.previousSnapshot?.metadata?.timezone
    || 'UTC';

  const locale = context.locale
    || context.snapshot?.metadata?.locale
    || context.previousSnapshot?.metadata?.locale
    || 'en-US';

  const snapshot = context.snapshot
    || (typeof invoice.getExportSnapshot === 'function'
      ? invoice.getExportSnapshot({ timezone, locale })
      : null);

  if (!snapshot) {
    throw new Error('Unable to build invoice export snapshot');
  }

  const previousSnapshot = context.previousSnapshot || null;

  const currencyCode = snapshot.financials?.currency || 'USD';
  const currencyFormatter = buildCurrencyFormatter(locale, currencyCode);
  const numberFormatter = buildNumberFormatter(locale);

  const formatCurrency = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return currencyFormatter.format(0);
    }
    return currencyFormatter.format(numeric);
  };

  const formatNumber = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '0';
    return numberFormatter.format(numeric);
  };

  const formatHours = (hours) => {
    const numeric = Number(hours);
    if (!Number.isFinite(numeric)) return '0';
    return numberFormatter.format(numeric);
  };

  const doc = new Document({
    sections: [{
      properties: {},
      children: []
    }]
  });

  const sectionChildren = doc.Sections[0].children;

  const uniqueDays = (snapshot.dateRange?.uniqueDays || []).map((d) => d.formatted || d.iso);
  const guardianName = snapshot.guardian?.name || '—';
  const billingLabel = snapshot.billingPeriod?.label || '—';
  const dueDate = snapshot.dueDate?.formatted || '—';
  const generatedAt = snapshot.metadata?.generatedAtFormatted || new Date().toLocaleString();

  // Header
  sectionChildren.push(new Paragraph({ text: `Invoice ${snapshot.invoiceNumber || ''}`, heading: HeadingLevel.HEADING_1 }));
  sectionChildren.push(kvParagraph('Status', snapshot.status || '—'));
  sectionChildren.push(kvParagraph('Due date', dueDate));
  sectionChildren.push(kvParagraph('Billing period', billingLabel));
  if (snapshot.dateRange?.firstLesson?.formatted || snapshot.dateRange?.lastLesson?.formatted) {
    const rangeText = [snapshot.dateRange?.firstLesson?.formatted, snapshot.dateRange?.lastLesson?.formatted]
      .filter(Boolean)
      .join(' → ');
    sectionChildren.push(kvParagraph('Lesson range', rangeText || '—'));
  }
  if (uniqueDays.length) {
    sectionChildren.push(kvParagraph('Unique lesson days', uniqueDays.join(', ')));
  }
  sectionChildren.push(kvParagraph('Generated at', `${generatedAt} (TZ: ${timezone})`));
  sectionChildren.push(paragraphSpacer());

  // Guardian information
  sectionChildren.push(new Paragraph({ text: 'Guardian information', heading: HeadingLevel.HEADING_2 }));
  sectionChildren.push(kvParagraph('Guardian', guardianName));
  sectionChildren.push(kvParagraph('Email', snapshot.guardian?.email || '—'));
  sectionChildren.push(kvParagraph('Phone', snapshot.guardian?.phone || '—'));
  sectionChildren.push(kvParagraph('Guardian timezone', snapshot.guardian?.timezone || timezone));
  sectionChildren.push(paragraphSpacer());

  // Summary table
  const summaryTable = createTableFromMatrix(
    ['Metric', 'Value'],
    [
      ['Lessons', formatNumber(snapshot.counts?.lessonCount || 0)],
      ['Students', formatNumber(snapshot.counts?.studentCount || 0)],
      ['Teachers', formatNumber(snapshot.counts?.teacherCount || 0)],
      ['Unique days', formatNumber(snapshot.counts?.dayCount || 0)],
      ['Total hours', formatHours(snapshot.hours?.totalHours || 0)]
    ]
  );
  if (summaryTable) {
    sectionChildren.push(new Paragraph({ text: 'Summary', heading: HeadingLevel.HEADING_2 }));
    sectionChildren.push(summaryTable);
    sectionChildren.push(paragraphSpacer());
  }

  // Financials
  const financials = snapshot.financials || {};
  const transferFeeDetails = financials.transferFee || null;
  const financialRows = [
    ['Subtotal', formatCurrency(financials.subtotal || 0)]
  ];

  if (transferFeeDetails) {
    const label = transferFeeDetails.waived ? 'Transfer fee (waived)' : 'Transfer fee';
    const parts = [formatCurrency(transferFeeDetails.amount || 0)];
    const transferValueNumeric = Number(transferFeeDetails.value);
    if (transferFeeDetails.mode === 'percent' && Number.isFinite(transferValueNumeric)) {
      parts.push(`(${transferValueNumeric}%)`);
    }
    if (!transferFeeDetails.waived && transferFeeDetails.waivedByCoverage) {
      parts.push('(coverage)');
    }
    if (transferFeeDetails.waived && transferFeeDetails.waivedByCoverage) {
      parts.push('(waived via coverage)');
    }
    financialRows.push([label, parts.join(' ')]);
  }

  financialRows.push(
    ['Discount', financials.discount ? formatCurrency(financials.discount) : formatCurrency(0)],
    ['Tax', financials.tax ? formatCurrency(financials.tax) : formatCurrency(0)],
    ['Late fee', financials.lateFee ? formatCurrency(financials.lateFee) : formatCurrency(0)],
    ['Tip', financials.tip ? formatCurrency(financials.tip) : formatCurrency(0)],
    ['Total', formatCurrency(financials.total || 0)],
    ['Adjusted total', formatCurrency(financials.adjustedTotal || financials.total || 0)],
    ['Paid amount', formatCurrency(financials.paidAmount || 0)],
    ['Remaining balance', formatCurrency(financials.remainingBalance || 0)]
  );

  const financialTable = createTableFromMatrix(['Financial metric', 'Amount'], financialRows);
  if (financialTable) {
    sectionChildren.push(new Paragraph({ text: 'Financial summary', heading: HeadingLevel.HEADING_2 }));
    sectionChildren.push(financialTable);
    sectionChildren.push(paragraphSpacer());
  }

  // Items table
  if (Array.isArray(snapshot.items) && snapshot.items.length) {
    const itemRows = snapshot.items.map((item) => {
      const attendance = item.attendanceStatus
        || (item.attended === true ? 'attended'
          : item.attended === false ? 'absent'
            : '—');
      return [
        item.date?.formatted || '—',
        item.student?.name || '—',
        item.teacher?.name || '—',
        item.description || '—',
        formatNumber(item.durationMinutes || 0),
        formatHours(item.hours || 0),
        formatCurrency(item.amount || 0),
        attendance
      ];
    });

    const itemsTable = createTableFromMatrix(
      ['Date', 'Student', 'Teacher', 'Description', 'Duration (min)', 'Hours', 'Amount', 'Attendance'],
      itemRows
    );

    sectionChildren.push(new Paragraph({ text: 'Invoice items', heading: HeadingLevel.HEADING_2 }));
    sectionChildren.push(itemsTable);
    sectionChildren.push(paragraphSpacer());
  }

  // Student totals
  if (Array.isArray(snapshot.students) && snapshot.students.length) {
    const studentRows = snapshot.students.map((student) => [
      student.name || '—',
      formatNumber(student.lessons || 0),
      formatHours(student.hours || 0),
      formatCurrency(student.amount || 0)
    ]);

    const studentTable = createTableFromMatrix(['Student', 'Lessons', 'Hours', 'Amount'], studentRows);
    sectionChildren.push(new Paragraph({ text: 'Student totals', heading: HeadingLevel.HEADING_2 }));
    sectionChildren.push(studentTable);
    sectionChildren.push(paragraphSpacer());
  }

  // Teacher totals
  if (Array.isArray(snapshot.teachers) && snapshot.teachers.length) {
    const teacherRows = snapshot.teachers.map((teacher) => [
      teacher.name || '—',
      formatNumber(teacher.lessons || 0),
      formatHours(teacher.hours || 0),
      formatCurrency(teacher.amount || 0)
    ]);

    const teacherTable = createTableFromMatrix(['Teacher', 'Lessons', 'Hours', 'Amount'], teacherRows);
    sectionChildren.push(new Paragraph({ text: 'Teacher totals', heading: HeadingLevel.HEADING_2 }));
    sectionChildren.push(teacherTable);
    sectionChildren.push(paragraphSpacer());
  }

  // Adjustments removed from invoices

  // Payments
  if (Array.isArray(snapshot.paymentLogs) && snapshot.paymentLogs.length) {
    const paymentRows = snapshot.paymentLogs.map((log) => [
      log.processedAt?.formatted || '—',
      formatCurrency(log.amount || 0),
      log.method || '—',
      log.transactionId || '—',
      log.note || '—',
      log.tip ? formatCurrency(log.tip) : formatCurrency(0)
    ]);

    const paymentsTable = createTableFromMatrix(['Processed at', 'Amount', 'Method', 'Transaction ID', 'Note', 'Tip'], paymentRows);
    sectionChildren.push(new Paragraph({ text: 'Payments', heading: HeadingLevel.HEADING_2 }));
    sectionChildren.push(paymentsTable);
    sectionChildren.push(paragraphSpacer());
  }

  // Delivery log
  if (Array.isArray(snapshot.delivery?.channels) && snapshot.delivery.channels.length) {
    const deliveryRows = snapshot.delivery.channels.map((channel) => [
      channel.channel || '—',
      channel.status || '—',
      formatNumber(channel.attempt || 1),
      channel.templateId || '—',
      channel.sentAt?.formatted || '—',
      channel.messageHash || '—'
    ]);

    const deliveryTable = createTableFromMatrix(['Channel', 'Status', 'Attempt', 'Template', 'Sent at', 'Message hash'], deliveryRows);
    sectionChildren.push(new Paragraph({ text: 'Delivery history', heading: HeadingLevel.HEADING_2 }));
    sectionChildren.push(deliveryTable);
    sectionChildren.push(paragraphSpacer());
  }

  // Notes
  if (snapshot.notes?.public || snapshot.notes?.internal) {
    sectionChildren.push(new Paragraph({ text: 'Notes', heading: HeadingLevel.HEADING_2 }));
    if (snapshot.notes?.public) {
      sectionChildren.push(kvParagraph('Public note', snapshot.notes.public));
    }
    if (snapshot.notes?.internal) {
      sectionChildren.push(kvParagraph('Internal note', snapshot.notes.internal));
    }
    sectionChildren.push(paragraphSpacer());
  }

  // Previous invoice summary (optional)
  if (previousSnapshot) {
    const prevFinancials = previousSnapshot.financials || {};
    sectionChildren.push(new Paragraph({ text: 'Previous invoice summary', heading: HeadingLevel.HEADING_2 }));
    sectionChildren.push(kvParagraph('Invoice number', previousSnapshot.invoiceNumber || '—'));
    sectionChildren.push(kvParagraph('Billing period', previousSnapshot.billingPeriod?.label || '—'));
    const prevRangeText = [previousSnapshot.dateRange?.firstLesson?.formatted, previousSnapshot.dateRange?.lastLesson?.formatted]
      .filter(Boolean)
      .join(' → ');
    if (prevRangeText) {
      sectionChildren.push(kvParagraph('Lesson range', prevRangeText));
    }
    const prevSummaryTable = createTableFromMatrix(
      ['Metric', 'Value'],
      [
        ['Lessons', formatNumber(previousSnapshot.counts?.lessonCount || 0)],
        ['Students', formatNumber(previousSnapshot.counts?.studentCount || 0)],
        ['Total hours', formatHours(previousSnapshot.hours?.totalHours || 0)],
        ['Total', formatCurrency(prevFinancials.total || 0)],
        ['Paid amount', formatCurrency(prevFinancials.paidAmount || 0)]
      ]
    );
    if (prevSummaryTable) {
      sectionChildren.push(prevSummaryTable);
    }
    sectionChildren.push(paragraphSpacer());
  }

  sectionChildren.push(new Paragraph({
    children: [
      new TextRun({ text: 'Generated by Waraqa billing engine', italics: true })
    ],
    spacing: { before: 200, after: 0 }
  }));

  return Packer.toBuffer(doc);
};
