import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const DeleteConfirmModal = ({ open, onClose, onConfirm, entityType, entity }) => {
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!open) return null;

  const isFolder = entityType === 'folder';
  const title = isFolder ? 'Delete folder' : 'Delete file';
  const targetName = entity?.displayName || (isFolder ? 'this folder' : 'this file');
  const description = isFolder
    ? 'Folders must be empty before deletion. Removing the folder detaches it from the library tree.'
    : 'Deleting a file removes the metadata and the stored asset. Make sure no one needs it before continuing.';

  const handleConfirm = async () => {
    setIsProcessing(true);
    const result = await onConfirm();
    setIsProcessing(false);

    if (result?.success) {
      setError(null);
      onClose();
    } else {
      setError(result?.message || 'Unable to delete entry.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide">Confirm deletion</p>
              <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground">
          {description}
          <br />
          <span className="font-semibold text-foreground">Target:</span> {targetName}
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            disabled={isProcessing}
          >
            {isProcessing ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteConfirmModal;
