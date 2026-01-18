import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { XCircle, Trash2, Plus, Clock } from "lucide-react";
import moment from "moment-timezone";
import { formatTzToUtc } from "../../utils/time";
import { subjects as fallbackSubjects } from "../../constants/reportTopicsConfig";
import { getSubjectsCatalogCached } from '../../services/subjectsCatalog';
import TimezoneSelector from "../ui/TimezoneSelector";
import DSTWarningBanner from "../ui/DSTWarningBanner";
import { checkDSTWarning, convertClassTimeForUser, DEFAULT_TIMEZONE } from "../../utils/timezoneUtils";
import SearchSelect from '../ui/SearchSelect';
import {
  searchTeachers,
  getTeacherById,
  searchGuardians,
  getGuardianById,
  searchStudents,
  getStudentById
} from "../../services/entitySearch";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CLASS_TYPE_OPTIONS = ['One on one', 'Group classes', 'Public lecture'];

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
  availabilityWarning,
  onDismissAvailabilityWarning,
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Edit {modalHeading}</h2>
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
              <XCircle className="h-6 w-6" />
            </button>
          </div>

          {/* DST Warning Banner */}
          {dstWarning && (
            <DSTWarningBanner
              warning={dstWarning}
              onDismiss={() => setDstWarning(null)}
              className="mb-4"
            />
          )}

          {/* Availability Warning */}
          {availabilityWarning && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-yellow-900">
                    {availabilityWarning.title || 'Teacher not available'}
                  </div>
                  {availabilityWarning.reason && (
                    <div className="mt-1 text-xs text-yellow-900 whitespace-pre-wrap">
                      {availabilityWarning.reason}
                    </div>
                  )}
                  {availabilityWarning.details && (
                    <div className="mt-2 text-xs text-yellow-800 whitespace-pre-wrap">
                      {availabilityWarning.details}
                    </div>
                  )}
                  {availabilityWarning.nearest && (
                    <div className="mt-2 text-xs text-yellow-900">
                      <span className="font-medium">Nearest available slot:</span>{' '}
                      {availabilityWarning.nearest}
                    </div>
                  )}
                  {Array.isArray(availabilityWarning.suggested) && availabilityWarning.suggested.length > 0 && (
                    <div className="mt-2 text-xs text-yellow-900">
                      <div className="font-medium">Other suggested slots:</div>
                      <div className="mt-1 whitespace-pre-wrap">
                        {availabilityWarning.suggested.slice(0, 3).map((s) => `• ${s}`).join('\n')}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDismissAvailabilityWarning?.()}
                  className="text-yellow-700 hover:text-yellow-900"
                  aria-label="Dismiss availability warning"
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}

          {/* Current Timezone Display */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex items-center space-x-2">
              <Clock className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800">
                Current Timezone: {getCurrentTimezoneDisplay()}
              </span>
            </div>
            {timePreview && (
              <div className="mt-2 text-xs text-blue-700 space-y-1">
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
            <div className="rounded-lg bg-gray-100 p-1 inline-flex w-full">
              <button
                type="button"
                role="tab"
                aria-selected={!!editClass.isRecurring}
                onClick={() => setEditClass((prev) => ({ ...prev, isRecurring: true }))}
                className={`flex-1 text-sm font-medium py-2 px-3 rounded-md transition text-center ${editClass.isRecurring ? 'bg-[#2C736C] text-white' : 'text-gray-700 hover:bg-white'}`}
              >
                Recurring Classes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!editClass.isRecurring}
                onClick={() => setEditClass((prev) => ({ ...prev, isRecurring: false }))}
                className={`flex-1 text-sm font-medium py-2 px-3 rounded-md transition text-center ${!editClass.isRecurring ? 'bg-[#2C736C] text-white' : 'text-gray-700 hover:bg-white'}`}
              >
                Single Class
              </button>
            </div>

            
            {/* Participants */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SearchSelect
                label="Teacher *"
                placeholder="Search teachers by name or email"
                value={editClass.teacher || ''}
                onChange={handleTeacherSelect}
                fetchOptions={fetchTeacherOptions}
                fetchById={fetchTeacherById}
                helperText="Type to search the full teacher roster"
                required
              />

              <SearchSelect
                label="Guardian *"
                placeholder="Search guardians by name or email"
                value={editClass.student?.guardianId || ''}
                onChange={handleGuardianSelect}
                fetchOptions={fetchGuardianOptions}
                fetchById={fetchGuardianById}
                helperText="You can also pick a student first to auto-fill guardian"
                required
              />

              <SearchSelect
                label="Student *"
                placeholder="Search students by name or email"
                value={editClass.student?.studentId || ''}
                onChange={handleStudentSelect}
                fetchOptions={fetchStudentOptions}
                fetchById={fetchStudentById}
                helperText={editClass.student?.guardianId ? 'Showing students for the selected guardian' : 'Search across all students'}
                required
              />
            </div>

            {/* (Tabs moved to top) */}

            {/* Single Class Fields */}
            {!editClass.isRecurring && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Scheduled Date & Time *
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                  />

                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Duration (minutes) *
                  </label>
                  <select
                    required
                    value={editClass.duration || 60}
                    onChange={(e) =>
                      setEditClass((prev) => ({ ...prev, duration: parseInt(e.target.value) }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                  >
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>60 minutes</option>
                    <option value={90}>90 minutes</option>
                    <option value={120}>120 minutes</option>
                  </select>
                </div>
              </div>
            )}

            {/* Recurring Class Fields - group months, day, time, duration in one row group */}
            {editClass.isRecurring && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Weekly Schedule</label>

                  {/* Header: Months | Day | Time | Duration | Actions */}
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-gray-600 mb-2">
                    <div className="min-w-0">Months</div>
                    <div className="min-w-0">Day</div>
                    <div className="min-w-0">Time</div>
                    <div className="min-w-0">Duration</div>
                    <div className="min-w-0 w-8 md:w-6" />
                  </div>

                  {(editClass.recurrenceDetails || []).map((slot, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-center mb-2 min-w-0">
                      <div className="min-w-0">
                        {index === 0 ? (
                          <select
                            value={editClass.generationPeriodMonths || 2}
                            onChange={(e) =>
                              setEditClass((prev) => ({
                                ...prev,
                                generationPeriodMonths: parseInt(e.target.value),
                              }))
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                          >
                            <option value={1}>1 month</option>
                            <option value={2}>2 months</option>
                            <option value={3}>3 months</option>
                            <option value={6}>6 months</option>
                          </select>
                        ) : (
                          <div />
                        )}
                      </div>

                      <div className="min-w-0">
                        <select
                          value={slot.dayOfWeek}
                          onChange={(e) => updateRecurrenceSlot(index, 'dayOfWeek', parseInt(e.target.value))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C] truncate whitespace-nowrap"
                        >
                          {dayNames.map((day, i) => (
                            <option key={i} value={i}>{day}</option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <input
                          type="time"
                          value={slot.time}
                          onChange={(e) => updateRecurrenceSlot(index, 'time', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C] truncate whitespace-nowrap"
                        />
                      </div>

                      <div className="min-w-0">
                        <select
                          value={slot.duration}
                          onChange={(e) => updateRecurrenceSlot(index, 'duration', parseInt(e.target.value))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C] truncate whitespace-nowrap"
                        >
                          <option value={30}>30 min</option>
                          <option value={45}>45 min</option>
                          <option value={60}>60 min</option>
                          <option value={90}>90 min</option>
                          <option value={120}>120 min</option>
                        </select>
                      </div>

                      <div className="min-w-0 flex items-center justify-center w-8 md:w-6 flex-shrink-0">
                        {(editClass.recurrenceDetails || []).length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRecurrenceSlot(index)}
                            className="p-0 text-red-600 hover:bg-red-50 rounded-md"
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
                      className="flex items-center space-x-2 px-3 py-2 text-sm text-[#2C736C] border border-[#2C736C] rounded-md hover:bg-[#2C736C] hover:text-white transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Slot</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Class Type *</label>
                <select
                  required
                  value={editClass.title || 'One on one'}
                  onChange={(e) => setEditClass((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                >
                  {classTypeOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                  placeholder="Select or type a subject"
                  required
                  allowCustom
                />
              </div>
            </div>

            {/* Additional Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timezone * 
                </label>
                <TimezoneSelector
                  value={editClass.timezone || user?.timezone || DEFAULT_TIMEZONE}
                  onChange={(timezone) => setEditClass((prev) => ({ ...prev, timezone }))}
                  placeholder="Search and select timezone..."
                  className="w-full"
                  showCurrentTime={true}
                  required={true}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Google Meet Link</label>
                <input
                  type="url"
                  value={editClass.meetingLink || ""}
                  onChange={(e) => setEditClass((prev) => ({ ...prev, meetingLink: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                  placeholder="https://meet.google.com/..."
                />
              </div>
            </div>
            
            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea
                value={editClass.description || ""}
                onChange={(e) => setEditClass((prev) => ({ ...prev, description: e.target.value }))}
                rows={1}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                placeholder="Enter class description"
              />
            </div>


            {/* Actions */}
            <div className="flex items-center justify-end space-x-3 py-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-sm font-medium text-white bg-[#2C736C] rounded-md hover:bg-[#2C736C]/90"
              >
                {editClass.isRecurring ? "Update Recurring Classes" : "Update Class"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

