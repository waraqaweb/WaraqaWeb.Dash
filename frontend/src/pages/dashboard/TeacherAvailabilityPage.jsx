import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../api/axios';
import { 
  Calendar, 
  Plus, 
  Edit, 
  Trash2, 
  AlertCircle,
  CheckCircle,
  User
} from 'lucide-react';

const TeacherAvailabilityPage = () => {
  const { user } = useAuth();
  const [availability, setAvailability] = useState(() => ({
    slots: [],
    slotsByDay: {},
    config: null,
    compliance: null,
    availabilityStatus: 'default_24_7',
    isDefaultAvailability: true,
    timezone: user?.timezone || 'Africa/Cairo'
  }));
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSlot, setEditingSlot] = useState(null);
  const [newSlot, setNewSlot] = useState({
    dayOfWeek: 0,
    startTime: '09:00',
    endTime: '10:00',
    timezone: user?.timezone || 'Africa/Cairo'
  });

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const fetchAvailability = useCallback(async () => {
    if (!user?._id) return;
    try {
      setLoading(true);
      const [slotsResponse, complianceResponse] = await Promise.all([
        api.get(`/availability/slots/${user._id}`),
        api.get(`/availability/compliance/${user._id}`)
      ]);
      
      const slotData = slotsResponse.data || {};
      setAvailability({
        slots: slotData.slots || [],
        slotsByDay: slotData.slotsByDay || {},
        config: user.teacherInfo?.availabilityConfig,
        compliance: complianceResponse.data,
        availabilityStatus: slotData.availabilityStatus || 'default_24_7',
        isDefaultAvailability: typeof slotData.isDefaultAvailability === 'boolean'
          ? slotData.isDefaultAvailability
          : ((slotData.availabilityStatus || 'default_24_7') === 'default_24_7' && (slotData.slots?.length || 0) === 0),
        timezone: slotData.timezone || user?.timezone || 'Africa/Cairo'
      });
    } catch (error) {
      console.error('Error fetching availability:', error);
    } finally {
      setLoading(false);
    }
  }, [user?._id, user?.timezone, user?.teacherInfo?.availabilityConfig]);

  useEffect(() => {
    if (user?.role === 'teacher') {
      fetchAvailability();
    }
  }, [user?.role, fetchAvailability]);

  useEffect(() => {
    if (user?.role !== 'teacher') return;

    const handler = () => {
      fetchAvailability();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('availability:refresh', handler);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('availability:refresh', handler);
      }
    };
  }, [user?.role, fetchAvailability]);

  const handleAddSlot = async () => {
    try {
      await api.post('/availability/slots', {
        teacherId: user._id,
        ...newSlot
      });
      
      setShowAddModal(false);
      setNewSlot({
        dayOfWeek: 0,
        startTime: '09:00',
        endTime: '10:00',
        timezone: user?.timezone || 'Africa/Cairo'
      });
      fetchAvailability();
    } catch (error) {
      console.error('Error adding availability slot:', error);
      alert(error.response?.data?.message || 'Failed to add availability slot');
    }
  };

  const handleUpdateSlot = async (slotId, updates) => {
    try {
      await api.put(`/availability/slots/${slotId}`, updates);
      setEditingSlot(null);
      fetchAvailability();
    } catch (error) {
      console.error('Error updating availability slot:', error);
      alert(error.response?.data?.message || 'Failed to update availability slot');
    }
  };

  const handleDeleteSlot = async (slotId) => {
    if (!window.confirm('Are you sure you want to delete this availability slot?')) {
      return;
    }

    try {
      await api.delete(`/availability/slots/${slotId}`);
      fetchAvailability();
    } catch (error) {
      console.error('Error deleting availability slot:', error);
      alert(error.response?.data?.message || 'Failed to delete availability slot');
    }
  };

  const formatTime = (time) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  const getComplianceStatus = () => {
    if (!availability.compliance) return null;

    if (availability.compliance?.mode === 'default_24_7') {
      return {
        icon: <CheckCircle className="w-5 h-5 text-green-600" />,
        text: 'Default 24/7 availability active',
        color: 'text-green-600 bg-green-50 border-green-200'
      };
    }

    const { isCompliant, currentDays, requiredDays, requiredHoursPerDay } = availability.compliance;

    if (isCompliant) {
      return {
        icon: <CheckCircle className="w-5 h-5 text-green-600" />,
        text: 'Meeting Requirements',
        color: 'text-green-600 bg-green-50 border-green-200'
      };
    } else {
      return {
        icon: <AlertCircle className="w-5 h-5 text-red-600" />,
        text: `Need ${requiredDays - currentDays} more days (${requiredHoursPerDay}h each)`,
        color: 'text-red-600 bg-red-50 border-red-200'
      };
    }
  };

  if (user?.role !== 'teacher') {
    return (
      <div className="p-6">
        <div className="text-center">
          <User className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Access Denied</h3>
          <p className="mt-1 text-sm text-gray-500">
            This page is only available for teachers.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const complianceStatus = getComplianceStatus();

  return (
  <div className="p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-gray-700" />
          <div>
            <h1 className="text-xl font-semibold text-gray-900">My Availability</h1>
            <p className="text-sm text-gray-500">Manage weekly slots — keep it concise.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {availability.config?.isAvailabilityRequired && (
            <div className={`hidden sm:flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${complianceStatus?.color || 'text-gray-600 bg-gray-50 border-gray-200'}`}>
              {complianceStatus?.icon}
              <span>{complianceStatus?.text}</span>
            </div>
          )}

          <button
            onClick={() => { setShowAddModal(true); setNewSlot({ ...newSlot, dayOfWeek: 0 }); }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-b from-custom-teal to-custom-teal-dark text-white rounded-full shadow hover:brightness-95 transition"
          >
            <Plus className="w-4 h-4" />
            Add Slot
          </button>
        </div>
      </div>

      {/* Short requirements */}
      {availability.config?.isAvailabilityRequired && (
        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900">
            Min: <strong>{availability.config.minDaysPerWeek} days/week</strong>
            {' '}• <strong>{availability.config.minHoursPerDay}h/day</strong>
          </div>
          {availability.isDefaultAvailability && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800">Default 24/7 active</div>
          )}
        </div>
      )}

  {/* Day cards grid (max 3 columns) */}
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-3 mb-6">
        {dayNames.map((dayName, dayIndex) => {
          const daySlots = availability.slotsByDay[dayIndex] || [];
          const totalHours = daySlots.reduce((sum, slot) => sum + (slot.durationMinutes / 60), 0).toFixed(1);
          const hasSlots = daySlots.length > 0;

          return (
            <div key={dayIndex} className="bg-white rounded-lg shadow-sm border p-3 flex flex-col justify-between w-full h-full">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 whitespace-nowrap truncate">{dayName}</div>
                  <div className="text-xs text-gray-500 mt-1 whitespace-nowrap truncate">{hasSlots ? `${daySlots.length} slot${daySlots.length !== 1 ? 's' : ''} • ${totalHours}h` : (availability.isDefaultAvailability ? 'All day (default)' : 'No slots')}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    title={`Add slot for ${dayName}`}
                    onClick={() => { setShowAddModal(true); setNewSlot({ ...newSlot, dayOfWeek: dayIndex }); }}
                    className="icon-button icon-button--muted"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {daySlots.length === 0 ? (
                  <div className="text-xs text-gray-400">{availability.isDefaultAvailability ? 'Open all day' : 'No availability'}</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {daySlots.map(slot => (
                      <div key={slot._id} className="flex items-center justify-between gap-3 bg-gradient-to-r from-white to-gray-50 border rounded-md px-2 py-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="inline-flex items-center justify-center w-8 h-8 bg-indigo-50 text-indigo-600 rounded-md text-sm font-medium flex-shrink-0">{formatTime(slot.startTime)}</span>
                          <div className="text-sm min-w-0">
                            <div className="font-medium whitespace-nowrap truncate">{formatTime(slot.startTime)} — {formatTime(slot.endTime)}</div>
                            <div className="text-xs text-gray-500 whitespace-nowrap truncate">{(slot.durationMinutes / 60).toFixed(1)}h</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => setEditingSlot(slot)} className="icon-button icon-button--muted hover:text-indigo-600">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteSlot(slot._id)} className="icon-button icon-button--muted hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Add Availability Slot</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-gray-600 mb-1">Day</label>
                <select
                  value={newSlot.dayOfWeek}
                  onChange={(e) => setNewSlot({...newSlot, dayOfWeek: parseInt(e.target.value)})}
                  className="w-full border border-gray-200 rounded-md px-3 py-2 bg-white"
                >
                  {dayNames.map((day, index) => (
                    <option key={index} value={index}>{day}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                <input
                  type="time"
                  value={newSlot.startTime}
                  onChange={(e) => setNewSlot({...newSlot, startTime: e.target.value})}
                  className="w-full border border-gray-200 rounded-md px-3 py-2 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                <input
                  type="time"
                  value={newSlot.endTime}
                  onChange={(e) => setNewSlot({...newSlot, endTime: e.target.value})}
                  className="w-full border border-gray-200 rounded-md px-3 py-2 bg-white"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3 justify-end">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleAddSlot} className="px-4 py-2 bg-gradient-to-b from-custom-teal to-custom-teal-dark text-white rounded-md text-sm shadow">Add Slot</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingSlot && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit Slot</h3>
              <button onClick={() => setEditingSlot(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Day</label>
                <select value={editingSlot.dayOfWeek} onChange={(e) => setEditingSlot({...editingSlot, dayOfWeek: parseInt(e.target.value)})} className="w-full border border-gray-200 rounded-md px-3 py-2 bg-white">
                  {dayNames.map((day, index) => (
                    <option key={index} value={index}>{day}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
                <input type="time" value={editingSlot.startTime} onChange={(e) => setEditingSlot({...editingSlot, startTime: e.target.value})} className="w-full border border-gray-200 rounded-md px-3 py-2 bg-white" />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
                <input type="time" value={editingSlot.endTime} onChange={(e) => setEditingSlot({...editingSlot, endTime: e.target.value})} className="w-full border border-gray-200 rounded-md px-3 py-2 bg-white" />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3 justify-end">
              <button onClick={() => setEditingSlot(null)} className="px-4 py-2 border border-gray-200 rounded-md text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleUpdateSlot(editingSlot._id, editingSlot)} className="px-4 py-2 bg-gradient-to-b from-custom-teal to-custom-teal-dark text-white rounded-md text-sm shadow">Update</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default TeacherAvailabilityPage;