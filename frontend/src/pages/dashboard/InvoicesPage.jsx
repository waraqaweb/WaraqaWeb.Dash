import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  CheckSquare,
  Trash2
} from 'lucide-react';
import useBulkSelect from '../../hooks/useBulkSelect';
import BulkActionBar from '../../components/ui/BulkActionBar';
import ExportExcelButton from '../../components/ui/ExportExcelButton';
import { fetchAllForExport, mapInvoiceRow, downloadExcel } from '../../utils/exportToExcel';

import LoadingSpinner from '../../components/ui/LoadingSpinner';
import CircleSpinner from '../../components/ui/CircleSpinner';
import useMinLoading from '../../components/ui/useMinLoading';
import PrimaryButton from '../../components/ui/PrimaryButton';
import Badge from '../../components/ui/Badge';
import InvoiceViewModal from '../../components/invoices/InvoiceViewModal';
import RecordPaymentModal from '../../components/invoices/RecordPaymentModal';
import RefundInvoiceModal from '../../components/invoices/RefundInvoiceModal';
import CreateGuardianInvoiceModal from '../../components/invoices/CreateGuardianInvoiceModal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import Toast from '../../components/ui/Toast';
import { useDeleteActionCountdown } from '../../contexts/DeleteActionCountdownContext';
import { computeInvoiceTotals, resolveInvoiceClassEntries } from '../../utils/invoiceTotals';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';

const getInvoicePaymentTimestamp = (invoice) => {
  if (!invoice) return 0;
  const paidSource = invoice.paidAt || invoice.paymentDate || (invoice.payment && invoice.payment.date) || invoice.updatedAt;
  const fallback = invoice.createdAt;
  return new Date(paidSource || fallback).getTime();
};

