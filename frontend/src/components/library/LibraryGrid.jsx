import React, { useEffect, useMemo, useState } from 'react';
import { Download, Eye, Folder, Lock, PencilLine, Trash2 } from 'lucide-react';
import { fetchDocumentPages } from '../../api/library';

const itemId = (item) => item?.id || item?._id;

const entryId = (entry) => entry?._id || entry?.id || entry?.folder || entry?.item;

const classificationLabel = (entity) => {
  const subject = (entity?.subject || '').trim();
  const level = (entity?.level || '').trim();

  if (subject && level) return `${subject} • ${level}`;
  if (subject) return subject;
  if (level) return level;
  return null;
};

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
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/70 shadow-sm transition-shadow hover:shadow-md">
      <div className="relative h-44 w-full overflow-hidden">
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
              className="rounded-full bg-white/85 p-1 text-primary shadow hover:bg-white"
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
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <h3 dir="auto" className="text-base font-semibold text-foreground line-clamp-2">
            {item.displayName}
          </h3>
          {item?.description ? (
            <p dir="auto" className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {item.description}
            </p>
          ) : null}
        </div>
        {(() => {
          const classification = classificationLabel(item);
          const hasPageCount = typeof item?.pageCount === 'number' && Number.isFinite(item.pageCount);
          if (!classification && !hasPageCount) return null;
          return (
            <div className="mt-auto text-xs text-muted-foreground">
              {classification ? <p>{classification}</p> : null}
              {hasPageCount ? <p>{item.pageCount} pages</p> : null}
            </div>
          );
        })()}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(item)}
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-95"
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

const FolderCard = ({ folder, onOpen, isAdmin = false, onRename, onDelete }) => {
  const isSample = Boolean(folder?.__isSample);

  return (
    <article
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/70 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative flex h-32 w-full items-center justify-center bg-muted/40">
        <Folder className="h-10 w-10 text-muted-foreground" />
        {folder?.isSecret && (
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
                onRename?.(folder);
              }}
              className="rounded-full bg-white/85 p-1 text-primary shadow hover:bg-white"
              title="Rename folder"
            >
              <PencilLine className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete?.(folder);
              }}
              className="rounded-full bg-white/80 p-1 text-red-600 shadow hover:bg-white"
              title="Delete folder"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div>
          <h3 dir="auto" className="text-base font-semibold text-foreground line-clamp-2">
            {folder?.displayName || 'Untitled folder'}
          </h3>
          {folder?.description ? (
            <p dir="auto" className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {folder.description}
            </p>
          ) : null}
        </div>
        {(() => {
          const classification = classificationLabel(folder);
          if (!classification) return null;
          return (
            <div className="mt-auto text-xs text-muted-foreground">
              <p>{classification}</p>
            </div>
          );
        })()}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen?.(folder)}
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-95"
          >
            Open
          </button>
        </div>
      </div>
    </article>
  );
};

const LibraryGrid = ({
  folders = [],
  items = [],
  view,
  onOpenItem,
  onOpenFolder,
  isAdmin = false,
  onRenameItem,
  onDeleteItem,
  onRenameFolder,
  onDeleteFolder
}) => {
  const { sortedFolders, sortedItems } = useMemo(() => {
    const nextFolders = [...(folders || [])].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    const nextItems = [...(items || [])].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    return { sortedFolders: nextFolders, sortedItems: nextItems };
  }, [folders, items]);

  const hasAny = sortedFolders.length > 0 || sortedItems.length > 0;

  if (!hasAny) {
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
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Classification</th>
              <th className="px-4 py-3">Pages</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedFolders.map((folder) => {
              const isSample = Boolean(folder?.__isSample);
              return (
                <tr key={entryId(folder)} className="border-t border-border/60">
                  <td className="px-4 py-3 font-medium text-foreground">{folder.displayName}</td>
                  <td className="px-4 py-3 text-muted-foreground">Folder</td>
                  <td className="px-4 py-3 text-muted-foreground">{classificationLabel(folder) || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">—</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenFolder?.(folder)}
                        className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-95"
                      >
                        Open
                      </button>

                      {isAdmin && !isSample && (
                        <>
                          <button
                            type="button"
                            onClick={() => onRenameFolder?.(folder)}
                            className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                          >
                            <PencilLine className="mr-1 h-3.5 w-3.5" />
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteFolder?.(folder)}
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

            {sortedItems.map((item) => {
              const isSample = Boolean(item?.__isSample);
              return (
                <tr key={itemId(item)} className="border-t border-border/60">
                  <td className="px-4 py-3 font-medium text-foreground">{item.displayName}</td>
                  <td className="px-4 py-3 text-muted-foreground">File</td>
                  <td className="px-4 py-3 text-muted-foreground">{classificationLabel(item) || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.pageCount || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenItem?.(item)}
                        className="inline-flex items-center rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:brightness-95"
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
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {sortedFolders.map((folder) => (
        <FolderCard
          key={entryId(folder)}
          folder={folder}
          onOpen={onOpenFolder}
          isAdmin={isAdmin}
          onRename={onRenameFolder}
          onDelete={onDeleteFolder}
        />
      ))}

      {sortedItems.map((item) => (
        <LibraryCard
          key={itemId(item)}
          item={item}
          onOpen={onOpenItem}
          isAdmin={isAdmin}
          onRename={onRenameItem}
          onDelete={onDeleteItem}
        />
      ))}
    </div>
  );
};

export default LibraryGrid;
