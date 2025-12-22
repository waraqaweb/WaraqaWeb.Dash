import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCcw } from 'lucide-react';
import { getAdminCourses } from '../../../api/marketing';
import CourseEditorModal from '../../../components/features/marketing/CourseEditorModal';
import { shellCard, shellPad, table, tableWrap, td, th, titleH2, titleKicker, titleP, tr, primaryButton, secondaryButton, pill } from './_shared';

const MarketingCoursesPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState([]);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const courses = await getAdminCourses();
        if (!mounted) return;
        setItems(Array.isArray(courses) ? courses : []);
      } catch (e) {
        if (mounted) setError('Failed to load courses.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const ao = Number(a?.sortOrder ?? 0);
      const bo = Number(b?.sortOrder ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a?.title || '').localeCompare(String(b?.title || ''));
    });
    return sorted;
  }, [items]);

  const openNew = () => {
    setSelected(null);
    setOpen(true);
  };

  const openEdit = (course) => {
    setSelected(course);
    setOpen(true);
  };

  const handleSaved = (saved) => {
    setItems((prev) => {
      const existing = prev.find((c) => c._id === saved._id);
      if (!existing) return [saved, ...prev];
      return prev.map((c) => (c._id === saved._id ? saved : c));
    });
  };

  const handleDeleted = (id) => {
    setItems((prev) => prev.filter((c) => c._id !== id));
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap items-start justify-between gap-3 ${shellCard} ${shellPad}`}>
        <div>
          <p className={titleKicker}>Content</p>
          <h2 className={titleH2}>Courses</h2>
          <p className={titleP}>Featured tracks and long-form narratives shown on the marketing site.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button type="button" className={primaryButton} onClick={openNew}>
            <Plus className="h-4 w-4" />
            New course
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className={`${shellCard} ${shellPad}`}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No courses yet.</p>
        ) : (
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Title</th>
                  <th className={th}>Level</th>
                  <th className={th}>Featured</th>
                  <th className={th}>Published</th>
                  <th className={th}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((course) => (
                  <tr
                    key={course._id}
                    className={`${tr} cursor-pointer hover:border-slate-300`}
                    onClick={() => openEdit(course)}
                  >
                    <td className={td}>
                      <div className="font-semibold text-slate-900">{course.title || 'Untitled'}</div>
                      <div className="text-xs text-slate-500">{course.slug || '—'}</div>
                    </td>
                    <td className={td}>{course.level || '—'}</td>
                    <td className={td}>
                      <span className={course.featured ? pill('amber') : pill('slate')}>{course.featured ? 'Featured' : '—'}</span>
                    </td>
                    <td className={td}>
                      <span className={course.published ? pill('green') : pill('slate')}>{course.published ? 'Published' : 'Draft'}</span>
                    </td>
                    <td className={td}>{course.updatedAt ? new Date(course.updatedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CourseEditorModal
        open={open}
        onClose={() => setOpen(false)}
        course={selected}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        variant="drawer"
      />
    </div>
  );
};

export default MarketingCoursesPage;