// Sort key: invoiceSequence (higher = more recent) then first item/billing date
const getInvoiceRecencyKey = (invoice) => {
  if (!invoice) return 0;
  if (invoice.invoiceSequence != null) return invoice.invoiceSequence;
  // Fallback: first item date or billingPeriod.startDate or createdAt
  const firstItemDate = invoice.items?.[0]?.date;
  const billStart = invoice.billingPeriod?.startDate;
  return new Date(firstItemDate || billStart || invoice.createdAt || 0).getTime() / 1e13;
};

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const InvoicesPage = ({ isActive = true }) => {
  const { isAdmin, isGuardian, socket, user } = useAuth();
  const { searchTerm, globalFilter } = useSearch();
  const location = useLocation();
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState([]);
  const invoicesRef = useRef([]);
  const fetchInvoicesInFlightRef = useRef(false);
  const fetchInvoicesKeyRef = useRef('');
  const fetchInvoicesAbortRef = useRef(null);
  const fetchInvoicesRequestIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const showLoading = useMinLoading(loading);
  const [error, setError] = useState('');
  // Search is client-side only (Excel-like): filter already loaded invoices without refetching.
  const [expandedInvoice, setExpandedInvoice] = useState(null);
  const [currentPage, setCurrentPage] = useState(Number(new URLSearchParams(location.search).get('page') || '1'));
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState(null);
  const [checkingZeroHours, setCheckingZeroHours] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ open: false, action: null, invoiceId: null, title: '', message: '', confirmText: 'Confirm', danger: false });
  const [guardianStudentsMap, setGuardianStudentsMap] = useState({});
  // No tab selected by default; treat empty as "all" for filtering.
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = sessionStorage.getItem('invoices.activeTab');
      return saved || 'unpaid';
    } catch (_) {
      return 'unpaid';
    }
  });
  const [deliveryFilter, setDeliveryFilter] = useState(() => {
    try {
      const saved = sessionStorage.getItem('invoices.deliveryFilter');
      return saved || '';
    } catch (_) {
      return '';
    }
  });
  const [modalState, setModalState] = useState({ type: null, invoiceId: null, invoiceSlug: null });
  const [modalInvoiceSeed, setModalInvoiceSeed] = useState(null);
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
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkWhatsappOpen, setBulkWhatsappOpen] = useState(false);
  const [bulkComposer, setBulkComposer] = useState({
    greeting: 'Assalamu Alaykum {{guardianEpithet}} {{guardianFirstName}},',
    bodyIntro: '',
    bodyMessage1: 'This is your new invoice from Waraqa to pay:',
    bodyLink1Type: 'paypal',
    bodyMessage2: 'This is an updated list of the classes covered by this invoice:',
    bodyLink2Type: 'invoice',
    endMessage: 'Jazak Allah Khier',
  });
  const [bulkIncludeMarkSent, setBulkIncludeMarkSent] = useState(true);
  const [bulkOpenWhatsappChats, setBulkOpenWhatsappChats] = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkDraftRows, setBulkDraftRows] = useState([]);
  const greetingEditorRef = useRef(null);
  const bodyIntroEditorRef = useRef(null);
  const bodyMessage1EditorRef = useRef(null);
  const bodyMessage2EditorRef = useRef(null);
  const endMessageEditorRef = useRef(null);
  const { start: startDeleteCountdown } = useDeleteActionCountdown();
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);
  const [cardOverrides, setCardOverrides] = useState({});
  const invoicePrefetchInFlightRef = useRef(new Set());
  const invoicePrefetchCooldownRef = useRef(new Map());
  const invoiceCardRefsRef = useRef(new Map());

  const setInvoiceCardRef = useCallback((invoiceId, node) => {
    if (!invoiceId) return;
    const key = String(invoiceId);
    if (node) {
      invoiceCardRefsRef.current.set(key, node);
    } else {
      invoiceCardRefsRef.current.delete(key);
    }
  }, []);

  const prefetchInvoiceDetail = useCallback(async (invoiceLike, reason = 'hover') => {
    const invoiceObject = invoiceLike && typeof invoiceLike === 'object' ? invoiceLike : null;
    const identifier = invoiceObject?._id || invoiceObject?.invoiceSlug || (typeof invoiceLike === 'string' ? invoiceLike : null);
    if (!identifier) return;

    const cacheKey = makeCacheKey('invoices:detail', user?._id, { id: identifier });
    const cached = readCache(cacheKey, { deps: ['invoices'] });
    if (cached.hit && cached.ageMs < 60_000 && cached.value?.invoice) {
      return;
    }

    const inFlightKey = String(identifier);
    if (invoicePrefetchInFlightRef.current.has(inFlightKey)) {
      return;
    }

    invoicePrefetchInFlightRef.current.add(inFlightKey);
    try {
      const { data } = await api.get(`/invoices/${identifier}`);
      const inv = data?.invoice || data;
      if (inv) {
        writeCache(cacheKey, { invoice: inv }, { ttlMs: 2 * 60_000, deps: ['invoices'] });
      }
    } catch (err) {
      if (reason !== 'hover') {
        console.warn('Invoice prefetch failed:', err?.message || err);
      }
    } finally {
      invoicePrefetchInFlightRef.current.delete(inFlightKey);
    }
  }, [user?._id]);

  const handleInvoiceActionHover = useCallback((invoiceObject) => {
    const id = invoiceObject?._id || invoiceObject?.invoiceSlug;
    if (!id) return;
    const key = String(id);
    const now = Date.now();
    const last = Number(invoicePrefetchCooldownRef.current.get(key) || 0);
    if (now - last < 15_000) return;
    invoicePrefetchCooldownRef.current.set(key, now);
    prefetchInvoiceDetail(invoiceObject, 'hover');
  }, [prefetchInvoiceDetail]);

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

  const itemsPerPage = 30;
  const resolvedActiveTab = activeTab || 'unpaid';

  const normalizedSearchTerm = useMemo(() => (searchTerm || '').trim().toLowerCase(), [searchTerm]);

  // Sync current page from URL (Back/Forward).
  useEffect(() => {
    if (!isActive) return;
    try {
      const params = new URLSearchParams(location.search);
      const pageParam = Number(params.get('page') || '1');
      const next = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
      if (next !== currentPage) setCurrentPage(next);
    } catch (err) {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, location.search]);

  // Persist current page in URL (so refresh keeps your place).
  useEffect(() => {
    if (!isActive) return;
    try {
      const params = new URLSearchParams(location.search);
      const currentParam = Number(params.get('page') || '1');
      if (currentParam === Number(currentPage || 1)) return;
      params.set('page', String(currentPage || 1));
      const next = params.toString();
      navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: false });
    } catch (err) {
      // ignore
    }
  }, [isActive, currentPage, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!isActive) return;
    fetchInvoices();
    if (isAdmin()) fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, statusFilter, typeFilter, segmentFilter, currentPage, activeTab, normalizedSearchTerm]);

  useEffect(() => {
    if (!isActive) return;
    setCurrentPage(1);
    // When the user starts searching, switch to the "All" tab and clear
    // delivery filter so results are not restricted by any pre-set filters.
    if (normalizedSearchTerm) {
      setActiveTab('all');
      setDeliveryFilter('');
    }
  }, [isActive, normalizedSearchTerm]);

  useEffect(() => {
    try {
      sessionStorage.setItem('invoices.activeTab', activeTab || '');
    } catch (_) {
      // ignore storage errors
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      sessionStorage.setItem('invoices.deliveryFilter', deliveryFilter || '');
    } catch (_) {
      // ignore storage errors
    }
  }, [deliveryFilter]);

  useEffect(() => {
    invoicesRef.current = invoices || [];
  }, [invoices]);

  const fetchInvoices = async () => {
    try {
      const requestSignature = JSON.stringify({
        page: currentPage,
        limit: itemsPerPage,
        activeTab: resolvedActiveTab,
        statusFilter,
        typeFilter,
        segmentFilter,
        search: normalizedSearchTerm || undefined,
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

      const cacheKey = makeCacheKey(
        'invoices:list',
        user?._id,
        {
          page: currentPage,
          limit: itemsPerPage,
          activeTab: resolvedActiveTab,
          statusFilter,
          typeFilter,
          segmentFilter,
          search: normalizedSearchTerm || undefined,
        }
      );

      const cached = readCache(cacheKey, { deps: ['invoices'] });
      if (cached.hit && cached.value) {
        setInvoices(cached.value.invoices || []);
        setTotalPages(cached.value.totalPages || 1);
        setGuardianStudentsMap(cached.value.guardianStudentsMap || {});
        setError('');
        setLoading(false);

        if (cached.ageMs < 60_000) {
          fetchInvoicesInFlightRef.current = false;
          return;
        }
      } else {
        const hasExisting = (invoicesRef.current || []).length > 0;
        setLoading(!hasExisting);
      }
      const params = {
        page: currentPage,
        limit: itemsPerPage,
      };

      const searchMode = Boolean(normalizedSearchTerm);
      if (searchMode) {
        params.search = normalizedSearchTerm;
        params.smartSort = true;
      }

      // Active tab controls the primary status filter and desired ordering.
      // - Unpaid tab: show oldest created invoices first (createdAt asc)
      // - Paid tab: show latest paid invoices first (paidAt desc)
      // - All tab (or none): show invoices by latest payment (paidAt desc, fallback createdAt)
      if (!searchMode && resolvedActiveTab !== 'all') {
        params.status = resolvedActiveTab;
        if (resolvedActiveTab === 'unpaid') {
          params.sortBy = 'createdAt';
          params.order = 'asc';
        } else {
          params.sortBy = 'paidAt';
          params.order = 'desc';
        }
      } else if (!searchMode && statusFilter !== 'all') {
        params.status = statusFilter;
        if (statusFilter === 'unpaid') {
          params.sortBy = 'createdAt';
          params.order = 'asc';
        } else {
          params.sortBy = 'paidAt';
          params.order = 'desc';
        }
      } else if (!searchMode) {
        // Default for the 'all' tab: latest payment first
        params.sortBy = 'paidAt';
        params.order = 'desc';
      }

      if (typeFilter !== 'all') params.type = typeFilter;
      if (segmentFilter !== 'all') params.segment = segmentFilter;

      const { data } = await api.get('/invoices', { params, signal: controller.signal });
      if (requestId !== fetchInvoicesRequestIdRef.current) {
        return;
      }
      const invoiceList = data.invoices || [];
      setInvoices(invoiceList);
      
      setTotalPages(data.pagination?.pages || 1);

      setLoading(false);

      writeCache(
        cacheKey,
        {
          invoices: invoiceList,
                totalPages: data.pagination?.pages || 1,
          guardianStudentsMap: {},
        },
        { ttlMs: 5 * 60_000, deps: ['invoices'] }
      );

      const guardianIds = [...new Set(invoiceList.map(inv => inv.guardian?._id).filter(Boolean))];
      if (guardianIds.length > 0) {
        (async () => {
          try {
            const response = await api.post('/users/students/batch', { guardianIds }, { signal: controller.signal });
            if (requestId !== fetchInvoicesRequestIdRef.current) return;
            const nextGuardianStudentsMap = response.data?.map || {};
            setGuardianStudentsMap(nextGuardianStudentsMap);
            writeCache(
              cacheKey,
              {
                invoices: invoiceList,
                totalPages: data.pagination?.pages || 1,
                guardianStudentsMap: nextGuardianStudentsMap,
              },
              { ttlMs: 5 * 60_000, deps: ['invoices'] }
            );
          } catch (err) {
            const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
            const isTimeout = err?.code === 'ECONNABORTED';
            if (!isCanceled && !isTimeout) {
              console.error('Failed to fetch guardian students batch', err);
            }
          }
        })();
      } else {
        setGuardianStudentsMap({});
      }
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        console.error(err);
        setError('Failed to fetch invoices');
      }
    } finally {
      setLoading(false);
      fetchInvoicesInFlightRef.current = false;
    }
  };

  const fetchStats = async () => {
    try {
      const cacheKey = makeCacheKey('invoices:stats', user?._id, { kind: 'overview' });
      const cached = readCache(cacheKey, { deps: ['invoices'] });
      if (cached.hit && cached.value) {
        setStats(cached.value);
        if (cached.ageMs < 60_000) return;
      }

      const { data } = await api.get('/invoices/stats/overview');
      setStats(data.stats);
      writeCache(cacheKey, data.stats, { ttlMs: 5 * 60_000, deps: ['invoices'] });
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
          const debugRows = Array.isArray(data.createdDebug) ? data.createdDebug : [];
          const debugMessage = debugRows.length
            ? `\n\nDebug:\n${debugRows
                .map((row, index) => {
                  const start = row?.billingStart ? new Date(row.billingStart).toLocaleDateString() : '-';
                  const end = row?.billingEnd ? new Date(row.billingEnd).toLocaleDateString() : '-';
                  return `${index + 1}) ${row?.invoiceNumber || row?.invoiceSlug || row?.id || 'Invoice'} | ${start} -> ${end} | classes: ${row?.selectedClassCount ?? 0}`;
                })
                .join('\n')}`
            : '';

          if (debugRows.length) {
            try {
              console.table(debugRows);
            } catch (_) {}
          }

          alert(`Successfully created ${data.invoicesCreated} new zero-hour invoices.${debugMessage}`);
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
    const statusLabel = invoice?.status || 'invoice';
    const needsForce = ['paid', 'partially_paid', 'refunded'].includes(invoice?.status);
    setConfirmModal({
      open: true,
      action: 'delete',
      invoiceId: invoice?._id,
      forceDelete: needsForce,
      countdownMessage: `Deleting ${statusLabel} invoice`,
      title: `Delete ${statusLabel} invoice`,
      message: needsForce
        ? 'This invoice has payments. Deleting it will void the invoice and reverse credited hours. Continue?'
        : 'Delete this invoice permanently? It will be removed from lists and hours will not change.',
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

  const performDeleteInvoice = async (invoiceId, force = false) => {
    try {
      const params = { preserveHours: false };
      if (force) params.force = true;
      const { data } = await api.delete(`/invoices/${invoiceId}`, { params });
      if (data.success) {
        setInvoices((prev) => (prev || []).filter((inv) => inv?._id !== invoiceId));
        alert('Invoice deleted permanently');
        fetchInvoices();
        if (isAdmin()) fetchStats();
        return true;
      } else {
        const message = data.error || 'Delete failed';
        alert(message);
        throw new Error(message);
      }
    } catch (err) {
      console.error('Delete invoice error:', err);
      alert('Delete failed');
      throw err;
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

  // ── Bulk action handlers ──────────────────────────────────────────────────
  const runBulkAction = async (label, apiCall) => {
    const ids = [...bulk.selected];
    if (ids.length === 0) return;
    if (!window.confirm(`${label} ${ids.length} invoice(s)?`)) return;
    setBulkActionLoading(true);
    try {
      const { data } = await apiCall(ids);
      const parts = [];
      if (data.deleted) parts.push(`${data.deleted} deleted`);
      if (data.cancelled) parts.push(`${data.cancelled} cancelled`);
      if (data.sent) parts.push(`${data.sent} sent`);
      if (data.failed?.length) parts.push(`${data.failed.length} failed`);
      if (data.skipped) parts.push(`${data.skipped} skipped`);
      setToast({ show: true, type: data.failed?.length ? 'warning' : 'success', message: parts.join(', ') || 'Done' });
      bulk.clearSelection();
      bulk.toggleSelectionMode();
      fetchInvoices();
      if (isAdmin()) fetchStats();
    } catch (err) {
      console.error(`Bulk ${label} error:`, err);
      setToast({ show: true, type: 'error', message: err?.response?.data?.message || `Bulk ${label} failed` });
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleBulkDelete = () => runBulkAction('Delete', (ids) => api.post('/invoices/bulk/delete', { ids }));
  const handleBulkCancel = () => runBulkAction('Cancel', (ids) => api.post('/invoices/bulk/cancel', { ids }));
  const handleBulkSend = () => runBulkAction('Send', (ids) => api.post('/invoices/bulk/send', { ids, via: 'email' }));

  const toggleExpanded = (invoiceId) => {
    setExpandedInvoice((prev) => (prev === invoiceId ? null : invoiceId));
  };

  const openModal = (type, invoice) => {
    const invoiceObject = invoice && typeof invoice === 'object' ? invoice : null;
    const fallbackInvoice = !invoiceObject
      ? (invoicesRef.current || []).find((inv) => {
          if (!inv) return false;
          if (typeof invoice === 'string') {
            return String(inv._id) === String(invoice) || String(inv.invoiceSlug || '') === String(invoice);
          }
          return false;
        })
      : null;
    const resolvedInvoice = invoiceObject || fallbackInvoice || null;
    const invoiceId = resolvedInvoice?._id || (typeof invoice === 'string' ? invoice : null);
    const invoiceSlug = resolvedInvoice?.invoiceSlug || null;

    if (resolvedInvoice) {
      setModalInvoiceSeed(resolvedInvoice);
    }

    if (resolvedInvoice) {
      prefetchInvoiceDetail(resolvedInvoice, 'open');
    }
    
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
    setModalInvoiceSeed(null);

    const params = new URLSearchParams(location.search);
    const hadModalParams = params.has('modal') || params.has('invoice') || params.has('invoiceSlug');

    params.delete('modal');
    params.delete('invoice');
    params.delete('invoiceSlug');
    const nextSearch = params.toString();
    const baseState = { ...(location.state || {}) };
    delete baseState.invoicesModal;
    delete baseState.modalType;
    delete baseState.invoiceId;
    delete baseState.invoiceSlug;

    if (hadModalParams) {
      // Stay on the same invoices page; just clear modal params/state.
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

  const formatGuardianEpithet = (epithet) => {
    const normalized = String(epithet || '').trim().toLowerCase();
    if (!normalized || normalized === 'none') return '';
    const map = {
      mr: 'Mr',
      mister: 'Mr',
      mrs: 'Mrs',
      missus: 'Mrs',
      ms: 'Ms',
      miss: 'Ms',
      brother: 'brother',
      bro: 'brother',
      sister: 'sister',
      sis: 'sister'
    };
    return map[normalized] || epithet;
  };

  const normalizeWhatsappPhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.replace(/^0+/, '');
  };

  const buildWhatsappMessage = (invoice, publicLink, options = {}) => {
    const guardian = invoice?.guardian || {};
    const epithet = formatGuardianEpithet(guardian?.guardianInfo?.epithet);
    const name = String(guardian.firstName || '').trim() || 'Guardian';
    const greeting = `Assalamu Alaykum ${epithet ? `${epithet} ` : ''}${name},`;
    const referenceLink = String(invoice?.invoiceReferenceLink || '').trim();
    const composer = options?.composer && typeof options.composer === 'object' ? options.composer : null;

    const classEntries = resolveInvoiceClassEntries(invoice);
    const classItems = Array.isArray(classEntries?.items) ? classEntries.items : [];
    const studentNames = Array.from(new Set(
      classItems
        .map((item) => String(item?.studentName || item?.student?.firstName || '').trim())
        .filter(Boolean)
    ));
    const guardianIsStudent = String(guardian?.role || '').toLowerCase() === 'student' || Boolean(guardian?.isStudent);
    const studentTargets = guardianIsStudent
      ? 'you'
      : (studentNames.length ? studentNames.join(', ') : `${epithet ? `${epithet} ` : ''}${name}`.trim());

    const tokenMap = {
      guardianName: name,
      guardianFirstName: name,
      guardianEpithet: epithet,
      greeting,
      invoiceLink: referenceLink,
      paypalLink: referenceLink,
      publicLink,
      studentTargets,
      youOrGuardian: guardianIsStudent ? 'you' : `${epithet ? `${epithet} ` : ''}${name}`.trim(),
    };

    const applyTokens = (value) => {
      let result = String(value || '');
      Object.entries(tokenMap).forEach(([key, tokenValue]) => {
        result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), String(tokenValue || ''));
      });
      return result.replace(/\s{2,}/g, ' ').trim();
    };

    if (composer) {
      const resolveSelectedLink = (type) => {
        const normalizedType = String(type || '').toLowerCase();
        if (normalizedType === 'invoice') return publicLink;
        return referenceLink;
      };

      const lines = [
        applyTokens(composer.greeting),
        applyTokens(composer.bodyIntro),
        applyTokens(composer.bodyMessage1),
        resolveSelectedLink(composer.bodyLink1Type),
        applyTokens(composer.bodyMessage2),
        resolveSelectedLink(composer.bodyLink2Type),
        applyTokens(composer.endMessage),
      ];

      return lines.filter((line) => String(line || '').trim()).join('\n\n');
    }

    const introLine = 'This is your new invoice from Waraqa to pay:';
    const lines = [
      greeting,
      introLine,
      referenceLink,
      'and this is an updated list of the classes covered by this invoice.',
      publicLink,
      'Jazak Allah Khier'
    ];

    return lines.join('\n');
  };

  const handleQuickSend = async (invoice, method, force = false) => {
    if (!invoice?._id) return;
    const invoiceId = invoice._id;
    const key = `${invoiceId}-${method}`;
    setDeliveryLoading((prev) => ({ ...prev, [key]: true }));
    try {
      if (method === 'whatsapp') {
        let latestInvoice = invoice;
        let phone = normalizeWhatsappPhone(latestInvoice?.guardian?.phone);
        let referenceLink = String(latestInvoice?.invoiceReferenceLink || '').trim();
        let invoiceSlug = String(latestInvoice?.invoiceSlug || '').trim();

        if (!phone || !referenceLink || !invoiceSlug) {
          try {
            const { data: detailRes } = await api.get(`/invoices/${invoiceId}`);
            const fetched = detailRes?.invoice || detailRes;
            if (fetched && typeof fetched === 'object') {
              latestInvoice = fetched;
              setInvoices((prev) => (prev || []).map((inv) => (
                String(inv?._id) === String(invoiceId) ? { ...inv, ...fetched } : inv
              )));
            }
          } catch (detailErr) {
            console.warn('Failed to refresh invoice before WhatsApp send', detailErr?.message || detailErr);
          }

          phone = normalizeWhatsappPhone(latestInvoice?.guardian?.phone);
          referenceLink = String(latestInvoice?.invoiceReferenceLink || '').trim();
          invoiceSlug = String(latestInvoice?.invoiceSlug || '').trim();
        }

        if (!phone) {
          setToast({ show: true, type: 'error', message: 'Guardian phone is missing.' });
          return;
        }
        if (!referenceLink) {
          setToast({ show: true, type: 'error', message: 'Add the invoice reference link before sending WhatsApp.' });
          return;
        }
        if (!invoiceSlug) {
          setToast({ show: true, type: 'error', message: 'Invoice public link is not available yet.' });
          return;
        }

        const publicLink = `${window.location.origin}/public/invoices/${invoiceSlug}`;
        const message = buildWhatsappMessage(latestInvoice, publicLink);
        const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');

        const { data } = await api.post(`/invoices/${invoiceId}/send`, {
          method,
          force,
          meta: {
            referenceLink,
            publicLink,
            phone
          }
        });
        if (!data.success && !data.alreadySent) {
          alert(data.error || `Send failed (${method})`);
        }
        fetchInvoices();
        if (isAdmin()) fetchStats();
        return;
      }

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

  const isInvoiceMarkedSent = useCallback((inv) => {
    const status = String(inv?.status || '').toLowerCase();
    if (status === 'sent') return true;
    if (inv?.sentVia && inv.sentVia !== 'none') return true;
    const channels = Array.isArray(inv?.delivery?.channels) ? inv.delivery.channels : [];
    return channels.some((entry) => String(entry?.status || '').toLowerCase() === 'sent');
  }, []);

  // Realtime: subscribe to invoice socket events to reflect changes instantly
  useEffect(() => {
    if (!socket) return;
    const searchMode = Boolean((searchTerm || '').trim());

    // Comparator consistent with list ordering rules used elsewhere:
    // unpaid -> createdAt asc (oldest first)
    // other views -> paidAt desc (latest payment first, fallback createdAt)
    const invoiceComparator = (a, b) => {
      try {
        if (resolvedActiveTab === 'unpaid') {
          return new Date(a.createdAt) - new Date(b.createdAt);
        }
        return getInvoicePaymentTimestamp(b) - getInvoicePaymentTimestamp(a);
      } catch (err) {
        return 0;
      }
    };

    const matchesActiveTab = (inv) => {
      if (!inv) return false;
      if (searchMode) return true;
      if (resolvedActiveTab === 'paid') return ['paid', 'refunded'].includes(inv.status);
      if (resolvedActiveTab === 'unpaid') return !['paid', 'refunded'].includes(inv.status);
      return true;
    };

    const matchesDeliveryFilter = (inv) => {
      if (searchMode) return true;
      if (deliveryFilter === 'sent') return isInvoiceMarkedSent(inv);
      if (deliveryFilter === 'not_sent') return !isInvoiceMarkedSent(inv);
      return true;
    };

    const upsertInvoice = (updated) => {
      if (!updated || !updated._id) return;

      setInvoices((prev) => {
        const existingIdx = prev.findIndex((i) => i._id === updated._id);

        // If update no longer matches current tab, remove it if present
        const doesMatch = matchesActiveTab(updated) && matchesDeliveryFilter(updated);
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
    const onRefunded = (payload) => {
      try { upsertInvoice(payload?.invoice); } catch (_) {}
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
    socket.on('invoice:refunded', onRefunded);
    socket.on('invoice:permanentlyDeleted', onPermanentlyDeleted);

    return () => {
      try {
        socket.off('invoice:created', onCreated);
        socket.off('invoice:updated', onUpdated);
        socket.off('invoice:paid', onPaid);
        socket.off('invoice:refunded', onRefunded);
        socket.off('invoice:permanentlyDeleted', onPermanentlyDeleted);
      } catch (_) {}
    };
  }, [socket, activeTab, searchTerm, deliveryFilter, resolvedActiveTab, isInvoiceMarkedSent]);

  const handleDownloadDocx = async (invoiceId, invoiceName) => {
    try {
      setDownloadingDocId(invoiceId);
      const { data } = await api.get(`/invoices/${invoiceId}/download-docx`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `invoice-${invoiceName || invoiceId}.docx`);
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

  const handleCopyGuardianName = useCallback(async (invoice) => {
    const guardian = invoice?.guardian || {};
    const name = `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim();
    if (!name) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(name);
      } else {
        const copied = window.prompt('Copy guardian name:', name);
        if (copied === null) {
          throw new Error('Copy cancelled');
        }
      }
      setToast({ show: true, type: 'success', message: 'Guardian name copied' });
    } catch (err) {
      console.error('Failed to copy guardian name', err);
      setToast({ show: true, type: 'error', message: 'Copy failed' });
    }
  }, []);

  const handleCopyGuardianEmail = useCallback(async (invoice) => {
    const email = String(invoice?.guardian?.email || '').trim();
    if (!email) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
      } else {
        const copied = window.prompt('Copy guardian email:', email);
        if (copied === null) {
          throw new Error('Copy cancelled');
        }
      }
      setToast({ show: true, type: 'success', message: 'Guardian email copied' });
    } catch (err) {
      console.error('Failed to copy guardian email', err);
      setToast({ show: true, type: 'error', message: 'Copy failed' });
    }
  }, []);

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

  const getInitials = (first, last) => {
    const a = (first || '').trim()[0] || '';
    const b = (last || '').trim()[0] || '';
    return (a + b).toUpperCase() || 'G';
  };

  // Inline billing window computed from classes with the same accuracy as the modal
  const BillingWindowInline = React.useMemo(() => {
    return function BillingWindowInline({ invoice, bare = false, overrideRange = null }) {
      if (!invoice) return null;

      if (overrideRange && (overrideRange.start || overrideRange.end)) {
        const start = overrideRange.start || null;
        const end = overrideRange.end || null;

        return (
          <span className="inline-flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            <span>
              {bare ? (
                <>
                  {start || '—'} {'→'} {end || '—'}
                </>
              ) : (
                <>
                  From {start || '—'} {'-To→'} {end || '—'}
                </>
              )}
            </span>
          </span>
        );
      }

      const entries = resolveInvoiceClassEntries(invoice);
      const items = Array.isArray(entries?.items) ? entries.items : [];
      const itemDates = items
        .map((it) => {
          const dt = it?.date || it?.scheduledDate || it?.class?.scheduledDate || it?.class?.dateTime;
          const date = dt ? new Date(dt) : null;
          return date && !Number.isNaN(date.getTime()) ? date : null;
        })
        .filter(Boolean);

      const fallbackStart = invoice?.billingPeriod?.startDate
        || invoice?.billingPeriod?.start
        || invoice?.billingPeriod?.start_date
        || invoice?.startDate
        || invoice?.createdAt
        || null;
      const fallbackEnd = invoice?.coverage?.endDate
        || invoice?.endDate
        || invoice?.billingPeriod?.endDate
        || invoice?.billingPeriod?.end
        || invoice?.billingPeriod?.end_date
        || null;

      const startDate = fallbackStart
        ? new Date(fallbackStart)
        : (itemDates.length ? new Date(Math.min(...itemDates.map((d) => d.getTime()))) : null);
      const endDate = fallbackEnd
        ? new Date(fallbackEnd)
        : (itemDates.length ? new Date(Math.max(...itemDates.map((d) => d.getTime()))) : null);

      const start = startDate && !Number.isNaN(startDate.getTime()) ? formatDate(startDate) : null;
      const end = endDate && !Number.isNaN(endDate.getTime()) ? formatDate(endDate) : null;

      if (!start && !end) return null;

      return (
        <span className="inline-flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-400" />
          <span>
            {bare ? (
              <>
                {start || '—'} {'→'} {end || '—'}
              </>
            ) : (
              <>
                From {start || '—'} {'-To→'} {end || '—'}
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
        return <TimerReset className={iconClass} />;
      case 'draft':
      default:
        return <FileText className={iconClass} />;
    }
  };

  const getUnpaidSortWeight = (inv) => {
    const status = (inv?.status || '').toLowerCase();
    const order = ['draft', 'pending', 'sent', 'overdue'];
    const idx = order.indexOf(status);
    return idx === -1 ? order.length : idx;
  };

  // When the server returns filtered/sorted results we should preserve that
  // ordering and avoid re-sorting here. We still apply client-side search and
  // type filtering for quick UI responsiveness.
  const filteredInvoices = useMemo(() => {
    let result = (invoices || []);
    const searchMode = Boolean(normalizedSearchTerm);

    // Apply the effective status filter: the active tab takes precedence.
    const effectiveStatus = resolvedActiveTab !== 'all' ? resolvedActiveTab : statusFilter;
    if (!searchMode && effectiveStatus !== 'all') {
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

    if (deliveryFilter === 'sent') {
      result = result.filter((inv) => isInvoiceMarkedSent(inv));
    } else if (deliveryFilter === 'not_sent') {
      result = result.filter((inv) => !isInvoiceMarkedSent(inv));
    }

    if (typeFilter !== 'all') {
      const normalizedType = typeFilter.toLowerCase();
      result = result.filter((inv) => {
        const invoiceType = (inv.type || inv.invoiceType || '').toLowerCase();
        return invoiceType === normalizedType;
      });
    }

    // Client-side search (Excel-like) over the already-loaded invoices.
    if (normalizedSearchTerm) {
      result = result.filter((inv) => {
        const guardian = inv.guardian || {};
        const guardianName = `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim();
        const haystack = [
          inv.invoiceNumber,
          inv.invoiceName,
          inv.invoiceSlug,
          inv.status,
          inv.type,
          guardianName,
          guardian.email,
          guardian.phone,
          String(inv._id || ''),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedSearchTerm);
      });
    }

    return result;
  }, [invoices, resolvedActiveTab, statusFilter, typeFilter, normalizedSearchTerm, deliveryFilter, isInvoiceMarkedSent]);

  // Ensure consistent ordering client-side as a fallback in case backend doesn't apply requested sort.
  const displayedInvoices = useMemo(() => {
    const list = (filteredInvoices || []).slice();
    const searchMode = Boolean(normalizedSearchTerm);

    // Universal sort: most recent invoice first (by sequence number, then first date)
    const recentFirst = (a, b) => getInvoiceRecencyKey(b) - getInvoiceRecencyKey(a);
    // Invoices with a reference link (WA-ready) sort after those without
    const hasLink = (inv) => String(inv?.invoiceReferenceLink || '').trim().length > 0 ? 1 : 0;
    const linkTiebreak = (a, b) => hasLink(a) - hasLink(b);

    if (searchMode || resolvedActiveTab === 'all') {
      const isPaid = (invoice) => ['paid', 'refunded'].includes(String(invoice?.status || '').toLowerCase());
      list.sort((a, b) => {
        const aPaid = isPaid(a);
        const bPaid = isPaid(b);
        if (aPaid !== bPaid) return aPaid ? 1 : -1;
        const ld = linkTiebreak(a, b);
        if (ld !== 0) return ld;
        return recentFirst(a, b);
      });
      return list;
    }

    if (resolvedActiveTab === 'unpaid') {
      list.sort((a, b) => {
        const weightDiff = getUnpaidSortWeight(a) - getUnpaidSortWeight(b);
        if (weightDiff !== 0) return weightDiff;
        const ld = linkTiebreak(a, b);
        if (ld !== 0) return ld;
        return recentFirst(a, b);
      });
    } else {
      list.sort((a, b) => {
        const ld = linkTiebreak(a, b);
        if (ld !== 0) return ld;
        return recentFirst(a, b);
      });
    }
    return list;
  }, [filteredInvoices, resolvedActiveTab]);

  const bulk = useBulkSelect(displayedInvoices);

  const bulkWhatsappCandidates = useMemo(() => {
    return (displayedInvoices || []).map((invoice) => {
      const phone = normalizeWhatsappPhone(invoice?.guardian?.phone);
      const referenceLink = String(invoice?.invoiceReferenceLink || '').trim();
      const invoiceSlug = String(invoice?.invoiceSlug || '').trim();
      const publicLink = invoiceSlug ? `${window.location.origin}/public/invoices/${invoiceSlug}` : '';
      const ready = Boolean(phone && referenceLink && invoiceSlug);
      return {
        invoice,
        invoiceId: invoice?._id,
        guardianName: `${invoice?.guardian?.firstName || ''} ${invoice?.guardian?.lastName || ''}`.trim() || 'Guardian',
        phone,
        referenceLink,
        invoiceSlug,
        publicLink,
        ready
      };
    }).filter((row) => row.invoiceId);
  }, [displayedInvoices]);

  const handlePrepareBulkDrafts = useCallback(() => {
    const rows = bulkWhatsappCandidates.map((row) => {
      const message = buildWhatsappMessage(row.invoice, row.publicLink, { composer: bulkComposer });
      return {
        ...row,
        message,
      };
    });
    setBulkDraftRows(rows);
    setToast({ show: true, type: 'success', message: `Prepared ${rows.length} draft messages.` });
  }, [bulkWhatsappCandidates, buildWhatsappMessage, bulkComposer]);

  const handleSendBulkWhatsapp = useCallback(async () => {
    const rows = (bulkDraftRows.length ? bulkDraftRows : bulkWhatsappCandidates.map((row) => ({
      ...row,
      message: buildWhatsappMessage(row.invoice, row.publicLink, { composer: bulkComposer })
    })));

    const readyRows = rows.filter((row) => row.ready);
    if (!readyRows.length) {
      setToast({ show: true, type: 'error', message: 'No ready invoices to send. Please ensure phone, link, and public invoice link are available.' });
      return;
    }

    setBulkSending(true);
    let sentCount = 0;
    let failedCount = 0;

    try {
      for (const row of readyRows) {
        try {
          if (bulkOpenWhatsappChats) {
            const whatsappUrl = `https://wa.me/${row.phone}?text=${encodeURIComponent(row.message)}`;
            window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
          }

          if (bulkIncludeMarkSent) {
            await api.post(`/invoices/${row.invoiceId}/send`, {
              method: 'whatsapp',
              force: true,
              meta: {
                referenceLink: row.referenceLink,
                publicLink: row.publicLink,
                phone: row.phone,
                bulk: true
              }
            });
          }

          sentCount += 1;
        } catch (rowErr) {
          failedCount += 1;
          console.warn('Bulk WhatsApp send failed for invoice', row.invoiceId, rowErr?.message || rowErr);
        }
      }

      fetchInvoices();
      if (isAdmin()) fetchStats();
      setToast({
        show: true,
        type: failedCount ? 'error' : 'success',
        message: failedCount
          ? `Bulk send completed: ${sentCount} sent, ${failedCount} failed.`
          : `Bulk send completed: ${sentCount} sent.`
      });
    } finally {
      setBulkSending(false);
    }
  }, [bulkDraftRows, bulkWhatsappCandidates, buildWhatsappMessage, bulkComposer, bulkOpenWhatsappChats, bulkIncludeMarkSent, fetchInvoices, isAdmin, fetchStats]);

  const insertComposerToken = useCallback((editorRef, key) => {
    const token = `{{${key}}}`;
    const node = editorRef?.current;
    if (!node) return;

    const value = String(node.value || '');
    const start = Number(node.selectionStart ?? value.length);
    const end = Number(node.selectionEnd ?? value.length);
    const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;

    const stateKey = node.getAttribute('data-composer-key');
    if (!stateKey) return;

    setBulkComposer((prev) => ({ ...prev, [stateKey]: nextValue }));
    requestAnimationFrame(() => {
      try {
        node.focus();
        const caret = start + token.length;
        node.setSelectionRange(caret, caret);
      } catch (e) {
        // ignore selection errors
      }
    });
  }, []);

  useEffect(() => {
    const visible = (displayedInvoices || []).slice(0, itemsPerPage);
    if (!visible.length) return;

    let cancelled = false;

    const buildSignature = (inv) => {
      const maxHours = Number(inv?.coverage?.maxHours || 0);
      const endDate = inv?.coverage?.endDate || '';
      const updatedAt = inv?.updatedAt || '';
      const paidAmount = Number(inv?.paidAmount || 0);
      return `${updatedAt}|${maxHours}|${endDate}|${paidAmount}`;
    };

    const fetchOverridesFromCache = async () => {
      const targets = visible.filter((inv) => {
        const nextSignature = buildSignature(inv);
        const cached = cardOverrides[inv._id];
        return !cached || cached.signature !== nextSignature;
      });

      if (!targets.length) return;

      const updates = {};
      await Promise.all(targets.map(async (inv) => {
        try {
            const cacheKey = makeCacheKey('invoices:detail', user?._id, { id: inv._id });
            const cached = readCache(cacheKey, { deps: ['invoices'] });
            const fullInvoice = cached.hit ? (cached.value?.invoice || null) : null;
            if (!fullInvoice) return;
            const computed = computeInvoiceTotals(fullInvoice);

            const entries = resolveInvoiceClassEntries(fullInvoice);
            const items = Array.isArray(entries?.items) ? entries.items : [];
            const itemDates = items
              .map((it) => {
                const dt = it?.date || it?.scheduledDate || it?.class?.scheduledDate || it?.class?.dateTime;
                const date = dt ? new Date(dt) : null;
                return date && !Number.isNaN(date.getTime()) ? date : null;
              })
              .filter(Boolean);

            const fallbackStart = fullInvoice?.billingPeriod?.startDate
              || fullInvoice?.billingPeriod?.start
              || fullInvoice?.billingPeriod?.start_date
              || fullInvoice?.startDate
              || fullInvoice?.createdAt
              || null;
            const fallbackEnd = fullInvoice?.coverage?.endDate
              || fullInvoice?.endDate
              || fullInvoice?.billingPeriod?.endDate
              || fullInvoice?.billingPeriod?.end
              || fullInvoice?.billingPeriod?.end_date
              || null;

            const startDate = fallbackStart
              ? new Date(fallbackStart)
              : (itemDates.length ? new Date(Math.min(...itemDates.map((d) => d.getTime()))) : null);
            const endDate = fallbackEnd
              ? new Date(fallbackEnd)
              : (itemDates.length ? new Date(Math.max(...itemDates.map((d) => d.getTime()))) : null);

            const start = startDate && !Number.isNaN(startDate.getTime()) ? formatDate(startDate) : null;
            const end = endDate && !Number.isNaN(endDate.getTime()) ? formatDate(endDate) : null;

            updates[inv._id] = {
              signature: buildSignature(inv),
              total: Number(computed?.total || 0),
              hours: Number(computed?.hours || 0),
              paid: Number(computed?.paid || 0),
              start,
              end,
            };
          } catch (_) {
            // Keep fallback values from list payload when detail fetch fails.
          }
        }));

      if (cancelled || !Object.keys(updates).length) return;
      setCardOverrides((prev) => ({ ...prev, ...updates }));
    };

    fetchOverridesFromCache();

    return () => {
      cancelled = true;
    };
  }, [displayedInvoices, itemsPerPage, formatDate, cardOverrides, user?._id]);

  useEffect(() => {
    // Idle-viewport prefetching intentionally disabled to reduce backend load.
    // Invoices are still prefetched on hover and on open.
  }, [isActive, displayedInvoices, showLoading, user?._id, prefetchInvoiceDetail]);


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
              endDate: update.coverage.endDate ?? update.coverage.customEndDate ?? inv.coverage?.endDate,
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
    const hasReferenceLink = String(invoice?.invoiceReferenceLink || '').trim().length > 0;
    const missingWhatsappLink = channel === 'whatsapp' && !hasReferenceLink;
    const isDisabled = isLoading || missingWhatsappLink;
    const isSent = info?.status === 'sent';
    const sentLabel = (() => {
      // derive a compact sent label like 'Email sent' from 'by Email'
      if (/^by\s+/i.test(label)) return `${label.replace(/^by\s+/i, '')} sent`;
      if (/^via\s+/i.test(label)) return `${label.replace(/^via\s+/i, '')} sent`;
      return `${label} sent`;
    })();

    return (
      <button
        onClick={() => handleQuickSend(invoice, channel, isSent)}
        disabled={isDisabled}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 ${
          isDisabled
            ? 'cursor-not-allowed text-slate-300'
            :
          isSent
            ? 'text-emerald-600 hover:bg-slate-100'
            : channel === 'email'
              ? 'text-blue-600 hover:bg-slate-100'
              : 'text-green-600 hover:bg-slate-100'
        }`}
        type="button"
        aria-label={isSent ? sentLabel : `Send ${label}`}
        title={missingWhatsappLink ? 'Add invoice reference link before sending WhatsApp' : (isSent ? sentLabel : `Send ${label}`)}
      >
        {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className="mx-auto w-full max-w-7xl px-6 py-8 space-y-8">
        {isAdmin() && stats && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: 'Monthly revenue',
                value: formatCurrency(stats.monthlyRevenue || 0),
                icon: DollarSign,
                tone: 'border-t-2 border-t-emerald-500 text-emerald-600'
              },
              {
                label: 'Paid invoices',
                value: stats.paidInvoices ?? '--',
                icon: CheckCircle2,
                tone: 'border-t-2 border-t-blue-500 text-blue-600'
              },
              {
                label: 'Pending review',
                value: stats.pendingInvoices ?? '--',
                icon: TimerReset,
                tone: 'border-t-2 border-t-amber-500 text-amber-600'
              },
              {
                label: 'Zero-hour guardians',
                value: stats.zeroHourStudents ?? '--',
                icon: Users,
                tone: 'border-t-2 border-t-violet-500 text-violet-600'
              }
            ].map(({ label, value, icon: StatIcon, tone }) => (
              <div
                key={label}
                className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${tone}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-50">
                    <StatIcon className="h-4 w-4" />
                  </span>
                </div>
                <div className="mt-3 text-2xl font-bold text-slate-900">{value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100/80 p-1">
              {[
                { key: 'unpaid', label: 'Unpaid' },
                { key: 'paid', label: 'Paid' },
                { key: 'all', label: 'All' }
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setActiveTab(key); bulk.clearSelection(); }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
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
            <div className="inline-flex items-center gap-1 rounded-full bg-slate-100/80 p-1">
              {[
                { key: 'sent', label: 'Sent' },
                { key: 'not_sent', label: 'Not sent' }
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setDeliveryFilter((prev) => (prev === key ? '' : key)); bulk.clearSelection(); }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    deliveryFilter === key
                      ? 'bg-white text-slate-900 shadow'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {isAdmin() && (
              <ExportExcelButton onExport={async () => {
                const params = { limit: 10000 };
                const resolvedTab = activeTab || 'all';
                if (resolvedTab !== 'all') { params.status = resolvedTab; }
                else if (statusFilter !== 'all') { params.status = statusFilter; }
                if (typeFilter !== 'all') params.type = typeFilter;
                if (segmentFilter !== 'all') params.segment = segmentFilter;
                if (normalizedSearchTerm) params.search = normalizedSearchTerm;
                const data = await fetchAllForExport('/invoices', params);
                await downloadExcel((data.invoices || []).map(mapInvoiceRow), `invoices-${resolvedTab}`);
              }} />
            )}
            {isAdmin() && (
              <button
                type="button"
                onClick={() => setBulkWhatsappOpen(true)}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50"
                title="Prepare or send WhatsApp messages for all visible invoices"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Bulk WhatsApp
              </button>
            )}
            {isAdmin() && (
              <button
                type="button"
                onClick={bulk.toggleSelectionMode}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  bulk.selectionMode
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
                title={bulk.selectionMode ? 'Exit selection mode' : 'Select invoices for bulk actions'}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {bulk.selectionMode ? 'Exit select' : 'Select'}
              </button>
            )}
          </div>

          {bulk.selectionMode && (
            <div className="mt-3">
              <BulkActionBar
                selectedCount={bulk.selectedCount}
                isAllSelected={bulk.isAllSelected}
                onSelectAll={bulk.selectAll}
                onExit={() => { bulk.clearSelection(); bulk.toggleSelectionMode(); }}
              >
                <button type="button" onClick={handleBulkSend} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                  className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-40">
                  <Send className="h-3 w-3" /> Send
                </button>
                <button type="button" onClick={handleBulkCancel} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-40">
                  <XCircle className="h-3 w-3" /> Cancel
                </button>
                <button type="button" onClick={handleBulkDelete} disabled={bulk.selectedCount === 0 || bulkActionLoading}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-40">
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </BulkActionBar>
            </div>
          )}
          {error && (
            <div className="mt-6 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-600">
              {error}
            </div>
          )}

          <div className="mt-6 space-y-4">
            {showLoading && displayedInvoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 py-16 text-center text-slate-500">
                <CircleSpinner size="lg" />
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
                const override = cardOverrides[invoice._id] || null;
                
                const computed = computeInvoiceTotals(invoice);
                const storedTotalCandidates = [invoice?.adjustedTotal, invoice?.total, invoice?.amount]
                  .map((value) => Number(value))
                  .filter((value) => Number.isFinite(value) && value >= 0);
                const invoiceTotal = Number.isFinite(override?.total)
                  ? Number(override.total)
                  : (storedTotalCandidates.length > 0 ? storedTotalCandidates[0] : computed.total);

                const storedHoursCandidates = [invoice?.hoursCovered, invoice?.paidHours, invoice?.hoursPaid]
                  .map((value) => Number(value))
                  .filter((value) => Number.isFinite(value) && value >= 0);
                const invoiceHours = Number.isFinite(override?.hours)
                  ? Number(override.hours)
                  : (storedHoursCandidates.length > 0 ? storedHoursCandidates[0] : Number(computed.hours || 0));

                const paidAmount = Number.isFinite(override?.paid)
                  ? Number(override.paid)
                  : (Number.isFinite(Number(invoice?.paidAmount)) ? Number(invoice.paidAmount) : computed.paid);
                const isPaidStatus = ['paid', 'refunded'].includes(invoice.status);
                const primaryAmount = isPaidStatus && paidAmount > 0 ? paidAmount : invoiceTotal;
                const primaryLabel = isPaidStatus ? 'Paid' : 'Total';
                
                const emailChannel = getChannelInfo(invoice, 'email');
                const whatsappChannel = getChannelInfo(invoice, 'whatsapp');

                return (
                  <div
                    key={invoice._id}
                    ref={(node) => setInvoiceCardRef(invoice._id, node)}
                    className={`rounded-xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${bulk.selectionMode && bulk.selected.has(invoice._id) ? 'border-indigo-300 ring-2 ring-indigo-200' : 'border-slate-100'}`}
                  >
                    <div className="flex flex-col gap-3 p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        {bulk.selectionMode && (
                          <button
                            type="button"
                            onClick={() => bulk.toggleItem(invoice._id)}
                            className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 transition hover:border-indigo-400"
                            aria-label={bulk.selected.has(invoice._id) ? 'Deselect' : 'Select'}
                          >
                            {bulk.selected.has(invoice._id) && (
                              <CheckSquare className="h-4 w-4 text-indigo-600" />
                            )}
                          </button>
                        )}
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <Badge tone={statusTone} pill title={getStatusTooltip(invoice.status)} aria-label={getStatusTooltip(invoice.status)}>
                              {getStatusIcon(invoice.status)}
                              <span className="capitalize">{invoice.status || 'draft'}</span>
                            </Badge>
                            <span className="text-sm font-semibold text-slate-700">{invoice.invoiceName || 'Invoice'}</span>
                            {invoice.sentVia && invoice.sentVia !== 'none' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                                <BadgeCheck className="h-3.5 w-3.5" />
                                Sent via {invoice.sentVia}
                              </span>
                            )}
                          </div>
                          <div className="space-y-1.5 text-sm text-slate-600">
                            <div className="flex flex-wrap items-center gap-3">
                              <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-slate-700">
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                                  {getInitials(invoice.guardian?.firstName, invoice.guardian?.lastName)}
                                </span>
                                <div className="inline-flex min-w-0 items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleCopyGuardianName(invoice)}
                                    className="truncate rounded-md px-1 py-0.5 text-left text-slate-700 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                    title="Copy guardian name"
                                  >
                                    {invoice.guardian?.firstName} {invoice.guardian?.lastName}
                                  </button>
                                  {invoice.guardian?.email && (
                                    <button
                                      type="button"
                                      onClick={() => handleCopyGuardianEmail(invoice)}
                                      className="truncate rounded-md px-1 py-0.5 text-left text-xs text-slate-400 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                                      title="Copy guardian email"
                                    >
                                      • {invoice.guardian.email}
                                    </button>
                                  )}
                                </div>
                              </span>
                              
                              <span className="inline-flex items-center gap-x-2 gap-y-1 whitespace-nowrap text-sm text-slate-700">
                                <span className="font-medium">{primaryLabel}: {formatCurrency(primaryAmount)}</span>
                                <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-block" />
                                <span>Hours: <span className="font-medium">{invoiceHours.toFixed(2)}</span></span>
                                <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-block" />
                                <BillingWindowInline
                                  key={`${invoice._id}-${invoice.coverage?.maxHours || 0}-${invoice.coverage?.endDate || ''}`}
                                  invoice={invoice}
                                  bare
                                  overrideRange={override ? { start: override.start, end: override.end } : null}
                                />
                              </span>
                            </div>
                            
                          </div>
                        </div>

                        <div className="shrink-0 flex flex-col items-start gap-3 lg:items-end">
                          <div className="flex flex-nowrap gap-2">
                            {renderChannelButton(invoice, 'email', 'Email', Mail)}
                            {renderChannelButton(invoice, 'whatsapp', 'WhatsApp', MessageCircle)}
                            <button
                              onClick={() => handleDownloadDocx(invoice._id, invoice.invoiceName || invoice.invoiceNumber)}
                              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-indigo-600 transition hover:bg-slate-100 hover:text-indigo-700"
                              type="button"
                              title="Download DOCX"
                              aria-label="Download DOCX"
                            >
                              {downloadingDocId === invoice._id ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <FileText className="h-4 w-4" />
                              )}
                            </button>
                          </div>

                          <div className="flex flex-nowrap gap-2">
                            <button
                              onClick={() => openModal('view', invoice)}
                              onMouseEnter={() => handleInvoiceActionHover(invoice)}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-sky-600 transition hover:bg-slate-100 hover:text-sky-700"
                              type="button"
                              title="Preview invoice"
                            >
                              <Eye className="h-5 w-5" />
                            </button>
                            {isAdmin() && (
                              <>
                                <button
                                  onClick={() => openModal('payment', invoice)}
                                  onMouseEnter={() => handleInvoiceActionHover(invoice)}
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-emerald-600 transition hover:bg-slate-100 hover:text-emerald-700"
                                  type="button"
                                  title="Record payment"
                                >
                                  <CreditCard className="h-5 w-5" />
                                </button>
                                <button
                                  onClick={() => handleCopyShareLink(invoice)}
                                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition ${
                                    copiedInvoiceId === invoice._id
                                      ? 'text-emerald-600 bg-slate-100'
                                      : 'text-violet-600 hover:bg-slate-100 hover:text-violet-700'
                                  }`}
                                  type="button"
                                  aria-label="Copy shareable link"
                                  title="Copy share link"
                                >
                                  <Link2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteInvoice(invoice)}
                                  className="inline-flex h-11 w-11 items-center justify-center rounded-full text-rose-500 transition hover:bg-slate-100 hover:text-rose-700"
                                  type="button"
                                >
                                  <XCircle className="h-4 w-4" />
                                </button>
                                {invoice.status === 'sent' && (
                                  <button
                                    onClick={() => handleCancelInvoice(invoice._id)}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-amber-500 transition hover:bg-slate-100 hover:text-amber-700"
                                    type="button"
                                  >
                                    <XCircle className="h-4 w-4" />
                                  </button>
                                )}
                                {['paid', 'sent', 'overdue'].includes(invoice.status) && (
                                  <button
                                    onClick={() => openModal('refund', invoice)}
                                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-violet-500 transition hover:bg-slate-100 hover:text-violet-700"
                                    type="button"
                                  >
                                    <RefreshCw className="h-4 w-4" />
                                  </button>
                                )}
                              </>
                            )}
                            {!isAdmin() && (
                              <button
                                onClick={() => handleCopyShareLink(invoice)}
                                className={`inline-flex h-11 w-11 items-center justify-center rounded-full transition ${
                                  copiedInvoiceId === invoice._id
                                    ? 'text-emerald-600 bg-slate-100'
                                    : 'text-violet-600 hover:bg-slate-100 hover:text-violet-700'
                                }`}
                                type="button"
                                aria-label="Copy shareable link"
                                title="Copy share link"
                              >
                                <Link2 className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => toggleExpanded(invoice._id)}
                              className="inline-flex items-center justify-center rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                              type="button"
                            >
                              {expandedInvoice === invoice._id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {expandedInvoice === invoice._id && (
                        <div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 p-4 md:grid-cols-2">
                          <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white/70 p-3">
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
                                  </div>
                                  
                                </div>
                              </div>
                              <div className="pt-2">
                                <p className="font-medium text-slate-700">Notes</p>
                                <p className="text-sm text-slate-600">{invoice.notes ? invoice.notes : '—'}</p>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-white/70 p-3">
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
          initialInvoice={modalInvoiceSeed || invoices.find(inv => inv._id === modalState.invoiceId) || null}
          onOpenRecordPayment={(invoiceLike) => openModal('payment', invoiceLike || modalInvoiceSeed || modalState.invoiceId)}
          onClose={() => closeModal(true)}
          onInvoiceUpdate={handleInvoiceUpdate}
        />
      )}
      {modalState.type === 'payment' && (
        <RecordPaymentModal
          invoice={modalInvoiceSeed || invoices.find(inv => inv._id === modalState.invoiceId) || null}
          invoiceId={modalState.invoiceId}
          onOpenInvoiceOverview={(invoiceLike) => openModal('view', invoiceLike || modalInvoiceSeed || modalState.invoiceId)}
          onClose={() => closeModal()}
          onUpdated={(payload) => {
            // success toast and refresh list/stats
            if (payload?.invoice) {
              setModalInvoiceSeed(payload.invoice);
            }
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
      {createInvoiceOpen && (
        <CreateGuardianInvoiceModal
          open={createInvoiceOpen}
          onClose={() => setCreateInvoiceOpen(false)}
          onCreated={() => {
            setToast({ show: true, type: 'success', message: 'Invoice created' });
            fetchInvoices();
            if (isAdmin()) fetchStats();
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
      {bulkWhatsappOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/30 to-emerald-50/30 shadow-2xl">
            <div className="flex items-center justify-between border-b border-indigo-100 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Bulk WhatsApp for visible invoices</h3>
                <p className="text-xs text-slate-500">Build one smart template with tags, then apply it to all ready invoices.</p>
              </div>
              <button type="button" onClick={() => setBulkWhatsappOpen(false)} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:text-slate-900">Close</button>
            </div>
            <div className="grid gap-4 overflow-y-auto px-6 py-5 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <div className="rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-600">1) Greeting</div>
                  <textarea
                    ref={greetingEditorRef}
                    data-composer-key="greeting"
                    value={bulkComposer.greeting}
                    onChange={(e) => setBulkComposer((prev) => ({ ...prev, greeting: e.target.value }))}
                    rows={2}
                    className="w-full rounded-xl border border-indigo-100 px-3 py-2 text-sm focus:border-indigo-300 focus:outline-none"
                    placeholder="Greeting line"
                  />
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-white/90 p-4 shadow-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">2) Body</div>
                  <label className="text-xs text-slate-600">Extra message (optional)</label>
                  <textarea
                    ref={bodyIntroEditorRef}
                    data-composer-key="bodyIntro"
                    value={bulkComposer.bodyIntro}
                    onChange={(e) => setBulkComposer((prev) => ({ ...prev, bodyIntro: e.target.value }))}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-emerald-100 px-3 py-2 text-sm focus:border-emerald-300 focus:outline-none"
                    placeholder="Optional extra message"
                  />

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                      <label className="text-xs text-slate-600">Message block 1</label>
                      <textarea
                        ref={bodyMessage1EditorRef}
                        data-composer-key="bodyMessage1"
                        value={bulkComposer.bodyMessage1}
                        onChange={(e) => setBulkComposer((prev) => ({ ...prev, bodyMessage1: e.target.value }))}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-emerald-100 px-3 py-2 text-sm focus:border-emerald-300 focus:outline-none"
                      />
                      <label className="mt-2 block text-xs text-slate-600">Link 1 type</label>
                      <select
                        value={bulkComposer.bodyLink1Type}
                        onChange={(e) => setBulkComposer((prev) => ({ ...prev, bodyLink1Type: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm"
                      >
                        <option value="paypal">PayPal link</option>
                        <option value="invoice">Invoice link</option>
                      </select>
                    </div>

                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                      <label className="text-xs text-slate-600">Message block 2</label>
                      <textarea
                        ref={bodyMessage2EditorRef}
                        data-composer-key="bodyMessage2"
                        value={bulkComposer.bodyMessage2}
                        onChange={(e) => setBulkComposer((prev) => ({ ...prev, bodyMessage2: e.target.value }))}
                        rows={2}
                        className="mt-1 w-full rounded-lg border border-emerald-100 px-3 py-2 text-sm focus:border-emerald-300 focus:outline-none"
                      />
                      <label className="mt-2 block text-xs text-slate-600">Link 2 type</label>
                      <select
                        value={bulkComposer.bodyLink2Type}
                        onChange={(e) => setBulkComposer((prev) => ({ ...prev, bodyLink2Type: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm"
                      >
                        <option value="paypal">PayPal link</option>
                        <option value="invoice">Invoice link</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-violet-100 bg-white/90 p-4 shadow-sm">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-600">3) End message</div>
                  <textarea
                    ref={endMessageEditorRef}
                    data-composer-key="endMessage"
                    value={bulkComposer.endMessage}
                    onChange={(e) => setBulkComposer((prev) => ({ ...prev, endMessage: e.target.value }))}
                    rows={2}
                    className="w-full rounded-xl border border-violet-100 px-3 py-2 text-sm focus:border-violet-300 focus:outline-none"
                    placeholder="Closing message"
                  />
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                  <p className="text-xs font-medium text-slate-600">Send options</p>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={bulkIncludeMarkSent} onChange={(e) => setBulkIncludeMarkSent(e.target.checked)} />
                      Mark invoices as sent
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={bulkOpenWhatsappChats} onChange={(e) => setBulkOpenWhatsappChats(e.target.checked)} />
                      Open WhatsApp chats
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-100 bg-white/95 p-4 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">Variable tags</p>
                  <p className="mt-1 text-xs text-slate-500">Insert variables into any editor field as text tags.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => insertComposerToken(greetingEditorRef, 'guardianEpithet')} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">{'{{guardianEpithet}}'}</button>
                    <button type="button" onClick={() => insertComposerToken(greetingEditorRef, 'guardianFirstName')} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">{'{{guardianFirstName}}'}</button>
                    <button type="button" onClick={() => insertComposerToken(bodyIntroEditorRef, 'studentTargets')} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">{'{{studentTargets}}'}</button>
                    <button type="button" onClick={() => insertComposerToken(bodyIntroEditorRef, 'youOrGuardian')} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">{'{{youOrGuardian}}'}</button>
                    <button type="button" onClick={() => insertComposerToken(bodyMessage1EditorRef, 'paypalLink')} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">{'{{paypalLink}}'}</button>
                    <button type="button" onClick={() => insertComposerToken(bodyMessage2EditorRef, 'publicLink')} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">{'{{publicLink}}'}</button>
                    <button type="button" onClick={() => insertComposerToken(endMessageEditorRef, 'guardianFirstName')} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">{'{{guardianFirstName}}'}</button>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white/95">
                  <div className="border-b border-slate-200 px-3 py-2 text-xs text-slate-600">
                    Visible invoices: {bulkWhatsappCandidates.length} • Ready: {bulkWhatsappCandidates.filter((r) => r.ready).length}
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {bulkWhatsappCandidates.map((row) => (
                      <div key={row.invoiceId} className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{row.guardianName} • {row.invoice?.invoiceNumber || row.invoice?.invoiceName || row.invoiceId}</p>
                          <p className="truncate text-slate-500">{row.referenceLink || 'No PayPal link'}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                          {row.ready ? 'Ready' : 'Missing data'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-indigo-100 bg-white/80 px-6 py-4">
              <button
                type="button"
                onClick={handlePrepareBulkDrafts}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                disabled={bulkSending}
              >
                Prepare drafts
              </button>
              <button
                type="button"
                onClick={handleSendBulkWhatsapp}
                className="rounded-xl bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                disabled={bulkSending}
              >
                {bulkSending ? 'Sending…' : 'Send to all ready guardians'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Floating action buttons (bottom-right) */}
      {isAdmin() && (
        <div ref={fabRef} className="fixed bottom-8 right-6 z-50 flex items-end">
          <div className="relative flex flex-col items-end">
            {/* Animated cluster items (appear when fabOpen=true) */}
            <div className="flex flex-col items-end gap-3 mb-2">
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
                  onClick={() => { setFabOpen(false); setCreateInvoiceOpen(true); }}
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
          if (action === 'delete') {
            const forceFlag = !!confirmModal.forceDelete;
            startDeleteCountdown({
              message: confirmModal.countdownMessage || 'Deleting invoice',
              onDelete: () => performDeleteInvoice(id, forceFlag),
              preDelaySeconds: 0,
              undoSeconds: 3
            });
          }
          else if (action === 'cancel') await performCancelInvoice(id);
        }}
      />
    </div>
  );
};

export default InvoicesPage;
