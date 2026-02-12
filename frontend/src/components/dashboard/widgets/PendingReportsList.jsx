import React from 'react';

const formatClassDate = (d) => {
  if (!d) return '—';
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '—';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekday = days[date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${weekday}, ${day} ${month} ${year} ${hour}:${minute} ${ampm}`;
};

const PendingReportsList = ({ reports = [], onOpen }) => {
  if (!reports || reports.length === 0) {
    return <div className="text-sm text-muted-foreground">No pending reports in the last 7 days.</div>;
  }

  // Helper to build a compact label for the class
  const classLabel = (r) => {
    // Prefer student name, then subject, then title
    const studentName = r.student?.studentName || `${r.student?.firstName || ''} ${r.student?.lastName || ''}`.trim();
    const subject = r.subject || r.title || '';
    if (studentName) {
      return subject ? `${studentName} — ${subject}` : studentName;
    }
    return subject || 'Class';
  };

  const statusFor = (r) => {
    // Determine if report was already submitted. Only treat as submitted when
    // there is an explicit submission timestamp/flag (don't infer from presence
    // of other report fields like attendance or notes).
    if (r.classReport && (r.classReport.submittedAt || r.classReport.submitted)) return 'submitted';
    if (r.report && (r.report.submitted === true || r.report.status === 'submitted')) return 'submitted';
    if (r.status === 'submitted' || r.submitted === true) return 'submitted';
    if (r.reportSubmission?.status === 'submitted') return 'submitted';

    const now = new Date();
    // Per instructions:
    // - "pending" means the class is within the 72-hour window after class time
    //   (teacherDeadline >= now)
    // - "open" means admin extended the submission window (adminExtension active)

    // If admin extension is active -> treat as OPEN (teacher can submit because admin extended)
    if (r.reportSubmission?.adminExtension?.granted && r.reportSubmission.adminExtension.expiresAt && new Date(r.reportSubmission.adminExtension.expiresAt) >= now) {
      return 'open';
    }

    // If teacher deadline exists and is in the future -> PENDING (within 72h window)
    if (r.reportSubmission?.teacherDeadline && new Date(r.reportSubmission.teacherDeadline) >= now) {
      return 'pending';
    }

    // If flagged as overdue (older classes still in allowance), mark overdue
    if (r._isOverdue) return 'overdue';

    // If the window has expired (or we can't determine), treat as overdue so it doesn't
    // masquerade as pending.
    return 'overdue';
  };

  // Deduplicate reports that refer to the same class instance (same teacher, student and scheduled time).
  const deduped = [];
  const seen = new Map();
  for (const r of reports) {
    const when = r.scheduledDate ? new Date(r.scheduledDate) : (r.startTime ? new Date(r.startTime) : null);
    const key = `${r.teacher?._id || ''}::${r.student?.studentId || r.student?.studentId || ''}::${when ? when.toISOString() : r._id}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
      deduped.push(r);
      continue;
    }
    // Prefer entries that are explicitly 'scheduled' over others, or prefer not-overdue
    const preferExisting = (existing.status === 'scheduled') || (!existing._isOverdue && r._isOverdue);
    if (!preferExisting) {
      // replace with the new one
      const idx = deduped.indexOf(existing);
      if (idx >= 0) deduped[idx] = r;
      seen.set(key, r);
    }
  }

  const visible = deduped.filter((r) => statusFor(r) !== 'submitted');
  if (visible.length === 0) {
    return <div className="text-sm text-muted-foreground">No pending reports.</div>;
  }

  return (
    <div className="max-h-[420px] overflow-y-auto pr-2">
      <div className="space-y-2">
      {visible.slice(0, 50).map((r) => {
        const id = r._id || r.id || Math.random();
        const when = r.scheduledDate ? new Date(r.scheduledDate) : (r.startTime ? new Date(r.startTime) : null);
        const timeLabel = when ? formatClassDate(when) : (r.time || '—');
        const status = statusFor(r);

        const rowAccent = status === 'open'
          ? 'border-violet-200 bg-violet-50/50'
          : status === 'overdue'
            ? 'border-amber-200 bg-amber-50/50'
            : 'border-yellow-200 bg-yellow-50/50';

        return (
          <div key={id} className={`p-3 rounded-xl border ${rowAccent} hover:bg-muted/60 transition-colors flex items-start gap-3`}>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{classLabel(r)}</div>
              <div className="text-xs text-muted-foreground">{timeLabel}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                <span>{r.isRecurring ? 'Recurring' : ''}</span>
                <span>{r.duration ? `${r.duration} min` : ''}</span>
                {r.subject && <span>• {r.subject}</span>}
              </div>
            </div>

            <div className="flex flex-col items-end space-y-2">
              <div>
                {status === 'open' && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-800">Open</span>
                )}
                {status === 'pending' && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">Pending</span>
                )}
                {status === 'overdue' && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">Overdue</span>
                )}
              </div>

              <div>
                <button onClick={() => onOpen && onOpen(r)} className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-95">Open</button>
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
};

export default PendingReportsList;
