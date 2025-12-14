import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { XCircle, Trash2, Plus } from "lucide-react";
import TimezoneSelector from '../ui/TimezoneSelector';
import { DEFAULT_TIMEZONE } from '../../utils/timezoneUtils';
import { subjects } from "./ReportTopicsConfig";
import axios from '../../api/axios';

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function CreateClassModal({
  isOpen,
  onClose,
  newClass = {
    title: '',
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
  setNewClass = () => {},
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
  const pushedRef = useRef(false);
  
  // Local state for when component is used standalone (e.g., from route)
  const [localNewClass, setLocalNewClass] = useState({
    title: '',
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
  });
  const [localTeachers, setLocalTeachers] = useState([]);
  const [localGuardians, setLocalGuardians] = useState([]);
  const [localStudents, setLocalStudents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // Use local state if no external state is provided (standalone mode)
  const isStandalone = !setNewClass || setNewClass.toString() === '() => {}';
  const currentNewClass = isStandalone ? localNewClass : newClass;
  const currentSetNewClass = isStandalone ? setLocalNewClass : setNewClass;
  const currentTeachers = isStandalone ? localTeachers : teachers;
  const currentGuardians = isStandalone ? localGuardians : guardians;
  const currentStudents = isStandalone ? localStudents : students;
  
  // Filter students based on selected guardian - only show students of selected guardian
  const selectedGuardianId = currentNewClass.student?.guardianId
    ? String(currentNewClass.student.guardianId)
    : null;

  const filteredStudents = selectedGuardianId
    ? currentStudents.filter(student => String(student.guardianId) === selectedGuardianId)
    : []; // No students shown until guardian is selected
  
  // Fetch data when component is used standalone
  useEffect(() => {
    if (isStandalone && isOpen) {
      fetchData();
    }
  }, [isStandalone, isOpen]);

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
  }, [isOpen]);
  
  const fetchData = async () => {
    if (isLoading) return;
    setIsLoading(true);
    
    try {
      const [teachersRes, guardiansRes] = await Promise.all([
        axios.get('/users?role=teacher'),
        axios.get('/users?role=guardian')
      ]);
      
      setLocalTeachers(teachersRes.data.users || teachersRes.data);
      setLocalGuardians(guardiansRes.data.users || guardiansRes.data);
      
      // Flatten students from guardians
      const allStudents = (guardiansRes.data.users || guardiansRes.data).flatMap(guardian => 
        guardian.guardianInfo?.students?.map(student => ({
          ...student,
          guardianId: guardian._id,
          guardianName: guardian.fullName
        })) || []
      );
      setLocalStudents(allStudents);

      try {
        const missing = allStudents.filter(s => !s || !(s.firstName || '').trim() || !(s.lastName || '').trim());
        console.log('[CreateClassModal] fetched data summary', {
          teachers: (teachersRes.data.users || teachersRes.data || []).length,
          guardians: (guardiansRes.data.users || guardiansRes.data || []).length,
          students: allStudents.length,
          studentsMissingNames: missing.length,
          samplesMissing: missing.slice(0, 3).map(s => ({ id: s?._id || s?.id, firstName: s?.firstName, lastName: s?.lastName, guardianId: s?.guardianId, guardianName: s?.guardianName }))
        });
      } catch (e) {
        console.warn('[CreateClassModal] failed to summarize fetched data', e?.message || e);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleLocalGuardianChange = (guardianId) => {
    if (!isStandalone) return handleGuardianChange?.(guardianId);
    
    try {
      console.log('[CreateClassModal] guardian changed', { guardianId });
    } catch(_) {}
    setLocalNewClass(prev => ({
      ...prev,
      student: {
        ...prev.student,
        guardianId: guardianId,
        studentId: '' // Reset student selection when guardian changes
      }
    }));
  };
  
  const handleLocalStudentChange = (studentId) => {
    if (!isStandalone) return handleStudentChange?.(studentId);
    
    try {
      console.log('[CreateClassModal] student changed', { studentId });
    } catch(_) {}
    setLocalNewClass(prev => ({
      ...prev,
      student: {
        ...prev.student,
        studentId: studentId
      }
    }));
  };

  // Log filtered students whenever guardian selection changes
  useEffect(() => {
    try {
      const count = (filteredStudents || []).length;
      console.log('[CreateClassModal] filteredStudents updated', { selectedGuardianId, count });
    } catch(_) {}
  }, [selectedGuardianId, filteredStudents]);
  
  const handleLocalCreateClass = async () => {
    if (!isStandalone) return handleCreateClass?.();
    
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
              alert('Teacher not available for one or more recurring slots. Please choose different times or contact the teacher.');
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

      // Some backends return duplicate info under different keys; be permissive
      const duplicateInfo = data?.duplicateSeries || data?.duplicate_series || data?.duplicate || null;

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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">Create New Class</h2>
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
          <form onSubmit={(e) => {
            e.preventDefault();
            isStandalone ? handleLocalCreateClass() : handleCreateClass?.();
          }} className="space-y-4">
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
              {/* Teacher */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Teacher * ({currentTeachers.length} available)
                </label>
                <select
                  required
                  value={currentNewClass.teacher}
                  onChange={(e) =>
                    currentSetNewClass((prev) => ({ ...prev, teacher: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                >
                  <option value="">Select Teacher</option>
                  {currentTeachers.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.firstName} {t.lastName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Guardian */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Guardian * ({currentGuardians.length} available)
                </label>
                <select
                  required
                  value={currentNewClass.student?.guardianId || ''}
                  onChange={(e) => (isStandalone ? handleLocalGuardianChange : handleGuardianChange)?.(e.target.value)} // ✅ no isEdit
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                >
                  <option value="">Select Guardian</option>
                  {currentGuardians.map((g) => (
                    <option key={g._id} value={g._id}>
                      {g.firstName} {g.lastName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Student */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Student * ({filteredStudents.length} available)
                </label>
                <select
                    required
                    value={currentNewClass.student?.studentId || ''}
                    onChange={(e) => (isStandalone ? handleLocalStudentChange : handleStudentChange)?.(e.target.value)} // ✅ no isEdit
                    disabled={!currentNewClass.student?.guardianId}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C] disabled:bg-gray-100 disabled:cursor-not-allowed"
                  >
                    <option value="">
                      {!currentNewClass.student?.guardianId 
                        ? "Select Guardian First" 
                        : "Select Student"}
                    </option>
                    {filteredStudents.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.firstName} {s.lastName}
                      </option>
                    ))}
                  </select>
              </div>
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
                  Title *
                </label>
                <input
                  type="text"
                  required
                  value={currentNewClass.title}
                  onChange={(e) =>
                    currentSetNewClass((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C]"
                  placeholder="Enter class title"
                />
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Timezone
                </label>
                <TimezoneSelector
                  value={currentNewClass.timezone || user?.timezone || DEFAULT_TIMEZONE}
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
