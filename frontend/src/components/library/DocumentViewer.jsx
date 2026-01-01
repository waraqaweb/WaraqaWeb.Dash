import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Loader2, X } from 'lucide-react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import AnnotationToolbar from './AnnotationToolbar';
import api from '../../api/axios';
import {
  fetchDocumentPages,
  fetchAnnotations,
  saveAnnotations,
  fetchDownloadTicket
} from '../../api/library';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const SVG_WIDTH = 800;
const SVG_HEIGHT = 1100;

const DEFAULT_PEN_OPACITY = 0.9;
const DEFAULT_HIGHLIGHT_OPACITY = 0.35;
const DEFAULT_SHAPE_OPACITY = 0.85;
const INLINE_RENDER_PAGE_LIMIT = 12;
const INLINE_RENDER_SCALE = 1.4;
const PAGES_BATCH_SIZE = 6;
const SIDEBAR_PREFETCH_THRESHOLD_PX = 600;

const baseExtras = () => ({ shapes: [] });

const createPageState = () => ({
  paths: [],
  texts: [],
  extras: baseExtras(),
  history: [],
  redo: []
});

const createId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `anno-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const ensureArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.values(value);
  return [];
};

const sanitizePoint = (point = {}) => ({
  x: Number.isFinite(point.x) ? point.x : Number(point.x) || 0,
  y: Number.isFinite(point.y) ? point.y : Number(point.y) || 0
});

const sanitizePoints = (points) =>
  ensureArray(points)
    .map(sanitizePoint)
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

const deriveOpacityFromTool = (tool, candidate) => {
  if (typeof candidate === 'number') return candidate;
  if (tool === 'highlighter') return DEFAULT_HIGHLIGHT_OPACITY;
  return DEFAULT_PEN_OPACITY;
};

const cloneAnnotationState = (state = createPageState()) => ({
  paths: state?.paths?.map((path) => ({
    ...path,
    points: sanitizePoints(path.points)
  })) || [],
  texts: state?.texts?.map((text) => ({ ...text })) || [],
  extras: {
    ...(state?.extras || baseExtras()),
    shapes: state?.extras?.shapes?.map((shape) => ({ ...shape })) || []
  }
});

const normalizeStrokeEntry = (entry = {}) => {
  if (!entry) return null;
  const tool = entry.tool || entry.type || 'pen';
  const points = sanitizePoints(entry.points || entry.path);
  if (!points.length) return null;
  return {
    id: entry.id || entry._id || createId(),
    tool,
    color: entry.color || entry.stroke || '#f97316',
    size: Number(entry.size || entry.strokeWidth || 4),
    opacity: deriveOpacityFromTool(tool, entry.opacity),
    points
  };
};

const normalizeTextEntry = (entry = {}) => ({
  id: entry.id || entry._id || createId(),
  text: entry.text || entry.value || '',
  x: Number(entry.x ?? entry.position?.x ?? 0) || 0,
  y: Number(entry.y ?? entry.position?.y ?? 0) || 0,
  color: entry.color || '#f97316',
  fontSize: Number(entry.fontSize || entry.size || 18)
});

const normalizeShapeEntry = (entry = {}) => {
  const startX = Number(entry.x ?? entry.left ?? entry.start?.x ?? entry.origin?.x ?? 0) || 0;
  const startY = Number(entry.y ?? entry.top ?? entry.start?.y ?? entry.origin?.y ?? 0) || 0;
  const pointList = ensureArray(entry.points);
  const referencePoint = pointList[1] || pointList[0] || {};
  const widthCandidate =
    entry.width ??
    entry.w ??
    (entry.end?.x ?? entry.bottomRight?.x ?? referencePoint.x ?? startX) - startX;
  const heightCandidate =
    entry.height ??
    entry.h ??
    (entry.end?.y ?? entry.bottomRight?.y ?? referencePoint.y ?? startY) - startY;
  const width = Number(widthCandidate) || 0;
  const height = Number(heightCandidate) || 0;
  const normalizedWidth = Math.abs(width);
  const normalizedHeight = Math.abs(height);
  const x = width >= 0 ? startX : startX + width;
  const y = height >= 0 ? startY : startY + height;
  return {
    id: entry.id || entry._id || createId(),
    type: entry.type || entry.shape || 'rectangle',
    color: entry.color || '#f97316',
    size: Number(entry.size || entry.strokeWidth || 3),
    opacity: typeof entry.opacity === 'number' ? entry.opacity : DEFAULT_SHAPE_OPACITY,
    x,
    y,
    width: normalizedWidth,
    height: normalizedHeight
  };
};

const normalizeExtras = (extras) => {
  if (!extras || typeof extras !== 'object') {
    return baseExtras();
  }
  const normalized = { ...extras };
  normalized.shapes = ensureArray(extras.shapes)
    .map(normalizeShapeEntry)
    .filter((shape) => shape.width > 0.5 || shape.height > 0.5);
  return normalized;
};

const upgradeCachedState = (state) => {
  if (!state || typeof state !== 'object') return createPageState();
  return {
    paths: (state.paths || [])
      .map((path) => normalizeStrokeEntry({ ...path }))
      .filter((entry) => Boolean(entry)),
    texts: (state.texts || []).map((text) => normalizeTextEntry(text)),
    extras: normalizeExtras(state.extras),
    history: Array.isArray(state.history)
      ? state.history.map((snapshot) => cloneAnnotationState(snapshot))
      : [],
    redo: Array.isArray(state.redo)
      ? state.redo.map((snapshot) => cloneAnnotationState(snapshot))
      : []
  };
};

const createStateFromSnapshot = (snapshot) => {
  if (!snapshot || !snapshot.payload) {
    return createPageState();
  }
  const { payload } = snapshot;
  return {
    paths: ensureArray(payload.strokes)
      .map((entry) => normalizeStrokeEntry(entry))
      .filter((entry) => Boolean(entry)),
    texts: ensureArray(payload.textEntries).map((entry) => normalizeTextEntry(entry)),
    extras: normalizeExtras(payload.extras),
    history: [],
    redo: []
  };
};

const encodeCollection = (items = [], formatter) =>
  items.reduce((acc, item) => {
    if (!item) return acc;
    const key = item.id || item._id || createId();
    acc[key] = formatter(item, key);
    return acc;
  }, {});

const serializePageState = (state) => ({
  strokes: encodeCollection(state?.paths || [], (path) => ({
    tool: path.tool || 'pen',
    color: path.color,
    size: Number(path.size) || 4,
    opacity: deriveOpacityFromTool(path.tool, path.opacity),
    points: sanitizePoints(path.points)
  })),
  textEntries: encodeCollection(state?.texts || [], (text) => ({
    text: text.text,
    color: text.color,
    fontSize: Number(text.fontSize) || 18,
    x: Number(text.x) || 0,
    y: Number(text.y) || 0
  })),
  extras: (() => {
    const extras = { ...(state?.extras || {}) };
    const shapes = state?.extras?.shapes || [];
    if (shapes.length) {
      extras.shapes = encodeCollection(shapes, (shape) => ({
        type: shape.type || 'rectangle',
        color: shape.color,
        opacity: typeof shape.opacity === 'number' ? shape.opacity : DEFAULT_SHAPE_OPACITY,
        size: Number(shape.size) || 3,
        x: Number(shape.x) || 0,
        y: Number(shape.y) || 0,
        width: Number(shape.width) || 0,
        height: Number(shape.height) || 0
      }));
    } else {
      delete extras.shapes;
    }
    return extras;
  })()
});

const shapeDraftToRect = (shape) => {
  if (!shape?.start || !shape?.current) return null;
  const x = Math.min(shape.start.x, shape.current.x);
  const y = Math.min(shape.start.y, shape.current.y);
  const width = Math.abs(shape.start.x - shape.current.x);
  const height = Math.abs(shape.start.y - shape.current.y);
  return { x, y, width, height };
};

const pointsToPath = (points = []) => {
  if (!points.length) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y}`;
  }
  let d = '';
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    if (i === 0) {
      d += `M ${current.x} ${current.y}`;
    }
    d += ` Q ${current.x} ${current.y} ${midX} ${midY}`;
  }
  return d;
};

