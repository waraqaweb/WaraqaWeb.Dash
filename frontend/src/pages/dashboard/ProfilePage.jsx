import React, { useEffect, useState, useCallback } from "react";
import { formatDateDDMMMYYYY } from '../../utils/date';
import api from "../../api/axios";
import { useAuth } from "../../contexts/AuthContext";
import { useSearch } from '../../contexts/SearchContext';
import ProfileEditModal from '../../components/dashboard/ProfileEditModal';
import FirstClassFeedbackModal from '../../components/feedback/FirstClassFeedbackModal';
import MonthlyFeedbackModal from '../../components/feedback/MonthlyFeedbackModal';
import Tabs from '../../components/ui/Tabs';
// QualificationsEditor is used in the edit modal; not needed in the profile view
import { formatTimeInTimezone } from '../../utils/timezoneUtils';

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allUsers, setAllUsers] = useState([]);
  
  const [isAdmin, setIsAdmin] = useState(false);
  // use global search context (shared top-level search bar)
  const { searchTerm, globalFilter } = useSearch();
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoModalUser, setInfoModalUser] = useState(null);

  const fetchProfile = useCallback(async () => {
    console.log('fetchProfile called - refreshing user data');
    setLoading(true);
    try {
      // backend exposes current user at /api/auth/me
      const res = await api.get('/auth/me');
      console.log('fetchProfile response:', res.data.user);
      setProfile(res.data.user);
    } catch (err) {
      console.error('Error fetching profile', err);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch all users for admin view
  const fetchAllUsers = useCallback(async () => {
    try {
      const res = await api.get('/users');
      setAllUsers(res.data.users || res.data || []);
    } catch (err) {
      try {
        const res2 = await api.get('/users/admin/all');
        setAllUsers(res2.data.users || res2.data || []);
      } catch (e) {
        console.error('Failed to fetch users for admin', e);
        setAllUsers([]);
      }
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    setIsAdmin(user.role === 'admin');
    fetchProfile();
    if (user.role === 'admin') fetchAllUsers();
  }, [user, fetchProfile, fetchAllUsers]);

  const [editModalUser, setEditModalUser] = useState(null);

  const toggleActive = async (u) => {
    try {
      const newStatus = !u.isActive;
      await api.put(`/users/${u._id}/status`, { isActive: newStatus });
      // Optimistically update UI
      setAllUsers(prev => prev.map(p => p._id === u._id ? { ...p, isActive: newStatus } : p));
    } catch (err) {
      console.error('Error toggling active status', err);
      // On failure refetch list
      fetchAllUsers();
    }
  };

  const openInfoModal = (u) => {
    setInfoModalUser(u);
    setShowInfoModal(true);
  };

  const [activeTab, setActiveTab] = useState('personal');
  const [mainTab, setMainTab] = useState('self');
  const [manageUsersTab, setManageUsersTab] = useState('all');
  const [teacherTotalHours, setTeacherTotalHours] = useState(null);
  const [guardianTotalFromStudents, setGuardianTotalFromStudents] = useState(null);
  const [guardianCumulativeFromStudents, setGuardianCumulativeFromStudents] = useState(null);

  // If the current profile is a teacher, fetch dashboard stats to surface total hours
  useEffect(() => {
    let mounted = true;
    const loadTeacherHours = async () => {
      try {
        if (profile?.role === 'teacher') {
          const res = await api.get('/dashboard/stats');
          const stats = res.data?.stats || {};
          // prefer hoursThisMonth, fallback to completedHoursThisMonth
          const hrs = stats.hoursThisMonth ?? stats.completedHoursThisMonth ?? null;
          if (mounted) setTeacherTotalHours(hrs);
        } else {
          if (mounted) setTeacherTotalHours(null);
        }
      } catch (e) {
        if (mounted) setTeacherTotalHours(null);
      }
    };
    loadTeacherHours();
    // If viewing a guardian profile, fetch authoritative students total (includes standalone students)
        const loadGuardianStudentsTotal = async () => {
      try {
        if (profile?.role === 'guardian') {
          const res = await api.get(`/users/${profile._id}/students`);
          // endpoint returns { students, totalHours }
              if (mounted) {
                setGuardianTotalFromStudents(typeof res.data.totalHours === 'number' ? res.data.totalHours : null);
                setGuardianCumulativeFromStudents(typeof res.data.cumulativeConsumedHours === 'number' ? res.data.cumulativeConsumedHours : null);
              }
        } else {
          if (mounted) setGuardianTotalFromStudents(null);
        }
      } catch (e) {
        if (mounted) setGuardianTotalFromStudents(null);
      }
    };
    loadGuardianStudentsTotal();
    return () => { mounted = false; };
  }, [profile]);
  // Legacy editor modal removed; use ProfileEditModal for editing
  const [showChangePwd, setShowChangePwd] = useState(false);

  // Dev preview state for feedback modals
  const [previewFirstOpen, setPreviewFirstOpen] = useState(false);
  const [previewMonthlyOpen, setPreviewMonthlyOpen] = useState(false);

  // Onboarding/local tooltip state needs to be a stable hook (always declared)
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [visibleTooltips, setVisibleTooltips] = useState({});

  // Load onboarding state from localStorage when profile becomes available
  useEffect(() => {
    if (!profile) return;
    const onboardingKey = `onboardingDismissed_v1_${profile._id || 'anon'}`;
    try { setOnboardingDismissed(JSON.parse(localStorage.getItem(onboardingKey)) === true); } catch (e) { setOnboardingDismissed(false); }
    const tooltipKey = `onboarding_tooltip_v1_${profile._id || 'anon'}`;
    try { setVisibleTooltips(JSON.parse(localStorage.getItem(tooltipKey) || '{}')); } catch (e) { setVisibleTooltips({}); }
  }, [profile]);

  if (loading) return <div className="p-4">Loading...</div>;
  if (!profile) return <div className="p-4">Failed to load profile</div>;

  // Onboarding: determine missing important fields
  const missingFields = [];
  if (!profile.phone) missingFields.push({ key: 'phone', label: 'Phone number', tab: 'contact' });
  if (!profile.timezone) missingFields.push({ key: 'timezone', label: 'Timezone', tab: 'contact' });
  if (!profile.dateOfBirth) missingFields.push({ key: 'dateOfBirth', label: 'Date of birth', tab: 'personal' });
  if (!profile.gender) missingFields.push({ key: 'gender', label: 'Gender', tab: 'personal' });
  if (!profile.profilePicture) missingFields.push({ key: 'profilePicture', label: 'Profile photo', tab: 'personal' });

  // Actually compute progress more simply
  const requiredKeys = ['phone','timezone','dateOfBirth','gender','profilePicture'];
  const completedCount = requiredKeys.reduce((acc,k) => acc + (profile[k] ? 1 : 0), 0);
  const progressPercent = Math.round((completedCount / requiredKeys.length) * 100);

  const markTooltipSeen = (field) => {
    const key = `onboarding_tooltip_v1_${profile?._id || 'anon'}`;
    const next = { ...(visibleTooltips || {}), [field]: true };
    setVisibleTooltips(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch (e) {}
  };

  // Helper: determine a friendly payment method label with desired defaults
  const getPaymentMethodDisplay = (role, profileObj) => {
    if (!profileObj) return '';
    let pm = null;
    if (role === 'teacher') {
      pm = profileObj.teacherInfo?.paymentMethod ?? profileObj.paymentMethod ?? null;
    } else if (role === 'guardian') {
      pm = profileObj.guardianInfo?.paymentMethod ?? profileObj.paymentMethod ?? null;
    } else {
      pm = profileObj.paymentMethod ?? null;
    }

    // If no explicit method, apply requested defaults: teachers -> instapay, guardians -> paypal
    if (!pm) {
      if (role === 'teacher') {
        pm = profileObj.teacherInfo?.instapayName ? 'instapay' : 'paypal';
      } else if (role === 'guardian') {
        pm = 'paypal';
      } else {
        pm = 'paypal';
      }
    }

    // Normalize some incoming shorthand values
    if (pm === 'card') pm = 'credit_card';

    // If backend defaulted to 'credit_card' but UX requires different defaults, override here
    if (pm === 'credit_card') {
      pm = role === 'teacher' ? 'instapay' : 'paypal';
    }

    const labels = {
      paypal: 'PayPal',
      instapay: 'Instapay',
      credit_card: 'Credit Card',
      bank_transfer: 'Bank Transfer',
      wise: 'Wise Transfer'
    };

    return labels[pm] || (typeof pm === 'string' ? pm.charAt(0).toUpperCase() + pm.slice(1) : '');
  };

  const getHourlyRateDisplay = (role, profileObj) => {
    if (!profileObj) return 'Not set';
    let rate = null;
    if (role === 'teacher') {
      // we intentionally hide teacher hourly rate on profile; return empty string to keep UI clean
      return '';
    } else if (role === 'guardian') {
      rate = profileObj.guardianInfo?.hourlyRate ?? profileObj.guardianInfo?.rate ?? profileObj.hourlyRate ?? profileObj.rate ?? null;
    } else {
      rate = profileObj.hourlyRate ?? profileObj.rate ?? null;
    }
    if (rate === undefined || rate === null || rate === '') return 'Not set';
    // ensure numeric formatting when possible
    if (typeof rate === 'number') return rate;
    const n = Number(rate);
    return Number.isFinite(n) ? n : String(rate);
  };

  const sendOnboardingEvent = async (eventType, payload = {}) => {
    try {
      await api.post('/onboarding/event', { eventType, payload });
    } catch (e) {
      // ignore failures
      console.warn('Analytics event failed', e.message || e);
    }
  };

  const dismissOnboarding = () => {
    const key = `onboardingDismissed_v1_${profile?._id || 'anon'}`;
    try { localStorage.setItem(key, JSON.stringify(true)); } catch (e) {}
    setOnboardingDismissed(true);
  };

  const InputField = ({ label, value, onChange, disabled, fieldKey, tooltip }) => {
    const [showLocalTip, setShowLocalTip] = useState(false);
    const handleShowTip = () => {
      if (fieldKey) {
        try { markTooltipSeen(fieldKey); } catch (e) {}
        try { sendOnboardingEvent('tooltip_clicked', { field: fieldKey }); } catch (e) {}
      }
      setShowLocalTip(true);
      setTimeout(() => setShowLocalTip(false), 3000);
    };

    return (
      <div className="flex flex-col mb-3 w-full relative">
        <label className="text-base font-semibold text-gray-700 mb-1 flex items-center justify-between">
          <span>{label}</span>
          {tooltip && fieldKey && !visibleTooltips?.[fieldKey] && (
            <button type="button" onClick={handleShowTip} className="text-sm text-blue-600 underline">What is this?</button>
          )}
        </label>
        <input
          className="border rounded-md px-3 py-2 text-base focus:ring-2 focus:ring-[var(--ring)] disabled:bg-gray-100"
          value={(value !== undefined && value !== null) ? value : ""}
          onChange={(e) => onChange && onChange(e.target.value)}
          disabled={disabled}
        />
        {showLocalTip && tooltip && (
          <div className="absolute right-0 top-full mt-2 bg-white border rounded p-2 text-xs shadow z-50 w-64">
            {tooltip}
          </div>
        )}
      </div>
    );
  };

  // Small Toggle switch component (local, avoids adding extra files)
  const ToggleSwitch = ({ checked, onChange, disabled, label }) => (
    <div className="flex items-center justify-between mb-3">
      {label && <div className="text-sm font-semibold text-gray-700 mr-3">{label}</div>}
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        disabled={disabled}
        onClick={() => !disabled && onChange && onChange(!checked)}
        className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors focus:outline-none ${checked ? 'bg-custom-teal' : 'bg-gray-300'} ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`transform transition-transform inline-block w-4 h-4 bg-white rounded-full ml-1 ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );

  return (
    <div className="p-4 min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto">
        {/* Onboarding helper banner for new users */}
        {!onboardingDismissed && missingFields.length > 0 && (
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded mb-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-yellow-800">Complete your profile</div>
                    <div className="text-sm text-yellow-700">We noticed some missing information — completing your profile helps us personalize your experience.</div>
                  </div>
                  <div className="text-sm text-yellow-800">{completedCount} of {requiredKeys.length} complete</div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-yellow-100 rounded mt-3 h-2 overflow-hidden">
                  <div className="bg-yellow-500 h-2" style={{ width: `${progressPercent}%` }} />
                </div>

                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {['phone','timezone','dateOfBirth','gender','profilePicture'].map((k) => {
                    const mf = missingFields.find(m => m.key === k);
                    return mf ? (
                      <button key={k} onClick={() => { setActiveTab(mf.tab); sendOnboardingEvent('tip_clicked', { field: k }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded text-sm">Add {mf.label}</button>
                    ) : (
                      <div key={k} className="px-3 py-1 bg-green-50 text-green-800 rounded text-sm">{k} ✓</div>
                    );
                  })}
                </div>
              </div>
              <div className="ml-4 flex-shrink-0 flex flex-col items-end gap-2">
                <button onClick={async () => { try { await api.post('/onboarding/dismiss'); } catch(e){} dismissOnboarding(); }} className="text-sm text-yellow-800 underline">Dismiss</button>
                <button onClick={() => sendOnboardingEvent('banner_shown', { missing: missingFields.map(m => m.key) })} className="text-sm text-yellow-700">Help</button>
              </div>
            </div>
          </div>
        )}

        {/* Completion modal when profile becomes complete */}
        {completedCount === requiredKeys.length && !onboardingDismissed && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black bg-opacity-40" onClick={() => dismissOnboarding()} />
            <div className="relative bg-white rounded-lg shadow-lg w-full max-w-md p-6 z-50">
              <h3 className="text-lg font-semibold mb-2">Profile complete</h3>
              <p className="text-sm text-gray-700 mb-4">Great job! Your profile is now complete and ready to use. You'll get the best experience with a completed profile.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => { dismissOnboarding(); sendOnboardingEvent('completed_modal_ok'); }} className="px-4 py-2 bg-primary text-white rounded">Done</button>
              </div>
            </div>
          </div>
        )}
        {/* Admin top-level tabs (admins see Profile + Manage Users) */}
        {isAdmin && (
          <div className="mb-4">
            <Tabs
              tabs={[{ key: 'self', label: 'My Profile' }, { key: 'manage', label: 'Manage Users' }]}
              active={mainTab}
              onChange={setMainTab}
            />
          </div>
        )}

        {/* Profile Card (hidden when admin selects Manage Users) */}
        <div className={`bg-white shadow rounded-lg p-4 border ${isAdmin && mainTab === 'manage' ? 'hidden' : ''}`}>
          <div className="flex items-center justify-between">
            <div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                  <div onClick={() => setEditModalUser(profile)} title="Edit profile" className="h-12 w-12 rounded-full overflow-hidden bg-gray-100 border cursor-pointer">
                    {profile.profilePicture ? (
                      <img src={profile.profilePicture} alt="avatar" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-gray-400">👤</div>
                    )}
                  </div>
                  {!visibleTooltips?.profilePicture && (
                    <button type="button" onClick={() => { markTooltipSeen('profilePicture'); sendOnboardingEvent('tooltip_clicked', { field: 'profilePicture' }); setEditModalUser(profile); }} className="absolute -right-1 -bottom-1 bg-white border rounded-full p-1 text-xs">?</button>
                  )}
                  
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-gray-800">My Profile</h2>
                  <p className="text-base text-gray-600 mt-0">Manage your personal information and account settings</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setEditModalUser(profile)} className="text-sm px-3 py-2 bg-gray-100 text-gray-800 border border-gray-200 rounded">Edit</button>
              <button onClick={() => setShowChangePwd(true)} className="text-sm px-3 py-2 bg-gray-100 text-gray-800 border border-gray-200 rounded">Password</button>
              {/* Preview triggers for feedback modals (dev/testing) */}
              <button onClick={() => setPreviewMonthlyOpen(true)} className="text-sm px-3 py-2 bg-purple-50 text-purple-700 border border-purple-100 rounded">Share your feedback </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-6">
                <Tabs
              tabs={[
                { key: 'personal', label: 'Personal Info' },
                { key: 'contact', label: 'Contact Info' },
                { key: 'system', label: 'System Data' },
                { key: 'financial', label: 'Financial Info' },
              ]}
              active={activeTab}
              onChange={setActiveTab}
              className="border-b pb-2"
            />

            <div className="bg-white border p-4">
              {activeTab === 'personal' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <InputField label="Full Name" value={profile.fullName} disabled />
                  <InputField label="Role" value={profile.role} disabled />
                  <InputField label="Date of Birth" value={
                    (profile.dateOfBirth ? formatDateDDMMMYYYY(profile.dateOfBirth) : '') ||
                    (profile.teacherInfo?.dateOfBirth ? formatDateDDMMMYYYY(profile.teacherInfo.dateOfBirth) : '') ||
                    (profile.guardianInfo?.dateOfBirth ? formatDateDDMMMYYYY(profile.guardianInfo.dateOfBirth) : '')
                  } disabled />
                  <div className="flex flex-col mb-2 w-full">
                    <label className="text-base font-semibold text-gray-700 mb-1">Gender</label>
                    <input className="border rounded-md px-3 py-2 text-base bg-gray-50" value={profile.gender || 'Not specified'} disabled />
                  </div>
                  {profile.role === 'teacher' && (
                    <div className="col-span-1 md:col-span-2">
                      <label className="text-base font-semibold text-gray-700 mb-1 block">Bio</label>
                      {console.log('ProfilePage rendering bio: teacherInfo.bio:', profile.teacherInfo?.bio)}
                      <textarea className="w-full border rounded-lg px-3 py-3 text-base bg-gray-50" value={profile.teacherInfo?.bio || ''} disabled />
                    </div>
                  )}
                  <div className="col-span-1 md:col-span-2">
                    <label className="text-base font-semibold text-gray-700 mb-1 block">Spoken Languages</label>
                    <div className="w-full border rounded-lg px-3 py-2 text-base bg-gray-50">
                      {(
                        (profile.role === 'teacher' ? (profile.teacherInfo?.spokenLanguages || profile.spokenLanguages) : (profile.guardianInfo?.spokenLanguages || profile.spokenLanguages)) || []
                      ).join(', ')}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'contact' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <InputField label="Email" value={profile.email} disabled />
                  <InputField label="Phone" value={profile.phone} disabled />
                  <InputField label="Address - Street" value={profile?.address?.street} disabled />
                  <InputField label="City" value={profile?.address?.city} disabled />
                  <InputField label="State" value={profile?.address?.state} disabled />
                  <InputField label="Country" value={profile?.address?.country} disabled />
                  <InputField label="Zip Code" value={profile?.address?.zipCode} disabled />
                  <div className="mb-2">
                    <label className="block text-base font-medium text-gray-700 mb-1">Timezone</label>
                    {/* Show empty when not chosen to encourage selection */}
                    <input className="w-full border rounded-md px-3 py-2 text-base bg-gray-50" value={profile.timezone || ''} disabled />
                    {profile.timezone ? (
                      <div className="mt-1 text-sm text-gray-600">Current time: {formatTimeInTimezone(new Date(), profile.timezone)}</div>
                    ) : (
                      <div className="mt-1 text-sm text-red-600">Please select your timezone</div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'system' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between items-center"><div className="text-base font-semibold text-gray-700">Active</div><ToggleSwitch checked={!!profile.isActive} disabled={true} onChange={() => {}} /></div>
                    <div className="flex justify-between items-center"><div className="text-base font-semibold text-gray-700">Locked</div><ToggleSwitch checked={!!profile.isLocked} disabled={true} onChange={() => {}} /></div>
                    <InputField label="Last Login" value={profile.lastLogin ? new Date(profile.lastLogin).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never'} disabled />
                    <InputField label="Login Attempts" value={profile.loginAttempts} disabled />
                    <div>
                      <h4 className="font-semibold mb-2">Notifications</h4>
                      <div className="grid grid-cols-3 gap-2">
                        <ToggleSwitch label="Email" checked={!!profile?.notifications?.email} disabled={true} onChange={() => {}} />
                        <ToggleSwitch label="SMS" checked={!!profile?.notifications?.sms} disabled={true} onChange={() => {}} />
                        <ToggleSwitch label="Push" checked={!!profile?.notifications?.push} disabled={true} onChange={() => {}} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'financial' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Hourly rate: hide for teachers (we don't show teacher hourly rate on profile); show guardian rate from DB */}
                  {profile.role === 'guardian' && (
                    <InputField label="Hourly Rate" value={getHourlyRateDisplay('guardian', profile)} disabled />
                  )}

                  {/* For other non-teacher, non-guardian roles show top-level rate if present */}
                  {profile.role !== 'teacher' && profile.role !== 'guardian' && (
                    <InputField label="Hourly Rate" value={getHourlyRateDisplay(profile.role, profile)} disabled />
                  )}

                  <InputField label="Total Hours (all students)" value={
                    profile.role === 'teacher' ? (teacherTotalHours ?? profile.teacherInfo?.monthlyHours ?? 0) :
                    profile.role === 'guardian' ? (guardianTotalFromStudents ?? profile.guardianInfo?.totalHours ?? 0) :
                    (profile.monthlyHours ?? 0)
                  } disabled />

                  {profile.role === 'guardian' && (
                    <InputField label="Total Hours Consumed (all-time)" value={
                      guardianCumulativeFromStudents ?? profile.guardianInfo?.cumulativeConsumedHours ?? 0
                    } disabled />
                  )}

                  {profile.role === 'teacher' && (
                    <InputField label="Total Hours (all-time)" value={profile.teacherInfo?.cumulativeHoursAllTime ?? teacherTotalHours ?? profile.teacherInfo?.totalHoursYTD ?? 0} disabled />
                  )}

                  {/* Removed Bonus field for teachers/guardians per request */}

                  {profile.role === 'teacher' && (
                    <>
                      <InputField label="Instapay Name" value={profile.teacherInfo?.instapayName ?? ''} disabled />

                      <InputField label="Payment Method" value={getPaymentMethodDisplay('teacher', profile)} disabled />
                      {/* For guardians/showing in financial area for other roles */}
                    </>
                  )}

                  {/* Payment method for guardians or when not in teacher block */}
                  {profile.role !== 'teacher' && (
                    <InputField label="Payment Method" value={getPaymentMethodDisplay(profile.role, profile)} disabled />
                  )}

                    

                  {profile.role === 'teacher' && profile?.teacherInfo?.qualifications && profile.teacherInfo.qualifications.length > 0 && (
                    <div className="col-span-1 md:col-span-2">
                      <h4 className="font-semibold mb-2">Qualifications</h4>
                      <div className="space-y-2">
                        {profile.teacherInfo.qualifications.map((q, i) => (
                          <div key={i} className="bg-gray-50 border rounded p-2 text-sm">{q.degree} - {q.institution} {q.year ? `(${q.year})` : ''}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {profile.role === 'teacher' && profile?.teacherInfo?.subjects && profile.teacherInfo.subjects.length > 0 && (
                    <div className="col-span-1 md:col-span-2">
                      <h4 className="font-semibold mb-2">Courses</h4>
                      <div className="flex flex-wrap gap-2">
                        {profile.teacherInfo.subjects.map((course, i) => (
                          <div key={i} className="bg-gray-50 border rounded px-2 py-1 text-sm">{course}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
  {/* Legacy ProfileEditorModal removed. Use Edit Profile button which opens ProfileEditModal above. */}
        {/* Change Password Modal */}
        {showChangePwd && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black bg-opacity-40 z-40" onClick={() => setShowChangePwd(false)} />
            <div className="relative bg-white rounded-lg shadow-lg w-full max-w-md p-4 z-50">
              <h3 className="text-lg font-semibold mb-3">Change Password</h3>
              <ChangePasswordForm onClose={() => setShowChangePwd(false)} />
            </div>
          </div>
        )}

        {/* Admin Manage Users: visible when admin selects Manage Users tab */}
        {isAdmin && mainTab === 'manage' && (
          <div className="bg-white shadow rounded-lg p-6 border mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-800">Manage Users</h2>
              {/* small tabs for user types */}
              <div>
                <Tabs
                  tabs={[
                    { key: 'all', label: 'All' },
                    { key: 'teachers', label: 'Teachers' },
                    { key: 'guardians', label: 'Guardians' }
                  ]}
                  active={manageUsersTab}
                  onChange={setManageUsersTab}
                />
              </div>
            </div>

            {/* Using global search bar and filter; local search controls removed */}

            <div className="overflow-x-auto">
              <table className="w-full border">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="text-left p-2 text-base">Name</th>
                    <th className="text-left p-2 text-base">Email</th>
                    <th className="text-left p-2 text-base">Role</th>
                    <th className="text-left p-2 text-base">Status</th>
                    <th className="text-left p-2 text-base">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.filter((u) => {
                    const q = (searchTerm || '').trim().toLowerCase();
                    if (globalFilter === 'active' && !u.isActive) return false;
                    if (globalFilter === 'inactive' && u.isActive) return false;
                    if (manageUsersTab === 'teachers' && u.role !== 'teacher') return false;
                    if (manageUsersTab === 'guardians' && u.role !== 'guardian') return false;
                    if (!q) return true;
                    return (`${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
                  }).map((u) => (
                      <tr key={u._id} className="border-t">
                      <td className="p-2 text-base">{u.firstName} {u.lastName}</td>
                      <td className="p-2 text-base">{u.email}</td>
                      <td className="p-2 text-base">{u.role}</td>
                      <td className="p-2 text-base">{u.isActive ? 'Active' : 'Inactive'}</td>
                      <td className="p-2 flex gap-2">
                        <button onClick={() => { setEditModalUser({ ...u }); }} className="text-sm px-3 py-2 bg-gray-100 text-gray-800 border border-gray-200 rounded">Edit</button>
                        <button onClick={() => toggleActive(u)} className={`text-sm px-3 py-2 rounded ${u.isActive ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{u.isActive ? 'Deactivate' : 'Activate'}</button>
                        <button onClick={() => openInfoModal(u)} className="text-sm px-3 py-2 bg-gray-100 text-gray-800 border border-gray-200 rounded">Info</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Info flying modal */}
            {showInfoModal && infoModalUser && (
              <div className="fixed right-6 top-20 w-96 z-50">
                <div className="bg-white shadow-lg rounded-lg p-4 border">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold">{infoModalUser.firstName} {infoModalUser.lastName}</h4>
                      <div className="text-sm text-gray-600">{infoModalUser.email}</div>
                      <div className="text-sm text-gray-600 mt-2">Role: {infoModalUser.role}</div>
                      <div className="text-sm text-gray-600">Status: {infoModalUser.isActive ? 'Active' : 'Inactive'}</div>
                    </div>
                    <div className="ml-2 flex flex-col gap-2">
                      <button className="text-sm text-gray-500" onClick={() => setShowInfoModal(false)}>Close</button>
                    </div>
                  </div>
                  <div className="mt-3 text-sm">
                    <div><strong>Phone:</strong> {infoModalUser.phone}</div>
                    <div><strong>Timezone:</strong> {infoModalUser.timezone}</div>
                    <div><strong>Created:</strong> {infoModalUser.createdAt}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {/* Unified Profile Edit Modal (self or admin) */}
        {editModalUser && (
          <ProfileEditModal isOpen={!!editModalUser} targetUser={editModalUser} onClose={() => setEditModalUser(null)} onSaved={() => { setEditModalUser(null); fetchProfile(); if (isAdmin) fetchAllUsers(); }} />
        )}

        {/* Preview modals for quick visual testing */}
        {previewFirstOpen && (
          <FirstClassFeedbackModal
            open={previewFirstOpen}
            onClose={() => setPreviewFirstOpen(false)}
            onSubmitted={() => setPreviewFirstOpen(false)}
            prompt={{
              teacher: { _id: profile.teacherInfo?._id || profile._id, firstName: profile.teacherInfo?.firstName || 'Test', lastName: profile.teacherInfo?.lastName || 'Teacher' },
              classId: `preview-fc-${Date.now()}`,
              scheduledDate: new Date()
            }}
          />
        )}

        {previewMonthlyOpen && (
          <MonthlyFeedbackModal
            open={previewMonthlyOpen}
            onClose={() => setPreviewMonthlyOpen(false)}
            onSubmitted={() => setPreviewMonthlyOpen(false)}
            prompt={{
              teacher: { _id: profile.teacherInfo?._id || profile._id, firstName: profile.teacherInfo?.firstName || 'Test', lastName: profile.teacherInfo?.lastName || 'Teacher' },
              classId: `preview-mo-${Date.now()}`,
              scheduledDate: new Date()
            }}
          />
        )}
      </div>
    </div>
  );
}

// Inline Change Password form component
function ChangePasswordForm({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) return setStatus({ type: 'error', message: 'New password must be at least 6 characters' });
    if (newPassword !== confirm) return setStatus({ type: 'error', message: 'Passwords do not match' });
    setLoading(true);
    try {
      const res = await api.put('/auth/change-password', { currentPassword, newPassword });
      setStatus({ type: 'success', message: res.data.message || 'Password changed' });
      setTimeout(() => { setLoading(false); onClose(); }, 1000);
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.message || 'Failed to change password' });
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {status && <div className={`p-2 rounded ${status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{status.message}</div>}
      <input type="password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full px-3 py-2 border rounded" required />
      <input type="password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 border rounded" required />
      <input type="password" placeholder="Confirm new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full px-3 py-2 border rounded" required />
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="btn-secondary mr-2">Cancel</button>
        <button disabled={loading} className="btn-submit">{loading ? 'Saving...' : 'Change Password'}</button>
      </div>
    </form>
  );
}
