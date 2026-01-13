import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { XCircle, Trash2, Plus } from "lucide-react";
import TimezoneSelector from '../ui/TimezoneSelector';
import { DEFAULT_TIMEZONE } from '../../utils/timezoneUtils';
import { subjects } from "../../constants/reportTopicsConfig";
import axios from '../../api/axios';
import SearchSelect from '../ui/SearchSelect';
import {
  searchTeachers,
  getTeacherById,
  searchGuardians,
  getGuardianById,
  searchStudents,
  getStudentById
} from '../../services/entitySearch';

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function minutesToTime(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return '';
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function CreateClassModal({
  isOpen,
  onClose,
  newClass = {
    title: 'One on one',
    subject: '',
    description: '',
    teacher: '',
    student: {
      guardianId: '',
      studentId: ''
    },
    duration: 60,
    meetingLink: '',
    timezone: DEFAULT_TIMEZONE,
    isRecurring: false,
    recurrenceDetails: [
      { dayOfWeek: 1, time: '18:00', duration: 60, timezone: DEFAULT_TIMEZONE }
    ],
    scheduledDate: '',
    generationPeriodMonths: 3
  },
  setNewClass,
  teachers = [],
  guardians = [],
  students = [],
  handleGuardianChange = () => {},
  handleStudentChange = () => {},
  addRecurrenceSlot = () => {},
  removeRecurrenceSlot = () => {},
  updateRecurrenceSlot = () => {},
  handleCreateClass = () => {},
  resetNewClassForm = () => {},
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const adminTimezone = user?.timezone || DEFAULT_TIMEZONE;
  const pushedRef = useRef(false);
  
  // Local state for when component is used standalone (e.g., from route)
  const [localNewClass, setLocalNewClass] = useState({
    title: 'One on one',
    subject: '',
    description: '',
    teacher: '',
    student: {
      guardianId: '',
      studentId: ''
    },
    duration: 60,
    meetingLink: '',
    timezone: adminTimezone,
    isRecurring: false,
    recurrenceDetails: [
      { dayOfWeek: 1, time: '18:00', duration: 60, timezone: adminTimezone }
    ],
    scheduledDate: '',
    generationPeriodMonths: 3
  });
  const [isLoading, setIsLoading] = useState(false);
  
  // Use local state if no external state is provided (standalone mode)
  // NOTE: Never rely on Function#toString() for behavior; prod builds can minify it.
  const isStandalone = typeof setNewClass !== 'function';
  const currentNewClass = isStandalone ? localNewClass : newClass;
  const currentSetNewClass = isStandalone ? setLocalNewClass : setNewClass;

  // Ensure we always have a default class type
  useEffect(() => {
    if (!isOpen) return;
    if (currentNewClass?.title) return;
    currentSetNewClass((prev) => ({ ...prev, title: 'One on one' }));
  }, [isOpen, currentNewClass?.title, currentSetNewClass]);
  
  // Filter students based on selected guardian - only show students of selected guardian
  const selectedGuardianId = currentNewClass.student?.guardianId
    ? String(currentNewClass.student.guardianId)
    : null;

  const fetchTeacherOptions = useCallback((term = '') => searchTeachers(term), []);
  const fetchTeacherById = useCallback((id) => getTeacherById(id), []);
  const fetchGuardianOptions = useCallback((term = '') => searchGuardians(term), []);
  const fetchGuardianById = useCallback((id) => getGuardianById(id), []);
  const fetchStudentOptions = useCallback(
    (term = '') => searchStudents(term, currentNewClass.student?.guardianId || null),
    [currentNewClass.student?.guardianId]
  );
  const fetchStudentById = useCallback(
    (id) => getStudentById(id, currentNewClass.student?.guardianId || null),
    [currentNewClass.student?.guardianId]
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
    currentSetNewClass((prev) => ({
      ...prev,
      teacher: teacherId,
      meetingLink: teacherId ? teacherMeetingLink : '',
    }));
  };

  const handleGuardianSelect = (option) => {
    const guardianId = option?.id || '';
    currentSetNewClass((prev) => ({
      ...prev,
      student: {
        guardianId,
        studentId: guardianId && prev.student?.guardianId === guardianId ? prev.student?.studentId : '',
      },
    }));

    if (!isStandalone) {
      handleGuardianChange?.(guardianId);
      if (!guardianId) {
        handleStudentChange?.('');
      }
    }
  };

  const handleStudentSelect = (option) => {
    const studentId = option?.id || '';
    const guardianId = option?.guardianId || currentNewClass.student?.guardianId || '';

    currentSetNewClass((prev) => ({
      ...prev,
      student: {
        guardianId,
        studentId,
      },
    }));

    if (!isStandalone) {
      handleStudentChange?.(studentId);
      if (guardianId && guardianId !== currentNewClass.student?.guardianId) {
        handleGuardianChange?.(guardianId);
      }
    }
  };

  const validateParticipants = () => {
    if (currentNewClass.teacher && currentNewClass.student?.guardianId && currentNewClass.student?.studentId) {
      return true;
    }
    alert('Please select a teacher, guardian, and student before continuing.');
    return false;
  };

  const handleFormSubmit = (event) => {
    event.preventDefault();
    if (!validateParticipants()) return;
    if (isStandalone) {
      handleLocalCreateClass();
    } else {
      handleCreateClass?.();
    }
  };
  

  // Push history state when modal opens so Back (popstate) will close it
  useEffect(() => {
    if (!isOpen) return;
    try {
      // mark that we pushed a state
      window.history.pushState({ modal: 'create-class' }, '');
      pushedRef.current = true;
    } catch (e) {
      // ignore
    }

    const onPop = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      if (onClose) onClose();
      else navigate(-1);
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, [isOpen, navigate, onClose]);
  
  // Log filtered students whenever guardian selection changes
  useEffect(() => {
    try {
      console.log('[CreateClassModal] guardian selection updated', { selectedGuardianId });
    } catch(_) {}
  }, [selectedGuardianId]);
  
  const handleLocalCreateClass = async () => {
    if (!isStandalone) return handleCreateClass?.();
    if (!validateParticipants()) return;
    
    const buildPayload = () => {
      if (!currentNewClass?.isRecurring) {
        return {
          ...currentNewClass,
          scheduledDate: currentNewClass?.scheduledDate
            ? new Date(currentNewClass.scheduledDate).toISOString()
            : currentNewClass?.scheduledDate,
        };
      }

      return { ...currentNewClass };
    };

    try {
      setIsLoading(true);
      const payload = buildPayload();

      // If recurring, perform a light teacher availability pre-check to avoid a server 400
      if (currentNewClass?.isRecurring && currentNewClass.teacher) {
        try {
          const resAvail = await axios.get(`/availability/slots/${currentNewClass.teacher}`);
          const availability = resAvail.data || {};
          const isDefault = availability?.isDefaultAvailability;

          if (!isDefault && Array.isArray(currentNewClass.recurrenceDetails)) {
            const toMinutes = (t) => {
              if (!t) return null;
              const [hh = '0', mm = '0'] = t.split(':');
              const h = parseInt(hh, 10);
              const m = parseInt(mm, 10);
              if (Number.isNaN(h) || Number.isNaN(m)) return null;
              return h * 60 + m;
            };

            const conflicts = [];
            (currentNewClass.recurrenceDetails || []).forEach((slot, idx) => {
              const day = Number.isFinite(Number(slot.dayOfWeek)) ? Number(slot.dayOfWeek) : null;
              const slotStartMin = toMinutes(slot.time);
              const slotEndMin = slotStartMin !== null ? slotStartMin + (Number(slot.duration) || 0) : null;

              if (day === null || slotStartMin === null || slotEndMin === null) {
                conflicts.push({ idx, reason: 'invalid_time' });
                return;
              }

              const daySlots = (availability.slotsByDay || {})[String(day)] || [];
              if (!daySlots || daySlots.length === 0) {
                conflicts.push({ idx, reason: 'no_day_slots' });
                return;
              }

              const matched = daySlots.some((av) => {
                const avStart = toMinutes(av.startTime || av.start || av.start_time || '');
                const avEnd = toMinutes(av.endTime || av.end || av.end_time || '');
                if (avStart === null || avEnd === null) return false;
                return avStart <= slotStartMin && avEnd >= slotEndMin;
              });

              if (!matched) conflicts.push({ idx, reason: 'not_covered' });
            });

            if (conflicts.length > 0) {
              console.warn('Create recurring class availability conflicts', { conflicts });

              const tzLabel = availability?.timezone || currentNewClass?.timezone || adminTimezone || DEFAULT_TIMEZONE;
              const slotsByDay = availability?.slotsByDay || {};

              const lines = conflicts.map(({ idx, reason }) => {
                const slot = (currentNewClass.recurrenceDetails || [])[idx] || {};
                const day = Number.isFinite(Number(slot.dayOfWeek)) ? Number(slot.dayOfWeek) : null;
                const startMin = toMinutes(slot.time);
                const duration = Number(slot.duration) || 0;
                const endMin = startMin !== null ? startMin + duration : null;

                const dayName = day !== null ? (dayNames[day] || `Day ${day}`) : 'Unknown day';
                const reqStart = startMin !== null ? minutesToTime(startMin) : String(slot.time || '');
                const reqEnd = endMin !== null ? minutesToTime(endMin) : '';
                const reqRange = reqEnd ? `${reqStart}–${reqEnd}` : reqStart;

                const daySlots = (day !== null ? slotsByDay[String(day)] : []) || [];
                const daySlotsLabel = daySlots.length
                  ? daySlots.map((av) => `${av.startTime || av.start || ''}–${av.endTime || av.end || ''}`).join(', ')
                  : 'none';

                if (reason === 'no_day_slots') {
                  return `• ${dayName}: no availability windows (timezone ${tzLabel})`;
                }
                if (reason === 'not_covered') {
                  return `• ${dayName}: requested ${reqRange} (${duration} min) is not fully covered. Available: ${daySlotsLabel} (timezone ${tzLabel})`;
                }
                if (reason === 'invalid_time') {
                  return `• ${dayName}: invalid time/duration`;
                }
                return `• ${dayName}: not available`;
              });

              alert(`Teacher not available for one or more recurring slots:\n${lines.join('\n')}`);
              return;
            }
          }
        } catch (availErr) {
          console.error('Availability check failed (create), will attempt server submit:', availErr);
        }
      }

      await axios.post('/classes', payload);
      alert(currentNewClass?.isRecurring ? 'Recurring classes created successfully!' : 'Class created successfully!');
      handleClose();
    } catch (error) {
      console.error('Error creating class:', error);

      const status = error?.response?.status;
      const data = error?.response?.data || {};

      if (data?.availabilityError) {
        const ae = data.availabilityError;
        const reason = ae?.reason ? `\nReason: ${ae.reason}` : '';

        let details = '';
        if (ae?.conflictType === 'existing_class' && ae?.conflictDetails) {
          const cd = ae.conflictDetails;
          const start = cd?.startTime ? new Date(cd.startTime).toLocaleString() : '';
          const end = cd?.endTime ? new Date(cd.endTime).toLocaleString() : '';
          details = `\nConflicts with: ${cd?.studentName || 'a class'}${cd?.subject ? ` (${cd.subject})` : ''}${start && end ? `\nTime: ${start} – ${end}` : ''}`;
        } else if (ae?.conflictType === 'no_availability' && ae?.conflictDetails) {
          const cd = ae.conflictDetails;
          const slotsForDay = Array.isArray(cd?.slotsForDay) ? cd.slotsForDay : [];
          const slotLabel = slotsForDay.length
            ? slotsForDay.map((s) => `${s.startTime}–${s.endTime}`).join(', ')
            : 'none';
          details = `\nRequested: ${cd?.requested?.startLocal || ''} – ${cd?.requested?.endLocal || ''} (${cd?.teacherTimezone || ''})\nAvailable windows: ${slotLabel}`;
        }

        const alternatives = Array.isArray(ae?.alternatives) ? ae.alternatives : [];
        const alternativesText = alternatives.length
          ? `\n\nSuggested slots:\n${alternatives
              .slice(0, 5)
              .map((alt) => {
                const start = alt?.startDateTime || alt?.start || alt?.startTime;
                const end = alt?.endDateTime || alt?.end || alt?.endTime;
                const startLabel = start ? new Date(start).toLocaleString() : '';
                const endLabel = end ? new Date(end).toLocaleString() : '';
                return `- ${startLabel}${endLabel ? ` – ${endLabel}` : ''}`;
              })
              .join('\n')}`
          : '';

        alert(`${data?.message || 'Teacher not available'}${reason}${details}${alternativesText}`);
        return;
      }

      if (status === 409 && currentNewClass?.isRecurring) {
        // Offer override even if backend didn't provide structured duplicate info
        const serverMessage = data?.message || 'A recurring series appears to exist for this student/subject.';
        const confirmation = window.confirm(`${serverMessage}\nWould you like to create another series anyway?`);
        if (confirmation) {
          try {
            const payload = { ...buildPayload(), overrideDuplicateSeries: true };
            await axios.post('/classes', payload);
            alert('Recurring classes created successfully!');
            handleClose();
            return;
          } catch (overrideErr) {
            console.error('Override creation failed:', overrideErr);
            alert(overrideErr?.response?.data?.message || 'Error creating class. Please try again.');
            return;
          }
        }
      }

      alert(error?.response?.data?.message || error?.message || 'Error creating class. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const addLocalRecurrenceSlot = () => {
    if (!isStandalone) return addRecurrenceSlot?.();
    
    setLocalNewClass(prev => ({
      ...prev,
      recurrenceDetails: [
        ...(prev.recurrenceDetails || []),
        {
          dayOfWeek: 1,
          time: '18:00',
          duration: prev.duration || 60,
          timezone: prev.timezone || DEFAULT_TIMEZONE
        }
      ]
    }));
  };
  
  const removeLocalRecurrenceSlot = (index) => {
    if (!isStandalone) return removeRecurrenceSlot?.(index);
    
    setLocalNewClass(prev => ({
      ...prev,
      recurrenceDetails: (prev.recurrenceDetails || []).filter((_, i) => i !== index)
    }));
  };
  
  const updateLocalRecurrenceSlot = (index, field, value) => {
    if (!isStandalone) return updateRecurrenceSlot?.(index, field, value);
    
    setLocalNewClass(prev => ({
      ...prev,
      recurrenceDetails: (prev.recurrenceDetails || []).map((slot, i) => 
        i === index ? { ...slot, [field]: value } : slot
      )
    }));
  };
  
  if (!isOpen) return null;
  
  const handleClose = () => {
    // If we pushed state, prevent double-close by clearing the flag then navigate back
    if (pushedRef.current) {
      pushedRef.current = false;
      if (onClose) onClose();
      try { window.history.back(); } catch (e) {}
      return;
    }

    if (onClose) return onClose();
    navigate(-1);
  };

  const classType = currentNewClass?.title || 'One on one';
  const modalHeading = classType === 'One on one' ? 'One on one class' : classType;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Create {modalHeading}</h2>
            <button
              onClick={() => {
                handleClose();
                resetNewClassForm();
              }}
              className="text-gray-400 hover:text-gray-600"
            >
              <XCircle className="h-6 w-6" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleFormSubmit} className="space-y-4">
            {/* Class Type Toggle as tabs */}
            <div className="rounded-lg bg-gray-100 p-1 inline-flex w-full">
              <button
                type="button"
                role="tab"
                aria-selected={currentNewClass.isRecurring}
                onClick={() => currentSetNewClass((prev) => ({ ...prev, isRecurring: true }))}
                className={`flex-1 text-sm font-medium py-2 px-3 rounded-md transition text-center ${currentNewClass.isRecurring ? 'bg-[#2C736C] text-white' : 'text-gray-700 hover:bg-white'}`}
              >
                Recurring Classes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!currentNewClass.isRecurring}
                onClick={() => currentSetNewClass((prev) => ({ ...prev, isRecurring: false }))}
                className={`flex-1 text-sm font-medium py-2 px-3 rounded-md transition text-center ${!currentNewClass.isRecurring ? 'bg-[#2C736C] text-white' : 'text-gray-700 hover:bg-white'}`}
              >
                Single Class
              </button>
            </div>
           
            {/* Participants */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SearchSelect
                label="Teacher *"
                placeholder="Search teachers by name or email"
                value={currentNewClass.teacher || ''}
                onChange={handleTeacherSelect}
                fetchOptions={fetchTeacherOptions}
                fetchById={fetchTeacherById}
                required
              />

              <SearchSelect
                label="Guardian *"
                placeholder="Search guardians by name or email"
                value={currentNewClass.student?.guardianId || ''}
                onChange={handleGuardianSelect}
                fetchOptions={fetchGuardianOptions}
                fetchById={fetchGuardianById}
                required
              />

              <SearchSelect
                label="Student *"
                placeholder="Search students by name or email"
                value={currentNewClass.student?.studentId || ''}
                onChange={handleStudentSelect}
                fetchOptions={fetchStudentOptions}
                fetchById={fetchStudentById}
                required
              />
            </div>

            

            {/* Single Class Fields */}
            {!currentNewClass.isRecurring && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Scheduled Date & Time *
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={currentNewClass.scheduledDate}
                    onChange={(e) =>
                      currentSetNewClass((prev) => ({
                        ...prev,
                        scheduledDate: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Duration (minutes) *
                  </label>
                  <select
                    required
                    value={currentNewClass.duration}
                    onChange={(e) =>
                      currentSetNewClass((prev) => ({
                        ...prev,
                        duration: parseInt(e.target.value),
                      }))
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

            {/* Recurring Class Fields */}
            {currentNewClass.isRecurring && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Weekly Schedule
                  </label>

                  {/* Header for months + slot columns: Months | Day | Time | Duration | */}
                  <div className="grid grid-cols-1 md:[grid-template-columns:1fr_1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-gray-600 mb-2">
                    <div className="min-w-0">Months</div>
                    <div className="min-w-0">Day</div>
                    <div className="min-w-0">Time</div>
                    <div className="min-w-0">Duration</div>
                    <div className="min-w-0 w-8 md:w-6" />
                  </div>

                  {(currentNewClass.recurrenceDetails || []).map((slot, index) => (
                    <div key={index} className="grid grid-cols-1 md:[grid-template-columns:1fr_1fr_1fr_1fr_auto] gap-2 items-center mb-2 min-w-0">
                      {/* Generation period shows only on the first row to visually group with slots */}
                      <div className="min-w-0">
                        {index === 0 ? (
                          <select
                            value={currentNewClass.generationPeriodMonths}
                            onChange={(e) =>
                              currentSetNewClass((prev) => ({
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
                          value={
                            slot.dayOfWeek === 0 || slot.dayOfWeek
                              ? slot.dayOfWeek
                              : ''
                          }
                          onChange={(e) =>
                            (isStandalone ? updateLocalRecurrenceSlot : updateRecurrenceSlot)?.(
                              index,
                              'dayOfWeek',
                              e.target.value === '' ? null : Number(e.target.value)
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C] truncate whitespace-nowrap"
                        >
                          <option value="">Select Day</option>
                          {dayNames.map((day, i) => (
                            <option key={i} value={i}>
                              {day}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <input
                          type="time"
                          value={slot.time || ''}
                          onChange={(e) =>
                            (isStandalone ? updateLocalRecurrenceSlot : updateRecurrenceSlot)?.(index, 'time', e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C] truncate whitespace-nowrap"
                        />
                      </div>

                      <div className="min-w-0">
                        <input
                          type="number"
                          min="15"
                          step="5"
                          value={slot.duration || ''}
                          onChange={(e) =>
                            (isStandalone ? updateLocalRecurrenceSlot : updateRecurrenceSlot)?.(
                              index,
                              'duration',
                              e.target.value === '' ? null : Number(e.target.value)
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C] truncate whitespace-nowrap"
                          placeholder="Duration (minutes)"
                        />
                      </div>

                      <div className="min-w-0 flex items-center justify-center w-8 md:w-6 flex-shrink-0">
                        {(currentNewClass.recurrenceDetails || []).length > 1 && (
                          <button
                            type="button"
                            onClick={() => (isStandalone ? removeLocalRecurrenceSlot : removeRecurrenceSlot)?.(index)}
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
                      onClick={isStandalone ? addLocalRecurrenceSlot : addRecurrenceSlot}
                      className="flex items-center space-x-2 px-3 py-2 text-sm text-[#2C736C] border border-[#2C736C] rounded-md hover:bg-[#2C736C] hover:text-white transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Another Time Slot</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

{/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Class Type *
                </label>
                <select
                  required
                  value={currentNewClass.title || 'One on one'}
                  onChange={(e) => currentSetNewClass((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                >
                  <option value="One on one">One on one</option>
                  <option value="Group classes">Group classes</option>
                  <option value="Public lecture">Public lecture</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject *
                </label>
                <select
                  required
                  value={currentNewClass.subject}
                  onChange={(e) =>
                    currentSetNewClass((prev) => ({ ...prev, subject: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                >
                  <option value="">Select Subject</option>
                  {subjects.map((subject) => (
                    <option key={subject} value={subject}>
                      {subject}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Additional Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timezone
                </label>
                <TimezoneSelector
                  value={currentNewClass.timezone || adminTimezone}
                  onChange={(timezone) =>
                    currentSetNewClass((prev) => ({ ...prev, timezone }))
                  }
                  placeholder="Select class timezone..."
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Meeting Link
                </label>
                <input
                  type="url"
                  value={currentNewClass.meetingLink}
                  onChange={(e) =>
                    currentSetNewClass((prev) => ({ ...prev, meetingLink: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                  placeholder="https://meet.google.com/..."
                />
              </div>
            </div>
            
            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={currentNewClass.description || ''}
                onChange={(e) =>
                  currentSetNewClass((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={1}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                placeholder="Enter class description"
              />
            </div>


            {/* Form Actions */}
            <div className="flex items-center justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  if (!isStandalone) resetNewClassForm?.();
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="btn-submit disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? "Creating..." : (currentNewClass.isRecurring
                  ? "Create Recurring Classes"
                  : "Create Class")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
