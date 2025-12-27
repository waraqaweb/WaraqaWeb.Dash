/**
 * AddStudentModal Component
 * 
 * Modal for guardians to add new students to their account.
 * Supports both regular student addition and self-enrollment.
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import SpokenLanguagesSelect from '../ui/SpokenLanguagesSelect';

const AddStudentModal = ({ isOpen, onClose, onStudentAdded }) => {
  const { user } = useAuth();
  const [isSelfEnrollment, setIsSelfEnrollment] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: 'male',
    // Use spokenLanguages array to match profile modal
    spokenLanguages: [],
    subjects: [],
    learningPreferences: '',
    notes: '',
    hoursRemaining: undefined,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [guardiansList, setGuardiansList] = useState([]);
  const [guardianFilter, setGuardianFilter] = useState('');
  const [selectedGuardian, setSelectedGuardian] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setError('');
      setIsSelfEnrollment(false);
      setFormData({
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        dateOfBirth: '',
        gender: 'male',
        spokenLanguages: [],
        subjects: [],
        learningPreferences: '',
        notes: '',
        hoursRemaining: undefined,
      });
      // If admin, fetch guardians list for selection
      if (user?.role === 'admin') {
        (async () => {
          try {
            const res = await api.get('/users', { params: { role: 'guardian', limit: 1000 } });
            const users = res.data.users || [];
            // Map to minimal shape
            setGuardiansList(users.map(u => ({ _id: u._id || u.id, firstName: u.firstName, lastName: u.lastName, email: u.email })));
          } catch (err) {
            console.warn('Failed to fetch guardians for admin selector', err && err.message);
          }
        })();
      }
    }
  }, [isOpen, user]);

  // Auto-fill form when self-enrollment is selected
  useEffect(() => {
    if (isSelfEnrollment && user) {
      setFormData(prev => ({
        ...prev,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        phone: user.phone || '',
        dateOfBirth: user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split('T')[0] : '',
        gender: user.gender || 'male',
        spokenLanguages: user.spokenLanguages || (user.guardianInfo?.spokenLanguages) || [],
      }));
    } else if (!isSelfEnrollment) {
      // Clear personal fields if not self-enrollment
      setFormData(prev => ({
        ...prev,
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        dateOfBirth: '',
        gender: 'male',
        
      }));
    }
  }, [isSelfEnrollment, user]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const payload = {
        ...formData,
        selfGuardian: isSelfEnrollment,
        dateOfBirth: formData.dateOfBirth
          ? new Date(formData.dateOfBirth).toISOString()
          : undefined,
      };

      const cleanedPayload = Object.entries(payload).reduce((acc, [key, value]) => {
        if (value === undefined || value === null || value === '') {
          return acc;
        }

        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed === '') {
            return acc;
          }
          acc[key] = trimmed;
          return acc;
        }

        if (Array.isArray(value) && value.length === 0) {
          return acc;
        }

        acc[key] = value;
        return acc;
      }, {});

      const sanitizePhone = (raw) => {
        if (!raw) return undefined;
        const digits = raw.replace(/[^0-9+]/g, '').trim();
        if (digits.replace(/\D/g, '').length < 10) {
          return undefined;
        }
        return digits;
      };

      const normalizedPhone = sanitizePhone(cleanedPayload.phone);
      if (normalizedPhone) {
        cleanedPayload.phone = normalizedPhone;
      } else {
        delete cleanedPayload.phone;
      }

      if (cleanedPayload.subjects && typeof cleanedPayload.subjects === 'string') {
        cleanedPayload.subjects = cleanedPayload.subjects
          .split(',')
          .map((subject) => subject.trim())
          .filter(Boolean);
      }

      

      let guardianId = user?.impersonatedGuardianId || user?._id || user?.id;
      if (user?.role === 'admin') {
        if (!selectedGuardian) {
          throw new Error('Please select a guardian to add this student to.');
        }
        guardianId = selectedGuardian._id || selectedGuardian;
      }
      const response = await api.post(`/users/${guardianId}/students`, cleanedPayload);
      const newStudent = response.data.student;
      // If an image file was selected, upload it to the student picture endpoint
      if (uploadFile && newStudent && newStudent._id) {
        try {
          const fd = new FormData();
          fd.append('file', uploadFile);
          await api.post(`/users/${guardianId}/students/${newStudent._id}/profile-picture`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (imgErr) {
          console.warn('Failed to upload student picture:', imgErr && imgErr.message);
        }
      }
      

      // Call the callback to update the parent component
      if (onStudentAdded) {
        onStudentAdded(response.data.student);
      }

      // Close the modal
      onClose();

      // Show success message (you can replace this with a toast notification)
      alert('Student added successfully!');

    } catch (error) {
      console.error('❌ Error adding student:', error);
      
      const errorMessage = error.response?.data?.message || error.message || 'Failed to add student.';
      setError(errorMessage);
      
      // Show error message (you can replace this with a toast notification)
      alert(`Error: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Add New Student</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            disabled={loading}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {/* Guardian selector for admins */}
        {user?.role === 'admin' && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700">Select Guardian *</label>
            {selectedGuardian ? (
              <div className="mt-2 flex items-center justify-between bg-gray-100 p-2 rounded">
                <div>
                  <div className="font-medium">{selectedGuardian.firstName} {selectedGuardian.lastName}</div>
                  <div className="text-sm text-gray-600">{selectedGuardian.email}</div>
                </div>
                <button type="button" onClick={() => setSelectedGuardian(null)} className="text-sm text-red-600">Change</button>
              </div>
            ) : (
              <div className="mt-2">
                <input
                  type="text"
                  value={guardianFilter}
                  onChange={(e) => setGuardianFilter(e.target.value)}
                  placeholder="Search guardian by name or email"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
                <div className="mt-2 max-h-40 overflow-y-auto border border-gray-100 rounded">
                  {(() => {
                    const q = String(guardianFilter || '').trim().toLowerCase();
                    if (!q) {
                      return
                    }

                    const filtered = (guardiansList || []).filter((g) => {
                      return (
                        `${g.firstName} ${g.lastName}`.toLowerCase().includes(q) ||
                        (g.email || '').toLowerCase().includes(q)
                      );
                    });

                    if (filtered.length === 0) {
                      return <div className="p-3 text-sm text-gray-600">No guardians found.</div>;
                    }

                    return filtered.map((g) => (
                      <button
                        key={g._id}
                        type="button"
                        onClick={() => setSelectedGuardian(g)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <div className="font-medium">{g.firstName} {g.lastName}</div>
                        <div className="text-sm text-gray-600">{g.email}</div>
                      </button>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Self-enrollment checkbox - only show to guardians */}
          {user?.role === 'guardian' && (
            <div className="flex items-center">
              <input
                type="checkbox"
                id="selfEnrollment"
                checked={isSelfEnrollment}
                onChange={(e) => setIsSelfEnrollment(e.target.checked)}
                className="mr-2"
                disabled={loading}
              />
              <label htmlFor="selfEnrollment" className="text-sm font-medium text-gray-700">
                Enroll myself as a student
              </label>
            </div>
          )}

          {/* Basic Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                First Name *
              </label>
              <input
                type="text"
                id="firstName"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                required
                disabled={loading || isSelfEnrollment}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-custom-teal focus:border-blue-500 disabled:bg-gray-100"
              />
            </div>
            <div>
              <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                Last Name *
              </label>
              <input
                type="text"
                id="lastName"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                required
                disabled={loading || isSelfEnrollment}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-custom-teal focus:border-blue-500 disabled:bg-gray-100"
              />
            </div>
          </div>

          {/* Contact Information */}
          

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              disabled={loading || isSelfEnrollment}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-custom-teal focus:border-blue-500 disabled:bg-gray-100"
            />
          </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
                Phone
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                disabled={loading || isSelfEnrollment}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-custom-teal focus:border-blue-500 disabled:bg-gray-100"
              />
            </div>
            
          </div>

          {/* Personal Information */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700">
                Date of Birth
              </label>
              <input
                type="date"
                id="dateOfBirth"
                name="dateOfBirth"
                value={formData.dateOfBirth}
                onChange={handleChange}
                disabled={loading || isSelfEnrollment}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-custom-teal focus:border-blue-500 disabled:bg-gray-100"
              />
            </div>
            <div>
              <label htmlFor="gender" className="block text-sm font-medium text-gray-700">
                Gender
              </label>
              <select
                id="gender"
                name="gender"
                value={formData.gender}
                onChange={handleChange}
                disabled={loading || isSelfEnrollment}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-custom-teal focus:border-blue-500 disabled:bg-gray-100"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
          </div>

          {/* Language field only (grade, school and timezone removed) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
                <label className="block text-sm font-medium text-gray-700">
                  Spoken Languages
                </label>
                <SpokenLanguagesSelect value={formData.spokenLanguages || []} onChange={(arr) => setFormData(prev => ({ ...prev, spokenLanguages: arr }))} />
            </div>
          </div>

          {/* Notes (we no longer collect initial hours) */}
          <div>
            <label htmlFor="learningPreferences" className="block text-sm font-medium text-gray-700">
              Learning Preferences
            </label>
            <textarea
              id="learningPreferences"
              name="learningPreferences"
              value={formData.learningPreferences}
              onChange={handleChange}
              rows={3}
              disabled={loading}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-custom-teal focus:border-blue-500"
              placeholder="Any specific learning preferences or requirements..."
            />
          </div>

          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-gray-700">
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={2}
              disabled={loading}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-custom-teal focus:border-blue-500"
              placeholder="Additional notes about the student..."
            />
          </div>

          {/* Optional student picture upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Student Photo (optional)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setUploadFile(e.target.files && e.target.files[0])}
              disabled={loading}
              className="mt-1 w-full"
            />
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 border border-gray-300 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-custom-teal border border-transparent rounded-md hover:bg-custom-teal-dark focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-custom-teal disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Student'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddStudentModal;

