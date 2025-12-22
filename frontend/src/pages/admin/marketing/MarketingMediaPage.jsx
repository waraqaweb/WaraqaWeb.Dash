import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCcw, Upload } from 'lucide-react';
import { getMediaAssets, uploadMediaAsset } from '../../../api/marketing';
import { shellCard, shellPad, titleH2, titleKicker, titleP, primaryButton, secondaryButton } from './_shared';

const MarketingMediaPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);

  const fileRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const assets = await getMediaAssets({ limit: 40 });
        if (!mounted) return;
        setItems(Array.isArray(assets) ? assets : []);
      } catch (e) {
        if (mounted) setError('Failed to load media assets.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const at = new Date(a?.createdAt || 0).getTime();
      const bt = new Date(b?.createdAt || 0).getTime();
      return bt - at;
    });
    return sorted;
  }, [items]);

  const onPickFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await uploadMediaAsset({ file });
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap items-start justify-between gap-3 ${shellCard} ${shellPad}`}>
        <div>
          <p className={titleKicker}>Content</p>
          <h2 className={titleH2}>Media library</h2>
          <p className={titleP}>Upload assets for hero images, teacher avatars, and section backgrounds.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} />
          <button
            type="button"
            className={primaryButton}
            onClick={() => fileRef.current?.click?.()}
            disabled={uploading}
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className={`${shellCard} ${shellPad}`}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No assets yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((asset) => (
              <a
                key={asset._id}
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm hover:border-slate-300"
              >
                <div className="aspect-[16/10] overflow-hidden rounded-xl bg-slate-100">
                  <img
                    src={asset.url}
                    alt={asset.altText || 'Media asset'}
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    loading="lazy"
                  />
                </div>
                <div className="mt-3">
                  <p className="text-sm font-semibold text-slate-900">{asset.originalName || asset.altText || 'Asset'}</p>
                  <p className="text-xs text-slate-500">{asset.tags?.length ? asset.tags.join(', ') : '—'}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketingMediaPage;
