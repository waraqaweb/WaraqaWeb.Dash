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
  let hour = date.getHours();
  const minute = String(date.getMinutes()).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${weekday}, ${day} ${month} ${hour}:${minute} ${ampm}`;
};

const formatClassDateParts = (d) => {
  if (!d) return { time: '—', date: '' };
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  if (isNaN(date.getTime())) return { time: '—', date: '' };

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
    time: `${hour}:${minute} ${ampm}`,
    date: `${weekday}, ${day} ${month}`,
  };
};

const buildStudentLabel = (nextClass) => {
  if (!nextClass) return '';
  return nextClass.student?.studentName || `${nextClass.student?.firstName || ''} ${nextClass.student?.lastName || ''}`.trim() || 'Student';
};

const NextClassCard = ({ nextClass }) => {
  if (!nextClass) {
    return (
      <div className="bg-card rounded-lg border border-border p-4 sm:p-6">
        <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">Next Class</h3>
        <div className="text-sm text-muted-foreground">No upcoming classes</div>
      </div>
    );
  }

  const lastTopic =
    nextClass.previousReport?.lessonTopic
    || nextClass.previousLessonTopic
    || nextClass.lastSubmittedLessonTopic
    || nextClass.lastLessonTopic
    || null;

  const when = formatClassDateParts(nextClass.scheduledDate);

  const infoTiles = [
    {
      key: 'topic',
      label: 'Last attended topic',
      value: lastTopic || '—'
    },
    nextClass.previousReport?.recitedQuran
      ? { key: 'quran', label: 'Quran recited', value: nextClass.previousReport.recitedQuran }
      : null,
    (nextClass.previousReport?.surah || nextClass.previousReport?.verseEnd)
      ? {
          key: 'surah',
          label: 'Surah',
          value: `${nextClass.previousReport.surah?.name || '—'}${nextClass.previousReport.verseEnd ? ` (to verse ${nextClass.previousReport.verseEnd})` : ''}`
        }
      : null,
    nextClass.previousReport?.teacherNotes
      ? { key: 'notes', label: 'Teacher notes', value: nextClass.previousReport.teacherNotes }
      : null,
  ].filter(Boolean);

  return (
    <div className="bg-card rounded-lg border border-border p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">Next Class</h3>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        {/* Left: time + date */}
        <div className="shrink-0 sm:w-40">
          <div className="text-2xl font-semibold text-foreground tracking-tight">{when.time}</div>
          <div className="mt-0.5 text-sm text-muted-foreground">{when.date || formatClassDate(nextClass.scheduledDate)}</div>
        </div>

        {/* Right: everything else */}
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-foreground truncate">{buildStudentLabel(nextClass)}</div>

          <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {nextClass.duration && (
            <span className="rounded-full bg-brand/20 px-2.5 py-1 font-semibold text-brand">{nextClass.duration} min</span>
          )}
          {nextClass.subject && (
            <span className="rounded-full bg-primary/20 px-2.5 py-1 font-semibold text-primary">{nextClass.subject}</span>
          )}
          {nextClass.previousReport?.classScore != null && (
            <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-foreground">Score: {nextClass.previousReport.classScore}/5</span>
          )}
          </div>

          {/* Topic: no border tile */}
          <div className="mt-3 text-sm">
            <div className="text-xs text-muted-foreground">
              Last attended topic: <span className="text-foreground font-medium">{lastTopic || '—'}</span>
              {nextClass.previousReport?.classScore != null && (
            <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-foreground">Score: {nextClass.previousReport.classScore}/5</span>
          )}
            </div>
          </div>

          {/* Other details in a tidy grid */}
          {infoTiles.filter((t) => t.key !== 'topic').length > 0 && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
              {infoTiles.filter((t) => t.key !== 'topic').map((it) => (
                <div key={it.key} className="rounded-md border border-border bg-background px-3 py-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{it.label}</div>
                  <div className="mt-0.5 text-sm font-medium text-foreground break-words">{it.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NextClassCard;
