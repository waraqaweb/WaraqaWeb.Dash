export const shellCard = 'rounded-[28px] border border-slate-200 bg-white/80 shadow-sm';
export const shellPad = 'p-5';
export const titleKicker = 'text-[0.7rem] font-semibold uppercase tracking-[0.3em] text-slate-400';
export const titleH2 = 'mt-1 text-xl font-semibold text-slate-900';
export const titleP = 'text-sm text-slate-500';

export const primaryButton = 'inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-slate-800 disabled:opacity-60';
export const secondaryButton = 'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60';

export const tableWrap = 'overflow-x-auto';
export const table = 'min-w-full border-separate border-spacing-y-2';
export const th = 'px-3 py-2 text-left text-[0.7rem] font-semibold uppercase tracking-[0.25em] text-slate-400';
export const td = 'px-3 py-3 text-sm text-slate-700';
export const tr = 'rounded-2xl border border-slate-200 bg-white/80 shadow-sm';

export const pill = (tone) => {
  if (tone === 'green') return 'rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800';
  if (tone === 'amber') return 'rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800';
  if (tone === 'slate') return 'rounded-full bg-slate-100 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-700';
  if (tone === 'red') return 'rounded-full bg-rose-100 px-2 py-0.5 text-[0.7rem] font-semibold text-rose-800';
  return 'rounded-full bg-slate-100 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-700';
};
