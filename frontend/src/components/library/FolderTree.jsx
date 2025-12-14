import React, { useMemo, useState } from 'react';
import { ChevronRight, Folder, Lock } from 'lucide-react';

const TreeNode = ({ node, depth, onSelect, activeFolder }) => {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children && node.children.length > 0;
  const isActive = activeFolder === node._id;

  const handleClick = () => {
    onSelect(node);
    if (!hasChildren) return;
    setExpanded(true);
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handleClick}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
          isActive ? 'bg-emerald-600/10 text-emerald-600' : 'text-muted-foreground hover:bg-muted'
        }`}
      >
        <span className="w-4 text-center">
          {hasChildren ? (
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
              strokeWidth={2}
            />
          ) : null}
        </span>
        <Folder className="h-4 w-4 text-foreground/70" strokeWidth={1.5} />
        <span className="flex-1 truncate">{node.displayName}</span>
        {node.isSecret && <Lock className="h-3.5 w-3.5 text-amber-500" strokeWidth={1.75} />}
      </button>
      {hasChildren && expanded && (
        <div className="ml-4 border-l border-border/30 pl-3">
          {node.children.map((child) => (
            <TreeNode
              key={child._id}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              activeFolder={activeFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FolderTree = ({ tree, onSelect, activeFolder }) => {
  const orderedTree = useMemo(() => tree || [], [tree]);

  return (
    <div className="h-full rounded-xl border border-border bg-card/60 p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Library Tree</p>
          <p className="text-xs text-muted-foreground">Subjects • Levels • Series</p>
        </div>
      </div>
      <div className="space-y-1 overflow-y-auto pr-2" style={{ maxHeight: 'calc(100vh - 220px)' }}>
        {orderedTree.map((node) => (
          <TreeNode
            key={node._id}
            node={node}
            depth={0}
            onSelect={onSelect}
            activeFolder={activeFolder}
          />
        ))}
        {!orderedTree.length && (
          <p className="text-sm text-muted-foreground">No folders yet.</p>
        )}
      </div>
    </div>
  );
};

export default FolderTree;
