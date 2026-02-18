import React from 'react';
import { FileText } from 'lucide-react';

const formatClassParts = (d) => {
  if (!d) return { timeLabel: '—', dateLabel: '—' };
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  if (isNaN(date.getTime())) return { timeLabel: '—', dateLabel: '—' };
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekday = days[date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return {
    timeLabel: `${hour}:${minute} ${ampm}`,
    dateLabel: `${weekday}, ${day} ${month}`,
  };
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

  const visible = deduped
    .filter((r) => statusFor(r) !== 'submitted')
    .sort((a, b) => {
      const aWhen = a.scheduledDate ? new Date(a.scheduledDate) : (a.startTime ? new Date(a.startTime) : null);
      const bWhen = b.scheduledDate ? new Date(b.scheduledDate) : (b.startTime ? new Date(b.startTime) : null);
      const aTime = aWhen && !isNaN(aWhen.getTime()) ? aWhen.getTime() : 0;
      const bTime = bWhen && !isNaN(bWhen.getTime()) ? bWhen.getTime() : 0;
      return aTime - bTime;
    });
  if (visible.length === 0) {
    return <div className="text-sm text-muted-foreground">No pending reports.</div>;
  }

  return (
    <div className="max-h-[420px] overflow-y-auto pr-2">
      <div className="space-y-2">
      {visible.slice(0, 50).map((r, index) => {
        const id = r._id || r.id || Math.random();
        const when = r.scheduledDate ? new Date(r.scheduledDate) : (r.startTime ? new Date(r.startTime) : null);
        const whenParts = when ? formatClassParts(when) : { timeLabel: '—', dateLabel: '—' };
        const status = statusFor(r);
        const lastLessonTopic = r.previousReport?.lessonTopic || r.classReport?.lessonTopic || null;
        const detailParts = [r.duration ? `${r.duration} min` : null, lastLessonTopic].filter(Boolean);

        const pastelPalette = [
          'bg-rose-100/80',
          'bg-amber-100/80',
          'bg-lime-100/80',
          'bg-sky-100/80',
          'bg-violet-100/80',
          'bg-teal-100/80',
        ];
        const rowAccent = pastelPalette[index % pastelPalette.length];

        return (
          <div key={id} className={`p-3 rounded-xl ${rowAccent} shadow-sm hover:shadow-md transition-shadow grid grid-cols-[auto,1fr,auto] items-center gap-3`}>
            <div className="text-xs text-muted-foreground">
              <div className="text-sm font-semibold text-foreground tabular-nums">{whenParts.timeLabel}</div>
              <div className="text-[11px] text-muted-foreground">{whenParts.dateLabel}</div>
            </div>

            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{classLabel(r)}</div>
              <div className="text-xs text-muted-foreground truncate">
                {detailParts.length ? detailParts.join(' • ') : (r.duration ? `${r.duration} min` : '—')}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {status === 'open' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-800">Open</span>
              )}
              {status === 'pending' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-yellow-100 text-yellow-800">Pending</span>
              )}
              {status === 'overdue' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800">Overdue</span>
              )}
              <button
                onClick={() => onOpen && onOpen(r)}
                className="rounded-full bg-primary p-2 text-primary-foreground shadow-sm hover:opacity-90"
                aria-label="Open report"
                title="Open report"
              >
                <FileText className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
};

export default PendingReportsList;
