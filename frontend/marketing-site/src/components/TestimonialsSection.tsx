'use client';

import { useMemo, useState } from 'react';
import type { MarketingTestimonial } from '@/lib/marketingClient';

const getLocaleLabel = (locale?: string) => {
  if (!locale) return 'English';
  switch (locale) {
    case 'ar':
      return 'Arabic';
    case 'fr':
      return 'French';
    default:
      return locale.toUpperCase();
  }
};

const ratingStars = (rating = 5) => Array.from({ length: 5 }, (_, index) => index < rating);

const TestimonialsSection = ({ testimonials }: { testimonials: MarketingTestimonial[] }) => {
  const [localeFilter, setLocaleFilter] = useState('All');

  const { localeOptions, filteredTestimonials } = useMemo(() => {
    const localeSet = new Set<string>();
    testimonials.forEach((testimonial) => {
      if (testimonial.locale) localeSet.add(testimonial.locale);
    });
    const options = ['All', ...Array.from(localeSet).sort((a, b) => a.localeCompare(b))];
    const filtered = localeFilter === 'All'
      ? testimonials
      : testimonials.filter((item) => (item.locale || 'en') === localeFilter);
    return { localeOptions: options, filteredTestimonials: filtered };
  }, [testimonials, localeFilter]);

  if (!testimonials.length) {
    return (
      <section className="py-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white/40 p-12 text-center shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-400">Testimonials</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-900">Publish testimonials in the Marketing Hub to reveal them here.</h2>
          <p className="mt-3 text-slate-600">Once at least one quote is set to Published, the grid will auto-fill.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-24" id="testimonials">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-amber-500">Family stories</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">Testimonials synced from the Marketing Hub</h1>
          <p className="mt-4 text-lg text-slate-600">Quotes, star ratings, and associated courses update automatically when admins publish new feedback.</p>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {localeOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLocaleFilter(option)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                localeFilter === option
                  ? 'border-amber-500 bg-amber-500 text-white'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              {option === 'All' ? 'All locales' : getLocaleLabel(option)}
            </button>
          ))}
        </div>

        <div className="mt-4 text-sm text-slate-500">
          Showing {filteredTestimonials.length} of {testimonials.length} quotes
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {filteredTestimonials.map((testimonial) => (
            <article
              key={testimonial._id}
              className={`rounded-3xl border p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg ${testimonial.featured ? 'border-amber-400 bg-white' : 'border-slate-200 bg-white/80'}`}
            >
              <div className="flex items-center justify-between text-sm text-amber-600">
                <div className="flex gap-1">
                  {ratingStars(testimonial.rating).map((active, index) => (
                    <span key={index} className={active ? 'text-amber-500' : 'text-slate-300'}>★</span>
                  ))}
                </div>
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                  {testimonial.locale ? getLocaleLabel(testimonial.locale) : 'English'}
                </span>
              </div>

              <p className="mt-4 text-lg font-medium text-slate-900">“{testimonial.quote}”</p>

              <div className="mt-4 text-sm text-slate-500">
                <p>
                  {testimonial.guardianName || 'Guardian'}
                  {testimonial.guardianRelation ? ` · ${testimonial.guardianRelation}` : ''}
                </p>
                {testimonial.studentName && <p>Student: {testimonial.studentName}</p>}
                {typeof testimonial.course === 'object' && testimonial.course?.title && (
                  <p className="mt-1 text-xs uppercase tracking-[0.3em] text-slate-400">Course: {testimonial.course.title}</p>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export { TestimonialsSection };
