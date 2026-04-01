// /frontend/src/components/dashboard/salaries/SalariesPage.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../../../api/axios';
import { Plus, Eye, Pencil, DollarSign, CalendarDays, Tag, UserRound, CheckSquare, Trash2, Send, XCircle, Check } from "lucide-react";
import useBulkSelect from '../../../hooks/useBulkSelect';
import BulkActionBar from '../../../components/ui/BulkActionBar';
import ExportExcelButton from '../../../components/ui/ExportExcelButton';
import { fetchAllForExport, mapSalaryRow, downloadExcel } from '../../../utils/exportToExcel';
import { useAuth } from "../../../contexts/AuthContext";
import { useSearch } from '../../../contexts/SearchContext';
import { useDeleteActionCountdown } from '../../../contexts/DeleteActionCountdownContext';
import { formatDateDDMMMYYYY } from '../../../utils/date';
import SalaryViewModal from "./SalaryViewModal";
import SalaryEditModal from "./SalaryEditModal";
import SalaryCreateModal from "./SalaryCreateModal";
import PrimaryButton from '../../../components/ui/PrimaryButton';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { makeCacheKey, readCache, writeCache } from '../../../utils/sessionCache';

const SalariesPage = () => {
  const { user } = useAuth();
  const { searchTerm, globalFilter } = useSearch();
  const isAdmin = () => user?.role === "admin";

  const [salaries, setSalaries] = useState([]);
  const [stats, setStats] = useState(null);
  const { start: startDeleteCountdown } = useDeleteActionCountdown();
  const [loading, setLoading] = useState(true);
  const showLoading = loading;
  const salariesRef = useRef([]);
  const fetchSalariesInFlightRef = useRef(false);
  const fetchSalariesKeyRef = useRef('');
  const fetchSalariesAbortRef = useRef(null);
  const fetchSalariesRequestIdRef = useRef(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 20;
  const [selectedSalary, setSelectedSalary] = useState(null);
  const [showView, setShowView] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkToast, setBulkToast] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm || ''), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, globalFilter]);

  useEffect(() => {
    fetchSalaries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, globalFilter, currentPage]);

  useEffect(() => {
    salariesRef.current = salaries || [];
  }, [salaries]);

  const fetchSalaries = async () => {
    try {
      const searchMode = Boolean((debouncedSearch || '').trim());
      const fetchPage = searchMode ? 1 : currentPage;
      const fetchLimit = searchMode ? 500 : itemsPerPage;
      const requestSignature = JSON.stringify({
        page: fetchPage,
        limit: fetchLimit,
        search: (debouncedSearch || '').trim() || undefined,
        status: searchMode ? undefined : (globalFilter && globalFilter !== 'all' ? globalFilter : undefined),
      });

      if (fetchSalariesInFlightRef.current && fetchSalariesKeyRef.current === requestSignature) {
        return;
      }

      fetchSalariesKeyRef.current = requestSignature;
      fetchSalariesInFlightRef.current = true;

      const requestId = fetchSalariesRequestIdRef.current + 1;
      fetchSalariesRequestIdRef.current = requestId;

      if (fetchSalariesAbortRef.current) {
        try {
          fetchSalariesAbortRef.current.abort();
        } catch (e) {
          // ignore abort errors
        }
      }

      const controller = new AbortController();
      fetchSalariesAbortRef.current = controller;

      const cacheKey = makeCacheKey(
        'salaries:list',
        user?._id,
        {
          page: fetchPage,
          limit: fetchLimit,
          search: (debouncedSearch || '').trim() || undefined,
          status: searchMode ? undefined : (globalFilter && globalFilter !== 'all' ? globalFilter : undefined),
        }
      );

      const cached = readCache(cacheKey, { deps: ['invoices'] });
      if (cached.hit && cached.value) {
        setSalaries(cached.value.salaries || []);
        setTotalPages(cached.value.totalPages || 1);
        setLoading(false);
        if (cached.ageMs < 60_000) {
          fetchSalariesInFlightRef.current = false;
          return;
        }
      }

      const hasExisting = (salariesRef.current || []).length > 0;
      setLoading(!hasExisting);
      const params = {
        type: 'teacher_payment',
        page: fetchPage,
        limit: fetchLimit,
        search: (debouncedSearch || '').trim() || undefined,
        sortBy: 'createdAt',
        order: 'desc',
        light: true,
      };

      if (!searchMode && globalFilter && globalFilter !== 'all') {
        params.status = globalFilter;
      }

      if (!searchMode && (!globalFilter || globalFilter === 'all')) {
        params.smartSort = true;
        delete params.sortBy;
        delete params.order;
      }

      if ((debouncedSearch || '').trim()) {
        params.smartSort = true;
        delete params.sortBy;
        delete params.order;
      }

      const res = await api.get('/invoices', { params, signal: controller.signal });
      if (requestId !== fetchSalariesRequestIdRef.current) {
        return;
      }
      setSalaries(res.data.invoices || []);
      setTotalPages(searchMode ? 1 : (res.data.pagination?.pages || 1));

      writeCache(
        cacheKey,
        {
          salaries: res.data.invoices || [],
          totalPages: searchMode ? 1 : (res.data.pagination?.pages || 1),
        },
        { ttlMs: 5 * 60_000, deps: ['invoices'] }
      );
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        console.error("Error fetching salaries:", err);
      }
    } finally {
      setLoading(false);
      fetchSalariesInFlightRef.current = false;
    }
  };

  const fetchStats = async () => {
    try {
      const cacheKey = makeCacheKey('salaries:stats', user?._id, { kind: 'invoices-stats' });
      const cached = readCache(cacheKey, { deps: ['invoices'] });
      if (cached.hit && cached.value) {
        setStats(cached.value);
        if (cached.ageMs < 60_000) return;
      }

      const res = await api.get("/invoices/stats");
      setStats(res.data.stats || res.data);
      writeCache(cacheKey, res.data.stats || res.data, { ttlMs: 5 * 60_000, deps: ['invoices'] });
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  };

  const handleOpenView = (salary) => {
    navigate(`/salaries/${salary._id}`, { state: { background: location, salary } });
  };

  const handleOpenEdit = (salary) => {
    navigate(`/salaries/${salary._id}/edit`, { state: { background: location, salary } });
  };

  const handleOpenCreate = () => {
    navigate(`/salaries/create`, { state: { background: location } });
  };

  const handleDelete = async (salaryId) => {
    if (!window.confirm("Delete this salary record?")) return;
    startDeleteCountdown({
      message: 'Deleting salary record',
      preDelaySeconds: 1,
      undoSeconds: 3,
      onDelete: async () => {
        try {
          await api.delete(`/invoices/${salaryId}`);
          fetchSalaries();
        } catch (err) {
          console.error("Delete error:", err);
          alert(err.response?.data?.message || "Failed to delete salary.");
          throw err;
        }
      }
    });
  };

  const visibleSalaries = useMemo(() => {
    const list = [...(salaries || [])];
    list.sort((a, b) => {
      const aPaid = ['paid', 'refunded'].includes(String(a?.status || '').toLowerCase());
      const bPaid = ['paid', 'refunded'].includes(String(b?.status || '').toLowerCase());
      if (aPaid !== bPaid) return aPaid ? 1 : -1;
      return new Date(b?.createdAt || 0) - new Date(a?.createdAt || 0);
    });
    return list;
  }, [salaries]);
  const bulk = useBulkSelect(visibleSalaries);

  const runSalaryBulkAction = async (label, apiCall) => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`${label} ${ids.length} invoice(s)?`)) return;
    setBulkActionLoading(true);
    try {
      const { data } = await apiCall(ids);
      const parts = [];
      if (data.paid) parts.push(`${data.paid} paid`);
      if (data.published) parts.push(`${data.published} published`);
      if (data.deleted) parts.push(`${data.deleted} deleted`);
      if (data.failed?.length) parts.push(`${data.failed.length} failed`);
      setBulkToast({ type: data.failed?.length ? 'warning' : 'success', message: parts.join(', ') || 'Done' });
      setTimeout(() => setBulkToast(null), 3500);
      bulk.clearSelection();
      bulk.toggleSelectionMode();
      fetchSalaries();
      fetchStats();
    } catch (err) {
      console.error(`Bulk ${label} error:`, err);
      setBulkToast({ type: 'error', message: err?.response?.data?.message || `Bulk ${label} failed` });
      setTimeout(() => setBulkToast(null), 4000);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleSalaryBulkMarkPaid = () => runSalaryBulkAction('Mark as paid', (ids) => api.post('/teacher-salary/admin/bulk/mark-paid', { ids }));
  const handleSalaryBulkPublish = () => runSalaryBulkAction('Publish', (ids) => api.post('/teacher-salary/admin/bulk/publish', { ids }));
  const handleSalaryBulkDelete = () => runSalaryBulkAction('Delete', (ids) => api.post('/teacher-salary/admin/bulk/delete', { ids }));
  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  const formatDate = (d) => d ? formatDateDDMMMYYYY(d) : '—';

  const getStatusTone = (status) => {
    switch (status) {
      case 'paid': return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
      case 'pending': return 'bg-indigo-50 text-indigo-700 border border-indigo-100';
      case 'cancelled': return 'bg-amber-50 text-amber-700 border border-amber-100';
      case 'overdue': return 'bg-rose-50 text-rose-700 border border-rose-100';
      default: return 'bg-slate-50 text-slate-700 border border-slate-100';
    }
  };

  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const getTierTone = (hourlyRate) => {
    const rate = Number(hourlyRate || 0);
    if (!Number.isFinite(rate) || rate <= 0) return 'bg-slate-50 text-slate-600 border border-slate-200';
    if (rate <= 3.0) return 'bg-cyan-50 text-cyan-700 border border-cyan-200';
    if (rate <= 3.25) return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
    if (rate <= 3.5) return 'bg-violet-50 text-violet-700 border border-violet-200';
    if (rate <= 3.75) return 'bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200';
    if (rate <= 4.0) return 'bg-amber-50 text-amber-700 border border-amber-200';
    if (rate <= 4.25) return 'bg-orange-50 text-orange-700 border border-orange-200';
    return 'bg-rose-50 text-rose-700 border border-rose-200';
  };

  const getMonthTone = (monthNumber) => {
    const tones = {
      1: 'text-sky-700',
      2: 'text-indigo-700',
      3: 'text-emerald-700',
      4: 'text-lime-700',
      5: 'text-amber-700',
      6: 'text-orange-700',
      7: 'text-rose-700',
      8: 'text-fuchsia-700',
      9: 'text-violet-700',
      10: 'text-purple-700',
      11: 'text-teal-700',
      12: 'text-cyan-700'
    };
    return tones[Number(monthNumber) || 0] || 'text-slate-700';
  };

  const resolvePaymentMonthLabel = (salary) => {
    const paidAt = salary?.paidAt || salary?.paymentDate || null;
    const date = paidAt ? new Date(paidAt) : null;
    if (date && !Number.isNaN(date.getTime())) {
      const month = date.getMonth() + 1;
      return { label: `${monthNamesShort[month - 1]} ${date.getFullYear()}`, month };
    }
    const month = Number(salary?.billingPeriod?.month || 0);
    const year = Number(salary?.billingPeriod?.year || 0);
    if (month >= 1 && month <= 12 && year > 0) {
      return { label: `${monthNamesShort[month - 1]} ${year}`, month };
    }
    return { label: 'N/A', month: 0 };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 space-y-8">
        <div className="rounded-3xl bg-white/80 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
          <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold text-slate-900 flex items-center gap-3">
                <DollarSign className="w-6 h-6 text-slate-500" />
                Salaries
              </h1>
              <p className="text-sm text-slate-500">Teacher payments and payroll records — review and manage salary invoices.</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center" />
          </div>

          {stats && (
            <div className="grid grid-cols-1 gap-4 border-t border-slate-100 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
              {[{
                label: 'Total payroll',
                value: formatCurrency(stats.monthlyRevenue || 0),
              },{
                label: 'Paid salaries',
                value: stats.paidInvoices ?? '--'
              },{
                label: 'Pending payments',
                value: stats.pendingInvoices ?? '--'
              },{
                label: 'Zero-hour teachers',
                value: stats.zeroHourStudents ?? '--'
              }].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
                    <span className="rounded-full bg-white p-2 text-slate-500 shadow-sm"><DollarSign className="h-4 w-4" /></span>
                  </div>
                  <span className="text-2xl font-semibold text-slate-900">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          {isAdmin() && (
            <div className="mb-4 flex items-center gap-3">
              <ExportExcelButton onExport={async () => {
                const params = { type: 'teacher_payment', limit: 10000, light: true };
                if (globalFilter && globalFilter !== 'all') params.status = globalFilter;
                if (debouncedSearch) params.search = debouncedSearch;
                const data = await fetchAllForExport('/invoices', params);
                await downloadExcel((data.invoices || []).map(mapSalaryRow), 'teacher-salaries');
              }} />
              <button
                type="button"
                onClick={bulk.toggleSelectionMode}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  bulk.selectionMode
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {bulk.selectionMode ? 'Exit select' : 'Select'}
              </button>
              {bulkToast && (
                <span className={`text-xs font-medium ${bulkToast.type === 'success' ? 'text-emerald-600' : bulkToast.type === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>
                  {bulkToast.message}
                </span>
              )}
            </div>
          )}

          {bulk.selectionMode && (
            <div className="mb-4">
              <BulkActionBar
                selectedCount={bulk.selectedCount}
                isAllSelected={bulk.isAllSelected}
                onSelectAll={bulk.selectAll}
                onExit={() => { bulk.clearSelection(); bulk.toggleSelectionMode(); }}
              >
                <button type="button" onClick={handleSalaryBulkMarkPaid} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                  className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40">
                  <Check className="h-3 w-3" /> Mark paid
                </button>
                <button type="button" onClick={handleSalaryBulkPublish} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                  className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-40">
                  <Send className="h-3 w-3" /> Publish
                </button>
                <button type="button" onClick={handleSalaryBulkDelete} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-40">
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </BulkActionBar>
            </div>
          )}

          <div className="mt-2 space-y-4">
            {showLoading && visibleSalaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
                <LoadingSpinner />
                <p className="text-sm">Fetching salary records…</p>
              </div>
            ) : visibleSalaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
                <div>
                  <p className="text-base font-medium text-slate-700">No salary records</p>
                  <p className="text-sm text-slate-500">Try a different filter or create a new salary record.</p>
                </div>
              </div>
            ) : (
              visibleSalaries.map((salary) => {
                const tone = getStatusTone(salary.status);
                const billingStart = salary.billingPeriod?.startDate || salary.billingPeriod?.start;
                const billingEnd = salary.billingPeriod?.endDate || salary.billingPeriod?.end;
                const total = salary.internalTotals?.totalUSD ?? salary.total ?? salary.amount ?? 0;
                const hourlyRate = Number(salary?.teacherPayment?.hourlyRate || 0);
                const bonus = Number(salary?.teacherPayment?.bonus || 0);
                const tierTone = getTierTone(hourlyRate);
                const paymentMonth = resolvePaymentMonthLabel(salary);
                const paymentMonthTone = getMonthTone(paymentMonth.month);

                return (
                  <div key={salary._id} className={`rounded-2xl border bg-gradient-to-br from-white via-white to-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${bulk.selectionMode && bulk.selected.has(salary._id) ? 'border-indigo-300 ring-2 ring-indigo-200' : 'border-slate-100'}`}>
                    <div className="flex flex-col gap-4 p-4 md:p-6 lg:flex-row lg:items-start lg:justify-between">
                      {bulk.selectionMode && (
                        <button
                          type="button"
                          onClick={() => bulk.toggleItem(salary._id)}
                          className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 transition hover:border-indigo-400"
                          aria-label={bulk.selected.has(salary._id) ? 'Deselect' : 'Select'}
                        >
                          {bulk.selected.has(salary._id) && (
                            <CheckSquare className="h-4 w-4 text-indigo-600" />
                          )}
                        </button>
                      )}
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
                            <span className="capitalize">{salary.status || 'draft'}</span>
                          </span>
                          <span className="text-sm font-semibold text-slate-700">{salary.invoiceName || salary.invoiceNumber || `Salary ${String(salary._id).slice(-6)}`}</span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tierTone}`}>
                            <Tag className="h-3 w-3" />
                            Tier ${hourlyRate.toFixed(2)}/h
                          </span>
                          <span className={`inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold border border-slate-200 ${paymentMonthTone}`}>
                            <CalendarDays className="h-3 w-3" />
                            {paymentMonth.label}
                          </span>
                        </div>

                        <div className="space-y-1 text-sm text-slate-600">
                          <div className="flex flex-wrap items-center gap-4">
                            <div className="inline-flex items-center gap-2 text-slate-700">
                              <span className="font-medium">Teacher</span>
                              <span className="text-sm text-slate-500">{salary.teacher?.firstName} {salary.teacher?.lastName}</span>
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                              <UserRound className="h-3 w-3" />
                              {salary.teacher?.firstName || 'Teacher'}
                            </span>
                            <div className="inline-flex items-center gap-2">
                              <span className="text-sm text-slate-500">{formatDate(billingStart)} → {formatDate(billingEnd)}</span>
                            </div>
                            <div className="inline-flex items-center gap-2">
                              <span className="font-medium text-slate-700">{formatCurrency(total)}</span>
                            </div>
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border ${bonus > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                              Bonus ${bonus.toFixed(2)}
                            </span>
                          </div>
                          {salary.guardian?.email && <p className="text-xs text-slate-400">{salary.guardian.email}</p>}
                        </div>
                      </div>

                      <div className="flex flex-col items-start gap-3 lg:items-end">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleOpenView(salary)} className="inline-flex items-center justify-center rounded-full border border-sky-200 bg-sky-50 p-2 text-sky-600 transition hover:border-sky-300 hover:bg-sky-100 hover:text-sky-700" type="button" aria-label="View salary" title="View invoice">
                            <Eye className="h-4 w-4" />
                          </button>
                          {isAdmin() && (
                            <>
                              <button onClick={() => handleOpenEdit(salary)} className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900" type="button" aria-label="Edit salary">
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDelete(salary._id)} className="inline-flex items-center justify-center rounded-full border border-rose-100 p-2 text-rose-500 transition hover:border-rose-200 hover:text-rose-700" type="button" aria-label="Delete salary">
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {totalPages > 1 && (
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <PrimaryButton
                  variant="subtle"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  Previous
                </PrimaryButton>
                <div className="text-sm text-slate-500">
                  Page <span className="font-medium text-slate-700">{currentPage}</span> of{' '}
                  <span className="font-medium text-slate-700">{totalPages}</span>
                </div>
                <PrimaryButton
                  variant="subtle"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </PrimaryButton>
              </div>
            )}
          </div>
        </div>
      </div>

      {showView && selectedSalary && (
        <SalaryViewModal salaryData={selectedSalary} onClose={() => { setShowView(false); setSelectedSalary(null); }} />
      )}

      {showEdit && selectedSalary && (
        <SalaryEditModal salary={selectedSalary} onClose={() => { setShowEdit(false); setSelectedSalary(null); fetchSalaries(); }} onUpdated={fetchSalaries} />
      )}
      {showCreate && (
        <SalaryCreateModal onClose={() => setShowCreate(false)} onCreated={() => { fetchSalaries(); fetchStats(); }} />
      )}

      {isAdmin() && (
        <div className="fixed bottom-24 right-6 z-40">
          <PrimaryButton
            onClick={handleOpenCreate}
            circle
            size="lg"
            aria-label="New Salary"
            title="New Salary"
          >
            <Plus className="h-5 w-5" />
          </PrimaryButton>
        </div>
      )}
    </div>
  );
};

export default SalariesPage;
