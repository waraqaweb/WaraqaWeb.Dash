import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

const RenameModal = ({ open, onClose, onSubmit, entityType, entity }) => {
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplayName(entity?.displayName || '');
    setDescription(entity?.description || '');
    setError(null);
  }, [open, entity]);

  if (!open) return null;

  const isItem = entityType === 'item';
  const title = isItem ? 'Rename file' : 'Rename folder';

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!displayName.trim()) {
      setError('A name is required.');
      return;
    }

    setIsSubmitting(true);
    const result = await onSubmit({
      displayName: displayName.trim(),
      description: isItem ? description.trim() : undefined
    });
    setIsSubmitting(false);

    if (result?.success) {
      onClose();
    } else {
      setError(result?.message || 'Unable to rename entry.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin action</p>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">Current: {entity?.displayName || 'Untitled'}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="text-sm">
            <span className="text-muted-foreground">New name</span>
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          {isItem && (
            <label className="text-sm">
              <span className="text-muted-foreground">Description</span>
              <textarea
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RenameModal;
