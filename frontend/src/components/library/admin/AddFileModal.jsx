import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { uploadLibraryAsset } from '../../../api/library';
import flattenFolders from './folderUtils';
import { subjects } from '../../../constants/reportTopicsConfig';

const normalizeSubjectOptions = (input) => {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        const trimmed = entry.trim();
        if (!trimmed) return null;
        return { value: trimmed, label: trimmed };
      }
      if (typeof entry === 'object') {
        const value = typeof entry.value === 'string' ? entry.value.trim() : '';
        const label = typeof entry.label === 'string' ? entry.label.trim() : value;
        if (!value) return null;
        return { value, label: label || value };
      }
      return null;
    })
    .filter(Boolean);
};

const DEFAULT_FORM = {
  folder: 'root',
  displayName: '',
  description: '',
  subject: '',
  tags: '',
  pageCount: '',
  allowDownload: true,
  isSecret: false,
  inheritsSecret: true,
  contentType: 'document'
};

const parseTags = (value = '') =>
  value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const formatBytes = (bytes = 0) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
};

const AddFileModal = ({ open, onClose, onSubmit, folders, defaultFolder }) => {
  const [form, setForm] = useState({ ...DEFAULT_FORM });
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedAsset, setUploadedAsset] = useState(null);
  const [uploadState, setUploadState] = useState({ status: 'idle', fileName: '', bytes: 0, message: null });
  const fileInputRef = useRef(null);

  const subjectOptions = useMemo(() => normalizeSubjectOptions(subjects), []);

  const { options: folderOptions } = useMemo(() => flattenFolders(folders), [folders]);

  useEffect(() => {
    if (!open) return;
    setForm((prev) => ({
      ...DEFAULT_FORM,
      folder: defaultFolder && defaultFolder !== 'root' ? defaultFolder : 'root'
    }));
    setUploadedAsset(null);
    setUploadState({ status: 'idle', fileName: '', bytes: 0, message: null });
    setError(null);
  }, [open, defaultFolder]);

  const resetUploadState = () => {
    setUploadedAsset(null);
    setUploadState({ status: 'idle', fileName: '', bytes: 0, message: null });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleChange = (field, value) => {
    if (field === 'folder' && uploadedAsset) {
      resetUploadState();
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleFilePick = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (form.folder === 'root') {
      setError('Choose a destination folder before uploading.');
      event.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('folderId', form.folder);

    setUploadState({ status: 'uploading', fileName: file.name, bytes: file.size, message: null });
    setError(null);

    try {
      const payload = await uploadLibraryAsset(formData);
      setUploadedAsset(payload.storage);
      setUploadState({ status: 'success', fileName: payload.fileName, bytes: payload.bytes, message: null });
      if (!form.displayName.trim()) {
        const inferredName = payload.fileName?.replace(/\.[^.]+$/, '') || payload.fileName;
        setForm((prev) => ({ ...prev, displayName: inferredName || prev.displayName }));
      }
    } catch (uploadError) {
      // Provide useful diagnostics for debugging failed uploads.
      console.error('[Library] Upload failed', {
        message: uploadError?.message,
        status: uploadError?.response?.status,
        data: uploadError?.response?.data
      });
      const message = uploadError?.response?.data?.message || 'Upload failed. Please try again.';
      setUploadedAsset(null);
      setUploadState({ status: 'error', fileName: file.name, bytes: file.size, message });
      setError(message);
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const triggerFileDialog = () => {
    if (uploadState.status === 'uploading') return;
    fileInputRef.current?.click();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (form.folder === 'root') {
      setError('Choose a destination folder. The root cannot store files directly.');
      return;
    }
    if (!form.displayName.trim()) {
      setError('Display name is required.');
      return;
    }

    if (!uploadedAsset) {
      setError('Upload a file from your device before saving.');
      return;
    }

    const payload = {
      folder: form.folder,
      displayName: form.displayName.trim(),
      description: form.description.trim() || undefined,
      subject: form.subject.trim() || undefined,
      tags: parseTags(form.tags),
      allowDownload: form.allowDownload,
      isSecret: form.isSecret,
      inheritsSecret: form.inheritsSecret,
      contentType: form.contentType,
      pageCount: form.pageCount ? Number(form.pageCount) : undefined,
      storage: uploadedAsset,
      metadata: undefined,
      mimeType: uploadedAsset?.metadata?.mimeType
    };

    setIsSubmitting(true);
    const result = await onSubmit(payload);
    setIsSubmitting(false);

    if (result?.success) {
      setForm({ ...DEFAULT_FORM, folder: form.folder });
      resetUploadState();
      setError(null);
      onClose();
    } else {
      setError(result?.message || 'File could not be added.');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Admin action</p>
            <h2 className="text-lg font-semibold text-foreground">Add a file</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Upload a document directly from your device. Files are stored securely in the selected folder.
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
        )}

        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <section className="rounded-2xl border-2 border-dashed border-border bg-muted/30 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Upload from your device</p>
                <p className="text-xs text-muted-foreground">
                  {form.folder === 'root'
                    ? 'Choose a destination folder to enable uploads.'
                    : 'PDF, documents, audio, images, and video files are supported.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={triggerFileDialog}
                  disabled={uploadState.status === 'uploading'}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {uploadState.status === 'uploading' ? 'Uploading…' : 'Choose file'}
                </button>
                {uploadedAsset && (
                  <button
                    type="button"
                    onClick={resetUploadState}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Replace file
                  </button>
                )}
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFilePick}
              accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.mp4,.mp3,.wav,image/*,audio/*,video/*,.txt"
            />

            {uploadState.status === 'error' && uploadState.message && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {uploadState.message}
              </p>
            )}

            {uploadedAsset ? (
              <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">{uploadState.fileName}</p>
                <p>{formatBytes(uploadState.bytes)}</p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">No file uploaded yet.</p>
            )}
          </section>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Destination folder</span>
              <select
                value={form.folder}
                onChange={(event) => handleChange('folder', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="root" disabled>
                  Choose a folder
                </option>
                {folderOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Display name</span>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">Subject</span>
              <select
                value={form.subject}
                onChange={(event) => handleChange('subject', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">No subject (optional)</option>
                {subjectOptions.map((subject) => (
                  <option key={subject.value} value={subject.value}>
                    {subject.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Tags (comma separated)</span>
              <input
                type="text"
                value={form.tags}
                onChange={(event) => handleChange('tags', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm">
              <span className="text-muted-foreground">Page count</span>
              <input
                type="number"
                min="1"
                value={form.pageCount}
                onChange={(event) => handleChange('pageCount', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">Content type</span>
              <select
                value={form.contentType}
                onChange={(event) => handleChange('contentType', event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="document">Document</option>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="image">Image</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={form.allowDownload}
                onChange={(event) => handleChange('allowDownload', event.target.checked)}
                className="rounded border-border"
              />
              Allow downloads
            </label>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.isSecret}
                onChange={(event) => handleChange('isSecret', event.target.checked)}
                className="rounded border-border"
              />
              Mark as secret content
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.inheritsSecret}
                onChange={(event) => handleChange('inheritsSecret', event.target.checked)}
                className="rounded border-border"
              />
              Inherit secret flag from folder
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
              {isSubmitting ? 'Saving…' : 'Add file'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddFileModal;
