/**
 * Teacher Salary Dashboard
 * 
 * Teachers can view:
 * - Year-to-date summary (hours, earnings, rate tier)
 * - Invoice history with filtering
 * - Detailed invoice breakdowns
 * - Payment status tracking
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { formatDateDDMMMYYYY } from '../../utils/date';
import TeacherInvoiceDetailModal from '../../components/teacherSalary/TeacherInvoiceDetailModal';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';
import {
  FileText,
  DollarSign,
  TrendingUp,
  Clock,
  Eye,
  Calendar,
  Award,
  AlertCircle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Sparkles
} from 'lucide-react';

const SalaryDashboard = () => {
  const { user } = useAuth();
  const { searchTerm } = useSearch();
  const navigate = useNavigate();
  const isTeacher = user?.role === 'teacher';

  // Redirect if not teacher
  useEffect(() => {
    if (!isTeacher) {
      navigate('/');
    }
  }, [isTeacher, navigate]);

  // State management
  const [ytdSummary, setYtdSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filter state
  const [filters, setFilters] = useState({
    status: 'published'
  });

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const limit = 10;

  // Modal state
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const fetchYTDSummaryInFlightRef = useRef(false);
  const fetchYTDSummaryKeyRef = useRef('');
  const fetchInvoicesInFlightRef = useRef(false);
  const fetchInvoicesKeyRef = useRef('');

  // Fetch YTD summary
  const fetchYTDSummary = useCallback(async () => {
    try {
      const year = new Date().getFullYear();
      const requestSignature = JSON.stringify({ year, userId: user?._id || null });
      if (fetchYTDSummaryInFlightRef.current && fetchYTDSummaryKeyRef.current === requestSignature) {
        return;
      }
      fetchYTDSummaryKeyRef.current = requestSignature;
      fetchYTDSummaryInFlightRef.current = true;

      const cacheKey = makeCacheKey('teacher-salary:ytd', user?._id || 'anon', { year });
      const cached = readCache(cacheKey, { deps: ['teacher-salary'] });
      if (cached.hit && cached.value) {
        setYtdSummary(cached.value.summary || cached.value);
        if (cached.ageMs < 60_000) {
          fetchYTDSummaryInFlightRef.current = false;
          return;
        }
      }

      const response = await api.get('/teacher-salary/teacher/ytd');
      setYtdSummary(response.data.summary);
      writeCache(cacheKey, response.data, { ttlMs: 5 * 60_000, deps: ['teacher-salary'] });
    } catch (err) {
      console.error('Error fetching YTD summary:', err);
      setError(err.response?.data?.message || 'Failed to load salary summary');
    } finally {
      fetchYTDSummaryInFlightRef.current = false;
    }
  }, [user?._id]);

  // Fetch invoices
  const fetchInvoices = useCallback(async () => {
    try {
      const requestSignature = JSON.stringify({ page, limit, filters, searchTerm, userId: user?._id || null });
      if (fetchInvoicesInFlightRef.current && fetchInvoicesKeyRef.current === requestSignature) {
        return;
      }
      fetchInvoicesKeyRef.current = requestSignature;
      fetchInvoicesInFlightRef.current = true;
      setInvoicesLoading(true);

      const params = {
        page,
        limit,
        ...filters,
        search: searchTerm || undefined
      };

      // Remove empty filters
      Object.keys(params).forEach(key => {
        if (params[key] === '') delete params[key];
      });

      const cacheKey = makeCacheKey('teacher-salary:teacher-invoices', user?._id || 'anon', params);
      const cached = readCache(cacheKey, { deps: ['teacher-salary'] });
      if (cached.hit && cached.value) {
        const payload = cached.value;
        setInvoices(payload.invoices || []);
        setTotalPages(payload.pagination?.totalPages || payload.pagination?.pages || 1);
        setTotalInvoices(payload.pagination?.total || 0);
        setPage(payload.pagination?.page || 1);
        setInvoicesLoading(false);

        if (cached.ageMs < 60_000) {
          fetchInvoicesInFlightRef.current = false;
          return;
        }
      }

      const response = await api.get('/teacher-salary/teacher/invoices', { params });

      setInvoices(response.data.invoices || []);
      setTotalPages(response.data.pagination?.totalPages || 1);
      setTotalInvoices(response.data.pagination?.total || 0);
      setPage(response.data.pagination?.page || 1);
      writeCache(cacheKey, response.data, { ttlMs: 5 * 60_000, deps: ['teacher-salary'] });
    } catch (err) {
      console.error('Error fetching invoices:', err);
      setError(err.response?.data?.message || 'Failed to load invoices');
    } finally {
      setInvoicesLoading(false);
      fetchInvoicesInFlightRef.current = false;
    }
  }, [page, limit, filters, user?._id, searchTerm]);

  // Initial data fetch
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      await Promise.all([fetchYTDSummary(), fetchInvoices()]);
      setLoading(false);
    };

    if (isTeacher) {
      fetchData();
    }
  }, [isTeacher, fetchYTDSummary, fetchInvoices]);

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  useEffect(() => {
    setPage(1);
  }, [searchTerm]);

  // View invoice details
  const handleViewDetails = (invoice) => {
    setSelectedInvoice(invoice);
    setShowDetailModal(true);
  };

  // Format currency
  const formatCurrency = (amount, currency = 'EGP') => {
    const value = Number(amount) || 0;
    if (currency === 'USD') {
      return `$${value.toFixed(2)}`;
    }
    return `${value.toFixed(2)} EGP`;
  };

  // Get status color
  const getStatusColor = (status) => {
    switch (status) {
      case 'published':
        return 'bg-blue-100 text-blue-700';
      case 'paid':
        return 'bg-green-100 text-green-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  // Get status icon
  const getStatusIcon = (status) => {
    switch (status) {
      case 'published':
        return <Eye className="w-3 h-3" />;
      case 'paid':
        return <CheckCircle className="w-3 h-3" />;
      default:
        return <FileText className="w-3 h-3" />;
    }
  };

  // Get tier info
  const getTierInfo = (partition) => {
    const tiers = {
      '0-50h': { name: 'Beginner', color: 'text-gray-700', bgColor: 'bg-gray-100' },
      '51-100h': { name: 'Intermediate', color: 'text-blue-700', bgColor: 'bg-blue-100' },
      '101-200h': { name: 'Advanced', color: 'text-purple-700', bgColor: 'bg-purple-100' },
      '200+h': { name: 'Expert', color: 'text-amber-700', bgColor: 'bg-amber-100' }
    };
    return tiers[partition] || tiers['0-50h'];
  };

  if (!isTeacher) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800">
            <AlertCircle className="w-5 h-5" />
            {error}
          </div>
        )}

        {/* YTD Summary Cards */}
        {ytdSummary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {/* Total Hours YTD */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Clock className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-xs text-gray-500">Year to Date</span>
              </div>
              <h3 className="text-sm font-medium text-gray-600 mb-1">Total Hours</h3>
              <p className="text-3xl font-bold text-gray-900">
                {Number(ytdSummary.totalHoursYTD ?? ytdSummary.totalHours ?? 0).toFixed(1)}
              </p>
              <p className="text-xs text-gray-500 mt-1">hours taught this year</p>
            </div>

            {/* Total Earnings YTD */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-green-100 rounded-lg">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
                <span className="text-xs text-gray-500">Year to Date</span>
              </div>
              <h3 className="text-sm font-medium text-gray-600 mb-1">Total Earnings</h3>
              <p className="text-3xl font-bold text-gray-900">
                ${Number(ytdSummary.totalEarningsYTD ?? ytdSummary.totalEarnedUSD ?? 0).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 mt-1">USD earned this year</p>
            </div>

            {/* Current Rate Tier */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <Award className="w-6 h-6 text-purple-600" />
                </div>
                <span className="text-xs text-gray-500">Current Tier</span>
              </div>
              <h3 className="text-sm font-medium text-gray-600 mb-1">Rate Tier</h3>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${getTierInfo(ytdSummary.currentRatePartition || ytdSummary.ratePartition || '0-50h').bgColor} ${getTierInfo(ytdSummary.currentRatePartition || ytdSummary.ratePartition || '0-50h').color}`}>
                  <Sparkles className="w-3 h-3" />
                  {getTierInfo(ytdSummary.currentRatePartition || ytdSummary.ratePartition || '0-50h').name}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-2">{ytdSummary.currentRatePartition || ytdSummary.ratePartition || '—'}</p>
            </div>

            {/* Current Hourly Rate */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="p-3 bg-amber-100 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-amber-600" />
                </div>
                <span className="text-xs text-gray-500">Current</span>
              </div>
              <h3 className="text-sm font-medium text-gray-600 mb-1">Hourly Rate</h3>
              <p className="text-3xl font-bold text-gray-900">
                ${Number(ytdSummary.effectiveRate ?? ytdSummary.currentRateUSD ?? 0).toFixed(2)}
              </p>
              <p className="text-xs text-gray-500 mt-1">per hour (USD)</p>
            </div>
          </div>
        )}

        {/* Invoices Section */}
        <div className="bg-white rounded-lg shadow">
          {/* Section Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-gray-600" />
                <h2 className="text-xl font-semibold text-gray-900">My Invoices</h2>
              </div>
            </div>
          </div>

          <div className="px-6 py-3 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleFilterChange('status', 'published')}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${filters.status !== 'paid' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Unpaid
              </button>
              <button
                type="button"
                onClick={() => handleFilterChange('status', 'paid')}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${filters.status === 'paid' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Paid
              </button>
            </div>
          </div>

          {/* Invoices List */}
          {invoicesLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No invoices found</p>
              <p className="text-sm text-gray-500 mt-1">
                {searchTerm
                  ? 'Try a different search'
                  : 'Invoices will appear here once published by admin'}
              </p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-gray-200">
                {invoices.map((invoice) => {
                  const periodLabel = invoice.month && invoice.year
                    ? `${String(invoice.month).padStart(2, '0')}/${invoice.year}`
                    : (invoice.invoiceMonth ? formatDateDDMMMYYYY(invoice.invoiceMonth) : '—');
                  const rateUSD = Number(invoice.rateSnapshot?.rate || invoice.snapshotRate?.rateUSD || invoice.hourlyRateUSD || 0);
                  const amountEGP = Number(invoice.netAmountEGP || invoice.totalEGP || invoice.grossAmountEGP || invoice.finalTotalEGP || invoice.finalTotalInEGP || 0);
                  const fallbackAmount = amountEGP > 0
                    ? formatCurrency(amountEGP, 'EGP')
                    : formatCurrency(invoice.finalTotal, invoice.currency || 'EGP');

                  return (
                  <div
                    key={invoice._id}
                    className="px-6 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {invoice.invoiceNumber}
                          </h3>
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}>
                            {getStatusIcon(invoice.status)}
                            {invoice.status}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div className="flex items-center gap-2 text-gray-600">
                            <Calendar className="w-4 h-4" />
                            <span>{periodLabel}</span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-600">
                            <Clock className="w-4 h-4" />
                            <span>{invoice.totalHours?.toFixed(2) || '0.00'} hours</span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-600">
                            <TrendingUp className="w-4 h-4" />
                            <span>${rateUSD.toFixed(2)}/hr</span>
                          </div>
                          <div className="flex items-center gap-2 font-semibold text-green-600">
                            <DollarSign className="w-4 h-4" />
                            <span>{fallbackAmount}</span>
                          </div>
                        </div>

                        {invoice.status === 'paid' && invoice.paidAt && (
                          <div className="mt-2 text-xs text-green-600 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Paid on {formatDateDDMMMYYYY(invoice.paidAt)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleViewDetails(invoice)}
                          className="inline-flex items-center gap-2 rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56]"
                        >
                          <Eye className="w-4 h-4" />
                          View Details
                        </button>
                      </div>
                    </div>
                  </div>
                );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-700">
                      Showing <span className="font-medium">{((page - 1) * limit) + 1}</span> to{' '}
                      <span className="font-medium">
                        {Math.min(page * limit, totalInvoices)}
                      </span> of{' '}
                      <span className="font-medium">{totalInvoices}</span> invoices
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-sm text-gray-700">
                        Page {page} of {totalPages}
                      </span>
                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages}
                        className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {showDetailModal && selectedInvoice && (
        <TeacherInvoiceDetailModal
          invoiceId={selectedInvoice._id}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedInvoice(null);
          }}
          onUpdate={() => {
            fetchInvoices();
            fetchYTDSummary();
          }}
        />
      )}
    </div>
  );
};

export default SalaryDashboard;
