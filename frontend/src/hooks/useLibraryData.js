import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchTree,
  fetchFolderContents,
  searchLibrary,
  requestShareAccess,
  fetchShareStatus
} from '../api/library';
import { makeCacheKey, readCache, writeCache } from '../utils/sessionCache';

const debounce = (fn, delay = 300) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

export const useLibraryData = ({ searchTerm: externalSearchTerm = '', filter: externalFilter = 'all' } = {}) => {
  const { user } = useAuth();
  const [tree, setTree] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [view, setView] = useState('grid');
  const [isLoading, setIsLoading] = useState(false);
    const searchQuery = (externalSearchTerm || '').trim();
    const appliedFilter = externalFilter || 'all';

  const [error, setError] = useState(null);
  const [shareRequests, setShareRequests] = useState([]);
  const [isShareSubmitting, setIsShareSubmitting] = useState(false);
  const [isTreeLoading, setIsTreeLoading] = useState(false);

  const debouncedSearchRef = useRef(null);
  const itemsRef = useRef([]);
  const foldersRef = useRef([]);

  useEffect(() => {
    itemsRef.current = items || [];
  }, [items]);

  useEffect(() => {
    foldersRef.current = folders || [];
  }, [folders]);

  const hydrateTree = useCallback(async () => {
    try {
      setIsTreeLoading(true);

      const cacheKey = makeCacheKey('library:tree', user?._id, { kind: 'tree' });
      const cached = readCache(cacheKey, { deps: ['library'] });
      if (cached.hit && cached.value) {
        return cached.value?.length ? cached.value : [];
      }

      const { tree: apiTree } = await fetchTree();
      const nextTree = apiTree?.length ? apiTree : [];
      writeCache(cacheKey, nextTree, { ttlMs: 10 * 60_000, deps: ['library'] });
      return nextTree;
    } finally {
      setIsTreeLoading(false);
    }
  }, [user?._id]);

  const loadFolder = useCallback(async (folderId = 'root', options = {}) => {
    const hasExisting = (itemsRef.current || []).length > 0 || (foldersRef.current || []).length > 0;
    setIsLoading(!hasExisting);
    setError(null);
    try {
      const cacheKey = makeCacheKey('library:folder', user?._id, { folderId, options });
      const cached = readCache(cacheKey, { deps: ['library'] });
      if (cached.hit && cached.value) {
        const response = cached.value;
        const nextBreadcrumb = response.breadcrumb?.length ? response.breadcrumb : [];
        const nextFolders = response.folders?.length ? response.folders : [];
        const nextItems = Array.isArray(response.items) ? response.items : [];
        setActiveFolder(folderId);
        setBreadcrumb(nextBreadcrumb);
        setFolders(nextFolders);
        setItems(nextItems);
        setIsLoading(false);

        if (cached.ageMs < 60_000) return;
      }

      const response = await fetchFolderContents(folderId, options);
      const nextBreadcrumb = response.breadcrumb?.length ? response.breadcrumb : [];
      const nextFolders = response.folders?.length ? response.folders : [];
      const nextItems = Array.isArray(response.items) ? response.items : [];
      setActiveFolder(folderId);
      setBreadcrumb(nextBreadcrumb);
      setFolders(nextFolders);
      setItems(nextItems);

      writeCache(cacheKey, response, { ttlMs: 10 * 60_000, deps: ['library'] });
    } catch (err) {
      console.error('Failed to load folder', err);
      setError('Unable to load folder');
      setFolders([]);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [user?._id]);

  const hydrateShareRequests = useCallback(async () => {
    try {
      const response = await fetchShareStatus();
      setShareRequests(response.permissions || response.requests || []);
    } catch (err) {
      console.warn('Failed to fetch share status', err);
      setShareRequests([]);
    }
  }, []);

  const handleSearch = useCallback(async (term) => {
    const nextTerm = (term || '').trim();
    if (!nextTerm) {
      loadFolder(activeFolder || 'root');
      return;
    }
    const hasExisting = (itemsRef.current || []).length > 0;
    setIsLoading(!hasExisting);
    try {
      const cacheKey = makeCacheKey('library:search', user?._id, { q: nextTerm });
      const cached = readCache(cacheKey, { deps: ['library'] });
      if (cached.hit && cached.value) {
        setItems(cached.value || []);
        setFolders([]);
        setBreadcrumb([]);
        setIsLoading(false);
        if (cached.ageMs < 60_000) return;
      }

      const { items: results } = await searchLibrary({ q: nextTerm });
      setItems(results || []);
      setFolders([]);
      setBreadcrumb([]);

      writeCache(cacheKey, results || [], { ttlMs: 10 * 60_000, deps: ['library'] });
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeFolder, loadFolder, user?._id]);

  const refreshTree = useCallback(async () => {
    const nextTree = await hydrateTree();
    setTree(nextTree);
    return nextTree;
  }, [hydrateTree]);

  const refreshFolder = useCallback(async (folderId = null) => {
    await loadFolder(folderId || activeFolder || 'root');
  }, [loadFolder, activeFolder]);

  const refreshShareRequests = useCallback(async () => {
    await hydrateShareRequests();
  }, [hydrateShareRequests]);

  useEffect(() => {
    const run = async () => {
      await refreshTree();
      await loadFolder('root');
      await hydrateShareRequests();
    };
    run();
  }, [refreshTree, loadFolder, hydrateShareRequests]);

  useEffect(() => {
    debouncedSearchRef.current = debounce(handleSearch, 350);
  }, [handleSearch]);

  useEffect(() => {
    if (!debouncedSearchRef.current) return;
    debouncedSearchRef.current(searchQuery);
  }, [searchQuery]);

  const submitShareRequest = useCallback(async (payload) => {
    setIsShareSubmitting(true);
    try {
      await requestShareAccess(payload);
      await hydrateShareRequests();
      return { success: true };
    } catch (errorRequest) {
      console.error('Share request failed', errorRequest);
      return { success: false, message: errorRequest.response?.data?.message || 'Request failed' };
    } finally {
      setIsShareSubmitting(false);
    }
  }, [hydrateShareRequests]);

  const folderLookup = useMemo(() => {
    const map = new Map();
    const traverse = (nodes, ancestors = []) => {
      nodes.forEach((node) => {
        map.set(node._id || node.id, { ...node, ancestors });
        if (node.children?.length) {
          traverse(node.children, [...ancestors, node]);
        }
      });
    };
    traverse(tree);
    return map;
  }, [tree]);

  const activeBreadcrumb = useMemo(() => {
    if (breadcrumb.length) return breadcrumb;
    if (!activeFolder || !folderLookup.has(activeFolder)) return [];
    const node = folderLookup.get(activeFolder);
    return [...node.ancestors, node].map((entry) => ({
      folder: entry._id,
      displayName: entry.displayName
    }));
  }, [activeFolder, breadcrumb, folderLookup]);

  const visibleItems = useMemo(() => {
    const applyFilter = (list) => {
      if (appliedFilter === 'downloadable') {
        return list.filter((item) => item.allowDownload);
      }
      if (appliedFilter === 'view-only') {
        return list.filter((item) => item.allowDownload === false);
      }
      if (appliedFilter === 'secret') {
        return list.filter((item) => item.isSecret);
      }
      return list;
    };

    if (!searchQuery) {
      return applyFilter(items);
    }

    const term = searchQuery.toLowerCase();
    const searched = items.filter((item) =>
      item.displayName?.toLowerCase().includes(term) ||
      item.description?.toLowerCase().includes(term) ||
      item.subject?.toLowerCase().includes(term)
    );
    return applyFilter(searched);
  }, [items, searchQuery, appliedFilter]);

  return {
    tree,
    folders,
    items: visibleItems,
    breadcrumb: activeBreadcrumb,
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
  };
};

export default useLibraryData;
