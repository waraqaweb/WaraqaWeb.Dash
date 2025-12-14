type Props = {
  title: string;
  description: string;
};

const ComingSoon = ({ title, description }: Props) => (
  <section className="mx-auto max-w-4xl px-4 py-24 text-center">
    <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">In progress</p>
    <h1 className="mt-4 text-4xl font-semibold text-slate-900">{title}</h1>
    <p className="mt-4 text-lg text-slate-600">{description}</p>
    <div className="mt-10 rounded-3xl border border-dashed border-slate-300 bg-white/60 p-6 text-sm text-slate-500">
      Built on top of the marketing APIs so copy, media, and CTAs stay synced with the admin hub.
    </div>
  </section>
);

export default ComingSoon;
