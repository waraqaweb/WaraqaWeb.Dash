import React, { useEffect, useMemo, useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';

const GuardianStudentVacationModal = ({ isOpen, onClose, onSuccess }) => {
  const { user } = useAuth();
  const guardianId = user?._id || user?.id;

  const [loading, setLoading] = useState(false);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [students, setStudents] = useState([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');

  const [error, setError] = useState('');

  const activeStudents = useMemo(
    () => (students || []).filter((s) => s && s.isActive !== false),
    [students]
  );

  useEffect(() => {
    if (!isOpen) return;

    setError('');
    setSelectedStudentIds([]);
    setStartDate('');
    setEndDate('');
    setReason('');

    const fetchStudents = async () => {
      if (!guardianId) return;
      setStudentsLoading(true);
      try {
        const res = await api.get(`/users/${guardianId}/students`);
        setStudents(res.data?.students || []);
      } catch (e) {
        console.error('Failed to load guardian students', e);
        setStudents([]);
        setError(e.response?.data?.message || 'Failed to load students');
      } finally {
        setStudentsLoading(false);
      }
    };

    fetchStudents();
  }, [isOpen, guardianId]);

  if (!isOpen) return null;

  const getStudentLabel = (s) => {
    const name = (s.fullName || `${s.firstName || ''} ${s.lastName || ''}`).replace(/\s+/g, ' ').trim();
    return name || s.studentName || 'Student';
  };

  const toggleStudent = (studentId) => {
    const id = String(studentId);
    setSelectedStudentIds((prev) => {
      const set = new Set((prev || []).map(String));
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  };

  const validate = () => {
    if (!selectedStudentIds.length) return 'Select at least one student.';
    if (!startDate) return 'Start date is required.';
    if (!endDate) return 'End date is required.';
    if (!reason.trim()) return 'Reason is required.';

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Invalid date.';

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (start < startOfToday) return 'Start date cannot be in the past.';
    if (end < start) return 'End date must be after start date.';

    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      await api.post('/vacations/guardian-students', {
        studentIds: selectedStudentIds,
        startDate,
        endDate,
        reason: reason.trim()
      });
      onSuccess?.();
      onClose?.();
    } catch (e) {
      console.error('Failed to submit student vacation request', e);
      setError(e.response?.data?.message || 'Failed to submit vacation request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-xl font-semibold text-gray-900">Request Vacation</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-6 w-6" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-5">
          {error && (
            <div className="flex items-start space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Students *</label>
            <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto">
              {studentsLoading ? (
                <div className="p-4 text-sm text-gray-500">Loading students…</div>
              ) : activeStudents.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">No active students found.</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {activeStudents.map((s) => {
                    const id = String(s._id);
                    const checked = selectedStudentIds.map(String).includes(id);
                    return (
                      <label key={id} className="flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStudent(id)}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-gray-900">{getStudentLabel(s)}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start date *</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">End date *</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Reason *</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Enter the reason for vacation…"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-white rounded-lg bg-custom-teal hover:bg-custom-teal-dark disabled:opacity-50"
              disabled={loading}
            >
              {loading ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GuardianStudentVacationModal;
