import React, { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Lock, PencilLine, Trash2 } from 'lucide-react';
import { fetchDocumentPages } from '../../api/library';

const itemId = (item) => item?.id || item?._id;

const LibraryCard = ({ item, onOpen, isAdmin = false, onRename, onDelete }) => {
  const isSample = Boolean(item?.__isSample);
  const fallbackPreview = item?.previewAsset?.url || 'https://placehold.co/320x420?text=Preview';
  const identifier = itemId(item);
  const [previewUrl, setPreviewUrl] = useState(fallbackPreview);

  useEffect(() => {
    let cancelled = false;
    if (!identifier) {
      setPreviewUrl(fallbackPreview);
      return () => { cancelled = true; };
    }

    if (item?.previewAsset?.url) {
      setPreviewUrl(item.previewAsset.url);
      return () => { cancelled = true; };
    }

    const loadCover = async () => {
      try {
        const response = await fetchDocumentPages(identifier, { page: 1, limit: 1 });
        const firstPage = response?.pages?.[0]?.imageUrl;
        if (!cancelled && firstPage) {
          setPreviewUrl(firstPage);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to fetch cover preview', error);
          setPreviewUrl(fallbackPreview);
        }
      }
    };

    loadCover();
    return () => {
      cancelled = true;
    };
  }, [identifier, item?.previewAsset?.url, fallbackPreview]);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card/70 shadow-sm">
      <div className="relative h-48 w-full overflow-hidden">
        <img
          src={previewUrl}
          alt={item.displayName}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        {item.isSecret && (
          <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs text-white">
            <Lock className="h-3 w-3" />
            Secret
          </div>
        )}
        {isAdmin && !isSample && (
          <div className="absolute right-3 top-3 flex gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRename?.(item);
              }}
              className="rounded-full bg-white/80 p-1 text-emerald-700 shadow hover:bg-white"
            >
              <PencilLine className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete?.(item);
              }}
              className="rounded-full bg-white/80 p-1 text-red-600 shadow hover:bg-white"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-base font-semibold text-foreground line-clamp-2">
            {item.displayName}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        </div>
        <div className="mt-auto text-xs text-muted-foreground">
          <p>{item.subject} • {item.level || 'Multi-level'}</p>
          <p>{item.pageCount || '—'} pages</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <Eye className="mr-2 inline h-4 w-4" />
            Open
          </button>
          <button
            type="button"
            className={`rounded-lg border border-border px-3 py-2 text-sm ${
              item.allowDownload ? 'text-foreground hover:bg-muted' : 'text-muted-foreground cursor-not-allowed'
            }`}
            disabled={!item.allowDownload}
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
};

const LibraryGrid = ({ items, view, onOpen, isAdmin = false, onRenameItem, onDeleteItem }) => {
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }, [items]);

  if (!sorted.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-card/30 p-12 text-center text-sm text-muted-foreground">
        No books here yet. Request access or choose another folder.
      </div>
    );
  }

  if (view === 'list') {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card/70">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Subject</th>
              <th className="px-4 py-3">Level</th>
              <th className="px-4 py-3">Pages</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
              const isSample = Boolean(item?.__isSample);
              return (
                <tr key={itemId(item)} className="border-t border-border/60">
                <td className="px-4 py-3 font-medium text-foreground">{item.displayName}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.subject}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.level || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground">{item.pageCount || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      className="inline-flex items-center rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      disabled={!item.allowDownload}
                      className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-xs ${
                        item.allowDownload ? 'text-foreground' : 'text-muted-foreground cursor-not-allowed'
                      }`}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                    {isAdmin && !isSample && (
                      <>
                        <button
                          type="button"
                          onClick={() => onRenameItem?.(item)}
                          className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                          <PencilLine className="mr-1 h-3.5 w-3.5" />
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem?.(item)}
                          className="inline-flex items-center rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sorted.map((item) => (
        <LibraryCard
          key={itemId(item)}
          item={item}
          onOpen={onOpen}
          isAdmin={isAdmin}
          onRename={onRenameItem}
          onDelete={onDeleteItem}
        />
      ))}
    </div>
  );
};

export default LibraryGrid;
