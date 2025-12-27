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
  hidePendingBadge = false,
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
    <div className="flex flex-wrap items-center justify-end gap-2">
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
            view === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
          onClick={() => onViewChange('grid')}
          aria-label="Grid view"
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-1 rounded-r-lg px-3 py-2 text-sm ${
            view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
          }`}
          onClick={() => onViewChange('list')}
          aria-label="List view"
        >
          <LayoutList className="h-4 w-4" />
        </button>
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
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-95"
        >
          <Share2 className="h-4 w-4" />
          Request Access
          {!hidePendingBadge && pendingBadge > 0 && (
            <span className="ml-1 rounded-full bg-white/20 px-2 text-xs font-bold">
              {pendingBadge}
            </span>
          )}
        </button>
      )}

      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 shadow-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground">Admin controls</span>
          <button
            type="button"
            onClick={onAddFile}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:brightness-95"
          >
            <UploadCloud className="h-4 w-4" />
            Add file
          </button>
          <button
            type="button"
            onClick={onCreateFolder}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </button>
          <button
            type="button"
            onClick={handleManageAccessClick}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted"
          >
            <ShieldCheck className="h-4 w-4" />
            Manage access
            {manageBadge > 0 && (
              <span className="ml-1 rounded-full bg-muted px-2 text-[10px] font-bold text-foreground">
                {manageBadge}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default LibraryToolbar;
