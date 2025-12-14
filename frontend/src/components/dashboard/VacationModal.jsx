import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import { X, Calendar, Clock, User, Users, Globe, AlertCircle } from 'lucide-react';
import TimezoneSelector from '../ui/TimezoneSelector';
import { DEFAULT_TIMEZONE } from '../../utils/timezoneUtils';

const VacationModal = ({ 
  isOpen, 
  onClose, 
  type, // 'individual' or 'system'
  vacation = null, // for editing
  onSuccess
}) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const createEmptyImpactState = () => ({ students: [], totalClasses: 0, totalStudents: 0, totalMinutes: 0 });
  const [impactData, setImpactData] = useState(createEmptyImpactState);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState('');
  
  // Form state for individual vacations
  const [individualForm, setIndividualForm] = useState({
    teacherId: '',
    startDate: '',
    endDate: '',
    reason: '',
    studentHandling: []
  });

  // Form state for system vacations
  const [systemForm, setSystemForm] = useState({
    name: '',
    message: '',
    startDate: '',
    endDate: '',
    timezone: DEFAULT_TIMEZONE
  });

  const [errors, setErrors] = useState({});

  const toLocalDateTimeValue = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const tzAdjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return tzAdjusted.toISOString().slice(0, 16);
  };

  const formatDateTime = (value) => {
    if (!value) return '';
    return new Date(value).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const impactedStudentIds = useMemo(() => new Set((impactData.students || []).map(student => String(student.studentId))), [impactData.students]);

  useEffect(() => {
    if (isOpen) {
      fetchTeachers();
  setImpactData(createEmptyImpactState());
      setImpactError('');
      setImpactLoading(false);
      
      if (vacation) {
        // Populate form for editing
        if (type === 'individual') {
          const teacherId = vacation.user?._id || vacation.user?.id || vacation.user || vacation.teacher?._id || '';
          const studentHandling = (vacation.substitutes || vacation.studentHandling || []).map((sub) => ({
            student: sub.studentId?._id || sub.studentId || sub.student,
            action: sub.handling === 'hold' ? 'reschedule' : sub.handling,
            substituteTeacherId: sub.substituteTeacherId?._id || sub.substituteTeacherId || sub.substituteTeacher
          }));
          setIndividualForm({
            teacherId,
            startDate: toLocalDateTimeValue(vacation.startDate),
            endDate: toLocalDateTimeValue(vacation.actualEndDate || vacation.endDate),
            reason: vacation.reason || '',
            studentHandling
          });
        } else {
          setSystemForm({
            name: vacation.name || '',
            message: vacation.message || '',
            startDate: toLocalDateTimeValue(vacation.startDate) || '',
            endDate: toLocalDateTimeValue(vacation.endDate) || '',
            timezone: vacation.timezone || DEFAULT_TIMEZONE
          });
        }
      } else {
        // Reset form for new vacation
        if (type === 'individual') {
          setIndividualForm({
            teacherId: user?.role === 'teacher' ? (user._id || user.id) : '',
            startDate: '',
            endDate: '',
            reason: '',
            studentHandling: []
          });
        } else {
          setSystemForm({
            name: '',
            message: '',
            startDate: '',
            endDate: '',
            timezone: DEFAULT_TIMEZONE
          });
        }
      }
      setErrors({});
    }
  }, [isOpen, vacation, type, user]);

  const fetchTeachers = async () => {
    try {
      const res = await api.get('/users?role=teacher');
      setTeachers(res.data.users || res.data);
    } catch (err) {
      console.error('Error fetching teachers:', err);
    }
  };

  useEffect(() => {
    if (!isOpen || type !== 'individual') {
      return;
    }

    const { teacherId, startDate, endDate } = individualForm;

    if (!teacherId || !startDate || !endDate) {
  setImpactData(createEmptyImpactState());
      setImpactError('');
      setImpactLoading(false);
      return;
    }

    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);

    if (Number.isNaN(startDateObj.getTime()) || Number.isNaN(endDateObj.getTime()) || endDateObj <= startDateObj) {
  setImpactData(createEmptyImpactState());
      setImpactError('');
      setImpactLoading(false);
      return;
    }

    let cancelled = false;
    setImpactLoading(true);
    setImpactError('');

    const timer = setTimeout(async () => {
      try {
        const params = {
          start: startDateObj.toISOString(),
          end: endDateObj.toISOString()
        };
        if (vacation?._id) {
          params.vacationId = vacation._id;
        }
        const res = await api.get(`/vacations/teacher/${teacherId}/impacted-students`, { params });
        if (cancelled) return;

        const impact = res.data?.impact || createEmptyImpactState();
        setImpactData({
          students: impact.students || [],
          totalClasses: impact.totalClasses || 0,
          totalStudents: impact.totalStudents || 0,
          totalMinutes: impact.totalMinutes || 0
        });

        setIndividualForm(prev => {
          const impactedSet = new Set((impact.students || []).map(student => String(student.studentId)));
          let updatedHandling = (prev.studentHandling || []).filter(item => impactedSet.has(String(item.student)));
          let changed = updatedHandling.length !== (prev.studentHandling || []).length;

          if (vacation && impact?.students?.length) {
            const existingMap = new Map(updatedHandling.map(item => [String(item.student), item]));
            impact.students.forEach(student => {
              const mapping = student.configuredHandling;
              if (!mapping) return;
              const key = String(student.studentId);
              if (existingMap.has(key)) return;
              const entry = {
                student: key,
                action: mapping.handling === 'hold' ? 'reschedule' : mapping.handling,
                substituteTeacherId: mapping.substituteTeacherId || ''
              };
              updatedHandling = [...updatedHandling, entry];
              existingMap.set(key, entry);
              changed = true;
            });
          }

          return changed ? { ...prev, studentHandling: updatedHandling } : prev;
        });
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching impacted students:', err);
          setImpactData(createEmptyImpactState());
          setImpactError(err.response?.data?.message || 'Failed to load impacted students');
        }
      } finally {
        if (!cancelled) {
          setImpactLoading(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, type, individualForm.teacherId, individualForm.startDate, individualForm.endDate, vacation?._id]);

  const validateForm = () => {
    const newErrors = {};

    if (type === 'individual') {
      if (!individualForm.teacherId) newErrors.teacherId = 'Teacher is required';
      if (!individualForm.startDate) newErrors.startDate = 'Start date is required';
      if (!individualForm.endDate) newErrors.endDate = 'End date is required';
      if (!individualForm.reason) newErrors.reason = 'Reason is required';
      
      if (individualForm.startDate && individualForm.endDate) {
        if (new Date(individualForm.startDate) >= new Date(individualForm.endDate)) {
          newErrors.endDate = 'End date must be after start date';
        }
        if (new Date(individualForm.startDate) < new Date()) {
          newErrors.startDate = 'Start date cannot be in the past';
        }
      }
    } else {
      if (!systemForm.name) newErrors.name = 'Name is required';
      if (!systemForm.startDate) newErrors.startDate = 'Start date is required';
      if (!systemForm.endDate) newErrors.endDate = 'End date is required';
      
      if (systemForm.startDate && systemForm.endDate) {
        if (new Date(systemForm.startDate) >= new Date(systemForm.endDate)) {
          newErrors.endDate = 'End date must be after start date';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setLoading(true);
    try {
      if (type === 'individual') {
        const teacherId = individualForm.teacherId || user?._id || user?.id;
        const substitutesPayload = (individualForm.studentHandling || [])
          .filter(item => impactedStudentIds.has(String(item.student)))
          .map((item) => ({
            studentId: item.student,
            handling: item.action === 'reschedule' ? 'hold' : item.action,
            substituteTeacherId: item.substituteTeacherId || undefined
          }));

        const payload = {
          user: teacherId,
          role: 'teacher',
          startDate: new Date(individualForm.startDate).toISOString(),
          endDate: new Date(individualForm.endDate).toISOString(),
          reason: individualForm.reason,
          substitutes: substitutesPayload
        };

        if (vacation) {
          await api.put(`/vacations/${vacation._id}`, payload);
        } else {
          await api.post('/vacations', payload);
        }
      } else {
        const payload = {
          ...systemForm,
          startDate: new Date(systemForm.startDate).toISOString(),
          endDate: new Date(systemForm.endDate).toISOString()
        };

        if (vacation) {
          await api.put(`/system-vacations/${vacation._id}`, payload);
        } else {
          await api.post('/system-vacations', payload);
        }
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Error saving vacation:', err);
      setErrors({ 
        submit: err.response?.data?.message || 'An error occurred while saving the vacation' 
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStudentHandlingChange = (studentId, action) => {
    setIndividualForm(prev => {
      const remaining = prev.studentHandling.filter(s => s.student !== studentId);
      if (!action) {
        return { ...prev, studentHandling: remaining };
      }
      const existing = prev.studentHandling.find(s => s.student === studentId) || {};
      return {
        ...prev,
        studentHandling: [
          ...remaining,
          {
            student: studentId,
            action,
            substituteTeacherId: existing.substituteTeacherId
          }
        ]
      };
    });
  };

  const getStudentHandlingAction = (studentId) => {
    const handling = individualForm.studentHandling.find(s => s.student === studentId);
    return handling?.action || '';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              {type === 'individual' ? (
                <User className="h-6 w-6 text-blue-600" />
              ) : (
                <Globe className="h-6 w-6 text-green-600" />
              )}
              <h2 className="text-xl font-semibold text-gray-900">
                {vacation ? 'Edit' : 'Create'} {type === 'individual' ? 'Individual' : 'System'} Vacation
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {errors.submit && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <div className="ml-3">
                    <p className="text-sm text-red-800">{errors.submit}</p>
                  </div>
                </div>
              </div>
            )}

            {type === 'individual' ? (
              <>
                {/* Teacher Selection (Admin only) */}
                {user?.role === 'admin' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Teacher *
                    </label>
                    <select
                      value={individualForm.teacherId}
                      onChange={(e) => setIndividualForm(prev => ({ ...prev, teacherId: e.target.value }))}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent ${
                        errors.teacherId ? 'border-red-300' : 'border-gray-300'
                      }`}
                    >
                      <option value="">Select Teacher</option>
                      {teachers.map(teacher => (
                        <option key={teacher._id} value={teacher._id}>
                          {teacher.firstName} {teacher.lastName}
                        </option>
                      ))}
                    </select>
                    {errors.teacherId && (
                      <p className="mt-1 text-sm text-red-600">{errors.teacherId}</p>
                    )}
                  </div>
                )}

                {/* Date Range */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Date & Time *
                    </label>
                    <input
                      type="datetime-local"
                      value={individualForm.startDate}
                      onChange={(e) => setIndividualForm(prev => ({ ...prev, startDate: e.target.value }))}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent ${
                        errors.startDate ? 'border-red-300' : 'border-gray-300'
                      }`}
                    />
                    {errors.startDate && (
                      <p className="mt-1 text-sm text-red-600">{errors.startDate}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Date & Time *
                    </label>
                    <input
                      type="datetime-local"
                      value={individualForm.endDate}
                      onChange={(e) => setIndividualForm(prev => ({ ...prev, endDate: e.target.value }))}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent ${
                        errors.endDate ? 'border-red-300' : 'border-gray-300'
                      }`}
                    />
                    {errors.endDate && (
                      <p className="mt-1 text-sm text-red-600">{errors.endDate}</p>
                    )}
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reason *
                  </label>
                  <textarea
                    value={individualForm.reason}
                    onChange={(e) => setIndividualForm(prev => ({ ...prev, reason: e.target.value }))}
                    rows={3}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent ${
                      errors.reason ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder="Enter the reason for vacation..."
                  />
                  {errors.reason && (
                    <p className="mt-1 text-sm text-red-600">{errors.reason}</p>
                  )}
                </div>

                {/* Student Handling */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Student Handling
                  </label>
                  <div className="text-sm text-gray-500 mb-3">
                    {impactData.totalClasses > 0
                      ? `${impactData.totalClasses} class${impactData.totalClasses === 1 ? '' : 'es'} across ${impactData.totalStudents} student${impactData.totalStudents === 1 ? '' : 's'} fall within this window.`
                      : 'Select a teacher and date range to see which students are impacted.'}
                    {impactLoading && <span className="ml-2 text-blue-600">Checking availability…</span>}
                  </div>
                  {impactError && (
                    <p className="text-sm text-red-600 mb-3">{impactError}</p>
                  )}
                  <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-lg">
                    {impactLoading ? (
                      <p className="p-4 text-gray-500 text-center">Loading impacted students…</p>
                    ) : impactData.students.length === 0 ? (
                      <p className="p-4 text-gray-500 text-center">No classes are affected during the selected window.</p>
                    ) : (
                      impactData.students.map(student => (
                        <div key={student.studentId} className="p-3 border-b border-gray-100 last:border-b-0">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div>
                              <p className="font-medium text-gray-900">
                                {student.studentName}
                              </p>
                              <p className="text-sm text-gray-500">
                                {student.classes.length} class{student.classes.length === 1 ? '' : 'es'}
                                {student.firstClassStart && (
                                  <>
                                    {' '}· First: {formatDateTime(student.firstClassStart)}
                                  </>
                                )}
                                {student.lastClassEnd && (
                                  <>
                                    {' '}· Last: {formatDateTime(student.lastClassEnd)}
                                  </>
                                )}
                              </p>
                              {student.guardianName && (
                                <p className="text-xs text-gray-400">
                                  Guardian: {student.guardianName}{student.guardianEmail ? ` · ${student.guardianEmail}` : ''}
                                </p>
                              )}
                            </div>
                            <select
                              value={getStudentHandlingAction(student.studentId)}
                              onChange={(e) => handleStudentHandlingChange(student.studentId, e.target.value)}
                              className="text-sm border border-gray-300 rounded px-2 py-1"
                            >
                              <option value="">No Action</option>
                              <option value="cancel">Cancel Classes</option>
                              <option value="reschedule">Reschedule</option>
                              <option value="substitute">Assign Substitute</option>
                            </select>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* System Vacation Fields */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Vacation Name *
                  </label>
                  <input
                    type="text"
                    value={systemForm.name}
                    onChange={(e) => setSystemForm(prev => ({ ...prev, name: e.target.value }))}
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                      errors.name ? 'border-red-300' : 'border-gray-300'
                    }`}
                    placeholder="e.g., Eid Al-Fitr 2025"
                  />
                  {errors.name && (
                    <p className="mt-1 text-sm text-red-600">{errors.name}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Message
                  </label>
                  <textarea
                    value={systemForm.message}
                    onChange={(e) => setSystemForm(prev => ({ ...prev, message: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="Message to display to users about this vacation..."
                  />
                </div>

                {/* Date Range */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Date *
                    </label>
                    <input
                      type="datetime-local"
                      value={systemForm.startDate}
                      onChange={(e) => setSystemForm(prev => ({ ...prev, startDate: e.target.value }))}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                        errors.startDate ? 'border-red-300' : 'border-gray-300'
                      }`}
                    />
                    {errors.startDate && (
                      <p className="mt-1 text-sm text-red-600">{errors.startDate}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Date *
                    </label>
                    <input
                      type="datetime-local"
                      value={systemForm.endDate}
                      onChange={(e) => setSystemForm(prev => ({ ...prev, endDate: e.target.value }))}
                      className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
                        errors.endDate ? 'border-red-300' : 'border-gray-300'
                      }`}
                    />
                    {errors.endDate && (
                      <p className="mt-1 text-sm text-red-600">{errors.endDate}</p>
                    )}
                  </div>
                </div>

                {/* Timezone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Timezone
                  </label>
                  <TimezoneSelector
                    value={systemForm.timezone}
                    onChange={(timezone) => setSystemForm(prev => ({ ...prev, timezone }))}
                    placeholder="Select timezone..."
                    className="w-full"
                  />
                </div>
              </>
            )}

            {/* Form Actions */}
            <div className="flex items-center justify-end space-x-3 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                  type === 'individual' 
                    ? 'bg-custom-teal hover:bg-custom-teal-dark' 
                    : 'bg-green-600 hover:bg-green-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {loading ? 'Saving...' : (vacation ? 'Update' : 'Create')} Vacation
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default VacationModal;