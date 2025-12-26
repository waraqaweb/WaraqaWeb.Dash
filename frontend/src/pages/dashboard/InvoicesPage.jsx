import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import {
  Search,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Calendar,
  CreditCard,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Send,
  Eye,
  Plus,
  RefreshCw,
  FileText,
  Users,
  TrendingUp,
  Mail,
  MessageCircle,
  DownloadCloud,
  BadgeCheck,
  TimerReset,
  Link2,
  Trash2
} from 'lucide-react';

import LoadingSpinner from '../../components/ui/LoadingSpinner';
import PrimaryButton from '../../components/ui/PrimaryButton';
import Badge from '../../components/ui/Badge';
import InvoiceViewModal from '../../components/invoices/InvoiceViewModal';
import RecordPaymentModal from '../../components/invoices/RecordPaymentModal';
import RefundInvoiceModal from '../../components/invoices/RefundInvoiceModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import Toast from '../../components/ui/Toast';
import { computeInvoiceTotals } from '../../utils/invoiceTotals';

const getInvoicePaymentTimestamp = (invoice) => {
  if (!invoice) return 0;
  const paidSource = invoice.paidAt || invoice.paymentDate || (invoice.payment && invoice.payment.date) || invoice.updatedAt;
  const fallback = invoice.createdAt;
  return new Date(paidSource || fallback).getTime();
};

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const InvoicesPage = () => {
  const { isAdmin, isGuardian, socket } = useAuth();
  const { searchTerm, globalFilter } = useSearch();
  const location = useLocation();
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expandedInvoice, setExpandedInvoice] = useState(null);
  const [currentPage, setCurrentPage] = useState(Number(new URLSearchParams(location.search).get('page') || '1'));
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState(null);
  const [checkingZeroHours, setCheckingZeroHours] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ open: false, action: null, invoiceId: null, title: '', message: '', confirmText: 'Confirm', danger: false });
  const [guardianStudentsMap, setGuardianStudentsMap] = useState({});
  // Default to showing unpaid invoices first per new UX
  const [activeTab, setActiveTab] = useState('unpaid');
  const [modalState, setModalState] = useState({ type: null, invoiceId: null, invoiceSlug: null });
  // FAB open/close state
  const [fabOpen, setFabOpen] = useState(false);
  const fabRef = React.useRef(null);

  // Close invoices FAB when clicking/touching outside
  useEffect(() => {
    if (!fabOpen) return;
    const handleOutside = (ev) => {
      try {
        if (!fabRef.current) return;
        if (!fabRef.current.contains(ev.target)) {
          setFabOpen(false);
        }
      } catch (e) {
        // ignore
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [fabOpen]);
  const [deliveryLoading, setDeliveryLoading] = useState({});
  const [downloadingDocId, setDownloadingDocId] = useState(null);
  const [copiedInvoiceId, setCopiedInvoiceId] = useState(null);
  const [toast, setToast] = useState({ show: false, type: '', message: '' });

  const derivedFilters = useMemo(() => {
    if (!globalFilter || globalFilter === 'all') {
      return { status: 'all', type: 'all', segment: 'all' };
    }

    if (globalFilter.startsWith('status:')) {
      return { status: globalFilter.slice(7), type: 'all', segment: 'all' };
    }

    if (globalFilter.startsWith('type:')) {
      return { status: 'all', type: globalFilter.slice(5), segment: 'all' };
    }

    if (globalFilter.startsWith('segment:')) {
      return { status: 'all', type: 'all', segment: globalFilter.slice(8) };
    }

    return { status: 'all', type: 'all', segment: 'all' };
  }, [globalFilter]);

  const statusFilter = derivedFilters.status;
  const typeFilter = derivedFilters.type;
  const segmentFilter = derivedFilters.segment;

  const itemsPerPage = 10;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      if (debouncedSearch) params.set('q', debouncedSearch); else params.delete('q');
      params.set('page', String(currentPage));
      const newSearch = params.toString();
      const newUrl = `${location.pathname}${newSearch ? `?${newSearch}` : ''}`;
      if (newUrl !== window.location.pathname + window.location.search) {
        try {
          const existingParams = new URLSearchParams(window.location.search);
          const prevPage = Number(existingParams.get('page') || '1');
          // If the page changed from the previous url, push a new history entry
          if (prevPage !== Number(currentPage)) {
            window.history.pushState({}, '', newUrl);
          } else {
            // otherwise replace the current state (search/sort changes, etc.)
            window.history.replaceState({}, '', newUrl);
          }
        } catch (err) {
          // fallback to replace
          window.history.replaceState({}, '', newUrl);
        }
      }
    } catch (err) {
      console.warn('URL sync failed', err);
    }

    fetchInvoices();
    if (isAdmin()) fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter, typeFilter, segmentFilter, currentPage, activeTab, showDeleted]);

  const fetchInvoices = async () => {
    try {
      setLoading(true);
      const params = {
        page: currentPage,
        limit: itemsPerPage,
        search: debouncedSearch
      };

      if (showDeleted && isAdmin()) {
        params.deleted = true;
      }

      // Active tab controls the primary status filter and desired ordering.
      // - Unpaid tab: show oldest created invoices first (createdAt asc)
      // - Paid tab: show latest paid invoices first (paidAt desc)
      // - All tab (or none): show invoices by latest payment (paidAt desc, fallback createdAt)
      if (activeTab && activeTab !== 'all') {
        params.status = activeTab;
        if (activeTab === 'unpaid') {
          params.sortBy = 'createdAt';
          params.order = 'asc';
        } else {
          params.sortBy = 'paidAt';
          params.order = 'desc';
        }
      } else if (statusFilter !== 'all') {
        params.status = statusFilter;
        if (statusFilter === 'unpaid') {
          params.sortBy = 'createdAt';
          params.order = 'asc';
        } else {
          params.sortBy = 'paidAt';
          params.order = 'desc';
        }
      } else {
        // Default for the 'all' tab: latest payment first
        params.sortBy = 'paidAt';
        params.order = 'desc';
      }

      if (typeFilter !== 'all') params.type = typeFilter;
      if (segmentFilter !== 'all') params.segment = segmentFilter;

      const { data } = await api.get('/invoices', { params });
      const invoiceList = data.invoices || [];
      setInvoices(invoiceList);
      setTotalPages(data.pagination?.pages || 1);

      const guardianIds = [...new Set(invoiceList.map(inv => inv.guardian?._id).filter(Boolean))];
      if (guardianIds.length > 0) {
        try {
          const response = await api.post('/users/students/batch', { guardianIds });
          setGuardianStudentsMap(response.data?.map || {});
        } catch (err) {
          console.error('Failed to fetch guardian students batch', err);
          setGuardianStudentsMap({});
        }
      } else {
        setGuardianStudentsMap({});
      }
    } catch (err) {
      console.error(err);
      setError('Failed to fetch invoices');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const { data } = await api.get('/invoices/stats/overview');
      setStats(data.stats);
    } catch (err) {
      console.error('Failed fetching invoice stats', err);
    }
  };

  const handleCheckZeroHours = async () => {
    try {
      setCheckingZeroHours(true);
      const { data } = await api.post('/invoices/check-zero-hours');

      if (data.success) {
        if (data.invoicesCreated > 0) {
          alert(`Successfully created ${data.invoicesCreated} new zero-hour invoices.`);
          fetchInvoices();
          if (isAdmin()) fetchStats();
        } else {
          alert('No guardians or students with zero hours found.');
        }
      } else {
        setError(data.error || 'Failed to check zero hours');
      }
    } catch (err) {
      setError('Failed to check zero hours');
      console.error('Check zero hours error:', err);
    } finally {
      setCheckingZeroHours(false);
    }
  };

  const handleDeleteInvoice = async (invoice) => {
    const statusLabel = invoice?.status === 'pending' ? 'pending' : 'draft';
    setConfirmModal({
      open: true,
      action: 'delete',
      invoiceId: invoice?._id,
      title: `Delete ${statusLabel} invoice`,
      message: `Delete this ${statusLabel} invoice? You can restore it later.`,
      confirmText: 'Delete',
      danger: true
    });
  };

  const handleCancelInvoice = async (invoiceId) => {
    setConfirmModal({
      open: true,
      action: 'cancel',
      invoiceId,
      title: 'Cancel invoice',
      message: 'Cancel this invoice? It will no longer be valid.',
      confirmText: 'Cancel invoice',
      danger: true
    });
  };

  const performDeleteInvoice = async (invoiceId) => {
    try {
      const { data } = await api.delete(`/invoices/${invoiceId}`);
      if (data.success) {
        alert('Invoice deleted');
        fetchInvoices();
        if (isAdmin()) fetchStats();
      } else {
        alert(data.error || 'Delete failed');
      }
    } catch (err) {
      console.error('Delete invoice error:', err);
      alert('Delete failed');
    }
  };

  const performCancelInvoice = async (invoiceId) => {
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/cancel`);
      if (data.success) {
        alert('Invoice cancelled');
        fetchInvoices();
        if (isAdmin()) fetchStats();
      } else {
        alert(data.error || 'Failed to cancel invoice');
      }
    } catch (err) {
      console.error('Cancel invoice error:', err);
      alert('Cancel failed');
    }
  };

  const performRestoreInvoice = async (invoiceId) => {
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/restore`);
      if (data.success) {
        alert('Invoice restored');
        fetchInvoices();
        if (isAdmin()) fetchStats();
      } else {
        alert(data.error || 'Restore failed');
      }
    } catch (err) {
      console.error('Restore invoice error:', err);
      alert('Restore failed');
    }
  };

  const performPermanentDeleteInvoice = async (invoiceId) => {
    try {
      const { data } = await api.delete(`/invoices/${invoiceId}/permanent`);
      if (data.success) {
        alert('Invoice deleted permanently');
        // Remove from local state completely
        setInvoices((prev) => prev.filter((i) => i._id !== invoiceId));
        if (isAdmin()) fetchStats();
      } else {
        alert(data.error || 'Delete failed');
      }
    } catch (err) {
      console.error('Permanent delete invoice error:', err);
      alert('Delete failed');
    }
  };

  const toggleExpanded = (invoiceId) => {
    setExpandedInvoice((prev) => (prev === invoiceId ? null : invoiceId));
  };

  const openModal = (type, invoice) => {
    const invoiceObject = invoice && typeof invoice === 'object' ? invoice : null;
    const invoiceId = invoiceObject?._id || (typeof invoice === 'string' ? invoice : null);
    const invoiceSlug = invoiceObject?.invoiceSlug || null;
    
    // Track when the modal was opened so we can ignore very-quick close/open
    // cycles that are typically caused by parent re-renders.
    try {
      modalOpenedAtRef.current = Date.now();
    } catch (e) {
      // no-op if ref isn't available yet
    }
    setModalState({ type, invoiceId, invoiceSlug });

    try {
      const params = new URLSearchParams(location.search);
      params.set('modal', type);
      if (invoiceId) params.set('invoice', invoiceId); else params.delete('invoice');
      if (invoiceSlug) params.set('invoiceSlug', invoiceSlug); else params.delete('invoiceSlug');
      const nextSearch = params.toString();
      const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
      const nextState = { ...(location.state || {}), invoicesModal: true, modalType: type, invoiceId, invoiceSlug };
      navigate(nextUrl, { state: nextState, replace: false });
    } catch (err) {
      console.warn('Failed to sync modal route state', err);
    }
  };
  // Allow callers to force-close by passing the second parameter `force`.
  // Guard against very-quick close calls that likely originate from parent
  // re-renders (debounce window in ms).
  const modalOpenedAtRef = React.useRef(0);
  const CLOSE_DEBOUNCE_MS = 300;

  const closeModal = (refresh = false, force = false) => {
    
    const sinceOpen = Date.now() - (modalOpenedAtRef.current || 0);
    if (!force && sinceOpen < CLOSE_DEBOUNCE_MS) {
      
      return;
    }

    // Always clear the modal state first
    setModalState({ type: null, invoiceId: null, invoiceSlug: null });

    const params = new URLSearchParams(location.search);
    const hadModalParams = params.has('modal') || params.has('invoice') || params.has('invoiceSlug');
    const shouldGoBack = !force && Boolean(location.state && location.state.invoicesModal);

    params.delete('modal');
    params.delete('invoice');
    params.delete('invoiceSlug');
    const nextSearch = params.toString();
    const baseState = { ...(location.state || {}) };
    delete baseState.invoicesModal;
    delete baseState.modalType;
    delete baseState.invoiceId;
    delete baseState.invoiceSlug;

    if (shouldGoBack) {
      navigate(-1);
    } else if (hadModalParams) {
      navigate(`${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`, { replace: true, state: baseState });
    }

    if (refresh) {
      fetchInvoices();
      if (isAdmin()) fetchStats();
    }
  };

  // Keep modal state in sync with query parameters so deep links and browser navigation work naturally
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search);
      const modal = params.get('modal');
      const invoice = params.get('invoice');
      const invoiceSlug = params.get('invoiceSlug');

      if (!modal) {
        setModalState((prev) => (prev.type ? { type: null, invoiceId: null, invoiceSlug: null } : prev));
        return;
      }

      setModalState((prev) => {
        if (prev.type === modal && prev.invoiceId === invoice && prev.invoiceSlug === invoiceSlug) {
          return prev;
        }
        return { type: modal, invoiceId: invoice, invoiceSlug };
      });
    } catch (err) {
      console.warn('Failed to sync modal from URL search params', err);
    }
  }, [location.search]);

  const handleQuickSend = async (invoiceId, method, force = false) => {
    const key = `${invoiceId}-${method}`;
    setDeliveryLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/send`, {
        method,
        force
      });
      if (!data.success && !data.alreadySent) {
        alert(data.error || `Send failed (${method})`);
      }
      fetchInvoices();
      if (isAdmin()) fetchStats();
    } catch (err) {
      console.error('Send invoice error:', err);
      alert(`Send failed (${method})`);
    } finally {
      setDeliveryLoading((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  // Realtime: subscribe to invoice socket events to reflect changes instantly
  useEffect(() => {
    if (!socket) return;

    // Comparator consistent with list ordering rules used elsewhere:
    // unpaid -> createdAt asc (oldest first)
    // other views -> paidAt desc (latest payment first, fallback createdAt)
    const invoiceComparator = (a, b) => {
      try {
        if (activeTab === 'unpaid') {
          return new Date(a.createdAt) - new Date(b.createdAt);
        }
        return getInvoicePaymentTimestamp(b) - getInvoicePaymentTimestamp(a);
      } catch (err) {
        return 0;
      }
    };

    const matchesActiveTab = (inv) => {
      if (!inv) return false;
      if (activeTab === 'paid') return ['paid', 'refunded'].includes(inv.status);
      if (activeTab === 'unpaid') return !['paid', 'refunded'].includes(inv.status);
      return true;
    };

    const upsertInvoice = (updated) => {
      if (!updated || !updated._id) return;

      setInvoices((prev) => {
        const existingIdx = prev.findIndex((i) => i._id === updated._id);

        // If update no longer matches current tab, remove it if present
        const doesMatch = matchesActiveTab(updated);
        if (existingIdx !== -1 && !doesMatch) {
          const next = prev.slice();
          next.splice(existingIdx, 1);
          return next;
        }

        // If exists, replace and re-position according to comparator
        if (existingIdx !== -1) {
          const next = prev.slice();
          next[existingIdx] = { ...next[existingIdx], ...updated };
          // Re-sort to ensure correct order
          next.sort(invoiceComparator);
          return next;
        }

        // Not found: only insert if it matches current active tab
        if (!doesMatch) return prev;

        // Insert in sorted position
        const next = prev.slice();
        let inserted = false;
        for (let i = 0; i < next.length; i++) {
          const cmp = invoiceComparator(updated, next[i]);
          if (cmp < 0) {
            next.splice(i, 0, updated);
            inserted = true;
            break;
          }
        }
        if (!inserted) next.push(updated);
        return next;
      });
    };

    const onCreated = (payload) => {
      try { upsertInvoice(payload?.invoice); } catch (_) {}
    };
    const onUpdated = (payload) => {
      try { upsertInvoice(payload?.invoice); } catch (_) {}
    };
    const onPaid = (payload) => {
      try { upsertInvoice(payload?.invoice); } catch (_) {}
    };
    const onPartiallyPaid = (payload) => {
      try { upsertInvoice(payload?.invoice); } catch (_) {}
    };
    const onRefunded = (payload) => {
      try { upsertInvoice(payload?.invoice); } catch (_) {}
    };
    const onDeleted = (payload) => {
      const id = payload?.id || payload?.invoice?._id;
      if (!id) return;
      setInvoices((prev) => prev.map((i) => (i._id === id ? { ...i, deleted: true } : i)));
    };
    const onRestored = (payload) => {
      const id = payload?.id || payload?.invoice?._id;
      if (!id) return;
      setInvoices((prev) => prev.map((i) => (i._id === id ? { ...i, deleted: false } : i)));
    };
    const onPermanentlyDeleted = (payload) => {
      const id = payload?.id || payload?.invoice?._id;
      if (!id) return;
      // Remove completely from state
      setInvoices((prev) => prev.filter((i) => i._id !== id));
    };

    socket.on('invoice:created', onCreated);
    socket.on('invoice:updated', onUpdated);
    socket.on('invoice:paid', onPaid);
    socket.on('invoice:partially_paid', onPartiallyPaid);
    socket.on('invoice:refunded', onRefunded);
    socket.on('invoice:deleted', onDeleted);
    socket.on('invoice:restored', onRestored);
    socket.on('invoice:permanentlyDeleted', onPermanentlyDeleted);

    return () => {
      try {
        socket.off('invoice:created', onCreated);
        socket.off('invoice:updated', onUpdated);
        socket.off('invoice:paid', onPaid);
        socket.off('invoice:partially_paid', onPartiallyPaid);
        socket.off('invoice:refunded', onRefunded);
        socket.off('invoice:deleted', onDeleted);
        socket.off('invoice:restored', onRestored);
        socket.off('invoice:permanentlyDeleted', onPermanentlyDeleted);
      } catch (_) {}
    };
  }, [socket, activeTab]);

  const handleDownloadDocx = async (invoiceId, invoiceNumber) => {
    try {
      setDownloadingDocId(invoiceId);
      const { data } = await api.get(`/invoices/${invoiceId}/download-docx`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `invoice-${invoiceNumber || invoiceId}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download docx error:', err);
      alert('Download failed');
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleCopyShareLink = async (invoice) => {
    if (!invoice?.invoiceSlug) {
      alert('Open the invoice to generate its link.');
      return;
    }

    const shareUrl = `${window.location.origin}/public/invoices/${invoice.invoiceSlug}`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedInvoiceId(invoice._id);
        setTimeout(() => setCopiedInvoiceId(null), 2000);
      } else {
        const manualCopy = window.prompt('Copy this invoice link:', shareUrl);
        if (manualCopy !== null) {
          setCopiedInvoiceId(invoice._id);
          setTimeout(() => setCopiedInvoiceId(null), 2000);
        }
      }
    } catch (err) {
      console.error('Failed to copy share link', err);
      alert(`Copy failed. Please copy the link manually:\n${shareUrl}`);
    }
  };

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount || 0));
  const formatDate = useCallback((dateString) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return '—';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mon = MONTHS_SHORT[d.getUTCMonth()];
    const yr = d.getUTCFullYear();
    return `${day} ${mon} ${yr}`;
  }, []);

  // Human-readable invoice id, e.g., INV-2025-11-001 (parsed from invoice number/name)
  const getReadableInvoiceId = (invoice) => {
    const sys = invoice?.invoiceNumber || invoice?.invoiceName || '';
    let year = null, month = null, seq = null;
    const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12' };
    const tokens = sys.split(/[-_\s]+/).map(t => t.trim());
    for (const t of tokens) {
      const low = t.toLowerCase();
      if (!year && /^20\d{2}$/.test(t)) year = t;
      if (!month && monthMap[low]) month = monthMap[low];
      if (!seq && /\d{3,}$/.test(t)) seq = t.replace(/^0+/, '');
    }
    if (!month) {
      const m = sys.match(/(20\d{2})[-/]?(\d{1,2})/);
      if (m) { year = year || m[1]; month = String(m[2]).padStart(2, '0'); }
    }
    if (!seq) {
      const q = sys.match(/(\d{3,})$/);
      if (q) seq = q[1].replace(/^0+/, '');
    }
    const created = new Date(invoice?.createdAt || Date.now());
    year = year || String(created.getUTCFullYear());
    month = month || String(created.getUTCMonth() + 1).padStart(2, '0');
    const seq3 = String(Number(seq || 1)).padStart(3, '0');
    return `INV-${year}-${month}-${seq3}`;
  };

  const getInitials = (first, last) => {
    const a = (first || '').trim()[0] || '';
    const b = (last || '').trim()[0] || '';
    return (a + b).toUpperCase() || 'G';
  };

  // Inline billing window computed from classes with the same accuracy as the modal
  const BillingWindowInline = React.useMemo(() => {
    return function BillingWindowInline({ invoice, bare = false }) {
      const [windowDates, setWindowDates] = React.useState({ start: null, end: null, loading: true });

      React.useEffect(() => {
        let cancelled = false;
        const run = async () => {
          try {
            if (!invoice) return;

            // Match modal logic exactly: compute studentId, from, to
            const studentId = typeof invoice?.student === 'string'
              ? invoice.student
              : (invoice?.student?._id || '');

            // Do not use invoice.lastInvoiceDate as a start date - it may represent the previous invoice end.
            // Prefer explicit billingPeriod start or the invoice creation date as a safe fallback.
            const from = invoice?.billingPeriod?.startDate
              || invoice?.billingPeriod?.start
              || invoice?.billingPeriod?.start_date
              || invoice?.startDate
              || invoice?.createdAt
              || '';

            // Determine max hours cap from coverage first (affects "to" behavior)
            const hasMax = typeof invoice?.coverage?.maxHours === 'number' && Number.isFinite(invoice.coverage.maxHours) && invoice.coverage.maxHours > 0;
            const maxMinutes = hasMax ? Math.round(Number(invoice.coverage.maxHours) * 60) : null;

            // In the modal, when maxHours is set, customEndDate is cleared -> we should not bound by invoice end/due dates.
            // Only use an explicit end when a coverage endDate exists AND no max-hours cap is active.
            const to = hasMax
              ? ''
              : (
                  invoice?.coverage?.endDate
                  || invoice?.endDate
                  || invoice?.billingPeriod?.endDate
                  || invoice?.billingPeriod?.end
                  || invoice?.billingPeriod?.end_date
                  || ''
                );

            // Fallbacks from invoice items or provided dates
            const itemDates = Array.isArray(invoice?.items)
              ? invoice.items
                  .map((it) => (it && (it.date || it.scheduledDate) ? new Date(it.date || it.scheduledDate) : null))
                  .filter((d) => d && !Number.isNaN(d.getTime()))
              : [];

            const fallbackStart = itemDates.length
              ? new Date(Math.min(...itemDates.map((d) => d.getTime())))
              : (from ? new Date(from) : null);
            const fallbackEnd = itemDates.length
              ? new Date(Math.max(...itemDates.map((d) => d.getTime())))
              : (to ? new Date(to) : null);

            // Prefer computing the inline billing window directly from invoice.items when available.
            // This mirrors what users see in the invoice modal and avoids API mismatches that can
            // cause both start and end to display the same date.
            try {
              if (itemDates.length) {
                // Build detailed entries with duration (minutes) to respect coverage.maxHours
                const detailed = (invoice.items || [])
                  .map(it => ({
                    date: it.date || it.scheduledDate ? new Date(it.date || it.scheduledDate) : null,
                    durationMin: (typeof it.duration === 'number' && isFinite(it.duration)) ? it.duration : (typeof it.minutes === 'number' ? it.minutes : 0)
                  }))
                  .filter(e => e.date && !Number.isNaN(e.date.getTime()));

                // Sort oldest -> newest
                detailed.sort((a, b) => a.date - b.date);

                // Apply maxHours cap if present
                let effective = detailed;
                if (hasMax && maxMinutes > 0) {
                  let cum = 0;
                  const acc = [];
                  for (const e of detailed) {
                    const dur = Number(e.durationMin || 0);
                    if (cum + dur > maxMinutes) break;
                    acc.push(e);
                    cum += dur;
                  }
                  effective = acc;
                }

                const startDate = effective.length ? effective[0].date : fallbackStart;
                const endDate = effective.length ? effective[effective.length - 1].date : fallbackEnd;

                setWindowDates({
                  start: startDate ? formatDate(startDate) : null,
                  end: endDate ? formatDate(endDate) : null,
                  loading: false
                });
                return; // no need to call the API
              }
            } catch (err) {
              // If anything goes wrong, fall back to the API approach below
              console.warn('BillingWindowInline: item-derived window failed, falling back to API', err);
            }

            // Build request params to mirror the modal: { studentId, from, to }
            const params = {
              studentId: studentId || '',
              from: from || '',
              to: to || ''
            };

            // If we truly have no context, abort and fall back to invoice items
            if (!params.studentId && !params.from && !params.to) {
              setWindowDates({
                start: fallbackStart ? fallbackStart.toLocaleDateString(undefined, { timeZone: 'UTC' }) : null,
                end: fallbackEnd ? fallbackEnd.toLocaleDateString(undefined, { timeZone: 'UTC' }) : null,
                loading: false
              });
              return;
            }

            const { data } = await api.get('/classes', { params });
            if (cancelled) return;

            const list = Array.isArray(data?.classes) ? data.classes : [];
            // Map to { rawDate, duration }
            const mapped = list
              .map((c) => {
                const d = new Date(c.scheduledDate || c.date);
                return {
                  rawDate: d,
                  duration: Number(c.duration || 0)
                };
              })
              .filter((e) => e.rawDate instanceof Date && !Number.isNaN(e.rawDate.getTime()));

            // Sort oldest -> newest
            mapped.sort((a, b) => a.rawDate - b.rawDate);

            // Apply end boundary only if "to" exists (i.e., customEndDate/coverage end without max-hours cap)
            const endBoundary = to ? new Date(to) : null;
            const constrained = endBoundary && !Number.isNaN(endBoundary?.getTime())
              ? mapped.filter((e) => e.rawDate.getTime() <= endBoundary.getTime())
              : mapped;

            // Apply max hours cap cumulatively like the modal
            let effective = constrained;
            if (hasMax && maxMinutes > 0) {
              let cum = 0;
              const acc = [];
              for (const e of constrained) {
                const dur = Number(e?.duration || 0);
                const safe = Number.isFinite(dur) && dur > 0 ? dur : 0;
                if (cum + safe > maxMinutes) break;
                acc.push(e);
                cum += safe;
              }
              effective = acc;
            }

            // Prefer invoice item-derived range when no classes are found to avoid misleading future windows
            const startDate = effective.length
              ? new Date(Math.min(...effective.map((e) => e.rawDate.getTime())))
              : fallbackStart;
            const endDate = effective.length
              ? new Date(Math.max(...effective.map((e) => e.rawDate.getTime())))
              : (fallbackEnd || endBoundary);

            setWindowDates({
              start: startDate ? formatDate(startDate) : null,
              end: endDate ? formatDate(endDate) : null,
              loading: false
            });
          } catch (_) {
            // Fall back to invoice item-derived range on error
            try {
              const fromFallback = invoice?.billingPeriod?.startDate
                || invoice?.billingPeriod?.start
                || invoice?.billingPeriod?.start_date
                || invoice?.startDate
                || invoice?.createdAt
                || '';

              const toFallback =
                invoice?.coverage?.endDate
                || invoice?.endDate
                || invoice?.billingPeriod?.endDate
                || invoice?.billingPeriod?.end
                || invoice?.billingPeriod?.end_date
                || '';

              const itemDatesFallback = Array.isArray(invoice?.items)
                ? invoice.items
                    .map((it) => (it && (it.date || it.scheduledDate) ? new Date(it.date || it.scheduledDate) : null))
                    .filter((d) => d && !Number.isNaN(d.getTime()))
                : [];

              const fallbackStart = itemDatesFallback.length
                ? new Date(Math.min(...itemDatesFallback.map((d) => d.getTime())))
                : (fromFallback ? new Date(fromFallback) : null);
              const fallbackEnd = itemDatesFallback.length
                ? new Date(Math.max(...itemDatesFallback.map((d) => d.getTime())))
                : (toFallback ? new Date(toFallback) : null);

              setWindowDates({
                start: fallbackStart ? formatDate(fallbackStart) : null,
                end: fallbackEnd ? formatDate(fallbackEnd) : null,
                loading: false
              });
            } catch (e) {
              setWindowDates({ start: null, end: null, loading: false });
            }
          }
        };
        run();
        return () => { cancelled = true; };
      }, [invoice]);

      if (windowDates.loading) {
        return (
          <span className="inline-flex items-center gap-2 text-slate-500">
            <Calendar className="h-4 w-4 text-slate-400" />
            <span>{bare ? '…' : 'Billing window: …'}</span>
          </span>
        );
      }

      if (!windowDates.start && !windowDates.end) return null;

      return (
        <span className="inline-flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-400" />
          <span>
            {bare ? (
              <>
                {windowDates.start || '—'} {'→'} {windowDates.end || '—'}
              </>
            ) : (
              <>
                From {windowDates.start || '—'} {'-To→'} {windowDates.end || '—'}
              </>
            )}
          </span>
        </span>
      );
    };
  }, [formatDate]);

  const getStatusBadgeTone = (status) => {
    switch (status) {
      case 'paid':
        return 'success';
      case 'sent':
        return 'info';
      case 'overdue':
        return 'danger';
      case 'cancelled':
        return 'warning';
      case 'refunded':
        return 'brand';
      case 'pending':
      case 'partially_paid':
        return 'warning';
      case 'draft':
      default:
        return 'neutral';
    }
  };

  const getStatusTooltip = (status) => {
    switch (status) {
      case 'paid': return 'Paid — payment received';
      case 'overdue': return 'Overdue — past due date';
      case 'pending': return 'Pending — awaiting payment';
      case 'partially_paid': return 'Partially paid — outstanding balance';
      case 'sent': return 'Sent — delivered to guardian';
      case 'cancelled': return 'Cancelled — not payable';
      case 'refunded': return 'Refunded — payment returned';
      default: return 'Draft — not sent';
    }
  };

  const getStatusIcon = (status) => {
    const iconClass = 'h-4 w-4';
    switch (status) {
      case 'paid':
        return <CheckCircle2 className={iconClass} />;
      case 'overdue':
        return <AlertTriangle className={iconClass} />;
      case 'cancelled':
        return <XCircle className={iconClass} />;
      case 'refunded':
        return <RefreshCw className={iconClass} />;
      case 'sent':
        return <Send className={iconClass} />;
      case 'pending':
      case 'partially_paid':
        return <TimerReset className={iconClass} />;
      case 'draft':
      default:
        return <FileText className={iconClass} />;
    }
  };

  // When the server returns filtered/sorted results we should preserve that
  // ordering and avoid re-sorting here. We still apply client-side search and
  // type filtering for quick UI responsiveness.
  const filteredInvoices = useMemo(() => {
    let result = invoices || [];

    if (searchTerm.trim()) {
      const globalTerm = searchTerm.toLowerCase();
      result = result.filter((inv) => {
        const guardianName = `${inv.guardian?.firstName || ''} ${inv.guardian?.lastName || ''}`.toLowerCase();
        const guardianStudentNames = guardianStudentsMap[inv.guardian?._id] || [];
        const matchesStudent = guardianStudentNames.some((name) => name.toLowerCase().includes(globalTerm));
        return (
          (inv.invoiceNumber || '').toLowerCase().includes(globalTerm) ||
          (inv.invoiceName || '').toLowerCase().includes(globalTerm) ||
          (inv.invoiceSlug || '').toLowerCase().includes(globalTerm) ||
          guardianName.includes(globalTerm) ||
          (inv.guardian?.email || '').toLowerCase().includes(globalTerm) ||
          String(inv.amount || '').includes(globalTerm) ||
          (inv.status || '').toLowerCase().includes(globalTerm) ||
          String(inv._id).includes(globalTerm) ||
          matchesStudent
        );
      });
    }

    // Apply the effective status filter: the active tab takes precedence.
    const effectiveStatus = activeTab !== 'unpaid' ? activeTab : statusFilter;
    if (effectiveStatus !== 'all') {
      if (effectiveStatus === 'paid') {
        result = result.filter((inv) => ['paid', 'refunded'].includes(inv.status));
      } else if (effectiveStatus === 'refunded') {
        result = result.filter((inv) => inv.status === 'refunded');
      } else if (effectiveStatus === 'unpaid') {
        // keep any status that is not paid/refunded
        result = result.filter((inv) => !['paid', 'refunded'].includes(inv.status));
      } else {
        result = result.filter((inv) => inv.status === effectiveStatus);
      }
    }

    if (typeFilter !== 'all') {
      const normalizedType = typeFilter.toLowerCase();
      result = result.filter((inv) => {
        const invoiceType = (inv.type || inv.invoiceType || '').toLowerCase();
        return invoiceType === normalizedType;
      });
    }

    return result;
  }, [invoices, searchTerm, activeTab, statusFilter, typeFilter, guardianStudentsMap]);

  // Ensure consistent ordering client-side as a fallback in case backend doesn't apply requested sort.
  const displayedInvoices = useMemo(() => {
    const list = (filteredInvoices || []).slice();
    if (activeTab === 'unpaid') {
      // oldest created first
      list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else {
      // all other views: latest payment first (fallback to createdAt)
      list.sort((a, b) => getInvoicePaymentTimestamp(b) - getInvoicePaymentTimestamp(a));
    }
    return list;
  }, [filteredInvoices, activeTab]);


  const getChannelInfo = (invoice, channel) => (invoice?.delivery?.channels || []).find((entry) => entry.channel === channel);

  const handleInvoiceUpdate = useCallback((update) => {
    
    if (!update || !update.invoiceId) return;
    setInvoices((prev) => {
      let found = false;
      const next = prev.map((inv) => {
        if (inv._id !== update.invoiceId) return inv;
        found = true;

        // compute next guardianFinancial and coverage
        const nextGuardianFinancial = {
          ...(inv.guardianFinancial || {}),
          hourlyRate: update.guardianRate,
          transferFee: {
            ...(inv.guardianFinancial?.transferFee || {}),
            amount: update.transferFeeAmount,
            waived: update.transferFeeWaived
          }
        };

        const nextCoverage = update.coverage
          ? {
              ...(inv.coverage || {}),
              maxHours: update.coverage.maxHours ?? inv.coverage?.maxHours,
              endDate: update.coverage.customEndDate ?? inv.coverage?.endDate,
              waiveTransferFee: update.coverage.waiveTransferFee
            }
          : inv.coverage;

        const updated = {
          ...inv,
          subtotal: update.subtotal,
          total: update.total,
          amount: update.total,
          adjustedTotal: update.total,
          paidAmount: update.paidAmount,
          guardianFinancial: nextGuardianFinancial,
          coverage: nextCoverage
        };

        return updated;
      });

      if (!found) return prev;

      // If no meaningful change detected, skip state update to avoid re-renders
      try {
        const cur = prev.find((p) => p._id === update.invoiceId) || {};
        const nxt = next.find((p) => p._id === update.invoiceId) || {};

        const fieldsToCompare = [
          ['subtotal'],
          ['total'],
          ['adjustedTotal'],
          ['paidAmount'],
        ];

        let changed = false;
        for (const [k] of fieldsToCompare) {
          const a = Number(cur[k] ?? 0);
          const b = Number(nxt[k] ?? 0);
          if (Math.round(a * 100) !== Math.round(b * 100)) {
            changed = true;
            break;
          }
        }

        // compare guardian transfer fee amount as well
        if (!changed) {
          const aFee = Number(cur.guardianFinancial?.transferFee?.amount ?? 0);
          const bFee = Number(nxt.guardianFinancial?.transferFee?.amount ?? 0);
          if (Math.round(aFee * 100) !== Math.round(bFee * 100)) changed = true;
        }

        // compare coverage maxHours
        if (!changed) {
          const aMax = Number(cur.coverage?.maxHours ?? 0);
          const bMax = Number(nxt.coverage?.maxHours ?? 0);
          if (Math.round(aMax * 100) !== Math.round(bMax * 100)) changed = true;
        }

        if (!changed) {
          
          return prev;
        }
      } catch (err) {
        console.error('Error comparing invoice updates, applying update by default', err);
      }

      
      return next;
    });
  }, []);

  const renderChannelButton = (invoice, channel, label, Icon) => {
    const info = getChannelInfo(invoice, channel);
    const key = `${invoice._id}-${channel}`;
    const isLoading = Boolean(deliveryLoading[key]);
    const isSent = info?.status === 'sent';
    const sentLabel = (() => {
      // derive a compact sent label like 'Email sent' from 'by Email'
      if (/^by\s+/i.test(label)) return `${label.replace(/^by\s+/i, '')} sent`;
      if (/^via\s+/i.test(label)) return `${label.replace(/^via\s+/i, '')} sent`;
      return `${label} sent`;
    })();

    return (
      <button
        onClick={() => handleQuickSend(invoice._id, channel, isSent)}
        disabled={isLoading}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${
          isSent
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
        }`}
        type="button"
      >
        {isLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
        <span>{isSent ? sentLabel : `Send ${label}`}</span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 space-y-8">
        <div className="rounded-3xl bg-white/80 shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
          <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-center lg:justify-between lg:p-8">
            <div className="space-y-1">
              
              <h1 className="text-3xl font-semibold text-slate-900">
                {isGuardian() ? 'My invoices' : 'Guardian invoices'}
              </h1>
              <p className="text-sm text-slate-500">
                {isGuardian()
                  ? 'Track payments, download receipts, and view learning hours.'
                  : ''}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100/80 p-1">
                {[
                  { key: 'unpaid', label: 'Unpaid' },
                  { key: 'paid', label: 'Paid' },
                  { key: 'all', label: 'All' }
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      activeTab === key
                        ? 'bg-white text-slate-900 shadow'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isAdmin() && stats && (
            <div className="grid grid-cols-1 gap-4 border-t border-slate-100 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
              {[
                {
                  label: 'Monthly revenue',
                  value: formatCurrency(stats.monthlyRevenue || 0),
                  icon: DollarSign,
                  trend: 'Collected this month'
                },
                {
                  label: 'Paid invoices',
                  value: stats.paidInvoices ?? '--',
                  icon: CheckCircle2,
                  trend: 'Fully settled'
                },
                {
                  label: 'Pending review',
                  value: stats.pendingInvoices ?? '--',
                  icon: AlertTriangle,
                  trend: 'Awaiting payment'
                },
                {
                  label: 'Zero-hour guardians',
                  value: stats.zeroHourStudents ?? '--',
                  icon: Users,
                  trend: 'Need top-up soon'
                }
              ].map(({ label, value, icon: Icon, trend }) => (
                <div
                  key={label}
                  className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
                    <span className="rounded-full bg-white p-2 text-slate-500 shadow-sm">
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <span className="text-2xl font-semibold text-slate-900">{value}</span>
                  <span className="text-xs text-slate-500">{trend}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-black/5">
         

          {error && (
            <div className="mt-6 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-4">
            {loading && invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
                <LoadingSpinner />
                <p className="text-sm">Loading invoices…</p>
              </div>
            ) : displayedInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
                <Search className="h-8 w-8 text-slate-300" />
                <div>
                  <p className="text-base font-medium text-slate-700">No invoices found</p>
                  <p className="text-sm text-slate-500">Try a different filter.</p>
                </div>
              </div>
            ) : (
              displayedInvoices.map((invoice) => {
                const statusTone = getStatusBadgeTone(invoice.status);
                
                // ✅ Use computeInvoiceTotals to respect coverage.maxHours filter
                const computed = computeInvoiceTotals(invoice);
                const invoiceTotal = computed.total;
                const remainingBalance = computed.remaining;
                
                const emailChannel = getChannelInfo(invoice, 'email');
                const whatsappChannel = getChannelInfo(invoice, 'whatsapp');

                return (
                  <div
                    key={invoice._id}
                    className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex flex-col gap-6 p-6">
                      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <Badge tone={statusTone} pill title={getStatusTooltip(invoice.status)} aria-label={getStatusTooltip(invoice.status)}>
                              {getStatusIcon(invoice.status)}
                              <span className="capitalize">{invoice.status || 'draft'}</span>
                            </Badge>
                            <span className="text-sm font-semibold text-slate-700">{invoice.invoiceName || invoice.invoiceNumber}</span>
                            <span className="text-xs rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-500" title={`System ID: ${invoice.invoiceNumber || invoice._id}`}>{getReadableInvoiceId(invoice)}</span>
                            {invoice.invoiceNumber && invoice.invoiceNumber !== (invoice.invoiceName || '') && (
                              <span className="text-xs uppercase tracking-wide text-slate-400"></span>
                            )}
                            {invoice.sentVia && invoice.sentVia !== 'none' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                                <BadgeCheck className="h-3.5 w-3.5" />
                                Sent via {invoice.sentVia}
                              </span>
                            )}
                          </div>
                          <div className="space-y-2 text-sm text-slate-600">
                            <div className="flex flex-wrap items-center gap-4">
                              <span className="inline-flex items-center gap-2 text-slate-700">
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                                  {getInitials(invoice.guardian?.firstName, invoice.guardian?.lastName)}
                                </span>
                                <span className="flex flex-col leading-tight">
                                  <span className="text-[11px] text-slate-500">Guardian</span>
                                  <span className="text-slate-700">{invoice.guardian?.firstName} {invoice.guardian?.lastName}</span>
                                </span>
                              </span>
                              
                              <span className="inline-flex items-center gap-2">
                                
                                <span className={`font-medium ${remainingBalance > 0 ? 'text-rose-600' : 'text-slate-700'}`}>Due: {formatCurrency(remainingBalance)}</span>
                              </span>
                              <span className="inline-flex items-center gap-2">
                                
                                {remainingBalance > 0 ? (
                                  <span className="font-medium text-slate-700">Total: {formatCurrency(invoiceTotal)}</span>
                                ) : (
                                  <span className="font-medium text-emerald-600">Paid in full</span>
                                )}
                              </span>
                              <span className="hidden h-1.5 w-1.5 rounded-full bg-slate-200 lg:block" />
                              {/* Billing window inline (computed like modal) */}
                              <BillingWindowInline 
                                key={`${invoice._id}-${invoice.coverage?.maxHours || 0}-${invoice.coverage?.endDate || ''}`}
                                invoice={invoice} 
                              />
                            </div>
                            
                            {invoice.guardian?.email && (
                              
                              <p className="text-xs text-slate-400">{invoice.guardian.email}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-start gap-3 lg:items-end">
                          <div className="flex flex-wrap gap-2">
                            {renderChannelButton(invoice, 'email', 'by Email', Mail)}
                            {renderChannelButton(invoice, 'whatsapp', 'via WhatsApp', MessageCircle)}
                            <button
                              onClick={() => handleDownloadDocx(invoice._id, invoice.invoiceNumber)}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                              type="button"
                              title="Download DOCX"
                            >
                              {downloadingDocId === invoice._id ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <DownloadCloud className="h-3.5 w-3.5" />
                              )}
                              <span>Download DOCX</span>
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => handleCopyShareLink(invoice)}
                              className={`inline-flex items-center justify-center rounded-full border p-2 transition ${
                                copiedInvoiceId === invoice._id
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'
                              }`}
                              type="button"
                              aria-label="Copy shareable link"
                            >
                              <Link2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => openModal('view', invoice)}
                              className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                              type="button"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {isAdmin() && (
                              <>
                                <button
                                  onClick={() => openModal('payment', invoice)}
                                  className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                                  type="button"
                                >
                                  <CreditCard className="h-4 w-4" />
                                </button>
                                {(invoice.status === 'draft' || invoice.status === 'pending') && (
                                  !invoice.deleted && (
                                    <button
                                      onClick={() => handleDeleteInvoice(invoice)}
                                      className="inline-flex items-center justify-center rounded-full border border-rose-100 p-2 text-rose-500 transition hover:border-rose-200 hover:text-rose-700"
                                      type="button"
                                    >
                                      <XCircle className="h-4 w-4" />
                                    </button>
                                  )
                                )}
                                {invoice.deleted && isAdmin() && (
                                  <>
                                    <button
                                      onClick={() => setConfirmModal({ open: true, action: 'restore', invoiceId: invoice._id, title: 'Restore invoice', message: 'Restore this deleted invoice?', confirmText: 'Restore', danger: false })}
                                      className="inline-flex items-center justify-center rounded-full border border-emerald-100 p-2 text-emerald-600 transition hover:border-emerald-200 hover:text-emerald-700"
                                      type="button"
                                      title="Restore invoice"
                                    >
                                      <RefreshCw className="h-4 w-4" />
                                    </button>
                                    <button
                                      onClick={() => setConfirmModal({ 
                                        open: true, 
                                        action: 'permanentDelete', 
                                        invoiceId: invoice._id, 
                                        title: 'Permanently delete', 
                                        message: 'Delete this invoice permanently? This cannot be undone.', 
                                        confirmText: 'Delete permanently', 
                                        danger: true 
                                      })}
                                      className="inline-flex items-center justify-center rounded-full border border-red-100 p-2 text-red-600 transition hover:border-red-200 hover:text-red-700"
                                      type="button"
                                      title="Permanently delete from database"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </>
                                )}
                                {invoice.status === 'sent' && (
                                  <button
                                    onClick={() => handleCancelInvoice(invoice._id)}
                                    className="inline-flex items-center justify-center rounded-full border border-amber-100 p-2 text-amber-500 transition hover:border-amber-200 hover:text-amber-700"
                                    type="button"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                )}
                                {['paid', 'partially_paid', 'sent', 'overdue'].includes(invoice.status) && (
                                  <button
                                    onClick={() => openModal('refund', invoice)}
                                    className="inline-flex items-center justify-center rounded-full border border-violet-100 p-2 text-violet-500 transition hover:border-violet-200 hover:text-violet-700"
                                    type="button"
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                  </button>
                                )}
                              </>
                            )}
                            <button
                              onClick={() => toggleExpanded(invoice._id)}
                              className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                              type="button"
                            >
                              {expandedInvoice === invoice._id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                          </div>
                          {copiedInvoiceId === invoice._id && (
                            <span className="text-[11px] font-medium text-emerald-600">Link copied</span>
                          )}
                        </div>
                      </div>

                      {expandedInvoice === invoice._id && (
                        <div className="grid gap-6 border-t border-slate-100 bg-slate-50/60 p-6 md:grid-cols-2">
                          <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white/70 p-4">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Snapshot</span>
                            <div className="space-y-2 text-sm text-slate-600">
                              <div className="flex items-start gap-2">
                                <Calendar className="mt-0.5 h-4 w-4 text-slate-400" />
                                <div className="w-full">
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-slate-500">Issued:</span>
                                      <span className="font-medium text-slate-900">{formatDate(invoice.createdAt)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-slate-500">Balance due:</span>
                                      <span className={`font-semibold ${remainingBalance > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{formatCurrency(remainingBalance)}</span>
                                    </div>
                                  </div>
                                  
                                </div>
                              </div>
                              <div className="pt-2">
                                <p className="font-medium text-slate-700">Notes</p>
                                <p className="text-sm text-slate-600">{invoice.notes ? invoice.notes : '—'}</p>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white/70 p-4">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Delivery status</span>
                            <div className="space-y-2 text-sm text-slate-600">
                              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-3 py-2" title={`Last updated: ${formatDate(invoice.updatedAt)}`}>
                                <div className="flex items-center gap-2">
                                  <Mail className="h-4 w-4 text-slate-400" />
                                  <span>Email delivery</span>
                                </div>
                                <span className={`text-xs font-medium ${emailChannel?.status === 'sent' ? 'text-emerald-600' : 'text-slate-500'}`}>
                                  {emailChannel?.status ? emailChannel.status.replace(/^\w/, c => c.toUpperCase()) : 'Not sent'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-3 py-2" title={`Last updated: ${formatDate(invoice.updatedAt)}`}>
                                <div className="flex items-center gap-2">
                                  <MessageCircle className="h-4 w-4 text-slate-400" />
                                  <span>WhatsApp delivery</span>
                                </div>
                                <span className={`text-xs font-medium ${whatsappChannel?.status === 'sent' ? 'text-emerald-600' : 'text-slate-500'}`}>
                                  {whatsappChannel?.status ? whatsappChannel.status.replace(/^\w/, c => c.toUpperCase()) : 'Not sent'}
                                </span>
                              </div>
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-500">
                                Last updated {formatDate(invoice.updatedAt)}
                              </div>
                            </div>
                          </div>

                          
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {[...Array(totalPages)].map((_, idx) => (
                <button
                  key={idx}
                  onClick={() => setCurrentPage(idx + 1)}
                  className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm transition ${
                    currentPage === idx + 1
                      ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                  }`}
                  type="button"
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {modalState.type === 'view' && (
        <InvoiceViewModal
          invoiceSlug={modalState.invoiceSlug}
          invoiceId={modalState.invoiceId}
          onClose={() => closeModal(true)}
          onInvoiceUpdate={handleInvoiceUpdate}
        />
      )}
      {modalState.type === 'payment' && (
        <RecordPaymentModal
          invoiceId={modalState.invoiceId}
          onClose={() => closeModal()}
          onUpdated={() => {
            // success toast and refresh list/stats
            setToast({ show: true, type: 'success', message: 'Payment recorded' });
            closeModal(true);
          }}
        />
      )}
      {modalState.type === 'refund' && (
        <RefundInvoiceModal
          invoiceId={modalState.invoiceId}
          onClose={() => closeModal()}
          onUpdated={() => {
            setToast({ show: true, type: 'success', message: 'Refund recorded' });
            closeModal(true);
          }}
        />
      )}
      {toast.show && (
        <Toast
          type={toast.type || 'success'}
          message={toast.message || ''}
          onClose={() => setToast({ show: false, type: '', message: '' })}
        />
      )}
      {/* Floating action buttons (bottom-right) */}
      {isAdmin() && (
        <div ref={fabRef} className="fixed bottom-6 right-6 z-50 flex items-end">
          <div className="relative flex flex-col items-end">
            {/* Animated cluster items (appear when fabOpen=true) */}
            <div className="flex flex-col items-end gap-3 mb-2">
              {/* Show deleted drafts with label */}
              <div className={`flex items-center gap-3 transition-all duration-200 ${fabOpen ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'}`}>
                <span className={`rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-md transition transform ${fabOpen ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'}`}>
                  View deleted drafts
                </span>
                <button
                  title="View deleted drafts"
                  onClick={() => setShowDeleted((s) => !s)}
                  className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 ${showDeleted ? 'bg-emerald-600 text-white' : 'bg-white text-slate-700'}`}
                  type="button"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              </div>

              {/* Check zero hours with label */}
              <div className={`flex items-center gap-3 transition-all duration-200 ${fabOpen ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'}`}>
                <span className={`rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-md transition transform ${fabOpen ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'}`}>
                  Review zero-hour guardians
                </span>
                <button
                  title="Review zero-hour guardians"
                  onClick={() => { setFabOpen(false); handleCheckZeroHours(); }}
                  disabled={checkingZeroHours}
                  className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 ${checkingZeroHours ? 'bg-slate-200 text-slate-500 cursor-not-allowed' : 'bg-white text-slate-800'}`}
                  type="button"
                >
                  {checkingZeroHours ? <RefreshCw className="h-5 w-5 animate-spin" /> : <TrendingUp className="h-5 w-5" />}
                </button>
              </div>

              {/* New invoice primary with label */}
              <div className={`flex items-center gap-3 transition-all duration-200 ${fabOpen ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none -translate-y-2'}`}>
                <span className={`rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-md transition transform ${fabOpen ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'}`}>
                  Create invoice
                </span>
                <PrimaryButton
                  title="Create invoice"
                  onClick={() => { setFabOpen(false); alert('Manual invoice creation is coming soon.'); }}
                  circle
                  size="lg"
                >
                  <Plus className="h-6 w-6" />
                </PrimaryButton>
              </div>
            </div>

            {/* Toggle FAB */}
            <PrimaryButton
              aria-expanded={fabOpen}
              onClick={() => setFabOpen((s) => !s)}
              circle
              title={fabOpen ? 'Close actions' : 'Open actions'}
            >
              <Plus className={`h-5 w-5 transition-transform ${fabOpen ? 'rotate-45' : ''}`} />
            </PrimaryButton>
          </div>
        </div>
      )}
      <ConfirmModal
        open={confirmModal.open}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        cancelText="Cancel"
        danger={!!confirmModal.danger}
        onCancel={() => setConfirmModal({ open: false, action: null, invoiceId: null, title: '', message: '' })}
        onConfirm={async () => {
          const action = confirmModal.action;
          const id = confirmModal.invoiceId;
          setConfirmModal((s) => ({ ...s, open: false }));
          if (action === 'delete') await performDeleteInvoice(id);
          else if (action === 'cancel') await performCancelInvoice(id);
          else if (action === 'restore') await performRestoreInvoice(id);
          else if (action === 'permanentDelete') await performPermanentDeleteInvoice(id);
        }}
      />
    </div>
  );
};

export default InvoicesPage;
