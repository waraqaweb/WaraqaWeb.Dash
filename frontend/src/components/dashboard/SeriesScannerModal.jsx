import React, { useMemo, useState } from "react";
import { X, Search, Pencil, Trash2, RotateCcw, AlertCircle, ChevronDown } from "lucide-react";

const normalize = (value) => String(value || "").toLowerCase().trim();

const teacherName = (t) => t ? `${t.firstName || ""} ${t.lastName || ""}`.trim() || t.email || "Teacher" : "";
const guardianName = (g) => g ? `${g.firstName || ""} ${g.lastName || ""}`.trim() || g.email || "Guardian" : "";

/* ---- tiny inline dropdown ---- */
function FilterDropdown({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);

  const visible = useMemo(() => {
    if (!q.trim()) return options;
    const lq = q.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lq));
  }, [options, q]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        {current ? current.label : placeholder}
        <ChevronDown className="h-3 w-3 text-gray-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setQ(""); }} />
          <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="border-b border-gray-100 px-3 py-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Type to filter…"
                className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs focus:border-[#2C736C] focus:outline-none"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-auto py-1">
              <button
                type="button"
                onClick={() => { onChange("all"); setOpen(false); setQ(""); }}
                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${value === "all" ? "font-semibold text-[#2C736C]" : "text-gray-600"}`}
              >
                {placeholder}
              </button>
              {visible.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); setQ(""); }}
                  className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${value === o.value ? "font-semibold text-[#2C736C]" : "text-gray-600"}`}
                >
                  {o.label}
                </button>
              ))}
              {visible.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---- series row ---- */
function SeriesRow({ item, onEdit, onDelete, onRecreate, recreatingId, showRecreate }) {
  const teacher = item?.teacher;
  const guardian = item?.student?.guardianId;
  const futureActive = item?.instanceCounts?.futureActive ?? 0;
  const total = item?.instanceCounts?.total ?? 0;
  const isEmpty = Number(futureActive) === 0;
  const isRecreating = Boolean(recreatingId) && String(recreatingId) === String(item?._id);

  return (
    <tr className="hover:bg-gray-50/60 transition-colors">
      <td className="px-4 py-3">
        <div className="text-sm font-semibold text-gray-900">{item?.subject || item?.title || "(Untitled)"}</div>
        <div className="mt-0.5 font-mono text-[10px] text-gray-400">{item?._id}</div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">
        {teacher ? (
          <>
            <div className="font-medium">{teacherName(teacher)}</div>
            <div className="text-xs text-gray-400">{teacher.email || ""}</div>
          </>
        ) : "—"}
      </td>
      <td className="px-4 py-3 text-sm text-gray-700">{item?.student?.studentName || "—"}</td>
      <td className="px-4 py-3 text-sm text-gray-700">
        {guardian ? (
          <>
            <div className="font-medium">{guardianName(guardian)}</div>
            <div className="text-xs text-gray-400">{guardian.email || ""}</div>
          </>
        ) : "—"}
      </td>
      <td className="px-4 py-3">
        <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          isEmpty ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
        }`}>
          {isEmpty && <AlertCircle className="h-3 w-3" />}
          {futureActive}
          <span className="font-normal text-gray-400">/ {total}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <button type="button" onClick={() => onEdit?.(item)} className="rounded-full border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100" title="Edit series">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onDelete?.(item)} className="rounded-full border border-gray-200 p-1.5 text-red-500 hover:bg-red-50" title="Delete series">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {showRecreate && (
            <button type="button" onClick={() => onRecreate?.(item)} disabled={isRecreating} className="rounded-full border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50" title="Recreate instances">
              <RotateCcw className={`h-3.5 w-3.5 ${isRecreating ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ---- main modal ---- */
export default function SeriesScannerModal({
  isOpen,
  onClose,
  series,
  loading,
  error,
  searchText,
  onChangeSearchText,
  onEdit,
  onDelete,
  onRecreate,
  recreatingId,
  onRecreateAll,
  recreatingAll,
  recreateAllResult,
}) {
  const [tab, setTab] = useState("active"); // "active" | "inactive"
  const [teacherFilter, setTeacherFilter] = useState("all");
  const [guardianFilter, setGuardianFilter] = useState("all");

  /* ---- derive unique teachers / guardians for dropdowns ---- */
  const { teacherOptions, guardianOptions } = useMemo(() => {
    const list = Array.isArray(series) ? series : [];
    const tMap = new Map();
    const gMap = new Map();
    for (const item of list) {
      const t = item?.teacher;
      if (t?._id && !tMap.has(String(t._id))) {
        tMap.set(String(t._id), { value: String(t._id), label: teacherName(t) });
      }
      const g = item?.student?.guardianId;
      if (g?._id && !gMap.has(String(g._id))) {
        gMap.set(String(g._id), { value: String(g._id), label: guardianName(g) });
      }
    }
    const sortByLabel = (a, b) => a.label.localeCompare(b.label);
    return {
      teacherOptions: [...tMap.values()].sort(sortByLabel),
      guardianOptions: [...gMap.values()].sort(sortByLabel),
    };
  }, [series]);

  /* ---- split into active / inactive, then filter ---- */
  const { activeList, inactiveList } = useMemo(() => {
    const list = Array.isArray(series) ? series : [];
    const active = [];
    const inactive = [];
    for (const item of list) {
      const futureActive = Number(item?.instanceCounts?.futureActive ?? 0);
      if (futureActive > 0) active.push(item);
      else inactive.push(item);
    }
    return { activeList: active, inactiveList: inactive };
  }, [series]);

  const filtered = useMemo(() => {
    const source = tab === "active" ? activeList : inactiveList;
    return source.filter((item) => {
      // teacher filter
      if (teacherFilter !== "all") {
        if (String(item?.teacher?._id) !== teacherFilter) return false;
      }
      // guardian filter
      if (guardianFilter !== "all") {
        if (String(item?.student?.guardianId?._id) !== guardianFilter) return false;
      }
      // text search
      const q = normalize(searchText);
      if (!q) return true;
      const teacher = item?.teacher;
      const guardian = item?.student?.guardianId;
      const haystack = [
        item?.subject, item?.title, item?.description,
        item?.student?.studentName,
        teacherName(teacher), teacher?.email,
        guardianName(guardian), guardian?.email,
      ].filter(Boolean).map((v) => normalize(v)).join(" | ");
      return haystack.includes(q);
    });
  }, [tab, activeList, inactiveList, teacherFilter, guardianFilter, searchText]);

  if (!isOpen) return null;

  const isActive = tab === "active";
  const hasFilters = teacherFilter !== "all" || guardianFilter !== "all";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-6xl flex-col rounded-2xl border border-gray-100 bg-white shadow-2xl" style={{ maxHeight: "90vh" }}>
        {/* ---- header ---- */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900">Series Scanner</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Manage recurring class patterns and their generated instances.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-gray-200 p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ---- toolbar: tabs + search + filters ---- */}
        <div className="space-y-3 border-b border-gray-100 px-6 py-3">
          {/* row 1: tabs + recreate all */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
              {[
                { key: "active", label: "Active", count: activeList.length },
                { key: "inactive", label: "Inactive", count: inactiveList.length },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    tab === t.key
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t.label}
                  <span className={`ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1 py-0.5 text-[10px] font-semibold leading-none ${
                    tab === t.key
                      ? t.key === "active" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                      : "bg-gray-200 text-gray-500"
                  }`}>
                    {t.count}
                  </span>
                </button>
              ))}
            </div>

            {isActive && (
              <button
                type="button"
                onClick={onRecreateAll}
                disabled={recreatingAll || loading || activeList.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2C736C] px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#245e58] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${recreatingAll ? "animate-spin" : ""}`} />
                {recreatingAll ? "Recreating…" : "Recreate All Active"}
              </button>
            )}
          </div>

          {/* row 2: search + dropdown filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1" style={{ minWidth: "200px" }}>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                value={searchText}
                onChange={(e) => onChangeSearchText?.(e.target.value)}
                placeholder="Search by name, subject, email…"
                className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-3 text-xs focus:border-[#2C736C] focus:outline-none focus:ring-1 focus:ring-[#2C736C]/30"
              />
            </div>

            <FilterDropdown value={teacherFilter} onChange={setTeacherFilter} options={teacherOptions} placeholder="All teachers" />
            <FilterDropdown value={guardianFilter} onChange={setGuardianFilter} options={guardianOptions} placeholder="All guardians" />

            {hasFilters && (
              <button
                type="button"
                onClick={() => { setTeacherFilter("all"); setGuardianFilter("all"); }}
                className="text-[10px] font-medium text-[#2C736C] hover:underline"
              >
                Clear filters
              </button>
            )}

            <span className="ml-auto text-[10px] text-gray-400">
              {filtered.length} of {isActive ? activeList.length : inactiveList.length}
            </span>
          </div>
        </div>

        {/* ---- result banner ---- */}
        {recreateAllResult && (
          <div className={`mx-6 mt-3 rounded-lg border px-4 py-2.5 text-xs ${
            recreateAllResult.error
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}>
            {recreateAllResult.error
              ? recreateAllResult.error
              : `Created ${recreateAllResult.totalCreated} instance(s) across ${recreateAllResult.processed} series (${recreateAllResult.skipped} skipped).`}
          </div>
        )}

        {error && (
          <div className="mx-6 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* ---- table ---- */}
        <div className="flex-1 overflow-auto px-6 py-3">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <th className="px-4 py-2">Series</th>
                <th className="px-4 py-2">Teacher</th>
                <th className="px-4 py-2">Student</th>
                <th className="px-4 py-2">Guardian</th>
                <th className="px-4 py-2">Instances</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">Loading series…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">
                  {hasFilters || normalize(searchText) ? "No series match your filters." : isActive ? "No active series." : "No inactive series."}
                </td></tr>
              ) : (
                filtered.map((item) => (
                  <SeriesRow
                    key={item?._id}
                    item={item}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onRecreate={onRecreate}
                    recreatingId={recreatingId}
                    showRecreate={isActive}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
