import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useDeleteActionCountdown } from '../../contexts/DeleteActionCountdownContext';
import { useSearch } from '../../contexts/SearchContext';
import api from '../../api/axios';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';
import { 
  Calendar, 
  Clock, 
  User, 
  Users, 
  Globe, 
  Send,
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Plus,
  Edit,
  Trash2,
  Eye,
  Check,
  X
} from 'lucide-react';
import VacationModal from '../../components/dashboard/VacationModal';
import VacationDetailsModal from '../../components/dashboard/VacationDetailsModal';
import GuardianStudentVacationModal from '../../components/dashboard/GuardianStudentVacationModal';
import PrimaryButton from '../../components/ui/PrimaryButton';

const VACATION_WHATSAPP_REPORT_STORAGE_PREFIX = 'waraqa.vacations.whatsappReport.v1';
const ISLAMIC_DECORATIVE_LINE = '۞ ┈┈┈ ✦ ┈┈┈ ۞';
const VACATION_TITLE_FONT = '"Aref Ruqaa", "Amiri", Georgia, serif';
const VACATION_BODY_FONT = '"Noto Naskh Arabic", "Inter", "Segoe UI", sans-serif';
const VACATION_LABEL_FONT = '"Noto Kufi Arabic", "Open Sans", "Segoe UI", sans-serif';
const VACATION_WHATSAPP_COPY = {
  title: 'Waraqa Vacation Notice',
  decorativeLine: '۞ ┈---┈┈ ✦ ---┈┈┈ ۞',
  greetingPrefix: 'Assalamu Alaikum',
  beginsLabel: 'Begins',
  endsLabel: 'Ends',
  timezoneNote: 'This is in your timezone.',
};

const normalizeWhatsappPhone = (value) => String(value || '').replace(/\D+/g, '');

const validateWhatsappPhone = (value) => {
  const normalized = normalizeWhatsappPhone(value);
  if (!normalized) {
    return { ok: false, normalized, reason: 'Missing WhatsApp number' };
  }
  if (!/^[1-9][0-9]{7,14}$/.test(normalized)) {
    return { ok: false, normalized, reason: 'Invalid phone format' };
  }
  return { ok: true, normalized, reason: null };
};

const formatRecipientEpithet = (epithet) => {
  const normalized = String(epithet || '').trim().toLowerCase();
  if (!normalized || normalized === 'none') return '';

  const map = {
    mr: 'Mr',
    mister: 'Mr',
    mrs: 'Mrs',
    missus: 'Mrs',
    ms: 'Ms',
    miss: 'Ms',
    brother: 'Brother',
    bro: 'Brother',
    sister: 'Sister',
    sis: 'Sister',
  };

  return map[normalized] || String(epithet || '').trim();
};

