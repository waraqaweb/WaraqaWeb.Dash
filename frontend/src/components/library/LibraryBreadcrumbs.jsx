import React from 'react';
import { ChevronRight, Link as LinkIcon } from 'lucide-react';

const LibraryBreadcrumbs = ({ breadcrumb, onNavigate }) => {
  if (!breadcrumb?.length) {
    return (
      <div className="flex min-w-0 items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="truncate">All Library</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
            } catch (err) {
              console.error('Failed to copy link', err);
            }
          }}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <LinkIcon className="h-3 w-3" />
          Copy link
        </button>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch (err) {
      console.error('Failed to copy link', err);
    }
  };

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 text-sm text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
        <button type="button" onClick={() => onNavigate('root')} className="shrink-0 hover:text-foreground">
          Library
        </button>
        {breadcrumb.map((crumb, idx) => (
          <React.Fragment key={crumb.folder || idx}>
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button
              type="button"
              onClick={() => onNavigate(crumb.folder)}
              className="min-w-0 truncate font-medium text-foreground hover:underline"
              title={crumb.displayName}
            >
              {crumb.displayName}
            </button>
          </React.Fragment>
        ))}
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <LinkIcon className="h-3 w-3" />
        Copy link
      </button>
    </div>
  );
};

export default LibraryBreadcrumbs;
