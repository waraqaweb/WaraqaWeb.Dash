import React, { useEffect, useMemo, useState } from 'react';
import { X, ClipboardList, Users, AlertTriangle } from 'lucide-react';
import { submitMeetingReport } from '../../api/meetings';
import { MEETING_TYPES } from '../../constants/meetingConstants';

const toList = (value = '') => {
  if (!value) return [];
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const stringifyList = (values = []) => {
  if (!Array.isArray(values) || !values.length) return '';
  return values.join('\n');
};

const emptyEvaluationStudent = (student = {}) => ({
  studentId: student.studentId || '',
  studentName: student.studentName || '',
  curriculaText: stringifyList(student.curricula || []),
  studyPlan: student.studyPlan || '',
  learningPreferences: student.learningPreferences || ''
});

const emptyTeacherSyncStudent = (student = {}) => ({
  studentId: student.studentId || '',
  studentName: student.studentName || '',
  currentLevelNotes: student.currentLevelNotes || '',
  futurePlan: student.futurePlan || ''
});

const buildInitialState = (meeting) => {
  if (!meeting) {
    return {
      students: [],
      guardianStudent: {
        studentId: '',
        studentName: '',
        currentLevel: '',
        assessmentNotes: '',
        nextPlan: ''
      },
      notes: ''
    };
  }

  const bookingStudents = Array.isArray(meeting.bookingPayload?.students)
    ? meeting.bookingPayload.students
    : [];
  const report = meeting.report || {};

  if (meeting.meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION) {
    const defaults = report.evaluation?.students?.length
      ? report.evaluation.students
      : bookingStudents;
    return {
      students: (defaults || []).map((student) => emptyEvaluationStudent(student)),
      notes: report.notes || ''
    };
  }

  if (meeting.meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP) {
    const guardianReport = report.guardianFollowUp || {};
    const primaryStudent = guardianReport.studentName
      ? guardianReport
      : bookingStudents[0] || {};
    return {
      guardianStudent: {
        studentId: guardianReport.studentId || primaryStudent.studentId || '',
        studentName: guardianReport.studentName || primaryStudent.studentName || '',
        currentLevel: guardianReport.currentLevel || '',
        assessmentNotes: guardianReport.assessmentNotes || '',
        nextPlan: guardianReport.nextPlan || ''
      },
      notes: report.notes || ''
    };
  }

  if (meeting.meetingType === MEETING_TYPES.TEACHER_SYNC) {
    const defaults = report.teacherSync?.students?.length
      ? report.teacherSync.students
      : bookingStudents;
    return {
      students: (defaults || []).map((student) => emptyTeacherSyncStudent(student)),
      notes: report.notes || ''
    };
  }

  return {
    students: [],
    guardianStudent: {
      studentId: bookingStudents[0]?.studentId || '',
      studentName: bookingStudents[0]?.studentName || '',
      currentLevel: '',
      assessmentNotes: '',
      nextPlan: ''
    },
    notes: report.notes || ''
  };
};

const MeetingReportModal = ({ isOpen, meeting = null, onClose, onSaved }) => {
  const [formState, setFormState] = useState(() => buildInitialState(meeting));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const meetingType = meeting?.meetingType;
  const meetingLabel = useMemo(() => {
    if (!meeting) return 'Meeting';
    const labelMap = {
      [MEETING_TYPES.NEW_STUDENT_EVALUATION]: 'Evaluation Session',
      [MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP]: 'Guardian Follow-up',
      [MEETING_TYPES.TEACHER_SYNC]: 'Teacher Sync'
    };
    return labelMap[meetingType] || 'Meeting';
  }, [meeting, meetingType]);

  useEffect(() => {
    if (!isOpen) return;
    setFormState(buildInitialState(meeting));
    setError('');
    setSuccessMessage('');
  }, [isOpen, meeting]);

  const updateEvaluationStudent = (index, field, value) => {
    setFormState((prev) => {
      const students = [...(prev.students || [])];
      students[index] = { ...students[index], [field]: value };
      return { ...prev, students };
    });
  };

  const updateTeacherSyncStudent = (index, field, value) => {
    setFormState((prev) => {
      const students = [...(prev.students || [])];
      students[index] = { ...students[index], [field]: value };
      return { ...prev, students };
    });
  };

  const updateGuardianStudent = (field, value) => {
    setFormState((prev) => ({
      ...prev,
      guardianStudent: {
        ...(prev.guardianStudent || {}),
        [field]: value
      }
    }));
  };

  const handleNotesChange = (value) => {
    setFormState((prev) => ({ ...prev, notes: value }));
  };

  const buildPayload = () => {
    const payload = { notes: formState.notes || '' };
    if (meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION) {
      payload.students = (formState.students || []).map((student) => ({
        studentId: student.studentId || undefined,
        studentName: student.studentName,
        curricula: toList(student.curriculaText),
        studyPlan: student.studyPlan,
        learningPreferences: student.learningPreferences
      }));
    } else if (meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP) {
      payload.studentId = formState.guardianStudent?.studentId || undefined;
      payload.studentName = formState.guardianStudent?.studentName || '';
      payload.currentLevel = formState.guardianStudent?.currentLevel || '';
      payload.assessmentNotes = formState.guardianStudent?.assessmentNotes || '';
      payload.nextPlan = formState.guardianStudent?.nextPlan || '';
    } else if (meetingType === MEETING_TYPES.TEACHER_SYNC) {
      payload.students = (formState.students || []).map((student) => ({
        studentId: student.studentId || undefined,
        studentName: student.studentName,
        currentLevelNotes: student.currentLevelNotes,
        futurePlan: student.futurePlan
      }));
    }
    return payload;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!meeting?._id && !meeting?.id) {
      setError('Missing meeting reference');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = buildPayload();
      const meetingId = meeting._id || meeting.id;
      await submitMeetingReport(meetingId, payload);
      setSuccessMessage('Meeting report saved');
      if (onSaved) {
        onSaved();
      }
    } catch (err) {
      const message = err?.response?.data?.message || 'Failed to save meeting report';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen || !meeting) return null;

  const renderEvaluationForm = () => (
    <div className="space-y-4">
      {(formState.students || []).map((student, idx) => (
        <div key={student.studentId || `${idx}-${student.studentName}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Users className="h-4 w-4 text-teal-600" />
            <span>{student.studentName || `Student ${idx + 1}`}</span>
          </div>
          <label className="block text-xs font-medium text-slate-600">Curricula / focus</label>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            placeholder="e.g., Qaida Noorania, Tajweed basics"
            value={student.curriculaText}
            onChange={(e) => updateEvaluationStudent(idx, 'curriculaText', e.target.value)}
          />
          <label className="mt-3 block text-xs font-medium text-slate-600">Study plan</label>
          <textarea
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            placeholder="Next steps, assignments, pacing"
            value={student.studyPlan}
            onChange={(e) => updateEvaluationStudent(idx, 'studyPlan', e.target.value)}
          />
          <label className="mt-3 block text-xs font-medium text-slate-600">Learning preferences</label>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            placeholder="Energy level, coaching cues, motivation"
            value={student.learningPreferences}
            onChange={(e) => updateEvaluationStudent(idx, 'learningPreferences', e.target.value)}
          />
        </div>
      ))}
      {!formState.students?.length && (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
          No students were attached to this evaluation.
        </div>
      )}
    </div>
  );

  const renderGuardianFollowUpForm = () => (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Student name</label>
        <input
          type="text"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          value={formState.guardianStudent?.studentName || ''}
          onChange={(e) => updateGuardianStudent('studentName', e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">Current level snapshot</label>
        <textarea
          rows={2}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          value={formState.guardianStudent?.currentLevel || ''}
          onChange={(e) => updateGuardianStudent('currentLevel', e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">Key observations</label>
        <textarea
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          value={formState.guardianStudent?.assessmentNotes || ''}
          onChange={(e) => updateGuardianStudent('assessmentNotes', e.target.value)}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600">Next plan</label>
        <textarea
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
          value={formState.guardianStudent?.nextPlan || ''}
          onChange={(e) => updateGuardianStudent('nextPlan', e.target.value)}
        />
      </div>
    </div>
  );

  const renderTeacherSyncForm = () => (
    <div className="space-y-4">
      {(formState.students || []).map((student, idx) => (
        <div key={student.studentId || `${idx}-${student.studentName}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Users className="h-4 w-4 text-indigo-600" />
            <span>{student.studentName || `Student ${idx + 1}`}</span>
          </div>
          <label className="block text-xs font-medium text-slate-600">Current level notes</label>
          <textarea
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            value={student.currentLevelNotes}
            onChange={(e) => updateTeacherSyncStudent(idx, 'currentLevelNotes', e.target.value)}
          />
          <label className="mt-3 block text-xs font-medium text-slate-600">Future plan</label>
          <textarea
            rows={3}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            value={student.futurePlan}
            onChange={(e) => updateTeacherSyncStudent(idx, 'futurePlan', e.target.value)}
          />
        </div>
      ))}
      {!formState.students?.length && (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
          No students attached to this sync.
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
      <div className="relative w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-teal-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{meetingLabel} report</h2>
              <p className="text-sm text-slate-500">
                {meeting.bookingPayload?.guardianName || meeting.attendees?.teacherName || 'Admin meeting'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 px-6 py-5">
          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}
          {successMessage && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {successMessage}
            </div>
          )}

          {meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION && renderEvaluationForm()}
          {meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP && renderGuardianFollowUpForm()}
          {meetingType === MEETING_TYPES.TEACHER_SYNC && renderTeacherSyncForm()}

          <div>
            <label className="block text-xs font-medium text-slate-600">General notes (visible to admin team)</label>
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
              value={formState.notes || ''}
              onChange={(e) => handleNotesChange(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">Reports are saved under the meeting record so you can revisit them anytime.</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center rounded-full bg-teal-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save report'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MeetingReportModal;
