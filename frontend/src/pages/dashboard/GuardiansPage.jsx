/**
 * Guardians Page Component
 * 
 * Displays a searchable, filterable, and sortable list of guardians.
 * Includes detailed view with collapsible information, linked students, and payment info.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';
import { useNavigate } from 'react-router-dom';
import { formatDateDDMMMYYYY } from '../../utils/date';
import { 
  ChevronDown, 
  ChevronUp, 
  MessageCircle, 
  User, 
  Clock, 
  Globe,
  Mail, 
  Phone, 
  MapPin, 
  Users, 
  CreditCard, 
  UserX, 
  UserCheck, 
  LogIn,
  DownloadCloud,
  X,
  Baby,
  Edit
} from 'lucide-react';
import ProfileEditModal from '../../components/dashboard/ProfileEditModal';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import useMinLoading from '../../components/ui/useMinLoading';
import api from '../../api/axios';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';

const GUARDIAN_STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'all', label: 'All' }
];

const isGuardianActive = (guardian = {}) => {
  if (typeof guardian.isActive === 'boolean') {
    return guardian.isActive;
  }
  return true;
};

const GuardiansPage = () => {
  const { isAdmin, loginAsUser } = useAuth();
  const { searchTerm, globalFilter } = useSearch();
  const navigate = useNavigate();
  const [guardians, setGuardians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const guardiansRef = useRef([]);
  const fetchGuardiansInFlightRef = useRef(false);
  const fetchGuardiansKeyRef = useRef('');
  const fetchGuardiansAbortRef = useRef(null);
  const fetchGuardiansRequestIdRef = useRef(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const sortBy = 'firstName';
  const sortOrder = 'asc';
  const [statusFilter, setStatusFilter] = useState('active');
  const [expandedGuardian, setExpandedGuardian] = useState(null);
  const [linkedStudentsByGuardianId, setLinkedStudentsByGuardianId] = useState({});
  const [linkedStudentsLoadingByGuardianId, setLinkedStudentsLoadingByGuardianId] = useState({});
  const [editingGuardian, setEditingGuardian] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 30;
  const [statusCounts, setStatusCounts] = useState({ active: 0, inactive: 0, all: 0 });
  const [hoursAdjustments, setHoursAdjustments] = useState({});
  const [legacyDrafts, setLegacyDrafts] = useState({});
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showLegacyQuick, setShowLegacyQuick] = useState(false);
  const [legacyQuickSearch, setLegacyQuickSearch] = useState('');
  const [legacyQuickGuardianId, setLegacyQuickGuardianId] = useState('');
  const [showLegacyOptions, setShowLegacyOptions] = useState(false);
  const [showAccountLogs, setShowAccountLogs] = useState(false);
  const [accountLogSearch, setAccountLogSearch] = useState('');
  const [accountLogGuardianId, setAccountLogGuardianId] = useState('');
  const [accountLogQuery, setAccountLogQuery] = useState('');
  const [showAccountOptions, setShowAccountOptions] = useState(false);
  const [accountLogs, setAccountLogs] = useState([]);
  const [accountLogsLoading, setAccountLogsLoading] = useState(false);
  const [accountLogsError, setAccountLogsError] = useState('');
  const [expandedLogEntries, setExpandedLogEntries] = useState({});
  const [logActionModal, setLogActionModal] = useState({ open: false, log: null, action: '' });
  const [logActionConfirm, setLogActionConfirm] = useState('');
  const [logActionLoading, setLogActionLoading] = useState(false);
  const showLoading = useMinLoading(loading);

  const fetchStatusCounts = useCallback(async () => {
    try {
      const baseParams = {
        role: 'guardian',
      };

      const makeRequest = (overrides = {}) => api.get('/users', {
        params: {
          ...baseParams,
          ...overrides,
          page: 1,
          limit: 1,
        },
      });

      const [allRes, activeRes, inactiveRes] = await Promise.all([
        makeRequest(),
        makeRequest({ isActive: true }),
        makeRequest({ isActive: false }),
      ]);

      setStatusCounts({
        all: allRes.data.pagination?.total ?? (allRes.data.users?.length || 0),
        active: activeRes.data.pagination?.total ?? (activeRes.data.users?.length || 0),
        inactive: inactiveRes.data.pagination?.total ?? (inactiveRes.data.users?.length || 0),
      });
    } catch (err) {
      console.warn('Failed to fetch guardian status counts', err?.message || err);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Search is client-side (Excel-like): do not reset pagination or refetch.

  useEffect(() => {
    guardiansRef.current = guardians || [];
  }, [guardians]);

  const fetchGuardians = useCallback(async () => {
    try {
      const requestSignature = JSON.stringify({
        page: currentPage,
        limit: itemsPerPage,
        statusFilter,
        sortBy,
        order: sortOrder,
      });

      if (fetchGuardiansInFlightRef.current && fetchGuardiansKeyRef.current === requestSignature) {
        return;
      }

      fetchGuardiansKeyRef.current = requestSignature;
      fetchGuardiansInFlightRef.current = true;

      const requestId = fetchGuardiansRequestIdRef.current + 1;
      fetchGuardiansRequestIdRef.current = requestId;

      if (fetchGuardiansAbortRef.current) {
        try {
          fetchGuardiansAbortRef.current.abort();
        } catch (e) {
          // ignore abort errors
        }
      }

      const controller = new AbortController();
      fetchGuardiansAbortRef.current = controller;

      const cacheKey = makeCacheKey('guardians:list', 'admin', {
        page: currentPage,
        limit: itemsPerPage,
        statusFilter,
        sortBy,
        order: sortOrder,
      });

      const cached = readCache(cacheKey, { deps: ['users', 'guardians'] });
      if (cached.hit && cached.value) {
        setGuardians(cached.value.guardians || []);
        setTotalPages(cached.value.totalPages || 1);
        if (cached.value.statusCounts) setStatusCounts(cached.value.statusCounts);
        setError('');
        setLoading(false);
        if (cached.ageMs < 60_000) {
          fetchGuardiansInFlightRef.current = false;
          return;
        }
      }

      const hasExisting = (guardiansRef.current || []).length > 0;
      setLoading(!hasExisting);
      const params = {
        role: 'guardian',
        page: currentPage,
        limit: itemsPerPage,
        sortBy,
        order: sortOrder,
      };

      if (statusFilter !== 'all') {
        params.isActive = statusFilter === 'active';
      }

      const response = await api.get('/users', { params, signal: controller.signal });
      if (requestId !== fetchGuardiansRequestIdRef.current) {
        return;
      }
      const fetched = response.data.users || [];
      const nextTotalPages = response.data.pagination?.pages || 1;
      setGuardians(fetched);
      setTotalPages(nextTotalPages);
      fetchStatusCounts();

      writeCache(
        cacheKey,
        { guardians: fetched, totalPages: nextTotalPages, statusCounts },
        { ttlMs: 5 * 60_000, deps: ['users', 'guardians'] }
      );
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        setError('Failed to fetch guardians');
        console.error('Fetch guardians error:', err);
      }
    } finally {
      setLoading(false);
      fetchGuardiansInFlightRef.current = false;
    }
  }, [currentPage, fetchStatusCounts, itemsPerPage, sortBy, sortOrder, statusFilter]);

  useEffect(() => {
    fetchGuardians();
  }, [fetchGuardians]);

  const getStudentPictureUrl = (student) => {
    if (!student) return null;
    const pic = student.profilePicture;
    if (!pic) return null;
    if (typeof pic === 'string') return pic;
    if (typeof pic === 'object') return pic.url || pic.thumbnail || null;
    return null;
  };

  const fetchLinkedStudents = useCallback(async (guardianId) => {
    if (!guardianId) return;
    if (linkedStudentsByGuardianId[guardianId]) return;
    // Prevent refetch storms
    if (linkedStudentsLoadingByGuardianId[guardianId]) return;
    setLinkedStudentsLoadingByGuardianId((prev) => ({ ...prev, [guardianId]: true }));
    try {
      const cacheKey = makeCacheKey('guardians:linkedStudents', 'admin', { guardianId });
      const cached = readCache(cacheKey, { deps: ['users', 'guardians'] });
      if (cached.hit && cached.value) {
        setLinkedStudentsByGuardianId((prev) => ({ ...prev, [guardianId]: cached.value }));
        return;
      }

      const res = await api.get(`/users/${guardianId}/students`);
      const students = res.data?.students || [];
      setLinkedStudentsByGuardianId((prev) => ({ ...prev, [guardianId]: students }));
      writeCache(cacheKey, students, { ttlMs: 10 * 60_000, deps: ['users', 'guardians'] });
    } catch (err) {
      console.warn('Failed to fetch linked students for guardian', guardianId, err?.message || err);
      // Do not hard fail the page; fallback to embedded list
      setLinkedStudentsByGuardianId((prev) => ({ ...prev, [guardianId]: null }));
    } finally {
      setLinkedStudentsLoadingByGuardianId((prev) => ({ ...prev, [guardianId]: false }));
    }
  }, [linkedStudentsLoadingByGuardianId, linkedStudentsByGuardianId]);

  const toggleExpanded = (guardianId) => {
    const next = expandedGuardian === guardianId ? null : guardianId;
    setExpandedGuardian(next);
    if (next) {
      fetchLinkedStudents(next);
    }
  };

  const setHoursAdjustmentValue = (guardianId, patch) => {
    setHoursAdjustments((prev) => {
      const existing = prev[guardianId] || { action: 'add', hours: '', reason: '' };
      return { ...prev, [guardianId]: { ...existing, ...patch } };
    });
  };

  const handleManualHoursAdjustment = async (guardianId) => {
    const draft = hoursAdjustments[guardianId] || { action: 'add', hours: '', reason: '' };
    const hoursValue = Number(draft.hours);
    if (!Number.isFinite(hoursValue)) {
      setError('Please enter a valid hours number');
      return;
    }

    try {
      await api.post(`/users/admin/guardians/${guardianId}/hours`, {
        action: draft.action,
        hours: hoursValue,
        reason: draft.reason || undefined,
      });

      setHoursAdjustments((prev) => ({
        ...prev,
        [guardianId]: { action: draft.action, hours: '', reason: '' },
      }));

      await fetchGuardians();
    } catch (err) {
      console.error('Manual guardian hours adjustment error:', err);
      setError(err?.response?.data?.message || 'Failed to update guardian hours');
    }
  };

  const setLegacyDraftValue = (guardianId, patch) => {
    setLegacyDrafts((prev) => {
      const existing = prev[guardianId] || { legacyHours: '', legacyStart: '', legacyEnd: '', preview: null, loading: false, creating: false };
      return { ...prev, [guardianId]: { ...existing, ...patch } };
    });
  };

  const handlePreviewLegacyInvoice = async (guardian) => {
    if (!guardian?._id) return;
    const draft = legacyDrafts[guardian._id] || {};
    const legacyHoursRaw = draft.legacyHours;
    const legacyHours = legacyHoursRaw === '' || legacyHoursRaw === null || typeof legacyHoursRaw === 'undefined'
      ? undefined
      : Number(legacyHoursRaw);
    if (legacyHoursRaw !== '' && !Number.isFinite(legacyHours)) {
      setError('Please enter a valid legacy hours number');
      return;
    }

    setLegacyDraftValue(guardian._id, { loading: true, preview: null });
    try {
      const { data } = await api.post('/invoices/admin/legacy-balance/preview', {
        guardianId: guardian._id,
        guardianEmail: guardian.email,
        legacyHours: legacyHoursRaw === '' ? undefined : legacyHours,
      });
      if (data?.success) {
        setLegacyDraftValue(guardian._id, { preview: data });
      } else {
        setError(data?.message || 'Failed to preview legacy invoice');
      }
    } catch (err) {
      console.error('Legacy balance preview failed', err);
      setError(err?.response?.data?.message || 'Failed to preview legacy invoice');
    } finally {
      setLegacyDraftValue(guardian._id, { loading: false });
    }
  };

  const handleCreateLegacyInvoice = async (guardian) => {
    if (!guardian?._id) return;
    const draft = legacyDrafts[guardian._id] || {};
    const legacyHoursRaw = draft.legacyHours;
    const legacyHours = legacyHoursRaw === '' || legacyHoursRaw === null || typeof legacyHoursRaw === 'undefined'
      ? undefined
      : Number(legacyHoursRaw);
    if (legacyHoursRaw !== '' && !Number.isFinite(legacyHours)) {
      setError('Please enter a valid legacy hours number');
      return;
    }

    setLegacyDraftValue(guardian._id, { creating: true });
    try {
      const { data } = await api.post('/invoices/admin/legacy-balance/create', {
        guardianId: guardian._id,
        guardianEmail: guardian.email,
        legacyHours: legacyHoursRaw === '' ? undefined : legacyHours,
        legacyStart: draft.legacyStart || undefined,
        legacyEnd: draft.legacyEnd || undefined,
      });
      if (data?.success) {
        alert(data?.message || 'Legacy balance invoice created');
        setLegacyDraftValue(guardian._id, { preview: data, legacyHours: '', legacyStart: '', legacyEnd: '' });
        await fetchGuardians();
      } else {
        setError(data?.message || 'Failed to create legacy invoice');
      }
    } catch (err) {
      console.error('Legacy balance create failed', err);
      setError(err?.response?.data?.message || 'Failed to create legacy invoice');
    } finally {
      setLegacyDraftValue(guardian._id, { creating: false });
    }
  };

  const guardianOptionLabel = (g) => `${g.firstName || ''} ${g.lastName || ''}`.trim();
  const guardianOptionValue = (g) => `${guardianOptionLabel(g)} | ${g.email || '-'} | ${g._id}`;
  const resolveGuardianIdFromInput = (value, list = []) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    const direct = list.find((g) => String(g._id) === trimmed);
    if (direct) return String(direct._id);
    const match = list.find((g) => guardianOptionValue(g) === trimmed);
    if (match) return String(match._id);
    const lower = trimmed.toLowerCase();
    const fallback = list.find((g) => {
      const name = guardianOptionLabel(g).toLowerCase();
      const email = (g.email || '').toLowerCase();
      const id = String(g._id || '').toLowerCase();
      return name.includes(lower) || email === lower || id === lower;
    });
    return fallback ? String(fallback._id) : '';
  };

  const filteredLegacyGuardians = useMemo(() => {
    const needle = (legacyQuickSearch || '').trim().toLowerCase();
    if (!needle) return guardians || [];
    return (guardians || []).filter((g) => {
      const name = guardianOptionLabel(g).toLowerCase();
      const email = (g.email || '').toLowerCase();
      const id = String(g._id || '').toLowerCase();
      return name.includes(needle) || email.includes(needle) || id.includes(needle);
    });
  }, [guardians, legacyQuickSearch]);

  const filteredAccountGuardians = useMemo(() => {
    const needle = (accountLogSearch || '').trim().toLowerCase();
    if (!needle) return guardians || [];
    return (guardians || []).filter((g) => {
      const name = guardianOptionLabel(g).toLowerCase();
      const email = (g.email || '').toLowerCase();
      const id = String(g._id || '').toLowerCase();
      return name.includes(needle) || email.includes(needle) || id.includes(needle);
    });
  }, [guardians, accountLogSearch]);

  const selectedLegacyGuardian = useMemo(() => {
    if (!legacyQuickGuardianId) return null;
    return (guardians || []).find((g) => String(g._id) === String(legacyQuickGuardianId)) || null;
  }, [guardians, legacyQuickGuardianId]);

  const selectedAccountGuardian = useMemo(() => {
    if (!accountLogGuardianId) return null;
    return (guardians || []).find((g) => String(g._id) === String(accountLogGuardianId)) || null;
  }, [guardians, accountLogGuardianId]);

  const loadAccountLogs = async () => {
    const query = (accountLogQuery || accountLogSearch || '').trim();
    if (!selectedAccountGuardian?._id && !query) {
      setAccountLogsError('Please select a guardian or enter an email/ID');
      return;
    }
    setAccountLogsError('');
    setAccountLogsLoading(true);
    try {
      const { data } = await api.post('/users/admin/account-logs', {
        userId: selectedAccountGuardian?._id,
        email: query && query.includes('@') ? query : (selectedAccountGuardian?.email || undefined),
        userIdOrEmail: query && !query.includes('@') ? query : undefined,
        limit: 500,
        includeClasses: true,
        classLimit: 500,
      });
      setAccountLogs(Array.isArray(data?.logs) ? data.logs : []);
    } catch (err) {
      console.error('Failed to load account logs', err);
      setAccountLogsError(err?.response?.data?.message || 'Failed to load account logs');
    } finally {
      setAccountLogsLoading(false);
    }
  };

  const buildLogKey = (log, idx) => String(log?.logId || `${log?.timestamp || 't'}-${idx}`);

  const toggleLogClasses = (key) => {
    setExpandedLogEntries((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const formatStatusLabel = (value) => {
    if (value === true) return 'Active';
    if (value === false) return 'Inactive';
    return 'Unknown';
  };

  const getHoursDelta = (log) => {
    const before = Number.isFinite(Number(log?.balanceBefore)) ? Number(log.balanceBefore) : null;
    const after = Number.isFinite(Number(log?.balanceAfter)) ? Number(log.balanceAfter) : null;
    if (before === null || after === null) return null;
    const raw = Math.round((after - before) * 1000) / 1000;
    if (!Number.isFinite(raw) || raw === 0) return null;
    return {
      value: raw,
      label: `${raw > 0 ? '+' : ''}${raw}h`,
      tone: raw > 0 ? 'text-emerald-600' : 'text-rose-600'
    };
  };

  const openLogAction = (log, action) => {
    if (!log?.logId) return;
    setLogActionModal({ open: true, log, action });
    setLogActionConfirm('');
  };

  const closeLogAction = () => {
    setLogActionModal({ open: false, log: null, action: '' });
    setLogActionConfirm('');
    setLogActionLoading(false);
  };

  const handleLogAction = async () => {
    const log = logActionModal.log;
    if (!log?.logId) return;
    setLogActionLoading(true);
    try {
      if (logActionModal.action === 'undo') {
        await api.post(`/users/admin/account-logs/${log.logId}/undo`, { source: log.source });
      } else if (logActionModal.action === 'delete') {
        await api.delete(`/users/admin/account-logs/${log.logId}`, { params: { source: log.source } });
      }
      await loadAccountLogs();
      closeLogAction();
    } catch (err) {
      console.error('Account log action failed', err);
      setAccountLogsError(err?.response?.data?.message || 'Failed to update log');
      setLogActionLoading(false);
    }
  };

  const downloadAccountLogs = () => {
    if (!accountLogs || accountLogs.length === 0) return;
    const rows = [
      [
        'timestamp',
        'source',
        'action',
        'invoiceNumber',
        'amount',
        'hours',
        'success',
        'message',
        'reason',
        'actorName',
        'balanceBefore',
        'balanceAfter',
        'statusBefore',
        'statusAfter',
        'entityType',
        'entityName',
        'billingStart',
        'billingEnd',
        'classCount',
        'generationSource',
        'logId'
      ]
    ];
    accountLogs.forEach((log) => {
      rows.push([
        log.timestamp ? new Date(log.timestamp).toISOString() : '',
        log.source || '',
        log.action || '',
        log.invoiceNumber || '',
        log.amount ?? '',
        log.hours ?? '',
        log.success === false ? 'false' : 'true',
        (log.message || '').replace(/\n/g, ' '),
        (log.reason || '').replace(/\n/g, ' '),
        (log.actorName || '').replace(/\n/g, ' '),
        log.balanceBefore ?? '',
        log.balanceAfter ?? '',
        log.statusBefore ?? '',
        log.statusAfter ?? '',
        log.entityType ?? '',
        (log.entityName || '').replace(/\n/g, ' '),
        log.billingPeriod?.startDate ? new Date(log.billingPeriod.startDate).toISOString() : '',
        log.billingPeriod?.endDate ? new Date(log.billingPeriod.endDate).toISOString() : '',
        log.classCount ?? '',
        log.generationSource || '',
        log.logId || ''
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `account-logs-${selectedAccountGuardian?._id || 'guardian'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleStatusChange = async (guardianId, newStatus) => {
    try {
  await api.put(`/users/${guardianId}/status`, { isActive: newStatus });
      fetchGuardians(); // Refresh the list
    } catch (err) {
      setError('Failed to update guardian status');
      console.error('Update status error:', err);
    }
  };

  const handleLoginAsUser = async (userId) => {
    try {
      const result = await loginAsUser(userId);
      if (result.success) {
        navigate('/dashboard'); // Redirect to dashboard after logging in as user
      } else {
        setError(result.error || 'Failed to login as user');
      }
    } catch (err) {
      setError('An unexpected error occurred during login as user');
      console.error('Login as user error:', err);
    }
  };

  const openWhatsApp = (phone) => {
    if (phone) {
      const cleanPhone = phone.replace(/[^\d+]/g, '');
      window.open(`https://wa.me/${cleanPhone}`, '_blank');
    }
  };

  const openEmail = (email) => {
    if (email) {
      window.open(`mailto:${email}`, '_blank');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-red-100 text-red-800';
      case 'suspended': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredGuardians = useMemo(() => {
    let result = guardians || [];

    if (statusFilter !== 'all') {
      const desired = statusFilter === 'active';
      result = result.filter((guardian) => isGuardianActive(guardian) === desired);
    }

    if (searchTerm.trim()) {
      const globalTerm = searchTerm.toLowerCase();
      result = result.filter((g) => {
        const fullName = `${g.firstName || ''} ${g.lastName || ''}`.toLowerCase();
        return (
          fullName.includes(globalTerm) ||
          (g.email || '').toLowerCase().includes(globalTerm) ||
          (g.phone || '').toLowerCase().includes(globalTerm) ||
          String(g._id).includes(globalTerm) ||
          (g.guardianInfo?.students || []).some(s => (`${s.firstName} ${s.lastName}`).toLowerCase().includes(globalTerm))
        );
      });
    }

    if (globalFilter && globalFilter !== 'all') {
      switch (globalFilter) {
        case 'active':
          result = result.filter(g => g.isActive === true);
          break;
        case 'inactive':
          result = result.filter(g => g.isActive === false);
          break;
        default:
          break;
      }
    }

    return result;
  }, [guardians, searchTerm, globalFilter, statusFilter]);

  const sortedGuardians = useMemo(() => {
    const list = [...(filteredGuardians || [])];
    const buildNameKey = (guardian) => {
      const first = (guardian.firstName || '').trim().toLowerCase();
      const last = (guardian.lastName || '').trim().toLowerCase();
      if (sortBy === 'lastName') {
        return `${last} ${first}`.trim() || last || first;
      }
      return `${first} ${last}`.trim();
    };

    list.sort((a, b) => {
      const nameA = buildNameKey(a);
      const nameB = buildNameKey(b);
      if (nameA === nameB) {
        return (a.lastName || '').localeCompare(b.lastName || '', undefined, { sensitivity: 'base' });
      }
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });

    if (sortOrder === 'desc') {
      list.reverse();
    }

    return list;
  }, [filteredGuardians, sortBy, sortOrder]);

  // keep the page UI mounted while loading so search inputs don't lose focus
  const confirmToken = logActionModal.log?.action || 'action';
  const isConfirmValid = logActionConfirm.trim() === confirmToken;

  return (
    <div className="p-6 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto">

        {/* Error Message */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 mb-4">
            <span className="text-destructive text-sm">{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-6">
          {GUARDIAN_STATUS_TABS.map((tab) => {
            const isSelected = statusFilter === tab.id;
            const count = tab.id === 'all' ? statusCounts.all : (statusCounts[tab.id] || 0);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-transparent border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{tab.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Guardians List */}
        {showLoading && sortedGuardians.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <LoadingSpinner text="Loading guardians…" />
          </div>
        ) : null}

        <div className="space-y-3">
          {sortedGuardians.map((guardian) => (
            <div key={guardian._id} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
              {/* Guardian Summary */}
              <div className="p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center">
                      {guardian.profilePicture ? (
                        <img src={guardian.profilePicture} alt="Profile" className="h-full w-full rounded-full object-cover" />
                      ) : (
                        <span className="text-lg font-medium text-primary-foreground">
                          {guardian.firstName?.charAt(0)}{guardian.lastName?.charAt(0)}
                        </span>
                      )}
                    </div>

                    {/* Basic Info */}
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {guardian.firstName} {guardian.lastName}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(guardian.isActive ? 'active' : 'inactive')}`}>
                          {guardian.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className="flex items-center">
                          <Users className="h-3 w-3 mr-1" />
                          {guardian.guardianInfo?.students?.length || 0} students
                        </span>
                        <span className="flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          {guardian.guardianInfo?.totalHours || 0} hours left
                        </span>
                        {guardian.email && (
                          <span className="flex items-center">
                            <Mail className="h-3 w-3 mr-1" />
                            {guardian.email}
                          </span>
                        )}
                        {guardian._id && (
                          <span className="text-xs text-muted-foreground">ID: {guardian._id}</span>
                        )}
                        <span className="flex items-center">
                          <Globe className="h-3 w-3 mr-1" />
                          {guardian.timezone || guardian.guardianInfo?.timezone || 'UTC'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                    {/* WhatsApp */}
                    {guardian.phone && (
                      <button
                        onClick={() => openWhatsApp(guardian.phone)}
                        className="icon-button icon-button--green"
                        title="WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </button>
                    )}
                    {/* Email */}
                    {guardian.email && (
                      <button
                        onClick={() => openEmail(guardian.email)}
                        className="icon-button icon-button--blue"
                        title="Email"
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                    )}

                    {/* Admin Actions */}
                    {isAdmin() && (
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          onClick={() => setEditingGuardian(guardian)}
                          className="icon-button icon-button--blue"
                          title="Edit Guardian"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleStatusChange(guardian._id, !guardian.isActive)}
                          className={`icon-button transition-colors ${guardian.isActive ? 'text-red-600' : 'text-green-600'}`}
                          title={guardian.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {guardian.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => handleLoginAsUser(guardian._id)}
                          className="icon-button icon-button--indigo"
                          title="Login as User"
                        >
                          <LogIn className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    {/* Expand/Collapse */}
                    <button
                      onClick={() => toggleExpanded(guardian._id)}
                      className="icon-button icon-button--muted"
                    >
                      {expandedGuardian === guardian._id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
              {expandedGuardian === guardian._id && (
                <div className="border-t border-border bg-muted/30 p-3 space-y-6">
    {/* Guardian Info Section */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Contact Information */}
      <div>
        <h4 className="font-semibold text-foreground mb-3">Contact Information</h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center space-x-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span>{guardian.email}</span>
          </div>
          {guardian.phone && (
            <div className="flex items-center space-x-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{guardian.phone}</span>
            </div>
          )}
          {guardian.address && (
            <div className="flex items-center space-x-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>
                {[guardian.address.city, guardian.address.state, guardian.address.country]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Guardian Details */}
      <div>
        <h4 className="font-semibold text-foreground mb-3">Guardian Details</h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center space-x-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span>Relationship: {guardian.guardianInfo?.relationship || '-'}</span>
          </div>
          <div className="flex items-center space-x-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>Total Hours: {guardian.guardianInfo?.totalHours || 0}</span>
          </div>
          {isAdmin() && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">Manual adjustment (admin only)</span>
              <select
                value={(hoursAdjustments[guardian._id]?.action) || 'add'}
                onChange={(e) => setHoursAdjustmentValue(guardian._id, { action: e.target.value })}
                className="h-8 rounded-md border border-border bg-input px-2 text-xs text-foreground"
              >
                <option value="add">Add</option>
                <option value="subtract">Subtract</option>
                <option value="set">Set</option>
              </select>
              <input
                type="number"
                step="0.25"
                value={(hoursAdjustments[guardian._id]?.hours) ?? ''}
                onChange={(e) => setHoursAdjustmentValue(guardian._id, { hours: e.target.value })}
                placeholder="Hours"
                className="h-8 w-24 rounded-md border border-border bg-input px-2 text-xs text-foreground"
              />
              <input
                type="text"
                value={(hoursAdjustments[guardian._id]?.reason) ?? ''}
                onChange={(e) => setHoursAdjustmentValue(guardian._id, { reason: e.target.value })}
                placeholder="Reason (optional)"
                className="h-8 w-52 max-w-full rounded-md border border-border bg-input px-2 text-xs text-foreground"
              />
              <button
                onClick={() => handleManualHoursAdjustment(guardian._id)}
                className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Apply
              </button>
            </div>
          )}
          {isAdmin() && (
            null
          )}
          <div className="flex items-center space-x-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <span>
              Payment Method: {
                (() => {
                  let method = guardian.guardianInfo?.paymentMethod ?? guardian.paymentMethod ?? null;
                  if (!method || method === 'credit_card') return 'PayPal';
                  const labels = { paypal: 'PayPal', bank_transfer: 'Bank Transfer', wise: 'Wise Transfer', credit_card: 'Credit Card' };
                  return labels[method] || (typeof method === 'string' ? method : '-');
                })()
              }
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-medium">Hourly Rate:</span>
            <span>{(guardian.guardianInfo?.hourlyRate ?? guardian.hourlyRate ?? guardian.guardianInfo?.rate ?? guardian.rate) ?? 'Not set'}</span>
          </div>
        </div>
      </div>

      {/* Emergency Contact */}
      {guardian.guardianInfo?.emergencyContact && (
        <div>
          <h4 className="font-semibold text-foreground mb-3">Emergency Contact</h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center space-x-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>{guardian.guardianInfo.emergencyContact.name}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{guardian.guardianInfo.emergencyContact.phone}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span>{guardian.guardianInfo.emergencyContact.relationship}</span>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Linked Students */}
    {(() => {
      const gid = guardian._id;
      const merged = linkedStudentsByGuardianId[gid];
      const isLoadingStudents = !!linkedStudentsLoadingByGuardianId[gid];
      const fallbackEmbedded = guardian.guardianInfo?.students || [];
      const studentsToShow = Array.isArray(merged) ? merged : fallbackEmbedded;

      if (isLoadingStudents && !Array.isArray(merged)) {
        return (
          <div>
            <h4 className="font-semibold text-foreground mb-3">Linked Students</h4>
            <div className="flex items-center justify-center py-4">
              <LoadingSpinner />
            </div>
          </div>
        );
      }

      if (!studentsToShow || studentsToShow.length === 0) {
        return null;
      }

      return (
      <div>
        <h4 className="font-semibold text-foreground mb-3">Linked Students</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {studentsToShow.map((student) => (
            <div key={student._id} className="bg-card border border-border rounded-lg p-3 flex flex-col space-y-1">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 bg-secondary rounded-full flex items-center justify-center">
                  {getStudentPictureUrl(student) ? (
                    <img src={getStudentPictureUrl(student)} alt="Profile" className="h-full w-full rounded-full object-cover" />
                  ) : (
                    <span className="text-sm font-medium text-secondary-foreground">
                      {student.firstName?.charAt(0)}{student.lastName?.charAt(0)}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-medium text-foreground">{student.firstName} {student.lastName}</p>
                  <p className="text-xs text-muted-foreground">{student.hoursRemaining || 0} hours left</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                <div>Grade: {student.grade || '-'}</div>
                <div>School: {student.school || '-'}</div>
                <div>Subjects: {(student.subjects || []).join(', ') || '-'}</div>
                <div>DOB: {student.dateOfBirth ? formatDateDDMMMYYYY(student.dateOfBirth) : '-'}</div>
                <div>Gender: {student.gender || '-'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      );
    })()}
  </div>
)}


              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center space-x-2 mt-6">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 border border-border rounded-md bg-input text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
            >
              Previous
            </button>
            <span className="px-3 py-2 text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 border border-border rounded-md bg-input text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
            >
              Next
            </button>
          </div>
        )}

        {/* Empty State */}
        {!showLoading && sortedGuardians.length === 0 && (
          <div className="text-center py-12">
            <Baby className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No guardians found</h3>
            <p className="text-muted-foreground">
              {searchTerm ? 'Try adjusting your search criteria.' : 'No guardians have been registered yet.'}
            </p>
          </div>
        )}
        {/* Profile Edit Modal for Guardians */}
        {editingGuardian && (
          <ProfileEditModal
            isOpen={!!editingGuardian}
            targetUser={editingGuardian}
            onClose={() => setEditingGuardian(null)}
            onSaved={() => { fetchGuardians(); setEditingGuardian(null); }}
          />
        )}
      </div>

      {isAdmin() && (
        <div className="fixed bottom-6 right-6 flex flex-col items-end gap-2">
          {showQuickActions && (
            <div className="rounded-lg border border-border bg-card shadow-lg overflow-hidden">
              <button
                onClick={() => {
                  setShowLegacyQuick(true);
                  setShowQuickActions(false);
                }}
                className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted"
              >
                Legacy balance
              </button>
              <button
                onClick={() => {
                  setShowAccountLogs(true);
                  setAccountLogs([]);
                  setAccountLogsError('');
                  setShowQuickActions(false);
                }}
                className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted"
              >
                Account history
              </button>
            </div>
          )}
          <button
            onClick={() => setShowQuickActions((prev) => !prev)}
            className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 flex items-center justify-center text-2xl"
            title="Quick actions"
          >
            +
          </button>
        </div>
      )}

      {isAdmin() && showLegacyQuick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Legacy balance invoice</h3>
              <button
                onClick={() => setShowLegacyQuick(false)}
                className="icon-button icon-button--muted"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div className="relative">
                <input
                  type="text"
                  value={legacyQuickSearch}
                  onFocus={() => setShowLegacyOptions(true)}
                  onBlur={() => setTimeout(() => setShowLegacyOptions(false), 120)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setLegacyQuickSearch(value);
                    const resolved = resolveGuardianIdFromInput(value, guardians || []);
                    if (resolved) setLegacyQuickGuardianId(resolved);
                    setShowLegacyOptions(true);
                  }}
                  placeholder="Search or select guardian (name, email, ID)"
                  className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground"
                />
                {showLegacyOptions && filteredLegacyGuardians.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
                    {filteredLegacyGuardians.map((g) => (
                      <button
                        key={g._id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setLegacyQuickGuardianId(g._id);
                          setLegacyQuickSearch(guardianOptionValue(g));
                          setShowLegacyOptions(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                      >
                        {guardianOptionValue(g)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedLegacyGuardian && (() => {
                const legacyDraft = legacyDrafts[selectedLegacyGuardian._id] || {};
                const preview = legacyDraft.preview;
                return (
                  <div className="rounded-md border border-border bg-muted/30 p-3">
                    <div className="text-sm font-medium text-foreground">
                      {selectedLegacyGuardian.firstName} {selectedLegacyGuardian.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">{selectedLegacyGuardian.email}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="number"
                        step="0.25"
                        value={legacyDraft.legacyHours ?? ''}
                        onChange={(e) => setLegacyDraftValue(selectedLegacyGuardian._id, { legacyHours: e.target.value })}
                        placeholder="Legacy hours (e.g. -2.5)"
                        className="h-8 w-44 rounded-md border border-border bg-input px-2 text-xs text-foreground"
                      />
                      <input
                        type="date"
                        value={legacyDraft.legacyStart ?? ''}
                        onChange={(e) => setLegacyDraftValue(selectedLegacyGuardian._id, { legacyStart: e.target.value })}
                        className="h-8 rounded-md border border-border bg-input px-2 text-xs text-foreground"
                      />
                      <input
                        type="date"
                        value={legacyDraft.legacyEnd ?? ''}
                        onChange={(e) => setLegacyDraftValue(selectedLegacyGuardian._id, { legacyEnd: e.target.value })}
                        className="h-8 rounded-md border border-border bg-input px-2 text-xs text-foreground"
                      />
                      <button
                        onClick={() => handlePreviewLegacyInvoice(selectedLegacyGuardian)}
                        disabled={legacyDraft.loading}
                        className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
                      >
                        {legacyDraft.loading ? 'Previewing...' : 'Preview invoice'}
                      </button>
                      <button
                        onClick={() => handleCreateLegacyInvoice(selectedLegacyGuardian)}
                        disabled={legacyDraft.creating}
                        className="h-8 rounded-md border border-border bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        {legacyDraft.creating ? 'Creating...' : 'Apply & create invoice'}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Leave hours empty if already applied. Dates optional (defaults to pre-migration period).
                    </p>
                    {preview && (
                      <div className="mt-2 text-xs text-foreground">
                        <span className="font-medium">Preview:</span>{' '}
                        current {preview.currentHours ?? 0}h → projected {preview.projectedHours ?? preview.currentHours}h, owed {preview.owedHours ?? 0}h, amount ${preview.amount ?? 0}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {isAdmin() && showAccountLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-foreground">Account history</h3>
              <button
                onClick={() => setShowAccountLogs(false)}
                className="icon-button icon-button--muted"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 space-y-3">
              <div className="relative">
                <input
                  type="text"
                  value={accountLogSearch}
                  onFocus={() => setShowAccountOptions(true)}
                  onBlur={() => setTimeout(() => setShowAccountOptions(false), 120)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setAccountLogSearch(value);
                    setAccountLogQuery(value);
                    const resolved = resolveGuardianIdFromInput(value, guardians || []);
                    if (resolved) setAccountLogGuardianId(resolved);
                    setShowAccountOptions(true);
                  }}
                  placeholder="Search or select guardian (name, email, ID)"
                  className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground"
                />
                {showAccountOptions && filteredAccountGuardians.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
                    {filteredAccountGuardians.map((g) => (
                      <button
                        key={g._id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setAccountLogGuardianId(g._id);
                          setAccountLogSearch(guardianOptionValue(g));
                          setAccountLogQuery(guardianOptionValue(g));
                          setShowAccountOptions(false);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                      >
                        {guardianOptionValue(g)}
                      </button>
                    ))}
                  </div>
                )}
              </div>

                {selectedAccountGuardian && (
                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground">
                  <div className="font-medium">
                    {selectedAccountGuardian.firstName} {selectedAccountGuardian.lastName}
                  </div>
                  <div>{selectedAccountGuardian.email}</div>
                  <div>ID: {selectedAccountGuardian._id}</div>
                </div>
              )}

              {accountLogsError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                  {accountLogsError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={loadAccountLogs}
                  disabled={accountLogsLoading}
                  className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
                >
                  {accountLogsLoading ? 'Loading…' : 'Load logs'}
                </button>
                <button
                  onClick={downloadAccountLogs}
                  disabled={!accountLogs || accountLogs.length === 0}
                  className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 inline-flex items-center gap-1"
                >
                  <DownloadCloud className="h-3.5 w-3.5" />
                  Download CSV
                </button>
              </div>

              <div className="max-h-[360px] overflow-auto rounded-md border border-border">
                {accountLogsLoading && accountLogs.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">Loading logs…</div>
                ) : accountLogs.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">No logs loaded yet.</div>
                ) : (
                  <ul className="divide-y divide-border">
                    {accountLogs.map((log, idx) => {
                      const logKey = buildLogKey(log, idx);
                      const hoursDelta = getHoursDelta(log);
                      const statusSummary = (log.statusBefore !== undefined || log.statusAfter !== undefined)
                        ? `${log.entityType === 'Student' ? 'Student' : 'User'}${log.entityName ? `: ${log.entityName}` : ''}${log.entityType === 'Student' && log.guardianName ? ` (Guardian: ${log.guardianName})` : ''} ${formatStatusLabel(log.statusBefore)} → ${formatStatusLabel(log.statusAfter)}`
                        : null;
                      const showClasses = !!expandedLogEntries[logKey];

                      return (
                        <li key={logKey} className="p-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
                                {log.action || 'event'}
                              </span>
                              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                                {log.source || 'system'}
                              </span>
                              <span className="text-muted-foreground">
                                {log.timestamp ? formatDateDDMMMYYYY(log.timestamp) : ''}
                              </span>
                              {log.invoiceNumber && (
                                <span className="text-muted-foreground">Invoice {log.invoiceNumber}</span>
                              )}
                              {log.billingPeriod?.startDate && log.billingPeriod?.endDate && (
                                <span className="text-muted-foreground">
                                  {formatDateDDMMMYYYY(log.billingPeriod.startDate)} → {formatDateDDMMMYYYY(log.billingPeriod.endDate)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {log.canUndo && log.logId ? (
                                <button
                                  type="button"
                                  onClick={() => openLogAction(log, 'undo')}
                                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
                                >
                                  Undo
                                </button>
                              ) : null}
                              {log.canDelete && log.logId ? (
                                <button
                                  type="button"
                                  onClick={() => openLogAction(log, 'delete')}
                                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {log.message && (
                            <div className="mt-1 text-muted-foreground">{log.message}</div>
                          )}

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
                            {statusSummary ? (
                              <span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px] text-foreground">
                                {statusSummary}
                              </span>
                            ) : null}
                            {hoursDelta ? (
                              <span className={`rounded-md bg-muted/50 px-2 py-0.5 text-[11px] font-semibold ${hoursDelta.tone}`}>
                                Hours {hoursDelta.label}
                              </span>
                            ) : null}
                            {(log.amount || log.hours) ? (
                              <span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px]">
                                {log.amount ? `Amount: ${log.amount}` : ''}
                                {log.amount && log.hours ? ' • ' : ''}
                                {log.hours ? `Hours: ${log.hours}` : ''}
                              </span>
                            ) : null}
                            {(log.balanceBefore !== undefined || log.balanceAfter !== undefined) ? (
                              <span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px]">
                                Balance: {log.balanceBefore ?? '-'} → {log.balanceAfter ?? '-'} {log.balanceNote ? `(${log.balanceNote})` : ''}
                              </span>
                            ) : null}
                            {log.actorName ? (
                              <span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px]">By: {log.actorName}</span>
                            ) : null}
                          </div>

                          {log.reason && (
                            <div className="mt-1 text-muted-foreground">Reason: {log.reason}</div>
                          )}

                          {Array.isArray(log.classEntries) && (log.classEntries.length > 0 || log.classCount > 0) && (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => toggleLogClasses(logKey)}
                                className="text-[11px] font-medium text-primary hover:underline"
                              >
                                {showClasses ? 'Hide classes' : 'Show classes'} ({log.classEntries.length}
                                {log.classCount && log.classCount > log.classEntries.length ? ` of ${log.classCount}` : ''})
                              </button>
                              {showClasses ? (
                                <div className="mt-2 rounded-md border border-border bg-background/60 p-2 text-muted-foreground">
                                  {log.classEntries.length === 0 ? (
                                    <div className="text-[11px] text-muted-foreground">No class details available.</div>
                                  ) : (
                                    <ul className="space-y-1">
                                      {log.classEntries.map((entry, entryIndex) => (
                                        <li key={`${logKey}-class-${entryIndex}`} className="flex flex-wrap gap-2">
                                          <span>{entry.date ? formatDateDDMMMYYYY(entry.date) : 'Date N/A'}</span>
                                          {entry.studentName && <span>Student: {entry.studentName}</span>}
                                          {entry.teacherName && <span>Teacher: {entry.teacherName}</span>}
                                          {entry.hours !== null && entry.hours !== undefined ? <span>{entry.hours}h</span> : null}
                                          {entry.status ? <span>Status: {entry.status}</span> : null}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          )}

                          {log.success === false && (
                            <div className="mt-1 text-destructive">Failed</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
          {logActionModal.open && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
              <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-foreground">
                      {logActionModal.action === 'delete' ? 'Delete log entry' : 'Undo log action'}
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Copy and paste this process name to confirm:
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeLogAction}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs font-mono text-foreground">
                  {confirmToken}
                </div>
                <input
                  value={logActionConfirm}
                  onChange={(e) => setLogActionConfirm(e.target.value)}
                  placeholder="Paste the process name"
                  className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
                />
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeLogAction}
                    className="h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!isConfirmValid || logActionLoading}
                    onClick={handleLogAction}
                    className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
                  >
                    {logActionLoading ? 'Processing…' : 'Confirm'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GuardiansPage;


