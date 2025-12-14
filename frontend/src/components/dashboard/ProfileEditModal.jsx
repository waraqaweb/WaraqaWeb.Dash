import React, { useEffect, useState, useCallback } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import TimezoneSelector from '../ui/TimezoneSelector';
import QualificationsEditor from '../ui/QualificationsEditor';
import TeacherAvailabilityConfig from './TeacherAvailabilityConfig';
import { subjects } from './ReportTopicsConfig';
import Cropper from 'react-easy-crop';
import imageCompression from 'browser-image-compression';
import SpokenLanguagesSelect from '../ui/SpokenLanguagesSelect';

export default function ProfileEditModal({ isOpen, targetUser, onClose, onSaved }) {
  const { user: viewer } = useAuth();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshingAvatar, setRefreshingAvatar] = useState(false);
  
  // Avatar cropping state
  // uploadFile holds the selected File (or null). isUploading is a boolean upload-in-progress flag.
  const [uploadFile, setUploadFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  // keep password input separate so browser autofill doesn't populate the saved form value
  const [passwordInput, setPasswordInput] = useState('');

  useEffect(() => {
    if (targetUser) {
      // shallow clone for editing
      const formData = JSON.parse(JSON.stringify(targetUser));
      
      // Normalize nested fields: extract from role-specific objects to top-level for editing
      if (targetUser.role === 'teacher') {
        // Extract teacher-specific fields
        if (targetUser.teacherInfo?.bio !== undefined) {
          formData.bio = targetUser.teacherInfo.bio;
        }
        // bankDetails removed from edit form
        if (targetUser.teacherInfo?.instapayName !== undefined) {
          formData.instapayName = targetUser.teacherInfo.instapayName;
        }
        if (targetUser.teacherInfo?.qualifications !== undefined) {
          formData.qualifications = targetUser.teacherInfo.qualifications;
        }
        if (targetUser.teacherInfo?.subjects !== undefined) {
          formData.courses = targetUser.teacherInfo.subjects; // Map subjects to courses for editing
        }
        if (targetUser.teacherInfo?.spokenLanguages !== undefined) {
          formData.spokenLanguages = targetUser.teacherInfo.spokenLanguages;
        }
        // Availability config
        if (targetUser.teacherInfo?.availabilityConfig !== undefined) {
          formData.availabilityConfig = targetUser.teacherInfo.availabilityConfig;
        } else {
          // Set defaults if not present
          formData.availabilityConfig = {
            minDaysPerWeek: 5,
            minHoursPerDay: 3,
            isAvailabilityRequired: true
          };
        }
      } else if (targetUser.role === 'guardian') {
        // Extract guardian-specific fields (guardians do not receive bank details in the edit form)
        if (targetUser.guardianInfo?.spokenLanguages !== undefined) {
          formData.spokenLanguages = targetUser.guardianInfo.spokenLanguages;
        }
        if (!formData.guardianInfo) {
          formData.guardianInfo = {};
        }
        if (targetUser.guardianInfo?.hourlyRate !== undefined) {
          formData.guardianInfo.hourlyRate = targetUser.guardianInfo.hourlyRate;
        }
        if (targetUser.guardianInfo?.transferFee) {
          formData.guardianInfo.transferFee = targetUser.guardianInfo.transferFee;
        } else if (!formData.guardianInfo.transferFee) {
          formData.guardianInfo.transferFee = { mode: 'fixed', value: 5 };
        }
        // Normalize backend default 'credit_card' to desired guardian default 'paypal' in the edit form
        if (formData.guardianInfo && formData.guardianInfo.paymentMethod === 'credit_card') {
          formData.guardianInfo.paymentMethod = 'paypal';
          formData.paymentMethod = 'paypal';
        }
      }
      
      // Detect visitor timezone and default when form has no timezone set
      try {
        const detected = (typeof Intl !== 'undefined' && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
        // If no timezone saved in DB, prefer the detected timezone; fallback to Cairo
        if (!formData.timezone || formData.timezone === '') {
          formData.timezone = detected || 'Africa/Cairo';
        }
      } catch (e) {
        // Silently ignore detection errors and fallback to Cairo
        if (!formData.timezone) formData.timezone = 'Africa/Cairo';
      }

      setForm(formData);
      // ensure password input is always empty when opening the modal
      setPasswordInput('');
    } else {
      setForm(null);
    }
  }, [targetUser]);

  const refreshFormFromServer = async () => {
    if (!targetUser) return;
    try {
      setRefreshingAvatar(true);
      const res = await api.get(`/users/${targetUser._id}`);
      if (res.data && res.data.user) {
        // Deep clone and normalize the fresh data just like in useEffect
        const freshUser = res.data.user;
        const formData = JSON.parse(JSON.stringify(freshUser));
        
        // Normalize nested fields for teachers
        if (freshUser.role === 'teacher') {
          if (freshUser.teacherInfo?.bio !== undefined) formData.bio = freshUser.teacherInfo.bio;
          if (freshUser.teacherInfo?.instapayName !== undefined) formData.instapayName = freshUser.teacherInfo.instapayName;
          if (freshUser.teacherInfo?.qualifications !== undefined) formData.qualifications = freshUser.teacherInfo.qualifications;
          if (freshUser.teacherInfo?.subjects !== undefined) formData.courses = freshUser.teacherInfo.subjects;
          if (freshUser.teacherInfo?.spokenLanguages !== undefined) formData.spokenLanguages = freshUser.teacherInfo.spokenLanguages;
          if (freshUser.teacherInfo?.availabilityConfig !== undefined) formData.availabilityConfig = freshUser.teacherInfo.availabilityConfig;
        }
        
        setForm(formData);
      }
    } catch (e) {
      console.error('Failed to refresh user after avatar update', e);
    } finally {
      setRefreshingAvatar(false);
    }
  };

  // Avatar cropping functions
  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
    // store the selected file and trigger the auto-upload flow
    setUploadFile(file);
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

  // Keep a debounced auto-upload: whenever the user selects a file (uploadFile) or adjusts crop/zoom,
  // we will generate a cropped blob, compress it, and POST it to the server automatically.
  const uploadDebounceRef = React.useRef(null);

  const performUpload = async (fileToUse) => {
    try {
      setIsUploading(true);

      let fileToUpload = fileToUse;

      // If user has cropped, generate cropped blob
      if (preview && croppedAreaPixels) {
        const croppedBlob = await getCroppedImg(preview, croppedAreaPixels);
        // convert blob to File
        fileToUpload = new File([croppedBlob], (fileToUse && fileToUse.name) || 'avatar.jpg', { type: 'image/jpeg' });
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
      const res = await api.post(`/users/${form._id}/profile-picture`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });

      // Update form with new profile picture
      setForm(prev => ({ ...prev, profilePicture: res.data.user.profilePicture }));
      // keep preview and crop state intact so user can continue adjusting; reset uploadFile to indicate uploaded
      setUploadFile(null);
      setIsUploading(false);

      // Optionally notify user non-intrusively
      try { /* silent success - no alert to avoid annoyance */ } catch (e) {}
    } catch (err) {
      console.error('Auto upload failed', err);
      try { alert('Failed to upload picture: ' + (err.response?.data?.message || err.message)); } catch(e){}
      setIsUploading(false);
    }
  };

  // Trigger auto-upload when uploadFile or crop/zoom changes (debounced)
  useEffect(() => {
    // We only auto-upload when there is a source file available (uploadFile) or we have an existing
    // preview (user is adjusting) and want to re-upload the adjusted version.
    if (!preview && !uploadFile) return;

    // Clear any existing debounce
    if (uploadDebounceRef.current) clearTimeout(uploadDebounceRef.current);

    // Debounce a bit to avoid excessive uploads while the user drags
    uploadDebounceRef.current = setTimeout(() => {
      // If there's an explicit selected uploadFile, prefer that; otherwise try to reconstruct from preview
      const fileCandidate = uploadFile || (uploadFile === null && null);
      // If we don't have an original File (e.g., after page reload) we still attempt to upload the cropped preview
      if (fileCandidate) {
        performUpload(fileCandidate);
      } else if (preview) {
        // When uploadFile is null (e.g., user already uploaded once) but preview/crop changes,
        // create a blob from cropped area and upload that.
        (async () => {
          try {
            setIsUploading(true);
            const croppedBlob = await getCroppedImg(preview, croppedAreaPixels);
            const f = new File([croppedBlob], 'avatar.jpg', { type: 'image/jpeg' });
            const compressed = await imageCompression(f, { maxSizeMB: 0.5, maxWidthOrHeight: 1200, useWebWorker: true, initialQuality: 0.7 });
            const fd = new FormData(); fd.append('file', compressed);
            const res = await api.post(`/users/${form._id}/profile-picture`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            setForm(prev => ({ ...prev, profilePicture: res.data.user.profilePicture }));
            setIsUploading(false);
          } catch (err) {
            console.error('Re-upload after adjust failed', err);
            setIsUploading(false);
          }
        })();
      }
    }, 700);

    return () => { if (uploadDebounceRef.current) clearTimeout(uploadDebounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFile, preview, croppedAreaPixels, zoom]);

  const deletePicture = async () => {
    try {
      await api.delete(`/users/${form._id}/profile-picture`);
      setForm(prev => ({ ...prev, profilePicture: null }));
      setPreview(null);
      alert('Profile picture removed');
    } catch (err) {
      console.error('Delete failed', err);
      alert('Failed to remove picture: ' + (err.response?.data?.message || err.message));
    }
  };

  if (!isOpen) return null;
  if (!form) return null;

  const isAdmin = viewer?.role === 'admin';
  const isSelf = viewer?._id === (targetUser && targetUser._id);

  const canEdit = (field) => {
    // Based on the standards shared earlier in chat
  const adminOnly = ['email','role','isActive','isEmailVerified','guardianInfo.hourlyRate','guardianInfo.transferFee','totalHours','lastLogin','loginAttempts','lockUntil'];
    // monthlyHours and bonus removed from modal editing; they are read-only on the profile page
    // bankDetails require special rules: admins can edit, users can edit their own only if they are not guardians
  const selfEditable = ['firstName','lastName','password','phone','address','profilePicture','dateOfBirth','gender','timezone','notifications','paymentMethod','qualifications','bio','courses','instapayName'];
    // allow users to edit their spoken languages
    selfEditable.push('spokenLanguages');
    // Fields that are strictly teacher-only and must not be editable when editing a guardian
    const teacherOnlyFields = ['bio', 'instapayName', 'qualifications', 'courses', 'availabilityConfig'];

    // If the field is teacher-only but the current form's role is not teacher, disallow editing
    if (teacherOnlyFields.includes(field) && form && form.role !== 'teacher') return false;
    if (adminOnly.includes(field)) return isAdmin;
    // bankDetails removed from the edit modal; fall through to default rules
    if (selfEditable.includes(field)) return isSelf || isAdmin;
    // default: only admin
    return isAdmin;
  };

  const setField = (path, value) => {
    const parts = path.split('.');
    const next = { ...form };
    let cur = next;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      cur[p] = cur[p] ? { ...cur[p] } : {};
      cur = cur[p];
    }
    cur[parts[parts.length-1]] = value;
    setForm(next);
  };

  // Small country select (searchable-lite)
  const CountrySelect = ({ value, onChange }) => {
    // Hidden until user types: keep a separate input state so existing value is shown but dropdown only appears while typing
    const countries = [
      'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Aruba','Australia','Austria','Azerbaijan',
      'Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi',
      'Cabo Verde','Cambodia','Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica','Côte d\'Ivoire','Croatia','Cuba','Cyprus','Czech Republic',
      'Democratic Republic of the Congo','Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia',
      'Fiji','Finland','France','Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti','Honduras','Hungary',
      'Iceland','India','Indonesia','Iran','Iraq','Ireland','Palestine','Italy','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kosovo','Kuwait','Kyrgyzstan',
      'Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar',
      'Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Macedonia','Norway','Oman','Pakistan','Palau','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda',
      'Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria',
      'Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe','Other'
    ];
    const [inputValue, setInputValue] = useState(value || '');
    const [filter, setFilter] = useState('');
    useEffect(() => { setInputValue(value || ''); }, [value]);
    const filtered = countries.filter(c => c.toLowerCase().includes(filter.toLowerCase()));
    const showList = filter.trim().length > 0;
    const [highlight, setHighlight] = useState(-1);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);

    useEffect(() => { setHighlight(filtered.length ? 0 : -1); }, [filter]);
    useEffect(() => {
      if (highlight >= 0 && listRef.current) {
        const nodes = listRef.current.querySelectorAll('div');
        const el = nodes[highlight];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      }
    }, [highlight]);

    const handleKeyDown = (e) => {
      if (!showList) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(filtered.length - 1, (h < 0 ? 0 : h + 1))); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h <= 0 ? 0 : h - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (highlight >= 0 && filtered[highlight]) { const sel = filtered[highlight]; onChange(sel); setInputValue(sel); setFilter(''); } }
      else if (e.key === 'Escape') { setFilter(''); }
    };

    return (
      <div className="relative">
        <input ref={inputRef} className="w-full border rounded px-2 py-1 mb-2" placeholder="Start typing country..." value={inputValue} onChange={(e)=>{ setInputValue(e.target.value); setFilter(e.target.value); }} onKeyDown={handleKeyDown} onBlur={() => setTimeout(() => { const v = inputValue?.trim(); if (v) { onChange(v); setFilter(''); } else { setFilter(''); } }, 150)} />
        {showList && (
          <div ref={listRef} className="absolute left-0 right-0 top-full mt-1 bg-white border rounded shadow max-h-40 overflow-auto z-50">
            {filtered.map((c,i) => (
              <div key={i} className={`p-2 cursor-pointer ${i === highlight ? 'bg-gray-100' : (c===value? 'bg-gray-50':'')}`} onMouseDown={(e)=>{ e.preventDefault(); onChange(c); setInputValue(c); setFilter(''); }}>{c}</div>
            ))}
            {filtered.length === 0 && <div className="p-2 text-sm text-gray-500">No results</div>}
          </div>
        )}
      </div>
    );
  };

  // Courses multiselect: choose from subjects list
  const CoursesSelect = ({ value = [], onChange }) => {
    const [input, setInput] = useState('');
    const [filtered, setFiltered] = useState([]);

    useEffect(() => {
      const f = input.trim().length > 0 ? subjects.filter(s => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s)) : [];
      setFiltered(f.slice(0, 30));
    }, [input, value]);

    const add = (s) => { onChange([...(value||[]), s]); setInput(''); };
    const remove = (s) => { onChange((value||[]).filter(x => x !== s)); };

    const [highlight, setHighlight] = useState(-1);
    const listRef = React.useRef(null);

    useEffect(() => { setHighlight(filtered.length ? 0 : -1); }, [filtered]);
    useEffect(() => {
      if (highlight >= 0 && listRef.current) {
        const nodes = listRef.current.querySelectorAll('div');
        const el = nodes[highlight];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      }
    }, [highlight]);

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(filtered.length - 1, (h < 0 ? 0 : h + 1))); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(0, h <= 0 ? 0 : h - 1)); }
      else if (e.key === 'Enter') { e.preventDefault(); if (highlight >= 0 && filtered[highlight]) { add(filtered[highlight]); } }
      else if (e.key === 'Escape') { setInput(''); }
    };

    return (
      <div>
        <div className="flex flex-wrap gap-2 mb-2">
          {(value||[]).map((s,i) => (
            <div key={i} className="px-2 py-1 bg-gray-100 rounded-full text-sm flex items-center gap-2">
              <span>{s}</span>
              <button type="button" onClick={() => remove(s)} className="text-xs text-red-600">×</button>
            </div>
          ))}
        </div>
        <div className="relative">
          <input value={input} onChange={(e)=>setInput(e.target.value)} placeholder="Add course (type to search)..." className="w-full border rounded px-2 py-1" onKeyDown={handleKeyDown} onBlur={() => setTimeout(() => setInput(''), 150)} />
          {input.trim().length > 0 && (
            <div ref={listRef} className="absolute left-0 right-0 top-full mt-1 bg-white border rounded shadow max-h-40 overflow-auto z-50">
              {filtered.map((s,i) => (
                <div key={i} className={`p-2 cursor-pointer ${i === highlight ? 'bg-gray-100' : ''}`} onMouseDown={(e)=>{ e.preventDefault(); add(s); }}>{s}</div>
              ))}
              {filtered.length === 0 && <div className="p-2 text-sm text-gray-500">No matches</div>}
            </div>
          )}
        </div>
      </div>
    );
  };

    // Using shared SpokenLanguagesSelect from ui

  const handleSave = async () => {
    if (!form || !targetUser) return;
    setLoading(true);
    try {
      // Build payload with only editable keys
      const payload = {};
      // Top-level simple fields (excluding bio which is role-specific)
  ['firstName','lastName','phone','dateOfBirth','gender','timezone','paymentMethod','monthlyHours'].forEach(k => {
        if (form[k] !== undefined && canEdit(k)) {
          let value = form[k];
          // Convert dateOfBirth to proper format if it's a date
          if (k === 'dateOfBirth' && value) {
            // If it's already in yyyy-MM-dd format, keep it as is
            if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
              payload[k] = value;
            } else {
              // Convert to yyyy-MM-dd format
              const date = new Date(value);
              if (!isNaN(date.getTime())) {
                payload[k] = date.toISOString().split('T')[0];
              }
            }
          } else {
            payload[k] = value;
          }
        }
      });

      // If the paymentMethod select was left as the placeholder (empty), don't overwrite DB value
      if (payload.paymentMethod === '') delete payload.paymentMethod;

      // Handle bio field - it's nested under teacherInfo for teachers
      // Guardian bio was intentionally removed from the system; only teachers have bios now
      if (form.bio !== undefined && canEdit('bio')) {
        if (form.role === 'teacher') {
          if (!payload.teacherInfo) payload.teacherInfo = {};
          payload.teacherInfo.bio = form.bio;
        }
      }
      
      // Email (admin only)
      if (form.email !== undefined && canEdit('email')) payload.email = form.email;
      
  // Password (only if user entered a new password)
  if (passwordInput && passwordInput.trim() && canEdit('password')) payload.password = passwordInput;
      
      // address
      if (form.address && canEdit('address')) payload.address = form.address;
      // notifications
      if (form.notifications && canEdit('notifications')) payload.notifications = form.notifications;
      // Handle other role-specific fields
      // bankDetails removed from payload building

      // Instapay name (teachers only)
      if (form.instapayName !== undefined && canEdit('instapayName')) {
        if (form.role === 'teacher') {
          if (!payload.teacherInfo) payload.teacherInfo = {};
          payload.teacherInfo.instapayName = form.instapayName;
        }
      }
      
      // qualifications (teachers only)
      if (form.qualifications && canEdit('qualifications') && form.role === 'teacher') {
        if (!payload.teacherInfo) payload.teacherInfo = {};
        payload.teacherInfo.qualifications = form.qualifications;
      }
      
      // courses/subjects (teachers only)
      if (form.courses && canEdit('courses') && form.role === 'teacher') {
        if (!payload.teacherInfo) payload.teacherInfo = {};
        payload.teacherInfo.subjects = form.courses; // Map courses to subjects in schema
      }

      // availabilityConfig (teachers only)
      if (form.availabilityConfig && canEdit('availabilityConfig') && form.role === 'teacher') {
        if (!payload.teacherInfo) payload.teacherInfo = {};
        payload.teacherInfo.availabilityConfig = {
          ...form.availabilityConfig,
          lastUpdated: new Date()
        };
      }

      // spokenLanguages for teacher or guardian
      if (form.spokenLanguages && canEdit('spokenLanguages')) {
        if (form.role === 'teacher') {
          if (!payload.teacherInfo) payload.teacherInfo = {};
          payload.teacherInfo.spokenLanguages = form.spokenLanguages;
        } else if (form.role === 'guardian') {
          if (!payload.guardianInfo) payload.guardianInfo = {};
          payload.guardianInfo.spokenLanguages = form.spokenLanguages;
        } else {
          // fallback to top-level if role is something else
          payload.spokenLanguages = form.spokenLanguages;
        }
      }
      
      // Admin-only fields
      if (isAdmin) {
        if (form.role !== undefined) payload.role = form.role;
        if (form.isActive !== undefined) payload.isActive = form.isActive;
        if (form.isEmailVerified !== undefined) payload.isEmailVerified = form.isEmailVerified;
        if (form.totalHours !== undefined) payload.totalHours = form.totalHours;
        if (form.lastLogin !== undefined) payload.lastLogin = form.lastLogin;
        if (form.loginAttempts !== undefined) payload.loginAttempts = form.loginAttempts;
        if (form.lockUntil !== undefined) {
          // Handle datetime-local format for lockUntil
          if (form.lockUntil) {
            // If it's a datetime-local string (YYYY-MM-DDTHH:mm), convert to ISO string
            if (typeof form.lockUntil === 'string' && form.lockUntil.includes('T') && form.lockUntil.length === 16) {
              payload.lockUntil = new Date(form.lockUntil).toISOString();
            } else {
              payload.lockUntil = form.lockUntil;
            }
          } else {
            payload.lockUntil = null;
          }
        }
      }

      if (form.role === 'guardian') {
        const guardianPayload = { ...(payload.guardianInfo || {}) };

        if (isAdmin && form.guardianInfo) {
          if (form.guardianInfo.hourlyRate !== undefined && form.guardianInfo.hourlyRate !== '') {
            const hrValue = Number(form.guardianInfo.hourlyRate);
            if (Number.isFinite(hrValue)) {
              guardianPayload.hourlyRate = hrValue;
            }
          }

          if (form.guardianInfo.transferFee) {
            const feeMode = typeof form.guardianInfo.transferFee.mode === 'string'
              ? form.guardianInfo.transferFee.mode.toLowerCase()
              : 'fixed';
            const allowedModes = ['fixed', 'percent'];
            const normalizedMode = allowedModes.includes(feeMode) ? feeMode : 'fixed';
            const feeValue = Number(form.guardianInfo.transferFee.value);
            guardianPayload.transferFee = {
              mode: normalizedMode,
              value: Number.isFinite(feeValue) ? feeValue : 5
            };
          }
        }

        if (Object.keys(guardianPayload).length) {
          payload.guardianInfo = guardianPayload;
        }
      }

  await api.put(`/users/${targetUser._id}`, payload);
      if (onSaved) onSaved();
      onClose && onClose();
      try { alert('Profile saved successfully'); } catch (e) {}
    } catch (e) {
      console.error('Failed saving profile', e);
      try { alert('Failed saving profile: ' + (e.response?.data?.message || e.message || 'Unknown error')); } catch (err) {}
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black bg-opacity-40" onClick={() => onClose && onClose()} />
      <div className="relative bg-white rounded-lg shadow-lg w-full max-w-5xl p-6 z-50 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Edit Profile</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => onClose && onClose()} className="text-gray-500">Close</button>
          </div>
        </div>

        <div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Avatar column */}
            <div className="flex flex-col items-center md:items-start md:justify-start">
              <div className="w-full max-w-[160px] h-[160px] bg-gray-100 rounded-full overflow-hidden border shadow-sm">
                {preview ? (
                  <img src={preview} alt="preview" className="h-full w-full object-cover" />
                ) : form.profilePicture ? (
                  <img src={form.profilePicture} alt="avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-gray-400">No image</div>
                )}
              </div>

              <div className="mt-3 w-full flex flex-col items-stretch gap-2">
                <input type="file" accept="image/*" onChange={(e) => handleFile(e.target.files[0])} className="text-sm w-full" disabled={isUploading} />
                <div className="text-xs text-gray-500">{isUploading ? 'Saving image...' : (uploadFile ? 'Preparing image — will save automatically' : 'Select an image to crop and it will auto-save')}</div>
                <button onClick={deletePicture} className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm w-full md:w-auto">Remove</button>
              </div>

              {preview && (
                <div className="mt-4 w-full">
                  <div className="relative h-48 bg-gray-200 rounded overflow-hidden">
                    <Cropper image={preview} crop={crop} zoom={zoom} aspect={1} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
                  </div>
                  <div className="flex items-center gap-3 mt-2">
                    <label className="text-sm">Zoom</label>
                    <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" />
                  </div>
                </div>
              )}
            </div>

            {/* Main form area */}
            <div className="md:col-span-3">
              <h4 className="font-semibold mb-2">Personal Information</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">First Name</label>
                  <input className="w-full min-w-0 border rounded px-2 py-1" value={form.firstName||''} onChange={(e)=>setField('firstName', e.target.value)} disabled={!canEdit('firstName')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Last Name</label>
                  <input className="w-full min-w-0 border rounded px-2 py-1" value={form.lastName||''} onChange={(e)=>setField('lastName', e.target.value)} disabled={!canEdit('lastName')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Email</label>
                  <input className="w-full min-w-0 border rounded px-2 py-1" value={form.email||''} onChange={(e)=>setField('email', e.target.value)} disabled={!canEdit('email')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Phone</label>
                  <input className="w-full min-w-0 border rounded px-2 py-1" value={form.phone||''} onChange={(e)=>setField('phone', e.target.value)} disabled={!canEdit('phone')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Date of Birth</label>
                  <input type="date" className="w-full min-w-0 border rounded px-2 py-1" value={form.dateOfBirth ? (form.dateOfBirth.includes('T') ? new Date(form.dateOfBirth).toISOString().split('T')[0] : form.dateOfBirth) : ''} onChange={(e)=>setField('dateOfBirth', e.target.value)} disabled={!canEdit('dateOfBirth')} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Gender</label>
                  <select className="w-full min-w-0 border rounded px-2 py-1" value={form.gender||'male'} onChange={(e)=>setField('gender', e.target.value)} disabled={!canEdit('gender')}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>
                <div className="md:col-span-2 flex gap-4 items-start">
                  <div className="flex-1 min-w-0">
                    <label className="block text-sm font-medium text-gray-700">Timezone</label>
                    <div>
                      <TimezoneSelector value={form.timezone||''} onChange={(tz)=>setField('timezone', tz)} disabled={!canEdit('timezone')} />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <label className="block text-sm font-medium text-gray-700">Spoken Languages</label>
                    <SpokenLanguagesSelect value={form.spokenLanguages || []} onChange={(arr) => setField('spokenLanguages', arr)} />
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">Password</label>
                  <input name="new-password" autoComplete="new-password" type="password" className="w-full min-w-0 border rounded px-2 py-1" value={passwordInput} onChange={(e)=>setPasswordInput(e.target.value)} disabled={!canEdit('password')} placeholder="Leave blank to keep current" />
                </div>
              </div>

              <div className="border-t border-gray-200 my-6" />

              {/* Address */}
              <div className="mt-4">
                <h4 className="font-semibold mb-2">Address</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700">Street</label>
                    <input className="w-full min-w-0 border rounded px-2 py-1" value={form.address?.street||''} onChange={(e)=>setField('address.street', e.target.value)} disabled={!canEdit('address')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">City</label>
                    <input className="w-full min-w-0 border rounded px-2 py-1" value={form.address?.city||''} onChange={(e)=>setField('address.city', e.target.value)} disabled={!canEdit('address')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">State</label>
                    <input className="w-full min-w-0 border rounded px-2 py-1" value={form.address?.state||''} onChange={(e)=>setField('address.state', e.target.value)} disabled={!canEdit('address')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Zip Code</label>
                    <input className="w-full min-w-0 border rounded px-2 py-1" value={form.address?.zipCode||''} onChange={(e)=>setField('address.zipCode', e.target.value)} disabled={!canEdit('address')} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Country</label>
                    <CountrySelect value={form.address?.country||''} onChange={(v)=>setField('address.country', v)} />
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-200 my-6" />

              {/* Financial */}
              <div className="mt-4">
                <h4 className="font-semibold mb-2">Financial</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(form.role === 'guardian') && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Payment Method</label>
                      <select className="w-full min-w-0 border rounded px-2 py-1" value={form.paymentMethod ?? form.guardianInfo?.paymentMethod ?? (form.role === 'guardian' ? 'paypal' : '')} onChange={(e)=>setField('paymentMethod', e.target.value)}>
                        <option value="">(leave as saved)</option>
                        <option value="paypal">PayPal</option>
                        <option value="bank">Bank account</option>
                        <option value="wise">Wise Transfer</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Hourly Rate (guardian)</label>
                      <input type="number" className="w-full min-w-0 border rounded px-2 py-1" value={form.guardianInfo?.hourlyRate ?? ''} onChange={(e)=>setField('guardianInfo.hourlyRate', e.target.value ? Number(e.target.value) : '')} disabled={!isAdmin} min="0" step="0.25" />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Instapay Name</label>
                      <input className="w-full min-w-0 border rounded px-2 py-1" value={form.instapayName||''} onChange={(e)=>setField('instapayName', e.target.value)} disabled={!canEdit('instapayName')} />
                    </div>

                    <div />
                  </>
                )}
                  

                  
                </div>
              </div>

              <div className="border-t border-gray-200 my-6" />

              {/* Educational (teacher-only) */}
              {form.role === 'teacher' && (
                <div className="mt-4">
                  {/* Ensure teacher can edit Instapay Name here (visible to teacher + admins) */}
                  {(form.role === 'teacher' || isAdmin) && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700">Instapay Name</label>
                      <input className="w-full min-w-0 border rounded px-2 py-1" value={form.instapayName||''} onChange={(e)=>setField('instapayName', e.target.value)} disabled={!canEdit('instapayName')} />
                    </div>
                  )}
                  <h4 className="font-semibold mb-2">Educational</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700">Bio</label>
                      <textarea className="w-full min-w-0 border rounded px-2 py-1" value={form.bio||''} onChange={(e)=>setField('bio', e.target.value)} disabled={!canEdit('bio')} />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Qualifications</label>
                      <QualificationsEditor qualifications={form.qualifications || []} readOnly={!canEdit('qualifications')} onChange={(q) => setField('qualifications', q)} />
                    </div>
                    <div className="md:col-span-2">
                      <h5 className="font-medium mt-2">Subjects you can teach</h5>
                      <CoursesSelect value={form.courses || []} onChange={(arr) => setField('courses', arr)} />
                    </div>
                    <div className="md:col-span-2">
                      {/* Full Availability Requirements Configuration */}
                      <TeacherAvailabilityConfig 
                        teacher={form} 
                        value={form.availabilityConfig}
                        onChange={(config) => setField('availabilityConfig', config)}
                        isAdminView={isAdmin}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-200 my-6" />

              {/* System / Admin */}
              {isAdmin && (
                <div className="mt-4">
                  <div className="border-t border-gray-200 my-6" />
                  <h4 className="font-semibold mb-2">System</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Role</label>
                      <select className="w-full min-w-0 border rounded px-2 py-1" value={form.role||'guardian'} onChange={(e)=>setField('role', e.target.value)}>
                        <option value="admin">Admin</option>
                        <option value="teacher">Teacher</option>
                        <option value="guardian">Guardian</option>
                        <option value="student">Student</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Last Login</label>
                      <input className="w-full min-w-0 border rounded px-2 py-1 bg-gray-50" value={form.lastLogin||''} onChange={(e)=>setField('lastLogin', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Login Attempts</label>
                      <input className="w-full min-w-0 border rounded px-2 py-1 bg-gray-50" value={form.loginAttempts||0} onChange={(e)=>setField('loginAttempts', e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Lock Until</label>
                      <input type="datetime-local" className="w-full min-w-0 border rounded px-2 py-1" value={form.lockUntil ? new Date(form.lockUntil).toISOString().slice(0,16) : ''} onChange={(e)=>setField('lockUntil', e.target.value)} />
                    </div>

                    <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Transfer Fee Type</label>
                        <select className="w-full min-w-0 border rounded px-2 py-1" value={form.guardianInfo?.transferFee?.mode || 'fixed'} onChange={(e)=>setField('guardianInfo.transferFee.mode', e.target.value)}>
                          <option value="fixed">Fixed amount</option>
                          <option value="percent">Percentage</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Transfer Fee Value</label>
                        <input type="number" className="w-full min-w-0 border rounded px-2 py-1" value={form.guardianInfo?.transferFee?.value ?? ''} onChange={(e)=>setField('guardianInfo.transferFee.value', e.target.value ? Number(e.target.value) : '')} min="0" step="0.25" />
                      </div>
                    </div>
                    
                  </div>
                      <div className="flex items-center gap-2">
                      <label className="text-sm font-medium text-gray-700">Active</label>
                      <input type="checkbox" checked={!!form.isActive} onChange={(e)=>setField('isActive', e.target.checked)} />
                      <label className="text-sm font-medium text-gray-700">Email Verified</label>
                      <input type="checkbox" checked={!!form.isEmailVerified} onChange={(e) => setField('isEmailVerified', e.target.checked)} />
                    
                      <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.notifications?.email} onChange={(e)=>setField('notifications',{...(form.notifications||{}), email: e.target.checked})} disabled={!canEdit('notifications')} /> Email</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.notifications?.sms} onChange={(e)=>setField('notifications',{...(form.notifications||{}), sms: e.target.checked})} disabled={!canEdit('notifications')} /> SMS</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={!!form.notifications?.push} onChange={(e)=>setField('notifications',{...(form.notifications||{}), push: e.target.checked})} disabled={!canEdit('notifications')} /> Push</label>
                    </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={() => onClose && onClose()} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={loading} className="btn-submit focus:outline-none focus:ring-2 focus:ring-primary/40">{loading ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