const VacationManagementPage = () => {
  const { user } = useAuth();
  const { start: startDeleteCountdown } = useDeleteActionCountdown();
  const { searchTerm, globalFilter } = useSearch();

  const toLocalDateInput = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
  };

  const parseLocalDayStart = (yyyyMmDd) => {
    if (!yyyyMmDd) return null;
    const d = new Date(`${yyyyMmDd}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const parseLocalDayEnd = (yyyyMmDd) => {
    if (!yyyyMmDd) return null;
    const d = new Date(`${yyyyMmDd}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const [activeTab, setActiveTab] = useState('individual');
  const [individualVacations, setIndividualVacations] = useState([]);
  const [systemVacations, setSystemVacations] = useState([]);
  const [myVacations, setMyVacations] = useState([]);
  const [loading, setLoading] = useState(true);
  const fetchDataInFlightRef = useRef(false);
  const fetchDataKeyRef = useRef('');
  const fetchDataAbortRef = useRef(null);
  const fetchDataRequestIdRef = useRef(0);

  const [summaryFrom, setSummaryFrom] = useState(() => {
    const now = new Date();
    return toLocalDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [summaryTo, setSummaryTo] = useState(() => toLocalDateInput(new Date()));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState('individual'); // 'individual' or 'system'
  const [editingVacation, setEditingVacation] = useState(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [approvalAction, setApprovalAction] = useState(''); // 'approve' or 'reject'
  const [rejectionReason, setRejectionReason] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailVacation, setDetailVacation] = useState(null);
  const [detailImpact, setDetailImpact] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [showGuardianStudentModal, setShowGuardianStudentModal] = useState(false);
  const [whatsappDraftProgress, setWhatsappDraftProgress] = useState(null);
  const [whatsappDraftReport, setWhatsappDraftReport] = useState(null);
  const [whatsappDraftSession, setWhatsappDraftSession] = useState(null);
  const [visibleWhatsappReportVacationId, setVisibleWhatsappReportVacationId] = useState(null);
  const whatsappDraftWindowRef = useRef(null);
  const whatsappDraftTimerRef = useRef(null);
  const whatsappDraftSessionRef = useRef(null);
  const advanceVacationWhatsappSessionRef = useRef(null);

  const userTimezone = user?.timezone || user?.guardianInfo?.timezone || user?.teacherInfo?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  useEffect(() => {
    whatsappDraftSessionRef.current = whatsappDraftSession;
  }, [whatsappDraftSession]);

  useEffect(() => {
    if (!user?._id) {
      setWhatsappDraftReport(null);
      return;
    }

    try {
      const raw = localStorage.getItem(`${VACATION_WHATSAPP_REPORT_STORAGE_PREFIX}:${user._id}`);
      if (!raw) {
        setWhatsappDraftReport(null);
        return;
      }

      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        setWhatsappDraftReport(parsed);
      } else {
        setWhatsappDraftReport(null);
      }
    } catch (e) {
      setWhatsappDraftReport(null);
    }
  }, [user?._id]);

  useEffect(() => {
    if (!user?._id) return;

    try {
      const storageKey = `${VACATION_WHATSAPP_REPORT_STORAGE_PREFIX}:${user._id}`;
      if (!whatsappDraftReport) {
        localStorage.removeItem(storageKey);
        return;
      }

      localStorage.setItem(storageKey, JSON.stringify(whatsappDraftReport));
    } catch (e) {
      // ignore storage errors
    }
  }, [user?._id, whatsappDraftReport]);

  const reportMatchesVacation = useCallback((vacation) => {
    if (!vacation?._id || !whatsappDraftReport?.vacationId) return false;
    return String(whatsappDraftReport.vacationId) === String(vacation._id);
  }, [whatsappDraftReport]);

  const toggleVacationWhatsappReport = useCallback((vacationId) => {
    if (!vacationId) return;
    setVisibleWhatsappReportVacationId((prev) => (String(prev) === String(vacationId) ? null : vacationId));
  }, []);

  const renderVacationWhatsappReport = useCallback((vacation) => {
    if (!vacation?._id || String(visibleWhatsappReportVacationId) !== String(vacation._id)) return null;

    if (!reportMatchesVacation(vacation)) {
      return (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          No stored WhatsApp send run was found for this vacation yet.
        </div>
      );
    }

    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Last WhatsApp send run</h3>
            <p className="text-sm text-gray-600">
              {whatsappDraftReport.vacationName} • sent {whatsappDraftReport.sent.length}/{whatsappDraftReport.attempted}
            </p>
          </div>
          <div className={`text-sm font-medium ${whatsappDraftReport.failed.length ? 'text-orange-600' : 'text-green-600'}`}>
            {whatsappDraftReport.failed.length
              ? `${whatsappDraftReport.failed.length} recipient${whatsappDraftReport.failed.length === 1 ? '' : 's'} not sent`
              : 'All selected recipients were confirmed as sent'}
          </div>
        </div>
        {whatsappDraftReport.failed.length > 0 && (
          <div className="mt-3 space-y-2">
            {whatsappDraftReport.failed.map((entry) => (
              <div key={`${entry.role}-${entry.id}`} className="rounded-md border border-orange-100 bg-orange-50 px-3 py-2 text-sm text-orange-900">
                <span className="font-medium">{entry.name}</span> • {entry.role} • {entry.reason}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }, [reportMatchesVacation, visibleWhatsappReportVacationId, whatsappDraftReport]);

  const availableTabs = useMemo(() => {
    const tabs = [];

    if (user?.role === 'admin') {
      tabs.push(
        { id: 'individual', label: 'Individual Vacations', icon: User },
        { id: 'system', label: 'System Vacations', icon: Globe }
      );
    }

    if (user?.role === 'teacher') {
      tabs.push({ id: 'my-vacations', label: 'My Vacations', icon: Calendar });
    }

    if (user?.role === 'guardian') {
      tabs.push({ id: 'my-vacations', label: 'My Vacations', icon: Calendar });
    }

    return tabs;
  }, [user?.role]);

  // Ensure the active tab is always valid for the current role
  useEffect(() => {
    if (availableTabs.length === 0) return;
    const isValid = availableTabs.some((tab) => tab.id === activeTab);
    if (!isValid) setActiveTab(availableTabs[0].id);
  }, [availableTabs, activeTab]);

  const fetchData = useCallback(async () => {
    const searchMode = Boolean((searchTerm || '').trim());
    const requestSignature = JSON.stringify({ tab: activeTab, role: user?.role, userId: user?._id || user?.id, search: searchMode ? searchTerm : undefined });
    if (fetchDataInFlightRef.current && fetchDataKeyRef.current === requestSignature) {
      return;
    }

    fetchDataKeyRef.current = requestSignature;
    fetchDataInFlightRef.current = true;

    const requestId = fetchDataRequestIdRef.current + 1;
    fetchDataRequestIdRef.current = requestId;

    if (fetchDataAbortRef.current) {
      try {
        fetchDataAbortRef.current.abort();
      } catch (e) {
        // ignore abort errors
      }
    }

    const controller = new AbortController();
    fetchDataAbortRef.current = controller;

    const hasExisting = searchMode
      ? ((individualVacations || []).length > 0 || (systemVacations || []).length > 0 || (myVacations || []).length > 0)
      : (
          (activeTab === 'individual' && (individualVacations || []).length > 0) ||
          (activeTab === 'system' && (systemVacations || []).length > 0) ||
          (activeTab === 'my-vacations' && (myVacations || []).length > 0)
        );

    setLoading(!hasExisting);
    try {
      const cacheKey = makeCacheKey('vacations:management', user?._id || 'anon', {
        tab: searchMode ? 'all' : activeTab,
        role: user?.role || 'anon'
      });
      const cached = readCache(cacheKey, { deps: ['vacations'] });
      if (cached.hit && cached.value) {
        if (searchMode) {
          setIndividualVacations(cached.value.individual || []);
          setSystemVacations(cached.value.system || []);
          setMyVacations(cached.value.mine || []);
        } else {
          if (activeTab === 'individual') setIndividualVacations(cached.value || []);
          if (activeTab === 'system') setSystemVacations(cached.value || []);
          if (activeTab === 'my-vacations') setMyVacations(cached.value || []);
        }
        setLoading(false);
        if (cached.ageMs < 60_000) {
          fetchDataInFlightRef.current = false;
          return;
        }
      }

      if (searchMode) {
        if (user?.role === 'admin') {
          const [individualRes, systemRes] = await Promise.all([
            api.get('/vacations', { signal: controller.signal }),
            api.get('/system-vacations', { signal: controller.signal })
          ]);
          if (requestId !== fetchDataRequestIdRef.current) return;
          const individual = individualRes.data.vacations || [];
          const system = systemRes.data.systemVacations || systemRes.data || [];
          setIndividualVacations(individual);
          setSystemVacations(system);
          writeCache(cacheKey, { individual, system, mine: [] }, { ttlMs: 5 * 60_000, deps: ['vacations'] });
          return;
        }

        if (user?.role === 'teacher') {
          const teacherId = user?._id || user?.id;
          const res = await api.get(`/vacations/user/${teacherId}`, { signal: controller.signal });
          if (requestId !== fetchDataRequestIdRef.current) return;
          const mine = res.data.vacations || [];
          setMyVacations(mine);
          writeCache(cacheKey, { individual: [], system: [], mine }, { ttlMs: 5 * 60_000, deps: ['vacations'] });
          return;
        }

        if (user?.role === 'guardian') {
          const res = await api.get('/vacations/guardian', { signal: controller.signal });
          if (requestId !== fetchDataRequestIdRef.current) return;
          const mine = res.data.vacations || [];
          setMyVacations(mine);
          writeCache(cacheKey, { individual: [], system: [], mine }, { ttlMs: 5 * 60_000, deps: ['vacations'] });
          return;
        }
      }

      if (activeTab === 'individual' && user?.role === 'admin') {
        const res = await api.get('/vacations', { signal: controller.signal });
        if (requestId !== fetchDataRequestIdRef.current) return;
        const list = res.data.vacations || [];
        setIndividualVacations(list);
        writeCache(cacheKey, list, { ttlMs: 5 * 60_000, deps: ['vacations'] });
      } else if (activeTab === 'system' && user?.role === 'admin') {
        const res = await api.get('/system-vacations', { signal: controller.signal });
        if (requestId !== fetchDataRequestIdRef.current) return;
        const list = res.data.systemVacations || res.data || [];
        setSystemVacations(list);
        writeCache(cacheKey, list, { ttlMs: 5 * 60_000, deps: ['vacations'] });
      } else if (activeTab === 'my-vacations' && user?.role === 'teacher') {
        const teacherId = user?._id || user?.id;
        const res = await api.get(`/vacations/user/${teacherId}`, { signal: controller.signal });
        if (requestId !== fetchDataRequestIdRef.current) return;
        const list = res.data.vacations || [];
        setMyVacations(list);
        writeCache(cacheKey, list, { ttlMs: 5 * 60_000, deps: ['vacations'] });
      } else if (activeTab === 'my-vacations' && user?.role === 'guardian') {
        const res = await api.get('/vacations/guardian', { signal: controller.signal });
        if (requestId !== fetchDataRequestIdRef.current) return;
        const list = res.data.vacations || [];
        setMyVacations(list);
        writeCache(cacheKey, list, { ttlMs: 5 * 60_000, deps: ['vacations'] });
      }
    } catch (err) {
      const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
      if (!isCanceled) {
        console.error('Error fetching vacation data:', err);
      }
    } finally {
      setLoading(false);
      fetchDataInFlightRef.current = false;
    }
  }, [activeTab, user?.role, user?._id, user?.id, searchTerm]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateVacation = (type) => {
    setCreateType(type);
    setEditingVacation(null);
    setShowCreateModal(true);
  };

  const floatingCreateAction = useMemo(() => {
    if (activeTab === 'individual' && user?.role === 'admin') {
      return {
        label: 'Create Vacation',
        onClick: () => handleCreateVacation('individual'),
      };
    }
    if (activeTab === 'system' && user?.role === 'admin') {
      return {
        label: 'Create System Vacation',
        onClick: () => handleCreateVacation('system'),
      };
    }
    if (activeTab === 'my-vacations' && user?.role === 'guardian') {
      return {
        label: 'Request Vacation',
        onClick: () => setShowGuardianStudentModal(true),
      };
    }
    if (activeTab === 'my-vacations' && user?.role === 'teacher') {
      return {
        label: 'Request Vacation',
        onClick: () => handleCreateVacation('individual'),
      };
    }
    return null;
  }, [activeTab, user?.role]);

  const handleEditVacation = (vacation, typeHint = 'individual') => {
    setEditingVacation(vacation);
    setCreateType(typeHint);
    setShowCreateModal(true);
  };

  const handleApproveReject = (vacation, action) => {
    setPendingApproval(vacation);
    setApprovalAction(action);
    setRejectionReason('');
    setShowApprovalModal(true);
  };

  const handleApprovalSubmit = async () => {
    if (!pendingApproval) return;

    try {
      const approved = approvalAction === 'approved';
      await api.post(`/vacations/${pendingApproval._id}/approval`, {
        approved,
        rejectionReason: approved ? undefined : rejectionReason
      });
      await fetchData();
      setShowApprovalModal(false);
      setPendingApproval(null);
    } catch (err) {
      console.error('Error updating vacation status:', err);
      alert('Error updating vacation status. Please try again.');
    }
  };

  const getVacationStatusValue = (vacation) => String(vacation?.lifecycleStatus || vacation?.status || '').trim().toLowerCase();
  const canDeleteRegularVacation = (vacation) => ['pending', 'rejected'].includes(getVacationStatusValue(vacation));

  const handleDeleteVacation = async (vacation) => {
    const isSystemVacation = Boolean(vacation?.name);
    if (!isSystemVacation && !canDeleteRegularVacation(vacation)) {
      const message = 'Only pending or rejected vacations can be deleted. Consider ending the vacation early instead.';
      alert(message);
      return;
    }

    if (!window.confirm('Are you sure you want to delete this vacation?')) return;
    startDeleteCountdown({
      message: `Deleting ${vacation?.name || 'vacation'}`,
      preDelaySeconds: 1,
      undoSeconds: 3,
      onDelete: async () => {
        try {
          if (!isSystemVacation && !canDeleteRegularVacation(vacation)) {
            const message = 'Only pending or rejected vacations can be deleted. Consider ending the vacation early instead.';
            throw new Error(message);
          }
          const endpoint = isSystemVacation 
            ? `/system-vacations/${vacation._id}`
            : `/vacations/${vacation._id}`;

          await api.delete(endpoint);
          await fetchData();
        } catch (err) {
          console.error('Error deleting vacation:', err);
          alert(err?.response?.data?.message || err?.message || 'Error deleting vacation. Please try again.');
          throw err;
        }
      }
    });
  };

  const handleTerminateSystemVacation = async (vacation) => {
    if (!window.confirm('Are you sure you want to terminate this system vacation?')) return;

    try {
      await api.post(`/system-vacations/${vacation._id}/end`);
      await fetchData();
    } catch (err) {
      console.error('Error terminating system vacation:', err);
      alert('Error terminating system vacation. Please try again.');
    }
  };

  const handleEndVacationEarly = async (vacation) => {
    const actionLabel = vacation.lifecycleStatus === 'approved' ? 'shorten this vacation' : 'end this vacation now';
    if (!window.confirm(`Are you sure you want to ${actionLabel}?`)) return;

    let endDatePayload = undefined;
    if (vacation.lifecycleStatus === 'approved' && new Date(vacation.startDate) > new Date()) {
      const newEndInput = window.prompt('Enter the new end date (YYYY-MM-DD) or leave blank to keep the current end date:');
      if (newEndInput) {
        const parsed = new Date(newEndInput);
        if (isNaN(parsed.getTime())) {
          alert('Invalid date provided. Please use YYYY-MM-DD format.');
          return;
        }
        endDatePayload = parsed.toISOString();
      }
    }

    const reason = window.prompt('Optional note about ending this vacation early:') || undefined;

    try {
      await api.post(`/vacations/${vacation._id}/end`, {
        endDate: endDatePayload,
        reason
      });
      await fetchData();
    } catch (err) {
      console.error('Error ending vacation early:', err);
      alert(err.response?.data?.message || 'Failed to end vacation early.');
    }
  };

  const handleVacationSuccess = async () => {
    await fetchData();
    setShowCreateModal(false);
    setEditingVacation(null);
  };

  const handleViewVacationDetails = async (vacation) => {
    if (!vacation?._id) return;
    setShowDetailsModal(true);
    setDetailLoading(true);
    setDetailError('');
    setDetailImpact(null);
    setDetailVacation(vacation);

    try {
      const isSystemVacation = Boolean(vacation?.name) && !vacation?.reason;
      const endpoint = isSystemVacation
        ? `/system-vacations/${vacation._id}/impact`
        : `/vacations/${vacation._id}/impact`;
      const res = await api.get(endpoint);
      setDetailVacation(res.data?.vacation || vacation);
      setDetailImpact(res.data?.impact || null);
    } catch (err) {
      console.error('Error loading vacation details:', err);
      setDetailError(err.response?.data?.message || 'Failed to load vacation details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetails = () => {
    setShowDetailsModal(false);
    setDetailVacation(null);
    setDetailImpact(null);
    setDetailError('');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return 'text-green-600 bg-green-50 border-green-200';
      case 'rejected': return 'text-red-600 bg-red-50 border-red-200';
      case 'pending': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'active': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'ended': return 'text-gray-600 bg-gray-100 border-gray-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved': return <CheckCircle className="h-4 w-4" />;
      case 'rejected': return <XCircle className="h-4 w-4" />;
      case 'pending': return <AlertCircle className="h-4 w-4" />;
      case 'active': return <Clock className="h-4 w-4" />;
      case 'ended': return <CheckCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const formatDateTime = (dateString) => {
    const value = new Date(dateString);
    if (Number.isNaN(value.getTime())) return '';

    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(value);
    } catch (e) {
      return value.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  const formatDateTimeForTimezone = useCallback((dateString, timezone, includeZone = false) => {
    const value = new Date(dateString);
    if (Number.isNaN(value.getTime())) return '';

    try {
      const formatterOptions = {
        timeZone: timezone || userTimezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      };

      if (includeZone) {
        try {
          return new Intl.DateTimeFormat('en-US', {
            ...formatterOptions,
            timeZoneName: 'shortOffset',
          }).format(value);
        } catch (offsetError) {
          return new Intl.DateTimeFormat('en-US', {
            ...formatterOptions,
            timeZoneName: 'short',
          }).format(value);
        }
      }

      return new Intl.DateTimeFormat('en-US', {
        ...formatterOptions,
      }).format(value);
    } catch (e) {
      return formatDateTime(dateString);
    }
  }, [userTimezone]);

  const buildVacationWhatsappMessage = useCallback((vacation, recipient) => {
    const recipientTimezone = recipient?.timezone || vacation?.timezone || userTimezone;
    const epithet = formatRecipientEpithet(recipient?.epithet);
    const greetingName = `${epithet ? `${epithet} ` : ''}${recipient?.firstName || ''}`.trim()
      || `${recipient?.firstName || ''} ${recipient?.lastName || ''}`.trim()
      || 'there';
    const startLabel = formatDateTimeForTimezone(vacation.startDate, recipientTimezone, true);
    const endLabel = formatDateTimeForTimezone(vacation.endDate, recipientTimezone, true);
    const messageBody = String(vacation.message || '').trim();

    return [
      VACATION_WHATSAPP_COPY.title,
      VACATION_WHATSAPP_COPY.decorativeLine,
      '',
      `${VACATION_WHATSAPP_COPY.greetingPrefix} ${greetingName},`,
      '',
      `${vacation.name}`,
      messageBody,
      `${VACATION_WHATSAPP_COPY.beginsLabel}: ${startLabel}`,
      `${VACATION_WHATSAPP_COPY.endsLabel}: ${endLabel}`,
      VACATION_WHATSAPP_COPY.timezoneNote,
    ].filter(Boolean).join('\n');
  }, [formatDateTimeForTimezone, userTimezone]);

  const fetchWhatsappRecipients = useCallback(async (audience) => {
    const res = await api.get('/settings/whatsapp-recipients', { params: { audience } });
    return Array.isArray(res?.data?.recipients) ? res.data.recipients : [];
  }, []);

  const openVacationWhatsappWindow = useCallback(() => {
    let popup = whatsappDraftWindowRef.current;

    if (!popup || popup.closed) {
      popup = window.open('', 'waraqa-vacation-whatsapp-sender');
      if (!popup) return null;
      whatsappDraftWindowRef.current = popup;
    }

    try {
      popup.focus();
    } catch (e) {
      // ignore focus errors
    }

    return popup;
  }, []);

  const clearVacationWhatsappTimer = useCallback(() => {
    if (whatsappDraftTimerRef.current) {
      clearTimeout(whatsappDraftTimerRef.current);
      whatsappDraftTimerRef.current = null;
    }
  }, []);

  const updateQueueStatus = useCallback((session, index, status) => {
    const queue = Array.isArray(session?.queue) ? session.queue : [];
    return queue.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, status } : entry
    ));
  }, []);

  const finalizeVacationWhatsappSession = useCallback((session) => {
    clearVacationWhatsappTimer();
    const queue = Array.isArray(session?.queue) ? session.queue : [];
    const autoFailed = queue
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.status === 'opened')
      .map(({ entry, index }) => ({
        id: entry.id || `opened-${index}`,
        name: entry.name || 'Unknown recipient',
        role: entry.role || 'unknown',
        reason: 'Opened but not confirmed as sent before auto-advance',
      }));
    const existingFailures = Array.isArray(session?.failed) ? session.failed : [];
    const failureKeys = new Set(existingFailures.map((item) => `${item.role}:${item.id}:${item.reason}`));
    const mergedFailures = [...existingFailures];
    autoFailed.forEach((item) => {
      const key = `${item.role}:${item.id}:${item.reason}`;
      if (!failureKeys.has(key)) {
        mergedFailures.push(item);
        failureKeys.add(key);
      }
    });

    setWhatsappDraftReport({
      timestamp: new Date().toISOString(),
      vacationId: session?.vacationId || null,
      vacationName: session?.vacationName || 'System vacation',
      audience: session?.audience || 'all',
      attempted: Array.isArray(session?.recipients) ? session.recipients.length : 0,
      sent: session?.sent || [],
      failed: mergedFailures,
    });
    setWhatsappDraftSession(null);
    setWhatsappDraftProgress(null);
  }, [clearVacationWhatsappTimer]);

  const openVacationWhatsappDraftForRecipient = useCallback((session, recipient, index) => {
    if (!session || !recipient) return false;

    const popup = openVacationWhatsappWindow();
    if (!popup) {
      const recipientName = `${recipient?.firstName || ''} ${recipient?.lastName || ''}`.trim() || 'Unknown recipient';
      finalizeVacationWhatsappSession({
        ...session,
        failed: [
          ...(session.failed || []),
          {
            id: recipient?.id || `popup-${index}`,
            name: recipientName,
            role: recipient?.role || 'unknown',
            reason: 'Popup blocked while opening the WhatsApp tab',
          },
        ],
      });
      return false;
    }

    const validation = validateWhatsappPhone(recipient?.phone);
    if (!validation.ok) {
      const recipientName = `${recipient?.firstName || ''} ${recipient?.lastName || ''}`.trim() || 'Unknown recipient';
      finalizeVacationWhatsappSession({
        ...session,
        failed: [
          ...(session.failed || []),
          {
            id: recipient?.id || `invalid-open-${index}`,
            name: recipientName,
            role: recipient?.role || 'unknown',
            reason: validation.reason,
          },
        ],
      });
      return false;
    }

    const message = buildVacationWhatsappMessage(session.vacation, recipient);
    popup.location.href = `https://wa.me/${validation.normalized}?text=${encodeURIComponent(message)}`;

    setWhatsappDraftSession((prev) => {
      const base = prev || session;
      if (!base) return prev;
      return {
        ...base,
        draftOpenedForIndex: index,
        queue: updateQueueStatus(base, index, 'opened'),
      };
    });

    clearVacationWhatsappTimer();
    whatsappDraftTimerRef.current = setTimeout(() => {
      const currentSession = whatsappDraftSessionRef.current;
      if (!currentSession) return;
      if (currentSession.currentIndex !== index) return;

      const nextSession = {
        ...currentSession,
        draftOpenedForIndex: null,
      };

      advanceVacationWhatsappSessionRef.current?.(nextSession, index + 1, true);
    }, 3000);

    return true;
  }, [buildVacationWhatsappMessage, clearVacationWhatsappTimer, finalizeVacationWhatsappSession, openVacationWhatsappWindow, updateQueueStatus]);

  const advanceVacationWhatsappSession = useCallback((session, startIndex = 0, autoOpenCurrent = false) => {
    if (!session) return;

    const recipients = Array.isArray(session.recipients) ? session.recipients : [];
    const nextFailed = [...(session.failed || [])];
    let nextIndex = startIndex;

    while (nextIndex < recipients.length) {
      const recipient = recipients[nextIndex];
      const recipientName = `${recipient?.firstName || ''} ${recipient?.lastName || ''}`.trim() || 'Unknown recipient';
      const validation = validateWhatsappPhone(recipient?.phone);

      if (!validation.ok) {
        nextFailed.push({
          id: recipient?.id || `invalid-${nextIndex}`,
          name: recipientName,
          role: recipient?.role || 'unknown',
          reason: validation.reason,
        });
        nextIndex += 1;
        continue;
      }

      const nextSession = {
        ...session,
        failed: nextFailed,
        currentIndex: nextIndex,
        currentRecipient: recipient,
        draftOpenedForIndex: null,
        queue: Array.isArray(session?.queue) ? session.queue : [],
      };

      setWhatsappDraftSession(nextSession);
      setWhatsappDraftProgress({
        vacationId: session?.vacationId || null,
        audience: session?.audience || 'all',
        current: nextIndex + 1,
        total: recipients.length,
        name: recipientName,
      });

      if (autoOpenCurrent) {
        openVacationWhatsappDraftForRecipient(nextSession, recipient, nextIndex);
      }
      return;
    }

    finalizeVacationWhatsappSession({
      ...session,
      failed: nextFailed,
      currentIndex: recipients.length,
      currentRecipient: null,
      draftOpenedForIndex: null,
    });
  }, [finalizeVacationWhatsappSession, openVacationWhatsappDraftForRecipient]);

  useEffect(() => {
    advanceVacationWhatsappSessionRef.current = advanceVacationWhatsappSession;
  }, [advanceVacationWhatsappSession]);

  const markVacationWhatsappRecipient = useCallback((wasSent) => {
    if (!whatsappDraftSession) return;

    if (whatsappDraftSession.draftOpenedForIndex !== whatsappDraftSession.currentIndex) {
      alert('Open the current recipient draft first, then mark it as sent or not sent.');
      return;
    }

    clearVacationWhatsappTimer();

    const currentRecipient = whatsappDraftSession.recipients?.[whatsappDraftSession.currentIndex];
    if (!currentRecipient) {
      finalizeVacationWhatsappSession(whatsappDraftSession);
      return;
    }

    const recipientName = `${currentRecipient.firstName || ''} ${currentRecipient.lastName || ''}`.trim() || 'Unknown recipient';
    const validation = validateWhatsappPhone(currentRecipient.phone);
    const nextSession = {
      ...whatsappDraftSession,
      sent: [...(whatsappDraftSession.sent || [])],
      failed: [...(whatsappDraftSession.failed || [])],
    };

    if (wasSent) {
      nextSession.sent.push({
        id: currentRecipient.id,
        name: recipientName,
        role: currentRecipient.role,
        phone: validation.normalized,
      });
      nextSession.queue = updateQueueStatus(nextSession, whatsappDraftSession.currentIndex, 'sent');
    } else {
      const reasonInput = window.prompt(
        `Marking ${recipientName} as not sent. Optional reason:`,
        'Not confirmed as sent'
      );
      nextSession.failed.push({
        id: currentRecipient.id,
        name: recipientName,
        role: currentRecipient.role,
        reason: String(reasonInput || '').trim() || 'Not confirmed as sent',
      });
      nextSession.queue = updateQueueStatus(nextSession, whatsappDraftSession.currentIndex, 'not_sent');
    }

    advanceVacationWhatsappSession(nextSession, (whatsappDraftSession.currentIndex || 0) + 1, true);
  }, [advanceVacationWhatsappSession, clearVacationWhatsappTimer, finalizeVacationWhatsappSession, updateQueueStatus, whatsappDraftSession]);

  const reopenCurrentVacationWhatsappDraft = useCallback(() => {
    if (!whatsappDraftSession?.currentRecipient) return;

    const opened = openVacationWhatsappDraftForRecipient(
      whatsappDraftSession,
      whatsappDraftSession.currentRecipient,
      whatsappDraftSession.currentIndex || 0,
    );

    if (!opened) {
      alert('Could not open the WhatsApp draft. Please allow popups and try again.');
    }
  }, [openVacationWhatsappDraftForRecipient, whatsappDraftSession]);

  const handleLaunchVacationWhatsAppDrafts = useCallback(async (vacation, audience) => {
    if (!vacation?._id) {
      setWhatsappDraftReport({
        timestamp: new Date().toISOString(),
        vacationId: vacation?._id || null,
        vacationName: vacation?.name || 'System vacation',
        audience,
        attempted: 0,
        sent: [],
        failed: [{ id: 'invalid-vacation', name: 'System vacation', role: 'system', reason: 'Vacation record is missing or invalid' }],
      });
      return;
    }

    const popup = openVacationWhatsappWindow();
    if (!popup) {
      setWhatsappDraftReport({
        timestamp: new Date().toISOString(),
        vacationId: vacation?._id || null,
        vacationName: vacation?.name || 'System vacation',
        audience,
        attempted: 0,
        sent: [],
        failed: [{ id: 'popup-blocked', name: 'WhatsApp sender', role: 'system', reason: 'Popup blocked while opening the WhatsApp tab' }],
      });
      return;
    }

    try {
      popup.document.title = 'Waraqa WhatsApp Sender';
      popup.document.body.innerHTML = '<div style="font-family: Segoe UI, Arial, sans-serif; padding: 24px; line-height: 1.6;"><h2>Preparing WhatsApp sender...</h2><p>Keep this tab open. The next recipient draft will load here.</p></div>';
    } catch (e) {
      // ignore document access issues
    }

    setWhatsappDraftProgress({
      vacationId: vacation?._id || null,
      audience,
      current: 0,
      total: 0,
      name: '',
    });

    try {
      const audiences = audience === 'all'
        ? ['active_guardians', 'active_teachers']
        : [audience === 'guardians' ? 'active_guardians' : 'active_teachers'];
      const results = await Promise.all(audiences.map((item) => fetchWhatsappRecipients(item)));
      const recipients = [];
      const seen = new Set();

      results.flat().forEach((recipient) => {
        const key = `${recipient.role}:${recipient.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        recipients.push(recipient);
      });

      const session = {
        vacation,
        vacationId: vacation?._id || null,
        vacationName: vacation?.name || 'System vacation',
        audience,
        recipients,
        currentIndex: 0,
        currentRecipient: null,
        draftOpenedForIndex: null,
        queue: recipients.map((recipient) => ({
          id: recipient.id,
          name: `${recipient.firstName || ''} ${recipient.lastName || ''}`.trim() || 'Unknown recipient',
          role: recipient.role,
          status: 'pending',
        })),
        sent: [],
        failed: [],
      };

      if (!recipients.length) {
        finalizeVacationWhatsappSession(session);
        return;
      }

      advanceVacationWhatsappSession(session, 0, true);
    } catch (err) {
      console.error('Error preparing vacation WhatsApp drafts:', err);
      setWhatsappDraftSession(null);
      setWhatsappDraftReport({
        timestamp: new Date().toISOString(),
        vacationId: vacation?._id || null,
        vacationName: vacation?.name || 'System vacation',
        audience,
        attempted: 0,
        sent: [],
        failed: [{
          id: 'request-error',
          name: 'Recipient lookup',
          role: 'system',
          reason: err?.response?.data?.message || err?.message || 'Failed to load recipients',
        }],
      });
      setWhatsappDraftProgress(null);
    } finally {
      // progress stays active until the operator finishes the in-app send session
    }
  }, [advanceVacationWhatsappSession, fetchWhatsappRecipients, finalizeVacationWhatsappSession, openVacationWhatsappDraftForRecipient, openVacationWhatsappWindow]);

  const filteredIndividualVacations = individualVacations.filter(vacation => {
    const teacherFirst = vacation.user?.firstName || vacation.teacher?.firstName || '';
    const teacherLast = vacation.user?.lastName || vacation.teacher?.lastName || '';
    const teacherFull = vacation.user?.fullName || `${teacherFirst} ${teacherLast}`;
    const matchesSearch = teacherFull.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vacation.reason?.toLowerCase().includes(searchTerm.toLowerCase());
    const status = vacation.lifecycleStatus || vacation.status;
    const matchesFilter = globalFilter === 'all' || status === globalFilter;
    return matchesSearch && matchesFilter;
  });

  const filteredSystemVacations = systemVacations.filter(vacation => {
    const matchesSearch = vacation.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vacation.message?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = globalFilter === 'all' || vacation.status === globalFilter;
    return matchesSearch && matchesFilter;
  });

  const filteredMyVacations = myVacations.filter(vacation => {
    const matchesSearch = vacation.reason?.toLowerCase().includes(searchTerm.toLowerCase());
    const status = vacation.lifecycleStatus || vacation.status;
    const matchesFilter = globalFilter === 'all' || status === globalFilter;
    return matchesSearch && matchesFilter;
  });

  const groupedGuardianMyVacations = useMemo(() => {
    if (user?.role !== 'guardian') return [];

    const localDayKey = (value) => {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const minuteBucket = (value) => {
      const d = value ? new Date(value) : null;
      const ms = d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
      return Math.floor(ms / 60000);
    };

    const groups = new Map();

    for (const v of (filteredMyVacations || [])) {
      if (!v) continue;
      const status = v.lifecycleStatus || v.status || 'pending';
      const startKey = localDayKey(v.startDate);
      const endKey = localDayKey(v.effectiveEndDate || v.actualEndDate || v.endDate);
      const createdBucket = minuteBucket(v.createdAt);
      const reason = v.reason || '';
      const key = `${status}::${startKey}::${endKey}::${reason}::${createdBucket}`;

      const existing = groups.get(key) || {
        key,
        status,
        reason,
        startDate: v.startDate,
        endDate: v.effectiveEndDate || v.actualEndDate || v.endDate,
        createdAt: v.createdAt,
        vacations: [],
        studentNames: []
      };

      existing.vacations.push(v);
      if (v.userName) existing.studentNames.push(v.userName);
      groups.set(key, existing);
    }

    const normalize = (name) => String(name || '').trim();

    return Array.from(groups.values())
      .map((g) => {
        const deduped = Array.from(new Set((g.studentNames || []).map(normalize).filter(Boolean)));
        deduped.sort((a, b) => a.localeCompare(b));
        return { ...g, studentNames: deduped };
      })
      .sort((a, b) => {
        const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bMs - aMs;
      });
  }, [filteredMyVacations, user?.role]);

  const handleDeleteGuardianVacationGroup = async (group) => {
    if (!group || !Array.isArray(group.vacations) || group.vacations.length === 0) return;

    const canDelete = group.vacations.every((v) => {
      const status = v.lifecycleStatus || v.status;
      return ['pending', 'rejected'].includes(status);
    });

    if (!canDelete) {
      alert('Only pending or rejected vacations can be deleted. Consider ending the vacation early instead.');
      return;
    }

    const confirmMsg = `Delete this vacation request for ${group.vacations.length} student${group.vacations.length === 1 ? '' : 's'}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await Promise.allSettled(group.vacations.map((v) => api.delete(`/vacations/${v._id}`)));
      await fetchData();
    } catch (e) {
      console.error('Error deleting guardian vacation group', e);
      alert('Error deleting vacation request. Please try again.');
    }
  };

  const vacationSummaryRows = useMemo(() => {
    if (user?.role !== 'admin') return [];

    const rangeStart = parseLocalDayStart(summaryFrom);
    const rangeEnd = parseLocalDayEnd(summaryTo);
    if (!rangeStart || !rangeEnd) return [];

    if (rangeEnd < rangeStart) return [];

    const overlapMs = (start, end) => {
      if (!start || !end) return 0;
      const startMs = start.getTime();
      const endMs = end.getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
      if (endMs <= startMs) return 0;
      const oStart = Math.max(startMs, rangeStart.getTime());
      const oEnd = Math.min(endMs, rangeEnd.getTime());
      return Math.max(0, oEnd - oStart);
    };

    const formatAggregate = (ms) => {
      const hours = ms / (1000 * 60 * 60);
      if (hours < 24) {
        const val = Math.round(hours * 10) / 10;
        return `${val}${val === 1 ? ' hr' : ' hrs'}`;
      }
      const days = hours / 24;
      if (days < 30) {
        const val = Math.round(days * 10) / 10;
        return `${val}${val === 1 ? ' day' : ' days'}`;
      }
      const months = days / 30;
      const val = Math.round(months * 10) / 10;
      return `${val}${val === 1 ? ' month' : ' months'}`;
    };

    const getTeacherAllowance = (teacherUser) => {
      const ti = teacherUser?.teacherInfo;
      const currentYear = new Date().getFullYear();
      const yearlyOverride = Array.isArray(ti?.vacationAllowance?.yearlyOverrides)
        ? ti.vacationAllowance.yearlyOverrides.find((entry) => Number(entry?.year) === currentYear)
        : null;
      const raw =
        yearlyOverride?.days ??
        ti?.vacationAllowance?.defaultDaysPerYear ??
        ti?.vacationAllowanceDaysPerYear ??
        ti?.vacationDaysPerYear ??
        ti?.allowedVacationDaysPerYear ??
        ti?.vacationAllowanceDays ??
        null;
      const numeric = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0) {
        return `${numeric} days/year`;
      }
      return '—';
    };

    const totals = new Map();

    (individualVacations || []).forEach((vacation) => {
      if (!vacation) return;
      if (vacation.role && vacation.role !== 'teacher') return;

      const status = vacation.lifecycleStatus || vacation.status || vacation.approvalStatus;
      if (['rejected', 'cancelled'].includes(status)) return;

      const teacherId = String(vacation.user?._id || vacation.user?.id || vacation.teacher?._id || vacation.teacher || '');
      if (!teacherId) return;

      const teacherName =
        vacation.user?.fullName ||
        `${vacation.user?.firstName || vacation.teacher?.firstName || ''} ${vacation.user?.lastName || vacation.teacher?.lastName || ''}`.trim() ||
        vacation.user?.email ||
        'Unknown teacher';

      const start = new Date(vacation.startDate);
      const end = new Date(vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate);
      const duration = overlapMs(start, end);
      if (duration <= 0) return;

      const existing = totals.get(teacherId) || {
        teacherId,
        teacherName,
        totalMs: 0,
        vacationCount: 0,
        allowance: getTeacherAllowance(vacation.user)
      };

      existing.totalMs += duration;
      existing.vacationCount += 1;
      totals.set(teacherId, existing);
    });

    return Array.from(totals.values())
      .map((row) => ({
        ...row,
        totalLabel: formatAggregate(row.totalMs)
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [user?.role, individualVacations, summaryFrom, summaryTo]);

  const renderIndividualVacations = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Individual Vacations</h2>
        </div>
      </div>

      {/* Summary */}
      {user?.role === 'admin' && (
        <div className="bg-white rounded-lg shadow p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Vacation summary</h3>
              <p className="text-sm text-gray-600">Totals are based on vacations overlapping the selected period.</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input
                  type="date"
                  value={summaryFrom}
                  onChange={(e) => setSummaryFrom(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input
                  type="date"
                  value={summaryTo}
                  onChange={(e) => setSummaryTo(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
            </div>
          </div>

          {(() => {
            const start = parseLocalDayStart(summaryFrom);
            const end = parseLocalDayEnd(summaryTo);
            const invalid = !start || !end || end < start;
            if (invalid) {
              return <p className="mt-4 text-sm text-red-600">Select a valid date range.</p>;
            }
            if (vacationSummaryRows.length === 0) {
              return <p className="mt-4 text-sm text-gray-600">No teacher vacations found in this period.</p>;
            }

            return (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-gray-600 border-b">
                      <th className="py-2 pr-4">Teacher</th>
                      <th className="py-2 pr-4">Vacations</th>
                      <th className="py-2 pr-4">Total</th>
                      <th className="py-2">Allowance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {vacationSummaryRows.map((row) => (
                      <tr key={row.teacherId}>
                        <td className="py-2 pr-4 font-medium text-gray-900 whitespace-nowrap">{row.teacherName}</td>
                        <td className="py-2 pr-4 text-gray-700">{row.vacationCount}</td>
                        <td className="py-2 pr-4 text-gray-700 whitespace-nowrap">{row.totalLabel}</td>
                        <td className="py-2 text-gray-700 whitespace-nowrap">{row.allowance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-gray-500">Allowance appears only if it’s configured on the teacher profile.</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Vacation List */}
      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading vacations...</p>
          </div>
        ) : filteredIndividualVacations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No individual vacations found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredIndividualVacations.map((vacation) => {
              const status = vacation.lifecycleStatus || vacation.status;
              const isStudentVacation = vacation?.role === 'student';
              const teacherName = vacation.user?.fullName || `${vacation.user?.firstName || vacation.teacher?.firstName || ''} ${vacation.user?.lastName || vacation.teacher?.lastName || ''}`.trim();
              const studentName = vacation.userName || vacation.studentName || '';
              const displayName = isStudentVacation ? (studentName || 'Student') : (teacherName || 'Unknown Teacher');
              const effectiveEndDate = vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate;
              const teacherId = vacation.user?._id || vacation.user?.id || vacation.teacher?._id;
              const impactedTeachers = Array.isArray(vacation.impactedTeachers) ? vacation.impactedTeachers : [];
              const impactedTeacherNames = impactedTeachers
                .map((t) => (typeof t === 'string' ? t : (t?.name || '')))
                .filter(Boolean);

              return (
              <div key={vacation._id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">
                            {displayName}
                      </h3>
                          <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
                            {getStatusIcon(status)}
                            <span className="capitalize">{status}</span>
                      </span>
                    </div>
                    <p className="text-gray-600 mb-2">{vacation.reason}</p>
                    {isStudentVacation && impactedTeacherNames.length > 0 && (
                      <p className="text-sm text-gray-500 mb-2">Teachers: {impactedTeacherNames.join(', ')}</p>
                    )}
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                            <span>{formatDateTime(vacation.startDate)} - {formatDateTime(effectiveEndDate)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Users className="h-4 w-4" />
                            <span>{isStudentVacation ? '1 student' : `${vacation.substitutes?.length || 0} students configured`}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => handleViewVacationDetails(vacation)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    
                    {user?.role === 'admin' && (vacation.status === 'pending' || vacation.lifecycleStatus === 'pending') && (
                      <>
                        <button 
                          onClick={() => handleApproveReject(vacation, 'approved')}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                          title="Approve"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleApproveReject(vacation, 'rejected')}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Reject"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    
                    {((user?.role === 'admin') || 
                      (user?.role === 'teacher' && teacherId === (user._id || user.id) && vacation.status === 'pending')) && (
                      <button 
                        onClick={() => handleEditVacation(vacation, 'individual')}
                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    )}
                    
                    {((user?.role === 'admin') ||
                      (user?.role === 'teacher' && teacherId === (user._id || user.id))) &&
                      ['approved', 'active'].includes(status) && (
                        <button
                          onClick={() => handleEndVacationEarly(vacation)}
                          className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                          title="End Vacation Early"
                        >
                          <Clock className="h-4 w-4" />
                        </button>
                      )}

                    {(((user?.role === 'admin') && canDeleteRegularVacation(vacation)) || 
                      (user?.role === 'teacher' && teacherId === (user._id || user.id) && canDeleteRegularVacation(vacation))) && (
                      <button 
                        onClick={() => handleDeleteVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderSystemVacations = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">System Vacations</h2>
          <p className="text-gray-600">Manage institution-wide holidays and breaks</p>
        </div>
      </div>

      {whatsappDraftProgress && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="font-semibold">
                Sending WhatsApp one by one for {whatsappDraftProgress.current}/{whatsappDraftProgress.total || 0}
                {whatsappDraftProgress.name ? ` • ${whatsappDraftProgress.name}` : ''}
              </div>
              <div className="mt-1 text-blue-800">
                One reusable WhatsApp tab is used for the full run. Each opened draft waits 3 seconds, then the next recipient opens automatically unless you click Sent or Not sent first.
              </div>
            </div>
            {whatsappDraftSession?.currentRecipient && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={reopenCurrentVacationWhatsappDraft}
                  className="rounded-lg border border-blue-300 bg-white px-3 py-2 font-medium text-blue-700 hover:bg-blue-100"
                >
                  Reopen draft
                </button>
                <button
                  type="button"
                  onClick={() => markVacationWhatsappRecipient(true)}
                  className="rounded-lg border border-green-300 bg-green-600 px-3 py-2 font-medium text-white hover:bg-green-700"
                >
                  Sent
                </button>
                <button
                  type="button"
                  onClick={() => markVacationWhatsappRecipient(false)}
                  className="rounded-lg border border-orange-300 bg-orange-600 px-3 py-2 font-medium text-white hover:bg-orange-700"
                >
                  Not sent
                </button>
              </div>
            )}
          </div>

          {Array.isArray(whatsappDraftSession?.queue) && whatsappDraftSession.queue.length > 0 && (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {whatsappDraftSession.queue.map((entry, index) => {
                const status = String(entry.status || 'pending');
                const isCurrent = index === whatsappDraftSession.currentIndex;
                const tone = status === 'sent'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : status === 'not_sent'
                    ? 'border-orange-200 bg-orange-50 text-orange-800'
                    : status === 'opened'
                      ? 'border-blue-200 bg-blue-100 text-blue-900'
                      : 'border-slate-200 bg-white text-slate-700';

                return (
                  <div key={`${entry.role}-${entry.id}-${index}`} className={`rounded-lg border px-3 py-2 ${tone}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium truncate">{entry.name}</div>
                      <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold capitalize">
                        {status === 'not_sent' ? 'not sent' : status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-xs opacity-80">
                      <span>{entry.role}</span>
                      <span>{isCurrent ? 'current' : `#${index + 1}`}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* System Vacation List */}
      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading system vacations...</p>
          </div>
        ) : filteredSystemVacations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Globe className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No system vacations found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredSystemVacations.map((vacation) => (
              <div key={vacation._id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{vacation.name}</h3>
                      {vacation.isActive && (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-200">
                          <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                          <span>Active</span>
                        </span>
                      )}
                    </div>
                    <div className="mb-4 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-emerald-50 p-4 shadow-sm">
                      <div className="text-center text-xs tracking-[0.28em] text-amber-700" style={{ fontFamily: VACATION_LABEL_FONT }}>
                        {ISLAMIC_DECORATIVE_LINE}
                      </div>
                      <p className="mt-3 text-lg leading-8 text-slate-700 whitespace-pre-line" style={{ fontFamily: VACATION_BODY_FONT }}>
                        {vacation.message}
                      </p>
                    </div>
                    <div className="grid gap-3 text-sm text-gray-600 md:grid-cols-3">
                      <div className="flex items-start space-x-2 rounded-xl border border-gray-200 bg-white px-3 py-3">
                        <Calendar className="h-4 w-4" />
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400" style={{ fontFamily: VACATION_LABEL_FONT }}>
                            Begins
                          </div>
                          <span className="mt-1 block">{formatDateTime(vacation.startDate)}</span>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2 rounded-xl border border-gray-200 bg-white px-3 py-3">
                        <Calendar className="h-4 w-4" />
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400" style={{ fontFamily: VACATION_LABEL_FONT }}>
                            Ends
                          </div>
                          <span className="mt-1 block">{formatDateTime(vacation.endDate)}</span>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2 rounded-xl border border-gray-200 bg-white px-3 py-3">
                        <Clock className="h-4 w-4" />
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400" style={{ fontFamily: VACATION_LABEL_FONT }}>
                            Timezone
                          </div>
                          <span className="mt-1 block">Set in {vacation.timezone} and shown here in {userTimezone}</span>
                        </div>
                      </div>
                      <div className="flex items-start space-x-2 rounded-xl border border-gray-200 bg-white px-3 py-3 md:col-span-3">
                        <Users className="h-4 w-4" />
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] text-gray-400" style={{ fontFamily: VACATION_LABEL_FONT }}>
                            Impact
                          </div>
                          <span className="mt-1 block">{vacation.affectedClasses || 0} classes affected during this system vacation.</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleLaunchVacationWhatsAppDrafts(vacation, 'guardians')}
                        disabled={Boolean(whatsappDraftProgress)}
                        className="inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Send className="h-4 w-4" />
                        Send to guardians
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaunchVacationWhatsAppDrafts(vacation, 'teachers')}
                        disabled={Boolean(whatsappDraftProgress)}
                        className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Send className="h-4 w-4" />
                        Send to teachers
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaunchVacationWhatsAppDrafts(vacation, 'all')}
                        disabled={Boolean(whatsappDraftProgress)}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Users className="h-4 w-4" />
                        Send to all active users
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleVacationWhatsappReport(vacation._id)}
                        className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
                      >
                        <Eye className="h-4 w-4" />
                        {String(visibleWhatsappReportVacationId) === String(vacation._id) ? 'Hide last WhatsApp run' : 'Show last WhatsApp run'}
                      </button>
                    </div>
                    {renderVacationWhatsappReport(vacation)}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => handleViewVacationDetails(vacation)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    
                    <button 
                      onClick={() => handleEditVacation(vacation, 'system')}
                      className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                      title="Edit"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    
                    {vacation.isActive ? (
                      <button 
                        onClick={() => handleTerminateSystemVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                        title="Terminate Early"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleDeleteVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderMyVacations = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">My Vacations</h2>
          <p className="text-gray-600">Manage your vacation requests and view status</p>
        </div>
      </div>

      {/* My Vacation List */}
      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading your vacations...</p>
          </div>
        ) : filteredMyVacations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No vacation requests found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {user?.role === 'guardian'
              ? groupedGuardianMyVacations.map((group) => {
                  const status = group.status;
                  const studentCount = group.vacations.length;
                  const names = group.studentNames || [];
                  const shown = names.slice(0, 4);
                  const remaining = Math.max(0, names.length - shown.length);

                  return (
                    <div key={group.key} className="p-6 hover:bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-lg font-semibold text-gray-900">{group.reason}</h3>
                            <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
                              {getStatusIcon(status)}
                              <span className="capitalize">{status}</span>
                            </span>
                          </div>

                          <div className="text-sm text-gray-600 mb-2">
                            Students: {studentCount}
                            {shown.length > 0 && (
                              <>
                                {' '}· {shown.join(', ')}{remaining ? ` +${remaining} more` : ''}
                              </>
                            )}
                          </div>

                          <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <div className="flex items-center space-x-1">
                              <Calendar className="h-4 w-4" />
                              <span>{formatDateTime(group.startDate)} - {formatDateTime(group.endDate)}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Users className="h-4 w-4" />
                              <span>Student vacation</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleDeleteGuardianVacationGroup(group)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              : filteredMyVacations.map((vacation) => {
              const status = vacation.lifecycleStatus || vacation.status;
              const effectiveEndDate = vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate;
              const isStudentVacation = vacation.role === 'student';
              return (
              <div key={vacation._id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{vacation.reason}</h3>
                      <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
                        {getStatusIcon(status)}
                        <span className="capitalize">{status}</span>
                      </span>
                    </div>
                    {user?.role === 'guardian' && isStudentVacation && (
                      <div className="text-sm text-gray-600 mb-2">
                        Student: {vacation.userName || 'Student'}
                      </div>
                    )}
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                        <span>{formatDateTime(vacation.startDate)} - {formatDateTime(effectiveEndDate)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Users className="h-4 w-4" />
                        <span>{isStudentVacation ? 'Student vacation' : `${vacation.substitutes?.length || 0} students configured`}</span>
                      </div>
                    </div>
                    {status === 'rejected' && vacation.rejectionReason && (
                      <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-sm text-red-800">
                          <strong>Rejection Reason:</strong> {vacation.rejectionReason}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {user?.role !== 'guardian' && (
                      <button 
                        onClick={() => handleViewVacationDetails(vacation)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    )}
                    
                    {status === 'pending' && user?.role !== 'guardian' && (
                      <button 
                        onClick={() => handleEditVacation(vacation, 'individual')}
                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    )}

                    {canDeleteRegularVacation(vacation) && user?.role !== 'guardian' && (
                      <button 
                        onClick={() => handleDeleteVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}

                    {canDeleteRegularVacation(vacation) && user?.role === 'guardian' && (
                      <button 
                        onClick={() => handleDeleteVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}

                    {['approved', 'active'].includes(status) && (
                      <button
                        onClick={() => handleEndVacationEarly(vacation)}
                        className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                        title="End Vacation Early"
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'individual' && renderIndividualVacations()}
      {activeTab === 'system' && renderSystemVacations()}
      {activeTab === 'my-vacations' && renderMyVacations()}

      {floatingCreateAction ? (
        <div className="fixed bottom-24 right-6 z-40">
          <PrimaryButton
            onClick={floatingCreateAction.onClick}
            circle
            size="lg"
            aria-label={floatingCreateAction.label}
            title={floatingCreateAction.label}
          >
            <Plus className="h-5 w-5" />
          </PrimaryButton>
        </div>
      ) : null}

      {/* Vacation Modal */}
      <VacationModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setEditingVacation(null);
        }}
        type={createType}
        vacation={editingVacation}
        onSuccess={handleVacationSuccess}
      />

      <VacationDetailsModal
        isOpen={showDetailsModal}
        onClose={handleCloseDetails}
        vacation={detailVacation}
        impact={detailImpact}
        loading={detailLoading}
        error={detailError}
      />

      <GuardianStudentVacationModal
        isOpen={showGuardianStudentModal}
        onClose={() => setShowGuardianStudentModal(false)}
        onSuccess={async () => {
          await fetchData();
          setShowGuardianStudentModal(false);
        }}
      />

      {/* Approval Modal */}
      {showApprovalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {approvalAction === 'approved' ? 'Approve' : 'Reject'} Vacation Request
            </h3>
            
            {pendingApproval && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="font-medium">{pendingApproval.user?.fullName || `${pendingApproval.user?.firstName || ''} ${pendingApproval.user?.lastName || ''}`.trim()}</p>
                <p className="text-sm text-gray-600">{pendingApproval.reason}</p>
                <p className="text-sm text-gray-500">
                  {formatDateTime(pendingApproval.startDate)} - {formatDateTime(pendingApproval.effectiveEndDate || pendingApproval.endDate)}
                </p>
              </div>
            )}

            {approvalAction === 'rejected' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rejection Reason *
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Please provide a reason for rejection..."
                />
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowApprovalModal(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApprovalSubmit}
                disabled={approvalAction === 'rejected' && !rejectionReason.trim()}
                className={`px-4 py-2 text-white rounded-lg ${
                  approvalAction === 'approved' 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {approvalAction === 'approved' ? 'Approve' : 'Reject'} Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VacationManagementPage;