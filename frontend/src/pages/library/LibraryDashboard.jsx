import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PencilLine, Trash2 } from 'lucide-react';
import DashboardLayout from '../../components/layout/DashboardLayout';
import FolderTree from '../../components/library/FolderTree';
import LibraryToolbar from '../../components/library/LibraryToolbar';
import LibraryBreadcrumbs from '../../components/library/LibraryBreadcrumbs';
import LibraryGrid from '../../components/library/LibraryGrid';
import ShareRequestModal from '../../components/library/ShareRequestModal';
import DocumentViewer from '../../components/library/DocumentViewer';
import WhiteboardModal from '../../components/library/WhiteboardModal';
import AddFileModal from '../../components/library/admin/AddFileModal';
import FolderModal from '../../components/library/admin/FolderModal';
import RenameModal from '../../components/library/admin/RenameModal';
import DeleteConfirmModal from '../../components/library/admin/DeleteConfirmModal';
import ShareQueueModal from '../../components/library/admin/ShareQueueModal';
import useLibraryData from '../../hooks/useLibraryData';
import { useAuth } from '../../contexts/AuthContext';
import { SearchProvider, useSearch } from '../../contexts/SearchContext';
import {
  createLibraryFolder,
  createLibraryItem,
  deleteLibraryFolder,
  deleteLibraryItem,
  updateLibraryFolder,
  updateLibraryItem,
  listLibraryShareRequests
} from '../../api/library';

const ADMIN_ACTION_GUIDE = {
  addFile: {
    title: 'Add a file to the current folder',
    summary: 'Upload the PDF/EPUB to Cloudinary, then register it through the library API.',
    steps: [
      'Select the destination folder in the tree so the breadcrumbs confirm the placement.',
      'Use the Cloudinary direct-upload workflow (or the `libraryStorageService` signature endpoint) to upload the asset and capture `public_id`, `resource_type`, `secure_url`, `bytes`, and `original_filename`.',
      'Call `POST /api/library/items` with `folder`, `displayName`, `description`, tags, and a `storage` object built from the Cloudinary response. Toggle `allowDownload`/`isSecret` as needed.',
      'Optionally call `PATCH /api/library/items/:itemId` to refine metadata (subjects, preview image, order index) after QA.',
      'Press Refresh in the toolbar to pull the server-confirmed copy into the grid.'
    ],
    api: ['POST /api/library/items', 'PATCH /api/library/items/:itemId']
  },
  deleteEntry: {
    title: 'Delete a file',
    summary: 'Removes the metadata row and the underlying Cloudinary asset.',
    steps: [
      'Open the folder that contains the target item and confirm nobody is actively using it.',
      'Call `DELETE /api/library/items/:itemId`. The service decrements folder stats and purges the Cloudinary public asset automatically.',
      'If you only want to hide it, prefer `PATCH /api/library/items/:itemId` with `status:"archived"` or `isSecret:true` instead.',
      'Refresh the folder or run a search to verify it no longer appears.'
    ],
    api: ['DELETE /api/library/items/:itemId', 'PATCH /api/library/items/:itemId']
  },
  renameEntry: {
    title: 'Rename a folder or file',
    summary: 'Updates `displayName` (and slug) without touching storage.',
    steps: [
      'Decide whether you are renaming a folder (subject/level) or an individual resource.',
      'Call `PATCH /api/library/folders/:folderId` or `PATCH /api/library/items/:itemId` with the new `displayName`, plus optional `orderIndex`, `subject`, or `level` tweaks.',
      'Because slugs are derived automatically, avoid reusing the same name in sibling folders to keep URLs unique.',
      'Refresh to ensure breadcrumbs, tree nodes, and the grid all reflect the new label.'
    ],
    api: ['PATCH /api/library/folders/:folderId', 'PATCH /api/library/items/:itemId']
  },
  createFolder: {
    title: 'Create a folder',
    summary: 'Adds a new subject/grade bucket anywhere in the tree.',
    steps: [
      'Highlight the parent folder in the tree (use ROOT for subjects that live at the top).',
      'Call `POST /api/library/folders` with `displayName`, optional `parentFolder`, `subject`, `level`, `orderIndex`, and `allowDownloads`.',
      'If the folder should stay private, send `isSecret:true` plus a `secretAccessList` seed.',
      'Refresh the tree to see the node and start dropping files inside it.'
    ],
    api: ['POST /api/library/folders']
  },
  removeFolder: {
    title: 'Remove a folder',
    summary: 'Deletes an empty folder after verifying it has no children or items.',
    steps: [
      'Confirm the folder has zero subfolders and zero items (the API enforces this and returns `FOLDER_NOT_EMPTY` otherwise).',
      'Call `DELETE /api/library/folders/:folderId`.',
      'If you need to retire it but keep historical files, prefer moving the content to an Archive folder instead.',
      'Refresh the tree to make sure the node disappeared.'
    ],
    api: ['DELETE /api/library/folders/:folderId']
  },
  manageAccess: {
    title: 'Grant or revoke access',
    summary: 'Work the approvals queue so teachers only see what they should.',
    steps: [
      'Open the admin queue via `GET /api/library/shares/requests` to review pending submissions (filter by `status` when needed).',
      'Approve or deny with `POST /api/library/shares/:permissionId/decision` and include `status` (`approved`, `denied`), `downloadAllowed`, `expiresAt`, and an optional note.',
      'To revoke later, call `POST /api/library/shares/:permissionId/revoke`; this switches the status to `revoked` and records an audit log entry.',
      'For secret folders, keep the `secretAccessList` in sync by PATCHing the folder when you add or remove long-term exceptions.'
    ],
    api: [
      'GET /api/library/shares/requests',
      'POST /api/library/shares/:permissionId/decision',
      'POST /api/library/shares/:permissionId/revoke'
    ]
  }
};

