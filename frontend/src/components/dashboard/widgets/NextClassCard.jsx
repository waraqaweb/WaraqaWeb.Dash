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

  return (
    <div className="bg-card rounded-lg border border-border p-4 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">Next Class</h3>
      <div>
        <div className="text-sm text-muted-foreground">{formatClassDate(nextClass.scheduledDate)}</div>
        <div className="text-base font-medium">{buildStudentLabel(nextClass)}</div>
  <div className="text-sm text-muted-foreground">With {`${nextClass.teacher?.firstName || ''} ${nextClass.teacher?.lastName || ''}`.trim()}</div>
        <div className="mt-2 text-xs text-muted-foreground flex gap-3 flex-wrap">
          {nextClass.duration && <span>{nextClass.duration} min</span>}
          {nextClass.subject && <span>• {nextClass.subject}</span>}
        </div>
        { nextClass.previousReport && (
          <div className="mt-3 text-sm">
            { nextClass.previousReport.lessonTopic && (
              <div className="text-xs text-muted-foreground">Previous lesson: {nextClass.previousReport.lessonTopic}</div>
            ) }
            { nextClass.previousReport.teacherNotes && (
              <div className="mt-1 text-xs text-muted-foreground">Teacher notes: {nextClass.previousReport.teacherNotes}</div>
            ) }
            { nextClass.previousReport.recitedQuran && (
              <div className="mt-1 text-xs text-muted-foreground">Quran recited: {nextClass.previousReport.recitedQuran}</div>
            ) }
            { (nextClass.previousReport.surah || nextClass.previousReport.verseEnd) && (
              <div className="mt-1 text-xs text-muted-foreground">Surah: {nextClass.previousReport.surah?.name || '—'} {nextClass.previousReport.verseEnd ? `(up to verse ${nextClass.previousReport.verseEnd})` : ''}</div>
            ) }
            { nextClass.previousReport.classScore != null && (
              <div className="mt-1 text-xs text-muted-foreground">Score: {nextClass.previousReport.classScore}/5</div>
            ) }
          </div>
        )}
        { !nextClass.previousReport && (nextClass.previousLessonTopic || nextClass.lastSubmittedLessonTopic || nextClass.lastLessonTopic) && (
          <div className="mt-2 text-xs text-muted-foreground">Previous lesson: {nextClass.previousLessonTopic || nextClass.lastSubmittedLessonTopic || nextClass.lastLessonTopic}</div>
        ) }
      </div>
    </div>
  );
};

export default NextClassCard;
