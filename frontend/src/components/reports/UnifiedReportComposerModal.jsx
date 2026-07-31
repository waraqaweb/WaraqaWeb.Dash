import React, { useEffect, useMemo, useState } from 'react';
import { X, ClipboardList, AlertTriangle, Users } from 'lucide-react';
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

const buildMeetingInitialState = (meeting) => {
  const bookingStudents = Array.isArray(meeting?.bookingPayload?.students)
    ? meeting.bookingPayload.students
    : [];
  const report = meeting?.report || {};

  if (meeting?.meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION) {
    const defaults = report.evaluation?.students?.length
      ? report.evaluation.students
      : bookingStudents;

    return {
      students: (defaults || []).map((student) => ({
        studentId: student.studentId || '',
        studentName: student.studentName || '',
        curriculaText: stringifyList(student.curricula || []),
        studyPlan: student.studyPlan || '',
        learningPreferences: student.learningPreferences || ''
      })),
      guardianStudent: {
        studentId: '',
        studentName: '',
        currentLevel: '',
        assessmentNotes: '',
        nextPlan: ''
      },
      notes: report.notes || ''
    };
  }

  if (meeting?.meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP) {
    const guardianReport = report.guardianFollowUp || {};
    const primaryStudent = guardianReport.studentName
      ? guardianReport
      : bookingStudents[0] || {};

    return {
      students: [],
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

  if (meeting?.meetingType === MEETING_TYPES.TEACHER_SYNC) {
    const defaults = report.teacherSync?.students?.length
      ? report.teacherSync.students
      : bookingStudents;

    return {
      students: (defaults || []).map((student) => ({
        studentId: student.studentId || '',
        studentName: student.studentName || '',
        currentLevelNotes: student.currentLevelNotes || '',
        futurePlan: student.futurePlan || ''
      })),
      guardianStudent: {
        studentId: '',
        studentName: '',
        currentLevel: '',
        assessmentNotes: '',
        nextPlan: ''
      },
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

const reportTitleByMeetingType = (meetingType) => {
  if (meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION) return 'Evaluation Session report';
  if (meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP) return 'Guardian Follow-up report';
  if (meetingType === MEETING_TYPES.TEACHER_SYNC) return 'Teacher Sync report';
  return 'Meeting report';
};

const UnifiedReportComposerModal = ({
  isOpen,
  mode,
  context,
  onClose,
  onSubmit,
  saving = false,
  error = '',
  successMessage = ''
}) => {
  const [state, setState] = useState({
    students: [],
    guardianStudent: {
      studentId: '',
      studentName: '',
      currentLevel: '',
      assessmentNotes: '',
      nextPlan: ''
    },
    notes: '',
    classDraft: {
      attendance: 'attended',
      subject: '',
      lessonTopic: '',
      classScore: 5,
      teacherNotes: '',
      countAbsentForBilling: false,
      cancellationReason: ''
    }
  });

  useEffect(() => {
    if (!isOpen) return;

    if (mode === 'meeting') {
      setState(buildMeetingInitialState(context?.meeting || null));
      return;
    }

    const classReport = context?.classData?.classReport || {};
    const classSubject = context?.classData?.subject || '';
    const classAttendance = classReport.attendance || context?.classData?.status || 'attended';
    const normalizedAttendance = String(classAttendance).startsWith('cancelled')
      ? classAttendance
      : classAttendance === 'missed_by_student' || classAttendance === 'no_show_both'
        ? classAttendance
        : 'attended';
    setState({
      students: [],
      guardianStudent: {
        studentId: '',
        studentName: '',
        currentLevel: '',
        assessmentNotes: '',
        nextPlan: ''
      },
      notes: '',
      classDraft: {
        attendance: normalizedAttendance,
        subject: classReport.subject || classSubject || '',
        lessonTopic: classReport.lessonTopic || classReport.customLessonTopic || '',
        classScore: Number.isFinite(Number(classReport.classScore)) ? Number(classReport.classScore) : 5,
        teacherNotes: classReport.teacherNotes || '',
        countAbsentForBilling: Boolean(classReport.countAbsentForBilling),
        cancellationReason: context?.classData?.cancellation?.reason || ''
      }
    });
  }, [isOpen, mode, context]);

  const title = useMemo(() => {
    if (mode === 'meeting') {
      return reportTitleByMeetingType(context?.meeting?.meetingType);
    }
    return 'Class report';
  }, [mode, context]);

  const subtitle = useMemo(() => {
    if (mode === 'meeting') {
      return context?.meeting?.bookingPayload?.guardianName
        || context?.meeting?.attendees?.teacherName
        || 'Admin meeting';
    }

    const student = context?.classData?.student || {};
    const teacher = context?.classData?.teacher || {};
    const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ');
    const teacherName = [teacher.firstName, teacher.lastName].filter(Boolean).join(' ');
    return [studentName, teacherName].filter(Boolean).join(' • ') || 'Class report';
  }, [mode, context]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (mode === 'meeting') {
      const meeting = context?.meeting;
      if (!meeting?._id && !meeting?.id) return;

      const payload = { notes: state.notes || '' };
      const meetingType = meeting?.meetingType;

      if (meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION) {
        payload.students = (state.students || []).map((student) => ({
          studentId: student.studentId || undefined,
          studentName: student.studentName || '',
          curricula: toList(student.curriculaText),
          studyPlan: student.studyPlan || '',
          learningPreferences: student.learningPreferences || ''
        }));
      } else if (meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP) {
        payload.studentId = state.guardianStudent?.studentId || undefined;
        payload.studentName = state.guardianStudent?.studentName || '';
        payload.currentLevel = state.guardianStudent?.currentLevel || '';
        payload.assessmentNotes = state.guardianStudent?.assessmentNotes || '';
        payload.nextPlan = state.guardianStudent?.nextPlan || '';
      } else if (meetingType === MEETING_TYPES.TEACHER_SYNC) {
        payload.students = (state.students || []).map((student) => ({
          studentId: student.studentId || undefined,
          studentName: student.studentName || '',
          currentLevelNotes: student.currentLevelNotes || '',
          futurePlan: student.futurePlan || ''
        }));
      }

      await onSubmit?.({ mode: 'meeting', id: meeting._id || meeting.id, payload });
      return;
    }

    const classId = context?.classData?._id;
    if (!classId) return;

    await onSubmit?.({
      mode: 'class',
      id: classId,
      payload: {
        attendance: state.classDraft?.attendance || 'attended',
        subject: state.classDraft?.subject || undefined,
        subjects: state.classDraft?.subject ? [state.classDraft.subject] : undefined,
        lessonTopic: state.classDraft?.lessonTopic || undefined,
        classScore: Number(state.classDraft?.classScore || 0),
        teacherNotes: state.classDraft?.teacherNotes || undefined,
        countAbsentForBilling: Boolean(state.classDraft?.countAbsentForBilling),
        cancellationReason: state.classDraft?.cancellationReason || undefined,
      },
    });
  };

  const updateStudent = (index, field, value) => {
    setState((prev) => {
      const nextStudents = [...(prev.students || [])];
      nextStudents[index] = { ...nextStudents[index], [field]: value };
      return { ...prev, students: nextStudents };
    });
  };

  if (!isOpen) return null;

  const meetingType = context?.meeting?.meetingType;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
      <div className="relative flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-teal-600" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <p className="text-sm text-slate-500">{subtitle}</p>
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

        <form onSubmit={handleSubmit} className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {error ? (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          ) : null}

          {successMessage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {successMessage}
            </div>
          ) : null}

          {mode === 'meeting' && meetingType === MEETING_TYPES.NEW_STUDENT_EVALUATION ? (
            <div className="space-y-4">
              {(state.students || []).map((student, idx) => (
                <div key={student.studentId || `${idx}-${student.studentName}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Users className="h-4 w-4 text-teal-600" />
                    <span>{student.studentName || `Student ${idx + 1}`}</span>
                  </div>
                  <label className="block text-xs font-medium text-slate-600">Curricula / focus</label>
                  <textarea
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                    value={student.curriculaText || ''}
                    onChange={(e) => updateStudent(idx, 'curriculaText', e.target.value)}
                  />
                  <label className="mt-3 block text-xs font-medium text-slate-600">Study plan</label>
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                    value={student.studyPlan || ''}
                    onChange={(e) => updateStudent(idx, 'studyPlan', e.target.value)}
                  />
                  <label className="mt-3 block text-xs font-medium text-slate-600">Learning preferences</label>
                  <textarea
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                    value={student.learningPreferences || ''}
                    onChange={(e) => updateStudent(idx, 'learningPreferences', e.target.value)}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {mode === 'meeting' && meetingType === MEETING_TYPES.CURRENT_STUDENT_FOLLOW_UP ? (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Student name</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                  value={state.guardianStudent?.studentName || ''}
                  onChange={(e) => setState((prev) => ({ ...prev, guardianStudent: { ...prev.guardianStudent, studentName: e.target.value } }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Current level snapshot</label>
                <textarea
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                  value={state.guardianStudent?.currentLevel || ''}
                  onChange={(e) => setState((prev) => ({ ...prev, guardianStudent: { ...prev.guardianStudent, currentLevel: e.target.value } }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Key observations</label>
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                  value={state.guardianStudent?.assessmentNotes || ''}
                  onChange={(e) => setState((prev) => ({ ...prev, guardianStudent: { ...prev.guardianStudent, assessmentNotes: e.target.value } }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Next plan</label>
                <textarea
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                  value={state.guardianStudent?.nextPlan || ''}
                  onChange={(e) => setState((prev) => ({ ...prev, guardianStudent: { ...prev.guardianStudent, nextPlan: e.target.value } }))}
                />
              </div>
            </div>
          ) : null}

          {mode === 'meeting' && meetingType === MEETING_TYPES.TEACHER_SYNC ? (
            <div className="space-y-4">
              {(state.students || []).map((student, idx) => (
                <div key={student.studentId || `${idx}-${student.studentName}`} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Users className="h-4 w-4 text-indigo-600" />
                    <span>{student.studentName || `Student ${idx + 1}`}</span>
                  </div>
                  <label className="block text-xs font-medium text-slate-600">Current level notes</label>
                  <textarea
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    value={student.currentLevelNotes || ''}
                    onChange={(e) => updateStudent(idx, 'currentLevelNotes', e.target.value)}
                  />
                  <label className="mt-3 block text-xs font-medium text-slate-600">Future plan</label>
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                    value={student.futurePlan || ''}
                    onChange={(e) => updateStudent(idx, 'futurePlan', e.target.value)}
                  />
                </div>
              ))}
            </div>
          ) : null}

          {mode === 'class' ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">Attendance</label>
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                  value={state.classDraft?.attendance || 'attended'}
                  onChange={(e) => setState((prev) => ({
                    ...prev,
                    classDraft: { ...prev.classDraft, attendance: e.target.value }
                  }))}
                >
                  <option value="attended">Attended</option>
                  <option value="missed_by_student">Missed by student</option>
                  <option value="cancelled_by_teacher">Cancelled by teacher</option>
                  <option value="cancelled_by_student">Cancelled by student</option>
                  <option value="no_show_both">No-show both</option>
                </select>
              </div>

              {state.classDraft?.attendance === 'attended' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Subject</label>
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                      value={state.classDraft?.subject || ''}
                      onChange={(e) => setState((prev) => ({
                        ...prev,
                        classDraft: { ...prev.classDraft, subject: e.target.value }
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Lesson topic</label>
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                      value={state.classDraft?.lessonTopic || ''}
                      onChange={(e) => setState((prev) => ({
                        ...prev,
                        classDraft: { ...prev.classDraft, lessonTopic: e.target.value }
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Class performance (1 to 5)</label>
                    <input
                      type="number"
                      min="1"
                      max="5"
                      step="1"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                      value={state.classDraft?.classScore ?? 5}
                      onChange={(e) => setState((prev) => ({
                        ...prev,
                        classDraft: { ...prev.classDraft, classScore: Number(e.target.value || 5) }
                      }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Teacher notes</label>
                    <textarea
                      rows={4}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                      value={state.classDraft?.teacherNotes || ''}
                      onChange={(e) => setState((prev) => ({
                        ...prev,
                        classDraft: { ...prev.classDraft, teacherNotes: e.target.value }
                      }))}
                    />
                  </div>
                </>
              ) : null}

              {state.classDraft?.attendance === 'missed_by_student' ? (
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={Boolean(state.classDraft?.countAbsentForBilling)}
                    onChange={(e) => setState((prev) => ({
                      ...prev,
                      classDraft: { ...prev.classDraft, countAbsentForBilling: e.target.checked }
                    }))}
                  />
                  Count absent for billing
                </label>
              ) : null}

              {(state.classDraft?.attendance === 'cancelled_by_teacher' || state.classDraft?.attendance === 'cancelled_by_student') ? (
                <div>
                  <label className="block text-xs font-medium text-slate-600">Cancellation reason</label>
                  <textarea
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                    value={state.classDraft?.cancellationReason || ''}
                    onChange={(e) => setState((prev) => ({
                      ...prev,
                      classDraft: { ...prev.classDraft, cancellationReason: e.target.value }
                    }))}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {mode !== 'class' ? (
            <div>
              <label className="block text-xs font-medium text-slate-600">General notes (visible to admin team)</label>
              <textarea
                rows={4}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                value={state.notes || ''}
                onChange={(e) => setState((prev) => ({ ...prev, notes: e.target.value }))}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">Reports are saved under the canonical interaction workflow.</p>
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

export default UnifiedReportComposerModal;
