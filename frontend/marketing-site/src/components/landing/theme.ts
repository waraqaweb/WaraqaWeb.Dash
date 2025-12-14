const surfaceClasses = (theme?: string) => {
  switch (theme) {
    case 'dark':
      return 'bg-slate-900 text-white';
    case 'warm':
      return 'bg-amber-50 text-slate-900';
    case 'slate':
      return 'bg-slate-50 text-slate-900';
    default:
      return 'bg-white text-slate-900';
  }
};

const cardClasses = (theme?: string) =>
  theme === 'dark'
    ? 'border border-white/10 bg-white/5 text-white'
    : 'border border-slate-200 bg-white text-slate-900';

const mutedTextClass = (theme?: string) => (theme === 'dark' ? 'text-white/70' : 'text-slate-500');

const accentBorderClass = (theme?: string) => (theme === 'dark' ? 'border-white/20' : 'border-slate-200');

export { surfaceClasses, cardClasses, mutedTextClass, accentBorderClass };
