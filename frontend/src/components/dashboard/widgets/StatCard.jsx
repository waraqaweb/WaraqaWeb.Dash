import React from 'react';

const StatCard = ({ title, value, Icon, color = 'bg-card text-foreground', trend = null, compact = false }) => {
  const containerClass = compact ? 'bg-card rounded p-3 shadow-sm border border-border' : 'bg-card rounded-lg border border-border p-6 shadow-sm';
  const titleClass = compact ? 'text-xs font-medium text-muted-foreground' : 'text-sm font-medium text-muted-foreground';
  const valueClass = compact ? 'text-lg font-bold text-foreground' : 'text-2xl font-bold text-foreground';
  const iconSize = compact ? 'h-4 w-4' : 'h-6 w-6';
  const iconContainer = compact ? `h-8 w-8 rounded-full flex items-center justify-center ${color}` : `h-12 w-12 rounded-full flex items-center justify-center ${color}`;

  // Defensive: avoid rendering raw objects/arrays as children
  let safeValue = value;
  if (!React.isValidElement(safeValue)) {
    if (Array.isArray(safeValue)) {
      // display count for arrays
      safeValue = safeValue.length;
    } else if (safeValue !== null && typeof safeValue === 'object') {
      // try common numeric fields, else fallback to dash
      const common = ['count', 'total', 'value', 'length'];
      const key = common.find(k => typeof safeValue[k] === 'number');
      safeValue = typeof key !== 'undefined' ? safeValue[key] : '—';
      if (process && process.env && process.env.NODE_ENV !== 'production') {
        try { console.warn('[StatCard] Non-primitive value provided; rendering fallback:', title, value); } catch (_) {}
      }
    }
  }

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between">
        <div>
          <p className={titleClass}>{title}</p>
          <p className={valueClass}>{safeValue}</p>
          {trend && !compact && (
            <div className="flex items-center mt-1">
              <span className="text-xs text-green-500">{trend}</span>
            </div>
          )}
        </div>
        <div className={iconContainer}>
          {Icon ? <Icon className={iconSize} /> : null}
        </div>
      </div>
    </div>
  );
};

export default StatCard;
