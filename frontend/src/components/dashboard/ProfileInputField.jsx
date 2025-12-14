import React from 'react';

const ProfileInputField = ({ label, value, onChange, disabled }) => (
  <div className="flex flex-col mb-2 w-full">
    <label className="text-sm font-semibold text-gray-700 mb-1">{label}</label>
    <input
      className="border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-custom-teal disabled:bg-gray-100"
      value={value ?? ''}
      onChange={(e) => onChange && onChange(e.target.value)}
      disabled={disabled}
    />
  </div>
);

export default ProfileInputField;
