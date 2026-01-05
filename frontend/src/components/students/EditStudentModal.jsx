import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import SpokenLanguagesSelect from '../ui/SpokenLanguagesSelect';

const deriveStudentTimezone = (s) => {
  return s?.guardianTimezone || s?.timezone || s?.studentInfo?.guardianTimezone || s?.studentInfo?.timezone || 'UTC';
};

const normalizeStudentId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return String(value._id || value.id || value);
};

const EditStudentModal = ({ studentId, guardianId, onClose, onUpdated }) => {
  const { user, isAdmin, isTeacher } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [student, setStudent] = useState(null);
  const [actualGuardianId, setActualGuardianId] = useState(guardianId);
  const [uploadFile, setUploadFile] = useState(null);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: 'male',
    spokenLanguages: [],
    learningPreferences: '',
    subjects: [],
    evaluationSummary: '',
    notes: '',
    isActive: true
  });

  useEffect(() => {
    setActualGuardianId(guardianId || null);
  }, [guardianId]);

  useEffect(() => {
    const fetchStudent = async () => {
      try {
        setLoading(true);
        
        
        
        // Determine which guardian ID to use (state overrides prop when discovered)
        let guardianToUse = actualGuardianId || guardianId;
        
        const setFromStandaloneStudentDoc = (doc) => {
          const guardianIdFromDoc = normalizeStudentId(doc?.guardian?._id || doc?.guardian);
          if (guardianIdFromDoc) setActualGuardianId(guardianIdFromDoc);
          setStudent({ ...(doc || {}), _source: 'standalone' });
          setFormData({
            firstName: doc?.firstName || '',
            lastName: doc?.lastName || '',
            email: doc?.email || '',
            phone: doc?.phone || '',
            whatsapp: doc?.whatsapp || '',
            grade: doc?.grade || '',
            school: doc?.school || '',
            spokenLanguages: doc?.spokenLanguages || (doc?.language ? [doc.language] : []),
            subjects: doc?.subjects || [],
            learningPreferences: doc?.learningPreferences || '',
            evaluationSummary: doc?.evaluationSummary || '',
            dateOfBirth: doc?.dateOfBirth ? new Date(doc.dateOfBirth).toISOString().split('T')[0] : '',
            gender: doc?.gender || 'male',
            timezone: deriveStudentTimezone(doc),
            notes: doc?.notes || '',
            isActive: doc?.isActive !== undefined ? doc.isActive : true,
          });
        };

        const setFromStandaloneUserDoc = (userDoc) => {
          setStudent(userDoc);
          setFormData({
            firstName: userDoc?.firstName || '',
            lastName: userDoc?.lastName || '',
            email: userDoc?.email || '',
            phone: userDoc?.phone || '',
            whatsapp: userDoc?.whatsapp || '',
            grade: userDoc?.studentInfo?.grade || '',
            school: userDoc?.studentInfo?.school || '',
            spokenLanguages: userDoc?.spokenLanguages || (userDoc?.studentInfo?.spokenLanguages) || (userDoc?.studentInfo?.language ? [userDoc.studentInfo.language] : []),
            subjects: userDoc?.studentInfo?.subjects || [],
            learningPreferences: userDoc?.studentInfo?.learningPreferences || '',
            evaluationSummary: userDoc?.studentInfo?.evaluationSummary || '',
            dateOfBirth: userDoc?.studentInfo?.dateOfBirth ? new Date(userDoc.studentInfo.dateOfBirth).toISOString().split('T')[0] : '',
            gender: userDoc?.studentInfo?.gender || 'male',
            timezone: deriveStudentTimezone(userDoc),
            notes: userDoc?.studentInfo?.notes || '',
            isActive: userDoc?.isActive !== undefined ? userDoc.isActive : true,
          });
        };

        if (!guardianToUse || guardianToUse === 'null') {
          // No guardianId provided. Try standalone Student model first, then fall back to legacy standalone User.
          try {
            const res = await api.get(`/students/${studentId}`);
            if (res?.data?.student) {
              setFromStandaloneStudentDoc(res.data.student);
              return;
            }
          } catch (_) {
            // ignore
          }

          const response = await api.get(`/users/${studentId}`);
          const userDoc = response.data?.user;
          if (!userDoc) throw new Error('Student not found');
          setFromStandaloneUserDoc(userDoc);
        } else {
          // guardianId provided - this means we're editing an embedded student
          
          
          // First, let's try to fetch as embedded student
          try {
            const response = await api.get(`/users/${guardianToUse}/students`);
            const students = response.data.students || [];
            const studentData = students.find(s => s._id === studentId);
            
            if (!studentData) {
              throw new Error('Student not found in guardian\'s students');
            }
            
            setStudent(studentData);
            if (guardianToUse && guardianToUse !== actualGuardianId) {
              setActualGuardianId(guardianToUse);
            }
            setFormData({
              firstName: studentData.firstName || '',
              lastName: studentData.lastName || '',
              email: studentData.email || '',
              phone: studentData.phone || '',
              whatsapp: studentData.whatsapp || '',
              grade: studentData.grade || '',
              school: studentData.school || '',
              spokenLanguages: studentData.spokenLanguages || (studentData.language ? [studentData.language] : []),
              subjects: studentData.subjects || [],
              learningPreferences: studentData.learningPreferences || '',
              evaluationSummary: studentData.evaluationSummary || '',
              dateOfBirth: studentData.dateOfBirth ? new Date(studentData.dateOfBirth).toISOString().split('T')[0] : '',
              gender: studentData.gender || 'male',
              timezone: deriveStudentTimezone(studentData),
              notes: studentData.notes || '',
              isActive: studentData.isActive !== undefined ? studentData.isActive : true
            });
          } catch (embeddedError) {
            
            
            // If the student is actually a standalone Student document, load it directly.
            try {
              const res = await api.get(`/students/${studentId}`);
              if (res?.data?.student) {
                setFromStandaloneStudentDoc(res.data.student);
                return;
              }
            } catch (_) {
              // ignore and continue
            }

            // If the provided guardianId doesn't work, maybe it's wrong
            // Let's try to find the student by searching all guardians (admin only)
            if (isAdmin && isAdmin()) {
              
              try {
                // Get all guardians and search for the student
                const guardiansResponse = await api.get('/users', { 
                  params: { role: 'guardian' } 
                });
                const guardians = guardiansResponse.data.users || [];
                
                let foundStudent = null;
                let correctGuardianId = null;
                
                for (const guardian of guardians) {
                  try {
                    const guardianStudentsResponse = await api.get(`/users/${guardian._id}/students`);
                    const students = guardianStudentsResponse.data.students || [];
                    const student = students.find(s => s._id === studentId);
                    if (student) {
                      foundStudent = student;
                      correctGuardianId = guardian._id;
                      break;
                    }
                  } catch (err) {
                    // Continue searching other guardians
                    continue;
                  }
                }
                
                if (foundStudent) {
                
                  setStudent(foundStudent);
                  
                  // Update the guardianId for future operations
                  setActualGuardianId(correctGuardianId);
                  guardianToUse = correctGuardianId;
                  
                  setFormData({
                    firstName: foundStudent.firstName || '',
                    lastName: foundStudent.lastName || '',
                    email: foundStudent.email || '',
                    phone: foundStudent.phone || '',
                    whatsapp: foundStudent.whatsapp || '',
                    grade: foundStudent.grade || '',
                    school: foundStudent.school || '',
                    spokenLanguages: foundStudent.spokenLanguages || (foundStudent.language ? [foundStudent.language] : []),
                    subjects: foundStudent.subjects || [],
                    learningPreferences: foundStudent.learningPreferences || '',
                    evaluationSummary: foundStudent.evaluationSummary || '',
                    dateOfBirth: foundStudent.dateOfBirth ? new Date(foundStudent.dateOfBirth).toISOString().split('T')[0] : '',
                    gender: foundStudent.gender || 'male',
                    timezone: deriveStudentTimezone(foundStudent),
                    notes: foundStudent.notes || '',
                    isActive: foundStudent.isActive !== undefined ? foundStudent.isActive : true
                  });
                } else {
                  throw new Error('Student not found in any guardian\'s students');
                }
              } catch (searchError) {
                
                
                // If all else fails, try as standalone user
                const response = await api.get(`/users/${studentId}`);
                const studentData = response.data?.user;
                
                if (!studentData) {
                  throw new Error('Student not found');
                }
                
                setFromStandaloneUserDoc(studentData);
              }
              } else {
              // For non-admin users, fallback to standalone user
              const response = await api.get(`/users/${studentId}`);
              const studentData = response.data?.user;
              
              if (!studentData) {
                throw new Error('Student not found');
              }
              
              setFromStandaloneUserDoc(studentData);
            }
          }
        }
        
      } catch (err) {
        console.error('Error in fetchStudent:', err);
        setError(err.response?.data?.message || err.message || 'Failed to load student data');
      } finally {
        setLoading(false);
      }
    };

    if (studentId) {
      fetchStudent();
    }
  }, [studentId, guardianId, actualGuardianId, user, isAdmin]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    if (name === 'subjects') {
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

  const normalizeOptionalText = (value) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  };

  const normalizeRequiredText = (value) => {
    if (typeof value !== 'string') return value || '';
    return value.trim();
  };

  const normalizePhoneNumber = (raw) => {
    if (raw === null) return null;
    if (raw === undefined) return undefined;
    const cleaned = String(raw).trim();
    if (!cleaned) return undefined;
    const digitsOnly = cleaned.replace(/[^0-9+]/g, '').trim();
    if (!digitsOnly) return undefined;
    const numericLength = digitsOnly.replace(/\D/g, '').length;
    if (numericLength < 10) {
      return undefined;
    }
    return digitsOnly;
  };

  const pruneUndefined = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (value === undefined) {
        return acc;
      }
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        acc[key] = pruneUndefined(value);
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});
  };

  const buildEmbeddedUpdatePayload = () => {
    const email = normalizeOptionalText(formData.email);
    const grade = normalizeOptionalText(formData.grade);
    const school = normalizeOptionalText(formData.school);
    // Build spoken languages array from formData or existing student data
    const spokenArr = (Array.isArray(formData.spokenLanguages) ? formData.spokenLanguages : (formData.spokenLanguages ? [String(formData.spokenLanguages).trim()] : []))
      .filter(Boolean);
    const learningPreferences = normalizeOptionalText(formData.learningPreferences);
    const notes = normalizeOptionalText(formData.notes);
  const timezone = normalizeOptionalText(formData.timezone) || student?.guardianTimezone || student?.timezone || 'Africa/Cairo';
  // subjects are auto-populated from classes and should not be editable here
    const phone = normalizePhoneNumber(formData.phone);
    const whatsapp = normalizePhoneNumber(formData.whatsapp);

    const payload = {
      firstName: normalizeRequiredText(formData.firstName),
      lastName: normalizeRequiredText(formData.lastName),
      // include spokenLanguages array for backend
      spokenLanguages: spokenArr.length ? spokenArr : undefined,
      gender: formData.gender || 'male',
      timezone,
      // subjects intentionally omitted (derived from classes)
    };

    if (email !== undefined) {
      payload.email = email;
    } else if (formData.email === '') {
      payload.email = null;
    }

    if (phone !== undefined) {
      payload.phone = phone;
    } else if (formData.phone === '') {
      payload.phone = null;
    }

    if (whatsapp !== undefined) {
      payload.whatsapp = whatsapp;
    } else if (formData.whatsapp === '') {
      payload.whatsapp = null;
    }

    if (grade !== undefined) {
      payload.grade = grade;
    } else if (formData.grade === '') {
      payload.grade = null;
    }

    if (school !== undefined) {
      payload.school = school;
    } else if (formData.school === '') {
      payload.school = null;
    }

    if (learningPreferences !== undefined) {
      payload.learningPreferences = learningPreferences;
    } else if (formData.learningPreferences === '') {
      payload.learningPreferences = '';
    }

    if (notes !== undefined) {
      payload.notes = notes;
    } else if (formData.notes === '') {
      payload.notes = '';
    }

    if (formData.dateOfBirth) {
      payload.dateOfBirth = new Date(formData.dateOfBirth).toISOString();
    } else if (formData.dateOfBirth === '') {
      payload.dateOfBirth = null;
    }

    if (isAdmin && isAdmin()) {
      payload.isActive = !!formData.isActive;
      payload.evaluationSummary = typeof formData.evaluationSummary === 'string'
        ? formData.evaluationSummary.trim()
        : '';
    }

    return pruneUndefined(payload);
  };

  const buildStandaloneUpdatePayload = (embeddedPayload) => {
    const standalone = {
      firstName: embeddedPayload.firstName,
      lastName: embeddedPayload.lastName,
      timezone: embeddedPayload.timezone,
      studentInfo: {
        grade: embeddedPayload.grade ?? null,
        school: embeddedPayload.school ?? null,
        // Keep backward-compatible single language plus spokenLanguages array
        language: (embeddedPayload.spokenLanguages && embeddedPayload.spokenLanguages[0]) || embeddedPayload.language || null,
        spokenLanguages: embeddedPayload.spokenLanguages ?? (embeddedPayload.language ? [embeddedPayload.language] : []),
        // subjects are derived from classes and not included in manual updates
        learningPreferences: embeddedPayload.learningPreferences ?? null,
        notes: embeddedPayload.notes ?? null,
        dateOfBirth: embeddedPayload.dateOfBirth ?? null,
        gender: embeddedPayload.gender,
      }
    };

    if (embeddedPayload.email !== undefined) {
      standalone.email = embeddedPayload.email;
    }

    if (embeddedPayload.phone !== undefined) {
      standalone.phone = embeddedPayload.phone;
    }

    if (embeddedPayload.whatsapp !== undefined) {
      standalone.whatsapp = embeddedPayload.whatsapp;
    }

    if (isAdmin && isAdmin()) {
      standalone.isActive = !!formData.isActive;
      standalone.studentInfo.evaluationSummary = embeddedPayload.evaluationSummary ?? '';
    }

    return pruneUndefined(standalone);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const embeddedPayload = buildEmbeddedUpdatePayload();
      const guardianToUpdate = (actualGuardianId && actualGuardianId !== 'null' && actualGuardianId !== 'undefined')
        ? actualGuardianId
        : (guardianId && guardianId !== 'null' && guardianId !== 'undefined')
          ? guardianId
          : null;

      
      

      let response;
      const isStandaloneStudentModel = !!(student && (student._source === 'standalone' || (student.guardian && !student.studentInfo && !student.role)));

      if (guardianToUpdate) {
        try {
          
          response = await api.put(`/users/${guardianToUpdate}/students/${studentId}`, embeddedPayload);
        } catch (embeddedError) {
          const status = embeddedError.response?.status;
          

          if (status === 404) {
            // If student is not in embedded list, try standalone Student model first, then standalone User.
            if (isStandaloneStudentModel) {
              response = await api.put(`/students/${studentId}`, embeddedPayload);
            } else {
              try {
                response = await api.put(`/students/${studentId}`, embeddedPayload);
              } catch (studentErr) {
                const standalonePayload = buildStandaloneUpdatePayload(embeddedPayload);
                response = await api.put(`/users/${studentId}`, standalonePayload);
              }
            }
          } else {
            throw embeddedError;
          }
        }
      } else {
        // No guardian context: try standalone Student model first, then standalone User.
        if (isStandaloneStudentModel) {
          response = await api.put(`/students/${studentId}`, embeddedPayload);
        } else {
          try {
            response = await api.put(`/students/${studentId}`, embeddedPayload);
          } catch (_) {
            const standalonePayload = buildStandaloneUpdatePayload(embeddedPayload);
            response = await api.put(`/users/${studentId}`, standalonePayload);
          }
        }
      }

      if (guardianToUpdate) {
        setStudent(response.data?.student || response.data?.user || response.data);
      } else {
        setStudent(response.data?.student || response.data?.user || response.data);
      }

      // If a new image file was selected, upload it to the student picture endpoint
      if (uploadFile && !isStandaloneStudentModel) {
        try {
          const fd = new FormData();
          fd.append('file', uploadFile);
          const targetGuardian = guardianToUpdate || actualGuardianId || guardianId;
          // Only attempt upload when we have determined the guardian to call
          if (targetGuardian) {
            await api.post(`/users/${targetGuardian}/students/${studentId}/profile-picture`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          } else {
            // If no guardian (editing standalone user), call users endpoint to upload? skip for now
            console.warn('Skipping student picture upload: guardian not determined');
          }
        } catch (imgErr) {
          console.warn('Failed to upload student picture:', imgErr && imgErr.message);
        }
      } else if (uploadFile && isStandaloneStudentModel) {
        console.warn('Skipping student picture upload for standalone Student model');
      }

      if (onUpdated) onUpdated();
      handleClose();

    } catch (err) {
      const backendMessage = err.response?.data?.error || err.response?.data?.message;
      const validationErrors = err.response?.data?.errors;
      if (validationErrors?.length) {
        console.error('Validation errors:', validationErrors);
      }
      setError(
        validationErrors?.length
          ? `${backendMessage || 'Validation failed'}: ${validationErrors.map(e => e.msg).join(', ')}`
          : backendMessage || err.message || 'Failed to update student information'
      );
      console.error('Error updating student:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (onClose) onClose();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <LoadingSpinner />
          <p className="mt-4 text-gray-600">Loading student information...</p>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8">
          <p className="text-red-600">Failed to load student information</p>
          <button
            onClick={handleClose}
            className="mt-4 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // useAuth provides isAdmin/isTeacher/isGuardian helpers

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Edit Student Information
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            disabled={saving}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  First Name *
                </label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Last Name *
                </label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date of Birth
                </label>
                <input
                  type="date"
                  name="dateOfBirth"
                  value={formData.dateOfBirth}
                  onChange={handleInputChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gender
                </label>
                <select
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
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Language
                </label>
                <SpokenLanguagesSelect
                  value={formData.spokenLanguages || []}
                  onChange={(arr) => setFormData(prev => ({ ...prev, spokenLanguages: arr }))}
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">Subjects</label>
                <div className="mt-1 text-sm text-gray-700">
                  {formData.subjects && formData.subjects.length ? (
                    <div className="flex flex-wrap gap-2">
                      {formData.subjects.map((s, idx) => (
                        <span key={idx} className="px-2 py-1 bg-gray-100 rounded-full text-sm">{s}</span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-sm text-gray-500">No subjects assigned</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">Subjects are populated automatically from scheduled classes and cannot be edited here.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Learning Preferences
                </label>
                <textarea
                  name="learningPreferences"
                  value={formData.learningPreferences}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              {/* Evaluation Summary: visible to admin (editable) and teacher (read-only). Hidden for guardians */}
              {(isAdmin() || (isTeacher && isTeacher())) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Evaluation Summary</label>
                  {isAdmin() ? (
                    <textarea
                      name="evaluationSummary"
                      value={formData.evaluationSummary}
                      onChange={handleInputChange}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                    />
                  ) : (
                    <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{formData.evaluationSummary || <span className="text-gray-500">No evaluation summary</span>}</div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-custom-teal"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Student Photo (optional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setUploadFile(e.target.files && e.target.files[0])}
                  className="w-full"
                />
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isActive"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleInputChange}
                  className="h-4 w-4 text-blue-600 focus:ring-custom-teal border-gray-300 rounded"
                />
                <label htmlFor="isActive" className="ml-2 block text-sm text-gray-700">
                  Student is active
                </label>
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-custom-teal text-white rounded-md hover:bg-custom-teal-dark transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <>
                <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
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
      </div>
    </div>
  );
};

export default EditStudentModal;