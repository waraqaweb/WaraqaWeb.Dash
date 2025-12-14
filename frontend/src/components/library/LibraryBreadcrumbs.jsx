import React from 'react';
import { ChevronRight, Link as LinkIcon } from 'lucide-react';

const LibraryBreadcrumbs = ({ breadcrumb, onNavigate }) => {
  if (!breadcrumb?.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>All Library</span>
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
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <button type="button" onClick={() => onNavigate('root')} className="hover:text-foreground">
        Library
      </button>
      {breadcrumb.map((crumb, idx) => (
        <React.Fragment key={crumb.folder || idx}>
          <ChevronRight className="h-3 w-3" />
          <button
            type="button"
            onClick={() => onNavigate(crumb.folder)}
            className="font-medium text-foreground hover:underline"
          >
            {crumb.displayName}
          </button>
        </React.Fragment>
      ))}
      <button
        type="button"
        onClick={handleCopy}
        className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <LinkIcon className="h-3 w-3" />
        Copy link
      </button>
    </div>
  );
};

export default LibraryBreadcrumbs;
