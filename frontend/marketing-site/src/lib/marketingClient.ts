const API_BASE_URL =
  process.env.MARKETING_API_BASE_URL ||
  process.env.NEXT_PUBLIC_MARKETING_API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:5000/api';

const DEFAULT_TIMEOUT_MS = Number(
  process.env.MARKETING_API_TIMEOUT_MS || (process.env.NODE_ENV === 'production' ? 10000 : 1500)
);

const SHOULD_LOG_FETCH_ERRORS =
  process.env.MARKETING_API_LOG_ERRORS != null
    ? process.env.MARKETING_API_LOG_ERRORS !== 'false'
    : process.env.NODE_ENV === 'production';
const loggedFailures = new Set<string>();

const describeFetchError = (error: unknown): { kind: string; code?: string; message?: string } => {
  const err = error as unknown as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: unknown;
  };

  const cause = err?.cause as unknown as { code?: unknown } | undefined;

  const name = typeof err?.name === 'string' ? err.name : undefined;
  const message = typeof err?.message === 'string' ? err.message : undefined;
  const code =
    (typeof cause?.code === 'string' ? cause.code : undefined) || (typeof err?.code === 'string' ? err.code : undefined);

  if (name === 'AbortError') {
    return { kind: 'timeout', code, message };
  }

  if (code) {
    return { kind: code, code, message };
  }

  return { kind: name || 'error', code, message };
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw new Error(`Marketing API error: ${response.status}`);
  }
  return response.json();
};

