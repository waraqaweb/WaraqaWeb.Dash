import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import ProfileInputField from './ProfileInputField';
import Cropper from 'react-easy-crop';
import imageCompression from 'browser-image-compression';

// Reusable modal for editing/viewing a user's profile.
// Props:
// - isOpen: boolean
// - onClose: fn
// - userId: if provided, fetch /users/:id (admin editing other users)
// - self: boolean - if true, fetch /auth/me (current user)
// - onSaved: optional callback after successful save
const ProfileEditorModal = ({ isOpen, onClose, userId, self = false, onSaved }) => {
  const { updateProfile, isAdmin } = useAuth();
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState(null);
  const [, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    try {
      if (self) {
        const res = await api.get('/auth/me');
        setUser(res.data.user || null);
      } else if (userId) {
        const res = await api.get(`/users/${userId}`);
        setUser(res.data.user || null);
      } else {
        setUser(null);
      }
    } catch (err) {
      console.error('Error fetching user for editor', err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [self, userId]);

  useEffect(() => {
    if (!isOpen) return;
    setEditing(false);
    fetchUser();
  }, [isOpen, fetchUser]);

  const handleChange = (path, value) => {
    // simple shallow set for top-level and address/notifications
    if (!user) return;
    if (path.startsWith('address.')) {
      const key = path.split('.')[1];
      setUser(prev => ({ ...prev, address: { ...(prev.address || {}), [key]: value } }));
      return;
    }
    if (path.startsWith('notifications.')) {
      const key = path.split('.')[1];
      setUser(prev => ({ ...prev, notifications: { ...(prev.notifications || {}), [key]: value } }));
      return;
    }
    setUser(prev => ({ ...prev, [path]: value }));
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
    setUploading({ file });
  };

  const onCropComplete = useCallback((_, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  // Helper to create a cropped image blob from dataUrl + crop area
  async function getCroppedImg(imageSrc, pixelCrop) {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.setAttribute('crossOrigin', 'anonymous');
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = imageSrc;
    });

    const canvas = document.createElement('canvas');
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(blob);
      }, 'image/jpeg', 0.7); // lower quality to reduce upload size
    });
  }

  const uploadPicture = async () => {
    if (!uploading || !uploading.file) return;
    try {
      setUploading(true);

      let fileToUpload = uploading.file;

      // If user has cropped, generate cropped blob
      if (preview && croppedAreaPixels) {
        const croppedBlob = await getCroppedImg(preview, croppedAreaPixels);
        // convert blob to File
        fileToUpload = new File([croppedBlob], uploading.file.name || 'avatar.jpg', { type: 'image/jpeg' });
      }

      // Compress image to reasonable quality and size
      const compressed = await imageCompression(fileToUpload, {
        maxSizeMB: 0.5, // try to keep under 0.5MB
        maxWidthOrHeight: 1200,
        useWebWorker: true,
        initialQuality: 0.7
      });

      const fd = new FormData();
      fd.append('file', compressed);
      const res = await api.post(`/users/${user._id}/profile-picture`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setUser(res.data.user);
      setPreview(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setUploading(false);
      if (typeof onSaved === 'function') onSaved();
    } catch (err) {
      console.error('Upload failed', err);
      setUploading(false);
    }
  };

  const deletePicture = async () => {
    try {
      const res = await api.delete(`/users/${user._id}/profile-picture`);
      setUser(res.data.user);
      setPreview(null);
      if (typeof onSaved === 'function') onSaved();
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const save = async () => {
    if (!user) return;
    try {
      if (self) {
        const res = await updateProfile(user);
        if (!res.success) throw new Error(res.error || 'Update failed');
      } else if (userId) {
  await api.put(`/users/${userId}`, user);
      }
      setEditing(false);
      if (typeof onSaved === 'function') onSaved();
    } catch (err) {
      console.error('Error saving user', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-lg w-[95%] max-w-4xl p-6 z-60 max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">{self ? 'My Profile' : `Edit User`}</h3>
          <div className="flex items-center gap-2">
            {user && (isAdmin && isAdmin() && !self) && (
              <button onClick={() => {
                // toggle active
                const newStatus = !user.isActive;
                api.put(`/users/${user._id}/status`, { isActive: newStatus })
                  .then(() => setUser(prev => ({ ...prev, isActive: newStatus })))
                  .catch(err => { console.error(err); });
              }} className={`px-3 py-1 rounded ${user?.isActive ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                {user?.isActive ? 'Deactivate' : 'Activate'}
              </button>
            )}
            <button aria-label="Close" onClick={onClose} className="text-gray-500 text-lg">×</button>
          </div>
        </div>

        {loading && <div className="mt-4">Loading...</div>}

        {!loading && user && (
          <div className="mt-4 space-y-4">
            <div>
              <h4 className="font-semibold mb-2">Basic Information</h4>
              <div className="grid grid-cols-2 gap-3">
                <ProfileInputField label="First Name" value={user.firstName} onChange={(v) => handleChange('firstName', v)} />
                <ProfileInputField label="Last Name" value={user.lastName} onChange={(v) => handleChange('lastName', v)} />
                <ProfileInputField label="Email" value={user.email} onChange={(v) => handleChange('email', v)} />
                <ProfileInputField label="Password" value={user.password} onChange={(v) => handleChange('password', v)} />

                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-gray-700 mb-1">Role</label>
                  <select value={user.role} onChange={(e) => handleChange('role', e.target.value)} className="border rounded px-2 py-2">
                    <option value="admin">admin</option>
                    <option value="teacher">teacher</option>
                    <option value="guardian">guardian</option>
                    <option value="student">student</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-gray-700">isActive</label>
                  <input type="checkbox" checked={!!user.isActive} onChange={(e) => handleChange('isActive', e.target.checked)} />
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-gray-700">isEmailVerified</label>
                  <input type="checkbox" checked={!!user.isEmailVerified} onChange={(e) => handleChange('isEmailVerified', e.target.checked)} />
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Contact Info</h4>
              <div className="grid grid-cols-2 gap-3">
                <ProfileInputField label="Phone" value={user.phone} onChange={(v) => handleChange('phone', v)} />
                <ProfileInputField label="Address - Street" value={user.address?.street} onChange={(v) => handleChange('address.street', v)} />
                <ProfileInputField label="City" value={user.address?.city} onChange={(v) => handleChange('address.city', v)} />
                <ProfileInputField label="State" value={user.address?.state} onChange={(v) => handleChange('address.state', v)} />
                <ProfileInputField label="Country" value={user.address?.country} onChange={(v) => handleChange('address.country', v)} />
                <ProfileInputField label="Zip Code" value={user.address?.zipCode} onChange={(v) => handleChange('address.zipCode', v)} />
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Profile Info</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-gray-700 mb-1">Profile Picture</label>
                  <div className="flex items-center gap-3">
                    <div className="h-20 w-20 bg-gray-100 rounded-full overflow-hidden border">
                      {preview ? <img src={preview} alt="preview" className="h-full w-full object-cover" /> : (user.profilePicture ? <img src={user.profilePicture} alt="profile" className="h-full w-full object-cover" /> : <div className="h-full w-full flex items-center justify-center text-gray-400">No image</div>)}
                    </div>
                    <div className="flex flex-col">
                      <input type="file" accept="image/*" onChange={(e) => handleFile(e.target.files[0])} />
                      <div className="flex gap-2 mt-2">
                        <button onClick={uploadPicture} disabled={!uploading || uploading === true} className="px-3 py-1 bg-custom-teal text-white rounded">Upload</button>
                        <button onClick={deletePicture} className="px-3 py-1 bg-red-100 text-red-700 rounded">Remove</button>
                      </div>
                    </div>
                  </div>
                </div>
                {preview && (
                  <div className="col-span-2 mt-4">
                    <div className="relative h-64 bg-gray-200">
                      <Cropper
                        image={preview}
                        crop={crop}
                        zoom={zoom}
                        aspect={1}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onCropComplete={onCropComplete}
                      />
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <label className="text-sm">Zoom</label>
                      <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
                    </div>
                  </div>
                )}
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-gray-700 mb-1">Date of Birth</label>
                  <input type="date" value={user.dateOfBirth ? user.dateOfBirth.split('T')[0] : ''} onChange={(e) => handleChange('dateOfBirth', e.target.value)} className="border rounded px-2 py-2" />
                </div>
                <ProfileInputField label="Gender" value={user.gender} onChange={(v) => handleChange('gender', v)} />
                <ProfileInputField label="Timezone" value={user.timezone} onChange={(v) => handleChange('timezone', v)} />
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">System Fields</h4>
              <div className="grid grid-cols-2 gap-3">
                <ProfileInputField label="Last Login" value={user.lastLogin} onChange={(v) => handleChange('lastLogin', v)} />
                <ProfileInputField label="Login Attempts" value={user.loginAttempts} onChange={(v) => handleChange('loginAttempts', v)} />
                <div className="flex flex-col">
                  <label className="text-sm font-semibold text-gray-700 mb-1">Lock Until</label>
                  <input type="datetime-local" value={user.lockUntil ? new Date(user.lockUntil).toISOString().slice(0,16) : ''} onChange={(e) => handleChange('lockUntil', e.target.value)} className="border rounded px-2 py-2" />
                </div>
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-2">Notifications</h4>
              <div className="grid grid-cols-2 gap-3 items-center">
                <div className="flex items-center gap-2"><label className="text-sm">Email Notifications</label><input type="checkbox" checked={!!user.notifications?.email} onChange={(e) => handleChange('notifications.email', e.target.checked)} /></div>
                <div className="flex items-center gap-2"><label className="text-sm">SMS Notifications</label><input type="checkbox" checked={!!user.notifications?.sms} onChange={(e) => handleChange('notifications.sms', e.target.checked)} /></div>
                <div className="flex items-center gap-2"><label className="text-sm">Push Notifications</label><input type="checkbox" checked={!!user.notifications?.push} onChange={(e) => handleChange('notifications.push', e.target.checked)} /></div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => { setEditing(false); onClose(); }} className="px-3 py-2 bg-gray-300 rounded">Cancel</button>
              <button onClick={save} className="px-3 py-2 bg-custom-teal text-white rounded">Save</button>
            </div>
          </div>
        )}

        {!loading && !user && (
          <div className="mt-4">No user data</div>
        )}
      </div>
    </div>
  );
};

export default ProfileEditorModal;
