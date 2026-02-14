import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Indent, Italic, MoreHorizontal, Outdent, Pilcrow, Text, Underline } from 'lucide-react';

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

const stripFontFamilyAndSize = (html = '') => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');

    const walk = (node) => {
      if (!node) return;
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = /** @type {HTMLElement} */ (node);

        if (el.tagName && el.tagName.toLowerCase() === 'font') {
          const replacement = doc.createElement('span');
          replacement.innerHTML = el.innerHTML;
          el.replaceWith(replacement);
          walk(replacement);
          return;
        }

        if (el.hasAttribute('face')) el.removeAttribute('face');
        if (el.hasAttribute('size')) el.removeAttribute('size');

        // Remove font family/size from inline styles so content inherits editor defaults.
        if (el.style) {
          el.style.fontFamily = '';
          el.style.fontSize = '';
          // If style became empty, drop it entirely.
          if (!el.getAttribute('style') || !String(el.getAttribute('style')).trim()) {
            el.removeAttribute('style');
          }
        }
      }

      const children = node.childNodes ? Array.from(node.childNodes) : [];
      children.forEach(walk);
    };

    walk(doc.body);
    return doc.body.innerHTML;
  } catch (e) {
    return String(html || '');
  }
};

const RichTextEditor = ({
  value,
  onChange,
  placeholder = 'Write here…',
  minHeight = 120,
  compact = false,
  showToolbar = true,
  onFocus,
  defaultFont = FONT_FAMILIES[0].value,
  defaultSize = 16,
}) => {
  const editorRef = useRef(null);
  const savedRangeRef = useRef(null);
  const [currentFont, setCurrentFont] = useState(defaultFont);
  const [currentSize, setCurrentSize] = useState(defaultSize);
  const [color, setColor] = useState('#0f172a');
  const [showMoreTools, setShowMoreTools] = useState(false);

  useEffect(() => {
    setCurrentFont(defaultFont || FONT_FAMILIES[0].value);
  }, [defaultFont]);

  useEffect(() => {
    if (Number.isFinite(Number(defaultSize))) {
      setCurrentSize(Number(defaultSize));
    }
  }, [defaultSize]);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== (value || '')) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  const saveSelection = useCallback(() => {
    if (!editorRef.current) return;
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const containerEl = container?.nodeType === Node.ELEMENT_NODE ? container : container?.parentElement;
    if (!containerEl) return;
    if (!editorRef.current.contains(containerEl)) return;
    savedRangeRef.current = range.cloneRange();
  }, []);

  const restoreSelection = useCallback(() => {
    if (!editorRef.current) return;
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
  }, []);

  const exec = useCallback((command, arg) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    restoreSelection();
    document.execCommand(command, false, arg);
    saveSelection();
  }, [restoreSelection, saveSelection]);

  const insertText = useCallback((text) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand('insertText', false, text);
  }, []);

  const handleInput = useCallback(() => {
    onChange?.(editorRef.current?.innerHTML || '');
    saveSelection();
  }, [onChange]);

  const ensureDefaultTypingStyle = useCallback(() => {
    if (!editorRef.current) return;
    // Set container defaults so new text (typing) inherits them.
    editorRef.current.style.fontFamily = currentFont;
    editorRef.current.style.fontSize = `${currentSize}px`;
    editorRef.current.style.color = color;
  }, [currentFont, currentSize, color]);

  useEffect(() => {
    ensureDefaultTypingStyle();
  }, [ensureDefaultTypingStyle]);

  useEffect(() => {
    if (!showMoreTools) return;
    const close = () => setShowMoreTools(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [showMoreTools]);

  useEffect(() => {
    const handler = () => {
      if (!editorRef.current) return;
      const sel = window.getSelection?.();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const node = sel.focusNode;
      const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!el) return;
      if (!editorRef.current.contains(el)) return;

      // Save for toolbar actions.
      savedRangeRef.current = range.cloneRange();

      // Sync toolbar values (Word-like) based on caret/selection.
      try {
        const style = window.getComputedStyle(el);
        const ff = primaryFontFromStack(style.fontFamily);
        const match = FONT_FAMILIES.find((f) => primaryFontFromStack(f.value) === ff);
        if (match && match.value !== currentFont) {
          setCurrentFont(match.value);
        }

        const fsPx = Number.parseFloat(style.fontSize);
        const nearest = closestFontSize(fsPx);
        if (nearest && nearest !== currentSize) {
          setCurrentSize(nearest);
        }
      } catch (_) {
        // ignore
      }
    };

    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [currentFont, currentSize]);

  const handlePaste = useCallback((event) => {
    if (!editorRef.current) return;

    try {
      event.preventDefault();
      restoreSelection();
      const clipboard = event.clipboardData;
      const html = clipboard?.getData('text/html');
      const text = clipboard?.getData('text/plain');

      if (html && html.trim()) {
        const cleaned = stripFontFamilyAndSize(html);
        document.execCommand('insertHTML', false, cleaned);
      } else if (typeof text === 'string') {
        document.execCommand('insertText', false, text);
      }

      // Keep subsequent typing consistent.
      ensureDefaultTypingStyle();
      onChange?.(editorRef.current?.innerHTML || '');
      saveSelection();
    } catch (e) {
      // If something goes wrong, fall back to default paste behavior.
    }
  }, [ensureDefaultTypingStyle, onChange, restoreSelection, saveSelection]);

  const toolbarClass = useMemo(
    () =>
      `inline-flex flex-wrap items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-200/90 px-2 py-2 ${
        compact ? 'text-xs' : 'text-sm'
      }`,
    [compact]
  );

  return (
    <div className="space-y-2">
      {showToolbar && (
        <div className="mx-auto w-fit">
        <div className={toolbarClass}>
        <select
          className="rounded-lg border border-border bg-white px-2 py-1"
          value={currentFont}
          onMouseDown={() => saveSelection()}
          onChange={(e) => {
            const next = e.target.value;
            setCurrentFont(next);
            // Set default typing style immediately (Word-like)
            if (editorRef.current) {
              editorRef.current.style.fontFamily = next;
            }
            exec('fontName', next);
            if (editorRef.current) {
              applyFontSize(editorRef.current, currentSize);
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
            if (editorRef.current) {
              editorRef.current.style.fontSize = `${next}px`;
              restoreSelection();
              applyFontSize(editorRef.current, next);
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
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('formatBlock', '<h3>')} className="rounded-lg border border-border px-2 py-1">
          <Text className="h-4 w-4" />
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('formatBlock', '<p>')} className="rounded-lg border border-border px-2 py-1">
          <Pilcrow className="h-4 w-4" />
        </button>
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
            onClick={(e) => {
              e.stopPropagation();
              setShowMoreTools((prev) => !prev);
            }}
            className="rounded-lg border border-border px-2 py-1"
            title="More text tools"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {showMoreTools && (
            <div
              className="absolute right-0 z-10 mt-2 w-44 rounded-xl border border-border bg-white p-1.5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('justifyLeft')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                <AlignLeft className="h-3.5 w-3.5" />
                Align left
              </button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('justifyCenter')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                <AlignCenter className="h-3.5 w-3.5" />
                Align center
              </button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('justifyRight')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                <AlignRight className="h-3.5 w-3.5" />
                Align right
              </button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('justifyFull')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                <AlignJustify className="h-3.5 w-3.5" />
                Justify
              </button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('indent')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                <Indent className="h-3.5 w-3.5" />
                Indent
              </button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSelection(); }} onClick={() => exec('outdent')} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100">
                <Outdent className="h-3.5 w-3.5" />
                Outdent
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => {
                  if (!editorRef.current) return;
                  editorRef.current.dir = 'rtl';
                  editorRef.current.style.textAlign = 'right';
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100"
              >
                RTL direction
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSelection(); }}
                onClick={() => {
                  if (!editorRef.current) return;
                  editorRef.current.dir = 'ltr';
                  editorRef.current.style.textAlign = 'left';
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100"
              >
                LTR direction
              </button>
            </div>
          )}
        </div>
        </div>
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onBlur={handleInput}
        onPaste={handlePaste}
        onFocus={() => {
          ensureDefaultTypingStyle();
          saveSelection();
          onFocus?.(editorRef);
        }}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        className="rich-text-editor rounded-xl border border-border bg-white px-3 py-2 text-sm leading-relaxed outline-none"
        style={{ minHeight }}
        data-placeholder={placeholder}
        suppressContentEditableWarning
      />
    </div>
  );
};

export default RichTextEditor;