const fetchJson = async <T>(path: string, init?: RequestInit, fallback?: T): Promise<T> => {
  const controller = init?.signal ? undefined : new AbortController();
  const timeoutMs = Number.isFinite(DEFAULT_TIMEOUT_MS) && DEFAULT_TIMEOUT_MS > 0 ? DEFAULT_TIMEOUT_MS : 10000;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      cache: init?.cache ?? 'no-store',
      signal: init?.signal ?? controller?.signal
    });
    // NOTE: We must await here so non-OK responses are caught by this try/catch.
    return await handleResponse<T>(res);
  } catch (error) {
    if (SHOULD_LOG_FETCH_ERRORS) {
      const key = `${API_BASE_URL}${path}`;
      if (!loggedFailures.has(key)) {
        loggedFailures.add(key);
        const info = describeFetchError(error);
        const level = typeof fallback !== 'undefined' ? 'warn' : 'error';
        const label = info.code && info.kind !== info.code ? `${info.kind}:${info.code}` : info.kind;
        console[level](`[marketing] API fetch failed (${label}) ${key}`);
      }
    }

    if (typeof fallback !== 'undefined') {
      return fallback;
    }

    const hint =
      'Failed to reach the marketing API. Ensure the backend server is running and NEXT_PUBLIC_MARKETING_API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL / MARKETING_API_BASE_URL) is configured.';
    throw new Error(hint);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const getSiteSettings = (options: { preview?: boolean; token?: string } = {}) => {
  const token = typeof options.token === 'string' ? options.token : '';
  const qs = options.preview ? `?token=${encodeURIComponent(token)}` : '';
  const path = options.preview ? `/marketing/site-settings/preview${qs}` : '/marketing/site-settings';
  return fetchJson<SiteSettings>(path, undefined, {});
};

// Landing page payloads can be large (builder JSON) and can exceed Next.js data cache limits.
// Avoid Next data cache for these requests.
export const getLandingPage = (slug: string, options: { preview?: boolean; token?: string } = {}) =>
  fetchJson<LandingPage>(
    `/marketing/landing-pages/${slug}${options.preview ? `?preview=1&token=${encodeURIComponent(options.token || '')}` : ''}`,
    { cache: 'no-store' },
    {
      _id: `fallback-${slug}`,
      title: slug === 'home' ? 'Home' : slug,
      slug,
      sections: []
    }
  );

const loadCourses = async (query?: string): Promise<MarketingCourse[]> => {
  const suffix = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  const data = await fetchJson<{ courses: MarketingCourse[] }>(`/marketing/courses${suffix}`, undefined, { courses: [] });
  return data.courses || [];
};

export const getHeroCourses = async () => {
  const featured = await loadCourses('featured=true');
  if (featured.length > 0) return featured;
  return loadCourses();
};

type CourseQuery = {
  level?: string;
  tag?: string;
  featured?: boolean;
};

export const getCourses = async (query: CourseQuery = {}) => {
  const params = new URLSearchParams();
  if (query.level) params.append('level', query.level);
  if (query.tag) params.append('tag', query.tag);
  if (typeof query.featured === 'boolean') params.append('featured', String(query.featured));
  const suffix = params.toString();
  return loadCourses(suffix);
};

export const getCourse = async (slug: string): Promise<MarketingCourse | null> => {
  try {
    return await fetchJson<MarketingCourse>(`/marketing/courses/${encodeURIComponent(slug)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('Marketing API error: 404')) {
      return null;
    }
    throw error;
  }
};

export const getPricingPlans = async () => {
  const data = await fetchJson<{ plans: PricingPlan[] }>('/marketing/pricing', undefined, { plans: [] });
  return data.plans || [];
};

export const getTeachers = async () => {
  const data = await fetchJson<{ teachers: MarketingTeacher[] }>('/marketing/teachers', undefined, { teachers: [] });
  return data.teachers || [];
};

type TestimonialQuery = {
  locale?: string;
  featured?: boolean;
  limit?: number;
};

export const getTestimonials = async (query: TestimonialQuery = {}) => {
  const params = new URLSearchParams();
  if (query.locale) params.append('locale', query.locale);
  if (typeof query.featured === 'boolean') params.append('featured', String(query.featured));
  if (query.limit) params.append('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await fetchJson<{ testimonials: MarketingTestimonial[] }>(`/marketing/testimonials${suffix}`, undefined, { testimonials: [] });
  return data.testimonials || [];
};

type BlogQuery = {
  page?: number;
  limit?: number;
  tag?: string;
  language?: string;
  category?: string;
  featured?: boolean;
};

export const getBlogPosts = async (query: BlogQuery = {}) => {
  const params = new URLSearchParams();
  if (query.page) params.append('page', String(query.page));
  if (query.limit) params.append('limit', String(query.limit));
  if (query.tag) params.append('tag', query.tag);
  if (query.language) params.append('language', query.language);
  if (query.category) params.append('category', query.category);
  if (typeof query.featured === 'boolean') params.append('featured', String(query.featured));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const data = await fetchJson<{ posts: MarketingBlogPost[]; total: number; page: number }>(
    `/marketing/blog${suffix}`,
    undefined,
    { posts: [], total: 0, page: query.page || 1 }
  );
  return data;
};

export const getBlogPost = (slug: string) =>
  fetchJson<MarketingBlogPost>(`/marketing/blog/${slug}`, undefined, {
    _id: `fallback-${slug}`,
    slug,
    title: 'Post unavailable',
    excerpt: 'This post is temporarily unavailable.',
    content: ''
  } as unknown as MarketingBlogPost);

export type HeroCTA = {
  label: string;
  href: string;
  description?: string;
  style?: string;
};

export type LandingSection = {
  key: string;
  label: string;
  description?: string;
  enabled?: boolean;
  layout?: string;
  theme?: string;
  dataSource?: string;
  dataFilters?: Record<string, unknown>;
  limit?: number;
  settings?: {
    heroCopySource?: 'site' | 'custom';
    kicker?: string;
    headline?: string;
    subheading?: string;
    primaryCta?: HeroCTA;
    secondaryCta?: HeroCTA;
  };
};

export type LandingPage = {
  _id: string;
  title: string;
  slug: string;
  description?: string;
  heroVariant?: string;
  status?: string;
  sections: LandingSection[];
  updatedAt?: string;
};

export type SiteSettings = {
  hero?: {
    eyebrow?: string;
    headline?: string;
    subheading?: string;
    media?: string | null;
    backgroundMedia?: string | null;
    mediaMode?: 'card' | 'background';
    ctas?: HeroCTA[];
  };
  primaryNavigation?: Array<{ label: string; href: string }>;
  secondaryNavigation?: Array<{ label: string; href: string }>;
  contactInfo?: {
    email?: string;
    phone?: string;
    address?: string;
  };
  socialLinks?: Array<{ label: string; url: string; icon?: string }>;
  announcement?: {
    message?: string;
    href?: string;
    active?: boolean;
  };
};

export type MarketingCourse = {
  _id: string;
  title: string;
  slug: string;
  excerpt?: string;
  level?: string;
  badge?: string;
  thumbnailMedia?: string;
  heroMedia?: string;
  scheduleOption?: string;
  tracks?: string[];
  tags?: string[];
  outcomes?: string[];
  curriculum?: Array<{
    title?: string;
    slug?: string;
    description?: string;
    thumbnailMedia?: string;
    heroMedia?: string;
    articleIntro?: string;
    articleSections?: Array<{
      kicker?: string;
      heading?: string;
      body?: string;
      media?: string;
      align?: 'left' | 'right';
      accent?: string;
      order?: number;
    }>;
    published?: boolean;
    order?: number;
  }>;
  articleIntro?: string;
  articleSections?: Array<{
    kicker?: string;
    heading?: string;
    body?: string;
    media?: string;
    align?: 'left' | 'right';
    accent?: string;
    order?: number;
  }>;
  durationWeeks?: number;
  lessonsPerWeek?: number;
  pricingPlan?: PricingPlan | string;
  sortOrder?: number;
  featured?: boolean;
};

export type PricingPlan = {
  _id: string;
  key: string;
  headline: string;
  subheading?: string;
  price?: {
    amount: number;
    currency: string;
    cadence?: string;
  };
  features?: string[];
  audienceTag?: string;
  highlight?: boolean;
  ctaLabel?: string;
  ctaHref?: string;
};

export type MarketingTeacher = {
  _id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  slug?: string;
  role?: string;
  bio?: string;
  avatar?: string;
  country?: string;
  gender?: string;
  yearsExperience?: number;
  languages?: string[];
  credentials?: string[];
  additionalCertificates?: string[];
  education?: string[];
  teachesCourses?: string[];
  featured?: boolean;
};

export type MarketingTestimonial = {
  _id: string;
  guardianName?: string;
  guardianRelation?: string;
  studentName?: string;
  quote: string;
  rating?: number;
  locale?: string;
  featured?: boolean;
  showOnHomepage?: boolean;
  course?: {
    _id: string;
    title: string;
    slug: string;
    level?: string;
  } | string;
};

export type MarketingBlogPost = {
  _id: string;
  title: string;
  slug: string;
  summary?: string;
  heroImage?: string;
  category?: string;
  tags?: string[];
  content: string;
  articleIntro?: string;
  articleSections?: Array<{
    kicker?: string;
    heading?: string;
    body?: string;
    media?: string;
    align?: 'left' | 'right';
    accent?: string;
    order?: number;
  }>;
  language?: string;
  contentDirection?: 'ltr' | 'rtl';
  readingTime?: number;
  status?: string;
  publishedAt?: string;
  featured?: boolean;
};
