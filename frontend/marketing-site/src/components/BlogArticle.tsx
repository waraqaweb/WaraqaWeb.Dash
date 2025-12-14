import clsx from 'clsx';
import Image from 'next/image';
import type { MarketingBlogPost } from '@/lib/marketingClient';
import { accentThemes, ensureAccent } from './storyThemes';
import { renderRichContent } from './richContent';

const formatDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

const defaultSectionLabel = (index: number) => `Section ${index + 1}`;

const buildArticleSections = (post: MarketingBlogPost) => {
  if (!post.articleSections || !post.articleSections.length) {
    return [];
  }
  return [...post.articleSections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((section, index) => ({
      id: `${post._id}-section-${index}`,
      kicker: section.kicker || defaultSectionLabel(index),
      heading: section.heading || post.title,
      body: section.body || post.summary || '',
      media: section.media || post.heroImage,
      align: section.align === 'left' ? 'left' : 'right',
      accent: ensureAccent(section.accent)
    }));
};

export const BlogArticle = ({ post }: { post: MarketingBlogPost }) => {
  const direction = post.contentDirection || (post.language === 'ar' ? 'rtl' : 'ltr');
  const sections = buildArticleSections(post);
  const primaryAccent = sections[0]?.accent || ensureAccent(post.articleSections?.[0]?.accent);
  const theme = accentThemes[primaryAccent];
  const introSource = post.articleIntro || post.summary;
  const introContent = introSource ? renderRichContent(introSource, 'mt-8 text-lg leading-8 text-slate-600') : null;
  const hasNarrative = sections.length > 0;

  return (
    <article className="relative isolate py-20">
      <div className="parallax-grid" aria-hidden />
      <div className="mx-auto max-w-5xl rounded-[48px] border border-white/40 bg-white/80 p-8 shadow-[0_40px_120px_rgba(15,23,42,0.08)] ring-1 ring-white/60 backdrop-blur">
        <div className="flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
          <span className={clsx('inline-flex items-center gap-2 rounded-full border px-4 py-1.5', theme.badge)}>
            {post.category || 'Feature'}
          </span>
          <span>{post.readingTime || 4} min read</span>
          <span>{post.language?.toUpperCase() || 'EN'}</span>
        </div>
        <h1 className="mt-6 font-display text-4xl leading-tight tracking-tight text-slate-900 md:text-5xl">{post.title}</h1>
        <div className="mt-3 text-sm text-slate-500">{formatDate(post.publishedAt)}</div>
        {post.heroImage && (
          <div className="mt-10 overflow-hidden rounded-[32px] border border-white/50 shadow-lg">
            <Image
              src={post.heroImage}
              alt={post.title}
              width={1600}
              height={900}
              className="h-96 w-full object-cover"
            />
          </div>
        )}
        {introContent}

        {hasNarrative ? (
          <div className="mt-12 space-y-10">
            {sections.map((section, index) => {
              const accent = accentThemes[section.accent];
              return (
                <section key={section.id} className="relative isolate overflow-hidden rounded-[36px] border border-white/70 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.07)]">
                  <div className={clsx('absolute inset-0 bg-gradient-to-br opacity-40', accent.gradient)} aria-hidden />
                  <div className={clsx('relative flex flex-col gap-6 md:flex-row', section.align === 'left' ? '' : 'md:flex-row-reverse')}>
                    {section.media && (
                      <div className="md:w-1/2">
                        <Image
                          src={section.media}
                          alt={section.heading}
                          width={1600}
                          height={900}
                          className="h-80 w-full object-cover"
                        />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col gap-4 p-8">
                      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                        <span>{section.kicker}</span>
                        <span className={clsx('h-1.5 w-1.5 rounded-full', accent.dot)} />
                        <span>Part {index + 1}</span>
                      </div>
                      <h2 className="font-display text-3xl text-slate-900">{section.heading}</h2>
                      {renderRichContent(section.body, 'mt-2 text-base leading-7 text-slate-600')}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div
            className="rich-prose mt-10 text-slate-800"
            dir={direction}
            style={{ textAlign: direction === 'rtl' ? 'right' : 'left' }}
            dangerouslySetInnerHTML={{ __html: post.content || '' }}
          />
        )}

        {(post.tags || []).length > 0 && (
          <div className="mt-10 flex flex-wrap gap-2 text-xs text-slate-500">
            {(post.tags || []).map((tag) => (
              <span key={tag} className="rounded-full bg-slate-100 px-3 py-1">#{tag}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};
