import { notFound } from 'next/navigation';
import MarketingHeader from '../../../components/MarketingHeader';
import MarketingFooter from '../../../components/MarketingFooter';
import { BlogArticle } from '../../../components/BlogArticle';
import { getBlogPost, getSiteSettings } from '../../../lib/marketingClient';

type BlogArticlePageProps = {
  params: Promise<{ slug: string }>;
};

const BlogArticlePage = async ({ params }: BlogArticlePageProps) => {
  const { slug } = await params;
  const [settingsResult, postResult] = await Promise.allSettled([
    getSiteSettings(),
    getBlogPost(slug)
  ]);

  const siteSettings = settingsResult.status === 'fulfilled' ? settingsResult.value : undefined;
  const post = postResult.status === 'fulfilled' ? postResult.value : null;

  if (!post) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main>
        <BlogArticle post={post} />
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default BlogArticlePage;
