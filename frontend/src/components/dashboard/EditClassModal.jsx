import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { XCircle, Trash2, Plus, Clock, Copy, Check } from "lucide-react";
import moment from "moment-timezone";
import { formatTzToUtc } from "../../utils/time";
import { subjects as fallbackSubjects } from "../../constants/reportTopicsConfig";
import { getSubjectsCatalogCached } from '../../services/subjectsCatalog';
import TimezoneSelector from "../ui/TimezoneSelector";
import DSTWarningBanner from "../ui/DSTWarningBanner";
import { checkDSTWarning, convertClassTimeForUser, DEFAULT_TIMEZONE } from "../../utils/timezoneUtils";
import SearchSelect from '../ui/SearchSelect';
import WhatsAppGroupButton from './WhatsAppGroupButton';
import TimeInput from '../ui/TimeInput';
import {
  searchTeachers,
  getTeacherById,
  searchGuardians,
  getGuardianById,
  searchStudents,
  getStudentById
} from "../../services/entitySearch";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const adjustDurationByStep = (rawValue, direction = 1, step = 10) => {
  const current = Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0;
  const next = current + step * direction;
  return Math.max(1, Math.round(next));
};
const CLASS_TYPE_OPTIONS = ['One on one', 'Group classes', 'Public lecture'];
const sectionCardClass = 'rounded-[20px] border border-slate-200/80 bg-slate-50/85 p-3 shadow-[0_8px_24px_rgba(15,23,42,0.05)] sm:rounded-2xl md:p-4';
const sectionTitleClass = 'text-sm font-semibold tracking-tight text-slate-900';
const sectionDescriptionClass = 'mt-1 text-[11px] leading-5 text-slate-500 sm:text-xs';
const fieldLabelClass = 'mb-1.5 block text-[13px] font-semibold text-slate-700 sm:text-sm';
const textInputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100 sm:px-3.5';
const subtleHelpClass = 'mt-1 text-[11px] leading-5 text-slate-500';
const pillClass = 'inline-flex items-center rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-sm sm:px-3 sm:text-xs';
const secondaryButtonClass = 'inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 sm:w-auto';
const primaryButtonClass = 'inline-flex w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90 sm:w-auto';
const toggleGroupClass = 'grid grid-cols-2 gap-1.5 rounded-2xl border border-slate-200 bg-slate-100/80 p-1.5';
const getToggleButtonClass = (active) => (
  active
    ? 'rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 transition'
    : 'rounded-xl px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-white/70 hover:text-slate-900'
);

