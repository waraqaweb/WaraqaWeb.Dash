import React, { useState, useEffect } from 'react';
import { formatDateDDMMMYYYY } from '../../utils/date';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

// Vacation request and management for teachers and students
const MyVacationsPage = () => {
  const { user } = useAuth();
  const [vacations, setVacations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ startDate: '', endDate: '', reason: '' });

  useEffect(() => {
    if (user) {
      fetchVacations();
    }
  }, [user]); // Re-fetch when user changes

  const fetchVacations = async () => {
    if (!user?._id) return; // Don't fetch if no user
    setLoading(true);
    try {
      const res = await api.get(`/vacations/user/${user._id}`);
      setVacations(res.data.vacations);
      setError('');
    } catch (err) {
      console.error('Fetch vacations error:', err);
      setError(err.response?.data?.message || 'Failed to load vacations');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    
    // Validate inputs
    if (!form.startDate || !form.endDate || !form.reason) {
      setError('Please fill in all required fields');
      return;
    }

    // Validate dates
    const start = new Date(form.startDate);
    const end = new Date(form.endDate);
    
    if (start > end) {
      setError('End date must be after start date');
      return;
    }

    try {
      await api.post('/vacations', {
        user: user._id,
        role: user.role,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason
      });
      setShowCreate(false);
      setForm({ startDate: '', endDate: '', reason: '' });
      fetchVacations();
      // Clear any existing error and show success
      setError('');
      setSuccess('Vacation request submitted successfully! Awaiting admin approval.');
      // Clear success message after 5 seconds
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      console.error('Create vacation error:', err);
      setError(err.response?.data?.message || 'Failed to create vacation');
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">My Vacations</h1>
      <button className="mb-4 px-4 py-2 bg-custom-teal text-white rounded" onClick={() => setShowCreate(!showCreate)}>
        {showCreate ? 'Cancel' : 'Request Vacation'}
      </button>
      {showCreate && (
        <form className="mb-6" onSubmit={handleCreate}>
          <div className="flex flex-col space-y-4 max-w-md">
            <div className="flex flex-col">
              <label className="text-sm text-gray-600 mb-1">Start Date</label>
              <input 
                required 
                type="date" 
                value={form.startDate} 
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} 
                className="border p-2 rounded" 
              />
            </div>
            <div className="flex flex-col">
              <label className="text-sm text-gray-600 mb-1">End Date</label>
              <input 
                required 
                type="date" 
                value={form.endDate} 
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} 
                className="border p-2 rounded" 
              />
            </div>
            <div className="flex flex-col">
              <label className="text-sm text-gray-600 mb-1">Reason</label>
              <textarea 
                required
                placeholder="Please provide a reason for your vacation request" 
                value={form.reason} 
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} 
                className="border p-2 rounded h-24" 
              />
            </div>
            <button 
              type="submit" 
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
            >
              Submit Request
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-red-600 mb-2">{error}</p>}
      {success && <p className="text-green-600 mb-2">{success}</p>}
      {loading ? <p>Loading...</p> : (
        <table className="w-full border">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2 border">Start Date</th>
              <th className="p-2 border">End Date</th>
              <th className="p-2 border">Reason</th>
              <th className="p-2 border">Status</th>
              <th className="p-2 border">Details</th>
            </tr>
          </thead>
          <tbody>
            {vacations.length === 0 ? (
              <tr>
                <td colSpan="5" className="p-4 text-center text-gray-500">
                  No vacation requests found
                </td>
              </tr>
            ) : (
              vacations.map(v => (
                <tr key={v._id} className="border-b">
                  <td className="p-2 border">{v.startDate?.slice(0,10)}</td>
                  <td className="p-2 border">{v.endDate?.slice(0,10)}</td>
                  <td className="p-2 border">{v.reason}</td>
                  <td className="p-2 border">
                    <span className={`px-2 py-1 rounded text-sm font-medium ${
                      v.approvalStatus === 'approved' ? 'bg-green-100 text-green-800' :
                      v.approvalStatus === 'rejected' ? 'bg-red-100 text-red-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {v.approvalStatus === 'approved' ? 'Approved' :
                       v.approvalStatus === 'rejected' ? 'Rejected' :
                       'Pending Approval'}
                    </span>
                  </td>
                  <td className="p-2 border">
                    {v.approvalStatus === 'rejected' && v.rejectionReason && (
                      <div className="text-sm text-red-600">
                        <strong>Reason:</strong> {v.rejectionReason}
                      </div>
                    )}
                    {v.approvalStatus === 'approved' && (
                      <div className="text-sm text-green-600">
                        Approved on {v.updatedAt ? formatDateDDMMMYYYY(v.updatedAt) : 'N/A'}
                      </div>
                    )}
                    {v.approvalStatus === 'pending' && (
                      <div className="text-sm text-gray-600">
                        Awaiting admin review
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default MyVacationsPage;
