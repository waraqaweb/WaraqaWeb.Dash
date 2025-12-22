import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCcw } from 'lucide-react';
import { getAdminTeachers } from '../../../api/marketing';
import TeacherProfileModal from '../../../components/features/marketing/TeacherProfileModal';
import { shellCard, shellPad, table, tableWrap, td, th, titleH2, titleKicker, titleP, tr, primaryButton, secondaryButton, pill } from './_shared';

const formatName = (t) => {
  const first = t?.firstName || '';
  const last = t?.lastName || '';
  const full = `${first} ${last}`.trim();
  return full || t?.name || 'Untitled';
};

const MarketingTeachersPage = () => {
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
        const teachers = await getAdminTeachers();
        if (!mounted) return;
        setItems(Array.isArray(teachers) ? teachers : []);
      } catch (e) {
        if (mounted) setError('Failed to load teachers.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => formatName(a).localeCompare(formatName(b)));
    return sorted;
  }, [items]);

  const openNew = () => {
    setSelected(null);
    setOpen(true);
  };

  const openEdit = (teacher) => {
    setSelected(teacher);
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

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap items-start justify-between gap-3 ${shellCard} ${shellPad}`}>
        <div>
          <p className={titleKicker}>Content</p>
          <h2 className={titleH2}>Teacher profiles</h2>
          <p className={titleP}>Bios and quotes displayed across landing sections.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button type="button" className={primaryButton} onClick={openNew}>
            <Plus className="h-4 w-4" />
            New teacher
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className={`${shellCard} ${shellPad}`}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No teachers yet.</p>
        ) : (
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Country</th>
                  <th className={th}>Role</th>
                  <th className={th}>Published</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((teacher) => (
                  <tr
                    key={teacher._id}
                    className={`${tr} cursor-pointer hover:border-slate-300`}
                    onClick={() => openEdit(teacher)}
                  >
                    <td className={td}>
                      <div className="font-semibold text-slate-900">{formatName(teacher)}</div>
                      <div className="text-xs text-slate-500">{teacher?.teachesCourses?.slice?.(0, 2)?.join?.(', ') || '—'}</div>
                    </td>
                    <td className={td}>{teacher.country || '—'}</td>
                    <td className={td}>{teacher.role || '—'}</td>
                    <td className={td}>
                      <span className={teacher.published ? pill('green') : pill('slate')}>{teacher.published ? 'Public' : 'Hidden'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TeacherProfileModal
        open={open}
        onClose={() => setOpen(false)}
        teacher={selected}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        variant="drawer"
      />
    </div>
  );
};

export default MarketingTeachersPage;
