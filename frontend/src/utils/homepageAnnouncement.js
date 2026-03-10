const toneClassMap = {
  default: 'bg-card border-border text-foreground',
  primary: 'bg-primary/10 border-primary/20 text-primary',
  muted: 'bg-muted/50 border-border text-foreground',
};

const backgroundClassMap = {
  card: 'bg-card',
  muted: 'bg-muted/50',
  primary: 'bg-primary/10',
  success: 'bg-emerald-50',
  warning: 'bg-amber-50',
  info: 'bg-sky-50',
};

const borderClassMap = {
  default: 'border-border',
  primary: 'border-primary/20',
  success: 'border-emerald-200',
  warning: 'border-amber-200',
  info: 'border-sky-200',
  muted: 'border-muted',
};

const alignClassMap = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

const sanitizeStyleValue = (value, fallback) => {
  const normalized = String(value || '').trim();
  return normalized || fallback;
};

const normalizeBoolean = (value) => Boolean(value);

export const getHomepageAnnouncementToneClass = (tone) => toneClassMap[tone] || toneClassMap.default;

export const getHomepageAnnouncementBackgroundClass = (backgroundColor) => (
  backgroundClassMap[backgroundColor] || ''
);

export const getHomepageAnnouncementBorderClass = (borderColor) => (
  borderClassMap[borderColor] || ''
);

export const getHomepageAnnouncementAlignClass = (align) => alignClassMap[align] || alignClassMap.left;

export const getHomepageAnnouncementContainerClass = ({
  tone,
  align,
  backgroundColor,
  borderColor,
  baseClassName = 'rounded-xl border px-4 py-3',
} = {}) => {
  const customBgClass = getHomepageAnnouncementBackgroundClass(backgroundColor);
  const customBorderClass = getHomepageAnnouncementBorderClass(borderColor);
  const resolvedToneClass = (!customBgClass && !customBorderClass) ? getHomepageAnnouncementToneClass(tone) : 'text-foreground';
  const classes = [
    baseClassName,
    resolvedToneClass,
    customBgClass,
    customBorderClass,
    getHomepageAnnouncementAlignClass(align),
  ];
  return classes.filter(Boolean).join(' ');
};

export const getHomepageAnnouncementTextClass = ({
  fontSize,
  fontWeight,
  italic,
  baseClassName = 'whitespace-pre-wrap break-words',
} = {}) => {
  const classes = [
    baseClassName,
    sanitizeStyleValue(fontSize, 'text-sm'),
    sanitizeStyleValue(fontWeight, 'font-medium'),
    normalizeBoolean(italic) ? 'italic' : '',
  ];
  return classes.filter(Boolean).join(' ');
};
