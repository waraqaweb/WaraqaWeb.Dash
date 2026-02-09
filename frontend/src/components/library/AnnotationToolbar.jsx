import React from 'react';
import { Eraser, Highlighter, PenSquare, RotateCcw, RotateCw, Save, Square, Trash2, Type } from 'lucide-react';

const COLORS = ['#f97316', '#0ea5e9', '#a855f7', '#22c55e', '#f43f5e', '#facc15'];
const SIZES = [2, 4, 6, 10];
const FONT_SIZES = [14, 18, 22, 28];
const FONT_FAMILIES = [
  { label: 'Scheherazade New', value: '"Scheherazade New", serif' },
  { label: 'Noto Naskh Arabic', value: '"Noto Naskh Arabic", serif' },
  { label: 'Aref Ruqaa', value: '"Aref Ruqaa", serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Amiri Quran', value: '"Amiri Quran", serif' }
];

const AnnotationToolbar = ({
  tool,
  setTool,
  color,
  setColor,
  size,
  setSize,
  fontSize,
  setFontSize,
  fontFamily,
  setFontFamily,
  onUndo,
  onRedo,
  onClear,
  onSave,
  canUndo,
  canRedo,
  disabled = false,
  disabledNotice,
  orientation = 'horizontal',
  compact = false,
  className = ''
}) => {
  const disabledClass = disabled ? 'cursor-not-allowed opacity-60' : '';
  const isVertical = orientation === 'vertical';
  const sectionClass = isVertical ? 'flex flex-col gap-2' : 'flex items-center gap-2 flex-wrap';
  const paletteClass = isVertical ? 'flex flex-wrap gap-2' : 'flex items-center gap-2';
  const actionsClass = isVertical ? 'flex flex-wrap items-center gap-2 pt-2 border-t border-border/50' : 'ml-auto flex items-center gap-2';
  const buttonSpread = isVertical ? 'w-full justify-center' : '';
  const buttonPadding = compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  const showFontFamily = typeof setFontFamily === 'function' && Boolean(fontFamily);
  const handleButtonClass = (active) =>
    `inline-flex items-center gap-1 rounded-lg ${buttonPadding} ${
      active ? 'bg-emerald-600 text-white' : 'text-muted-foreground border border-border'
    } ${buttonSpread} ${disabledClass}`;

  return (
    <div
      className={`${
        isVertical ? 'flex flex-col gap-4' : 'flex flex-wrap items-center gap-3'
      } ${compact ? 'rounded-none border-0 bg-transparent p-2 shadow-none' : 'rounded-xl border border-border bg-card/80 p-3 shadow-sm'} ${disabled ? 'opacity-80' : ''} ${className}`.trim()}
      aria-disabled={disabled}
    >
      <div className={sectionClass}>
        {!compact && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tools</p>}
        <div className={isVertical ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap items-center gap-2'}>
          <button type="button" onClick={() => setTool('pen')} disabled={disabled} className={handleButtonClass(tool === 'pen')}>
            <PenSquare className="h-4 w-4" />
            {!compact && 'Pen'}
          </button>
          <button type="button" onClick={() => setTool('highlighter')} disabled={disabled} className={handleButtonClass(tool === 'highlighter')}>
            <Highlighter className="h-4 w-4" />
            {!compact && 'Highlight'}
          </button>
          <button type="button" onClick={() => setTool('text')} disabled={disabled} className={handleButtonClass(tool === 'text')}>
            <Type className="h-4 w-4" />
            {!compact && 'Text'}
          </button>
          <button type="button" onClick={() => setTool('shape')} disabled={disabled} className={handleButtonClass(tool === 'shape')}>
            <Square className="h-4 w-4" />
            {!compact && 'Shape'}
          </button>
          <button type="button" onClick={() => setTool('eraser')} disabled={disabled} className={handleButtonClass(tool === 'eraser')}>
            <Eraser className="h-4 w-4" />
            {!compact && 'Eraser'}
          </button>
        </div>
      </div>

      <div className={sectionClass}>
        {!compact && <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Color</p>}
        <div className={paletteClass}>
          {COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              disabled={disabled}
              onClick={() => setColor(hex)}
              className={`h-6 w-6 rounded-full border-2 ${color === hex ? 'border-emerald-600' : 'border-transparent'} ${disabledClass}`}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </div>

      <div className={sectionClass}>
        {!compact && <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Stroke</label>}
        <div className={isVertical ? 'grid grid-cols-2 gap-2' : 'flex items-center gap-2'}>
          {SIZES.map((option) => (
            <button
              key={option}
              type="button"
              disabled={disabled}
              onClick={() => setSize(option)}
              className={`rounded-full border px-2 py-1 text-xs ${
                size === option ? 'border-emerald-600 text-emerald-700' : 'border-border text-muted-foreground'
              } ${buttonSpread} ${disabledClass}`}
            >
              {compact ? <span className="inline-block h-2 w-2 rounded-full bg-current" /> : `${option}px`}
            </button>
          ))}
        </div>
      </div>

      <div className={sectionClass}>
        {!compact && <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Font</label>}
        <div className={isVertical ? 'flex flex-col gap-2' : 'flex items-center gap-2'}>
          {showFontFamily && (
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              disabled={disabled}
              className={`rounded-lg border border-border bg-background px-2 py-1 text-sm ${disabledClass}`}
            >
              {FONT_FAMILIES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          <select
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            disabled={disabled}
            className={`rounded-lg border border-border bg-background px-2 py-1 text-sm ${disabledClass}`}
          >
            {FONT_SIZES.map((option) => (
              <option key={option} value={option}>{option}px</option>
            ))}
          </select>
        </div>
      </div>

      <div className={actionsClass}>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo || disabled}
          className="rounded-lg border border-border p-2 text-muted-foreground disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo || disabled}
          className="rounded-lg border border-border p-2 text-muted-foreground disabled:opacity-50"
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="rounded-lg border border-destructive/70 p-2 text-destructive disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className={`rounded-lg bg-emerald-600 ${compact ? 'p-2' : 'px-3 py-1.5 text-sm font-semibold'} text-white disabled:opacity-50`}
        >
          {compact ? <Save className="h-4 w-4" /> : 'Save'}
        </button>
      </div>

      {disabled && disabledNotice && (
        <p className="w-full text-xs text-muted-foreground">{disabledNotice}</p>
      )}
    </div>
  );
};

export default AnnotationToolbar;
