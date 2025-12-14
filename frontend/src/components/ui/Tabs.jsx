import React from 'react';

export default function Tabs({ tabs = [], active, onChange, className = '' }) {
  return (
    <div className={`flex items-center ${className}`}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange && onChange(t.key)}
          className={`px-3 py-2 rounded-t-md transition-all text-sm ${active === t.key ? 'bg-white border border-b-0 text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
