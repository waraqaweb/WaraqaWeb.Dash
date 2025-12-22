import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCcw } from 'lucide-react';
import { getAdminCourses, getAdminTestimonials } from '../../../api/marketing';
import TestimonialModal from '../../../components/features/marketing/TestimonialModal';
import { shellCard, shellPad, table, tableWrap, td, th, titleH2, titleKicker, titleP, tr, primaryButton, secondaryButton, pill } from './_shared';

const MarketingTestimonialsPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState([]);
  const [courses, setCourses] = useState([]);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [testimonials, courseList] = await Promise.all([getAdminTestimonials(), getAdminCourses()]);
        if (!mounted) return;
        setItems(Array.isArray(testimonials) ? testimonials : []);
        setCourses(Array.isArray(courseList) ? courseList : []);
      } catch (e) {
        if (mounted) setError('Failed to load testimonials.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
    return sorted;
  }, [items]);

  const openNew = () => {
    setSelected(null);
    setOpen(true);
  };

  const openEdit = (testimonial) => {
    setSelected(testimonial);
    setOpen(true);
  };

  const handleSaved = (saved) => {
    setItems((prev) => {
      const existing = prev.find((t) => t._id === saved._id);
      if (!existing) return [saved, ...prev];
      return prev.map((t) => (t._id === saved._id ? saved : t));
    });
  };

  const handleDeleted = (id) => {
    setItems((prev) => prev.filter((t) => t._id !== id));
  };

  const courseName = (t) => {
    const cid = t?.course?._id || t?.course;
    if (!cid) return '—';
    const c = courses.find((x) => x._id === cid);
    return c?.title || '—';
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap items-start justify-between gap-3 ${shellCard} ${shellPad}`}>
        <div>
          <p className={titleKicker}>Content</p>
          <h2 className={titleH2}>Testimonials</h2>
          <p className={titleP}>Guardian quotes and ratings used in landing sections.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button type="button" className={primaryButton} onClick={openNew}>
            <Plus className="h-4 w-4" />
            New testimonial
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className={`${shellCard} ${shellPad}`}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No testimonials yet.</p>
        ) : (
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Guardian</th>
                  <th className={th}>Locale</th>
                  <th className={th}>Rating</th>
                  <th className={th}>Course</th>
                  <th className={th}>Published</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t._id} className={`${tr} cursor-pointer hover:border-slate-300`} onClick={() => openEdit(t)}>
                    <td className={td}>
                      <div className="font-semibold text-slate-900">{t.guardianName || 'Untitled'}</div>
                      <div className="text-xs text-slate-500">{(t.quote || '').slice(0, 64) || '—'}</div>
                    </td>
                    <td className={td}>{(t.locale || 'en').toUpperCase()}</td>
                    <td className={td}>{t.rating || 5}/5</td>
                    <td className={td}>{courseName(t)}</td>
                    <td className={td}>
                      <span className={t.published ? pill('green') : pill('slate')}>{t.published ? 'Live' : 'Review'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TestimonialModal
        open={open}
        onClose={() => setOpen(false)}
        testimonial={selected}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        courses={courses}
        variant="drawer"
      />
    </div>
  );
};

export default MarketingTestimonialsPage;
