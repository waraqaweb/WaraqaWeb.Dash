import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import html2canvas from 'html2canvas';
import AnnotationToolbar from './AnnotationToolbar';

const SVG_WIDTH = 800;
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

const WhiteboardModal = ({ open, onClose }) => {
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
  const [liveStroke, setLiveStroke] = useState(null);
  const [liveShape, setLiveShape] = useState(null);
  const [exporting, setExporting] = useState(false);

  const svgRef = useRef(null);
  const boardRef = useRef(null);
  const drawingRef = useRef(false);

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

  if (!open) return null;

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
      const value = window.prompt('Add note');
      if (value) {
        applyUpdate(activeBoard, (draft) => {
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
  const activeBoardMeta = useMemo(
    () => boards.find((board) => board.id === activeBoard),
    [boards, activeBoard]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[90vh] w-[95vw] flex-col overflow-hidden rounded-3xl bg-slate-950/95 text-white shadow-2xl">
        <header className="flex items-center gap-4 border-b border-white/10 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/60">Sketchboard</p>
            <h2 className="text-lg font-semibold">Interactive Whiteboard</h2>
          </div>
          <p className="ml-auto text-xs text-white/60">
            Pages reset when you close this window.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/10 p-2 hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex flex-1 gap-4 overflow-hidden p-4">
          <aside className="w-60 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-white/60">
              <span>Pages</span>
              <button
                type="button"
                onClick={handleAddBoard}
                className="inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-1 text-[11px] font-semibold text-white hover:bg-white/10"
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
                      ? 'border-emerald-400/70 bg-emerald-400/10 text-white'
                      : 'border-white/10 text-white/70 hover:bg-white/10'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveBoard(board.id)}
                    className="flex-1 text-left"
                  >
                    {board.name || `Board ${index + 1}`}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemoveBoard(board.id);
                    }}
                    className="ml-2 rounded-full p-1 text-white/60 hover:bg-white/10 disabled:opacity-40"
                    disabled={boards.length === 1}
                    title="Remove board"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <section className="flex flex-1 gap-4 overflow-hidden">
            <div className="flex flex-1 flex-col gap-3 overflow-hidden">
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/50">Active page</p>
                  <p className="text-sm font-semibold">{activeBoardMeta?.name || 'Board'}</p>
                </div>
                {exporting && (
                  <span className="text-xs text-emerald-300">Preparing download…</span>
                )}
              </div>

              <div className="flex-1 overflow-auto">
                <div className="mx-auto flex max-w-4xl justify-center">
                  <div
                    ref={boardRef}
                    className="relative w-full overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl"
                    style={{ aspectRatio: `${SVG_WIDTH} / ${SVG_HEIGHT}` }}
                  >
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
                onSave={handleExport}
                canUndo={canUndo}
                canRedo={canRedo}
                orientation="vertical"
                className="h-full"
              />
              <p className="mt-3 text-xs text-white/60">
                Use Save to download the current board as a PNG. Nothing is uploaded to the server.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default WhiteboardModal;
