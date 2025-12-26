import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import flattenFolders from './folderUtils';
import { subjects } from '../../../constants/reportTopicsConfig';

const LEVEL_OPTIONS = ['Beginner', 'Intermediate', 'Advanced', 'Special'];

const DEFAULT_FORM = {
  parentFolder: 'root',
  displayName: '',
  description: '',
  subject: '',
  level: '',
  orderIndex: '',
  allowDownloads: true,
  isSecret: false
};

const FolderModal = ({ open, onClose, onSubmit, folders, defaultParent }) => {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { options: folderOptions } = useMemo(() => flattenFolders(folders), [folders]);

  useEffect(() => {
    if (!open) return;
    setForm((prev) => ({
      ...DEFAULT_FORM,
      parentFolder: defaultParent && defaultParent !== 'root' ? defaultParent : 'root'
    }));
    setError(null);
  }, [open, defaultParent]);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.displayName.trim()) {
      setError('Folder name is required.');
      return;
    }

    const payload = {
      parentFolder: form.parentFolder === 'root' ? null : form.parentFolder,
      displayName: form.displayName.trim(),
      description: form.description.trim() || undefined,
      subject: form.subject.trim() || undefined,
      level: form.level.trim() || undefined,
      orderIndex: form.orderIndex ? Number(form.orderIndex) : undefined,
      allowDownloads: form.allowDownloads,
      isSecret: form.isSecret
    };

    setIsSubmitting(true);
    const result = await onSubmit(payload);
    setIsSubmitting(false);

    if (result?.success) {
      setError(null);
      setForm(DEFAULT_FORM);
      onClose();
    } else {
      setError(result?.message || 'Folder could not be created.');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin action</p>
            <h2 className="text-lg font-semibold text-foreground">Create a folder</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Parent folder</span>
              <select
                value={form.parentFolder}
                onChange={(event) => handleChange('parentFolder', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {folderOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Folder name</span>
              <input
                type="text"
                value={form.displayName}
                onChange={(event) => handleChange('displayName', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="text-sm">
            <span className="text-muted-foreground">Description</span>
            <textarea
              rows={2}
              value={form.description}
              onChange={(event) => handleChange('description', event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Subject</span>
              <select
                value={form.subject}
                onChange={(event) => handleChange('subject', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Choose a subject</option>
                {(subjects || []).map((subject) => (
                  <option key={subject} value={subject}>
                    {subject}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Level / grade</span>
              <select
                value={form.level}
                onChange={(event) => handleChange('level', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                <option value="">Choose a level</option>
                {LEVEL_OPTIONS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Order index</span>
              <input
                type="number"
                value={form.orderIndex}
                onChange={(event) => handleChange('orderIndex', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.allowDownloads}
                onChange={(event) => handleChange('allowDownloads', event.target.checked)}
                className="rounded border-border"
              />
              Allow downloads
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isSecret}
                onChange={(event) => handleChange('isSecret', event.target.checked)}
                className="rounded border-border"
              />
              Mark folder as secret
            </label>
          </div>

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
              {isSubmitting ? 'Saving…' : 'Create folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FolderModal;
