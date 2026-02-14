// /frontend/src/components/dashboard/salaries/SalariesPage.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../../../api/axios';
import { Plus, Eye, Pencil, DollarSign } from "lucide-react";
import { useAuth } from "../../../contexts/AuthContext";
import { useSearch } from '../../../contexts/SearchContext';
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
    try {
      await api.delete(`/invoices/${salaryId}`);
      fetchSalaries();
    } catch (err) {
      console.error("Delete error:", err);
      alert(err.response?.data?.message || "Failed to delete salary.");
    }
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

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {isAdmin() && (
                <PrimaryButton onClick={handleOpenCreate} size="md">
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">New Salary</span>
                </PrimaryButton>
              )}
            </div>
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

                return (
                  <div key={salary._id} className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex flex-col gap-4 p-4 md:p-6 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
                            <span className="capitalize">{salary.status || 'draft'}</span>
                          </span>
                          <span className="text-sm font-semibold text-slate-700">{salary.invoiceName || salary.invoiceNumber || `Salary ${String(salary._id).slice(-6)}`}</span>
                        </div>

                        <div className="space-y-1 text-sm text-slate-600">
                          <div className="flex flex-wrap items-center gap-4">
                            <div className="inline-flex items-center gap-2 text-slate-700">
                              <span className="font-medium">Teacher</span>
                              <span className="text-sm text-slate-500">{salary.teacher?.firstName} {salary.teacher?.lastName}</span>
                            </div>
                            <div className="inline-flex items-center gap-2">
                              <span className="text-sm text-slate-500">{formatDate(billingStart)} → {formatDate(billingEnd)}</span>
                            </div>
                            <div className="inline-flex items-center gap-2">
                              <span className="font-medium text-slate-700">{formatCurrency(total)}</span>
                            </div>
                          </div>
                          {salary.guardian?.email && <p className="text-xs text-slate-400">{salary.guardian.email}</p>}
                        </div>
                      </div>

                      <div className="flex flex-col items-start gap-3 lg:items-end">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleOpenView(salary)} className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900" type="button" aria-label="View salary">
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
    </div>
  );
};

export default SalariesPage;
