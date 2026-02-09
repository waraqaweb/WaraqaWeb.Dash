import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Plus, Send, Trash2, X } from 'lucide-react';
import html2canvas from 'html2canvas';
import AnnotationToolbar from './AnnotationToolbar';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateTimeDDMMMYYYYhhmmA } from '../../utils/date';

const SVG_WIDTH = 1000;
const SVG_HEIGHT = 1100;
const DEFAULT_PEN_OPACITY = 0.9;
const DEFAULT_HIGHLIGHT_OPACITY = 0.35;
const DEFAULT_SHAPE_OPACITY = 0.85;

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
  return `whiteboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const sanitizePoint = (point = {}) => ({
  x: Number.isFinite(point.x) ? point.x : Number(point.x) || 0,
  y: Number.isFinite(point.y) ? point.y : Number(point.y) || 0
});

const sanitizePoints = (points = []) =>
  points
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

const WhiteboardModal = ({ open, onClose, classId = null, onSent, inline = false, compact = false }) => {
  const { user } = useAuth();
  const initialBoardIdRef = useRef(createId());
  const initialBoardId = initialBoardIdRef.current;

  const [boards, setBoards] = useState(() => ([
    { id: initialBoardId, name: 'Board 1' }
  ]));
  const [activeBoard, setActiveBoard] = useState(initialBoardId);
  const [annotationCache, setAnnotationCache] = useState(() => ({
    [initialBoardId]: createPageState()
  }));
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#f97316');
  const [size, setSize] = useState(4);
  const [fontSize, setFontSize] = useState(18);
  const [fontFamily, setFontFamily] = useState('"Scheherazade New", serif');
  const [liveStroke, setLiveStroke] = useState(null);
  const [liveShape, setLiveShape] = useState(null);
  const [textDraft, setTextDraft] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [recentClasses, setRecentClasses] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState(null);
  const [recentSearch, setRecentSearch] = useState('');
  const [selectedClassId, setSelectedClassId] = useState(classId || null);

  const svgRef = useRef(null);
  const boardRef = useRef(null);
  const containerRef = useRef(null);
  const drawingRef = useRef(false);
  const textInputRef = useRef(null);

  const userTimezone = user?.timezone || user?.guardianInfo?.timezone || user?.teacherInfo?.timezone;
  const canAttach = user?.role === 'admin' || user?.role === 'teacher';

  useEffect(() => {
    if (!activeBoard && boards.length) {
      setActiveBoard(boards[0].id);
    }
  }, [activeBoard, boards]);

  useEffect(() => {
    if (!activeBoard) return;
    setAnnotationCache((prev) => {
      if (prev[activeBoard]) return prev;
      return { ...prev, [activeBoard]: createPageState() };
    });
  }, [activeBoard]);

  useEffect(() => {
    if (classId) {
      setSelectedClassId(classId);
    }
  }, [classId]);

  const fetchRecentClasses = useCallback(async (searchValue = '') => {
    try {
      setRecentLoading(true);
      setRecentError(null);
      const res = await api.get('/whiteboard/recent-classes', {
        params: { q: searchValue || undefined }
      });
      setRecentClasses(res.data?.classes || []);
    } catch (error) {
      setRecentError(error?.response?.data?.message || 'Failed to load recent classes');
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const applyUpdate = useCallback((boardId, updater, { pushHistory = true } = {}) => {
    if (!boardId) return;
    setAnnotationCache((prev) => {
      const current = prev[boardId] || createPageState();
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
      return { ...prev, [boardId]: draft };
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
    if (!activeBoard) return;
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
      setTextDraft({
        id: createId(),
        x: point.x,
        y: point.y,
        value: '',
        boardId: activeBoard,
        color,
        fontSize,
        fontFamily
      });
    } else if (tool === 'eraser') {
      applyUpdate(activeBoard, (draft) => {
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

  const finishDrawing = useCallback(() => {
    if (!activeBoard) return;
    if (liveStroke?.points?.length) {
      const stroke = liveStroke;
      applyUpdate(activeBoard, (draft) => {
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
        applyUpdate(activeBoard, (draft) => {
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
  }, [activeBoard, applyUpdate, liveShape, liveStroke]);

  const handlePointerUp = () => {
    finishDrawing();
  };

  const handleUndo = () => {
    if (!activeBoard) return;
    setAnnotationCache((prev) => {
      const current = prev[activeBoard];
      if (!current?.history?.length) return prev;
      const history = [...current.history];
      const previousSnapshot = history.pop();
      const redo = [...(current.redo || []), cloneAnnotationState(current)];
      if (!previousSnapshot) return prev;
      const restored = cloneAnnotationState(previousSnapshot);
      return {
        ...prev,
        [activeBoard]: {
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
    if (!activeBoard) return;
    setAnnotationCache((prev) => {
      const current = prev[activeBoard];
      if (!current?.redo?.length) return prev;
      const redo = [...current.redo];
      const snapshot = redo.pop();
      if (!snapshot) return prev;
      const restored = cloneAnnotationState(snapshot);
      const history = [...(current.history || []), cloneAnnotationState(current)];
      return {
        ...prev,
        [activeBoard]: {
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
    if (!activeBoard) return;
    applyUpdate(activeBoard, (draft) => {
      draft.paths = [];
      draft.texts = [];
      draft.extras = baseExtras();
    }, { pushHistory: true });
  };

  const handleExport = async () => {
    if (!boardRef.current) return;
    try {
      setExporting(true);
      const canvas = await html2canvas(boardRef.current, {
        backgroundColor: '#ffffff',
        logging: false,
        scale: 2
      });
      const safeName = (boards.find((board) => board.id === activeBoard)?.name || 'whiteboard')
        .toLowerCase()
        .replace(/\s+/g, '_');
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${safeName}.png`;
      link.click();
    } catch (error) {
      console.error('Whiteboard export failed', error);
    } finally {
      setExporting(false);
    }
  };

  const buildLightweightImageDataUrl = async () => {
    if (!boardRef.current) return null;
    const canvas = await html2canvas(boardRef.current, {
      backgroundColor: '#ffffff',
      logging: false,
      scale: 1
    });

    const maxWidth = 1200;
    if (canvas.width > maxWidth) {
      const ratio = maxWidth / canvas.width;
      const resized = document.createElement('canvas');
      resized.width = Math.round(canvas.width * ratio);
      resized.height = Math.round(canvas.height * ratio);
      const ctx = resized.getContext('2d');
      if (ctx) {
        ctx.drawImage(canvas, 0, 0, resized.width, resized.height);
        return resized.toDataURL('image/jpeg', 0.6);
      }
    }

    return canvas.toDataURL('image/jpeg', 0.6);
  };

  const handleSend = async (targetClassId = null) => {
    if (!boardRef.current) return;
    try {
      setSending(true);
      setSendStatus(null);
      const imageData = await buildLightweightImageDataUrl();
      if (!imageData) throw new Error('Failed to create screenshot');
      const safeName = (boards.find((board) => board.id === activeBoard)?.name || 'whiteboard')
        .toLowerCase()
        .replace(/\s+/g, '_');
      const fileName = `${safeName}.jpg`;
      const resolvedClassId = targetClassId || classId;
      if (resolvedClassId) {
        await api.post('/whiteboard/screenshot/class', {
          classId: resolvedClassId,
          imageData,
          fileName
        });
        setSendStatus('Sent to class');
      } else {
        await api.post('/whiteboard/screenshot', {
          imageData,
          fileName
        });
        setSendStatus('Sent to admin');
      }
      if (typeof onSent === 'function') {
        onSent();
      }
      setAttachOpen(false);
    } catch (error) {
      console.error('Whiteboard send failed', error);
      const message = error?.response?.data?.message || 'Failed to send';
      setSendStatus(message);
    } finally {
      setSending(false);
    }
  };

  const openAttachPicker = async () => {
    if (classId) {
      setSelectedClassId(classId);
    }
    setAttachOpen(true);
    await fetchRecentClasses(recentSearch);
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
    } catch (error) {
      console.warn('Fullscreen toggle failed', error);
    }
  };

  const handleAddBoard = () => {
    const newBoard = {
      id: createId(),
      name: `Board ${boards.length + 1}`
    };
    setBoards((prev) => [...prev, newBoard]);
    setAnnotationCache((prev) => ({ ...prev, [newBoard.id]: createPageState() }));
    setActiveBoard(newBoard.id);
  };

  const handleRemoveBoard = (boardId) => {
    if (boards.length === 1) return;
    setBoards((prev) => {
      const filtered = prev.filter((board) => board.id !== boardId);
      if (activeBoard === boardId) {
        const fallback = filtered[filtered.length - 1];
        setActiveBoard(fallback?.id || null);
      }
      return filtered;
    });
    setAnnotationCache((prev) => {
      const next = { ...prev };
      delete next[boardId];
      return next;
    });
  };

  const activeAnnotations = annotationCache[activeBoard] || createPageState();
  const canUndo = Boolean(activeAnnotations.history?.length);
  const canRedo = Boolean(activeAnnotations.redo?.length);
    useEffect(() => {
      if (!textDraft) return;
      const timer = setTimeout(() => {
        textInputRef.current?.focus();
      }, 0);
      return () => clearTimeout(timer);
    }, [textDraft]);

    const commitTextDraft = useCallback(() => {
      if (!textDraft) return;
      const value = String(textDraft.value || '').trim();
      if (value && textDraft.boardId) {
        applyUpdate(textDraft.boardId, (draft) => {
          draft.texts.push({
            id: textDraft.id,
            text: value,
            x: textDraft.x,
            y: textDraft.y,
            color: textDraft.color,
            fontSize: textDraft.fontSize,
            fontFamily: textDraft.fontFamily
          });
        });
      }
      setTextDraft(null);
    }, [applyUpdate, textDraft]);

    const cancelTextDraft = useCallback(() => {
      setTextDraft(null);
    }, []);
  const activeBoardMeta = useMemo(
    () => boards.find((board) => board.id === activeBoard),
    [boards, activeBoard]
  );

  const attachPanel = attachOpen ? (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 space-y-2">
      {user?.role === 'admin' && (
        <input
          type="text"
          value={recentSearch}
          onChange={(e) => setRecentSearch(e.target.value)}
          onBlur={() => fetchRecentClasses(recentSearch)}
          placeholder="Search by student name"
          className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
        />
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500">Last 24 hours</span>
        <button
          type="button"
          onClick={() => fetchRecentClasses(recentSearch)}
          className="text-[11px] text-slate-500 hover:text-slate-700"
        >
          Refresh
        </button>
      </div>
      {recentLoading ? (
        <div className="text-[11px] text-slate-500">Loading classes…</div>
      ) : recentError ? (
        <div className="text-[11px] text-red-600">{recentError}</div>
      ) : recentClasses.length === 0 ? (
        <div className="text-[11px] text-slate-500">No classes found.</div>
      ) : (
        <div className="max-h-40 overflow-auto space-y-1">
          {recentClasses.map((cls) => {
            const teacherName = cls?.teacher ? `${cls.teacher.firstName || ''} ${cls.teacher.lastName || ''}`.trim() : '—';
            const studentName = cls?.student?.studentName || 'Unknown student';
            const timeLabel = formatDateTimeDDMMMYYYYhhmmA(cls?.scheduledDate, { timeZone: userTimezone });
            const isSelected = String(selectedClassId || '') === String(cls._id);
            return (
              <button
                key={cls._id}
                type="button"
                onClick={() => setSelectedClassId(cls._id)}
                className={`w-full rounded-md border px-2 py-1 text-left text-[11px] ${isSelected ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="font-semibold text-slate-700">{studentName}</div>
                <div className="text-slate-500">{timeLabel}{user?.role === 'admin' ? ` • ${teacherName}` : ''}</div>
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setAttachOpen(false)}
          className="text-[11px] text-slate-500 hover:text-slate-700"
        >
          Close
        </button>
        <button
          type="button"
          onClick={() => handleSend(selectedClassId)}
          disabled={!selectedClassId || sending}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          Attach to class
        </button>
      </div>
    </div>
  ) : null;

  if (!open) return null;

  const isCompactInline = inline && compact;

  const outerClass = inline
    ? 'w-full h-full'
    : `fixed inset-0 z-50 flex items-center justify-center ${isFullscreen ? 'bg-slate-100 p-0' : 'bg-slate-200/90 p-4'}`;

  const innerClass = inline
    ? `flex h-full w-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 ${isCompactInline ? 'shadow-lg' : 'shadow-xl'}`
    : `flex flex-col overflow-hidden bg-slate-100 text-slate-900 shadow-2xl ${isFullscreen ? 'h-screen w-screen rounded-none' : 'h-[90vh] w-[95vw] rounded-3xl'} border border-slate-200`;

  return (
    <div className={outerClass}>
      <div
        ref={containerRef}
        className={innerClass}
      >
        {attachOpen && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
            <div className="w-full max-w-md">
              {attachPanel}
            </div>
          </div>
        )}
        {!isCompactInline && (
          <header className="flex items-center gap-4 border-b border-slate-200 px-6 py-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Sketchboard</p>
              <h2 className="text-lg font-semibold">Interactive Whiteboard</h2>
            </div>
            <p className="ml-auto text-xs text-slate-500">
              Pages reset when you close this window.
            </p>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100"
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200 bg-white p-2 hover:bg-slate-100"
            >
              <X className="h-5 w-5" />
            </button>
          </header>
        )}

        <div className={`flex min-h-0 flex-1 ${isCompactInline ? 'flex-col' : 'gap-4'} overflow-hidden ${isCompactInline ? 'p-2' : 'p-4'}`}>
          {!isCompactInline && (
            <aside className="w-60 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>Pages</span>
                <button
                  type="button"
                  onClick={handleAddBoard}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {boards.map((board, index) => (
                  <div
                    key={board.id}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
                      activeBoard === board.id
                        ? 'border-emerald-400/70 bg-emerald-50 text-emerald-900'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveBoard(board.id)}
                      className="flex-1 text-left"
                    >
                      {board.name || `Board ${index + 1}`}
                    </button>
                    {canAttach && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openAttachPicker();
                        }}
                        className="ml-2 rounded-full p-1 text-slate-500 hover:bg-slate-100"
                        title="Attach screenshot"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveBoard(board.id);
                      }}
                      className="ml-2 rounded-full p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                      disabled={boards.length === 1}
                      title="Remove board"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </aside>
          )}

          <section className={`flex min-h-0 flex-1 ${isCompactInline ? 'flex-col gap-3' : 'gap-4'} overflow-hidden`}>
            {isCompactInline && (
              <div className="flex shrink-0 items-center gap-2 rounded-2xl bg-white px-1 py-0.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Board</span>
                  <select
                    value={activeBoard}
                    onChange={(event) => setActiveBoard(event.target.value)}
                    className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-700"
                  >
                    {boards.map((board, index) => (
                      <option key={board.id} value={board.id}>
                        {board.name || `Board ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleAddBoard}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveBoard(activeBoard)}
                  disabled={boards.length === 1}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
                {canAttach && (
                  <button
                    type="button"
                    onClick={openAttachPicker}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Send className="h-3.5 w-3.5" />
                    Attach
                  </button>
                )}
                <div className="ml-2 flex-1">
                  <AnnotationToolbar
                    tool={tool}
                    setTool={setTool}
                    color={color}
                    setColor={setColor}
                    size={size}
                    setSize={setSize}
                    fontSize={fontSize}
                    setFontSize={setFontSize}
                    fontFamily={fontFamily}
                    setFontFamily={setFontFamily}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    onClear={handleClear}
                    onSave={handleExport}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    orientation="horizontal"
                    compact
                    className="w-full"
                  />
                </div>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              {!isCompactInline && (
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Active page</p>
                    <p className="text-sm font-semibold">{activeBoardMeta?.name || 'Board'}</p>
                  </div>
                  {exporting && (
                    <span className="text-xs text-emerald-600">Preparing download…</span>
                  )}
                  {sending && (
                    <span className="text-xs text-blue-600">Sending…</span>
                  )}
                  {!sending && sendStatus && (
                    <span className="text-xs text-slate-500">{sendStatus}</span>
                  )}
                </div>
              )}

              <div className={`flex min-h-0 flex-1 ${isCompactInline ? 'overflow-hidden' : 'overflow-auto'}`}>
                <div className={`flex h-full min-h-0 w-full flex-1 ${isCompactInline ? '' : 'mx-auto max-w-6xl justify-center'}`}>
                  <div
                    ref={boardRef}
                    className={`relative w-full h-full overflow-hidden ${isCompactInline ? 'rounded-xl bg-white' : 'rounded-3xl border border-slate-200 bg-white shadow-2xl'}`}
                    style={{ aspectRatio: isCompactInline ? 'auto' : `${SVG_WIDTH} / ${SVG_HEIGHT}` }}
                  >
                    {textDraft && textDraft.boardId === activeBoard && (
                      <textarea
                        ref={textInputRef}
                        value={textDraft.value}
                        onChange={(e) => setTextDraft((prev) => prev ? { ...prev, value: e.target.value } : prev)}
                        onBlur={commitTextDraft}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelTextDraft();
                          }
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            commitTextDraft();
                          }
                        }}
                        className="absolute z-10 min-w-[140px] max-w-[320px] rounded-md border border-emerald-300 bg-white/95 px-2 py-1 text-sm text-slate-900 shadow-md focus:outline-none"
                        style={{
                          left: `${(textDraft.x / SVG_WIDTH) * 100}%`,
                          top: `${(textDraft.y / SVG_HEIGHT) * 100}%`,
                          transform: 'translate(-2px, -2px)',
                          color: textDraft.color,
                          fontSize: `${textDraft.fontSize}px`,
                          fontFamily: textDraft.fontFamily
                        }}
                        placeholder="Type here..."
                        rows={1}
                      />
                    )}
                    <svg
                      ref={svgRef}
                      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                      preserveAspectRatio="none"
                      className="whiteboard-canvas absolute inset-0 h-full w-full touch-none"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                      style={{ cursor: tool === 'text' ? 'text' : tool === 'eraser' ? 'cell' : 'crosshair' }}
                    >
                      <rect x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT} fill="#ffffff" />
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
                          fontFamily={text.fontFamily || fontFamily}
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

            {!isCompactInline && (
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
                  fontFamily={fontFamily}
                  setFontFamily={setFontFamily}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onClear={handleClear}
                  onSave={handleExport}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  orientation="vertical"
                  className="h-full"
                />
                <div className="mt-3 space-y-2">
                  {canAttach && !attachOpen && (
                    <button
                      type="button"
                      onClick={openAttachPicker}
                      className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Attach screenshot to class
                    </button>
                  )}
                  {attachPanel}
                  <p className="text-xs text-slate-500">
                    Use Save to download the current board as a PNG. Send shares a lightweight screenshot for class attachment.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default WhiteboardModal;
