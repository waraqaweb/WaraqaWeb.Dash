/**
 * Teacher Invoices Page - Admin view for managing teacher salary invoices
 * 
 * Features:
 * - List all teacher invoices with filtering (month, teacher, status, currency)
 * - Generate monthly invoices (manual trigger)
 * - Publish invoices (draft → published)
 * - Mark invoices as paid
 * - Add bonuses and extras
 * - View detailed invoice breakdown
 * - Export to PDF/Excel
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { useAuth } from '../../../contexts/AuthContext';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { formatDateDDMMMYYYY } from '../../../utils/date';
import TeacherInvoiceDetailModal from '../../../components/teacherSalary/TeacherInvoiceDetailModal';
import PublishInvoiceDialog from '../../../components/teacherSalary/PublishInvoiceDialog';
import MarkPaidDialog from '../../../components/teacherSalary/MarkPaidDialog';
import AddBonusDialog from '../../../components/teacherSalary/AddBonusDialog';
import AddExtraDialog from '../../../components/teacherSalary/AddExtraDialog';
import {
  FileText,
  DollarSign,
  Users,
  Calendar,
  Eye,
  Check,
  X,
  Plus,
  Gift,
  Trash2,
  RefreshCw,
  Filter,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Settings
} from 'lucide-react';

const TeacherInvoices = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const previousMonthInfo = useMemo(() => {
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = previousMonth.getMonth() + 1;
    const year = previousMonth.getFullYear();
    const label = previousMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    return { month, year, label };
  }, []);

  // Redirect if not admin
  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
    }
  }, [isAdmin, navigate]);

  // State management
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Auto-generation prerequisites (for the previous month)
  const [autoGenChecks, setAutoGenChecks] = useState({
    loading: true,
    autoGenerateInvoicesEnabled: null,
    previousMonthRateExists: null
  });

  // Filter state
  const [filters, setFilters] = useState({
    month: '', // Format: YYYY-MM
    teacherId: '',
    status: '', // draft, published, paid, archived (and backend supports 'unpaid')
    currency: '', // EGP, USD
    search: '' // Teacher name search
  });

  // Quick tabs for status
  const [statusTab, setStatusTab] = useState('unpaid'); // unpaid | paid

  // Pagination state
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalInvoices, setTotalInvoices] = useState(0);
  const limit = 20;

  // Sort state
  const [sortBy, setSortBy] = useState('invoiceMonth');
  const [sortOrder, setSortOrder] = useState('desc');

  // Modal state
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showMarkPaidDialog, setShowMarkPaidDialog] = useState(false);
  const [showAddBonusDialog, setShowAddBonusDialog] = useState(false);
  const [showAddExtraDialog, setShowAddExtraDialog] = useState(false);

  // Deletion state
  const [deletingInvoiceId, setDeletingInvoiceId] = useState(null);

  // Teachers list for filter dropdown
  const [teachers, setTeachers] = useState([]);

  // Fetch teachers for filter dropdown
  useEffect(() => {
    const fetchTeachers = async () => {
      try {
        const response = await api.get('/users', {
          params: { role: 'teacher', isActive: true }
        });
        setTeachers(response.data.users || []);
      } catch (err) {
        console.error('Error fetching teachers:', err);
      }
    };
    fetchTeachers();
  }, []);

  // Auto-run requirements banner helper: auto-generate enabled + exchange rate exists for previous month
  useEffect(() => {
    if (!isAdmin) return;

    let mounted = true;
    const run = async () => {
      try {
        setAutoGenChecks({ loading: true, autoGenerateInvoicesEnabled: null, previousMonthRateExists: null });

        const [settingsRes, ratesRes] = await Promise.all([
          api.get('/teacher-salary/admin/settings'),
          api.get('/teacher-salary/admin/exchange-rates', { params: { year: previousMonthInfo.year } })
        ]);

        const autoGenerateInvoicesEnabled = Boolean(settingsRes.data?.settings?.autoGenerateInvoices);
        const rates = Array.isArray(ratesRes.data?.rates) ? ratesRes.data.rates : [];
        const previousMonthRateExists = rates.some(
          (r) => Number(r?.month) === previousMonthInfo.month && Number(r?.year) === previousMonthInfo.year
        );

        if (!mounted) return;
        setAutoGenChecks({
          loading: false,
          autoGenerateInvoicesEnabled,
          previousMonthRateExists
        });
      } catch (err) {
        console.warn('[TeacherInvoices] Auto-generation checks failed:', err);
        if (!mounted) return;
        setAutoGenChecks({ loading: false, autoGenerateInvoicesEnabled: null, previousMonthRateExists: null });
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [isAdmin, previousMonthInfo.month, previousMonthInfo.year]);

  // Fetch invoices
  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const params = {
        page,
        limit,
        sortBy,
        sortOrder,
        ...filters
      };

      // Remove empty filters
      Object.keys(params).forEach(key => {
        if (params[key] === '') delete params[key];
      });

      const response = await api.get('/teacher-salary/admin/invoices', { params });

      setInvoices(response.data.invoices || []);
      setTotalPages(response.data.pagination?.totalPages || response.data.pagination?.pages || 1);
      setTotalInvoices(response.data.pagination?.total || 0);
      setPage(response.data.pagination?.page || 1);
    } catch (err) {
      console.error('Error fetching invoices:', err);
      setError(err.response?.data?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, limit, sortBy, sortOrder, filters]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  // Keep filters.status in sync with the tab (without breaking manual filter override intent)
  useEffect(() => {
    setFilters(prev => ({
      ...prev,
      status: statusTab === 'paid' ? 'paid' : 'unpaid'
    }));
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusTab]);

  // Generate monthly invoices
  const handleGenerateInvoices = async () => {
    // Calculate previous month
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = previousMonth.getMonth() + 1; // JavaScript months are 0-indexed
    const year = previousMonth.getFullYear();
    
    const monthName = previousMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    if (!window.confirm(`Generate invoices for all teachers for ${monthName}?`)) {
      return;
    }

    try {
      setGenerating(true);
      setError(null);

      const response = await api.post('/teacher-salary/admin/generate', {
        month,
        year
      });

      const created = response.data.results?.summary?.created || 0;
      const adjusted = response.data.results?.summary?.adjusted || 0;
      const adjustmentsCreated = response.data.results?.summary?.adjustmentsCreated || 0;
      const skipped = response.data.results?.summary?.skipped || 0;
      const failed = response.data.results?.summary?.failed || 0;
      
      setSuccessMessage(
        `✓ Created ${created} new invoice${created !== 1 ? 's' : ''} for ${monthName}. ` +
        (adjusted ? `✓ Adjusted ${adjusted}. ` : '') +
        (adjustmentsCreated ? `✓ Created ${adjustmentsCreated} adjustment invoice${adjustmentsCreated !== 1 ? 's' : ''}. ` : '') +
        (skipped ? `${skipped} skipped. ` : '') +
        (failed ? `⚠ ${failed} failed.` : '')
      );

      // Refresh invoice list
      fetchInvoices();

      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Error generating invoices:', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to generate invoices');
    } finally {
      setGenerating(false);
    }
  };

  // Handle sort change
  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  // Handle filter change
  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  // Clear all filters
  const handleClearFilters = () => {
    setFilters({
      month: '',
      teacherId: '',
      status: '',
      currency: '',
      search: ''
    });
    setPage(1);
  };

  // Format currency
  const formatCurrency = (amount, currency = 'EGP') => {
    const value = Number(amount) || 0;
    if (currency === 'USD') {
      return `$${value.toFixed(2)}`;
    }
    return `${value.toFixed(2)} EGP`;
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

  // Get status icon
  const getStatusIcon = (status) => {
    switch (status) {
      case 'draft':
        return <FileText className="w-3 h-3" />;
      case 'published':
        return <Eye className="w-3 h-3" />;
      case 'paid':
        return <Check className="w-3 h-3" />;
      case 'archived':
        return <X className="w-3 h-3" />;
      default:
        return <FileText className="w-3 h-3" />;
    }
  };

  // Open detail modal
  const handleViewDetails = (invoice) => {
    setSelectedInvoice(invoice);
    setShowDetailModal(true);
  };

  // Open publish dialog
  const handlePublish = (invoice) => {
    setSelectedInvoice(invoice);
    setShowPublishDialog(true);
  };

  // Open mark paid dialog
  const handleMarkPaid = (invoice) => {
    setSelectedInvoice(invoice);
    setShowMarkPaidDialog(true);
  };

  // Open add bonus dialog
  const handleAddBonus = (invoice) => {
    setSelectedInvoice(invoice);
    setShowAddBonusDialog(true);
  };

  // Open add extra dialog
  const handleAddExtra = (invoice) => {
    setSelectedInvoice(invoice);
    setShowAddExtraDialog(true);
  };

  // Delete draft invoice
  const handleDeleteInvoice = async (invoice) => {
    if (!invoice?._id) return;

    if (!(invoice.status === 'draft' || invoice.status === 'published')) {
      setError('Only unpaid (draft/published) invoices can be deleted');
      return;
    }

    const confirmed = window.confirm(
      `Delete invoice ${invoice.invoiceNumber || ''}?\n\nThis will unmark its linked classes so they can be invoiced again. This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setDeletingInvoiceId(invoice._id);
      setError(null);
      await api.delete(`/teacher-salary/admin/invoices/${invoice._id}`);

      setSuccessMessage(`✓ Invoice ${invoice.invoiceNumber} deleted`);
      fetchInvoices();
      setTimeout(() => setSuccessMessage(null), 5000);

      if (selectedInvoice?._id === invoice._id) {
        setShowDetailModal(false);
        setSelectedInvoice(null);
      }
    } catch (err) {
      console.error('Error deleting invoice:', err);
      setError(err.response?.data?.message || 'Failed to delete invoice');
    } finally {
      setDeletingInvoiceId(null);
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

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Teacher Salary Invoices</h1>
              <p className="text-gray-600 mt-1">Manage teacher salary invoices and payments</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate('/admin/salary-settings')}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56]"
              >
                <Settings className="w-4 h-4" />
                Settings
              </button>
              <button
                onClick={handleGenerateInvoices}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    Generate Invoices
                  </>
                )}
              </button>
            </div>

            {/* Admin instructions */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <p className="font-medium mb-1">What each action does</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li><span className="font-medium">Generate</span>: creates/updates unpaid invoices for the selected month and links classes by setting <span className="font-mono">Class.billedInTeacherInvoiceId</span>.</li>
                    <li><span className="font-medium">Publish</span>: sets <span className="font-mono">TeacherInvoice.status</span> to <span className="font-mono">published</span> (teacher can view/export). Classes stay linked.</li>
                    <li><span className="font-medium">Mark paid</span>: sets <span className="font-mono">status=paid</span> and stores payment details (method/proof/notes). Paid invoices are treated as closed.</li>
                    <li><span className="font-medium">Bonus / Extra</span>: updates invoice totals (bonus/extras snapshots) only — does not change class links.</li>
                    <li><span className="font-medium">Delete (draft/published)</span>: soft-deletes the invoice (<span className="font-mono">deleted=true</span>) and clears its class links so hours become unbilled again.</li>
                    <li><span className="font-medium">Late reports</span>: if a paid month gets new eligible classes later, the system creates an <span className="font-mono">adjustment invoice</span> instead of reopening the paid one.</li>
                  </ul>
                  <p className="mt-2 text-blue-800">
                    Auto-run: on the <span className="font-medium">1st of each month</span>, the system generates invoices for the <span className="font-medium">previous month</span> for all <span className="font-medium">active teachers</span> (requires <span className="font-medium">Auto-generate</span> enabled and that month’s exchange rate is set in Settings).
                  </p>
                </div>
              </div>
            </div>

            {/* Auto-run warning banner (previous month prerequisites) */}
            {!autoGenChecks.loading && (
              (autoGenChecks.autoGenerateInvoicesEnabled === false || autoGenChecks.previousMonthRateExists === false)
            ) && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium">Auto-generation may not run for {previousMonthInfo.label}</p>
                    <ul className="mt-1 list-disc list-inside space-y-1">
                      {autoGenChecks.autoGenerateInvoicesEnabled === false && (
                        <li>
                          Auto-generate invoices is <span className="font-medium">disabled</span> in Settings.
                        </li>
                      )}
                      {autoGenChecks.previousMonthRateExists === false && (
                        <li>
                          Missing exchange rate for <span className="font-medium">{previousMonthInfo.label}</span> (set it in Settings → Exchange Rates).
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Statistics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Total Invoices</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 rounded-lg">
                  <FileText className="w-6 h-6 text-gray-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Draft</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.draft}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Eye className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Published</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.published}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Check className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-600">Paid</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.paid}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Success/Error Messages */}
          {successMessage && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-green-800">
              <Check className="w-5 h-5" />
              {successMessage}
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-red-800">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow mb-6 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
          </div>

          {/* Tabs: Unpaid vs Paid */}
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStatusTab('unpaid')}
              className={
                statusTab === 'unpaid'
                  ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200'
              }
            >
              Unpaid
            </button>
            <button
              type="button"
              onClick={() => setStatusTab('paid')}
              className={
                statusTab === 'paid'
                  ? 'rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200'
              }
            >
              Paid
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Month Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Month
              </label>
              <input
                type="month"
                value={filters.month}
                onChange={(e) => handleFilterChange('month', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent"
              />
            </div>

            {/* Teacher Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Teacher
              </label>
              <select
                value={filters.teacherId}
                onChange={(e) => handleFilterChange('teacherId', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent"
              >
                <option value="">All Teachers</option>
                {teachers.map(teacher => (
                  <option key={teacher._id} value={teacher._id}>
                    {teacher.firstName} {teacher.lastName}
                  </option>
                ))}
              </select>
            </div>

            {/* Currency Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Currency
              </label>
              <select
                value={filters.currency}
                onChange={(e) => handleFilterChange('currency', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent"
              >
                <option value="">All Currencies</option>
                <option value="EGP">EGP</option>
                <option value="USD">USD</option>
              </select>
            </div>

            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search Teacher
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => handleFilterChange('search', e.target.value)}
                  placeholder="Teacher name..."
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {/* Clear Filters Button */}
          {Object.values(filters).some(v => v !== '') && (
            <button
              onClick={handleClearFilters}
              className="mt-4 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
            >
              Clear all filters
            </button>
          )}
        </div>

        {/* Invoices Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No invoices found</p>
              <p className="text-sm text-gray-500 mt-1">
                {Object.values(filters).some(v => v !== '')
                  ? 'Try adjusting your filters'
                  : 'Generate invoices to get started'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th
                        onClick={() => handleSort('invoiceNumber')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-1">
                          Invoice #
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('teacher')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-1">
                          Teacher
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('invoiceMonth')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-1">
                          Month
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Hours
                      </th>
                      <th
                        onClick={() => handleSort('finalTotal')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-1">
                          Amount
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th
                        onClick={() => handleSort('status')}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                      >
                        <div className="flex items-center gap-1">
                          Status
                          <ArrowUpDown className="w-3 h-3" />
                        </div>
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {invoices.map((invoice) => (
                      <tr key={invoice._id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {invoice.invoiceNumber}
                          </div>
                          <div className="text-xs text-gray-500">
                            {formatDateDDMMMYYYY(invoice.createdAt)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                              <Users className="w-4 h-4 text-blue-600" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {invoice.teacher?.firstName} {invoice.teacher?.lastName}
                              </div>
                              <div className="text-xs text-gray-500">
                                {invoice.teacher?.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-900">
                              {formatDateDDMMMYYYY(invoice.invoiceMonth)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {invoice.totalHours?.toFixed(2) || '0.00'} hrs
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-900">
                            {formatCurrency(invoice.finalTotal, invoice.currency)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(invoice.status)}`}>
                            {getStatusIcon(invoice.status)}
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleViewDetails(invoice)}
                              className="inline-flex items-center justify-center rounded-md p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400"
                              title="View Details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            
                            {invoice.status === 'draft' && (
                              <button
                                onClick={() => handlePublish(invoice)}
                                className="inline-flex items-center justify-center rounded-md bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                                title="Publish Invoice"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            )}

                            {(invoice.status === 'draft' || invoice.status === 'published') && (
                              <button
                                onClick={() => handleDeleteInvoice(invoice)}
                                disabled={deletingInvoiceId === invoice._id}
                                className="inline-flex items-center justify-center rounded-md bg-red-50 p-2 text-red-600 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Delete Invoice"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            
                            {invoice.status === 'published' && (
                              <button
                                onClick={() => handleMarkPaid(invoice)}
                                className="inline-flex items-center justify-center rounded-md bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500"
                                title="Mark as Paid"
                              >
                                <DollarSign className="w-4 h-4" />
                              </button>
                            )}
                            
                            {(invoice.status === 'draft' || invoice.status === 'published') && (
                              <>
                                <button
                                  onClick={() => handleAddBonus(invoice)}
                                  className="inline-flex items-center justify-center rounded-md bg-amber-50 p-2 text-amber-600 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
                                  title="Add Bonus"
                                >
                                  <Gift className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleAddExtra(invoice)}
                                  className="inline-flex items-center justify-center rounded-md bg-sky-50 p-2 text-sky-600 hover:bg-sky-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500"
                                  title="Add Extra"
                                >
                                  <Plus className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

      {/* Modals */}
      {showDetailModal && selectedInvoice && (
        <TeacherInvoiceDetailModal
          invoiceId={selectedInvoice._id}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedInvoice(null);
          }}
          onUpdate={() => {
            fetchInvoices();
          }}
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
    </div>
  );
};

export default TeacherInvoices;
