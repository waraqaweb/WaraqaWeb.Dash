import React, { useState, useEffect } from 'react';
import { X, User, Save, AlertCircle } from 'lucide-react';
import api from '../../api/axios';
import TeacherAvailabilityConfig from './TeacherAvailabilityConfig';

const TeacherEditModal = ({ teacher, isOpen, onClose, onUpdate }) => {
  const [activeTab, setActiveTab] = useState('basic');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    isActive: false,
    hourlyRate: 0,
    subjects: [],
    bio: ''
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (teacher) {
      setFormData({
        firstName: teacher.firstName || '',
        lastName: teacher.lastName || '',
        email: teacher.email || '',
        phone: teacher.phone || '',
        isActive: teacher.isActive || false,
        hourlyRate: teacher.teacherInfo?.hourlyRate || 0,
        subjects: teacher.teacherInfo?.subjects || [],
        bio: teacher.teacherInfo?.bio || ''
      });
    }
  }, [teacher]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await api.put(`/users/${teacher._id}`, formData);
      
      setMessage({ type: 'success', text: 'Teacher updated successfully' });
      if (onUpdate) onUpdate();
      
      setTimeout(() => {
        setMessage(null);
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Error updating teacher:', error);
      setMessage({ type: 'error', text: 'Failed to update teacher' });
      setTimeout(() => setMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleSubjectAdd = () => {
    setFormData({
      ...formData,
      subjects: [...formData.subjects, '']
    });
  };

  const handleSubjectChange = (index, value) => {
    const newSubjects = [...formData.subjects];
    newSubjects[index] = value;
    setFormData({
      ...formData,
      subjects: newSubjects
    });
  };

  const handleSubjectRemove = (index) => {
    const newSubjects = formData.subjects.filter((_, i) => i !== index);
    setFormData({
      ...formData,
      subjects: newSubjects
    });
  };

  if (!isOpen || !teacher) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <User className="w-6 h-6 text-blue-600" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Edit Teacher: {teacher.firstName} {teacher.lastName}
              </h2>
              <p className="text-sm text-gray-500">{teacher.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Message Display */}
        {message && (
          <div className={`mx-6 mt-4 p-3 rounded-lg border flex items-center gap-2 ${
            message.type === 'success' 
              ? 'text-green-600 bg-green-50 border-green-200' 
              : 'text-red-600 bg-red-50 border-red-200'
          }`}>
            <AlertCircle className="w-4 h-4" />
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex px-6">
            <button
              onClick={() => setActiveTab('basic')}
              className={`py-3 px-4 text-sm font-medium border-b-2 ${
                activeTab === 'basic'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Basic Info
            </button>
            <button
              onClick={() => setActiveTab('availability')}
              className={`py-3 px-4 text-sm font-medium border-b-2 ${
                activeTab === 'availability'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Availability
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'basic' && (
            <div className="space-y-6">
              {/* Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData({...formData, firstName: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData({...formData, lastName: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hourly Rate ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.hourlyRate}
                    onChange={(e) => setFormData({...formData, hourlyRate: parseFloat(e.target.value)})}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData({...formData, isActive: e.target.checked})}
                      className="mr-2"
                    />
                    <span className="text-sm font-medium text-gray-700">Active</span>
                  </label>
                </div>
              </div>

              {/* Bio */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bio
                </label>
                <textarea
                  value={formData.bio}
                  onChange={(e) => setFormData({...formData, bio: e.target.value})}
                  rows={3}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="Teacher's bio..."
                />
              </div>

              {/* Subjects */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subjects
                </label>
                <div className="space-y-2">
                  {formData.subjects.map((subject, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        type="text"
                        value={subject}
                        onChange={(e) => handleSubjectChange(index, e.target.value)}
                        className="flex-1 border border-gray-300 rounded-md px-3 py-2"
                        placeholder="Subject name"
                      />
                      <button
                        onClick={() => handleSubjectRemove(index)}
                        className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-md"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={handleSubjectAdd}
                    className="text-blue-600 hover:text-blue-700 text-sm"
                  >
                    + Add Subject
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'availability' && (
            <TeacherAvailabilityConfig 
              teacher={teacher} 
              onUpdate={onUpdate}
              isAdminView={true}
            />
          )}
        </div>

        {/* Footer */}
        {activeTab === 'basic' && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-custom-teal text-white rounded-lg hover:bg-custom-teal-dark disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherEditModal;