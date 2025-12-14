import React, { useMemo, useState } from 'react';
import { X } from 'lucide-react';

const DEFAULT_FORM = {
  fullName: '',
  email: '',
  scopeType: 'folder',
  message: '',
  includeDescendants: true
};

const ShareRequestModal = ({ open, onClose, onSubmit, folders, isSubmitting }) => {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [selectedFolder, setSelectedFolder] = useState('root');
  const [targetItemId, setTargetItemId] = useState('');
  const [errors, setErrors] = useState({});

  const folderOptions = useMemo(() => {
    const flatten = [];
    const traverse = (nodes, prefix = '') => {
      nodes.forEach((node) => {
        const value = node._id || node.id;
        if (value) {
          flatten.push({ value, label: `${prefix}${node.displayName}` });
        }
        if (node.children?.length) {
          traverse(node.children, `${prefix}${node.displayName} / `);
        }
      });
    };
    traverse(folders);
    return flatten;
  }, [folders]);

  const validate = () => {
    const nextErrors = {};
    if (!form.fullName.trim()) nextErrors.fullName = 'Full name is required';
    if (!form.email.trim()) nextErrors.email = 'Email is required';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) nextErrors.email = 'Enter a valid email';
    if (!form.message.trim()) nextErrors.message = 'Please provide a short reason';
    if (form.scopeType === 'folder' && (!selectedFolder || selectedFolder === 'root')) {
      nextErrors.scopeType = 'Choose a specific folder to request.';
    }
    if (form.scopeType === 'item' && !targetItemId.trim()) {
      nextErrors.scopeType = 'Enter the item ID or slug you need.';
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validate()) return;
    const isFolderScope = form.scopeType === 'folder';
    const isItemScope = form.scopeType === 'item';
    const payload = {
      fullName: form.fullName.trim(),
      email: form.email.trim().toLowerCase(),
      scopeType: form.scopeType,
      targetId: isFolderScope ? selectedFolder : isItemScope ? targetItemId.trim() : undefined,
      includeDescendants: form.scopeType === 'folder' ? form.includeDescendants : undefined,
      reason: form.message.trim()
    };
    const result = await onSubmit(payload);
    if (result?.success) {
      setForm(DEFAULT_FORM);
      setSelectedFolder('root');
      setTargetItemId('');
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Request Library Access</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Full Name</span>
              <input
                type="text"
                value={form.fullName}
                onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              {errors.fullName && <p className="mt-1 text-xs text-red-500">{errors.fullName}</p>}
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email}</p>}
            </label>
          </div>

          <label className="text-sm">
            <span className="text-muted-foreground">Reason</span>
            <textarea
              rows={3}
              value={form.message}
              onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            {errors.message && <p className="mt-1 text-xs text-red-500">{errors.message}</p>}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Scope</span>
              <select
                value={form.scopeType}
                onChange={(e) => setForm((prev) => ({ ...prev, scopeType: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="folder">Specific folder</option>
                <option value="item">Specific book</option>
                <option value="space">Entire library</option>
              </select>
              {errors.scopeType && <p className="mt-1 text-xs text-red-500">{errors.scopeType}</p>}
            </label>

            {form.scopeType === 'folder' && (
              <label className="text-sm">
                <span className="text-muted-foreground">Folder</span>
                <select
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="root">Choose a folder…</option>
                  {folderOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {form.scopeType === 'item' && (
              <label className="text-sm">
                <span className="text-muted-foreground">Item ID or slug</span>
                <input
                  type="text"
                  value={targetItemId}
                  onChange={(e) => setTargetItemId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="e.g. 64fb9c54b8c... or algebra-basics"
                />
              </label>
            )}
          </div>

          {form.scopeType === 'folder' && (
            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={form.includeDescendants}
                onChange={(e) => setForm((prev) => ({ ...prev, includeDescendants: e.target.checked }))}
                className="rounded border-border"
              />
              Include sub-folders
            </label>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {isSubmitting ? 'Submitting…' : 'Send Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ShareRequestModal;
