import React, { useCallback, useMemo, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Indent, Italic, Outdent, Pilcrow, Text, Underline } from 'lucide-react';

const FONT_FAMILIES = [
  { label: 'Scheherazade New', value: '"Scheherazade New", serif' },
  { label: 'Noto Naskh Arabic', value: '"Noto Naskh Arabic", serif' },
  { label: 'Aref Ruqaa', value: '"Aref Ruqaa", serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Amiri Quran', value: '"Amiri Quran", serif' }
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32];

const ARABIC_MARKS = ['َ', 'ً', 'ُ', 'ٌ', 'ِ', 'ٍ', 'ْ', 'ّ', 'ۡ', '۝'];
const ARABIC_SYMBOLS = ['ء', 'ؤ', 'ئ', 'ة', 'ى', 'ـ', 'ۥ', 'ۦ'];
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

const RichTextToolbar = ({ activeRef, compact = false }) => {
  const [currentFont, setCurrentFont] = useState(FONT_FAMILIES[0].value);
  const [currentSize, setCurrentSize] = useState(16);
  const [color, setColor] = useState('#0f172a');

  const exec = useCallback((command, arg) => {
    if (!activeRef?.current) return;
    activeRef.current.focus();
    document.execCommand(command, false, arg);
  }, [activeRef]);

  const insertText = useCallback((text) => {
    if (!activeRef?.current) return;
    activeRef.current.focus();
    document.execCommand('insertText', false, text);
  }, [activeRef]);

  const toolbarClass = useMemo(
    () =>
      `flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-white/95 px-3 py-3 shadow-sm ${
        compact ? 'text-xs' : 'text-sm'
      }`,
    [compact]
  );

  return (
    <div className={toolbarClass}>
      <select
        className="rounded-lg border border-border bg-white px-2 py-1"
        value={currentFont}
        onChange={(e) => {
          const next = e.target.value;
          setCurrentFont(next);
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
        onChange={(e) => {
          const next = Number(e.target.value);
          setCurrentSize(next);
          if (activeRef?.current) applyFontSize(activeRef.current, next);
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
            onClick={() => {
              setColor(swatch);
              exec('foreColor', swatch);
            }}
            className={`h-7 w-7 rounded-full border ${color === swatch ? 'border-slate-900' : 'border-slate-200'}`}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
      <button type="button" onClick={() => exec('bold')} className="rounded-lg border border-border px-2 py-1">
        <Bold className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('italic')} className="rounded-lg border border-border px-2 py-1">
        <Italic className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('underline')} className="rounded-lg border border-border px-2 py-1">
        <Underline className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('justifyLeft')} className="rounded-lg border border-border px-2 py-1">
        <AlignLeft className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('justifyCenter')} className="rounded-lg border border-border px-2 py-1">
        <AlignCenter className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('justifyRight')} className="rounded-lg border border-border px-2 py-1">
        <AlignRight className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('indent')} className="rounded-lg border border-border px-2 py-1">
        <Indent className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('outdent')} className="rounded-lg border border-border px-2 py-1">
        <Outdent className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('formatBlock', '<h3>')} className="rounded-lg border border-border px-2 py-1">
        <Text className="h-4 w-4" />
      </button>
      <button type="button" onClick={() => exec('formatBlock', '<p>')} className="rounded-lg border border-border px-2 py-1">
        <Pilcrow className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          if (!activeRef?.current) return;
          activeRef.current.dir = 'rtl';
          activeRef.current.style.textAlign = 'right';
        }}
        className="rounded-lg border border-border px-2 py-1"
      >
        RTL
      </button>
      <button
        type="button"
        onClick={() => {
          if (!activeRef?.current) return;
          activeRef.current.dir = 'ltr';
          activeRef.current.style.textAlign = 'left';
        }}
        className="rounded-lg border border-border px-2 py-1"
      >
        LTR
      </button>
      <div className="flex flex-wrap items-center gap-1">
        {ARABIC_MARKS.map((mark) => (
          <button key={mark} type="button" onClick={() => insertText(mark)} className="rounded-md border border-border px-2 py-1 text-xs">
            {mark}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {ARABIC_SYMBOLS.map((symbol) => (
          <button key={symbol} type="button" onClick={() => insertText(symbol)} className="rounded-md border border-border px-2 py-1 text-xs">
            {symbol}
          </button>
        ))}
      </div>
    </div>
  );
};

export default RichTextToolbar;
