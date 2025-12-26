import React from 'react';
import { Clock, AlertCircle, CheckCircle } from 'lucide-react';

const TeacherAvailabilityConfig = ({ teacher, value, onChange, isAdminView = false }) => {
  // Use controlled component pattern - value and onChange from parent
  const config = value || {
    minHoursPerDay: teacher.teacherInfo?.availabilityConfig?.minHoursPerDay ?? 3,
    minDaysPerWeek: teacher.teacherInfo?.availabilityConfig?.minDaysPerWeek ?? 5,
    isAvailabilityRequired: teacher.teacherInfo?.availabilityConfig?.isAvailabilityRequired ?? true
  };

  const handleConfigChange = (updates) => {
    if (onChange) {
      onChange({ ...config, ...updates });
    }
  };

  const getAvailabilityStatus = () => {
    const status = teacher.teacherInfo?.availabilityStatus || 'default_24_7';
    
    switch (status) {
      case 'default_24_7':
        return {
          color: 'text-blue-600 bg-blue-50 border-blue-200',
          icon: <Clock className="w-4 h-4" />,
          text: 'Default 24/7 Availability'
        };
      case 'custom_set':
        return {
          color: 'text-green-600 bg-green-50 border-green-200',
          icon: <CheckCircle className="w-4 h-4" />,
          text: 'Custom Schedule Set'
        };
      case 'pending_setup':
        return {
          color: 'text-yellow-600 bg-yellow-50 border-yellow-200',
          icon: <AlertCircle className="w-4 h-4" />,
          text: 'Setup Pending'
        };
      default:
        return {
          color: 'text-gray-600 bg-gray-50 border-gray-200',
          icon: <Clock className="w-4 h-4" />,
          text: 'Unknown Status'
        };
    }
  };

  const availabilityStatus = getAvailabilityStatus();

  // If not admin view, show read-only information for teachers
  if (!isAdminView) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Availability Requirements (Admin Only)
          </h3>
          
          {/* Current Status */}
          <div className={`px-3 py-1 rounded-full border text-sm font-medium flex items-center gap-2 ${availabilityStatus.color}`}>
            {availabilityStatus.icon}
            {availabilityStatus.text}
          </div>
        </div>

        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <p className="text-sm text-yellow-800">
            <strong>Note:</strong> These settings control the minimum availability requirements for this teacher. 
            The teacher will manage their actual schedule through the Availability Management page.
          </p>
        </div>

        {/* Read-only Requirements Display */}
        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h4 className="font-medium text-gray-900 mb-3">Current Requirements</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum Days per Week
                </label>
                <div className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-100">
                  {config.minDaysPerWeek} day{config.minDaysPerWeek !== 1 ? 's' : ''}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum Hours per Day
                </label>
                <div className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-gray-100">
                  {config.minHoursPerDay} hour{config.minHoursPerDay !== 1 ? 's' : ''}
                </div>
              </div>
            </div>

            {config.isAvailabilityRequired && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-sm text-blue-800">
                  <strong>Requirement:</strong> You must be available for at least{' '}
                  <strong>{config.minDaysPerWeek} day{config.minDaysPerWeek !== 1 ? 's' : ''}</strong> per week 
                  with <strong>{config.minHoursPerDay} hour{config.minHoursPerDay !== 1 ? 's' : ''}</strong> each day.
                </p>
              </div>
            )}

            {!config.isAvailabilityRequired && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm text-green-800">
                  <strong>Status:</strong> No specific availability requirements are currently set for your account.
                </p>
              </div>
            )}
          </div>

          {/* Link to Availability Management */}
          <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
            <h4 className="font-medium text-blue-900 mb-2">Manage Your Schedule</h4>
            <p className="text-sm text-blue-800 mb-3">
              Set your weekly availability schedule and time preferences.
            </p>
            <button
              onClick={() => window.location.href = '/dashboard?page=availability'}
              className="px-4 py-2 bg-custom-teal text-white rounded-lg hover:bg-custom-teal-dark flex items-center gap-2"
            >
              <Clock className="w-4 h-4" />
              Go to Availability Management
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Availability Requirements
        </h3>
        
        {/* Current Status */}
        <div className={`px-3 py-1 rounded-full border text-sm font-medium flex items-center gap-2 ${availabilityStatus.color}`}>
          {availabilityStatus.icon}
          {availabilityStatus.text}
        </div>
      </div>

      <div className="space-y-4">
        {/* Require Custom Availability Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-gray-700">
              Require Custom Availability Setup
            </label>
            <p className="text-xs text-gray-500 mt-1">
              When enabled, teacher must set up their availability schedule
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only"
              checked={config.isAvailabilityRequired}
              onChange={(e) => handleConfigChange({isAvailabilityRequired: e.target.checked})}
            />
            <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer ${
              config.isAvailabilityRequired ? 'bg-custom-teal' : 'bg-gray-200'
            } transition-colors`}>
              <div className={`dot absolute top-[2px] left-[2px] bg-white w-5 h-5 rounded-full transition-transform ${
                config.isAvailabilityRequired ? 'transform translate-x-full' : ''
              }`}></div>
            </div>
          </label>
        </div>

        {/* Requirements Configuration */}
        {config.isAvailabilityRequired && (
          <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
            <h4 className="font-medium text-gray-900 mb-3">Minimum Requirements</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum Days per Week
                </label>
                <select
                  value={config.minDaysPerWeek}
                  onChange={(e) => handleConfigChange({minDaysPerWeek: parseInt(e.target.value)})}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map(days => (
                    <option key={days} value={days}>
                      {days} day{days !== 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Minimum Hours per Day
                </label>
                <select
                  value={config.minHoursPerDay}
                  onChange={(e) => handleConfigChange({minHoursPerDay: parseFloat(e.target.value)})}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12].map(hours => (
                    <option key={hours} value={hours}>
                      {hours} hour{hours !== 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <p className="text-sm text-blue-800">
                <strong>Requirement:</strong> Teacher must be available for at least{' '}
                <strong>{config.minDaysPerWeek} day{config.minDaysPerWeek !== 1 ? 's' : ''}</strong> per week 
                with <strong>{config.minHoursPerDay} hour{config.minHoursPerDay !== 1 ? 's' : ''}</strong> each day.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherAvailabilityConfig;