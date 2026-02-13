import api from './axios';

const handle = async (requestFn, fallbackBuilder) => {
  try {
    const response = await requestFn();
    return response.data;
  } catch (error) {
    console.error('[libraryApi] request failed', error);
    if (typeof fallbackBuilder === 'function') {
      return fallbackBuilder(error);
    }
    throw error;
  }
};

export const fetchTree = (params) =>
  handle(() => api.get('/library/folders/tree', { params }), () => ({ tree: [] }));

export const fetchFolderContents = (folderId, params) =>
  handle(
    () => api.get(`/library/folders/${folderId || 'root'}/items`, { params }),
    () => ({
      breadcrumb: [],
      folders: [],
      items: []
    })
  );

export const searchLibrary = (params) =>
  handle(() => api.get('/library/search', { params }), () => ({ items: [] }));

export const requestShareAccess = (payload) =>
  handle(() => api.post('/library/shares/requests', payload));

export const fetchShareStatus = () =>
  handle(() => api.get('/library/shares/requests/me'), () => ({ permissions: [] }));

export const fetchDocumentPages = (itemId, params) =>
  handle(
    () => api.get(`/library/items/${itemId}/pages`, { params }),
    () => ({ pages: [], hasMore: false })
  );

export const fetchAnnotations = (itemId, pageNumber) =>
  handle(
    () => api.get(`/library/items/${itemId}/annotations/${pageNumber}`),
    () => ({ snapshot: null })
  );

export const saveAnnotations = (itemId, pageNumber, payload) =>
  handle(() => api.post(`/library/items/${itemId}/annotations/${pageNumber}`, payload));

export const clearAnnotations = (itemId, pageNumber) =>
  handle(() => api.delete(`/library/items/${itemId}/annotations/${pageNumber}`));

export const fetchDownloadTicket = (itemId, payload) =>
  handle(() => api.post(`/library/items/${itemId}/download-ticket`, payload));

// Admin helpers
export const createLibraryFolder = (payload) =>
  handle(() => api.post('/library/folders', payload));

export const updateLibraryFolder = (folderId, payload) =>
  handle(() => api.patch(`/library/folders/${folderId}`, payload));

export const deleteLibraryFolder = (folderId) =>
  handle(() => api.delete(`/library/folders/${folderId}`));

export const createLibraryItem = (payload) =>
  handle(() => api.post('/library/items', payload));

export const updateLibraryItem = (itemId, payload) =>
  handle(() => api.patch(`/library/items/${itemId}`, payload));

export const deleteLibraryItem = (itemId) =>
  handle(() => api.delete(`/library/items/${itemId}`));

export const uploadLibraryAsset = (formData) =>
  handle(() =>
    api.post('/library/items/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 10 * 60 * 1000
    })
  );

export const fetchLibraryStorageUsage = () =>
  handle(() => api.get('/library/storage/usage'));

export const listLibraryShareRequests = (params) =>
  handle(() => api.get('/library/shares/requests', { params }), () => ({ permissions: [] }));

export const decideLibraryShareRequest = (permissionId, payload) =>
  handle(() => api.post(`/library/shares/${permissionId}/decision`, payload));

export const revokeLibraryShare = (permissionId) =>
  handle(() => api.post(`/library/shares/${permissionId}/revoke`));
