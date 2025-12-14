import Link from 'next/link';
import type { LandingSection, MarketingBlogPost } from '@/lib/marketingClient';
import { SectionIntro } from './SectionIntro';
import { cardClasses, mutedTextClass, surfaceClasses } from './theme';

type Props = {
  section: LandingSection;
  posts: MarketingBlogPost[];
};

const LandingBlogDigest = ({ section, posts }: Props) => {
  const limit = section.limit && section.limit > 0 ? section.limit : 3;
  const visible = posts.slice(0, limit);
  const themeSurface = surfaceClasses(section.theme);
  const mutedText = mutedTextClass(section.theme);

  return (
    <section className={`py-16 ${themeSurface}`}>
      <div className="mx-auto max-w-6xl px-4">
        <SectionIntro
          section={section}
          fallback={{
            kicker: 'Blog',
            headline: 'Latest notes from the team',
            subheading: 'Articles arrive the moment marketing publishes them.'
          }}
        />

        {!visible.length ? (
          <p className={`mt-10 rounded-2xl border border-dashed px-6 py-8 text-sm text-center ${mutedText}`}>
            Publish a blog post to populate this block.
          </p>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {visible.map((post) => (
              <article key={post._id} className={`flex flex-col rounded-2xl p-5 shadow-sm ${cardClasses(section.theme)}`}>
                <div className={`text-xs font-semibold uppercase tracking-[0.3em] ${mutedText}`}>
                  {post.category || 'Update'} · {post.readingTime || 4} min read
                </div>
                <h3 className="mt-3 text-xl font-semibold">{post.title}</h3>
                <p className={`mt-2 text-sm ${mutedText}`}>{post.summary || 'Preview pulls from the Marketing Hub.'}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
                  {(post.tags || []).slice(0, 3).map((tag: string) => (
                    <span key={tag} className="rounded-full bg-slate-100/70 px-2 py-0.5">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-auto pt-4">
                  <Link href={`/blog/${post.slug}`} className="text-sm font-semibold text-slate-900">
                    Read article →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export { LandingBlogDigest };
