import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCcw } from 'lucide-react';
import { getAdminBlogPosts } from '../../../api/marketing';
import BlogPostModal from '../../../components/features/marketing/BlogPostModal';
import { shellCard, shellPad, table, tableWrap, td, th, titleH2, titleKicker, titleP, tr, primaryButton, secondaryButton, pill } from './_shared';

const statusTone = (status) => {
  if (status === 'published') return 'green';
  if (status === 'scheduled') return 'amber';
  if (status === 'draft') return 'slate';
  return 'slate';
};

const MarketingBlogPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState([]);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const posts = await getAdminBlogPosts();
        if (!mounted) return;
        setItems(Array.isArray(posts) ? posts : []);
      } catch (e) {
        if (mounted) setError('Failed to load blog posts.');
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
      const at = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      const bt = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      return bt - at;
    });
    return sorted;
  }, [items]);

  const openNew = () => {
    setSelected(null);
    setOpen(true);
  };

  const openEdit = (post) => {
    setSelected(post);
    setOpen(true);
  };

  const handleSaved = (saved) => {
    setItems((prev) => {
      const existing = prev.find((p) => p._id === saved._id);
      if (!existing) return [saved, ...prev];
      return prev.map((p) => (p._id === saved._id ? saved : p));
    });
  };

  const handleDeleted = (id) => {
    setItems((prev) => prev.filter((p) => p._id !== id));
  };

  const dateLabel = (post) => {
    if (post?.status === 'scheduled' && post?.scheduledAt) return `Scheduled ${new Date(post.scheduledAt).toLocaleString()}`;
    if (post?.status === 'published' && post?.publishedAt) return `Published ${new Date(post.publishedAt).toLocaleString()}`;
    if (post?.updatedAt) return `Updated ${new Date(post.updatedAt).toLocaleString()}`;
    return '—';
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap items-start justify-between gap-3 ${shellCard} ${shellPad}`}>
        <div>
          <p className={titleKicker}>Content</p>
          <h2 className={titleH2}>Blog posts</h2>
          <p className={titleP}>Long-form updates with scheduled publishing support.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button type="button" className={primaryButton} onClick={openNew}>
            <Plus className="h-4 w-4" />
            New post
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className={`${shellCard} ${shellPad}`}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No blog posts yet.</p>
        ) : (
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Title</th>
                  <th className={th}>Status</th>
                  <th className={th}>Language</th>
                  <th className={th}>Featured</th>
                  <th className={th}>Timing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((post) => (
                  <tr
                    key={post._id}
                    className={`${tr} cursor-pointer hover:border-slate-300`}
                    onClick={() => openEdit(post)}
                  >
                    <td className={td}>
                      <div className="font-semibold text-slate-900">{post.title || 'Untitled'}</div>
                      <div className="text-xs text-slate-500">{post.slug || '—'}</div>
                    </td>
                    <td className={td}>
                      <span className={pill(statusTone(post.status))}>{post.status || 'draft'}</span>
                    </td>
                    <td className={td}>{(post.language || 'en').toUpperCase()}</td>
                    <td className={td}>
                      <span className={post.featured ? pill('amber') : pill('slate')}>{post.featured ? 'Featured' : '—'}</span>
                    </td>
                    <td className={td}>{dateLabel(post)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BlogPostModal
        open={open}
        onClose={() => setOpen(false)}
        post={selected}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        variant="drawer"
      />
    </div>
  );
};

export default MarketingBlogPage;
