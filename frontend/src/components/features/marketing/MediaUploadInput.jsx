import React, { useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { uploadMediaAsset } from '../../../api/marketing';

const MediaUploadInput = ({
  label,
  value,
  onChange,
  helperText,
  tags,
  className = ''
}) => {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleSelect = () => {
    if (uploading) return;
    inputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const asset = await uploadMediaAsset({ file, tags });
      // Support several possible response shapes from the API
      const url =
        asset?.url ||
        (asset?.data && (asset.data.url || asset.data.asset?.url)) ||
        asset?.asset?.url ||
        asset?.fileUrl ||
        asset?.location ||
        asset?.secure_url ||
        asset?.path ||
        asset?.assetUrl ||
        (Array.isArray(asset?.assets) && asset.assets[0]?.url) ||
        '';
      onChange(url);
    } catch (err) {
      setError(err?.response?.data?.message || err.message || 'Failed to upload media');
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {label && <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60">
        <div className="flex items-center gap-4 p-4">
          <div className="h-16 w-20 shrink-0 overflow-hidden rounded-xl border border-dashed border-slate-200 bg-white">
            {value ? (
              <img src={value} alt="Uploaded preview" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-slate-300">
                <ImageIcon className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handleSelect}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white shadow disabled:opacity-60"
              disabled={uploading}
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? 'Uploading…' : 'Upload file'}
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 hover:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
                Remove
              </button>
            )}
          </div>
        </div>
        {helperText && <p className="border-t border-slate-100 bg-white px-4 py-2 text-xs text-slate-500">{helperText}</p>}
        {error && <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">{error}</p>}
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
    </div>
  );
};

export default MediaUploadInput;
