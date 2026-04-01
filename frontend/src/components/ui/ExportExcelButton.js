import React, { useState } from 'react';
import { DownloadCloud } from 'lucide-react';

/**
 * A small rounded button that triggers an async export callback.
 * Shows a spinner while the export is in progress.
 */
export default function ExportExcelButton({ onExport, title = 'Export to Excel' }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onExport();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed – see console for details.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title={title}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
    >
      {busy ? (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <DownloadCloud className="h-3.5 w-3.5" />
      )}
      {busy ? 'Exporting…' : 'Export'}
    </button>
  );
}