const buildPlaceholderDataUrl = (label) => {
  const safeLabel = String(label || 'Loading…');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="#0f172a"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial" font-size="72" fill="#ffffff">${safeLabel}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const buildPlaceholderPages = (count = 6, startPageNumber = 1) =>
  Array.from({ length: count }).map((_, index) => {
    const pageNumber = startPageNumber + index;
    return {
      pageNumber,
      imageUrl: buildPlaceholderDataUrl(`Page ${pageNumber}`)
    };
  });

const DocumentViewer = ({ item, onClose }) => {
  const itemId = useMemo(
    () => item?._id || item?.id || item?.itemId || item?.item || null,
    [item]
  );
  const [pages, setPages] = useState([]);
  const [pageCursor, setPageCursor] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [activePage, setActivePage] = useState(1);
  const [loadingPages, setLoadingPages] = useState(false);
  const [annotationCache, setAnnotationCache] = useState({});
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#f97316');
  const [size, setSize] = useState(4);
  const [fontSize, setFontSize] = useState(18);
  const [persisting, setPersisting] = useState(false);
  const [jumpValue, setJumpValue] = useState('');
  const [liveStroke, setLiveStroke] = useState(null);
  const [liveShape, setLiveShape] = useState(null);
  const [previewMode, setPreviewMode] = useState('pages');
  const [inlineUrl, setInlineUrl] = useState(null);
  const [inlineBlobUrl, setInlineBlobUrl] = useState(null);
  const [inlineLoading, setInlineLoading] = useState(false);
  const [inlineError, setInlineError] = useState(null);
  const [inlineRenderAttempted, setInlineRenderAttempted] = useState(false);
  const [inlineRenderState, setInlineRenderState] = useState({ status: 'idle', error: null });
  const [inlineRenderProgress, setInlineRenderProgress] = useState({ current: 0, total: 0 });
  const [inlineFirstPageImage, setInlineFirstPageImage] = useState(null);
  const [inlineRenderRequested, setInlineRenderRequested] = useState(false);
  const [inlineDownloadProgress, setInlineDownloadProgress] = useState({ loaded: 0, total: 0 });
  const [, setClientRenderedPdf] = useState(false);

  const inlinePdfBufferRef = useRef(null);

  const listRef = useRef(null);
  const svgRef = useRef(null);
  const drawingRef = useRef(false);

  const cleanupInlineBlobUrl = useCallback(() => {
    setInlineBlobUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch (e) {
          // ignore
        }
      }
      return null;
    });
  }, []);

  const resolveInlineErrorMessage = (error) => {
    if (!error) return 'Unable to load the document preview.';
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      return 'Preview failed due to authorization. Try Download to open it directly.';
    }
    if (error?.message) return error.message;
    return 'Unable to load the document preview.';
  };

  const downloadPdfArrayBuffer = useCallback(async (url) => {
    if (!url) throw new Error('Preview link missing.');
    const resolved = new URL(url, window.location.href);
    const sameOrigin = resolved.origin === window.location.origin;
    const apiBase = String(api?.defaults?.baseURL || '').replace(/\/$/, '');
    const isApiUrl = apiBase ? resolved.toString().startsWith(apiBase) : false;

    // If the URL is same-origin (often an API route), use Axios so the Bearer token
    // is attached. Iframes/fetch cannot attach Authorization reliably.
    // Also use Axios for our API base even when cross-origin in local dev (3000 -> 5000).
    if (sameOrigin || isApiUrl) {
      setInlineDownloadProgress({ loaded: 0, total: 0 });
      const res = await api.get(resolved.toString(), {
        responseType: 'arraybuffer',
        // Large PDFs can exceed the global API timeout (60s), especially in production
        // where the backend may proxy from remote storage.
        timeout: 5 * 60_000,
        headers: {
          Accept: 'application/pdf,*/*'
        },
        onDownloadProgress: (evt) => {
          const loaded = typeof evt?.loaded === 'number' ? evt.loaded : 0;
          const total = typeof evt?.total === 'number' ? evt.total : 0;
          setInlineDownloadProgress({ loaded, total });
        }
      });
      return res.data;
    }

    // Cross-origin (usually a signed URL). Use fetch without credentials.
    const response = await fetch(resolved.toString(), {
      credentials: 'omit',
      headers: {
        Accept: 'application/pdf,*/*'
      }
    });
    if (!response.ok) {
      throw new Error(`PDF download failed with status ${response.status}`);
    }
    return response.arrayBuffer();
  }, []);

  const prepareInlineBlobPreview = useCallback(async (url) => {
    cleanupInlineBlobUrl();
    inlinePdfBufferRef.current = null;
    setInlineFirstPageImage(null);
    const pdfBuffer = await downloadPdfArrayBuffer(url);
    inlinePdfBufferRef.current = pdfBuffer;
    try {
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      setInlineBlobUrl(objectUrl);
      return objectUrl;
    } catch (e) {
      return null;
    }
  }, [cleanupInlineBlobUrl, downloadPdfArrayBuffer]);

  const ensureInlinePreview = useCallback(async () => {
    if (!itemId) return;
    setInlineLoading(true);
    setInlineError(null);
    setInlineRenderProgress({ current: 0, total: 0 });
    setInlineFirstPageImage(null);
    setInlineDownloadProgress({ loaded: 0, total: 0 });
    try {
      const apiBase = String(api?.defaults?.baseURL || '').replace(/\/$/, '');

      // Local dev often runs on a different origin (3000 -> 5000) and nginx sets
      // X-Frame-Options=SAMEORIGIN in prod-like setups, which breaks embedding.
      // For dev, keep the blob path.
      const apiOrigin = apiBase ? new URL(apiBase, window.location.href).origin : window.location.origin;
      const isCrossOriginDev = Boolean(apiBase) && apiOrigin !== window.location.origin;

      if (isCrossOriginDev) {
        const proxyUrl = `${apiBase}/library/items/${encodeURIComponent(itemId)}/preview?attachment=false`;
        setInlineUrl(proxyUrl);
        try {
          await prepareInlineBlobPreview(proxyUrl);
        } catch (err) {
          console.warn('Inline blob preview failed', err);
          cleanupInlineBlobUrl();
          inlinePdfBufferRef.current = null;
          setInlineError('Unable to load the document preview. Click Download to open it directly.');
        }
        return;
      }

      // Production (same-origin): request a tokenized URL and let the browser PDF viewer
      // stream/range-request it. This avoids downloading the entire book before scrolling.
      const ticket = await fetchDownloadTicket(itemId, { attachment: false });
      const streamUrl = ticket?.url;
      if (!streamUrl) {
        throw new Error('Preview link missing.');
      }
      cleanupInlineBlobUrl();
      inlinePdfBufferRef.current = null;
      setInlineBlobUrl(null);
      setInlineUrl(streamUrl);
    } catch (error) {
      console.error('Inline preview failed', error);
      setInlineError(`${resolveInlineErrorMessage(error)} Click Download to open it directly.`);
      setInlineUrl(null);
      cleanupInlineBlobUrl();
      inlinePdfBufferRef.current = null;
      setInlineFirstPageImage(null);
    } finally {
      setInlineLoading(false);
    }
  }, [cleanupInlineBlobUrl, itemId, prepareInlineBlobPreview]);

  const loadPages = useCallback(async (page = 1) => {
    if (!itemId) return;
    setLoadingPages(true);
    try {
      const response = await fetchDocumentPages(itemId, { page, limit: PAGES_BATCH_SIZE });
      const total = typeof response.total === 'number' ? response.total : null;
      const receivedPages = Array.isArray(response.pages) ? response.pages : [];
      const hasServerPages = receivedPages.length > 0;
      if (page === 1 && total === 0 && !hasServerPages) {
        setPreviewMode('inline');
        setPages([]);
        setHasMore(false);
        setPageCursor(1);
        setClientRenderedPdf(false);
        setInlineRenderAttempted(false);
        setInlineRenderRequested(false);
        setInlineRenderState({ status: 'idle', error: null });
        ensureInlinePreview();
        return;
      }
      setPreviewMode('pages');
      setClientRenderedPdf(false);
      const nextPages = hasServerPages
        ? receivedPages
        : buildPlaceholderPages(PAGES_BATCH_SIZE, (page - 1) * PAGES_BATCH_SIZE + 1);
      setPages((prev) => {
        const merged = [...prev];
        nextPages.forEach((entry) => {
          if (!merged.find((existing) => existing.pageNumber === entry.pageNumber)) {
            merged.push(entry);
          }
        });
        return merged.sort((a, b) => a.pageNumber - b.pageNumber);
      });

      const resolvedHasMore =
        typeof response.hasMore === 'boolean'
          ? response.hasMore
          : typeof total === 'number' && total > 0
            ? page * PAGES_BATCH_SIZE < total
            : receivedPages.length >= PAGES_BATCH_SIZE;

      setHasMore(resolvedHasMore);
      setPageCursor(page);
      if (!response.pages?.length && page === 1) {
        setHasMore(false);
      }
    } catch (error) {
      console.error('Failed to fetch pages', error);
      setPages((prev) => (prev.length ? prev : buildPlaceholderPages()));
      setHasMore(false);
    } finally {
      setLoadingPages(false);
    }
  }, [itemId, ensureInlinePreview]);

  useEffect(() => {
    if (!itemId) return;
    setPages([]);
    setAnnotationCache({});
    setActivePage(1);
    setPreviewMode('pages');
    setInlineUrl(null);
    cleanupInlineBlobUrl();
    inlinePdfBufferRef.current = null;
    setInlineError(null);
    setInlineRenderAttempted(false);
    setInlineRenderState({ status: 'idle', error: null });
    setClientRenderedPdf(false);
    loadPages(1);
    try {
      const stored = sessionStorage.getItem(`libraryAnnotations:${itemId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          const upgraded = Object.entries(parsed).reduce((acc, [pageNumber, snapshot]) => {
            acc[pageNumber] = upgradeCachedState(snapshot);
            return acc;
          }, {});
          setAnnotationCache(upgraded);
        }
      }
    } catch (err) {
      console.warn('Failed to restore annotation cache', err);
    }
  }, [cleanupInlineBlobUrl, itemId, loadPages]);

  useEffect(() => {
    return () => {
      cleanupInlineBlobUrl();
    };
  }, [cleanupInlineBlobUrl]);

  useEffect(() => {
    if (!itemId) return;
    sessionStorage.setItem(`libraryAnnotations:${itemId}`, JSON.stringify(annotationCache));
  }, [annotationCache, itemId]);

  useEffect(() => {
    if (previewMode !== 'inline' || !inlineUrl || !inlineRenderRequested || inlineRenderAttempted) return;
    let cancelled = false;
    let loadingTask;
    const controller = new AbortController();

    const downloadInlinePdf = async () => {
      if (inlinePdfBufferRef.current) return inlinePdfBufferRef.current;
      // Note: AbortController does not cancel axios; fetch path handles cancellation.
      const resolved = new URL(inlineUrl, window.location.href);
      const sameOrigin = resolved.origin === window.location.origin;
      const apiBase = String(api?.defaults?.baseURL || '').replace(/\/$/, '');
      const isApiUrl = apiBase ? resolved.toString().startsWith(apiBase) : false;

      if (sameOrigin || isApiUrl) {
        const res = await api.get(resolved.toString(), {
          responseType: 'arraybuffer',
          headers: { Accept: 'application/pdf,*/*' }
        });
        inlinePdfBufferRef.current = res.data;
        return res.data;
      }

      const response = await fetch(resolved.toString(), {
        credentials: 'omit',
        signal: controller.signal,
        headers: { Accept: 'application/pdf,*/*' }
      });
      if (!response.ok) throw new Error(`PDF download failed with status ${response.status}`);
      const buf = await response.arrayBuffer();
      inlinePdfBufferRef.current = buf;
      return buf;
    };

    const renderInlineDocument = async () => {
      setInlineRenderAttempted(true);
      setInlineRenderState({ status: 'rendering', error: null });
      try {
        const pdfBuffer = await downloadInlinePdf();
        if (cancelled) return;
        loadingTask = getDocument({ data: pdfBuffer });
        const pdf = await loadingTask.promise;
        const totalPages = pdf.numPages || 0;
        const safeTotal = typeof totalPages === 'number' && totalPages > 0 ? totalPages : 0;
        if (safeTotal === 0) {
          if (typeof pdf.cleanup === 'function') {
            pdf.cleanup();
          }
          setInlineRenderState({
            status: 'error',
            error: 'This PDF did not return any renderable pages.'
          });
          return;
        }
        const limit = Math.min(safeTotal, INLINE_RENDER_PAGE_LIMIT);
        const generated = [];
        setInlineRenderProgress({ current: 0, total: limit });

        for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
          if (cancelled) break;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: INLINE_RENDER_SCALE });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          await page.render({ canvasContext: context, viewport }).promise;
          const imageUrl = canvas.toDataURL('image/png');
          generated.push({
            pageNumber,
            imageUrl
          });
          if (pageNumber === 1) {
            setInlineFirstPageImage(imageUrl);
          }
          setInlineRenderProgress({ current: pageNumber, total: limit });
          canvas.width = 0;
          canvas.height = 0;
        }

        if (typeof pdf.cleanup === 'function') {
          pdf.cleanup();
        }

        if (cancelled) return;
        if (generated.length) {
          setPages(generated);
          setHasMore(false);
          setPageCursor(1);
          setActivePage(1);
          setPreviewMode('pages');
          setClientRenderedPdf(true);
          setInlineRenderState({ status: 'complete', error: null });
        } else {
          setInlineRenderState({
            status: 'error',
            error: 'Could not generate page previews for annotation.'
          });
        }
      } catch (error) {
        if (cancelled || error?.name === 'AbortError') {
          return;
        }
        console.error('Client-side PDF render failed', error);
        setInlineRenderState({
          status: 'error',
          error: resolveInlineErrorMessage(error)
        });
        setInlineRenderProgress({ current: 0, total: 0 });
      } finally {
        if (loadingTask) {
          loadingTask.destroy();
        }
      }
    };

    renderInlineDocument();
    return () => {
      cancelled = true;
      controller.abort();
      if (loadingTask) {
        loadingTask.destroy();
      }
    };
  }, [previewMode, inlineUrl, inlineRenderRequested, inlineRenderAttempted]);

  useEffect(() => {
    if (!itemId || previewMode === 'inline') return;
    if (annotationCache[activePage]) return;
    let cancelled = false;
    const fetchPayload = async () => {
      try {
        const response = await fetchAnnotations(itemId, activePage);
        if (cancelled) return;
        const normalized = createStateFromSnapshot(response.snapshot);
        setAnnotationCache((prev) => ({ ...prev, [activePage]: normalized }));
      } catch (error) {
        console.warn('Annotation fetch failed', error);
        if (!cancelled) {
          setAnnotationCache((prev) => ({ ...prev, [activePage]: createPageState() }));
        }
      }
    };
    fetchPayload();
    return () => { cancelled = true; };
  }, [activePage, annotationCache, itemId, previewMode]);

  const activeAnnotations = annotationCache[activePage] || createPageState();

  const handleScroll = useCallback(() => {
    if (!hasMore || loadingPages || !listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const threshold = Math.max(SIDEBAR_PREFETCH_THRESHOLD_PX, clientHeight * 1.5);
    if (scrollHeight - scrollTop - clientHeight < threshold) {
      loadPages(pageCursor + 1);
    }
  }, [hasMore, loadingPages, loadPages, pageCursor]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return undefined;
    node.addEventListener('scroll', handleScroll);
    return () => node.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const applyUpdate = useCallback((pageNumber, updater, { pushHistory = true } = {}) => {
    setAnnotationCache((prev) => {
      const current = prev[pageNumber] || createPageState();
      const snapshot = cloneAnnotationState(current);
      const draft = {
        ...snapshot,
        history: [...(current.history || [])],
        redo: [...(current.redo || [])]
      };
      if (pushHistory) {
        draft.history.push(cloneAnnotationState(current));
        if (draft.history.length > 50) {
          draft.history.shift();
        }
        draft.redo = [];
      }
      updater(draft);
      return { ...prev, [pageNumber]: draft };
    });
  }, []);

  const getPoint = (event) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    return {
      x: Math.max(0, Math.min(SVG_WIDTH, xRatio * SVG_WIDTH)),
      y: Math.max(0, Math.min(SVG_HEIGHT, yRatio * SVG_HEIGHT))
    };
  };

  const handlePointerDown = (event) => {
    event.preventDefault();
    const point = getPoint(event);
    if (tool === 'pen' || tool === 'highlighter') {
      drawingRef.current = true;
      setLiveStroke({
        id: createId(),
        tool,
        color,
        size,
        opacity: deriveOpacityFromTool(tool),
        points: [point]
      });
    } else if (tool === 'shape') {
      setLiveShape({
        id: createId(),
        type: 'rectangle',
        color,
        size,
        opacity: DEFAULT_SHAPE_OPACITY,
        start: point,
        current: point
      });
    } else if (tool === 'text') {
      const value = window.prompt('Add note');
      if (value) {
        applyUpdate(activePage, (draft) => {
          draft.texts.push({
            id: createId(),
            text: value,
            x: point.x,
            y: point.y,
            color,
            fontSize
          });
        });
      }
    } else if (tool === 'eraser') {
      applyUpdate(activePage, (draft) => {
        const shapes = draft.extras?.shapes || [];
        const shapeIndex = shapes.findIndex((shape) =>
          point.x >= shape.x &&
          point.x <= shape.x + shape.width &&
          point.y >= shape.y &&
          point.y <= shape.y + shape.height
        );
        if (shapeIndex >= 0) {
          shapes.splice(shapeIndex, 1);
          draft.extras.shapes = shapes;
          return;
        }
        const idx = draft.paths.findIndex((path) =>
          path.points.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 30)
        );
        if (idx >= 0) {
          draft.paths.splice(idx, 1);
        }
      });
    }
  };

  const handlePointerMove = (event) => {
    if (drawingRef.current && liveStroke) {
      const point = getPoint(event);
      setLiveStroke((prev) => {
        if (!prev) return prev;
        return { ...prev, points: [...prev.points, point] };
      });
      return;
    }
    if (liveShape) {
      const point = getPoint(event);
      setLiveShape((prev) => (prev ? { ...prev, current: point } : prev));
    }
  };

  const handlePointerUp = () => {
    if (liveStroke?.points?.length) {
      const stroke = liveStroke;
      applyUpdate(activePage, (draft) => {
        draft.paths.push({
          id: stroke.id || createId(),
          tool: stroke.tool,
          color: stroke.color,
          size: stroke.size,
          opacity: stroke.opacity,
          points: sanitizePoints(stroke.points)
        });
      });
    }
    if (liveShape) {
      const geometry = shapeDraftToRect(liveShape);
      if (geometry && (geometry.width > 2 || geometry.height > 2)) {
        applyUpdate(activePage, (draft) => {
          draft.extras = draft.extras || baseExtras();
          draft.extras.shapes = draft.extras.shapes || [];
          draft.extras.shapes.push({
            id: liveShape.id,
            type: liveShape.type,
            color: liveShape.color,
            size: liveShape.size,
            opacity: liveShape.opacity,
            ...geometry
          });
        });
      }
    }
    drawingRef.current = false;
    setLiveStroke(null);
    setLiveShape(null);
  };

  const handleUndo = () => {
    setAnnotationCache((prev) => {
      const current = prev[activePage];
      if (!current?.history?.length) return prev;
      const history = [...current.history];
      const previousSnapshot = history.pop();
      const redo = [...(current.redo || []), cloneAnnotationState(current)];
      if (!previousSnapshot) return prev;
      const restored = cloneAnnotationState(previousSnapshot);
      return {
        ...prev,
        [activePage]: {
          ...current,
          paths: restored.paths,
          texts: restored.texts,
          extras: restored.extras,
          history,
          redo
        }
      };
    });
  };

  const handleRedo = () => {
    setAnnotationCache((prev) => {
      const current = prev[activePage];
      if (!current?.redo?.length) return prev;
      const redo = [...current.redo];
      const snapshot = redo.pop();
      if (!snapshot) return prev;
      const restored = cloneAnnotationState(snapshot);
      const history = [...(current.history || []), cloneAnnotationState(current)];
      return {
        ...prev,
        [activePage]: {
          ...current,
          paths: restored.paths,
          texts: restored.texts,
          extras: restored.extras,
          history,
          redo
        }
      };
    });
  };

  const handleClear = () => {
    applyUpdate(activePage, (draft) => {
      draft.paths = [];
      draft.texts = [];
      draft.extras = baseExtras();
    });
  };

  const handleSave = async () => {
    setPersisting(true);
    try {
      if (!itemId) return;
      const payload = serializePageState(activeAnnotations);
      await saveAnnotations(itemId, activePage, {
        payload,
        activeTool: tool,
        undoDepth: activeAnnotations.history?.length || 0,
        redoDepth: activeAnnotations.redo?.length || 0
      });
    } catch (error) {
      console.error('Failed to save annotations', error);
    } finally {
      setPersisting(false);
    }
  };

  const handleDownload = async () => {
    if (!item.allowDownload) return;
    try {
      if (!itemId) return;
      const response = await fetchDownloadTicket(itemId);
      if (response?.url) {
        window.open(response.url, '_blank');
      }
    } catch (error) {
      console.error('Download failed', error);
    }
  };

  const handleJump = (event) => {
    event.preventDefault();
    const numeric = Number(jumpValue);
    if (!Number.isFinite(numeric)) return;
    const target = pages.find((page) => page.pageNumber === numeric);
    if (target) {
      setActivePage(target.pageNumber);
    } else if (numeric > pages[pages.length - 1]?.pageNumber && hasMore) {
      loadPages(pageCursor + 1).then(() => {
        setActivePage(numeric);
      });
    }
  };

  const handleInlineRenderRetry = () => {
    if (inlineRenderState.status === 'rendering') return;
    if (!inlineUrl && !inlineLoading) {
      ensureInlinePreview();
    }
    setInlineRenderRequested(true);
    setInlineRenderAttempted(false);
    setInlineRenderState({ status: 'idle', error: null });
  };

  const canUndo = Boolean(activeAnnotations.history?.length);
  const canRedo = Boolean(activeAnnotations.redo?.length);

  const pageImage = useMemo(() => {
    const fallback = buildPlaceholderDataUrl('Preview');
    const match = pages.find((page) => page.pageNumber === activePage)?.imageUrl;
    return match || pages[0]?.imageUrl || fallback;
  }, [activePage, pages]);

  const inlineLayerButtonDisabled = inlineRenderState.status === 'rendering';
  const inlineLayerButtonLabel = inlineRenderState.status === 'error'
    ? 'Retry annotation layer'
    : inlineRenderState.status === 'idle'
      ? 'Enable annotation layer'
      : 'Preparing annotation layer…';

  if (!item || !itemId) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex h-[90vh] w-[95vw] flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-[#f7f9fc] via-[#eef2f7] to-white text-slate-900 shadow-2xl ring-1 ring-slate-200">
        <header className="flex items-center gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Viewing</p>
            <h2 className="text-lg font-semibold text-slate-900">{item.displayName}</h2>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!item.allowDownload}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                item.allowDownload ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Download className="h-4 w-4" />
              Download
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {previewMode === 'inline' ? (
          <div className="flex flex-1 gap-4 overflow-hidden p-4">
            <div className="flex-1 rounded-3xl border border-slate-200 bg-white p-4">
              {inlineRenderState.status === 'error' ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-600">
                  <p className="text-sm font-medium">We couldn’t render a preview for this file.</p>
                  <p className="text-xs text-slate-500">Use Download to open it directly, or retry rendering.</p>
                  <p className="text-xs text-red-500">{inlineRenderState.error}</p>
                  {inlineError && <p className="text-xs text-red-500">{inlineError}</p>}
                  <button
                    type="button"
                    onClick={handleInlineRenderRetry}
                    className="rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Retry
                  </button>
                </div>
              ) : inlineBlobUrl || inlineUrl ? (
                <div className="flex h-full flex-col gap-3">
                  <div className="flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <iframe
                      src={inlineBlobUrl || inlineUrl}
                      title={`Preview of ${item.displayName}`}
                      className="h-full w-full"
                    />
                  </div>
                  {inlineError ? <p className="text-xs text-red-500">{inlineError}</p> : null}
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-slate-600">
                  <div className="inline-flex items-center justify-center text-sm text-slate-600">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading PDF…
                  </div>
                  {inlineLoading && (inlineDownloadProgress.total || inlineDownloadProgress.loaded) ? (
                    <p className="text-xs text-slate-600">
                      Downloaded {Math.round((inlineDownloadProgress.loaded || 0) / 1024 / 1024)} MB
                      {inlineDownloadProgress.total
                        ? ` / ${Math.round(inlineDownloadProgress.total / 1024 / 1024)} MB`
                        : ''}
                    </p>
                  ) : null}
                  {inlineError ? <p className="text-xs text-red-500">{inlineError}</p> : null}
                  <p className="text-xs text-slate-500">If this takes too long, click Download.</p>
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Annotation layer</p>
                <p className="mt-1 text-xs text-slate-600">
                  We need a transparent layer on top of this inline PDF before strokes can appear. Generate it below and we will swap back to the annotatable view automatically.
                </p>
                {inlineRenderState.status === 'rendering' && (
                  <div className="mt-3 inline-flex items-center gap-2 text-emerald-600">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      Preparing annotation pages… {inlineRenderProgress.current}/{inlineRenderProgress.total || '…'}
                    </span>
                  </div>
                )}
                {inlineRenderState.status === 'error' && (
                  <div className="mt-3 inline-flex items-center gap-2 text-red-500">
                    <AlertTriangle className="h-4 w-4" />
                    <span>{inlineRenderState.error}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleInlineRenderRetry}
                  disabled={inlineLayerButtonDisabled || inlineLoading}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  {inlineLayerButtonLabel}
                </button>
              </div>
            </div>

          </div>
        ) : (
          <div className="flex flex-1 gap-4 overflow-hidden p-4">
            <aside className="w-56 rounded-2xl border border-slate-200 bg-white p-3" ref={listRef}>
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Pages</p>
              <div className="space-y-2 overflow-y-auto" style={{ maxHeight: '100%' }}>
                {pages.map((page) => (
                  <button
                    key={page.pageNumber}
                    type="button"
                    onClick={() => setActivePage(page.pageNumber)}
                    className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                      activePage === page.pageNumber
                        ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
                        : 'border-transparent text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <span>Page {page.pageNumber}</span>
                    <span className="text-xs text-slate-500">{page.pageNumber <= pageCursor * PAGES_BATCH_SIZE ? 'Ready' : 'Queued'}</span>
                  </button>
                ))}
                {loadingPages && (
                  <div className="flex items-center justify-center py-4 text-xs text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading more pages…
                  </div>
                )}
                {!hasMore && !loadingPages && (
                  <p className="py-4 text-center text-xs text-slate-400">End of document</p>
                )}
              </div>
            </aside>

            <section className="flex flex-1 gap-4 overflow-hidden">
              <div className="flex flex-1 flex-col gap-3 overflow-hidden">
                <form className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600" onSubmit={handleJump}>
                  <span>Jump to page</span>
                  <input
                    type="number"
                    min={1}
                    value={jumpValue}
                    onChange={(e) => setJumpValue(e.target.value)}
                    className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1"
                  />
                  <button type="submit" className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-slate-700 hover:bg-slate-100">Go</button>
                  {persisting && (
                    <span className="ml-auto inline-flex items-center gap-1 text-emerald-600">
                      <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                    </span>
                  )}
                </form>

                <div className="flex-1 overflow-auto">
                  <div className="mx-auto flex max-w-4xl justify-center">
                    <div
                      className="relative w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
                    >
                      <img
                        src={pageImage}
                        alt={`Page ${activePage}`}
                        className="block w-full select-none"
                        draggable={false}
                      />
                      <svg
                        ref={svgRef}
                        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                        className="absolute inset-0 h-full w-full touch-none"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerLeave={handlePointerUp}
                        style={{ cursor: tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair' }}
                      >
                        {(activeAnnotations.extras?.shapes || []).map((shape) => (
                          <rect
                            key={shape.id || `${shape.x}-${shape.y}-${shape.width}-${shape.height}`}
                            x={shape.x}
                            y={shape.y}
                            width={Math.max(shape.width, 1)}
                            height={Math.max(shape.height, 1)}
                            fill="none"
                            stroke={shape.color}
                            strokeWidth={shape.size}
                            opacity={shape.opacity ?? DEFAULT_SHAPE_OPACITY}
                            rx={shape.type === 'rounded' ? 12 : 2}
                            ry={shape.type === 'rounded' ? 12 : 2}
                          />
                        ))}
                        {activeAnnotations.paths.map((path) => (
                          <path
                            key={path.id || path._id || path.points?.[0]?.x || Math.random()}
                            d={pointsToPath(path.points)}
                            fill="none"
                            stroke={path.color}
                            strokeWidth={path.size}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={path.opacity ?? deriveOpacityFromTool(path.tool)}
                          />
                        ))}
                        {activeAnnotations.texts.map((text) => (
                          <text
                            key={text.id || text._id || `${text.x}-${text.y}`}
                            x={text.x}
                            y={text.y}
                            fill={text.color}
                            fontSize={text.fontSize}
                            fontWeight="600"
                            className="select-none"
                          >
                            {text.text}
                          </text>
                        ))}
                        {liveStroke && (
                          <path
                            d={pointsToPath(liveStroke.points)}
                            fill="none"
                            stroke={liveStroke.color}
                            strokeWidth={liveStroke.size}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={liveStroke.opacity ?? deriveOpacityFromTool(liveStroke.tool)}
                          />
                        )}
                        {liveShape && (() => {
                          const geometry = shapeDraftToRect(liveShape);
                          if (!geometry) return null;
                          return (
                            <rect
                              x={geometry.x}
                              y={geometry.y}
                              width={Math.max(geometry.width, 1)}
                              height={Math.max(geometry.height, 1)}
                              fill="none"
                              stroke={liveShape.color}
                              strokeWidth={liveShape.size}
                              opacity={liveShape.opacity ?? DEFAULT_SHAPE_OPACITY}
                              strokeDasharray="8 4"
                            />
                          );
                        })()}
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-72 shrink-0 self-stretch">
                <AnnotationToolbar
                  tool={tool}
                  setTool={setTool}
                  color={color}
                  setColor={setColor}
                  size={size}
                  setSize={setSize}
                  fontSize={fontSize}
                  setFontSize={setFontSize}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onClear={handleClear}
                  onSave={handleSave}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  orientation="vertical"
                  className="h-full"
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocumentViewer;
