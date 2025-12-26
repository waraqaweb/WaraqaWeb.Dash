import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import InputField from './ProfileInputField';

// Lightweight InputField wrapper if the shared one isn't exported
// If ProfilePage's InputField isn't exported, we provide a small local one
// But we'll try to import from same folder; fallback defined above

const ProfileModal = ({ isOpen, onClose }) => {
  const { user: authUser, updateProfile, isAdmin } = useAuth();
  const [selectedUser, setSelectedUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState(null);

  const fetchAllUsers = useCallback(async () => {
    try {
      const res = await api.get('/users');
      setUsers(res.data.users || []);
    } catch (err) {
      console.error('Error fetching users for modal', err);
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // default selected is current user
    setSelectedUser(authUser || null);
    setFormData(authUser ? { ...authUser } : null);

    if (isAdmin && isAdmin()) {
      fetchAllUsers();
    }
  }, [isOpen, authUser, isAdmin, fetchAllUsers]);

  const selectUser = (u) => {
    setSelectedUser(u);
    setFormData({ ...u });
    setEditing(false);
  };

  const handleChange = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!formData) return;
    try {
      if (selectedUser && selectedUser._id && authUser && selectedUser._id !== authUser._id && isAdmin && isAdmin()) {
        // admin updating another user
  await api.put(`/users/${selectedUser._id}`, formData);
        await fetchAllUsers();
      } else {
        // updating own profile via context helper
        const res = await updateProfile(formData);
        if (!res.success) throw new Error(res.error || 'Update failed');
      }
      setEditing(false);
      // refresh selected
      if (isAdmin && isAdmin()) {
        const refreshed = users.find(u => u._id === (selectedUser && selectedUser._id));
        if (refreshed) selectUser(refreshed);
      }
    } catch (err) {
      console.error('Error saving profile from modal', err);
    }
  };

  const toggleActive = async (u) => {
    try {
      const newStatus = !u.isActive;
  await api.put(`/users/${u._id}/status`, { isActive: newStatus });
      if (isAdmin && isAdmin()) {
        setUsers(prev => prev.map(p => p._id === u._id ? { ...p, isActive: newStatus } : p));
        if (selectedUser?._id === u._id) setSelectedUser(prev => ({ ...prev, isActive: newStatus }));
      }
    } catch (err) {
      console.error('Error toggling active status from modal', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-lg w-[90%] max-w-4xl p-6 z-60">
        <div className="flex items-start justify-between">
          <h3 className="text-xl font-bold">My Profile</h3>
          <button aria-label="Close profile modal" onClick={onClose} className="text-gray-500 text-lg">×</button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4">
          {/* Left: admin user list or empty spacer */}
          <div className="col-span-1">
            {isAdmin && isAdmin() ? (
              <div>
                <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search users..." className="w-full border rounded px-2 py-1 mb-2" />
                <div className="max-h-96 overflow-auto">
                  {users.filter(u => {
                    const q = searchQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (`${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q));
                  }).map(u => (
                    <div key={u._id} className={`p-2 rounded cursor-pointer ${selectedUser?._id === u._id ? 'bg-gray-100' : ''}`} onClick={() => selectUser(u)}>
                      <div className="font-semibold">{u.firstName} {u.lastName}</div>
                      <div className="text-xs text-gray-600">{u.email}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div />
            )}
          </div>

          {/* Right: profile details */}
          <div className="col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <InputField label="First Name" value={formData?.firstName} onChange={(v) => handleChange('firstName', v)} disabled={!editing} />
              <InputField label="Last Name" value={formData?.lastName} onChange={(v) => handleChange('lastName', v)} disabled={!editing} />
              <InputField label="Email" value={formData?.email} disabled />
              <InputField label="Password" value={formData?.password} onChange={(v) => handleChange('password', v)} disabled={!editing} />
              <InputField label="Role" value={formData?.role} disabled />
              <InputField label="isActive" value={String(formData?.isActive)} disabled />
              <InputField label="isEmailVerified" value={String(formData?.isEmailVerified)} disabled />
              <InputField label="Phone" value={formData?.phone} onChange={(v) => handleChange('phone', v)} disabled={!editing} />
              <InputField label="Address - Street" value={formData?.address?.street} onChange={(v) => handleChange('address', { ...(formData.address||{}), street: v })} disabled={!editing} />
              <InputField label="City" value={formData?.address?.city} onChange={(v) => handleChange('address', { ...(formData.address||{}), city: v })} disabled={!editing} />
              <InputField label="State" value={formData?.address?.state} onChange={(v) => handleChange('address', { ...(formData.address||{}), state: v })} disabled={!editing} />
              <InputField label="Country" value={formData?.address?.country} onChange={(v) => handleChange('address', { ...(formData.address||{}), country: v })} disabled={!editing} />
              <InputField label="Zip Code" value={formData?.address?.zipCode} onChange={(v) => handleChange('address', { ...(formData.address||{}), zipCode: v })} disabled={!editing} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <InputField label="Profile Picture" value={formData?.profilePicture} onChange={(v) => handleChange('profilePicture', v)} disabled={!editing} />
              <InputField label="Date of Birth" value={formData?.dateOfBirth} onChange={(v) => handleChange('dateOfBirth', v)} disabled={!editing} />
              <InputField label="Gender" value={formData?.gender} onChange={(v) => handleChange('gender', v)} disabled={!editing} />
              <InputField label="Timezone" value={formData?.timezone} onChange={(v) => handleChange('timezone', v)} disabled={!editing} />
            </div>

            <div className="mt-4 flex justify-end gap-2">
              {!editing && (
                <>
                  <button onClick={() => setEditing(true)} className="px-3 py-2 bg-custom-teal text-white rounded">Edit</button>
                  {isAdmin && isAdmin() && selectedUser && (
                    <button onClick={() => toggleActive(selectedUser)} className="px-3 py-2 bg-gray-100 rounded">{selectedUser.isActive ? 'Deactivate' : 'Activate'}</button>
                  )}
                </>
              )}
              {editing && (
                <>
                  <button onClick={() => { setEditing(false); setFormData(selectedUser ? { ...selectedUser } : { ...authUser }); }} className="px-3 py-2 bg-gray-300 rounded">Cancel</button>
                  <button onClick={handleSave} className="px-3 py-2 bg-green-600 text-white rounded">Save</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;
