import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ChevronDown, Indent, Italic, Outdent, Pilcrow, Text, Underline } from 'lucide-react';

const FONT_FAMILIES = [
  // Arabic / Quran-friendly
  { label: 'Scheherazade New', value: '"Scheherazade New", serif' },
  { label: 'Noto Naskh Arabic', value: '"Noto Naskh Arabic", serif' },
  { label: 'Noto Kufi Arabic', value: '"Noto Kufi Arabic", sans-serif' },
  { label: 'Aref Ruqaa', value: '"Aref Ruqaa", serif' },
  { label: 'Amiri', value: '"Amiri", serif' },
  { label: 'Amiri Quran', value: '"Amiri Quran", serif' },

  // English / UI
  { label: 'Inter', value: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif' },
  { label: 'Roboto', value: 'Roboto, ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif' },
  { label: 'Open Sans', value: '"Open Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif' },
  { label: 'Poppins', value: 'Poppins, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif' },
  { label: 'Montserrat', value: 'Montserrat, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif' },
  { label: 'Arial', value: 'Arial, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", Times, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' }
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];

const COLOR_SWATCHES = ['#0f172a', '#1f2937', '#334155', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#a855f7'];

const sizeToCommand = (size) => {
  if (size <= 12) return 2;
  if (size <= 14) return 3;
  if (size <= 16) return 4;
  if (size <= 18) return 5;
  if (size <= 24) return 6;
  return 7;
};

const applyFontSize = (editor, size) => {
  document.execCommand('fontSize', false, String(sizeToCommand(size)));
  const fonts = editor.querySelectorAll('font[size]');
  fonts.forEach((font) => {
    const span = document.createElement('span');
    span.style.fontSize = `${size}px`;
    span.innerHTML = font.innerHTML;
    font.replaceWith(span);
  });
};

const primaryFontFromStack = (stack = '') => {
  const first = String(stack || '').split(',')[0] || '';
  return first.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
};

const closestFontSize = (px, allowed = FONT_SIZES) => {
  const target = Number(px);
  if (!Number.isFinite(target)) return allowed[0] || 16;
  let best = allowed[0] || 16;
  let bestDiff = Math.abs(best - target);
  for (const s of allowed) {
    const diff = Math.abs(Number(s) - target);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
};

const RichTextToolbar = ({ activeRef, compact = false }) => {
  const [currentFont, setCurrentFont] = useState(FONT_FAMILIES[0].value);
  const [currentSize, setCurrentSize] = useState(16);
  const [color, setColor] = useState('#0f172a');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  const savedRangeRef = React.useRef(null);

  const saveSelection = useCallback(() => {
    const el = activeRef?.current;
    if (!el) return;
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const containerEl = container?.nodeType === Node.ELEMENT_NODE ? container : container?.parentElement;
    if (!containerEl) return;
    if (!el.contains(containerEl)) return;
    savedRangeRef.current = range.cloneRange();
  }, [activeRef]);

  const restoreSelection = useCallback(() => {
    const el = activeRef?.current;
    if (!el) return;
    const range = savedRangeRef.current;
    if (!range) return;
    try {
      const sel = window.getSelection?.();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {
      // ignore
    }
  }, [activeRef]);

  const exec = useCallback((command, arg) => {
    if (!activeRef?.current) return;
    activeRef.current.focus();
    restoreSelection();
    document.execCommand(command, false, arg);
    saveSelection();
  }, [activeRef, restoreSelection, saveSelection]);

  const insertText = useCallback((text) => {
    if (!activeRef?.current) return;
    activeRef.current.focus();
    restoreSelection();
    document.execCommand('insertText', false, text);
    saveSelection();
  }, [activeRef, restoreSelection, saveSelection]);

  React.useEffect(() => {
    const handler = () => {
      const el = activeRef?.current;
      if (!el) return;
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const node = sel.focusNode;
      const nodeEl = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!nodeEl) return;
      if (!el.contains(nodeEl)) return;

      savedRangeRef.current = range.cloneRange();

      try {
        const style = window.getComputedStyle(nodeEl);
        const ff = primaryFontFromStack(style.fontFamily);
        const match = FONT_FAMILIES.find((f) => primaryFontFromStack(f.value) === ff);
        if (match && match.value !== currentFont) setCurrentFont(match.value);

        const fsPx = Number.parseFloat(style.fontSize);
        const nearest = closestFontSize(fsPx);
        if (nearest && nearest !== currentSize) setCurrentSize(nearest);
      } catch (_) {
        // ignore
      }
    };

    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [activeRef, currentFont, currentSize]);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (event) => {
      const target = event.target;
      if (!target) return;
      if (moreRef.current && moreRef.current.contains(target)) return;
      setMoreOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [moreOpen]);

  const toolbarClass = useMemo(
    () =>
      `inline-flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-200/90 px-3 py-2 shadow-sm ${
        compact ? 'text-xs' : 'text-sm'
      }`,
    [compact]
  );

  return (
    <div className="mx-auto w-fit">
      <div className={toolbarClass}>
      <select
        className="rounded-lg border border-border bg-white px-2 py-1"
        value={currentFont}
        onMouseDown={() => saveSelection()}
        onChange={(e) => {
          const next = e.target.value;
          setCurrentFont(next);
          if (activeRef?.current) {
            activeRef.current.style.fontFamily = next;
          }
          exec('fontName', next);
          if (activeRef?.current) {
            applyFontSize(activeRef.current, currentSize);
          }
        }}
      >
        {FONT_FAMILIES.map((font) => (
          <option key={font.value} value={font.value}>{font.label}</option>
        ))}
      </select>
      <select
        className="rounded-lg border border-border bg-white px-2 py-1"
        value={currentSize}
        onMouseDown={() => saveSelection()}
        onChange={(e) => {
          const next = Number(e.target.value);
          setCurrentSize(next);
          if (activeRef?.current) {
            activeRef.current.style.fontSize = `${next}px`;
            restoreSelection();
            applyFontSize(activeRef.current, next);
            saveSelection();
          }
        }}
      >
        {FONT_SIZES.map((size) => (
          <option key={size} value={size}>{size}px</option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        {COLOR_SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              saveSelection();
            }}
            onClick={() => {
              setColor(swatch);
              exec('foreColor', swatch);
            }}
            className={`h-7 w-7 rounded-full border ${color === swatch ? 'border-slate-900' : 'border-slate-200'}`}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('bold')} className="rounded-lg border border-border px-2 py-1">
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('italic')} className="rounded-lg border border-border px-2 py-1">
        <Italic className="h-4 w-4" />
      </button>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('underline')} className="rounded-lg border border-border px-2 py-1">
        <Underline className="h-4 w-4" />
      </button>
      <div ref={moreRef} className="relative">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
          onClick={() => setMoreOpen((prev) => !prev)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1"
          title="Alignment & direction"
        >
          <AlignLeft className="h-4 w-4" />
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {moreOpen && (
          <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-border bg-white p-2 shadow-lg">
            <div className="grid gap-1">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => { exec('justifyLeft'); setMoreOpen(false); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <AlignLeft className="h-4 w-4" />
                Align left
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => { exec('justifyCenter'); setMoreOpen(false); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <AlignCenter className="h-4 w-4" />
                Align center
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => { exec('justifyRight'); setMoreOpen(false); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <AlignRight className="h-4 w-4" />
                Align right
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => { exec('justifyFull'); setMoreOpen(false); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <AlignJustify className="h-4 w-4" />
                Justify
              </button>

              <div className="my-1 h-px bg-slate-100" />

              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => { exec('indent'); setMoreOpen(false); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <Indent className="h-4 w-4" />
                Indent
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => { exec('outdent'); setMoreOpen(false); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <Outdent className="h-4 w-4" />
                Outdent
              </button>

              <div className="my-1 h-px bg-slate-100" />

              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => {
                  if (activeRef?.current) {
                    activeRef.current.dir = 'rtl';
                    activeRef.current.style.textAlign = 'right';
                  }
                  setMoreOpen(false);
                }}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <span>Direction</span>
                <span className="text-xs font-semibold text-slate-500">RTL</span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => {
                  if (activeRef?.current) {
                    activeRef.current.dir = 'ltr';
                    activeRef.current.style.textAlign = 'left';
                  }
                  setMoreOpen(false);
                }}
                className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <span>Direction</span>
                <span className="text-xs font-semibold text-slate-500">LTR</span>
              </button>
            </div>
          </div>
        )}
      </div>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('formatBlock', '<h3>')} className="rounded-lg border border-border px-2 py-1">
        <Text className="h-4 w-4" />
      </button>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('formatBlock', '<p>')} className="rounded-lg border border-border px-2 py-1">
        <Pilcrow className="h-4 w-4" />
      </button>
      </div>
    </div>
  );
};

export default RichTextToolbar;
