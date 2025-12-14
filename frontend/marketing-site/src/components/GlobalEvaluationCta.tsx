import Link from 'next/link';

const GlobalEvaluationCta = () => (
  <div className="pointer-events-none fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
    <Link
      href="/book/evaluation"
      className="pointer-events-auto rounded-full bg-brand px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-brand-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      Book free evaluation
    </Link>
    <p className="pointer-events-none text-[11px] font-semibold uppercase tracking-[0.3em] text-white drop-shadow">
      Always-on support
    </p>
  </div>
);

export default GlobalEvaluationCta;
