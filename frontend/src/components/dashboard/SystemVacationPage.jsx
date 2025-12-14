import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';

const SystemVacationPage = () => {
  const { user } = useAuth();
  const [systemVacations, setSystemVacations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [currentVacation, setCurrentVacation] = useState(null);
  const [form, setForm] = useState({
    name: '',
    message: '',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    timezone: 'UTC'
  });

  useEffect(() => {
    if (user && user.role === 'admin') {
      fetchSystemVacations();
      checkCurrentVacation();
    }
  }, [user]);

  const fetchSystemVacations = async () => {
    setLoading(true);
    try {
      const res = await api.get('/system-vacations');
      setSystemVacations(res.data.systemVacations);
      setError('');
    } catch (err) {
      console.error('Fetch system vacations error:', err);
      setError(err.response?.data?.message || 'Failed to load system vacations');
    } finally {
      setLoading(false);
    }
  };

  const checkCurrentVacation = async () => {
    try {
      const res = await api.get('/system-vacations/current');
      if (res.data.isActive) {
        setCurrentVacation(res.data.vacation);
      } else {
        setCurrentVacation(null);
      }
    } catch (err) {
      console.error('Check current vacation error:', err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate inputs
    if (!form.name || !form.message || !form.startDate || !form.startTime || !form.endDate || !form.endTime) {
      setError('Please fill in all required fields');
      return;
    }

    // Combine date and time
    const startDateTime = new Date(`${form.startDate}T${form.startTime}`);
    const endDateTime = new Date(`${form.endDate}T${form.endTime}`);

    if (startDateTime >= endDateTime) {
      setError('End date and time must be after start date and time');
      return;
    }

    if (startDateTime < new Date()) {
      setError('Start date and time cannot be in the past');
      return;
    }

    try {
      await api.post('/system-vacations', {
        name: form.name,
        message: form.message,
        startDate: startDateTime.toISOString(),
        endDate: endDateTime.toISOString(),
        timezone: form.timezone
      });

      setShowCreate(false);
      setForm({
        name: '',
        message: '',
        startDate: '',
        startTime: '',
        endDate: '',
        endTime: '',
        timezone: 'UTC'
      });
      
      setSuccess('System vacation created successfully! All classes during this period have been put on hold.');
      setTimeout(() => setSuccess(''), 5000);
      
      fetchSystemVacations();
      checkCurrentVacation();
    } catch (err) {
      console.error('Create system vacation error:', err);
      setError(err.response?.data?.message || 'Failed to create system vacation');
    }
  };

  const handleEndVacation = async (vacationId) => {
    if (!window.confirm('Are you sure you want to end this system vacation early? All classes will be restored.')) {
      return;
    }

    try {
      const res = await api.post(`/system-vacations/${vacationId}/end`);
      setSuccess(`System vacation ended successfully! ${res.data.restoredClasses} classes have been restored.`);
      setTimeout(() => setSuccess(''), 5000);
      
      fetchSystemVacations();
      checkCurrentVacation();
    } catch (err) {
      console.error('End vacation error:', err);
      setError(err.response?.data?.message || 'Failed to end system vacation');
    }
  };

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (vacation) => {
    const now = new Date();
    const start = new Date(vacation.startDate);
    const end = new Date(vacation.endDate);

    if (!vacation.isActive) {
      return <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-sm">Ended</span>;
    } else if (now >= start && now <= end) {
      return <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">Active</span>;
    } else if (now < start) {
      return <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">Scheduled</span>;
    } else {
      return <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm">Expired</span>;
    }
  };

  if (user?.role !== 'admin') {
    return <div className="p-6 text-red-600">Access denied. Admin only.</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">System Vacation Management</h1>
      <p className="text-gray-600 mb-6">
        Manage system-wide vacations like Eid holidays that put all classes on hold for all teachers.
      </p>

      {currentVacation && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="text-lg font-semibold text-green-800">🎉 Active System Vacation</h3>
              <p className="text-green-700 font-medium">{currentVacation.name}</p>
              <p className="text-green-600 text-sm mt-1">{currentVacation.message}</p>
              <p className="text-green-600 text-sm">
                {formatDateTime(currentVacation.startDate)} - {formatDateTime(currentVacation.endDate)}
              </p>
              <p className="text-green-600 text-sm">
                Affected Classes: {currentVacation.affectedClasses}
              </p>
            </div>
            <button
              onClick={() => handleEndVacation(currentVacation._id)}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
            >
              End Early
            </button>
          </div>
        </div>
      )}

      <button
        className="mb-4 px-4 py-2 bg-custom-teal text-white rounded hover:bg-custom-teal-dark transition-colors"
        onClick={() => setShowCreate(!showCreate)}
      >
        {showCreate ? 'Cancel' : 'Create System Vacation'}
      </button>

      {showCreate && (
        <div className="mb-6 p-6 bg-gray-50 rounded-lg border">
          <h3 className="text-lg font-semibold mb-4">Create New System Vacation</h3>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vacation Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., Eid Al-Fitr 2025"
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Message to Users *
                </label>
                <textarea
                  value={form.message}
                  onChange={(e) => setForm(f => ({ ...f, message: e.target.value }))}
                  placeholder="Message that will be shown to all teachers and guardians about this vacation"
                  className="w-full border border-gray-300 rounded px-3 py-2 h-24"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm(f => ({ ...f, startDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time *
                </label>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm(f => ({ ...f, startTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Date *
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Time *
                </label>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm(f => ({ ...f, endTime: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timezone
                </label>
                <select
                  value={form.timezone}
                  onChange={(e) => setForm(f => ({ ...f, timezone: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                >
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                  <option value="Europe/London">London</option>
                  <option value="Asia/Dubai">Dubai</option>
                  <option value="Asia/Riyadh">Riyadh</option>
                </select>
              </div>
            </div>

            <div className="mt-6">
              <button
                type="submit"
                className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
              >
                Create System Vacation
              </button>
            </div>
          </form>
        </div>
      )}

      {error && <p className="text-red-600 mb-4">{error}</p>}
      {success && <p className="text-green-600 mb-4">{success}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div className="bg-white rounded-lg border">
          <h3 className="text-lg font-semibold p-4 border-b">System Vacation History</h3>
          {systemVacations.length === 0 ? (
            <p className="p-4 text-gray-500">No system vacations found</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-3 text-left font-medium text-gray-700">Name</th>
                    <th className="p-3 text-left font-medium text-gray-700">Period</th>
                    <th className="p-3 text-left font-medium text-gray-700">Status</th>
                    <th className="p-3 text-left font-medium text-gray-700">Affected Classes</th>
                    <th className="p-3 text-left font-medium text-gray-700">Created By</th>
                    <th className="p-3 text-left font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {systemVacations.map((vacation) => (
                    <tr key={vacation._id} className="border-b">
                      <td className="p-3">
                        <div>
                          <div className="font-medium">{vacation.name}</div>
                          <div className="text-sm text-gray-600 truncate max-w-xs">
                            {vacation.message}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-sm">
                        <div>{formatDateTime(vacation.startDate)}</div>
                        <div className="text-gray-600">to</div>
                        <div>{formatDateTime(vacation.endDate)}</div>
                      </td>
                      <td className="p-3">
                        {getStatusBadge(vacation)}
                      </td>
                      <td className="p-3 text-center">
                        {vacation.affectedClasses}
                      </td>
                      <td className="p-3 text-sm">
                        {vacation.createdBy?.firstName} {vacation.createdBy?.lastName}
                      </td>
                      <td className="p-3">
                        {vacation.isActive && new Date() >= new Date(vacation.startDate) && new Date() <= new Date(vacation.endDate) && (
                          <button
                            onClick={() => handleEndVacation(vacation._id)}
                            className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
                          >
                            End Early
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SystemVacationPage;