// /frontend/src/components/dashboard/salaries/SalariesPage.jsx
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../../../api/axios';
import { Plus, Eye, Pencil, CalendarDays, CheckSquare, Trash2, Send, Check, MessageSquare, Copy, CheckCheck, X, Link2, Clock, DollarSign, ExternalLink } from "lucide-react";
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
  const [teacherMsgModal, setTeacherMsgModal] = useState(null); // { salary, message, copied }
  const [copiedLinkId, setCopiedLinkId] = useState(null);
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

  const arabicMonths = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  const buildTeacherMessage = (salary, publicLink) => {
    const firstName = String(salary?.teacher?.firstName || '').trim() || 'الأستاذ';
    const month = Number(salary?.billingPeriod?.month || 0);
    const monthName = month >= 1 && month <= 12 ? arabicMonths[month - 1] : '—';
    const payDay = salary?.teacherPayment?.payDay || salary?.payDay || '5';
    const lines = [
      'السلام عليكم ورحمة الله وبركاته أستاذ / أستاذة ' + firstName + '،',
      '',
      'نود إعلامكم بأن فاتورة راتبكم عن شهر ' + monthName + ' قد أُعدّت وأصبحت جاهزة للمراجعة.',
      '',
      'وسيتم تحويل المبلغ إلى حسابكم قبل يوم ' + payDay + ' من الشهر الجاري – بإذن الله تعالى – لذا نرجو منكم التكرم بمراجعة الفاتورة، وإفادتنا بأي ملاحظات أو استفسارات ترونها، حتى يتسنى لنا معالجتها قبل إتمام عملية التحويل.',
    ];
    if (publicLink) {
      lines.push('', 'رابط الفاتورة:', publicLink);
    }
    lines.push(
      '',
      'نسأل الله أن يبارك في وقتكم وعلمكم، وأن يجزيكم عنا خير الجزاء.',
      '',
      'وجزاكم الله خيرا'
    );
    return lines.join('\n');
  };

  const openTeacherMsgModal = (salary) => {
    const slug = salary?.invoiceSlug;
    const publicLink = slug ? `${window.location.origin}/dashboard/teacher-salary/shared/${slug}` : '';
    setTeacherMsgModal({ salary, message: buildTeacherMessage(salary, publicLink), copied: false });
  };

  const handleCopyTeacherMsg = () => {
    if (!teacherMsgModal) return;
    navigator.clipboard.writeText(teacherMsgModal.message).then(() => {
      setTeacherMsgModal((m) => m ? { ...m, copied: true } : m);
      setTimeout(() => setTeacherMsgModal((m) => m ? { ...m, copied: false } : m), 2000);
    });
  };

  const handleSendTeacherWhatsapp = () => {
    if (!teacherMsgModal) return;
    const phone = String(
      teacherMsgModal.salary?.teacher?.phone ||
      teacherMsgModal.salary?.teacher?.whatsapp ||
      ''
    ).replace(/\D/g, '').replace(/^0+/, '');
    if (!phone) {
      alert('No phone number found for this teacher.');
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(teacherMsgModal.message)}`, '_blank', 'noopener,noreferrer');
  };

  const handleCopyPublicLink = (salary) => {
    const slug = salary?.invoiceSlug;
    if (!slug) return;
    const url = `${window.location.origin}/dashboard/teacher-salary/shared/${slug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedLinkId(salary._id);
      setTimeout(() => setCopiedLinkId(null), 2000);
    });
  };

  const handleOpenWhatsapp = (salary) => {
    const phone = String(salary?.teacher?.phone || salary?.teacher?.whatsapp || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!phone) {
      alert('No phone number found for this teacher.');
      return;
    }
    const slug = salary?.invoiceSlug;
    const publicLink = slug ? `${window.location.origin}/dashboard/teacher-salary/shared/${slug}` : '';
    const msg = buildTeacherMessage(salary, publicLink);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener,noreferrer');
  };
  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  const formatDate = (d) => d ? formatDateDDMMMYYYY(d) : '—';

  const getStatusTone = (status) => {
    switch (status) {
      case 'paid': return 'bg-emerald-100/80 text-emerald-700 ring-1 ring-emerald-200';
      case 'published': return 'bg-sky-100/80 text-sky-700 ring-1 ring-sky-200';
      case 'pending': return 'bg-amber-100/80 text-amber-700 ring-1 ring-amber-200';
      case 'cancelled': return 'bg-slate-100 text-slate-400 ring-1 ring-slate-200';
      case 'overdue': return 'bg-rose-100/80 text-rose-700 ring-1 ring-rose-200';
      default: return 'bg-slate-100 text-slate-500 ring-1 ring-slate-200';
    }
  };

  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const isUnpaid = (s) => !['paid', 'refunded'].includes(String(s?.status || '').toLowerCase());



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
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Salaries</h1>
          <p className="text-xs text-muted-foreground">Teacher payments and payroll records.</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin() && (
            <ExportExcelButton onExport={async () => {
              const params = { type: 'teacher_payment', limit: 10000, light: true };
              if (globalFilter && globalFilter !== 'all') params.status = globalFilter;
              if (debouncedSearch) params.search = debouncedSearch;
              const data = await fetchAllForExport('/invoices', params);
              await downloadExcel((data.invoices || []).map(mapSalaryRow), 'teacher-salaries');
            }} />
          )}
          {isAdmin() && (
            <button
              type="button"
              onClick={bulk.toggleSelectionMode}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                bulk.selectionMode
                  ? 'border-primary/30 bg-primary/5 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {bulk.selectionMode ? 'Exit' : 'Select'}
            </button>
          )}
          {bulkToast && (
            <span className={`text-xs font-medium ${bulkToast.type === 'success' ? 'text-emerald-600' : bulkToast.type === 'error' ? 'text-rose-600' : 'text-amber-600'}`}>
              {bulkToast.message}
            </span>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{
            label: 'Total payroll',
            value: formatCurrency(stats.monthlyRevenue || 0),
          },{
            label: 'Paid',
            value: stats.paidInvoices ?? '--'
          },{
            label: 'Pending',
            value: stats.pendingInvoices ?? '--'
          },{
            label: 'Zero-hour',
            value: stats.zeroHourStudents ?? '--'
          }].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-3">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
              <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">

        {bulk.selectionMode && (
          <div className="border-b border-border p-3">
            <BulkActionBar
              selectedCount={bulk.selectedCount}
              isAllSelected={bulk.isAllSelected}
              onSelectAll={bulk.selectAll}
              onExit={() => { bulk.clearSelection(); bulk.toggleSelectionMode(); }}
            >
              <button type="button" onClick={handleSalaryBulkMarkPaid} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                <Check className="h-3 w-3" /> Mark paid
              </button>
              <button type="button" onClick={handleSalaryBulkPublish} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-40">
                <Send className="h-3 w-3" /> Publish
              </button>
              <button type="button" onClick={handleSalaryBulkDelete} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-40">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </BulkActionBar>
          </div>
        )}

        <div className="divide-y divide-border">
            {showLoading && visibleSalaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
                <LoadingSpinner />
                <p className="text-sm">Loading…</p>
              </div>
            ) : visibleSalaries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
                <p className="text-sm font-medium text-foreground">No salary records</p>
                <p className="text-xs text-muted-foreground">Try a different filter or create a new salary record.</p>
              </div>
            ) : (
              visibleSalaries.map((salary) => {
                const tone = getStatusTone(salary.status);
                const billingStart = salary.billingPeriod?.startDate || salary.billingPeriod?.start;
                const billingEnd = salary.billingPeriod?.endDate || salary.billingPeriod?.end;
                const total = salary.internalTotals?.totalUSD ?? salary.total ?? salary.amount ?? 0;
                const totalEGP = salary.internalTotals?.totalEGP ?? salary.totalEGP ?? null;
                const hourlyRate = Number(salary?.teacherPayment?.hourlyRate || 0);
                const totalHours = salary?.internalTotals?.totalHours ?? salary?.totalHours ?? null;
                const paymentMonth = resolvePaymentMonthLabel(salary);
                const selected = bulk.selectionMode && bulk.selected.has(salary._id);
                const isPaid = ['paid', 'refunded'].includes(String(salary.status || '').toLowerCase());
                const hasSlug = !!salary?.invoiceSlug;
                const linkCopied = copiedLinkId === salary._id;

                return (
                  <div key={salary._id} className={`group relative px-4 py-3.5 transition hover:bg-muted/40 ${selected ? 'bg-primary/5' : ''} ${isPaid ? 'opacity-80' : ''}`}>
                    <div className="flex items-start gap-3">
                      {bulk.selectionMode && (
                        <button
                          type="button"
                          onClick={() => bulk.toggleItem(salary._id)}
                          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border"
                          aria-label={selected ? 'Deselect' : 'Select'}
                        >
                          {selected && <Check className="h-3 w-3 text-primary" />}
                        </button>
                      )}

                      <div className="min-w-0 flex-1">
                        {/* Top section: info + amount */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {/* Row 1: Teacher name + tags */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-[15px] font-semibold text-foreground leading-tight truncate max-w-[180px] sm:max-w-none">
                                {salary.teacher?.firstName} {salary.teacher?.lastName}
                              </h3>
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}>
                                {salary.status || 'draft'}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200">
                                <CalendarDays className="h-3 w-3" />
                                {paymentMonth.label}
                              </span>
                            </div>

                            {/* Row 2: Invoice ref + date range + rate */}
                            <div className="flex items-center gap-2 text-[12px] text-muted-foreground flex-wrap">
                              <span className="font-mono text-[11px] text-muted-foreground/70">
                                {salary.invoiceNumber || salary.invoiceName || `#${String(salary._id).slice(-6)}`}
                              </span>
                              <span className="hidden sm:inline text-muted-foreground/30">·</span>
                              <span className="hidden sm:inline-flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDate(billingStart)} – {formatDate(billingEnd)}
                              </span>
                              {hourlyRate > 0 && (
                                <>
                                  <span className="text-muted-foreground/30">·</span>
                                  <span className="inline-flex items-center gap-1">
                                    <DollarSign className="h-3 w-3" />
                                    {hourlyRate.toFixed(2)}/h
                                  </span>
                                </>
                              )}
                              {totalHours != null && totalHours > 0 && (
                                <>
                                  <span className="text-muted-foreground/30">·</span>
                                  <span>{Number(totalHours).toFixed(1)}h</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Amount - always visible */}
                          <div className="text-right shrink-0">
                            <div className={`text-[15px] font-bold tabular-nums ${isPaid ? 'text-emerald-600' : 'text-foreground'}`}>
                              {formatCurrency(total)}
                            </div>
                            {totalEGP != null && totalEGP > 0 && (
                              <div className="text-[11px] text-muted-foreground tabular-nums">
                                {Number(totalEGP).toLocaleString('en', { maximumFractionDigits: 0 })} EGP
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action buttons - below content on mobile */}
                        <div className="flex items-center gap-0.5 mt-2 sm:mt-0 justify-end sm:justify-start">
                          <button onClick={() => handleOpenView(salary)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition" type="button" title="View invoice">
                            <Eye className="h-4 w-4" />
                          </button>
                          {isAdmin() && (
                            <>
                              {hasSlug && (
                                <button
                                  onClick={() => handleCopyPublicLink(salary)}
                                  className={`rounded-lg p-1.5 transition ${linkCopied ? 'text-emerald-600 bg-emerald-50' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                                  type="button"
                                  title={linkCopied ? 'Link copied!' : 'Copy public link'}
                                >
                                  {linkCopied ? <CheckCheck className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                                </button>
                              )}
                              <button
                                onClick={() => handleOpenWhatsapp(salary)}
                                className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 hover:text-green-700 transition"
                                type="button"
                                title="Send via WhatsApp"
                              >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                                </svg>
                              </button>
                              <button
                                onClick={() => openTeacherMsgModal(salary)}
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition"
                                type="button"
                                title="Compose message"
                              >
                                <MessageSquare className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleOpenEdit(salary)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition" type="button" title="Edit">
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button onClick={() => handleDelete(salary._id)} className="rounded-lg p-1.5 text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition" type="button" title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
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
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
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
        <div className="fixed bottom-8 right-6 z-40">
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

      {/* Teacher Arabic message modal */}
      {teacherMsgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTeacherMsgModal(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">رسالة راتب المعلم</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {teacherMsgModal.salary?.teacher?.firstName} {teacherMsgModal.salary?.teacher?.lastName}
                  {teacherMsgModal.salary?.billingPeriod?.month ? ` — ${arabicMonths[teacherMsgModal.salary.billingPeriod.month - 1]} ${teacherMsgModal.salary.billingPeriod.year || ''}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setTeacherMsgModal(null)} className="rounded-full p-1 text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-6 py-4">
              <textarea
                dir="rtl"
                rows={12}
                value={teacherMsgModal.message}
                onChange={(e) => setTeacherMsgModal((m) => m ? { ...m, message: e.target.value, copied: false } : m)}
                className="w-full rounded-xl border border-border bg-muted p-3 text-sm text-foreground font-sans leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
              <button
                type="button"
                onClick={handleCopyTeacherMsg}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
              >
                {teacherMsgModal.copied ? <CheckCheck className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                {teacherMsgModal.copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={handleSendTeacherWhatsapp}
                className="inline-flex items-center gap-2 rounded-full border border-green-300 bg-green-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-600"
              >
                <MessageSquare className="h-4 w-4" />
                WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalariesPage;