const LibraryDashboardContent = () => {
  const { user } = useAuth();
  const { searchTerm: globalSearchTerm, globalFilter } = useSearch();
  const [viewerItem, setViewerItem] = useState(null);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [adminGuideKey, setAdminGuideKey] = useState(null);
  const [activeModal, setActiveModal] = useState(null);
  const [pendingAdminCount, setPendingAdminCount] = useState(0);
  const {
    tree,
    folders,
    items,
    breadcrumb,
    activeFolder,
    isLoading,
    isTreeLoading,
    error,
    view,
    setView,
    loadFolder,
    refreshTree,
    refreshFolder,
    submitShareRequest,
    shareRequests,
    isShareSubmitting,
    refreshShareRequests
  } = useLibraryData({ searchTerm: globalSearchTerm, filter: globalFilter });

  const canManageLibrary = Boolean(user?.role === 'admin' || user?.permissions?.includes('library:manage'));

  const refreshPendingAdminRequests = useCallback(async () => {
    if (!canManageLibrary) {
      setPendingAdminCount(0);
      return;
    }
    try {
      const { permissions } = await listLibraryShareRequests({ status: 'pending' });
      setPendingAdminCount(permissions?.length || 0);
    } catch (requestError) {
      console.warn('Failed to load pending admin share requests', requestError);
    }
  }, [canManageLibrary]);

  useEffect(() => {
    if (!canManageLibrary) {
      setPendingAdminCount(0);
      return;
    }
    refreshPendingAdminRequests();
  }, [canManageLibrary, refreshPendingAdminRequests]);
  const activeAdminGuide = adminGuideKey ? ADMIN_ACTION_GUIDE[adminGuideKey] : null;
  const activeFolderId = activeFolder || 'root';

  const resolveFolderId = (folderRef) => {
    if (!folderRef) return null;
    if (typeof folderRef === 'string') return folderRef;
    return folderRef._id || folderRef.id || folderRef.folder || null;
  };

  const resolveItemId = (itemRef) => {
    if (!itemRef) return null;
    return itemRef.id || itemRef._id || itemRef.item || null;
  };

  const isValidObjectId = (value) => typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);

  const isSampleItem = (itemRef) => Boolean(itemRef?.__isSample);

  const closeActiveModal = useCallback(() => {
    setActiveModal(null);
  }, []);

  const openAdminModal = useCallback((guideKey, modalType, payload = null) => {
    if (guideKey) {
      setAdminGuideKey(guideKey);
    }
    if (modalType) {
      setActiveModal({ type: modalType, payload });
    } else {
      setActiveModal(null);
    }
  }, []);

  const flattenedTree = useMemo(() => tree || [], [tree]);

  const handleFolderClick = (folder) => {
    const folderId = resolveFolderId(folder) || 'root';
    loadFolder(folderId);
  };

  const handleBreadcrumbNav = (folderId) => {
    loadFolder(folderId || 'root');
  };

  const handleAddFileOpen = useCallback(() => {
    openAdminModal('addFile', 'addFile', { folderId: activeFolderId });
  }, [openAdminModal, activeFolderId]);

  const handleCreateFolderOpen = useCallback(() => {
    openAdminModal('createFolder', 'createFolder', { parentFolder: activeFolderId });
  }, [openAdminModal, activeFolderId]);

  const handleManageAccessOpen = useCallback(() => {
    refreshPendingAdminRequests();
    openAdminModal('manageAccess', 'manageAccess');
  }, [openAdminModal, refreshPendingAdminRequests]);

  const handleItemRenameRequest = useCallback(
    (item) => {
      openAdminModal('renameEntry', 'renameEntry', { entityType: 'item', entity: item });
    },
    [openAdminModal]
  );

  const handleItemDeleteRequest = useCallback(
    (item) => {
      openAdminModal('deleteEntry', 'deleteEntry', { entityType: 'item', entity: item });
    },
    [openAdminModal]
  );

  const handleFolderRenameRequest = useCallback(
    (folder) => {
      openAdminModal('renameEntry', 'renameEntry', { entityType: 'folder', entity: folder });
    },
    [openAdminModal]
  );

  const handleFolderDeleteRequest = useCallback(
    (folder) => {
      openAdminModal('removeFolder', 'deleteEntry', { entityType: 'folder', entity: folder });
    },
    [openAdminModal]
  );

  const submitCreateFolder = useCallback(
    async (payload) => {
      try {
        const responsePayload = {
          ...payload,
          parentFolder: payload.parentFolder && payload.parentFolder !== 'root' ? payload.parentFolder : null
        };
        await createLibraryFolder(responsePayload);
        await refreshTree();
        await refreshFolder(responsePayload.parentFolder || activeFolderId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message: error.response?.data?.message || 'Unable to create folder'
        };
      }
    },
    [refreshTree, refreshFolder, activeFolderId]
  );

  const submitAddFile = useCallback(
    async (payload) => {
      try {
        await createLibraryItem(payload);
        await refreshFolder(payload.folder || activeFolderId);
        await refreshTree();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message: error.response?.data?.message || 'Unable to add file'
        };
      }
    },
    [refreshFolder, refreshTree, activeFolderId]
  );

  const submitRename = useCallback(
    async (context, values) => {
      const { entityType, entity } = context || {};
      if (!entityType || !entity) {
        return { success: false, message: 'Missing target' };
      }
      if (entityType === 'item' && isSampleItem(entity)) {
        return { success: false, message: 'Connect to the live library data before renaming sample entries.' };
      }
      try {
        if (entityType === 'item') {
          const targetId = resolveItemId(entity);
          if (!isValidObjectId(targetId)) {
            return {
              success: false,
              message: 'This placeholder item cannot be renamed. Wait for the library API to load real data and try again.'
            };
          }
          await updateLibraryItem(targetId, {
            displayName: values.displayName,
            description: values.description
          });
          await refreshFolder(entity.folder || activeFolderId);
        } else {
          await updateLibraryFolder(resolveFolderId(entity), {
            displayName: values.displayName
          });
          await refreshTree();
          const targetId = resolveFolderId(entity);
          await loadFolder(targetId === activeFolderId ? targetId || 'root' : activeFolderId);
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message: error.response?.data?.message || 'Unable to rename entry'
        };
      }
    },
    [refreshFolder, refreshTree, loadFolder, activeFolderId]
  );

  const submitDelete = useCallback(
    async (context) => {
      const { entityType, entity } = context || {};
      if (!entityType || !entity) {
        return { success: false, message: 'Missing target' };
      }
      if (entityType === 'item' && isSampleItem(entity)) {
        return { success: false, message: 'Sample items cannot be deleted. Load the folder again once the API is reachable.' };
      }
      try {
        if (entityType === 'item') {
          const targetId = resolveItemId(entity);
          if (!isValidObjectId(targetId)) {
            return {
              success: false,
              message: 'Sample items can only be removed after the live library data loads.'
            };
          }
          await deleteLibraryItem(targetId);
          await refreshFolder(entity.folder || activeFolderId);
        } else {
          const folderId = resolveFolderId(entity);
          const parentId = resolveFolderId(entity.parentFolder) || null;
          await deleteLibraryFolder(folderId);
          await refreshTree();
          const nextFolderId = folderId === activeFolderId ? parentId || 'root' : activeFolderId;
          await loadFolder(nextFolderId || 'root');
        }
        return { success: true };
      } catch (error) {
        return {
          success: false,
          message: error.response?.data?.message || 'Unable to delete entry'
        };
      }
    },
    [refreshFolder, refreshTree, loadFolder, activeFolderId]
  );

  const handleShareQueueUpdated = useCallback(async () => {
    await refreshShareRequests();
    await refreshPendingAdminRequests();
  }, [refreshShareRequests, refreshPendingAdminRequests]);

  const pendingAccess = shareRequests?.filter((request) => request.status === 'pending') || [];

  return (
    <DashboardLayout activeView="library" provideSearchContext={false}>
      <div className="grid gap-4 p-4 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-4">
          <FolderTree tree={tree} activeFolder={activeFolder} onSelect={handleFolderClick} />
          {isTreeLoading && (
            <p className="text-xs text-muted-foreground">Refreshing folders…</p>
          )}

          <div className="rounded-2xl border border-border bg-card/70 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-foreground">Access status</h3>
            {canManageLibrary ? (
              <p className="mt-2 text-xs text-emerald-700">
                {pendingAdminCount
                  ? `${pendingAdminCount} access request${pendingAdminCount > 1 ? 's' : ''} awaiting approval.`
                  : 'No pending approvals right now.'}
              </p>
            ) : pendingAccess.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Pending approval for {pendingAccess.length} request{pendingAccess.length > 1 ? 's' : ''}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No pending requests.</p>
            )}
            {!canManageLibrary && (
              <button
                type="button"
                onClick={() => setShareModalOpen(true)}
                className="mt-3 inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Request access
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <LibraryBreadcrumbs breadcrumb={breadcrumb} onNavigate={handleBreadcrumbNav} />
          <LibraryToolbar
            view={view}
            onViewChange={setView}
            onRefresh={() => loadFolder(activeFolderId)}
            onOpenShareModal={() => setShareModalOpen(true)}
            pendingRequests={shareRequests}
            managePendingCount={pendingAdminCount}
            isAdmin={canManageLibrary}
            onAddFile={handleAddFileOpen}
            onCreateFolder={handleCreateFolderOpen}
            onManageAccess={handleManageAccessOpen}
            onOpenWhiteboard={() => setWhiteboardOpen(true)}
          />

          {folders.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {folders.map((folder) => (
                <div
                  key={resolveFolderId(folder) || folder.displayName}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-card pr-1 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => handleFolderClick(folder)}
                    className="inline-flex items-center gap-2 rounded-full bg-transparent px-3 py-1 text-xs"
                  >
                    {folder.displayName}
                  </button>
                  {canManageLibrary && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleFolderRenameRequest(folder);
                        }}
                        className="rounded-full p-1 text-muted-foreground hover:bg-muted"
                        title="Rename folder"
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleFolderDeleteRequest(folder);
                        }}
                        className="rounded-full p-1 text-red-600 hover:bg-red-50"
                        title="Delete folder"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {isLoading && (
            <div className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
              Loading folder…
            </div>
          )}

          <LibraryGrid
            items={items}
            view={view}
            onOpen={setViewerItem}
            isAdmin={canManageLibrary}
            onRenameItem={handleItemRenameRequest}
            onDeleteItem={handleItemDeleteRequest}
          />
        </div>
      </div>

      <ShareRequestModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        onSubmit={submitShareRequest}
        folders={flattenedTree}
        isSubmitting={isShareSubmitting}
      />

      {canManageLibrary && activeModal?.type === 'addFile' && (
        <AddFileModal
          open
          onClose={closeActiveModal}
          onSubmit={submitAddFile}
          folders={flattenedTree}
          defaultFolder={activeModal.payload?.folderId || activeFolderId}
        />
      )}

      {canManageLibrary && activeModal?.type === 'createFolder' && (
        <FolderModal
          open
          onClose={closeActiveModal}
          onSubmit={submitCreateFolder}
          folders={flattenedTree}
          defaultParent={activeModal.payload?.parentFolder || activeFolderId}
        />
      )}

      {canManageLibrary && activeModal?.type === 'renameEntry' && (
        <RenameModal
          open
          onClose={closeActiveModal}
          onSubmit={(values) => submitRename(activeModal.payload, values)}
          entityType={activeModal.payload?.entityType}
          entity={activeModal.payload?.entity}
        />
      )}

      {canManageLibrary && activeModal?.type === 'deleteEntry' && (
        <DeleteConfirmModal
          open
          onClose={closeActiveModal}
          onConfirm={() => submitDelete(activeModal.payload)}
          entityType={activeModal.payload?.entityType}
          entity={activeModal.payload?.entity}
        />
      )}

      {canManageLibrary && activeModal?.type === 'manageAccess' && (
        <ShareQueueModal
          open
          onClose={closeActiveModal}
          onUpdated={handleShareQueueUpdated}
        />
      )}

      {viewerItem && <DocumentViewer item={viewerItem} onClose={() => setViewerItem(null)} />}
      {whiteboardOpen && <WhiteboardModal open onClose={() => setWhiteboardOpen(false)} />}
    </DashboardLayout>
  );
};

const LibraryDashboard = () => (
  <SearchProvider>
    <LibraryDashboardContent />
  </SearchProvider>
);

export default LibraryDashboard;
