import React, { useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { resolvePublicSiteHref } from '../../utils/publicLinks';

const fallbackNav = [
  { label: 'Home', href: '/' },
  { label: 'Courses', href: '/courses' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Teachers', href: '/teachers' },
  { label: 'Testimonials', href: '/testimonials' },
  { label: 'Blog', href: '/blog' },
  { label: 'Contact', href: '/contact' }
];

export default function PublicSiteHeader({ navItems = fallbackNav }) {
  const [open, setOpen] = useState(false);

  const links = useMemo(
    () =>
      (navItems || []).map((item) => ({
        ...item,
        href: resolvePublicSiteHref(item.href)
      })),
    [navItems]
  );

  return (
    <div className="bg-white shadow-sm">
      <header className="mx-auto max-w-6xl px-4 py-4 md:py-6">
        <div className="flex items-center justify-between gap-3">
          <a href={resolvePublicSiteHref('/')} className="shrink-0 text-lg font-semibold text-slate-900">
            Waraqa
          </a>

          <nav className="hidden gap-6 text-sm font-medium text-slate-600 md:flex">
            {links.map((item) => (
              <a key={`${item.label}-${item.href}`} href={item.href} className="hover:text-slate-900">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="relative md:hidden">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="cursor-pointer rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                aria-expanded={open}
                aria-label="Open menu"
              >
                Menu
              </button>

              {open && (
                <div
                  className="absolute left-1/2 z-50 mt-2 w-[calc(100vw-2rem)] max-w-xs -translate-x-1/2 overflow-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-lg [max-height:calc(100vh-8rem)]"
                  role="menu"
                >
                  <NavLink
                    to="/dashboard/login"
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Sign in
                  </NavLink>
                  <div className="my-2 h-px bg-slate-100" />
                  {links.map((item) => (
                    <a
                      key={`mobile-${item.label}-${item.href}`}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="block rounded-xl px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <Link
              to="/dashboard/login"
              className="hidden rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 sm:inline-flex"
            >
              Sign in
            </Link>
            <Link to="/book/evaluation" className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90">
              Book free evaluation
            </Link>
          </div>
        </div>
      </header>
    </div>
  );
}
