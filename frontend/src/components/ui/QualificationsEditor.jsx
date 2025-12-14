import React from 'react';

export default function QualificationsEditor({ qualifications = [], onChange }) {
  const updateQualification = (idx, key, value) => {
    const copy = [...qualifications];
    copy[idx] = { ...copy[idx], [key]: value };
    onChange && onChange(copy);
  };

  const addQualification = () => {
    onChange && onChange([...(qualifications || []), { degree: '', institution: '', year: '' }]);
  };

  const removeQualification = (idx) => {
    const copy = [...qualifications];
    copy.splice(idx, 1);
    onChange && onChange(copy);
  };

  return (
    <div>
      <div className="space-y-3">
        {(qualifications || []).map((q, i) => (
          <div key={i} className="flex items-center gap-2 rounded border border-slate-200 bg-white p-3">
            <input className="w-36 rounded border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C736C]" placeholder="Degree" value={q.degree || ''} onChange={(e) => updateQualification(i, 'degree', e.target.value)} />
            <input className="flex-1 rounded border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C736C]" placeholder="Institution" value={q.institution || ''} onChange={(e) => updateQualification(i, 'institution', e.target.value)} />
            <input className="w-20 rounded border border-slate-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#2C736C]" placeholder="Year" value={q.year || ''} onChange={(e) => updateQualification(i, 'year', e.target.value)} />
            <button
              className="text-xs font-medium text-red-600 underline underline-offset-2 hover:text-red-700"
              onClick={() => removeQualification(i)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <button
          onClick={addQualification}
          className="inline-flex items-center justify-center rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2C736C]"
        >
          Add Qualification
        </button>
      </div>
    </div>
  );
}
