import React, { useState } from 'react';

const files = [
  {
    name: 'Waraqa_Registration_Form_2026-05-20_12_40_39.csv',
    label: 'Guardian Registration CSV',
  },
  {
    name: 'New_Student_Evaluation2026-05-20_12_41_06.csv',
    label: 'Evaluation Meetings Booking CSV',
  },
];

const LegacyDataPage = () => {
  const [selected, setSelected] = useState(null);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Legacy Data Archive</h1>
      <p className="mb-6 text-muted-foreground">Browse or download legacy CSV data for evaluation bookings and guardian registrations.</p>
      <ul className="mb-8">
        {files.map((file) => (
          <li key={file.name} className="mb-2">
            <button
              className="text-primary underline hover:text-primary/80"
              onClick={() => setSelected(file)}
            >
              {file.label}
            </button>
            <a
              href={`/legacy-data/${file.name}`}
              className="ml-4 text-xs text-muted-foreground underline"
              download
            >
              Download CSV
            </a>
          </li>
        ))}
      </ul>
      {selected && (
        <iframe
          title={selected.label}
          src={`/legacy-data/${selected.name}`}
          className="w-full h-96 border rounded bg-white"
        />
      )}
    </div>
  );
};

export default LegacyDataPage;
