import MarketingHeader from '../../components/MarketingHeader';
import MarketingFooter from '../../components/MarketingFooter';
import { BlogListSection } from '../../components/BlogListSection';
import { getBlogPosts, getSiteSettings } from '../../lib/marketingClient';

const BlogPage = async () => {
  const [siteSettings, blogData] = await Promise.all([
    getSiteSettings(),
    getBlogPosts({ limit: 12 })
  ]);
  const posts = blogData.posts || [];
  return (
    <div className="min-h-screen bg-slate-50">
      <MarketingHeader siteSettings={siteSettings} />
      <main>
        <BlogListSection posts={posts} />
      </main>
      <MarketingFooter siteSettings={siteSettings} />
    </div>
  );
};

export default BlogPage;
