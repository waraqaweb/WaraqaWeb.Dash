/**
 * Unified Teacher Salaries Page
 * 
 * Combines all teacher salary management features:
 * - List all teacher salary invoices
 * - Generate monthly invoices
 * - Publish, mark as paid, add bonuses/extras
 * - View detailed invoice breakdown
 * - Manage salary settings via modal
 * - Statistics and filtering
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { formatDateDDMMMYYYY } from '../../utils/date';
import TeacherInvoiceDetailModal from '../../components/teacherSalary/TeacherInvoiceDetailModal';
import PublishInvoiceDialog from '../../components/teacherSalary/PublishInvoiceDialog';
import MarkPaidDialog from '../../components/teacherSalary/MarkPaidDialog';
import AddBonusDialog from '../../components/teacherSalary/AddBonusDialog';
import AddExtraDialog from '../../components/teacherSalary/AddExtraDialog';
import SalarySettingsModal from '../../components/teacherSalary/SalarySettingsModal';
import GenerateInvoicesModal from '../../components/teacherSalary/GenerateInvoicesModal';
import ZeroMonthlyHoursModal from '../../components/teacherSalary/ZeroMonthlyHoursModal';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';
import {
  TEACHER_SALARY_VIEW_KEY,
  createDefaultTeacherSalaryFilters
} from '../../constants/teacherSalaryFilters';
import {
  FileText,
  Users,
  Calendar,
  Eye,
  Check,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Settings,
  X,
  Trash2,
  Send,
  Trash,
  CreditCard,
  Star,
  PlusSquare
} from 'lucide-react';

const formatEGPSummary = (value) => new Intl.NumberFormat('en-EG', {
  style: 'currency',
  currency: 'EGP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
}).format(Number(value) || 0);

const TeacherSalaries = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { searchTerm, viewFilters, setFiltersForView } = useSearch();
  const isAdmin = user?.role === 'admin';

  // Redirect if not admin
  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
    }
  }, [isAdmin, navigate]);

  // State management
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [summary, setSummary] = useState(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const limit = 20;

  // Sort state
  const [sortBy] = useState('invoiceMonth');
  const [sortOrder] = useState('desc');

  // Modal state
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showMarkPaidDialog, setShowMarkPaidDialog] = useState(false);
  const [showAddBonusDialog, setShowAddBonusDialog] = useState(false);
  const [showAddExtraDialog, setShowAddExtraDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showZeroModal, setShowZeroModal] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const fetchInvoicesKeyRef = useRef('');
  const fetchInvoicesInFlightRef = useRef(false);
  const fetchInvoicesAbortRef = useRef(null);
  const fetchInvoicesRequestIdRef = useRef(0);

  const defaultFilters = useMemo(() => createDefaultTeacherSalaryFilters(), []);
  const salaryFilters = viewFilters[TEACHER_SALARY_VIEW_KEY] || defaultFilters;
  const activeStatusTab = salaryFilters?.status === 'paid' ? 'paid' : 'unpaid';

  const handleStatusTabChange = (status) => {
    setFiltersForView(TEACHER_SALARY_VIEW_KEY, {
      ...salaryFilters,
      status
    });
    setPage(1);
  };

  useEffect(() => {
    if (!viewFilters[TEACHER_SALARY_VIEW_KEY]) {
      setFiltersForView(TEACHER_SALARY_VIEW_KEY, { ...defaultFilters, status: 'unpaid' });
    }
  }, [defaultFilters, setFiltersForView, viewFilters]);

  // Fetch invoices
  const fetchInvoices = useCallback(async () => {
    try {
      const requestSignature = JSON.stringify({
        page,
        limit,
        sortBy,
        sortOrder,
        searchTerm,
        salaryFilters
      });

      if (fetchInvoicesInFlightRef.current && fetchInvoicesKeyRef.current === requestSignature) {
        return;
      }

      fetchInvoicesKeyRef.current = requestSignature;
      fetchInvoicesInFlightRef.current = true;

      const requestId = fetchInvoicesRequestIdRef.current + 1;
      fetchInvoicesRequestIdRef.current = requestId;

      if (fetchInvoicesAbortRef.current) {
        try {
          fetchInvoicesAbortRef.current.abort();
        } catch (e) {
          // ignore abort errors
        }
      }

      const controller = new AbortController();
      fetchInvoicesAbortRef.current = controller;

      setError(null);

      const params = {
        page,
        limit,
        sortBy,
        sortOrder,
        search: searchTerm,
        includeSummary: true,
        ...salaryFilters
      };

      // Normalize month filter: input type="month" returns "YYYY-MM".
      // Backend expects `month` (1-12) and `year` as separate numeric params.
      if (params.month && typeof params.month === 'string' && params.month.includes('-')) {
        const [yr, mn] = params.month.split('-');
        // Replace with numeric month/year
        params.year = parseInt(yr, 10);
        params.month = parseInt(mn, 10);
      }

      // Remove empty filters
      Object.keys(params).forEach(key => {
        if (params[key] === '' || params[key] === undefined || params[key] === null) delete params[key];
      });

      const cacheKey = makeCacheKey('teacher-salary:admin-invoices', 'admin', params);
      const cached = readCache(cacheKey, { deps: ['teacher-salary'] });
      if (cached.hit && cached.value) {
        const cachedPayload = cached.value;
        setInvoices(cachedPayload.invoices || []);
        setTotalPages(cachedPayload.pagination?.totalPages || cachedPayload.pagination?.pages || 1);
        setTotalInvoices(cachedPayload.pagination?.total || 0);
        setPage(cachedPayload.pagination?.page || 1);
        setSummary(cachedPayload.summary || null);
        setLoading(false);

        if (cached.ageMs < 60_000) {
          fetchInvoicesInFlightRef.current = false;
          return;
        }
      } else {
        setLoading(true);
      }

      const response = await api.get('/teacher-salary/admin/invoices', { params, signal: controller.signal });
      if (requestId !== fetchInvoicesRequestIdRef.current) {
        return;
      }

      setInvoices(response.data.invoices || []);
      // Backend sometimes returns `pagination.pages` instead of `pagination.totalPages`.
      setTotalPages(response.data.pagination?.totalPages || response.data.pagination?.pages || 1);
      setTotalInvoices(response.data.pagination?.total || 0);
      setPage(response.data.pagination?.page || 1);
      setSummary(response.data.summary || null);

      writeCache(cacheKey, response.data, { ttlMs: 5 * 60_000, deps: ['teacher-salary'] });
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        console.error('Error fetching invoices:', err);
        setError(err.response?.data?.message || 'Failed to load invoices');
        setSummary(null);
      }
    } finally {
      setLoading(false);
      fetchInvoicesInFlightRef.current = false;
    }
  }, [page, limit, sortBy, sortOrder, salaryFilters, searchTerm]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => {
    setPage(1);
  }, [salaryFilters]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  // Handle generate invoice success
  const handleGenerateSuccess = (message) => {
    setSuccessMessage(message);
    fetchInvoices();
    setTimeout(() => setSuccessMessage(null), 5000);
  };

  // Delete invoice
  const handleDeleteInvoice = async (invoiceId) => {
    if (!window.confirm('Delete this invoice? It will be removed from lists. Teacher hours will NOT be changed.')) {
      return;
    }

    try {
      await api.delete(`/teacher-salary/admin/invoices/${invoiceId}`, { params: { preserveHours: true } });
      setInvoices((prev) => (prev || []).filter((inv) => inv?._id !== invoiceId));
      setSuccessMessage('✓ Invoice deleted successfully');
      fetchInvoices();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Error deleting invoice:', err);
      setError(err.response?.data?.message || 'Failed to delete invoice');
    }
  };

  // Format currency
  const formatCurrency = (amount, currency = 'EGP') => {
    const value = Number(amount) || 0;
    if (currency === 'USD') {
      return `$${value.toFixed(2)}`;
    }
    return `${value.toFixed(2)} EGP`;
  };

  // Format invoice month/year (e.g., 11 -> November 2025)
  const formatInvoicePeriod = (month, year) => {
    if (!month || !year) return '—';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const m = Number(month);
    if (!m || m < 1 || m > 12) return '—';
    return `${months[m - 1]} ${year}`;
  };

  // Get status badge color
  const getStatusColor = (status) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-700';
      case 'published':
        return 'bg-blue-100 text-blue-700';
      case 'paid':
        return 'bg-green-100 text-green-700';
      case 'archived':
        return 'bg-purple-100 text-purple-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Calculate summary statistics
  const stats = useMemo(() => {
    return {
      total: totalInvoices,
      draft: invoices.filter(inv => inv.status === 'draft').length,
      published: invoices.filter(inv => inv.status === 'published').length,
      paid: invoices.filter(inv => inv.status === 'paid').length,
      totalAmount: invoices.reduce((sum, inv) => sum + (inv.finalTotal || 0), 0)
    };
  }, [invoices, totalInvoices]);

  const summaryHighlights = useMemo(() => {
    if (!summary?.period) return [];
    const previous = summary.previousPeriod;

    const buildCard = ({ key, label, formatValue, formatDelta }) => {
      const currentValue = Number(summary.period?.[key] || 0);
      const previousValue = previous ? Number(previous[key] || 0) : null;
      const deltaValue = previousValue !== null ? currentValue - previousValue : null;
      const deltaPct = previousValue && previousValue !== 0 ? (deltaValue / previousValue) * 100 : null;

      return {
        key,
        label,
        value: formatValue(currentValue),
        delta: deltaValue !== null ? formatDelta(deltaValue, deltaPct) : null,
        trend: deltaValue === null ? null : (deltaValue >= 0 ? 'up' : 'down')
      };
    };

    return [
      buildCard({
        key: 'totalHours',
        label: 'Hours to Pay',
        formatValue: (val) => `${val.toFixed(2)} hrs`,
        formatDelta: (delta, pct) => `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} hrs${pct !== null ? ` (${delta >= 0 ? '+' : '-'}${pct.toFixed(1)}%)` : ''}`
      }),
      buildCard({
        key: 'totalNetEGP',
        label: 'Amount Due (EGP)',
        formatValue: (val) => formatEGPSummary(val),
        formatDelta: (delta, pct) => `${delta >= 0 ? '+' : '-'}${formatEGPSummary(Math.abs(delta))}${pct !== null ? ` (${delta >= 0 ? '+' : '-'}${pct.toFixed(1)}%)` : ''}`
      }),
      buildCard({
        key: 'totalBonusesEGP',
        label: 'Bonuses (EGP)',
        formatValue: (val) => formatEGPSummary(val),
        formatDelta: (delta, pct) => `${delta >= 0 ? '+' : '-'}${formatEGPSummary(Math.abs(delta))}${pct !== null ? ` (${delta >= 0 ? '+' : '-'}${pct.toFixed(1)}%)` : ''}`
      }),
      buildCard({
        key: 'averageRateUSD',
        label: 'Avg Hourly Rate (USD)',
        formatValue: (val) => `$${val.toFixed(2)}/hr`,
        formatDelta: (delta, pct) => `${delta >= 0 ? '+' : '-'}$${Math.abs(delta).toFixed(2)}/hr${pct !== null ? ` (${delta >= 0 ? '+' : '-'}${pct.toFixed(1)}%)` : ''}`
      }),
      buildCard({
        key: 'teacherCount',
        label: 'Teachers Paid',
        formatValue: (val) => `${val} teacher${val === 1 ? '' : 's'}`,
        formatDelta: (delta, pct) => {
          const abs = Math.abs(delta);
          return `${delta >= 0 ? '+' : '-'}${abs} teacher${abs === 1 ? '' : 's'}${pct !== null ? ` (${delta >= 0 ? '+' : '-'}${pct.toFixed(1)}%)` : ''}`;
        }
      })
    ];
  }, [summary]);

  const statusBadges = useMemo(() => {
    if (!summary?.period?.statusBreakdown) return [];

    const badgeMap = {
      draft: { label: 'Draft', color: 'bg-slate-100 text-slate-700' },
      published: { label: 'Published', color: 'bg-blue-100 text-blue-700' },
      paid: { label: 'Paid', color: 'bg-green-100 text-green-700' },
      archived: { label: 'Archived', color: 'bg-purple-100 text-purple-700' }
    };

    return Object.entries(badgeMap).map(([statusKey, meta]) => {
      const info = summary.period.statusBreakdown[statusKey] || {};
      return {
        ...meta,
        key: statusKey,
        count: info.count || 0,
        amount: info.netAmountEGP || 0
      };
    }).filter(badge => badge.count > 0);
  }, [summary]);

  const hasActiveFilters = useMemo(() => (
    salaryFilters ? Object.values(salaryFilters).some(value => Boolean(value)) : false
  ), [salaryFilters]);

  const orderedInvoices = useMemo(() => {
    const list = (invoices || []).slice();
    const sortByTeacherName = (a, b) => {
      const aName = `${a.teacher?.firstName || ''} ${a.teacher?.lastName || ''}`.trim().toLowerCase();
      const bName = `${b.teacher?.firstName || ''} ${b.teacher?.lastName || ''}`.trim().toLowerCase();
      return aName.localeCompare(bName);
    };

    if (activeStatusTab === 'paid') {
      list.sort((a, b) => new Date(b.paidAt || b.updatedAt || b.createdAt) - new Date(a.paidAt || a.updatedAt || a.createdAt));
      return list;
    }

    const statusOrder = ['draft', 'published'];
    list.sort((a, b) => {
      const aIdx = statusOrder.indexOf(a.status);
      const bIdx = statusOrder.indexOf(b.status);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return sortByTeacherName(a, b);
    });
    return list;
  }, [invoices, activeStatusTab]);

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="rounded-3xl bg-white/80 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
          

          {/* Statistics Cards */}
          <div className="border-t border-slate-100 px-6 py-6 lg:px-8">
            {summary?.period ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payroll snapshot</p>
                    <p className="text-sm text-slate-600">{summary.period.label}</p>
                  </div>
                  {summary.previousPeriod && (
                    <p className="text-xs text-slate-500">Comparing vs {summary.previousPeriod.label}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {summaryHighlights.map((card) => (
                    <div key={card.key} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3 transition hover:-translate-y-0.5 hover:shadow-md">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-900">{card.value}</p>
                      {card.delta && summary.previousPeriod && (
                        <p className={`mt-1 text-xs font-medium ${card.trend === 'up' ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {card.delta} vs {summary.previousPeriod.label}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {statusBadges.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-sm">
                    {statusBadges.map((badge) => (
                      <span key={badge.key} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${badge.color}`}>
                        <span className="font-semibold">{badge.label}</span>
                        <span className="text-slate-600">{badge.count} • {formatEGPSummary(badge.amount)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { label: 'Total Invoices', value: stats.total, icon: FileText },
                  { label: 'Draft', value: stats.draft, icon: FileText },
                  { label: 'Published', value: stats.published, icon: Eye },
                  { label: 'Paid', value: stats.paid, icon: Check }
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3 transition hover:-translate-y-0.5 hover:shadow-md">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
                      <span className="rounded-full bg-white p-1.5 text-slate-500 shadow-sm"><Icon className="h-3.5 w-3.5" /></span>
                    </div>
                    <span className="text-2xl font-semibold text-slate-900">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Success/Error Messages */}
          {successMessage && (
            <div className="mx-6 mb-6 flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-green-800 lg:mx-8">
              <Check className="w-5 h-5" />
              {successMessage}
              <button
                onClick={() => setSuccessMessage(null)}
                className="ml-auto inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-green-700 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                aria-label="Dismiss success message"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {error && (
            <div className="mx-6 mb-6 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-red-800 lg:mx-8">
              <AlertCircle className="w-5 h-5" />
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-auto inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                aria-label="Dismiss error message"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Search/filter controls now live in the global dashboard header */}

        {/* Invoices List */}
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleStatusTabChange('unpaid')}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${activeStatusTab === 'unpaid' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Unpaid
            </button>
            <button
              type="button"
              onClick={() => handleStatusTabChange('paid')}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${activeStatusTab === 'paid' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              Paid
            </button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
              <FileText className="w-12 h-12 text-slate-400" />
              <div>
                <p className="text-base font-medium text-slate-700">No invoices found</p>
                <p className="text-sm text-slate-500 mt-1">
                  {hasActiveFilters || searchTerm
                    ? 'Try adjusting the header filters or search'
                    : totalInvoices === 0 
                    ? 'Click "Generate Invoices" to generate invoices for teachers with completed classes'
                      : 'No invoices match the current filters'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {orderedInvoices.map((invoice) => {
                  const statusColor = getStatusColor(invoice.status);
                  return (
                    <div key={invoice._id} className="rounded-xl border border-slate-100 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="flex flex-col gap-3 p-3 md:p-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${statusColor}`}>
                              <span className="capitalize">{invoice.status || 'draft'}</span>
                            </span>
                            <span className="text-sm font-semibold text-slate-700">{invoice.invoiceNumber}</span>
                          </div>

                          <div className="space-y-1 text-sm text-slate-600">
                            <div className="flex flex-wrap items-center gap-4">
                              <div className="inline-flex items-center gap-2">
                                <Users className="w-4 h-4 text-slate-400" />
                                <span className="text-slate-900 font-medium">{invoice.teacher?.firstName} {invoice.teacher?.lastName}</span>
                              </div>

                              <div className="inline-flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-slate-400" />
                                <span>{invoice.month && invoice.year ? formatInvoicePeriod(invoice.month, invoice.year) : (invoice.invoiceMonth ? formatDateDDMMMYYYY(invoice.invoiceMonth) : '—')}</span>
                              </div>

                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-slate-500">{invoice.totalHours?.toFixed(2) || '0.00'} hrs</span>
                              </div>

                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-slate-500">
                                  {invoice.exchangeRateSnapshot?.rate ?
                                    `EX: ${Number(invoice.exchangeRateSnapshot.rate).toFixed(2)} EGP/USD` : (() => {
                                      const ex = invoice.exchangeRate || invoice.exchangeRateEGP || invoice.usdToEgp || invoice.exchangeRateUsed;
                                      if (ex) return `EX: ${Number(ex).toFixed(2)} EGP/USD`;
                                      if (invoice.totalUSD && invoice.finalTotal) {
                                        const derived = Number(invoice.finalTotal) / Number(invoice.totalUSD);
                                        if (!Number.isNaN(derived) && Number.isFinite(derived)) return `EX: ${derived.toFixed(2)} EGP/USD (derived)`;
                                      }
                                      return 'EX: —';
                                    })()
                                  }
                                </span>
                              </div>

                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-slate-500">
                                  {invoice.rateSnapshot?.rate ?
                                    `$${Number(invoice.rateSnapshot.rate).toFixed(2)}/hr` : (() => {
                                      const hr = invoice.hourlyRateUSD || invoice.avgRateUSD || invoice.averageRateUSD || invoice.hourRate || null;
                                      if (hr) return `$${Number(hr).toFixed(2)}/hr`;
                                      if (invoice.totalUSD && invoice.totalHours) {
                                        const derived = Number(invoice.totalUSD) / Number(invoice.totalHours);
                                        if (!Number.isNaN(derived) && Number.isFinite(derived)) return `$${derived.toFixed(2)}/hr (derived)`;
                                      }
                                      return '$—/hr';
                                    })()
                                  }
                                </span>
                              </div>

                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-slate-500">
                                  {(() => {
                                    const candidates = invoice.bonusesEGP || invoice.bonusTotalEGP || invoice.bonusesTotal;
                                    if (candidates && Number(candidates) > 0) return `Bonus: ${formatCurrency(candidates, 'EGP')}`;
                                    if (Array.isArray(invoice.bonuses) && invoice.bonuses.length) {
                                      const sum = invoice.bonuses.reduce((s, b) => s + (Number(b.amount || 0)), 0);
                                      if (sum > 0) return `Bonus: ${formatCurrency(sum, 'EGP')}`;
                                    }
                                    return 'Bonus: None';
                                  })()}
                                </span>
                              </div>

                              <div className="inline-flex items-center gap-2">
                                <span className="text-xs text-slate-500">
                                  {invoice.paidAt ? (
                                    `Paid on ${formatDateDDMMMYYYY(invoice.paidAt)}` + (invoice.payment?.amount ? ` • ${formatCurrency(invoice.payment.amount, invoice.payment.currency || 'EGP')}` : '')
                                  ) : (invoice.payment?.amount ? `${formatCurrency(invoice.payment.amount, invoice.payment.currency || 'EGP')}` : 'Payment: Not recorded')}
                                </span>
                              </div>

                              <div className="inline-flex items-center gap-2">
                                {(() => {
                                  const asNumber = (v) => Number(v) || 0;
                                  // Prefer server-provided EGP totals when available
                                  const egpCandidates = [invoice.netAmountEGP, invoice.totalEGP, invoice.grossAmountEGP, invoice.finalTotalEGP, invoice.finalTotalInEGP];
                                  for (const c of egpCandidates) {
                                    if (asNumber(c) > 0) return <span className="font-semibold text-slate-900">{formatCurrency(c, 'EGP')}</span>;
                                  }

                                  // If finalTotal exists and is in USD, try to convert using known exchange rates
                                  const final = asNumber(invoice.finalTotal);
                                  if (final > 0) {
                                    if ((invoice.currency || 'EGP') === 'EGP') {
                                      return <span className="font-semibold text-slate-900">{formatCurrency(final, 'EGP')}</span>;
                                    }

                                    const ex = invoice.exchangeRateSnapshot?.rate || invoice.exchangeRate || invoice.exchangeRateEGP || invoice.usdToEgp || invoice.exchangeRateUsed;
                                    const exNum = asNumber(ex);
                                    if (exNum > 0) {
                                      return <span className="font-semibold text-slate-900">{formatCurrency(final * exNum, 'EGP')}{ex !== invoice.exchangeRateSnapshot?.rate ? ' (derived)' : ''}</span>;
                                    }
                                  }

                                  // Last resort: show whatever finalTotal exists (formatted with assumed currency)
                                  return <span className="font-semibold text-slate-900">{formatCurrency(invoice.finalTotal, invoice.currency)}</span>;
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setSelectedInvoice(invoice);
                              setShowDetailModal(true);
                            }}
                            className="inline-flex items-center justify-center rounded-md p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400"
                            type="button"
                            title="View Details"
                            aria-label={`View details for invoice ${invoice.invoiceNumber || ''}`}
                          >
                            <FileText className="h-5 w-5" aria-hidden="true" />
                          </button>
                          
                          {invoice.status === 'draft' && (
                              <>
                              <button
                                onClick={() => {
                                  setSelectedInvoice(invoice);
                                  setShowPublishDialog(true);
                                }}
                                className="inline-flex items-center justify-center rounded-md bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                                type="button"
                                title="Publish Invoice"
                                aria-label={`Publish invoice ${invoice.invoiceNumber || ''}`}
                              >
                                <Send className="h-5 w-5" aria-hidden="true" />
                              </button>
                              </>
                          )}
                          <button
                            onClick={() => handleDeleteInvoice(invoice._id)}
                            className="inline-flex items-center justify-center rounded-md bg-red-50 p-2 text-red-600 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                            type="button"
                            title="Delete Invoice"
                            aria-label={`Delete invoice ${invoice.invoiceNumber || ''}`}
                          >
                            <Trash className="h-5 w-5" aria-hidden="true" />
                          </button>
                          
                          {invoice.status === 'published' && (
                            <button
                              onClick={() => {
                                setSelectedInvoice(invoice);
                                setShowMarkPaidDialog(true);
                              }}
                              className="inline-flex items-center justify-center rounded-md bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                              type="button"
                              title="Mark as Paid"
                              aria-label={`Mark invoice ${invoice.invoiceNumber || ''} as paid`}
                            >
                              <CreditCard className="h-5 w-5" aria-hidden="true" />
                            </button>
                          )}
                          
                          {(invoice.status === 'draft' || invoice.status === 'published') && (
                              <>
                              <button
                                onClick={() => {
                                  setSelectedInvoice(invoice);
                                  setShowAddBonusDialog(true);
                                }}
                                className="inline-flex items-center justify-center rounded-md bg-amber-50 p-2 text-amber-600 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
                                type="button"
                                title="Add Bonus"
                                aria-label={`Add bonus to invoice ${invoice.invoiceNumber || ''}`}
                              >
                                <Star className="h-5 w-5" aria-hidden="true" />
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedInvoice(invoice);
                                  setShowAddExtraDialog(true);
                                }}
                                className="inline-flex items-center justify-center rounded-md bg-sky-50 p-2 text-sky-600 hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500"
                                type="button"
                                title="Add Extra"
                                aria-label={`Add extra to invoice ${invoice.invoiceNumber || ''}`}
                              >
                                <PlusSquare className="h-5 w-5" aria-hidden="true" />
                              </button>
                              </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-6">
                  <div className="text-sm text-slate-700">
                    Showing <span className="font-medium">{((page - 1) * limit) + 1}</span> to{' '}
                    <span className="font-medium">{Math.min(page * limit, totalInvoices)}</span> of{' '}
                    <span className="font-medium">{totalInvoices}</span> invoices
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-sm text-slate-700">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Floating Action Buttons */}
      <div className="fixed bottom-8 right-8 z-40 flex flex-col items-end gap-3">
        {showQuickActions && (
          <div className="flex flex-col items-end gap-2 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-xl">
            <button
              onClick={() => {
                setShowSettingsModal(true);
                setShowQuickActions(false);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56]"
              aria-label="Open salary settings"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
            <button
              onClick={() => {
                setShowGenerateModal(true);
                setShowQuickActions(false);
              }}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56] disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Open generate invoices dialog"
            >
              <Plus className="h-4 w-4" />
              Generate Invoices
            </button>
            <button
              onClick={() => {
                setShowZeroModal(true);
                setShowQuickActions(false);
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700"
              aria-label="Open zero monthly hours dialog"
            >
              <Trash2 className="h-4 w-4" />
              Zero Monthly Hours
            </button>
          </div>
        )}

        <button
          onClick={() => setShowQuickActions(prev => !prev)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[#2C736C] text-white shadow-2xl transition hover:bg-[#245b56]"
          aria-label="Toggle salary quick actions"
        >
          {showQuickActions ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
        </button>
      </div>

      {/* Modals */}
      {showDetailModal && selectedInvoice && (
        <TeacherInvoiceDetailModal
          invoiceId={selectedInvoice._id}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedInvoice(null);
          }}
          onUpdate={fetchInvoices}
        />
      )}

      {showPublishDialog && selectedInvoice && (
        <PublishInvoiceDialog
          invoice={selectedInvoice}
          onClose={() => {
            setShowPublishDialog(false);
            setSelectedInvoice(null);
          }}
          onSuccess={() => {
            setSuccessMessage(`✓ Invoice ${selectedInvoice.invoiceNumber} published successfully`);
            fetchInvoices();
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
        />
      )}

      {showMarkPaidDialog && selectedInvoice && (
        <MarkPaidDialog
          invoice={selectedInvoice}
          onClose={() => {
            setShowMarkPaidDialog(false);
            setSelectedInvoice(null);
          }}
          onSuccess={() => {
            setSuccessMessage(`✓ Invoice ${selectedInvoice.invoiceNumber} marked as paid`);
            fetchInvoices();
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
        />
      )}

      {showAddBonusDialog && selectedInvoice && (
        <AddBonusDialog
          invoice={selectedInvoice}
          onClose={() => {
            setShowAddBonusDialog(false);
            setSelectedInvoice(null);
          }}
          onSuccess={() => {
            setSuccessMessage(`✓ Bonus added to invoice ${selectedInvoice.invoiceNumber}`);
            fetchInvoices();
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
        />
      )}

      {showAddExtraDialog && selectedInvoice && (
        <AddExtraDialog
          invoice={selectedInvoice}
          onClose={() => {
            setShowAddExtraDialog(false);
            setSelectedInvoice(null);
          }}
          onSuccess={() => {
            setSuccessMessage(`✓ Extra added to invoice ${selectedInvoice.invoiceNumber}`);
            fetchInvoices();
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SalarySettingsModal
          onClose={() => setShowSettingsModal(false)}
          onUpdate={fetchInvoices}
        />
      )}

      {/* Generate Invoices Modal */}
      {showGenerateModal && (
        <GenerateInvoicesModal
          onClose={() => setShowGenerateModal(false)}
          onSuccess={handleGenerateSuccess}
        />
      )}

      {showZeroModal && (
        <ZeroMonthlyHoursModal
          onClose={() => setShowZeroModal(false)}
          onSuccess={(msg) => {
            setSuccessMessage(msg);
            fetchInvoices();
            setTimeout(() => setSuccessMessage(null), 5000);
          }}
        />
      )}
    </div>
  );
};

export default TeacherSalaries;
