export type AccentKey = 'emerald' | 'indigo' | 'rose' | 'amber' | 'teal';

export const accentThemes: Record<AccentKey, { badge: string; ring: string; gradient: string; text: string; dot: string }> = {
  emerald: {
    badge: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    ring: 'ring-emerald-100/60',
    gradient: 'from-emerald-100/70 via-white to-white',
    text: 'text-emerald-600',
    dot: 'bg-emerald-500'
  },
  indigo: {
    badge: 'bg-indigo-50 text-indigo-600 border-indigo-100',
    ring: 'ring-indigo-100/60',
    gradient: 'from-indigo-100/60 via-white to-white',
    text: 'text-indigo-600',
    dot: 'bg-indigo-500'
  },
  rose: {
    badge: 'bg-rose-50 text-rose-600 border-rose-100',
    ring: 'ring-rose-100/60',
    gradient: 'from-rose-100/60 via-white to-white',
    text: 'text-rose-600',
    dot: 'bg-rose-500'
  },
  amber: {
    badge: 'bg-amber-50 text-amber-600 border-amber-100',
    ring: 'ring-amber-100/60',
    gradient: 'from-amber-100/60 via-white to-white',
    text: 'text-amber-600',
    dot: 'bg-amber-500'
  },
  teal: {
    badge: 'bg-teal-50 text-teal-600 border-teal-100',
    ring: 'ring-teal-100/60',
    gradient: 'from-teal-100/60 via-white to-white',
    text: 'text-teal-600',
    dot: 'bg-teal-500'
  }
};

export const accentOrder: AccentKey[] = ['emerald', 'indigo', 'rose', 'amber', 'teal'];

export const ensureAccent = (accent?: string): AccentKey => {
  if (!accent) return 'emerald';
  return accentThemes[accent as AccentKey] ? (accent as AccentKey) : 'emerald';
};
