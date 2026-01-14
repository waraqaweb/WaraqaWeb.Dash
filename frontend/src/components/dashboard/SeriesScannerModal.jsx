import React, { useMemo } from "react";
import { X, Search, Pencil, Trash2, RotateCcw, AlertCircle } from "lucide-react";

const normalize = (value) => String(value || "").toLowerCase().trim();

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
}) {
  const filtered = useMemo(() => {
    const list = Array.isArray(series) ? series : [];
    const q = normalize(searchText);
    if (!q) return list;

    return list.filter((item) => {
      const teacher = item?.teacher;
      const guardian = item?.student?.guardianId;

      const haystack = [
        item?.subject,
        item?.title,
        item?.description,
        item?.student?.studentName,
        teacher ? `${teacher.firstName || ""} ${teacher.lastName || ""}`.trim() : "",
        teacher?.email,
        guardian ? `${guardian.firstName || ""} ${guardian.lastName || ""}`.trim() : "",
        guardian?.email,
      ]
        .filter(Boolean)
        .map((v) => normalize(v))
        .join(" | ");

      return haystack.includes(q);
    });
  }, [series, searchText]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-5xl rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Series Scanner</h3>
            <p className="mt-1 text-sm text-gray-500">
              Search recurring class series, even if they have no instances in the schedule.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-full border border-gray-200 p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={searchText}
                onChange={(e) => onChangeSearchText?.(e.target.value)}
                placeholder="Search by teacher, student, guardian, subject..."
                className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-[#2C736C] focus:outline-none focus:ring-2 focus:ring-[#2C736C]/20"
              />
            </div>

            <div className="text-xs text-gray-500">
              {Array.isArray(series) ? `${filtered.length} / ${series.length}` : "0"} series
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200">
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Series</th>
                    <th className="px-4 py-3">Teacher</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Guardian</th>
                    <th className="px-4 py-3">Future instances</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                        Loading series…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                        No matching series.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((item) => {
                      const teacher = item?.teacher;
                      const guardian = item?.student?.guardianId;
                      const futureActive = item?.instanceCounts?.futureActive ?? 0;
                      const isEmpty = Number(futureActive) === 0;

                      return (
                        <tr key={item?._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="text-sm font-semibold text-gray-900">{item?.subject || item?.title || "(Untitled)"}</div>
                            <div className="text-xs text-gray-500">{item?._id}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {teacher ? (
                              <div>
                                <div className="font-medium">{`${teacher.firstName || ""} ${teacher.lastName || ""}`.trim() || "Teacher"}</div>
                                <div className="text-xs text-gray-500">{teacher.email || ""}</div>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">{item?.student?.studentName || "—"}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {guardian ? (
                              <div>
                                <div className="font-medium">{`${guardian.firstName || ""} ${guardian.lastName || ""}`.trim() || "Guardian"}</div>
                                <div className="text-xs text-gray-500">{guardian.email || ""}</div>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                              isEmpty ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"
                            }`}>
                              {isEmpty && <AlertCircle className="h-3.5 w-3.5" />}
                              {futureActive}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => onEdit?.(item)}
                                className="inline-flex items-center justify-center rounded-full border border-gray-200 p-2 text-gray-600 hover:bg-gray-100"
                                aria-label="Edit series"
                                title="Edit series"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDelete?.(item)}
                                className="inline-flex items-center justify-center rounded-full border border-gray-200 p-2 text-red-600 hover:bg-red-50"
                                aria-label="Delete series"
                                title="Delete series"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onRecreate?.(item)}
                                disabled={Boolean(recreatingId) && String(recreatingId) === String(item?._id)}
                                className="inline-flex items-center justify-center rounded-full border border-gray-200 p-2 text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                                aria-label="Recreate instances"
                                title="Recreate instances"
                              >
                                <RotateCcw className={`h-4 w-4 ${Boolean(recreatingId) && String(recreatingId) === String(item?._id) ? "animate-spin" : ""}`} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
