import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import UserSearch from '../ui/UserSearch';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

// Admin vacation management page: view, create, assign substitutes
const VacationAdminPage = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [vacations, setVacations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ 
    user: null,
    role: 'teacher', 
    startDate: '', 
    endDate: '', 
    reason: '', 
    status: 'hold' 
  });
  const [substitutes, setSubstitutes] = useState([]);
  const [selectedVacation, setSelectedVacation] = useState(null);
  const [substitutesOptions, setSubstitutesOptions] = useState({ students: [], teachers: [] });
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    // Redirect non-admin users
    if (user && !isAdmin()) {
      navigate('/dashboard');
      return;
    }
    
    if (user) {
      fetchVacations();
    }
  }, [user, isAdmin, navigate]);

  const fetchVacations = async () => {
    setLoading(true);
    try {
      const res = await api.get('/vacations');
      setVacations(res.data.vacations);
      setError('');
    } catch (err) {
      console.error('Fetch vacations error:', err);
      if (err.response?.status === 401) {
        setError('You are not authorized to view vacations');
        navigate('/login');
      } else {
        setError(err.response?.data?.message || 'Failed to load vacations');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.user) {
      setError('Please select a user');
      return;
    }
    try {
      await api.post('/vacations', { ...form, user: form.user._id });
      setShowCreate(false);
      setForm({ user: null, role: 'teacher', startDate: '', endDate: '', reason: '', status: 'hold' });
      fetchVacations();
    } catch (err) {
      setError('Failed to create vacation');
    }
  };

  const handleApproval = async (vacationId, approved, rejectionReason = '') => {
    try {
      await api.post(`/vacations/${vacationId}/approval`, { approved, rejectionReason });
      fetchVacations();
    } catch (err) {
      setError('Failed to update approval status');
    }
  };

  const handleAssignSubstitutes = async (vacationId) => {
    try {
      // Validate that all students have a handling preference set
      if (substitutes.length === 0) {
        setError('Please set handling preferences for at least one student');
        return;
      }

      // Validate that all substitute assignments have a teacher selected
      const invalidSubstitute = substitutes.find(sub => 
        sub.handling === 'substitute' && !sub.substituteTeacherId
      );
      if (invalidSubstitute) {
        setError('Please select a substitute teacher for all students marked for substitution');
        return;
      }

      // Format substitutes data
      const formattedSubstitutes = substitutes.map(sub => ({
        studentId: sub.studentId,
        substituteTeacherId: sub.substituteTeacherId,
        handling: sub.handling
      }));

      await api.post(`/vacations/${vacationId}/assign`, {
        substitutes: formattedSubstitutes
      });
      
      setSelectedVacation(null);
      setSubstitutes([]);
      fetchVacations();
      setError(''); // Clear any existing errors
    } catch (err) {
      console.error('Error assigning substitutes:', err);
      setError(err.response?.data?.message || 'Failed to assign substitutes');
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Vacations</h1>
      {loading ? <p>Loading...</p> : (
        <>
          <button className="mb-4 px-4 py-2 bg-custom-teal text-white rounded" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? 'Cancel' : 'Create Vacation'}
          </button>
          {showCreate && (
            <form className="mb-6 space-y-4" onSubmit={handleCreate}>
              <div className="flex flex-col space-y-2">
                <label className="text-sm font-medium">Search User</label>
                <UserSearch
                  placeholder="Search by name or email..."
                  onSelect={(user) => setForm(f => ({ ...f, user }))}
                />
                {form.user && (
                  <div className="p-2 bg-gray-50 rounded-md">
                    <div className="font-medium">{form.user.fullName}</div>
                    <div className="text-sm text-gray-500">{form.user.email}</div>
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Role</label>
                  <select 
                    value={form.role} 
                    onChange={e => setForm(f => ({ ...f, role: e.target.value }))} 
                    className="w-full border p-2 rounded-md"
                  >
                    <option value="teacher">Teacher</option>
                    <option value="student">Student</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1">Status</label>
                  <select 
                    value={form.status} 
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))} 
                    className="w-full border p-2 rounded-md"
                  >
                    <option value="hold">Hold</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Start Date</label>
                  <input 
                    required 
                    type="date" 
                    value={form.startDate} 
                    onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} 
                    className="w-full border p-2 rounded-md"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-1">End Date</label>
                  <input 
                    required 
                    type="date" 
                    value={form.endDate} 
                    onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} 
                    className="w-full border p-2 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Reason</label>
                <textarea
                  placeholder="Reason for vacation..."
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full border p-2 rounded-md"
                  rows={3}
                />
              </div>

              <button 
                type="submit" 
                className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                Create Vacation Request
              </button>
            </form>
          )}
          {error && <p className="text-red-600 mb-2">{error}</p>}
          <table className="w-full border mb-6">
            <thead>
              <tr className="bg-gray-100">
                <th className="p-2 border">User</th>
                <th className="p-2 border">Role</th>
                <th className="p-2 border">Start</th>
                <th className="p-2 border">End</th>
                <th className="p-2 border">Status</th>
                <th className="p-2 border">Substitutes</th>
                <th className="p-2 border">Approval</th>
                <th className="p-2 border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vacations.map(v => (
                <tr key={v._id} className="border-b">
                  <td className="p-2 border">{v.user?.fullName || v.user?.email || v.user}</td>
                  <td className="p-2 border">{v.role}</td>
                  <td className="p-2 border">{v.startDate?.slice(0,10)}</td>
                  <td className="p-2 border">{v.endDate?.slice(0,10)}</td>
                  <td className="p-2 border">{v.status}</td>
                  <td className="p-2 border">{v.substitutes?.length || 0}</td>
                  <td className="p-2 border">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      v.approvalStatus === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      v.approvalStatus === 'approved' ? 'bg-green-100 text-green-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {v.approvalStatus}
                    </span>
                  </td>
                  <td className="p-2 border">
                    <div className="flex space-x-2">
                      {v.approvalStatus === 'pending' && (
                        <>
                          <button 
                            className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                            onClick={() => handleApproval(v._id, true)}
                          >
                            Approve
                          </button>
                          <button 
                            className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                            onClick={() => {
                              const reason = window.prompt('Enter rejection reason:');
                              if (reason !== null) {
                                handleApproval(v._id, false, reason);
                              }
                            }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {v.role === 'teacher' && v.approvalStatus === 'approved' && (
                        <button 
                          className="px-2 py-1 bg-yellow-500 text-white rounded hover:bg-yellow-600"
                          onClick={async () => {
                            setSelectedVacation(v);
                            setLoadingOptions(true);
                            try {
                              const response = await api.get(`/vacations/${v._id}/substitute-options`);
                              setSubstitutesOptions(response.data);
                            } catch (err) {
                              console.error('Error fetching substitute options:', err);
                              setError('Failed to load substitute options');
                            } finally {
                              setLoadingOptions(false);
                            }
                          }}
                        >
                          Assign Substitutes
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectedVacation && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
              <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4">
                <h2 className="text-xl font-bold mb-4">
                  Assign Substitutes for {selectedVacation.user?.fullName || selectedVacation.user}'s Vacation
                </h2>
                <div className="grid grid-cols-2 gap-6">
                  {/* Students List */}
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Configure Students' Classes</h3>
                    <p className="text-sm text-gray-500 mb-2">
                      Set handling preference for each student's classes during the vacation:
                    </p>
                    <div className="border rounded-lg max-h-96 overflow-y-auto">
                      {loadingOptions ? (
                        <div className="p-4 text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                          <p className="mt-2 text-gray-500">Loading students...</p>
                        </div>
                      ) : substitutesOptions.students?.length > 0 ? (
                        <div className="divide-y">
                          {substitutesOptions.students.map(student => {
                            const studentSub = substitutes.find(s => s.studentId === student._id) || {};
                            return (
                              <div
                                key={student._id}
                                className={`p-3 ${
                                  studentSub.handling ? 'bg-blue-50' : ''
                                }`}
                              >
                                <div className="flex items-start justify-between">
                                  <div>
                                    <div className="font-medium">
                                      {student.fullName || `${student.firstName} ${student.lastName}`}
                                    </div>
                                    <div className="text-sm text-gray-500">{student.email}</div>
                                    {student.guardianName && (
                                      <div className="text-xs text-gray-400">Guardian: {student.guardianName}</div>
                                    )}
                                  </div>
                                  <select
                                    value={studentSub.handling || ''}
                                    onChange={(e) => {
                                      const handling = e.target.value;
                                      setSubstitutes(subs => {
                                        // Find existing substitute config for this student
                                        const existingIndex = subs.findIndex(s => s.studentId === student._id);
                                        const newSub = {
                                          studentId: student._id,
                                          studentName: student.fullName || `${student.firstName} ${student.lastName}`,
                                          handling
                                        };
                                        
                                        if (existingIndex >= 0) {
                                          // Update existing
                                          const newSubs = [...subs];
                                          newSubs[existingIndex] = {
                                            ...subs[existingIndex],
                                            ...newSub
                                          };
                                          return newSubs;
                                        } else {
                                          // Add new
                                          return [...subs, newSub];
                                        }
                                      });
                                    }}
                                    className="ml-2 border p-1 rounded"
                                  >
                                    <option value="">Select handling...</option>
                                    <option value="hold">Put on hold</option>
                                    <option value="cancel">Cancel classes</option>
                                    <option value="substitute">Assign substitute</option>
                                  </select>
                                </div>
                                {studentSub.handling === 'substitute' && (
                                  <div className="mt-2 pl-4 border-l-2 border-blue-200">
                                    <select
                                      value={studentSub.substituteTeacherId || ''}
                                      onChange={(e) => {
                                        const substituteTeacherId = e.target.value;
                                        const substituteTeacher = substitutesOptions.teachers.find(t => t._id === substituteTeacherId);
                                        setSubstitutes(subs => {
                                          const existingIndex = subs.findIndex(s => s.studentId === student._id);
                                          const newSubs = [...subs];
                                          newSubs[existingIndex] = {
                                            ...subs[existingIndex],
                                            substituteTeacherId,
                                            teacherName: substituteTeacher ? (substituteTeacher.fullName || `${substituteTeacher.firstName} ${substituteTeacher.lastName}`) : ''
                                          };
                                          return newSubs;
                                        });
                                      }}
                                      className="w-full mt-1 border p-1 rounded"
                                    >
                                      <option value="">Select substitute teacher...</option>
                                      {substitutesOptions.teachers.map(teacher => (
                                        <option key={teacher._id} value={teacher._id}>
                                          {teacher.fullName || `${teacher.firstName} ${teacher.lastName}`}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-4 text-center text-gray-500">
                          No students found with upcoming classes
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Teachers List */}
                  <div>
                    <h3 className="text-lg font-semibold mb-2">Select Substitute Teacher</h3>
                    <p className="text-sm text-gray-500 mb-2">
                      Available teachers:
                    </p>
                    <div className="border rounded-lg max-h-96 overflow-y-auto">
                      {loadingOptions ? (
                        <div className="p-4 text-center">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
                          <p className="mt-2 text-gray-500">Loading teachers...</p>
                        </div>
                      ) : substitutesOptions.teachers?.length > 0 ? (
                        <div className="divide-y">
                          {substitutesOptions.teachers.map(teacher => (
                            <div
                              key={teacher._id}
                              onClick={() => setSubstitutes(subs => [{
                                ...subs[0] || {},
                                substituteTeacherId: teacher._id,
                                teacherName: teacher.fullName
                              }])}
                              className={`p-3 cursor-pointer hover:bg-gray-50 ${
                                substitutes[0]?.substituteTeacherId === teacher._id ? 'bg-blue-50' : ''
                              }`}
                            >
                              <div className="font-medium">{teacher.fullName || `${teacher.firstName} ${teacher.lastName}`}</div>
                              <div className="text-sm text-gray-500">{teacher.email}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-4 text-center text-gray-500">
                          No available teachers found
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Selection Summary */}
                {(substitutes[0]?.studentName || substitutes[0]?.teacherName) && (
                  <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                    <h4 className="font-medium mb-2">Selected:</h4>
                    {substitutes[0]?.studentName && (
                      <div className="text-sm">Student: <span className="font-medium">{substitutes[0].studentName}</span></div>
                    )}
                    {substitutes[0]?.teacherName && (
                      <div className="text-sm">Substitute Teacher: <span className="font-medium">{substitutes[0].teacherName}</span></div>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex justify-end space-x-2 mt-4">
                  <button 
                    className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                    onClick={() => {
                      setSelectedVacation(null);
                      setSubstitutes([]);
                      setSubstitutesOptions({ students: [], teachers: [] });
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => handleAssignSubstitutes(selectedVacation._id)}
                    disabled={!substitutes[0]?.studentId || !substitutes[0]?.substituteTeacherId}
                  >
                    Assign Substitute
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VacationAdminPage;
