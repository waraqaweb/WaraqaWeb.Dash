'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import Image from 'next/image';
import type { MarketingBlogPost } from '@/lib/marketingClient';
import { accentThemes, accentOrder, ensureAccent } from './storyThemes';
import { renderRichContent } from './richContent';

const formatDate = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const defaultSectionLabel = (index: number) => `Section ${index + 1}`;

const BlogListSection = ({ posts }: { posts: MarketingBlogPost[] }) => {
  const [languageFilter, setLanguageFilter] = useState('All');
  const [tagFilter, setTagFilter] = useState('All');

  const meta = useMemo(() => {
    const languages = new Set<string>();
    const tags = new Set<string>();
    posts.forEach((post) => {
      if (post.language) languages.add(post.language);
      (post.tags || []).forEach((tag) => tags.add(tag));
    });
    return {
      languageOptions: ['All', ...Array.from(languages)],
      tagOptions: ['All', ...Array.from(tags)]
    };
  }, [posts]);

  const filtered = posts.filter((post) => {
    const matchesLanguage = languageFilter === 'All' || post.language === languageFilter;
    const matchesTag =
      tagFilter === 'All' || (post.tags || []).some((tag) => tag.toLowerCase() === tagFilter.toLowerCase());
    return matchesLanguage && matchesTag;
  });

  const editorialPosts = filtered.map((post, index) => {
    const sectionAccent = post.articleSections?.length ? ensureAccent(post.articleSections[0]?.accent) : undefined;
    const accent = sectionAccent || accentOrder[index % accentOrder.length];
    return { post, accent };
  });

  if (!posts.length) {
    return (
      <section className="relative isolate py-24">
        <div className="parallax-grid" aria-hidden />
        <div className="mx-auto max-w-3xl rounded-[40px] border border-dashed border-slate-300 bg-white/70 p-12 text-center shadow-xl">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-400">Blog</p>
          <h2 className="mt-4 text-3xl font-semibold text-slate-900">Your first editorial story will appear here.</h2>
          <p className="mt-4 text-base text-slate-600">Publish an article inside the Marketing Hub to unlock the immersive storytelling layout.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="relative isolate py-24" id="blog">
      <div className="parallax-grid" aria-hidden />
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-400">Editorial</p>
          <h1 className="mt-4 font-display text-4xl leading-tight tracking-tight text-slate-900">Immersive stories from our instructors</h1>
          <p className="mt-4 text-lg text-slate-600">Each narrative is composed inside the Marketing Hub—with custom section names, bilingual formatting, and rich text flourishes.</p>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-4 rounded-full bg-white/80 px-6 py-4 shadow-inner ring-1 ring-white/70">
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-semibold uppercase tracking-[0.2em] text-slate-400">Language</span>
            {meta.languageOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setLanguageFilter(option)}
                className={clsx(
                  'rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition',
                  languageFilter === option
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-600'
                )}
              >
                {option === 'All' ? 'All' : option.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span className="font-semibold uppercase tracking-[0.2em] text-slate-400">Tag</span>
            {meta.tagOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTagFilter(option)}
                className={clsx(
                  'rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition',
                  tagFilter === option
                    ? 'border-amber-500 bg-amber-500 text-white'
                    : 'border-slate-200 text-slate-600'
                )}
              >
                {option === 'All' ? 'All' : option}
              </button>
            ))}
          </div>
          <div className="ml-auto text-sm text-slate-500">Showing {filtered.length} of {posts.length} articles</div>
        </div>

        {editorialPosts.length === 0 ? (
          <div className="mt-10 rounded-[32px] border border-dashed border-slate-200 bg-white/60 p-8 text-center text-sm text-slate-500">
            No stories match the current filters.
          </div>
        ) : (
          <div className="mt-10 space-y-10">
            {editorialPosts.map(({ post, accent }) => {
            const theme = accentThemes[accent];
            const introSource = post.articleIntro || post.summary;
            const introContent = introSource
              ? renderRichContent(introSource, 'mt-2 text-base leading-7 text-slate-700')
              : null;
            const sectionLabels = (post.articleSections || [])
              .slice()
              .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
              .map((section, index) => section.kicker || defaultSectionLabel(index))
              .slice(0, 3);
            const chips = sectionLabels.length ? sectionLabels : (post.tags || []).slice(0, 3);

            return (
              <article
                key={post._id}
                className="relative isolate overflow-hidden rounded-[44px] border border-white/70 bg-white/80 p-8 shadow-[0_30px_120px_rgba(15,23,42,0.08)] ring-1 ring-white/70 backdrop-blur"
              >
                <div className={clsx('absolute inset-0 bg-gradient-to-br opacity-40', theme.gradient)} aria-hidden />
                <div className="relative flex flex-col gap-8 md:flex-row">
                  {post.heroImage && (
                    <div className="overflow-hidden rounded-[32px] border border-white/60 bg-white/40 shadow-md md:w-5/12">
                      <Image
                        src={post.heroImage}
                        alt={post.title}
                        width={1400}
                        height={900}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-5">
                    <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                      <span className={clsx('inline-flex items-center gap-2 rounded-full border px-4 py-1.5', theme.badge)}>
                        {post.category || 'Feature'}
                      </span>
                      <span>{post.readingTime || 4} min read</span>
                      <span>{post.language?.toUpperCase() || 'EN'}</span>
                      <span>{formatDate(post.publishedAt)}</span>
                    </div>
                    <h2 className="font-display text-3xl leading-tight text-slate-900">{post.title}</h2>
                    {introContent}
                    <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                      {chips.map((chip) => (
                        <span key={chip} className="rounded-full border border-slate-200 px-4 py-1 text-slate-500">
                          {chip}
                        </span>
                      ))}
                    </div>
                    <div className="mt-auto flex items-center justify-between text-sm text-slate-600">
                      <span>Updated via Marketing Hub</span>
                      <Link
                        href={`/blog/${post.slug}`}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-lg"
                      >
                        Read full story →
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          </div>
        )}
      </div>
    </section>
  );
};

export { BlogListSection };
