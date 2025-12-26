import React, { useState, useEffect } from 'react';
import SpokenLanguagesSelect from '../ui/SpokenLanguagesSelect';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getStudent, updateStudent } from '../../api/students';
import { getTimezoneOptions } from '../../utils/timezoneOptions';

// Use shared SpokenLanguagesSelect from ui

const EditStudentForm = ({ studentId }) => {
  const navigate = useNavigate();
  const { isAdmin, isTeacher, isGuardian } = useAuth();
  
  const [student, setStudent] = useState(null);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    school: '',
    // Use spokenLanguages as an array like ProfileEditModal
    spokenLanguages: [],
    subjects: [],
    learningPreferences: '',
    evaluationSummary: '',
    dateOfBirth: '',
    gender: 'male',
    timezone: 'UTC',
    notes: '',
    isActive: true
  });

  const deriveStudentTimezone = (s) => {
    return s?.guardianTimezone || s?.timezone || s?.studentInfo?.guardianTimezone || s?.studentInfo?.timezone || 'UTC';
  };
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Load student data
  useEffect(() => {
    const fetchStudent = async () => {
      try {
        setLoading(true);
        const response = await getStudent(studentId);
        const studentData = response.student;
        
        setStudent(studentData);
        setFormData({
          firstName: studentData.firstName || '',
          lastName: studentData.lastName || '',
          email: studentData.email || '',
          phone: studentData.phone || '',
          grade: studentData.grade || '',
          school: studentData.school || '',
          spokenLanguages: studentData.spokenLanguages || (studentData.guardianInfo?.spokenLanguages) || [],
          subjects: studentData.subjects || [],
          learningPreferences: studentData.learningPreferences || '',
          evaluationSummary: studentData.evaluationSummary || '',
          dateOfBirth: studentData.dateOfBirth ? new Date(studentData.dateOfBirth).toISOString().split('T')[0] : '',
          gender: studentData.gender || 'male',
          timezone: deriveStudentTimezone(studentData),
          notes: studentData.notes || '',
          isActive: studentData.isActive !== undefined ? studentData.isActive : true
        });
        
        setError('');
      } catch (err) {
        setError(err.message || 'Failed to load student data');
        console.error('Error fetching student:', err);
      } finally {
        setLoading(false);
      }
    };

    if (studentId) {
      fetchStudent();
    }
  }, [studentId]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (name === 'subjects') {
      // Handle subjects as comma-separated values
      const subjectsArray = value.split(',').map(s => s.trim()).filter(s => s);
      setFormData(prev => ({
        ...prev,
        subjects: subjectsArray
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Prepare data for submission
      const updateData = { ...formData };
      
      // Convert empty strings to null for optional fields
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === '') {
          updateData[key] = null;
        }
      });

      // Remove fields that shouldn't be updated by guardians
      if (isGuardian && isGuardian()) {
        delete updateData.evaluationSummary;
        delete updateData.isActive;
      }

      // evaluation is deprecated and subjects are auto-populated from classes
      delete updateData.evaluation;
      delete updateData.subjects;

      const response = await updateStudent(studentId, updateData);
      setSuccess('Student information updated successfully!');
      
      // Update local student state
      setStudent(response.student);
      
      // Redirect after success
      setTimeout(() => {
        navigate('/dashboard?view=my-students');
      }, 2000);
      
    } catch (err) {
      setError(err.message || 'Failed to update student information');
      console.error('Error updating student:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate('/dashboard?view=my-students');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading student information...</p>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600">Student not found or you don't have permission to view this student.</p>
          <button 
            onClick={() => navigate('/dashboard?view=my-students')}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-custom-teal"
          >
            Go Back to Students
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <h1 className="text-2xl font-bold text-gray-900">
              Edit Student Information
            </h1>
            <p className="mt-1 text-gray-600">
              Update information for {student.firstName} {student.lastName}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-6">
            {/* Error/Success Messages */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <p className="text-red-600">{error}</p>
              </div>
            )}
            
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4">
                <p className="text-green-600">{success}</p>
              </div>
            )}

            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-1">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                  />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700 mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  id="dateOfBirth"
                  name="dateOfBirth"
                  value={formData.dateOfBirth}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">
                  Gender
                </label>
                <select
                  id="gender"
                  name="gender"
                  value={formData.gender}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>

              <div>
                <label htmlFor="timezone" className="block text-sm font-medium text-gray-700 mb-1">
                  Timezone
                </label>
                <select
                  id="timezone"
                  name="timezone"
                  value={formData.timezone}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                >
                  {getTimezoneOptions().map(tz => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Academic Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium text-gray-900">Academic Information</h3>
              
<div className="grid grid-cols-1 md:grid-cols-2 gap-6">

  {/* Spoken Languages */}
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">Spoken Languages</label>
    <SpokenLanguagesSelect
      value={formData.spokenLanguages || []}
      onChange={(arr) => setFormData(prev => ({ ...prev, spokenLanguages: arr }))}
    />
  </div>

  {/* Subjects */}
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">Subjects</label>
    <div className="mt-1 text-sm text-gray-700">
      {formData.subjects?.length ? (
        <div className="flex flex-wrap gap-2">
          {formData.subjects.map((s, idx) => (
            <span key={idx} className="px-2 py-1 bg-gray-100 rounded-full text-sm">{s}</span>
          ))}
        </div>
      ) : (
        <span className="text-gray-500">None</span>
      )}
    </div>
    <p className="mt-1 text-xs text-gray-500">
      Subjects update automatically from scheduled classes.
    </p>
  </div>

</div>

              <div>
                <label htmlFor="learningPreferences" className="block text-sm font-medium text-gray-700 mb-1">
                  Learning Preferences
                </label>
                <textarea
                  id="learningPreferences"
                  name="learningPreferences"
                  value={formData.learningPreferences}
                  onChange={handleInputChange}
                  rows={3}
                  maxLength={500}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                  placeholder="Describe any special learning preferences or requirements..."
                />
                <p className="mt-1 text-sm text-gray-500">
                  {formData.learningPreferences.length}/500 characters
                </p>
              </div>

              {/* Evaluation field removed — subjects are derived from classes */}

              {/* Admin-only fields */}
              {/* Evaluation Summary: visible to admin (editable) and teacher (read-only) */}
              {((isAdmin && isAdmin()) || (isTeacher && isTeacher())) && (
                <div>
                  <label htmlFor="evaluationSummary" className="block text-sm font-medium text-gray-700 mb-1">
                    Evaluation Summary
                  </label>
                  {isAdmin && isAdmin() ? (
                    <>
                      <textarea
                        id="evaluationSummary"
                        name="evaluationSummary"
                        value={formData.evaluationSummary}
                        onChange={handleInputChange}
                        rows={4}
                        maxLength={2000}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                        placeholder="Administrative evaluation summary..."
                      />
                      <p className="mt-1 text-sm text-gray-500">{formData.evaluationSummary.length}/2000 characters</p>
                    </>
                  ) : (
                    <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{formData.evaluationSummary || <span className="text-gray-500">No evaluation summary</span>}</div>
                  )}

                  {isAdmin && isAdmin() && (
                    <div className="flex items-center mt-3">
                      <input
                        type="checkbox"
                        id="isActive"
                        name="isActive"
                        checked={formData.isActive}
                        onChange={handleInputChange}
                        className="h-4 w-4 text-blue-600 focus:ring-custom-teal border-gray-300 rounded"
                      />
                      <label htmlFor="isActive" className="ml-2 block text-sm text-gray-900">
                        Student is active
                      </label>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
                  Additional Notes
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows={3}
                  maxLength={1000}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                  placeholder="Any additional notes or comments..."
                />
                <p className="mt-1 text-sm text-gray-500">
                  {formData.notes.length}/1000 characters
                </p>
              </div>
            </div>

            {/* Form Actions */}
            <div className="flex justify-end space-x-4 pt-6 border-t border-gray-200">
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-custom-teal"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-custom-teal text-white rounded-md hover:bg-custom-teal-dark focus:outline-none focus:ring-2 focus:ring-custom-teal disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditStudentForm;