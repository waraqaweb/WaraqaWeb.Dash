# Marketing + Dashboard Integration Architecture

## Purpose

Document the agreed architecture for merging the public marketing site with the existing Waraqa dashboard so implementation phases have a shared north star.

## Current State Summary

- **Frontend**: CRA React dashboard (`frontend/`) with role-gated routes, Tailwind styling, JWT auth via `AuthContext`, and feature bundles for classes, invoices, salaries, feedback, meetings, and public evaluation booking.
- **Backend**: Express + MongoDB (`backend/`) exposing REST APIs for all operational features, running scheduled jobs and socket.io notifications. No CMS-style content models yet.
- **Legacy Site**: Standalone Express/EJS marketing site (shared separately) that contains static copy for home, courses, testimonials, pricing, etc., but no admin controls.

## Target Architecture

- **Frontend Split**: Single domain serving two surfaces:
  - `/` served by a new Next.js 15 app (App Router, TypeScript, Tailwind) that renders all marketing pages (home, courses, pricing, teachers, testimonials, blog, seminars, booking, contact) with SSR/ISR for SEO.
  - `/dashboard` continues to serve the existing CRA bundle (short term). Future migration can move the dashboard into the Next app under `/app/dashboard`.
- **Backend Extensions**:
  - New marketing content schemas (site settings, courses, pricing plans, teacher profiles, testimonials, blog posts, seminar schedules, media assets) managed through APIs under `/api/marketing`.
  - Admin-only CRUD endpoints with audit metadata and media upload handling (Cloudinary).
  - Public read endpoints that Next consumes, cached with short revalidation windows and invalidated via webhooks/events when content changes.
- **Auth & Permissions**: Reuse existing JWT + `requireAdmin` middleware. Only admins can mutate marketing content; public endpoints remain read-only.
- **Publishing Flow**: Admin CMS screens (Phase 3) push updates through these APIs. Backend emits revalidation events so the Next site can refresh ISR caches.

## Routing & Deployment

- Maintain a single primary domain. Reverse proxy (NGINX or platform routing) directs `/dashboard` and `/dashboard/*` to the CRA build, everything else to the Next app.
- APIs remain at `/api/*` served by the existing Express server.
- Static assets/media served via Cloudinary CDN; Next image optimizer handles responsive variants.

## SEO & Performance Considerations

- Next pages export metadata for canonical/OG/Twitter tags plus JSON-LD for Course, Event, Organization, Review, and BlogPosting schemas.
- Automated sitemap and RSS generation triggered whenever marketing entities change.
- Core Web Vitals monitored via Next instrumentation posting metrics back to the backend analytics service.

## Data & Content Flows

1. Admin edits marketing content inside the dashboard CMS UI → `PUT/POST /api/marketing/...`.
2. Backend persists to Mongo, records `updatedBy`, and publishes an event to revalidate Next cache tags.
3. Next site refetches relevant resources (ISR) and serves updated pages publicly.
4. Public forms (evaluation, seminar, contact) submit to marketing APIs that create bookings/records and notify admins via existing email/notification services.

## Phase 1 Implementation Status

- `MarketingSiteSettings` model introduced (hero block, contact info, social links, SEO defaults, announcement, audit info).
- `/api/marketing/site-settings` GET (public) and PUT (admin) endpoints implemented and mounted in `server.js`.

## Phase 2 Implementation Status

- Added dedicated marketing content models: `MarketingCourse`, `MarketingPricingPlan`, `MarketingTeacherProfile`, `MarketingTestimonial`, `MarketingBlogPost`, `MediaAsset`, `SeminarSchedule`, `SeminarRegistration`, and `MarketingContactMessage`, plus extensions to `Feedback` and `MeetingAvailabilitySlot`.
- Expanded `/api/marketing` router with admin CRUD for courses, pricing, teachers, testimonials, blog posts, seminars, media assets, and site settings (all gated by `authenticateToken` + `requireAdmin`).
- Delivered public, cacheable endpoints for courses, pricing, teachers, testimonials, blog listings/detail, seminars, contact/evaluation forms, sitemap, and Atom feeds.
- Implemented Cloudinary-backed media uploads and metadata storage, along with deletion hooks.
- Created seminar booking pipeline with capacity checks and registration records, plus evaluation/contact submission endpoints that integrate with the existing meeting service.

## Phase 3 Implementation Status

- Extended the admin dashboard with a Marketing Hub entry under `/admin/marketing`, including a site settings form bound to the new APIs.
- Added a Content Library view that aggregates courses, pricing, teachers, testimonials, blog posts, and media assets so admins can see publication status at a glance.
- Built inline tooling to create, edit, and delete marketing courses without leaving the dashboard, ensuring immediate refresh after each change.
- Introduced a Landing Builder workspace that seeds configurable landing pages (starting with `/`) and lets admins toggle, reorder, and annotate hero/courses/pricing/testimonial/blog/contact sections ahead of wiring the Next.js site to those definitions.

## Phase 4 Kickoff Plan

- Scaffold a Next.js 15 (App Router + Tailwind) marketing app inside `frontend/marketing-site` that will ultimately serve `/` in production.
- Implement global data fetchers that hit the existing `/api/marketing` endpoints using `NEXT_PUBLIC_API_BASE_URL` so the site can run locally against the Express server.
- Ship the initial chrome—shared `<MarketingHeader />`, `<MarketingFooter />`, and a home page that renders hero data from site settings—to unblock visual QA of the marketing experience.
- Add placeholder routes for Courses, Pricing, Teachers, Blog, and Contact so navigation is wired even before deeper templates are built.

### Current Sprint Objectives

- Replace the placeholder Pricing page with live plan cards sourced from `GET /marketing/pricing`.
- Build the Courses listing page that paginates/filter displays `GET /marketing/courses` results and links to course detail routes.
- Ensure navigation/preview guidance stays in sync so admins know how to QA the marketing site locally.

## Next Steps

1. Phase 3: build dashboard CMS screens consuming the new marketing APIs with rich-text/media controls and publish workflow.
2. Phase 4: scaffold the Next.js marketing frontend consuming the marketing APIs.
3. Phase 5: wire SEO automation, analytics, and shared form integrations.
4. Phase 6: execute QA, launch readiness, and deployment runbooks.
