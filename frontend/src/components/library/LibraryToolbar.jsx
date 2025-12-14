import React from 'react';
import {
  FolderPlus,
  LayoutGrid,
  LayoutList,
  PenSquare,
  RefreshCcw,
  Share2,
  ShieldCheck,
  UploadCloud
} from 'lucide-react';

const LibraryToolbar = ({
  view,
  onViewChange,
  onRefresh,
  onOpenShareModal,
  pendingRequests,
  managePendingCount = 0,
  isAdmin = false,
  onAddFile,
  onCreateFolder,
  onManageAccess,
  onOpenWhiteboard
}) => {
  const pendingBadge = pendingRequests?.length
    ? pendingRequests.filter((req) => req.status === 'pending').length
    : 0;
  const manageBadge = typeof managePendingCount === 'number' && managePendingCount > 0 ? managePendingCount : 0;
  const handleManageAccessClick = () => {
    if (onManageAccess) {
      onManageAccess();
      return;
    }
    if (onOpenShareModal) {
      onOpenShareModal();
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>

          <div className="flex items-center rounded-lg border border-border">
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-l-lg px-3 py-2 text-sm ${
                view === 'grid' ? 'bg-emerald-600 text-white' : 'text-muted-foreground'
              }`}
              onClick={() => onViewChange('grid')}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-r-lg px-3 py-2 text-sm ${
                view === 'list' ? 'bg-emerald-600 text-white' : 'text-muted-foreground'
              }`}
              onClick={() => onViewChange('list')}
              aria-label="List view"
            >
              <LayoutList className="h-4 w-4" />
            </button>
          </div>
        </div>

        {onOpenWhiteboard && (
          <button
            type="button"
            onClick={onOpenWhiteboard}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <PenSquare className="h-4 w-4" />
            Whiteboard
          </button>
        )}

        {!isAdmin && (
          <button
            type="button"
            onClick={onOpenShareModal}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <Share2 className="h-4 w-4" />
            Request Access
            {pendingBadge > 0 && (
              <span className="ml-1 rounded-full bg-white/20 px-2 text-xs font-bold">
                {pendingBadge}
              </span>
            )}
          </button>
        )}

        {isAdmin && (
          <div className="ml-auto flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300/70 bg-emerald-50/70 px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-emerald-900">Admin controls</span>
            <button
              type="button"
              onClick={onAddFile}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              <UploadCloud className="h-4 w-4" />
              Add file
            </button>
            <button
              type="button"
              onClick={onCreateFolder}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/70 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              <FolderPlus className="h-4 w-4" />
              New folder
            </button>
            <button
              type="button"
              onClick={handleManageAccessClick}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              <ShieldCheck className="h-4 w-4" />
              Manage access
              {manageBadge > 0 && (
                <span className="ml-1 rounded-full bg-emerald-600/10 px-2 text-[10px] font-bold text-emerald-700">
                  {manageBadge}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LibraryToolbar;
