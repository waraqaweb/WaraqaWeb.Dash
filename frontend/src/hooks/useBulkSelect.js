import { useState, useCallback, useMemo } from 'react';

/**
 * Hook for bulk-select mode on list pages.
 *
 * @param {Array} items – currently visible items (each must have `_id`)
 * @returns {{ selectionMode, toggleSelectionMode, selected, toggleItem, selectAll, clearSelection, isAllSelected, selectedCount }}
 */
export default function useBulkSelect(items = []) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState(new Set());

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((prev) => {
      if (prev) setSelected(new Set()); // exiting → clear
      return !prev;
    });
  }, []);

  const toggleItem = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const allIds = items.map((i) => i._id).filter(Boolean);
    setSelected((prev) => {
      if (prev.size === allIds.length) return new Set(); // toggle off
      return new Set(allIds);
    });
  }, [items]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const visibleIds = useMemo(() => new Set(items.map((i) => i._id).filter(Boolean)), [items]);
  const isAllSelected = visibleIds.size > 0 && [...visibleIds].every((id) => selected.has(id));
  const selectedCount = [...selected].filter((id) => visibleIds.has(id)).length;

  return {
    selectionMode,
    toggleSelectionMode,
    selected,
    toggleItem,
    selectAll,
    clearSelection,
    isAllSelected,
    selectedCount,
  };
}