export default function EditClassModal({
  isOpen,
  onClose,
  editClass,
  setEditClass,
  teachers,
  guardians,
  students,
  handleGuardianChange,
  handleStudentChange,
  addRecurrenceSlot,
  removeRecurrenceSlot,
  updateRecurrenceSlot,
  handleUpdateClass,
  onForceSubmit,
  availabilityWarning,
  onDismissAvailabilityWarning,
  updateResult,
  onDismissUpdateResult,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [subjectOptions, setSubjectOptions] = useState(Array.isArray(fallbackSubjects) ? fallbackSubjects : []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const catalog = await getSubjectsCatalogCached();
        if (cancelled) return;
        if (Array.isArray(catalog?.subjects) && catalog.subjects.length > 0) {
          setSubjectOptions(catalog.subjects);
        }
      } catch (e) {
        // ignore; fallbackSubjects already loaded
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
  const [dstWarning, setDstWarning] = useState(null);
  const [msgCopied, setMsgCopied] = useState(false);
  const [showSuggestedTimes, setShowSuggestedTimes] = useState(false);
  const modalScrollRef = useRef(null);
  const updateBannerRef = useRef(null);

  // Hide suggested times by default whenever a new availability warning appears.
  useEffect(() => {
    setShowSuggestedTimes(false);
  }, [availabilityWarning?.title, availabilityWarning?.details]);

  useEffect(() => {
    if (!updateResult?.teacherChangeMsg) return;
    const banner = updateBannerRef.current;
    if (!banner) return;
    requestAnimationFrame(() => {
      banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [updateResult?.teacherChangeMsg]);
  const fetchTeacherOptions = useCallback((term = '') => searchTeachers(term), []);
  const fetchTeacherById = useCallback((id) => getTeacherById(id), []);
  const fetchGuardianOptions = useCallback((term = '') => searchGuardians(term), []);
  const fetchGuardianById = useCallback((id) => getGuardianById(id), []);
  const fetchStudentOptions = useCallback(
    (term = '') => searchStudents(term, editClass?.student?.guardianId || null),
    [editClass?.student?.guardianId]
  );
  const fetchStudentById = useCallback(
    (id) => getStudentById(id, editClass?.student?.guardianId || null),
    [editClass?.student?.guardianId]
  );
  const extractTeacherMeetingLink = (option) => {
    if (!option) return '';
    const raw = option.raw || option;
    return (
      raw?.teacherInfo?.googleMeetLink ||
      raw?.googleMeetLink ||
      raw?.meetingLink ||
      ''
    );
  };

  const handleTeacherSelect = (option) => {
    const teacherId = option?.id || '';
    const teacherMeetingLink = extractTeacherMeetingLink(option);
    setEditClass((prev) => ({
      ...prev,
      teacher: teacherId,
      meetingLink: teacherId ? teacherMeetingLink : '',
    }));
  };

  const handleGuardianSelect = (option) => {
    const guardianId = option?.id || '';
    setEditClass((prev) => ({
      ...prev,
      student: {
        ...(prev.student || {}),
        guardianId,
        studentId: guardianId && prev.student?.guardianId === guardianId ? prev.student.studentId : '',
      },
    }));
    handleGuardianChange?.(guardianId, { isEdit: true });
    if (!guardianId) {
      handleStudentChange?.('', { isEdit: true });
    }
  };

  const handleStudentSelect = (option) => {
    const studentId = option?.id || '';
    const guardianId = option?.guardianId || editClass?.student?.guardianId || '';
    const studentName = option?.label || '';
    setEditClass((prev) => ({
      ...prev,
      student: {
        guardianId,
        studentId,
        studentName,
      },
    }));
    handleStudentChange?.(studentId, { isEdit: true, guardianId, studentName });
    if (guardianId && guardianId !== editClass?.student?.guardianId) {
      handleGuardianChange?.(guardianId, { isEdit: true, preserveStudent: true });
    }
  };

  const validateParticipants = () => {
    if (editClass?.teacher && editClass?.student?.guardianId && editClass?.student?.studentId) {
      return true;
    }
    alert('Please select a teacher, guardian, and student before saving.');
    return false;
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!validateParticipants()) return;
    handleUpdateClass?.(event);
  };
  
  // Check for DST warnings when timezone or date changes
  useEffect(() => {
    if (editClass?.timezone) {
      const warning = checkDSTWarning(editClass.timezone, 14); // 14 days warning
      setDstWarning(warning.hasWarning ? warning : null);
    }
  }, [editClass?.timezone, editClass?.scheduledDate]);

  // Clear availability warning when key scheduling inputs change.
  useEffect(() => {
    if (!availabilityWarning) return;
    onDismissAvailabilityWarning?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editClass?.teacher,
    editClass?.timezone,
    editClass?.duration,
    editClass?.scheduledDate,
    editClass?.isRecurring,
    JSON.stringify(editClass?.recurrenceDetails || [])
  ]);

  if (!isOpen || !editClass) return null;
  
  const handleClose = () => {
    if (onClose) return onClose();
    navigate(-1);
  };

  // Helper function to get current timezone display
  const getCurrentTimezoneDisplay = () => {
    const tz = editClass?.timezone || user?.timezone || DEFAULT_TIMEZONE;
    const offset = moment.tz(tz).format('Z');
    const isDST = moment.tz(tz).isDST();
    return `${tz} (UTC${offset})${isDST ? ' DST' : ''}`;
  };

  // Helper function to convert class time to different timezone for preview
  const getTimePreview = () => {
    if (!editClass?.scheduledDate || !editClass?.timezone) return null;
    
    const studentTimezone = students.find(s => s._id === editClass?.student?.studentId)?.timezone || editClass.timezone;
    const teacherTimezone = teachers.find(t => t._id === editClass?.teacher)?.timezone || editClass.timezone;
    
    if (editClass.timezone === studentTimezone && editClass.timezone === teacherTimezone) {
      return null; // All same timezone, no need for preview
    }
    
    const classTime = convertClassTimeForUser(editClass.scheduledDate, editClass.timezone, studentTimezone);
    const teacherTime = convertClassTimeForUser(editClass.scheduledDate, editClass.timezone, teacherTimezone);
    
    return {
      student: classTime,
      teacher: teacherTime,
      showStudentTime: editClass.timezone !== studentTimezone,
      showTeacherTime: editClass.timezone !== teacherTimezone
    };
  };

  const timePreview = getTimePreview();

  const classType = editClass?.title || 'One on one';
  const modalHeading = classType === 'One on one' ? 'One on one class' : classType;

  const classTypeOptions = (editClass?.title && !CLASS_TYPE_OPTIONS.includes(editClass.title))
    ? [...CLASS_TYPE_OPTIONS, editClass.title]
    : CLASS_TYPE_OPTIONS;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div ref={modalScrollRef} className="relative h-[100dvh] w-full max-w-4xl max-h-[100dvh] overflow-y-auto overscroll-contain rounded-none border border-white/70 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.24)] sm:max-h-[92vh] sm:rounded-[28px]" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.35),transparent_45%),radial-gradient(circle_at_top_right,rgba(196,181,253,0.22),transparent_40%)]" />
        <div className="relative p-3.5 md:p-6">
          {/* Header */}
          <div className="mb-5 overflow-hidden rounded-[20px] border border-slate-200/80 bg-gradient-to-r from-sky-50 via-white to-violet-50 px-4 py-4 shadow-sm sm:mb-6 sm:rounded-[24px] sm:px-5 sm:py-5">
            <div className="flex items-start justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-700 sm:text-[11px]">Class Editor</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Edit {modalHeading}</h2>
                
                
                  <span className={pillClass}>{editClass.isRecurring ? 'Recurring schedule' : 'Single session'}</span>
                  <span className={pillClass}>{editClass.timezone || user?.timezone || DEFAULT_TIMEZONE}</span>
                
              </div>
              <button type="button" onClick={handleClose} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/80 text-slate-500 shadow-sm transition hover:text-slate-900 hover:shadow-md">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Teacher change result banner */}
          {updateResult?.teacherChangeMsg && (
            <div ref={updateBannerRef} className="mb-4 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-emerald-50 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-emerald-900">{updateResult.message}</p>
                  {updateResult.availabilityReminder && (
                    <p className="mt-2 text-xs leading-relaxed text-emerald-800">Reminder: {updateResult.availabilityReminder}</p>
                  )}
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-emerald-200/80 bg-white/70 px-3 py-2 font-sans text-xs leading-relaxed text-emerald-800">{updateResult.teacherChangeMsg}</pre>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(updateResult.teacherChangeMsg);
                    setMsgCopied(true);
                    setTimeout(() => setMsgCopied(false), 2000);
                  }}
                  className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50"
                  title="Copy message"
                >
                  {msgCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {msgCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => onDismissUpdateResult?.()}
                  className="text-xs font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* DST Warning Banner */}
          {dstWarning && (
            <DSTWarningBanner
              warning={dstWarning}
              onDismiss={() => setDstWarning(null)}
              className="mb-4"
            />
          )}

          {/* Availability Warning is rendered at the BOTTOM of the form
              (just above the submit row) so the user doesn't have to scroll
              back up to read it after filling the form. See block below. */}

          {/* Current Timezone Display */}
          <div className="mb-4 rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 via-white to-sky-50 p-4 shadow-sm">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-sky-600" />
              <span className="text-sm font-semibold text-sky-900">
                Current Timezone: {getCurrentTimezoneDisplay()}
              </span>
            </div>
            {timePreview && (
              <div className="mt-3 space-y-1 text-xs text-sky-800">
                {timePreview.showStudentTime && (
                  <div>Student time: {timePreview.student.displayTime}</div>
                )}
                {timePreview.showTeacherTime && (
                  <div>Teacher time: {timePreview.teacher.displayTime}</div>
                )}
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Class Type Tabs (moved to top) */}
            <div className={toggleGroupClass}>
              <button
                type="button"
                role="tab"
                aria-selected={!!editClass.isRecurring}
                onClick={() => setEditClass((prev) => ({ ...prev, isRecurring: true }))}
                className={`text-center ${getToggleButtonClass(!!editClass.isRecurring)}`}
              >
                Recurring Classes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!editClass.isRecurring}
                onClick={() => setEditClass((prev) => ({ ...prev, isRecurring: false }))}
                className={`text-center ${getToggleButtonClass(!editClass.isRecurring)}`}
              >
                Single Class
              </button>
            </div>

            
            {/* Participants */}
            <div className={`${sectionCardClass} relative z-30`}>
              <div className="mb-4">
                <h3 className={sectionTitleClass}>Participants</h3>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <SearchSelect
                  label="Teacher *"
                  placeholder="Search teachers..."
                  value={editClass.teacher || ''}
                  onChange={handleTeacherSelect}
                  fetchOptions={fetchTeacherOptions}
                  fetchById={fetchTeacherById}
                  helperText=""
                  required
                />

                <SearchSelect
                  label="Guardian *"
                  placeholder="Search guardians..."
                  value={editClass.student?.guardianId || ''}
                  onChange={handleGuardianSelect}
                  fetchOptions={fetchGuardianOptions}
                  fetchById={fetchGuardianById}
                  helperText=""
                  required
                />

                <SearchSelect
                  label="Student *"
                  placeholder="Search students..."
                  value={editClass.student?.studentId || ''}
                  onChange={handleStudentSelect}
                  fetchOptions={fetchStudentOptions}
                  fetchById={fetchStudentById}
                  helperText={editClass.student?.guardianId ? '' : ''}
                  required
                />
              </div>
            </div>

            {/* (Tabs moved to top) */}

            {/* Single Class Fields */}
            {!editClass.isRecurring && (
              <div className={sectionCardClass}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className={sectionTitleClass}>Schedule</h3>
                    <p className={sectionDescriptionClass}>Choose the new date, time, and duration for this single class.</p>
                  </div>
                  <span className={pillClass}>One session</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className={fieldLabelClass}>
                    Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={
                      editClass.scheduledDate
                        ? moment
                            .utc(editClass.scheduledDate)
                            .tz(editClass.timezone || user?.timezone || DEFAULT_TIMEZONE)
                            .format('YYYY-MM-DDTHH:mm')
                        : ''
                    }
                    onChange={(e) => {
                      const utcDate = formatTzToUtc(
                        e.target.value,
                        editClass.timezone || user?.timezone || DEFAULT_TIMEZONE
                      );
                      setEditClass((prev) => ({
                        ...prev,
                        scheduledDate: utcDate ? utcDate.toISOString() : '',
                      }));
                    }}
                    className={textInputClass}
                  />

                </div>

                  <div>
                    <label className={fieldLabelClass}>
                    Duration (min) *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={editClass.duration || ''}
                    onChange={(e) =>
                      setEditClass((prev) => ({
                        ...prev,
                        duration: e.target.value === '' ? '' : Number(e.target.value)
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        const direction = e.key === 'ArrowUp' ? 1 : -1;
                        const next = adjustDurationByStep(editClass.duration, direction, 10);
                        setEditClass((prev) => ({
                          ...prev,
                          duration: next
                        }));
                      }
                    }}
                    inputMode="numeric"
                    className={textInputClass}
                    placeholder="Minutes"
                  />
                </div>
              </div>
              </div>
            )}

            {/* Recurring Class Fields - group months, day, time, duration in one row group */}
            {editClass.isRecurring && (
              <div className={sectionCardClass}>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className={sectionTitleClass}>Weekly schedule</h3>
                  </div>
                  <span className={pillClass}>Series update</span>
                </div>

                  {/* Header: Months | Day | Time | Duration | Actions */}
                  <div className="mb-2 hidden gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 md:grid md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                    <div className="min-w-0">Months</div>
                    <div className="min-w-0">Day</div>
                    <div className="min-w-0">Time</div>
                    <div className="min-w-0">Duration</div>
                    <div className="min-w-0 w-8 md:w-6" />
                  </div>

                  {(editClass.recurrenceDetails || []).map((slot, index) => (
                    <div key={index} className="mb-2 grid grid-cols-1 items-center gap-3 rounded-[18px] border border-slate-200 bg-white p-3 shadow-sm sm:rounded-2xl md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:gap-2">
                      <div className="min-w-0">
                        <div className="md:hidden mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Months</div>
                        {index === 0 ? (
                          <select
                            value={editClass.generationPeriodMonths || 2}
                            onChange={(e) =>
                              setEditClass((prev) => ({
                                ...prev,
                                generationPeriodMonths: parseInt(e.target.value),
                              }))
                            }
                            className={textInputClass}
                          >
                            <option value={1}>1 month</option>
                            <option value={2}>2 months</option>
                            <option value={3}>3 months</option>
                            <option value={6}>6 months</option>
                          </select>
                        ) : (
                          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-400">Same as first row</div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="md:hidden mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Day</div>
                        <select
                          value={slot.dayOfWeek}
                          onChange={(e) => updateRecurrenceSlot(index, 'dayOfWeek', parseInt(e.target.value))}
                          className={`${textInputClass} truncate whitespace-nowrap`}
                        >
                          {dayNames.map((day, i) => (
                            <option key={i} value={i}>{day}</option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <div className="md:hidden mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Time</div>
                        <TimeInput
                          value={slot.time}
                          onChange={(e) => updateRecurrenceSlot(index, 'time', e.target.value)}
                        />
                      </div>

                      <div className="min-w-0">
                        <div className="md:hidden mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Duration</div>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={slot.duration || ''}
                          onChange={(e) => updateRecurrenceSlot(index, 'duration', e.target.value === '' ? null : Number(e.target.value))}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                              e.preventDefault();
                              const direction = e.key === 'ArrowUp' ? 1 : -1;
                              const next = adjustDurationByStep(slot.duration, direction, 10);
                              updateRecurrenceSlot(index, 'duration', next);
                            }
                          }}
                          inputMode="numeric"
                          className={`${textInputClass} truncate whitespace-nowrap`}
                          placeholder="Minutes"
                        />
                      </div>

                      <div className="min-w-0 flex w-full flex-shrink-0 items-end justify-end md:w-6 md:items-center md:justify-center">
                        {(editClass.recurrenceDetails || []).length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRecurrenceSlot(index)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-red-600 transition hover:bg-red-50"
                            aria-label="Remove time slot"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => addRecurrenceSlot()}
                      className="inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-white px-3.5 py-2.5 text-sm font-semibold text-primary shadow-sm transition hover:border-primary hover:bg-primary hover:text-white"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Slot</span>
                    </button>
                  </div>
              </div>
            )}
            {/* Basic Info */}
            <div className={sectionCardClass}>
              <div className="mb-4">
                <h3 className={sectionTitleClass}>Class details</h3>
              </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className={fieldLabelClass}>Class Type *</label>
                <select
                  required
                  value={editClass.title || 'One on one'}
                  onChange={(e) => setEditClass((prev) => ({ ...prev, title: e.target.value }))}
                  className={textInputClass}
                >
                  {classTypeOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={fieldLabelClass}>
                  Subject *
                </label>
                <SearchSelect
                  value={editClass.subject || ''}
                  onChange={(opt) => setEditClass((prev) => ({ ...prev, subject: opt?.label || '' }))}
                  fetchOptions={async (term = '') => {
                    const q = String(term || '').toLowerCase();
                    return (subjectOptions || [])
                      .filter((s) => !q || String(s).toLowerCase().includes(q))
                      .slice(0, 200)
                      .map((s) => ({ id: s, label: s }));
                  }}
                  fetchById={async (id) => (id ? { id, label: id } : null)}
                  placeholder="Type or select..."
                  required
                  allowCustom
                />
              </div>
            </div>

            {/* Rate Overrides (optional) */}
            <details className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-sm" open={editClass.guardianRate != null || editClass.teacherPremium != null}>
              <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white/70">
                Rate Overrides (optional)
              </summary>
              <div className="grid grid-cols-1 gap-3 px-4 pb-4 pt-2 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Guardian Rate ($/hr)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={editClass.guardianRate ?? ''}
                    onChange={(e) =>
                      setEditClass((prev) => ({
                        ...prev,
                        guardianRate: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    className={textInputClass}
                    placeholder="Default"
                  />
                  <p className={subtleHelpClass}>Leave empty for default</p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Teacher Premium ($/hr)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.25"
                    value={editClass.teacherPremium ?? ''}
                    onChange={(e) =>
                      setEditClass((prev) => ({
                        ...prev,
                        teacherPremium: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    className={textInputClass}
                    placeholder="No premium"
                  />
                  <p className={subtleHelpClass}>Extra $/hr for teacher</p>
                </div>
              </div>
            </details>

            {/* Additional Fields */}
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className={fieldLabelClass}>
                  Timezone * 
                </label>
                <TimezoneSelector
                  value={editClass.timezone || user?.timezone || DEFAULT_TIMEZONE}
                  onChange={(timezone) => setEditClass((prev) => ({ ...prev, timezone }))}
                  placeholder="Search timezone..."
                  className="w-full"
                  showCurrentTime={true}
                  required={true}
                />
              </div>

              <div>
                <label className={fieldLabelClass}>Meeting Link</label>
                <input
                  type="url"
                  value={editClass.meetingLink || ""}
                  onChange={(e) => setEditClass((prev) => ({ ...prev, meetingLink: e.target.value }))}
                  className={textInputClass}
                  placeholder="Paste link..."
                />
              </div>
            </div>
            
            {/* Description */}
            <div className="mt-4">
              <label className={fieldLabelClass}>Description</label>
              <textarea
                value={editClass.description || ""}
                onChange={(e) => setEditClass((prev) => ({ ...prev, description: e.target.value }))}
                rows={1}
                className={`${textInputClass} resize-none leading-5`}
                placeholder="Optional notes..."
              />
            </div>
            </div>


            {/* Availability Warning (rendered near the submit button so the
                user sees the issue right where they're acting). */}
            {availabilityWarning && (
              <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-amber-950">
                      {availabilityWarning.title || 'Teacher not available'}
                    </div>
                    {availabilityWarning.reason && (
                      <div className="mt-1 text-xs text-amber-900 whitespace-pre-wrap">
                        {availabilityWarning.reason}
                      </div>
                    )}
                    {availabilityWarning.details && (
                      <div className="mt-2 whitespace-pre-wrap rounded-xl border border-amber-200/80 bg-white/70 px-3 py-2 text-xs leading-5 text-amber-900">
                        {availabilityWarning.details}
                      </div>
                    )}
                    {(availabilityWarning.nearest || (Array.isArray(availabilityWarning.suggested) && availabilityWarning.suggested.length > 0)) && (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setShowSuggestedTimes((v) => !v)}
                          className="text-xs font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-800"
                        >
                          {showSuggestedTimes ? 'Hide suggested times' : 'Show suggested times'}
                        </button>
                        {showSuggestedTimes && (
                          <div className="mt-2 space-y-2">
                            {availabilityWarning.nearest && (
                              <div className="text-xs text-amber-950">
                                <span className="font-medium">Nearest available slot:</span>{' '}
                                {availabilityWarning.nearest}
                              </div>
                            )}
                            {Array.isArray(availabilityWarning.suggested) && availabilityWarning.suggested.length > 0 && (
                              <div className="text-xs text-amber-950">
                                <div className="font-medium">Other suggested slots:</div>
                                <div className="mt-1 whitespace-pre-wrap rounded-xl border border-amber-200/80 bg-white/70 px-3 py-2 leading-5">
                                  {availabilityWarning.suggested.slice(0, 3).map((s) => `• ${s}`).join('\n')}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {editClass?.isRecurring && onForceSubmit && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { onDismissAvailabilityWarning?.(); onForceSubmit(); }}
                          className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700"
                        >
                          Proceed anyway
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismissAvailabilityWarning?.()}
                          className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-white px-3.5 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-50"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onDismissAvailabilityWarning?.()}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-amber-700 transition hover:bg-white/70 hover:text-amber-900"
                    aria-label="Dismiss availability warning"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="sticky bottom-0 z-10 -mx-3.5 mt-2 flex flex-col gap-3 border-t border-slate-200/80 bg-white/95 px-3.5 py-3.5 backdrop-blur sm:-mx-6 sm:px-6 sm:py-4 md:flex-row md:items-center md:justify-between">
              {editClass._id && (
                <WhatsAppGroupButton classId={editClass._id} />
              )}
              <div className="ml-auto flex flex-col gap-3 sm:flex-row sm:items-center sm:space-x-3 sm:gap-0">
              <button
                type="button"
                onClick={handleClose}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={primaryButtonClass}
              >
                {editClass.isRecurring ? "Update Recurring Classes" : "Update Class"}
              </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

