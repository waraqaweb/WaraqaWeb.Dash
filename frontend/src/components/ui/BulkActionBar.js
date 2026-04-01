import React from 'react';
import { CheckSquare, Square, X } from 'lucide-react';

/**
 * Floating bar shown when bulk-selection mode is active.
 *
 * @param {{ selectedCount: number, isAllSelected: boolean, onSelectAll: ()=>void, onExit: ()=>void, children: React.ReactNode }} props
 *   `children` should be the action buttons.
 */
const BulkActionBar = ({ selectedCount, isAllSelected, onSelectAll, onExit, children }) => (
  <div className="sticky top-0 z-30 flex flex-wrap items-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/90 px-4 py-2.5 shadow-md backdrop-blur-sm">
    <button
      type="button"
      onClick={onSelectAll}
      className="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
      title={isAllSelected ? 'Deselect all' : 'Select all'}
    >
      {isAllSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
      {isAllSelected ? 'Deselect all' : 'Select all'}
    </button>

    <span className="text-xs font-medium text-indigo-600">
      {selectedCount} selected
    </span>

    <div className="mx-1 h-4 w-px bg-indigo-200" />

    {/* Action buttons injected by parent */}
    <div className="flex flex-wrap items-center gap-1.5">
      {children}
    </div>

    <button
      type="button"
      onClick={onExit}
      className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
      title="Exit selection mode"
    >
      <X className="h-3.5 w-3.5" />
      Cancel
    </button>
  </div>
);

export default BulkActionBar;
