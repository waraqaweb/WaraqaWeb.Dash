import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateDDMMMYYYY } from '../../utils/date';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';
import {
  X,
  Copy,
  FileDown,
  FileText,
  User,
  Mail,
  Calendar,
  Sparkles,
  Link2
} from 'lucide-react';

// Helper function to render text with **bold** markdown and bullet points
const formatNoteText = (text) => {
  if (!text) return null;
  
  return text.split('\n').map((line, lineIndex) => {
    // Split by **bold** markers
    const parts = line.split(/(\*\*.*?\*\*)/g);
    
    return (
      <span key={lineIndex} className="block">
        {parts.map((part, i) => {
          // Handle bold text
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={i} className="font-semibold text-slate-900">
                {part.slice(2, -2)}
              </strong>
            );
          }
          
          // Handle bullet points (•)
          if (part.includes('•')) {
            return (
              <span key={i} className="inline-flex items-center gap-1.5">
                {part.split('•').map((segment, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && <span className="text-slate-400">•</span>}
                    <span>{segment.trim()}</span>
                  </React.Fragment>
                ))}
              </span>
            );
          }
          
          return <span key={i}>{part}</span>;
        })}
      </span>
    );
  });
};

// Format date as "Tue, 15 Jan 2025"
const formatDateWithDay = (date) => {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '-';
  
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  
  return `${dayName}, ${day < 10 ? '0' + day : day} ${month} ${year}`;
};

const formatClassDateLine = (value) => {
  if (!value || !(value instanceof Date) || Number.isNaN(value.getTime())) return '-';
  return value.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const formatClassTimeLine = (value) => {
  if (!value || !(value instanceof Date) || Number.isNaN(value.getTime())) return '-';
  return value
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase();
};

const roundCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const normalizeStatusValue = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const CANCELLED_CLASS_STATUSES = new Set([
  'cancelled',
  'cancelled_by_teacher',
  'cancelled_by_student',
  'cancelled_by_guardian',
  'cancelled_by_admin',
  'cancelled_by_system',
  'on_hold',
  'pattern',
  'no_show_both'
]);
const ALWAYS_INCLUDED_CLASS_STATUSES = new Set(['attended', 'missed_by_student']);
const FUTURE_ELIGIBLE_CLASS_STATUSES = new Set(['scheduled', 'in_progress', 'completed']);

const isTimestampInFuture = (value, now) => {
  if (!value) return false;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isFinite(dt?.getTime?.()) && dt >= now;
};

const deriveClassEligibility = (rawStatus, submissionStatus, scheduledDateValue, allowanceDate, extendedDate) => {
  const normalizedStatus = normalizeStatusValue(rawStatus);
  if (CANCELLED_CLASS_STATUSES.has(normalizedStatus)) {
    return false;
  }

  if (ALWAYS_INCLUDED_CLASS_STATUSES.has(normalizedStatus)) {
    return true;
  }

  const scheduledDate = scheduledDateValue instanceof Date ? scheduledDateValue : new Date(scheduledDateValue || 0);
  if (!Number.isFinite(scheduledDate?.getTime?.())) {
    return false;
  }

  const now = new Date();
  if (scheduledDate > now) {
    return FUTURE_ELIGIBLE_CLASS_STATUSES.has(normalizedStatus) || !normalizedStatus;
  }

  if (isTimestampInFuture(allowanceDate, now)) {
    return true;
  }

  if (isTimestampInFuture(extendedDate, now)) {
    return true;
  }

  const submissionState = normalizeStatusValue(submissionStatus);
  if (submissionState === 'admin_extended') {
    return true;
  }

  return false;
};

const resolveDocumentId = (value) => {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'object') {
    const candidate = value._id || value.id;
    if (!candidate) return null;
    if (typeof candidate === 'string' || typeof candidate === 'number') {
      return candidate.toString();
    }
    if (typeof candidate === 'object' && typeof candidate.toString === 'function') {
      return candidate.toString();
    }
  }
  return null;
};

const isEditableElement = (element) => {
  if (!element) return false;
  const tag = String(element.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(element.isContentEditable);
};

const InvoiceViewModal = ({ invoiceSlug, invoiceId, initialInvoice = null, onClose, onInvoiceUpdate, onOpenRecordPayment }) => {
  const { user, socket } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const handleClose = onClose || (() => navigate(-1));

  const [invoice, setInvoice] = useState(initialInvoice || null);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(!initialInvoice);
  const [, setClassPeriod] = useState({ start: '', end: '' });
  const [classesLoading, setClassesLoading] = useState(false);
  const [resolvedInvoiceId, setResolvedInvoiceId] = useState(invoiceId || null);
  const [shareStatus, setShareStatus] = useState(null);
  const [revertingPayment, setRevertingPayment] = useState(false);
  const [revertStatus, setRevertStatus] = useState(null);
  // Cache teacher names by id to avoid losing labels if snapshots are missing in subsequent updates
  const teacherNameCacheRef = useRef({});

  // Detect invoices that are purely hour refill / top-up (no actual class line items)
  // Business rule: show NO classes section at all for these.
  const isRefillOnlyInvoice = useMemo(() => {
    if (!invoice || !Array.isArray(invoice.items) || invoice.items.length === 0) return false;
    // All items look like refills and have no class linkage
    return invoice.items.every((it) => {
      const desc = String(it?.description || '').toLowerCase();
      const looksRefill = /refill|top\s?-?up|auto\s?top\s?-?up/.test(desc);
      const hasClassLink = it.class || it.lessonId || it.classId || it.class?._id;
      return looksRefill && !hasClassLink;
    });
  }, [invoice]);

  const isFeeOnlyInvoice = useMemo(() => {
    if (!invoice) return false;
    const items = Array.isArray(invoice.items) ? invoice.items.filter(Boolean) : [];
    if (items.length > 0) return false;

    const subtotalValue = Number(invoice?.subtotal || 0);
    const totalValue = Number(invoice?.total ?? invoice?.adjustedTotal ?? invoice?.amount ?? 0);
    return subtotalValue <= 0 && totalValue > 0;
  }, [invoice]);

  const hideClassBreakdown = isRefillOnlyInvoice || isFeeOnlyInvoice;

  // Admin filters
  const [maxHours, setMaxHours] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [savingCoverage, setSavingCoverage] = useState(false);
  const savingCoverageRef = useRef(false);
  const [coverageStatus, setCoverageStatus] = useState(null);
  const [noteEdits, setNoteEdits] = useState({
    notes: '',
    internalNotes: '',
    invoiceReferenceLink: ''
  });
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesStatus, setNotesStatus] = useState(null);
  const [waiveTransferFee, setWaiveTransferFee] = useState(false);
  const [invoiceNameStatus, setInvoiceNameStatus] = useState(null);
  const [invoiceNameParts, setInvoiceNameParts] = useState({ prefix: 'Waraqa', month: 'Mar', year: '2026', seq: '' });
  const [seqEditing, setSeqEditing] = useState(false);
  const [seqDraft, setSeqDraft] = useState('');
  const [editingInlineNote, setEditingInlineNote] = useState(null);
  const seqInputRef = useRef(null);
  const maxHoursInputRef = useRef(null);
  const endDateInputRef = useRef(null);

  const notesLastSavedRef = useRef({ notes: '', internalNotes: '', invoiceReferenceLink: '' });
  const skipNextNotesSave = useRef(false);
  const suppressSocketRefreshUntilRef = useRef(0);
  const coverageLastSavedRef = useRef({ maxHours: '', customEndDate: '', waiveTransferFee: false });
  const coverageDraftRef = useRef({ maxHours: '', customEndDate: '', waiveTransferFee: false });
  const coverageDraftHoldUntilRef = useRef(0);
  const skipNextCoverageSave = useRef(false);
  const totalsSyncKeyRef = useRef(null);
  const syncingSnapshotRef = useRef(false);
  // Track if classes have been fetched initially to prevent auto-updates on modal open
  const initialClassesFetchedRef = useRef(false);
  // Track if user has made any changes to filters
  const userModifiedFiltersRef = useRef(false);
  const coverageEditingRef = useRef(false);
  const seededInitialInvoiceIdRef = useRef(null);
  const coverageInvoiceSessionRef = useRef(null);
  const activeCoverageFieldRef = useRef(null);
  const skipCoverageBlurSaveRef = useRef(null);

  const formatDateInput = useCallback((value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }, []);

  const formatDateDisplay = useCallback((value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mon = MONTHS_SHORT[d.getUTCMonth()];
    const yr = d.getUTCFullYear();
    return `${day} ${mon} ${yr}`;
  }, []);

  const updateCoverageDraft = useCallback((patch) => {
    coverageDraftRef.current = {
      ...coverageDraftRef.current,
      ...patch
    };
  }, []);

  const holdCoverageDraft = useCallback((durationMs = 10_000) => {
    coverageDraftHoldUntilRef.current = Date.now() + durationMs;
  }, []);

  const buildCoverageDraftInvoice = useCallback((inv) => {
    if (!inv) return inv;

    const shouldPreserveCoverageDraft = coverageEditingRef.current
      || userModifiedFiltersRef.current
      || savingCoverageRef.current
      || savingCoverageRef.current
      || coverageDraftHoldUntilRef.current > Date.now();

    if (!shouldPreserveCoverageDraft) return inv;

    const draftMaxHours = coverageDraftRef.current.maxHours;
    const draftCustomEndDate = coverageDraftRef.current.customEndDate;
    const draftWaiveTransferFee = Boolean(coverageDraftRef.current.waiveTransferFee);
    const parsedDraftMaxHours = draftMaxHours !== '' && draftMaxHours !== null && draftMaxHours !== undefined
      ? Number(draftMaxHours)
      : null;

    return {
      ...inv,
      coverage: {
        ...(inv.coverage || {}),
        maxHours: Number.isFinite(parsedDraftMaxHours) ? parsedDraftMaxHours : null,
        endDate: draftCustomEndDate || null,
        waiveTransferFee: draftWaiveTransferFee
      }
    };
  }, []);

  const parseInvoiceNameParts = useCallback((name) => {
    const raw = String(name || '').trim();
    const chunks = raw.split('-').map((chunk) => chunk.trim()).filter(Boolean);
    if (chunks.length >= 4) {
      return {
        prefix: chunks[0] || 'Waraqa',
        month: chunks[1] || 'Mar',
        year: chunks[2] || String(new Date().getUTCFullYear()),
        seq: chunks.slice(3).join('-')
      };
    }
    return {
      prefix: chunks[0] || 'Waraqa',
      month: chunks[1] || 'Mar',
      year: chunks[2] || String(new Date().getUTCFullYear()),
      seq: ''
    };
  }, []);

  const buildInvoiceNameFromParts = useCallback((parts) => {
    const prefix = String(parts?.prefix || 'Waraqa').trim();
    const month = String(parts?.month || '').trim();
    const year = String(parts?.year || '').trim();
    const seq = String(parts?.seq || '').trim();
    return [prefix, month, year, seq].filter(Boolean).join('-') + (seq ? '' : '-');
  }, []);

  const getStatusTooltip = (status) => {
    switch (status) {
      case 'paid': return 'Paid — payment received';
      case 'overdue': return 'Overdue — payment overdue';
      case 'pending': return 'Pending — awaiting payment';
      case 'sent': return 'Sent — delivered to guardian';
      case 'cancelled': return 'Cancelled — not payable';
      case 'refunded': return 'Refunded — payment returned';
      default: return 'Draft — not sent';
    }
  };

  const syncInvoiceState = useCallback((inv) => {
    if (!inv) return;
    totalsSyncKeyRef.current = null;
    syncingSnapshotRef.current = false;
    const nextInvoice = buildCoverageDraftInvoice(inv);
    setInvoice(nextInvoice);
    const nextNotes = {
      notes: nextInvoice?.notes || '',
      internalNotes: nextInvoice?.internalNotes || '',
      invoiceReferenceLink: nextInvoice?.invoiceReferenceLink || ''
    };
    skipNextNotesSave.current = true;
    setNoteEdits(nextNotes);
    notesLastSavedRef.current = nextNotes;
    const coverage = nextInvoice.coverage || {};
    const coverageLocked = ['paid', 'refunded'].includes(String(nextInvoice?.status || '').toLowerCase());
    const hasMaxHours = typeof coverage.maxHours === 'number' && Number.isFinite(coverage.maxHours);
    const normalizedMax = hasMaxHours ? Math.max(0, coverage.maxHours) : null;
    const normalizedEndDate = coverage.endDate ? formatDateInput(coverage.endDate) : '';
    const nextMaxHours = !coverageLocked && normalizedMax && normalizedMax > 0 ? String(normalizedMax) : '';
    const nextCustomEndDate = !coverageLocked ? (normalizedEndDate || '') : '';

    const shouldPreserveCoverageDraft = coverageEditingRef.current
      || userModifiedFiltersRef.current
      || savingCoverageRef.current
      || coverageDraftHoldUntilRef.current > Date.now();

    if (!shouldPreserveCoverageDraft) {
      skipNextCoverageSave.current = true;
      setMaxHours(nextMaxHours);
      setCustomEndDate(nextCustomEndDate);
      const nextWaive = Boolean(coverage.waiveTransferFee);
      setWaiveTransferFee(nextWaive);
      coverageDraftRef.current = {
        maxHours: nextMaxHours,
        customEndDate: nextCustomEndDate || '',
        waiveTransferFee: nextWaive
      };
      userModifiedFiltersRef.current = false;
      coverageLastSavedRef.current = {
        maxHours: nextMaxHours,
        customEndDate: nextCustomEndDate || '',
        waiveTransferFee: nextWaive
      };
    }

    if (!seqEditing) {
      const parts = parseInvoiceNameParts(nextInvoice?.invoiceName || '');
      setInvoiceNameParts(parts);
      setSeqDraft(parts.seq || '');
    }
  }, [seqEditing, parseInvoiceNameParts, formatDateInput, buildCoverageDraftInvoice]);

  const toNumberOr = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const formatHoursValue = useCallback((hours) => {
    if (!Number.isFinite(hours) || hours < 0) return '';
    if (hours === 0) return '0';
    const fixed = hours.toFixed(2);
    const trimmed = fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
    return trimmed || '0';
  }, []);

  const identifier = invoiceSlug || invoiceId;

  useEffect(() => {
    if (!initialInvoice) return;
    const incomingId = initialInvoice?._id || invoiceId || null;
    if (incomingId && seededInitialInvoiceIdRef.current === incomingId && invoice?._id === incomingId) {
      return;
    }

    syncInvoiceState(initialInvoice);
    setResolvedInvoiceId(incomingId);
    seededInitialInvoiceIdRef.current = incomingId;
    setLoading(false);
  }, [initialInvoice, invoiceId, syncInvoiceState, invoice?._id]);

  useEffect(() => {
    if (!identifier) return;
    let cancelled = false;
    const isNewInvoiceSession = coverageInvoiceSessionRef.current !== identifier;

    if (isNewInvoiceSession) {
      coverageInvoiceSessionRef.current = identifier;
      setCoverageStatus(null);
      setResolvedInvoiceId(invoiceId || null);

      // Reset tracking flags only when opening a different invoice.
      initialClassesFetchedRef.current = false;
      userModifiedFiltersRef.current = false;
      coverageEditingRef.current = false;
      coverageDraftHoldUntilRef.current = 0;
    }

    const fetchInvoiceDetails = async () => {
      try {
        if (!initialInvoice) {
          setLoading(true);
        }
        
        const cacheKey = makeCacheKey('invoices:detail', user?._id, { id: identifier });
        const cached = readCache(cacheKey, { deps: ['invoices'] });
        if (cached.hit && cached.value?.invoice) {
          syncInvoiceState(cached.value.invoice);
          setResolvedInvoiceId(cached.value.invoice?._id || invoiceId || null);
          setLoading(false);
        }

        const { data: invRes } = await api.get(`/invoices/${identifier}`, { params: { includeDynamic: 1 } });
        if (cancelled) return;
        const inv = invRes.invoice || invRes;
        
        syncInvoiceState(inv);
        setResolvedInvoiceId(inv?._id || invoiceId || null);
        writeCache(cacheKey, { invoice: inv }, { ttlMs: 2 * 60_000, deps: ['invoices'] });
      } catch (err) {
        if (!cancelled) {
          console.error('Invoice fetch error:', err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchInvoiceDetails();

    return () => {
      cancelled = true;
    };
  }, [identifier, invoiceId, syncInvoiceState, user?._id, initialInvoice]);

  // Listen for real-time invoice updates via socket
  useEffect(() => {
    if (!socket || !resolvedInvoiceId) return;

    const handleInvoiceUpdate = async (updatedInvoice) => {
      if (Date.now() < suppressSocketRefreshUntilRef.current) return;
      // Only re-fetch if this is the invoice we're viewing
      if (updatedInvoice && updatedInvoice._id === resolvedInvoiceId) {
        try {
          const { data: invRes } = await api.get(`/invoices/${identifier}`, { params: { includeDynamic: 1 } });
          const inv = invRes.invoice || invRes;
          syncInvoiceState(inv);
        } catch (err) {
          console.error('Failed to refresh invoice after socket update:', err);
        }
      }
    };

    socket.on('invoice:updated', handleInvoiceUpdate);
    socket.on('invoice:paid', handleInvoiceUpdate);

    return () => {
      socket.off('invoice:updated', handleInvoiceUpdate);
      socket.off('invoice:paid', handleInvoiceUpdate);
    };
  }, [socket, resolvedInvoiceId, identifier, syncInvoiceState]);

  useEffect(() => {
    if (!socket || !resolvedInvoiceId || !invoice) return;
    const collectClassIds = (items = []) => items
      .map((item) => {
        if (!item) return null;
        const cls = item.class && typeof item.class === 'object' ? item.class : null;
        return resolveDocumentId(cls)
          || resolveDocumentId(item.class)
          || resolveDocumentId(item.lessonId)
          || resolveDocumentId(item.classId);
      })
      .filter(Boolean)
      .map((id) => id.toString());

    const dynamicItems = Array.isArray(invoice?.dynamicClasses?.items) ? invoice.dynamicClasses.items : [];
    const trackedIds = new Set([
      ...collectClassIds(invoice.items || []),
      ...collectClassIds(dynamicItems)
    ]);

    if (trackedIds.size === 0) return;

    let refreshInFlight = false;
    let cancelled = false;

    const handleClassUpdated = async (payload) => {
      if (Date.now() < suppressSocketRefreshUntilRef.current) return;
      try {
        const updatedId = payload?.class?._id || payload?.class?.id || payload?.classId || payload?._id;
        if (!updatedId || !trackedIds.has(String(updatedId))) {
          return;
        }
        if (refreshInFlight) return;
        refreshInFlight = true;
        if (!cancelled) {
          setClassesLoading(true);
        }
        const { data: invRes } = await api.get(`/invoices/${identifier}`, { params: { includeDynamic: 1 } });
        const inv = invRes.invoice || invRes;
        if (!cancelled) {
          syncInvoiceState(inv);
        }
      } catch (err) {
        console.error('Failed to refresh invoice after class update:', err);
      } finally {
        refreshInFlight = false;
        if (!cancelled) {
          setClassesLoading(false);
        }
      }
    };

    socket.on('class:updated', handleClassUpdated);
    return () => {
      cancelled = true;
      socket.off('class:updated', handleClassUpdated);
    };
  }, [socket, resolvedInvoiceId, invoice, identifier, syncInvoiceState]);

  useEffect(() => {
    if (!isAdmin || typeof onOpenRecordPayment !== 'function') return;

    const handleShortcut = (event) => {
      if (!invoice?._id) return;
      if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      if (String(event.key || '').toLowerCase() !== 'p') return;
      if (isEditableElement(document.activeElement)) return;

      event.preventDefault();
      onOpenRecordPayment(invoice);
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [isAdmin, onOpenRecordPayment, invoice]);

  useEffect(() => {
    if (!invoice) return;
    if (isRefillOnlyInvoice) {
      setClasses([]);
      initialClassesFetchedRef.current = true;
      setClassesLoading(false);
      return;
    }

    const allowDynamic = !(invoice?.billingType === 'manual' || invoice?.generationSource === 'manual');
    const dynamicItems = allowDynamic && Array.isArray(invoice?.dynamicClasses?.items)
      ? invoice.dynamicClasses.items
      : null;
    const usingDynamicPayload = Array.isArray(dynamicItems);
    const sourceItems = usingDynamicPayload ? dynamicItems : (invoice.items || []);

    const classArray = sourceItems
      .filter((item) => {
        if (usingDynamicPayload) {
          return Boolean(item?.class || item?.lessonId || item?.classId || item?._id);
        }
        const desc = String(item?.description || '').toLowerCase();
        const looksRefill = /refill|top\s?-?up|auto\s?top\s?-?up/.test(desc);
        const hasClassLink = item.class || item.lessonId || item.classId || item.class?._id;
        return hasClassLink || !looksRefill;
      })
      .map((item, index) => {
        const liveClass = item && item.class && typeof item.class === 'object' ? item.class : null;
        const scheduledSource = liveClass?.dateTime || liveClass?.scheduledDate || item.date || item.scheduledDate || null;
        const dateObj = scheduledSource ? new Date(scheduledSource) : (item.date ? new Date(item.date) : new Date(Number.NaN));
        const studentSnapshot = item.studentSnapshot
          || liveClass?.student
          || item.class?.student
          || (typeof item.student === 'object' ? item.student : {})
          || {};
        const rawStudentName = studentSnapshot.studentName
          || `${studentSnapshot.firstName || ''} ${studentSnapshot.lastName || ''}`.trim();
        const studentName = rawStudentName && rawStudentName.trim().length ? rawStudentName.trim() : '-';

        const teacherCandidate = (typeof item.teacher === 'object' && item.teacher)
          || (typeof liveClass?.teacher === 'object' && liveClass.teacher)
          || (typeof item.class?.teacher === 'object' && item.class.teacher)
          || null;
        const teacherSnapshot = item.teacherSnapshot || (teacherCandidate && typeof teacherCandidate === 'object' ? teacherCandidate : {}) || {};
        const teacherId = resolveDocumentId(item.teacher)
          || resolveDocumentId(teacherCandidate)
          || resolveDocumentId(liveClass?.teacher)
          || resolveDocumentId(item.class?.teacher)
          || resolveDocumentId(item.teacherId);
        let teacherName = teacherSnapshot.firstName
          ? `${teacherSnapshot.firstName} ${teacherSnapshot.lastName || ''}`.trim()
          : '-';
        if ((!teacherName || teacherName === '-') && teacherCandidate && typeof teacherCandidate === 'object') {
          const fallbackName = `${teacherCandidate.firstName || ''} ${teacherCandidate.lastName || ''}`.trim();
          teacherName = fallbackName || teacherName;
        }
        if ((!teacherName || teacherName === '-') && teacherId && teacherNameCacheRef.current[teacherId]) {
          teacherName = teacherNameCacheRef.current[teacherId];
        }
        if (teacherId && teacherName && teacherName !== '-') {
          teacherNameCacheRef.current[teacherId] = teacherName;
        }

        const actualStatus = liveClass?.status || item.status || 'scheduled';
        const submissionPayload = liveClass?.reportSubmission || item.reportSubmission || {};
        const reportSubmissionStatus = submissionPayload.status || null;
        const reportSubmissionAllowance = liveClass?.reportSubmissionAllowance
          || item.reportSubmissionAllowance
          || submissionPayload.allowance
          || submissionPayload.teacherDeadline
          || null;
        const reportSubmissionExtendedUntil = liveClass?.reportSubmissionExtendedUntil
          || item.reportSubmissionExtendedUntil
          || submissionPayload?.adminExtension?.extendedUntil
          || submissionPayload?.adminExtension?.expiresAt
          || null;
        // When using the dynamic payload from the backend, trust its filtering —
        // the backend already applied isPinned bypass and eligibility checks.
        const eligibleForCoverage = usingDynamicPayload
          ? true
          : deriveClassEligibility(
              actualStatus,
              reportSubmissionStatus,
              scheduledSource || dateObj,
              reportSubmissionAllowance,
              reportSubmissionExtendedUntil
            );

        const durationMinutes = Number.isFinite(Number(liveClass?.duration))
          ? Number(liveClass.duration)
          : Number(item.duration || 0);
        const subject = liveClass?.subject || item.subject || item.description || '-';
        const rawId = resolveDocumentId(liveClass)
          || resolveDocumentId(item.class)
          || resolveDocumentId(item.classId)
          || resolveDocumentId(item.lessonId)
          || resolveDocumentId(item._id)
          || `item-${index}-${Date.now()}`;

        return {
          _id: rawId,
          studentName,
          teacherName,
          subject,
          date: formatDateWithDay(dateObj),
          rawDate: dateObj,
          time: Number.isNaN(dateObj.getTime()) ? '-' : dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          duration: durationMinutes || 0,
          status: actualStatus,
          reportSubmissionStatus,
          reportSubmissionAllowance,
          reportSubmissionExtendedUntil,
          isEligible: eligibleForCoverage,
          paidByGuardian: Boolean(item.paidByGuardian),
        };
      });

    setClasses(classArray);
    initialClassesFetchedRef.current = true;
    setClassesLoading(false);
  }, [invoice, isRefillOnlyInvoice]);

  const endDateBoundary = useMemo(() => {
    if (!customEndDate) return null;
    const parsed = new Date(customEndDate);
    if (Number.isNaN(parsed.getTime())) return null;
    parsed.setHours(23, 59, 59, 999);
    return parsed;
  }, [customEndDate]);

  const isCoverageLocked = useMemo(() => {
    const status = String(invoice?.status || '').toLowerCase();
    return ['paid', 'refunded'].includes(status);
  }, [invoice?.status]);

  const getEligibleSortedClasses = useCallback(() => {
    return [...(classes || [])]
      .filter((entry) => entry && entry.isEligible !== false)
      .filter((entry) => entry.rawDate instanceof Date && !Number.isNaN(entry.rawDate.getTime()))
      .sort((a, b) => a.rawDate - b.rawDate);
  }, [classes]);

  const computeEndDateFromMaxHours = useCallback((hoursValue) => {
    const numeric = Number(hoursValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    const maxMinutes = Math.round(numeric * 60);
    if (maxMinutes <= 0) return '';

    const eligible = getEligibleSortedClasses();
    let totalMinutes = 0;
    let lastDate = null;
    for (const entry of eligible) {
      const minutes = Number(entry?.duration || 0) || 0;
      if (totalMinutes + minutes > maxMinutes) break;
      totalMinutes += minutes;
      lastDate = entry.rawDate;
    }

    if (!lastDate) return '';
    return lastDate.toISOString().slice(0, 10);
  }, [getEligibleSortedClasses]);

  const computeMaxHoursFromEndDate = useCallback((value) => {
    if (!value) return '';
    const boundary = new Date(value);
    if (Number.isNaN(boundary.getTime())) return '';
    boundary.setHours(23, 59, 59, 999);

    const eligible = getEligibleSortedClasses();
    const totalMinutes = eligible.reduce((sum, entry) => {
      if (entry.rawDate.getTime() > boundary.getTime()) return sum;
      return sum + (Number(entry.duration || 0) || 0);
    }, 0);

    const hours = totalMinutes / 60;
    const normalized = formatHoursValue(hours);
    return normalized || '';
  }, [getEligibleSortedClasses, formatHoursValue]);

  const commitCoverageFieldDraft = useCallback((field, rawValue) => {
    const value = rawValue ?? '';

    if (field === 'maxHours') {
      updateCoverageDraft({ maxHours: value, customEndDate: '' });
      setMaxHours(value);
      setCustomEndDate('');
      return;
    }

    if (field === 'customEndDate') {
      const derivedMax = value ? computeMaxHoursFromEndDate(value) : '';
      updateCoverageDraft({ customEndDate: value, maxHours: derivedMax });
      setCustomEndDate(value);
      setMaxHours(derivedMax);
    }
  }, [updateCoverageDraft, computeMaxHoursFromEndDate]);


  const filteredClasses = useMemo(() => {
    const sorted = [...(classes || [])].sort((a, b) => {
      if (!(a?.rawDate instanceof Date) || Number.isNaN(a.rawDate?.getTime?.())) return 1;
      if (!(b?.rawDate instanceof Date) || Number.isNaN(b.rawDate?.getTime?.())) return -1;
      return a.rawDate - b.rawDate;
    });

    let constrained = sorted;
    if (endDateBoundary) {
      constrained = sorted.filter((entry) => {
        if (!(entry?.rawDate instanceof Date) || Number.isNaN(entry.rawDate.getTime())) return false;
        return entry.rawDate.getTime() <= endDateBoundary.getTime();
      });
    }

    const eligibleClasses = constrained.filter((entry) => entry?.isEligible !== false);

    if (isCoverageLocked) {
      return eligibleClasses;
    }

    const hasCap = maxHours !== '' && maxHours !== null && maxHours !== undefined;
    if (!hasCap) {
      return eligibleClasses;
    }

    const numericMaxHours = Number(maxHours);
    if (!Number.isFinite(numericMaxHours)) {
      return eligibleClasses;
    }

    if (numericMaxHours <= 0) {
      return [];
    }

    const maxMinutes = Math.round(numericMaxHours * 60);
    let cumulativeMinutes = 0;
    const capped = [];

    for (const entry of eligibleClasses) {
      const durationMinutes = Number(entry?.duration || 0);
      const safeDuration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 0;

      if (cumulativeMinutes + safeDuration > maxMinutes) {
        break;
      }

      capped.push(entry);
      cumulativeMinutes += safeDuration;
    }

    return capped;
  }, [classes, maxHours, endDateBoundary, isCoverageLocked]);

  useEffect(() => {
    if (!invoice) return;

    const validDates = filteredClasses
      .map((c) => c.rawDate)
      .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()));

    if (validDates.length > 0) {
      const start = new Date(
        Math.min(...validDates.map((d) => d.getTime()))
      );
      const end = new Date(
        Math.max(...validDates.map((d) => d.getTime()))
      );
      setClassPeriod({ start: formatDateDDMMMYYYY(start), end: formatDateDDMMMYYYY(end) });
      return;
    }

    const invoiceStartRaw = invoice.lastInvoiceDate || invoice.billingPeriod?.startDate || '';
    const invoiceEndRaw = invoice.endDate || invoice.billingPeriod?.endDate || '';

    setClassPeriod({
      start: formatDateDisplay(invoiceStartRaw),
      end: formatDateDisplay(customEndDate || invoiceEndRaw),
    });
  }, [filteredClasses, invoice, customEndDate, formatDateDisplay]);

  // Totals - Always use LIVE guardian data, not snapshot
  const totalMinutes = isRefillOnlyInvoice ? 0 : filteredClasses.reduce((sum, c) => sum + (c.duration || 0), 0);
  const totalHours = totalMinutes / 60;
  
  // ✅ Priority: Live guardian data > stored snapshot
  const guardianRateCandidates = [
    invoice?.guardian?.guardianInfo?.hourlyRate,  // LIVE data from guardian profile
    invoice?.guardianFinancial?.hourlyRate,       // Snapshot (fallback)
    invoice?.guardianRate                          // Legacy field (fallback)
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const guardianRate = guardianRateCandidates.length > 0 ? guardianRateCandidates[0] : 0;
  
  const derivedSubtotal = Number.isFinite(totalHours) && totalHours > 0 ? roundCurrency(totalHours * guardianRate) : 0;
  const invoiceSubtotalRaw = toNumberOr(invoice?.subtotal, Number.NaN);
  const fallbackSubtotal = Number.isFinite(invoiceSubtotalRaw) ? roundCurrency(invoiceSubtotalRaw) : 0;
  const subtotal = derivedSubtotal > 0 ? derivedSubtotal : fallbackSubtotal;
  
  // ✅ Transfer fee: Use LIVE guardian data
  const transferFeeDetails = invoice?.guardian?.guardianInfo?.transferFee || invoice?.guardianFinancial?.transferFee || {};
  const transferFeeValueDisplay = toNumberOr(transferFeeDetails.value, 0);
  const transferFeeMode = transferFeeDetails.mode;
  const transferFeeAmount = (() => {
    if (transferFeeMode === 'percent') {
      const percent = Math.max(0, transferFeeValueDisplay);
      return roundCurrency((subtotal * percent) / 100);
    }
    const storedAmount = toNumberOr(transferFeeDetails.amount, Number.NaN);
    const fallbackAmount = toNumberOr(transferFeeDetails.value, 0);
    const resolvedAmount = Number.isFinite(storedAmount) && storedAmount > 0 ? storedAmount : fallbackAmount;
    return roundCurrency(Math.max(0, resolvedAmount));
  })();
  const transferFeeWaivedPreview = Boolean(waiveTransferFee);
  const discountAmount = roundCurrency(Math.max(0, toNumberOr(invoice?.discount, 0)));
  const appliedDiscount = Math.min(discountAmount, subtotal);
  const lateFeeAmount = roundCurrency(Math.max(0, toNumberOr(invoice?.lateFee, 0)));
  const tipAmount = roundCurrency(Math.max(0, toNumberOr(invoice?.tip, 0)));
  const transferFeeDisplayAmount = transferFeeWaivedPreview ? 0 : transferFeeAmount;
  const computedTotalAmount = roundCurrency(
    Math.max(0, subtotal - appliedDiscount + lateFeeAmount + tipAmount + transferFeeDisplayAmount)
  );
  const totalAmount = computedTotalAmount;
  const paidAmount = roundCurrency(Math.max(0, toNumberOr(invoice?.paidAmount, 0)));
  const computedRemaining = roundCurrency(Math.max(0, totalAmount - paidAmount));
  const remainingBalance = computedRemaining;
  const amount = totalAmount;
  const isPaidStatus = ['paid', 'refunded'].includes(invoice?.status);
  const primaryAmount = isPaidStatus && paidAmount > 0 ? paidAmount : totalAmount;
  const primaryLabel = isPaidStatus ? 'Paid' : 'Invoice total';

  const actualHoursDisplay = useMemo(() => formatHoursValue(totalMinutes / 60), [totalMinutes, formatHoursValue]);

  const subtotalHoursDisplay = useMemo(() => {
    if (actualHoursDisplay) return actualHoursDisplay;
    if (Number.isFinite(totalHours)) {
      return (Math.round(totalHours * 100) / 100).toFixed(2);
    }
    return '0.00';
  }, [actualHoursDisplay, totalHours]);

  useEffect(() => {
    if (!invoice?._id || typeof onInvoiceUpdate !== 'function') return;

    const normalizedMaxHours = maxHours !== '' && maxHours !== null && maxHours !== undefined
      ? Number(maxHours)
      : null;

    onInvoiceUpdate({
      invoiceId: invoice._id,
      subtotal,
      total: totalAmount,
      paidAmount,
      remaining: remainingBalance,
      transferFeeAmount: transferFeeDisplayAmount,
      transferFeeWaived: transferFeeWaivedPreview,
      guardianRate,
      coverage: {
        maxHours: Number.isFinite(normalizedMaxHours) ? normalizedMaxHours : null,
        endDate: customEndDate || null,
        customEndDate: customEndDate || null,
        waiveTransferFee
      }
    });
  }, [
    invoice?._id,
    subtotal,
    totalAmount,
    paidAmount,
    remainingBalance,
    transferFeeDisplayAmount,
    transferFeeWaivedPreview,
    guardianRate,
    maxHours,
    customEndDate,
    waiveTransferFee,
    onInvoiceUpdate
  ]);

  const previewTotals = useMemo(() => {
    const hours = Number.isFinite(totalMinutes) ? roundCurrency(totalMinutes / 60) : 0;
    return {
      subtotal,
      total: totalAmount,
      transferFeeAmount: transferFeeDisplayAmount,
      transferFeeWaived: transferFeeWaivedPreview,
      paidAmount,
      remaining: remainingBalance,
      hours,
      guardianRate,
      discount: appliedDiscount,
      lateFee: lateFeeAmount,
      tip: tipAmount
    };
  }, [
    subtotal,
    totalAmount,
    transferFeeDisplayAmount,
    transferFeeWaivedPreview,
    paidAmount,
    remainingBalance,
    totalMinutes,
    guardianRate,
    appliedDiscount,
    lateFeeAmount,
    tipAmount
  ]);

  // Student summary
  const studentSummary = filteredClasses.reduce((acc, c) => {
    if (!acc[c.studentName]) acc[c.studentName] = { count: 0, hours: 0 };
    acc[c.studentName].count += 1;
    acc[c.studentName].hours += c.duration;
    return acc;
  }, {});

  const uniqueStudents = useMemo(
    () => [...new Set(filteredClasses.map((c) => String(c.studentName || '-')))],
    [filteredClasses]
  );
  const uniqueTeachers = useMemo(
    () => [...new Set(filteredClasses.map((c) => String(c.teacherName || '-')))],
    [filteredClasses]
  );
  const hasMultipleStudents = uniqueStudents.length > 1;
  const hasMultipleTeachers = uniqueTeachers.length > 1;

  const studentTonePalette = ['text-sky-700', 'text-violet-700', 'text-emerald-700', 'text-amber-700', 'text-rose-700', 'text-cyan-700'];
  const teacherTonePalette = ['text-indigo-700', 'text-teal-700', 'text-fuchsia-700', 'text-orange-700', 'text-lime-700', 'text-pink-700'];

  const studentToneMap = useMemo(() => {
    const map = {};
    uniqueStudents.forEach((name, index) => {
      map[name] = studentTonePalette[index % studentTonePalette.length];
    });
    return map;
  }, [uniqueStudents]);

  const teacherToneMap = useMemo(() => {
    const map = {};
    uniqueTeachers.forEach((name, index) => {
      map[name] = teacherTonePalette[index % teacherTonePalette.length];
    });
    return map;
  }, [uniqueTeachers]);

  // Keep the classes table area a fixed, scrollable region to avoid layout
  // shifts when the number of classes changes (which caused the modal to
  // visually jump up/down). Use a sensible min/max height so small lists
  // still look compact while longer lists scroll.
  const classTableOuterClasses = 'flex-1 overflow-hidden';
  const classTableInnerClasses = 'overflow-y-auto overflow-x-auto rounded-b-3xl';
  const classTableInnerStyle = {
    maxHeight: '22rem',
    minHeight: '6rem'
  };


  // PDF
  const downloadPDF = () => {
    if (!invoice) return;
    const doc = new jsPDF();
    doc.setFont('helvetica', 'normal');

    doc.setFontSize(16);
    doc.text('Waraqa', 14, 20);
    doc.setFontSize(10);
    doc.text('www.waraqaweb@gmail.com | waraqainc@gmail.com | +20 120 032 4956', 14, 28);
    doc.setFontSize(12);
    const invoiceRef = invoice.invoiceName || invoice.invoiceNumber || '';
    const invoiceLabel = invoiceRef ? `Invoice #${invoiceRef}` : 'Invoice';
    doc.text(invoiceLabel, 14, 38);
    doc.text(`Guardian: ${invoice.guardian?.firstName} ${invoice.guardian?.lastName}`, 14, 44);

    let yPosition = 50;
    Object.entries(studentSummary).forEach(([name, { count, hours }]) => {
      doc.text(`${name}: ${count} classes ${(hours / 60).toFixed(2)} hrs`, 14, yPosition);
      yPosition += 6;
    });

    doc.text(`Total Classes: ${filteredClasses.length}`, 14, yPosition);
    yPosition += 6;
    doc.text(`Total Hours: ${totalHours.toFixed(2)}`, 14, yPosition);
    yPosition += 6;
    doc.text(`Amount: $${amount.toFixed(2)}`, 14, yPosition);
    yPosition += 6;

    // Add detailed breakdown lines (subtotal, transfer fee, discounts, fees, tip, paid, remaining)
    try {
      const lines = [];
      lines.push(`Subtotal: $${subtotal.toFixed(2)}`);
      if (transferFeeWaivedPreview) {
        lines.push(`Transfer fee: Waived`);
      } else {
        lines.push(`Transfer fee: $${transferFeeDisplayAmount.toFixed(2)}`);
      }
      if (appliedDiscount > 0) lines.push(`Discount: - $${appliedDiscount.toFixed(2)}`);
      if (lateFeeAmount > 0) lines.push(`Late fee: $${lateFeeAmount.toFixed(2)}`);
      if (tipAmount > 0) lines.push(`Tip: $${tipAmount.toFixed(2)}`);
      lines.push(`Paid: $${paidAmount.toFixed(2)}`);
      lines.push(`Remaining: $${remainingBalance.toFixed(2)}`);

      for (const ln of lines) {
        doc.text(ln, 14, yPosition);
        yPosition += 6;
      }

      // small gap before the classes table
      yPosition += 4;
    } catch (err) {
      // ignore PDF formatting errors
    }

    const tableData = filteredClasses.map((c) => [
      `${c.date} ${c.time}`,
      c.studentName,
      c.teacherName,
      c.subject,
      (c.duration / 60).toFixed(2),
      c.status,
    ]);

    doc.autoTable({
      startY: yPosition,
      head: [['Date & Time', 'Student', 'Teacher', 'Subject', 'Duration (hrs)', 'Status']],
      body: tableData,
      styles: { font: 'helvetica', fontStyle: 'normal' },
    });

    doc.save(`Invoice-${invoice.invoiceName || invoice.invoiceNumber || invoice._id}.pdf`);
  };

  // Excel
  const downloadExcel = () => {
    if (!invoice) return;

    const studentLines = Object.entries(studentSummary).map(
      ([name, { count, hours }]) => [`${name}: ${count} classes ${(hours / 60).toFixed(2)} hrs`]
    );

    const worksheetData = [
      ['Invoice #', invoice.invoiceName || invoice.invoiceNumber || invoice._id],
      ['Guardian', `${invoice.guardian?.firstName} ${invoice.guardian?.lastName}` || '-'],
      ['Students'],
      ...studentLines,
      ['Total Classes', filteredClasses.length],
      ['Total Hours', totalHours.toFixed(2)],
      ['Amount', amount.toFixed(2)],
      [],
      ['Date & Time', 'Student', 'Teacher', 'Subject', 'Duration (hrs)', 'Status'],
      ...filteredClasses.map((c) => [
        `${c.date} ${c.time}`,
        c.studentName,
        c.teacherName,
        c.subject,
        (c.duration / 60).toFixed(2),
        c.status,
      ]),
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoice');
    XLSX.writeFile(workbook, `Invoice-${invoice.invoiceName || invoice.invoiceNumber || invoice._id}.xlsx`);
  };

  const handleSaveCoverage = useCallback(async (draftOverride = null) => {
    const targetInvoiceId = invoice?._id || resolvedInvoiceId;
    if (!targetInvoiceId) return;
    if (isCoverageLocked) return;
    if (savingCoverageRef.current) return;
    savingCoverageRef.current = true;
    holdCoverageDraft();
    setSavingCoverage(true);
    let succeeded = false;

    try {
      const effectiveDraft = draftOverride
        ? {
            ...coverageDraftRef.current,
            ...draftOverride
          }
        : coverageDraftRef.current;
      coverageDraftRef.current = effectiveDraft;

      const draftMaxHours = effectiveDraft.maxHours ?? '';
      const draftCustomEndDate = effectiveDraft.customEndDate ?? '';
      const draftWaiveTransferFee = Boolean(effectiveDraft.waiveTransferFee);

      // Optimistically mark these values as "last saved" so the auto-save
      // effect won't see a diff and queue another PUT while this one is in flight.
      coverageLastSavedRef.current = {
        maxHours: draftMaxHours || '',
        customEndDate: draftCustomEndDate || '',
        waiveTransferFee: draftWaiveTransferFee
      };
      userModifiedFiltersRef.current = false;

      const strategyValue = draftMaxHours ? 'cap_hours' : draftCustomEndDate ? 'custom_end' : 'full_period';

      let parsedMaxHours = null;
      if (draftMaxHours !== '' && draftMaxHours !== null && draftMaxHours !== undefined) {
        const numeric = Number(draftMaxHours);
        if (Number.isFinite(numeric) && numeric >= 0) {
          parsedMaxHours = numeric;
        }
      }

      const payload = {
        strategy: strategyValue,
        maxHours: parsedMaxHours,
        endDate: draftCustomEndDate || null,
        waiveTransferFee: draftWaiveTransferFee
      };

  totalsSyncKeyRef.current = null;
      const { data } = await api.put(`/invoices/${targetInvoiceId}/coverage`, payload);
      let updatedInvoice = data.invoice || data;

      // ⚠️ DO NOT call snapshot endpoint automatically
      // Only update totals if user explicitly requests recalculation
      // if (previewTotals && typeof previewTotals === 'object') {
      //   try {
      //     const snapshotRes = await api.put(`/invoices/${targetInvoiceId}/snapshot`, { previewTotals });
      //     updatedInvoice = snapshotRes.data?.invoice || snapshotRes.data || updatedInvoice;
      //   } catch (snapshotErr) {
      //     console.error('Invoice snapshot sync after coverage save failed:', snapshotErr);
      //   }
      // }

      
      // Use the returned updated invoice from the snapshot/coverage response to avoid an
      // extra round-trip that may cause the modal to re-mount in the parent. Only fall
      // back to a full GET if the response did not include an invoice object.
      if (updatedInvoice) {
        syncInvoiceState(updatedInvoice);
      } else {
        try {
          const { data: refetchRes } = await api.get(`/invoices/${targetInvoiceId}`);
          const refetched = refetchRes.invoice || refetchRes;
          if (refetched) syncInvoiceState(refetched);
        } catch (refetchErr) {
          console.error('Refetch after coverage save failed:', refetchErr);
        }
      }

      // Always refresh with includeDynamic=1 after a coverage save so the class list
      // reflects newly included/excluded scheduled classes.
      try {
        const { data: dynRes } = await api.get(`/invoices/${targetInvoiceId}`, { params: { includeDynamic: 1 } });
        const dynInvoice = dynRes?.invoice || dynRes;
        if (dynInvoice) syncInvoiceState(dynInvoice);
      } catch (dynErr) {
        console.error('Refetch (includeDynamic) after coverage save failed:', dynErr);
      }
      coverageLastSavedRef.current = {
        maxHours: draftMaxHours || '',
        customEndDate: draftCustomEndDate || '',
        waiveTransferFee: draftWaiveTransferFee
      };
      // Keep draft pinned briefly after success so any immediate cached/old refresh
      // can't overwrite the UI back to the previous server state.
      holdCoverageDraft(5000);
      userModifiedFiltersRef.current = false;
      setCoverageStatus({ type: 'success', message: 'saved' });
      succeeded = true;
    } catch (err) {
      console.error('Coverage update failed:', err);
      holdCoverageDraft();
      const message = err?.response?.data?.message || 'Failed to update coverage settings';
      setCoverageStatus({ type: 'error', message });
    } finally {
      setSavingCoverage(false);
      savingCoverageRef.current = false;
      if (succeeded) {
        setTimeout(() => setCoverageStatus(null), 2000);
      }
    }
  }, [resolvedInvoiceId, invoice, syncInvoiceState, isCoverageLocked, holdCoverageDraft]);

  useEffect(() => {
    const handlePointerDownCapture = (event) => {
      const activeField = activeCoverageFieldRef.current;
      if (!activeField) return;

      const activeInput = activeField === 'maxHours'
        ? maxHoursInputRef.current
        : endDateInputRef.current;

      if (!activeInput) return;
      if (event.target === activeInput || activeInput.contains?.(event.target)) return;

      coverageEditingRef.current = false;
      holdCoverageDraft();
      skipCoverageBlurSaveRef.current = activeField;
      skipNextCoverageSave.current = true;

      if (activeField === 'maxHours') {
        const nextValue = activeInput.value;
        const draftPatch = { maxHours: nextValue, customEndDate: '', waiveTransferFee: coverageDraftRef.current.waiveTransferFee };
        commitCoverageFieldDraft('maxHours', nextValue);
        coverageLastSavedRef.current = { maxHours: nextValue, customEndDate: '', waiveTransferFee: coverageDraftRef.current.waiveTransferFee };
        userModifiedFiltersRef.current = false;
        handleSaveCoverage(draftPatch);
        activeCoverageFieldRef.current = null;
        return;
      }

      const nextValue = activeInput.value;
      const derivedMax = nextValue ? computeMaxHoursFromEndDate(nextValue) : '';
      const draftPatch = { customEndDate: nextValue, maxHours: derivedMax, waiveTransferFee: coverageDraftRef.current.waiveTransferFee };
      commitCoverageFieldDraft('customEndDate', nextValue);
      coverageLastSavedRef.current = { maxHours: derivedMax, customEndDate: nextValue, waiveTransferFee: coverageDraftRef.current.waiveTransferFee };
      userModifiedFiltersRef.current = false;
      handleSaveCoverage(draftPatch);
      activeCoverageFieldRef.current = null;
    };

    document.addEventListener('pointerdown', handlePointerDownCapture, true);
    return () => document.removeEventListener('pointerdown', handlePointerDownCapture, true);
  }, [commitCoverageFieldDraft, computeMaxHoursFromEndDate, handleSaveCoverage, holdCoverageDraft]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!invoice && !resolvedInvoiceId) return;
    if (isCoverageLocked) return;
    if (coverageEditingRef.current) return;
    if (savingCoverageRef.current) return;

    if (skipNextCoverageSave.current) {
      skipNextCoverageSave.current = false;
      return;
    }

    if (savingCoverage) return;
    if (!userModifiedFiltersRef.current) return;

    const current = {
      maxHours: maxHours || '',
      customEndDate: customEndDate || '',
      waiveTransferFee: Boolean(waiveTransferFee)
    };
    const last = coverageLastSavedRef.current;

    const hasChanges =
      current.maxHours !== last.maxHours ||
      current.customEndDate !== last.customEndDate ||
      current.waiveTransferFee !== last.waiveTransferFee;

    if (!hasChanges) return;

    setCoverageStatus({ type: 'progress', message: 'Saving…' });
    const timer = setTimeout(() => {
      handleSaveCoverage();
    }, 600);

    return () => clearTimeout(timer);
  }, [isAdmin, invoice, resolvedInvoiceId, maxHours, customEndDate, waiveTransferFee, handleSaveCoverage, savingCoverage, isCoverageLocked]);

  const handleNoteChange = useCallback((field, value) => {
    setNoteEdits((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSaveNotes = useCallback(async () => {
    if (!invoice?._id && !resolvedInvoiceId) return;
    const targetInvoiceId = invoice?._id || resolvedInvoiceId;
    setSavingNotes(true);
    let succeeded = false;
    try {
      const payload = {
        notes: noteEdits.notes,
        internalNotes: noteEdits.internalNotes,
        invoiceReferenceLink: noteEdits.invoiceReferenceLink
      };
      
      const { data } = await api.put(`/invoices/${targetInvoiceId}`, payload);
      const updatedInvoice = data.invoice || data;
      
      syncInvoiceState(updatedInvoice);
      // Re-fetch authoritative invoice after saving notes
      try {
        const { data: refetchRes } = await api.get(`/invoices/${targetInvoiceId}`);
        const refetched = refetchRes.invoice || refetchRes;
        if (refetched) syncInvoiceState(refetched);
      } catch (refetchErr) {
        console.error('Refetch after notes save failed:', refetchErr);
      }
      const savedNotes = {
        notes: (updatedInvoice?.notes ?? noteEdits.notes) || '',
        internalNotes: (updatedInvoice?.internalNotes ?? noteEdits.internalNotes) || '',
        invoiceReferenceLink: (updatedInvoice?.invoiceReferenceLink ?? noteEdits.invoiceReferenceLink) || ''
      };
      notesLastSavedRef.current = savedNotes;
      setNotesStatus({ type: 'success', message: 'Notes saved' });
      succeeded = true;
    } catch (err) {
      console.error('Note update failed:', err);
      const message = err?.response?.data?.message || 'Failed to update notes';
      setNotesStatus({ type: 'error', message });
    } finally {
      setSavingNotes(false);
      if (succeeded) {
        setTimeout(() => setNotesStatus(null), 2000);
      }
    }
  }, [invoice, resolvedInvoiceId, noteEdits, syncInvoiceState]);

  const handleSaveSeq = useCallback(async (nextSeqValue) => {
    if (!isAdmin) return;
    const targetInvoiceId = invoice?._id || resolvedInvoiceId;
    if (!targetInvoiceId) return;

    const prevName = invoice?.invoiceName || '';
    const nextSeq = typeof nextSeqValue === 'string' ? nextSeqValue : seqDraft;
    const nextName = buildInvoiceNameFromParts({
      ...invoiceNameParts,
      seq: nextSeq,
    });

    const optimisticParts = parseInvoiceNameParts(nextName);
    setInvoiceNameStatus({ type: 'progress', message: 'Saving…' });
    setInvoiceNameParts(optimisticParts);
    setSeqDraft(optimisticParts.seq || '');
    setInvoice((prev) => (prev ? { ...prev, invoiceName: nextName } : prev));

    try {
      suppressSocketRefreshUntilRef.current = Date.now() + 1500;
      const { data } = await api.put(`/invoices/${targetInvoiceId}`, { invoiceName: nextName });
      const updated = data?.invoice || data;
      const resolved = updated && typeof updated === 'object'
        ? updated
        : { ...(invoice || {}), invoiceName: nextName };

      syncInvoiceState(resolved);

      const cacheKey = makeCacheKey('invoices:detail', user?._id, { id: targetInvoiceId });
      writeCache(cacheKey, { invoice: resolved }, { ttlMs: 2 * 60_000, deps: ['invoices'] });

      setSeqEditing(false);
      setInvoiceNameStatus({ type: 'success', message: 'Saved' });
      setTimeout(() => setInvoiceNameStatus(null), 1500);
    } catch (err) {
      console.error('Invoice name update failed:', err);
      const fallbackParts = parseInvoiceNameParts(prevName);
      setInvoiceNameParts(fallbackParts);
      setSeqDraft(fallbackParts.seq || '');
      setInvoice((prev) => (prev ? { ...prev, invoiceName: prevName } : prev));
      const message = err?.response?.data?.message || 'Failed to update invoice name';
      setInvoiceNameStatus({ type: 'error', message });
    }
  }, [isAdmin, invoice, resolvedInvoiceId, seqDraft, buildInvoiceNameFromParts, invoiceNameParts, parseInvoiceNameParts, syncInvoiceState, user?._id]);

  useEffect(() => {
    if (!seqEditing || !seqInputRef.current) return;
    const target = seqInputRef.current;
    target.focus();
    target.select();
    setTimeout(() => {
      try {
        target.focus();
        target.select();
      } catch (_) {}
    }, 0);
  }, [seqEditing]);

  useEffect(() => {
    if (!invoice) return;
    if (skipNextNotesSave.current) {
      skipNextNotesSave.current = false;
      return;
    }

    const last = notesLastSavedRef.current;
    if (
      noteEdits.notes === last.notes
      && noteEdits.internalNotes === last.internalNotes
      && noteEdits.invoiceReferenceLink === last.invoiceReferenceLink
    ) return;

    if (savingNotes) return;

    setNotesStatus({ type: 'progress', message: 'Saving…' });
    const timer = setTimeout(() => {
      handleSaveNotes();
    }, 600);

    return () => clearTimeout(timer);
  }, [noteEdits.notes, noteEdits.internalNotes, noteEdits.invoiceReferenceLink, invoice, handleSaveNotes, savingNotes]);

  // ⚠️ DISABLED: Auto-sync useEffect was causing invoice totals to be recalculated
  // whenever the modal opened. This defeats the purpose of storing fixed invoice totals.
  // Totals should only be updated when user explicitly requests recalculation.
  /*
  useEffect(() => {
    if (!isAdmin) return;
    if (!invoice?._id) return;
    if (loading) return;
    if (!previewTotals) return;
    if (savingCoverage) return;

    const targetSubtotal = roundCurrency(previewTotals.subtotal ?? 0);
    const storedSubtotal = roundCurrency(toNumberOr(invoice?.subtotal, 0));

    const targetTotal = roundCurrency(previewTotals.total ?? previewTotals.totalAmount ?? previewTotals.amount ?? 0);
    const storedTotal = roundCurrency(
      toNumberOr(
        typeof invoice?.adjustedTotal === 'number' && invoice.adjustedTotal > 0
          ? invoice.adjustedTotal
          : invoice?.total,
        0
      )
    );

    const targetTransferFee = roundCurrency(previewTotals.transferFeeAmount ?? 0);

    const storedPaid = roundCurrency(toNumberOr(invoice?.paidAmount, 0));
    const storedRemaining = invoice?.remainingBalance !== undefined
      ? roundCurrency(toNumberOr(invoice.remainingBalance, Math.max(0, storedTotal - storedPaid)))
      : roundCurrency(Math.max(0, storedTotal - storedPaid));
    const targetRemaining = roundCurrency(
      previewTotals.remaining ?? Math.max(0, targetTotal - (previewTotals.paidAmount ?? storedPaid))
    );

    const needsSync =
      Math.abs(storedSubtotal - targetSubtotal) > 0.01 ||
      Math.abs(storedTotal - targetTotal) > 0.01 ||
      Math.abs(storedRemaining - targetRemaining) > 0.01;

    if (!needsSync) return;

    const payloadKey = JSON.stringify({
      subtotal: targetSubtotal,
      total: targetTotal,
      transferFee: targetTransferFee,
      remaining: targetRemaining
    });

    if (totalsSyncKeyRef.current === payloadKey) return;
    if (syncingSnapshotRef.current) return;

    totalsSyncKeyRef.current = payloadKey;
    syncingSnapshotRef.current = true;

    let cancelled = false;

    const syncTotals = async () => {
      try {
  const { data } = await api.put(`/invoices/${invoice._id}/snapshot`, { previewTotals });
        if (cancelled) return;
        const updated = data.invoice || data;
        if (updated && typeof updated === 'object') {
          // apply returned invoice object from snapshot endpoint
          const mergedUpdatedInvoice = buildCoverageDraftInvoice(updated);
          setInvoice((prev) => (prev ? { ...prev, ...mergedUpdatedInvoice } : mergedUpdatedInvoice));

          // Attempt to re-fetch authoritative invoice from server to ensure
          // the UI state matches exactly what was persisted (prevents any
          // server-side hooks or post-processing from causing divergence).
          try {
            // Prefer the invoice object returned from the snapshot endpoint (if any)
            // to avoid an extra GET which may cause parent re-renders and modal
            // remounts. If the snapshot did not return an invoice, fall back to
            // fetching the authoritative invoice.
            const refetched = (data && (data.invoice || data)) || null;
            if (refetched) {
              syncInvoiceState(refetched);

              // If local coverage inputs differ from persisted coverage, persist them.
              try {
                const draftMax = coverageDraftRef.current.maxHours ?? '';
                const draftEnd = coverageDraftRef.current.customEndDate ?? '';
                const draftWaive = Boolean(coverageDraftRef.current.waiveTransferFee);
                const localMax = draftMax !== '' && draftMax !== null && draftMax !== undefined ? Number(draftMax) : null;
                const persistedMax = refetched.coverage && typeof refetched.coverage.maxHours === 'number' ? refetched.coverage.maxHours : null;
                const localEnd = draftEnd || null;
                const persistedEnd = refetched.coverage && refetched.coverage.endDate ? refetched.coverage.endDate : null;
                const localWaive = draftWaive;
                const persistedWaive = Boolean(refetched.coverage && refetched.coverage.waiveTransferFee);

                const maxDiffers = (localMax === null && persistedMax !== null) || (localMax !== null && persistedMax === null) || (localMax !== null && persistedMax !== null && Math.abs(localMax - persistedMax) > 0.0001);
                const endDiffers = (localEnd || '') !== (persistedEnd || '');
                const waiveDiffers = localWaive !== persistedWaive;

                if (maxDiffers || endDiffers || waiveDiffers) {
                  const strategyValue = draftMax ? 'cap_hours' : draftEnd ? 'custom_end' : 'full_period';
                  const parsedMaxHours = Number.isFinite(Number(draftMax)) ? Number(draftMax) : null;
                  const coveragePayload = {
                    strategy: strategyValue,
                    maxHours: parsedMaxHours,
                    endDate: draftEnd || null,
                    waiveTransferFee: draftWaive,
                    previewTotals
                  };

                  try {
                    const covRes = await api.put(`/invoices/${invoice._id}/coverage`, coveragePayload);
                    
                    const covUpdated = covRes.data?.invoice || covRes.data;
                    if (covUpdated) {
                      // sync authoritative invoice after coverage save using returned object
                      syncInvoiceState(covUpdated);
                    }
                  } catch (covErr) {
                    console.error('Coverage persist after snapshot failed:', covErr);
                  }
                }
              } catch (cmpErr) {
                console.error('Coverage compare/persist error:', cmpErr);
              }
            } else {
              try {
                const { data: fetched } = await api.get(`/invoices/${invoice._id}`);
                const ref = fetched.invoice || fetched;
                if (ref) syncInvoiceState(ref);
              } catch (rfErr) {
                console.error('Refetch after snapshot save failed:', rfErr);
              }
            }
          } catch (rfErr) {
            console.error('Refetch after snapshot save failed:', rfErr);
          }
        } else {
          setInvoice((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              subtotal: targetSubtotal,
              total: targetTotal,
              adjustedTotal: targetTotal,
              amount: targetTotal,
              paidAmount:
                previewTotals.paidAmount !== undefined
                  ? roundCurrency(previewTotals.paidAmount)
                  : prev.paidAmount,
              guardianFinancial: {
                ...(prev.guardianFinancial || {}),
                transferFee: {
                  ...(prev.guardianFinancial?.transferFee || {}),
                  amount: targetTransferFee,
                  waived: Boolean(previewTotals.transferFeeWaived)
                },
                hourlyRate:
                  previewTotals.guardianRate ?? prev.guardianFinancial?.hourlyRate
              },
              hoursCovered:
                previewTotals.hours !== undefined
                  ? Number(previewTotals.hours)
                  : prev.hoursCovered
            };
          });
        }
      } catch (err) {
        console.error('Invoice snapshot sync failed:', err);
        totalsSyncKeyRef.current = null;
      } finally {
        if (!cancelled) {
          syncingSnapshotRef.current = false;
        }
      }
    };

    syncTotals();

    return () => {
      cancelled = true;
      syncingSnapshotRef.current = false;
    };
  }, [
    isAdmin,
    invoice?._id,
    invoice?.subtotal,
    invoice?.total,
    invoice?.adjustedTotal,
    invoice?.paidAmount,
    invoice?.remainingBalance,
    previewTotals,
    savingCoverage,
    loading
  ]);
  */

  const handleMarkInvoiceUnpaid = useCallback(async () => {
    const targetId = invoice?._id;
    if (!targetId) return;
    const confirmed = window.confirm('Marking this invoice as unpaid will reverse the recorded payment and adjust guardian hours. Continue?');
    if (!confirmed) return;

    setRevertingPayment(true);
    setRevertStatus(null);

    try {
  const { data } = await api.post(`/invoices/${targetId}/mark-unpaid`, {});
      const updatedInvoice = data?.invoice || data;
      if (updatedInvoice) {
        syncInvoiceState(updatedInvoice);
        if (typeof onInvoiceUpdate === 'function') {
          onInvoiceUpdate(updatedInvoice);
        }
      }

      setRevertStatus({ type: 'success', message: 'Invoice marked as unpaid' });
      setTimeout(() => setRevertStatus(null), 3000);
    } catch (err) {
      console.error('Failed to mark invoice unpaid', err);
      const message = err?.response?.data?.message || err?.message || 'Failed to mark invoice unpaid';
      setRevertStatus({ type: 'error', message });
      setTimeout(() => setRevertStatus(null), 4000);
    } finally {
      setRevertingPayment(false);
    }
  }, [invoice, onInvoiceUpdate, syncInvoiceState]);

  const handleCopyShareLink = useCallback(async () => {
    if (!invoice?.invoiceSlug) return;
    const shareUrl = `${window.location.origin}/public/invoices/${invoice.invoiceSlug}`;

    const reset = () => {
      setTimeout(() => setShareStatus(null), 2000);
    };

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const success = window.prompt('Copy this link to share the invoice:', shareUrl);
        if (success === null) {
          throw new Error('Share link cancelled');
        }
      }
      setShareStatus({ type: 'success', message: 'Link copied' });
      reset();
    } catch (err) {
      console.error('Copy link failed', err);
      setShareStatus({ type: 'error', message: 'Copy failed' });
      reset();
    }
  }, [invoice?.invoiceSlug]);

  const handleCopyCoverageMessage = useCallback(async () => {
    const firstClass = filteredClasses?.[0] || null;
    const lastClass = filteredClasses?.[filteredClasses.length - 1] || null;
    const startDateText = firstClass?.date || '-';
    const endDateText = lastClass?.date || '-';

    if (!invoice?.invoiceSlug) {
      setNotesStatus({ type: 'error', message: 'Public invoice link is not available yet' });
      setTimeout(() => setNotesStatus(null), 2500);
      return;
    }

    const shareUrl = `${window.location.origin}/public/invoices/${invoice.invoiceSlug}`;
    const message = [
      `This invoice covers from ${startDateText} to ${endDateText}.`,
      `This is a link to view all classes covered by this invoice: ${shareUrl}`,
      'Or visit your account on our dashboard for full details.'
    ].join('\n');

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
      } else {
        const copied = window.prompt('Copy this coverage message:', message);
        if (copied === null) {
          throw new Error('Copy cancelled');
        }
      }
      setNotesStatus({ type: 'success', message: 'Coverage message copied' });
    } catch (err) {
      console.error('Failed to copy coverage message', err);
      setNotesStatus({ type: 'error', message: 'Copy failed' });
    }
    setTimeout(() => setNotesStatus(null), 2000);
  }, [filteredClasses, invoice?.invoiceSlug]);

  const latestPaymentReference = useMemo(() => {
    const logs = Array.isArray(invoice?.paymentLogs)
      ? invoice.paymentLogs
      : [];

    const nonTipLogs = logs.filter((log) => log && log.method !== 'tip_distribution');
    const latest = nonTipLogs.length ? nonTipLogs[nonTipLogs.length - 1] : null;

    const reference = String(
      latest?.transactionId
      || invoice?.transactionId
      || invoice?.paymentReference
      || ''
    ).trim();

    if (!reference) return null;

    const isLink = /^https?:\/\//i.test(reference);
    return { value: reference, isLink };
  }, [invoice?.paymentLogs, invoice?.transactionId, invoice?.paymentReference]);

  const handleCopyPaymentReference = useCallback(async () => {
    const referenceValue = latestPaymentReference?.value;
    if (!referenceValue) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(referenceValue);
      } else {
        const copied = window.prompt('Copy payment reference:', referenceValue);
        if (copied === null) {
          throw new Error('Copy cancelled');
        }
      }
      setNotesStatus({ type: 'success', message: 'Payment reference copied' });
    } catch (err) {
      console.error('Failed to copy payment reference', err);
      setNotesStatus({ type: 'error', message: 'Copy failed' });
    }

    setTimeout(() => setNotesStatus(null), 2000);
  }, [latestPaymentReference]);

  const handleCopyInvoiceReference = useCallback(async () => {
    const referenceValue = String(noteEdits.invoiceReferenceLink || '').trim();
    if (!referenceValue) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(referenceValue);
      } else {
        const copied = window.prompt('Copy invoice reference:', referenceValue);
        if (copied === null) {
          throw new Error('Copy cancelled');
        }
      }
      setNotesStatus({ type: 'success', message: 'Invoice reference copied' });
    } catch (err) {
      console.error('Failed to copy invoice reference', err);
      setNotesStatus({ type: 'error', message: 'Copy failed' });
    }

    setTimeout(() => setNotesStatus(null), 2000);
  }, [noteEdits.invoiceReferenceLink]);

  const handleCopyGuardianName = useCallback(async () => {
    const fullName = `${invoice?.guardian?.firstName || ''} ${invoice?.guardian?.lastName || ''}`.trim();
    if (!fullName) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullName);
      } else {
        const copied = window.prompt('Copy guardian name:', fullName);
        if (copied === null) {
          throw new Error('Copy cancelled');
        }
      }
      setNotesStatus({ type: 'success', message: 'Guardian name copied' });
    } catch (err) {
      console.error('Failed to copy guardian name', err);
      setNotesStatus({ type: 'error', message: 'Copy failed' });
    }

    setTimeout(() => setNotesStatus(null), 2000);
  }, [invoice?.guardian?.firstName, invoice?.guardian?.lastName]);

  const handleCopyGuardianEmail = useCallback(async () => {
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
      setNotesStatus({ type: 'success', message: 'Guardian email copied' });
    } catch (err) {
      console.error('Failed to copy guardian email', err);
      setNotesStatus({ type: 'error', message: 'Copy failed' });
    }

    setTimeout(() => setNotesStatus(null), 2000);
  }, [invoice?.guardian?.email]);

  if (loading) return <LoadingSpinner />;
  if (!invoice) return <div className="p-4 text-center">Invoice not found</div>;

  const statusTone = (() => {
    switch (invoice.status) {
      case 'paid':
        return 'bg-emerald-500/20 text-emerald-900 ring-1 ring-emerald-500/30';
      case 'pending':
        return 'bg-amber-500/20 text-amber-900 ring-1 ring-amber-500/30';
      case 'sent':
        return 'bg-sky-500/20 text-sky-900 ring-1 ring-sky-500/30';
      case 'overdue':
        return 'bg-rose-500/20 text-rose-900 ring-1 ring-rose-500/30';
      case 'cancelled':
        return 'bg-amber-500/20 text-amber-900 ring-1 ring-amber-500/30';
      case 'refunded':
        return 'bg-violet-500/20 text-violet-900 ring-1 ring-violet-500/30';
      case 'draft':
      default:
        return 'bg-slate-200 text-slate-900 ring-1 ring-slate-300';
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 px-4 py-8 backdrop-blur-sm">
      <div className="relative flex w-full max-w-6xl max-h-[90vh] flex-col overflow-hidden rounded-[32px] bg-white shadow-2xl">
        <button
          onClick={handleClose}
          className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow hover:text-slate-900"
          aria-label="Close invoice modal"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-8">
          <div className="bg-white/95 px-4 py-5 sm:px-8 sm:py-6">
            <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap pb-1 pr-12 sm:pr-14">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <h2 className="flex min-w-0 items-center gap-1.5 text-xl font-semibold text-slate-900 sm:text-2xl">
                  <span>{`${invoiceNameParts.prefix || 'Waraqa'}-${invoiceNameParts.month || ''}-${invoiceNameParts.year || ''}-`}</span>
                  {seqEditing || !invoiceNameParts.seq ? (
                    <input
                      ref={seqInputRef}
                      value={seqDraft}
                      onChange={(e) => setSeqDraft(e.target.value)}
                      autoFocus={seqEditing || !invoiceNameParts.seq}
                      onFocus={(e) => e.target.select()}
                      onClick={(e) => e.currentTarget.select()}
                      onBlur={() => {
                        setSeqEditing(false);
                        handleSaveSeq(seqInputRef.current?.value ?? seqDraft);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setSeqEditing(false);
                          handleSaveSeq(e.currentTarget.value);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          const parts = parseInvoiceNameParts(invoice?.invoiceName || '');
                          setInvoiceNameParts(parts);
                          setSeqDraft(parts.seq || '');
                          setSeqEditing(false);
                          setInvoiceNameStatus(null);
                        }
                      }}
                      className="w-20 border-0 border-b border-slate-300 bg-transparent px-0 py-0 text-xl font-semibold text-slate-900 focus:border-slate-500 focus:outline-none sm:text-2xl"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (!isAdmin) return;
                        setSeqDraft(invoiceNameParts.seq || '');
                        setSeqEditing(true);
                      }}
                      className={`px-0.5 ${isAdmin ? 'hover:text-slate-700' : ''}`}
                      title={isAdmin ? 'Click to edit invoice number' : undefined}
                    >
                      {invoiceNameParts.seq || ''}
                    </button>
                  )}
                </h2>
                <span className={`inline-flex w-16 justify-start text-xs font-semibold leading-4 ${invoiceNameStatus ? (invoiceNameStatus.type === 'success' ? 'text-emerald-600' : invoiceNameStatus.type === 'error' ? 'text-rose-600' : 'text-slate-500') : 'text-transparent'}`}>
                  {invoiceNameStatus?.message || 'Saved'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm text-slate-600 shrink-0">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusTone}`} title={getStatusTooltip(invoice.status)} aria-label={getStatusTooltip(invoice.status)}>
                    <Sparkles className="h-3.5 w-3.5" />
                    {invoice.status}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs">
                    <Calendar className="h-3.5 w-3.5 text-slate-500" />
                    <span>{formatDateDisplay(invoice.createdAt)}</span>
                </span>
              </div>

              <div className="ml-auto flex items-center gap-1.5 shrink-0">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => onOpenRecordPayment?.(invoice)}
                    className="inline-flex h-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 px-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                    title="Open record payment (Alt+Shift+P)"
                  >
                    Record payment
                  </button>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleCopyCoverageMessage}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-violet-200 bg-violet-50 text-violet-600 transition hover:border-violet-300 hover:bg-violet-100"
                    title="Copy message"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
                {invoice?.invoiceSlug && (
                  <button
                    onClick={handleCopyShareLink}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-600 transition hover:border-sky-300 hover:bg-sky-100"
                    type="button"
                    title="Copy share link"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={downloadPDF}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                  type="button"
                  title="Download PDF"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span className="text-[10px] font-semibold tracking-wide">PDF</span>
                </button>
                <button
                  onClick={downloadExcel}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 transition hover:border-amber-300 hover:bg-amber-100"
                  type="button"
                  title="Export Excel"
                >
                  <FileDown className="h-3.5 w-3.5" />
                </button>

                <div className="flex flex-col items-start gap-1 sm:items-end pl-1">
                  {isAdmin && (invoice.status === 'paid' || Number(invoice?.paidAmount || 0) > 0) && (
                    <button
                      onClick={handleMarkInvoiceUnpaid}
                      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition ${revertingPayment ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400' : 'border-rose-200 bg-white text-rose-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700'}`}
                      type="button"
                      disabled={revertingPayment}
                      title="Reverse payment and mark invoice as unpaid"
                    >
                      {revertingPayment ? 'Reverting…' : 'Mark unpaid'}
                    </button>
                  )}
                  {revertStatus && (
                    <span className={`text-xs font-medium ${revertStatus.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {revertStatus.message}
                    </span>
                  )}
                  {shareStatus && (
                    <span className={`text-xs font-medium ${shareStatus.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {shareStatus.message}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="mt-2 space-y-2">
                      <div>
                        <p className="text-2xl font-semibold text-slate-900">${primaryAmount.toFixed(2)}</p>
                        <p className="text-xs uppercase tracking-wide text-slate-400">{primaryLabel}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                          {filteredClasses.length} classes
                        </span>
                        <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
                          {totalHours.toFixed(2)}h
                        </span>
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                          ${guardianRate.toFixed(2)} / hr
                        </span>
                      </div>
                      <div className="space-y-1 text-sm text-slate-600">
                        <div className="flex justify-between">
                          <span>Subtotal ({subtotalHoursDisplay}h × ${guardianRate.toFixed(2)})</span>
                          <span className="font-medium text-slate-900">${subtotal.toFixed(2)}</span>
                        </div>
                        
                        <div className="flex justify-between">
                          <span>Transfer fee</span>
                          {/* Only show explicit 'Waived' text to admins. Guardians see the numeric value (may be 0). */}
                          <span className={transferFeeWaivedPreview && isAdmin ? 'font-semibold text-emerald-600' : 'font-medium text-slate-900'}>
                            {transferFeeWaivedPreview && isAdmin
                              ? 'Waived'
                              : `$${transferFeeDisplayAmount.toFixed(2)}`}
                          </span>
                        </div>
                        {!transferFeeWaivedPreview && transferFeeDetails.mode === 'percent' && transferFeeValueDisplay > 0 && (
                          <p className="text-xs text-slate-500">{transferFeeValueDisplay}% of subtotal</p>
                        )}
                        {appliedDiscount > 0 && (
                          <div className="flex justify-between">
                            <span>Discount</span>
                            <span className="text-slate-900">- ${appliedDiscount.toFixed(2)}</span>
                          </div>
                        )}
                        {lateFeeAmount > 0 && (
                          <div className="flex justify-between">
                            <span>Late fee</span>
                            <span className="text-slate-900">${lateFeeAmount.toFixed(2)}</span>
                          </div>
                        )}
                        {tipAmount > 0 && (
                          <>
                            <div className="flex justify-between">
                              <span>Tip</span>
                              <span className="text-slate-900">${tipAmount.toFixed(2)}</span>
                            </div>
                            {(() => {
                              const items = Array.isArray(invoice?.items) ? invoice.items : [];
                              const names = [];
                              const seen = new Set();
                              items.forEach((it) => {
                                if (it?.excludeFromTeacherPayment) return;
                                const t = it?.teacherSnapshot || it?.teacher || {};
                                const first = (t.firstName || t.first || '').toString().trim();
                                const last = (t.lastName || t.last || '').toString().trim();
                                const full = `${first} ${last}`.trim();
                                if (full && !seen.has(full)) {
                                  seen.add(full);
                                  names.push(full);
                                }
                              });

                              if (!names.length) return null;

                              const perTeacher = tipAmount / names.length;
                              if (names.length === 1) {
                                return (
                                  <p className="text-xs text-slate-500">
                                    {names[0]} receives ${perTeacher.toFixed(2)}
                                  </p>
                                );
                              }

                              const [firstName, secondName] = names;
                              return (
                                <p className="text-xs text-slate-500">
                                  {firstName} and {secondName} split ${perTeacher.toFixed(2)} each
                                  {names.length > 2 ? ' (and others)' : ''}
                                </p>
                              );
                            })()}
                          </>
                        )}
                        <div className="flex justify-between pt-2">
                          <span>Paid</span>
                          <span>${paidAmount.toFixed(2)}</span>
                        </div>
                        {isAdmin && !isPaidStatus && (
                          <div className="pt-2">
                            <input
                              type="url"
                              value={noteEdits.invoiceReferenceLink}
                              onChange={(e) => handleNoteChange('invoiceReferenceLink', e.target.value)}
                              placeholder="Invoice reference"
                              className="w-full border-b border-slate-200 bg-transparent px-0 py-1 text-sm text-slate-700 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                            />
                          </div>
                        )}
                        {isAdmin && isPaidStatus && noteEdits.invoiceReferenceLink?.trim() && (
                          <div className="space-y-1.5 pt-2">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-slate-600">Invoice reference</span>
                              <div className="flex items-center gap-1.5">
                                <a
                                  href={noteEdits.invoiceReferenceLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                  title="Open invoice reference"
                                >
                                  <Link2 className="h-3 w-3" />
                                  Open
                                </a>
                                <button
                                  type="button"
                                  onClick={handleCopyInvoiceReference}
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                  title="Copy invoice reference"
                                >
                                  <FileText className="h-3 w-3" />
                                  Copy
                                </button>
                              </div>
                            </div>
                            <p className="break-all text-xs text-slate-500">{noteEdits.invoiceReferenceLink}</p>
                          </div>
                        )}
                        {latestPaymentReference && (
                          <div className="space-y-1.5 pt-2">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-slate-600">Payment reference</span>
                              <div className="flex items-center gap-1.5">
                                {latestPaymentReference.isLink && (
                                  <a
                                    href={latestPaymentReference.value}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                    title="Open payment link"
                                  >
                                    <Link2 className="h-3 w-3" />
                                    Open
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={handleCopyPaymentReference}
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900"
                                  title="Copy payment reference"
                                >
                                  <FileText className="h-3 w-3" />
                                  Copy
                                </button>
                              </div>
                            </div>
                            <p className="break-all text-xs text-slate-500">{latestPaymentReference.value}</p>
                          </div>
                        )}
                      </div>
                    </div>
              </div>
              <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-2 text-xs tracking-wide text-slate-500">
                    <p className="font-semibold uppercase text-slate-500">Classes &amp; coverage</p>
                    <div className="flex flex-wrap items-center gap-3 text-slate-500">
                      {!hideClassBreakdown ? (
                        <></>
                      ) : (
                        <div className="flex flex-col text-[13px] leading-tight">
                          <span className="font-semibold text-slate-900">No class sessions</span>
                          <span className="text-slate-600">{isRefillOnlyInvoice ? 'Hour refill only' : 'Fee-only invoice'}</span>
                        </div>
                      )}
                      {/* Only admins can view or edit the waive-transfer-fee control */}
                      {isAdmin && (
                        <div className="inline-flex shrink-0 items-center gap-2">
                          <span className="text-[11px] font-semibold text-slate-600">Transfer fees</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (isCoverageLocked) return;
                              setWaiveTransferFee((prev) => {
                                const nextWaiveTransferFee = !prev;
                                updateCoverageDraft({ waiveTransferFee: nextWaiveTransferFee });
                                return nextWaiveTransferFee;
                              });
                              userModifiedFiltersRef.current = true;
                            }}
                            disabled={isCoverageLocked}
                            aria-pressed={!waiveTransferFee}
                            className={`inline-flex h-6 w-10 items-center rounded-full border transition ${
                              waiveTransferFee
                                ? 'border-slate-200 bg-slate-200'
                                : 'border-emerald-300 bg-emerald-500'
                            } ${isCoverageLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                            title={waiveTransferFee ? 'Transfer fees not applied' : 'Transfer fees applied'}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
                                waiveTransferFee ? 'translate-x-1' : 'translate-x-5'
                              }`}
                            />
                          </button>
                        </div>
                      )}
                    </div>
                    
                  </div>
                  {coverageStatus && (
                    <span
                      className={`mt-1 inline-flex text-xs font-medium ${
                        coverageStatus.type === 'success'
                          ? 'text-emerald-600'
                          : coverageStatus.type === 'error'
                            ? 'text-rose-600'
                            : 'text-slate-500'
                      }`}
                    >
                      {coverageStatus.message}
                    </span>
                  )}
                </div>

                {isAdmin && (
                  <div className="mt-4 flex-1 space-y-4 text-sm text-slate-600">
                    {!isCoverageLocked ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
                          <span className="font-semibold text-slate-600">Covered Hours</span>
                          <input
                            ref={maxHoursInputRef}
                            type="number"
                            value={maxHours}
                            onKeyDown={(e) => {
                              if (isCoverageLocked) return;
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              const nextValue = e.currentTarget.value;
                              coverageEditingRef.current = false;
                              holdCoverageDraft();
                              skipCoverageBlurSaveRef.current = 'maxHours';
                              skipNextCoverageSave.current = true;
                              commitCoverageFieldDraft('maxHours', nextValue);
                              coverageLastSavedRef.current = { maxHours: nextValue, customEndDate: '', waiveTransferFee: coverageDraftRef.current.waiveTransferFee };
                              userModifiedFiltersRef.current = false;
                              handleSaveCoverage({ maxHours: nextValue, customEndDate: '', waiveTransferFee: coverageDraftRef.current.waiveTransferFee });
                              activeCoverageFieldRef.current = null;
                              e.currentTarget.blur();
                            }}
                            onChange={(e) => {
                              if (isCoverageLocked) return;
                              coverageEditingRef.current = true;
                              activeCoverageFieldRef.current = 'maxHours';
                              const value = e.target.value;
                              userModifiedFiltersRef.current = true;
                              updateCoverageDraft({ maxHours: value, customEndDate: '' });
                              setMaxHours(value);
                              if (value === '' || value === null || value === undefined) {
                                setCustomEndDate('');
                                return;
                              }
                              setCustomEndDate('');
                            }}
                            onFocus={() => {
                              if (isCoverageLocked) return;
                              coverageEditingRef.current = true;
                              activeCoverageFieldRef.current = 'maxHours';
                            }}
                            onBlur={(e) => {
                              if (isCoverageLocked) return;
                              if (skipCoverageBlurSaveRef.current === 'maxHours') {
                                skipCoverageBlurSaveRef.current = null;
                                activeCoverageFieldRef.current = null;
                                return;
                              }
                              coverageEditingRef.current = false;
                              const value = e.target.value;
                              skipNextCoverageSave.current = true;
                              updateCoverageDraft({ maxHours: value });
                              setMaxHours(value);
                              holdCoverageDraft();
                              coverageLastSavedRef.current = { maxHours: value, customEndDate: '', waiveTransferFee: coverageDraftRef.current.waiveTransferFee };
                              userModifiedFiltersRef.current = false;
                              handleSaveCoverage({ maxHours: value, customEndDate: '', waiveTransferFee: coverageDraftRef.current.waiveTransferFee });
                              activeCoverageFieldRef.current = null;
                            }}
                            placeholder="e.g. 10"
                            disabled={isCoverageLocked}
                            className="border-0 border-b border-slate-200 bg-transparent px-0 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                          />
                        </label>
                        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
                          <span className="font-semibold text-slate-600">End Date</span>
                          <input
                            ref={endDateInputRef}
                            type="date"
                            value={customEndDate}
                            onKeyDown={(e) => {
                              if (isCoverageLocked) return;
                              if (e.key !== 'Enter') return;
                              e.preventDefault();
                              const nextValue = e.currentTarget.value;
                              const derivedMax = nextValue ? computeMaxHoursFromEndDate(nextValue) : '';
                              coverageEditingRef.current = false;
                              holdCoverageDraft();
                              skipCoverageBlurSaveRef.current = 'customEndDate';
                              skipNextCoverageSave.current = true;
                              commitCoverageFieldDraft('customEndDate', nextValue);
                              coverageLastSavedRef.current = { maxHours: derivedMax, customEndDate: nextValue, waiveTransferFee: coverageDraftRef.current.waiveTransferFee };
                              userModifiedFiltersRef.current = false;
                              handleSaveCoverage({ customEndDate: nextValue, maxHours: derivedMax, waiveTransferFee: coverageDraftRef.current.waiveTransferFee });
                              activeCoverageFieldRef.current = null;
                              e.currentTarget.blur();
                            }}
                            onChange={(e) => {
                              if (isCoverageLocked) return;
                              coverageEditingRef.current = true;
                              activeCoverageFieldRef.current = 'customEndDate';
                              const value = e.target.value;
                              userModifiedFiltersRef.current = true;
                              setCustomEndDate(value);
                              if (!value) {
                                updateCoverageDraft({ customEndDate: '', maxHours: '' });
                                setMaxHours('');
                                return;
                              }
                              const derivedMax = computeMaxHoursFromEndDate(value);
                              updateCoverageDraft({ customEndDate: value, maxHours: derivedMax });
                              setMaxHours(derivedMax);
                            }}
                            onFocus={() => {
                              if (isCoverageLocked) return;
                              coverageEditingRef.current = true;
                              activeCoverageFieldRef.current = 'customEndDate';
                            }}
                            onBlur={(e) => {
                              if (isCoverageLocked) return;
                              if (skipCoverageBlurSaveRef.current === 'customEndDate') {
                                skipCoverageBlurSaveRef.current = null;
                                activeCoverageFieldRef.current = null;
                                return;
                              }
                              coverageEditingRef.current = false;
                              const value = e.target.value;
                              const derivedMax = value ? computeMaxHoursFromEndDate(value) : '';
                              skipNextCoverageSave.current = true;
                              updateCoverageDraft({ customEndDate: value, maxHours: derivedMax });
                              setCustomEndDate(value);
                              setMaxHours(derivedMax);
                              holdCoverageDraft();
                              coverageLastSavedRef.current = { maxHours: derivedMax, customEndDate: value, waiveTransferFee: coverageDraftRef.current.waiveTransferFee };
                              userModifiedFiltersRef.current = false;
                              handleSaveCoverage({ customEndDate: value, maxHours: derivedMax, waiveTransferFee: coverageDraftRef.current.waiveTransferFee });
                              activeCoverageFieldRef.current = null;
                            }}
                            disabled={isCoverageLocked}
                            className="border-0 border-b border-slate-200 bg-transparent px-0 py-2 text-sm text-slate-700 focus:border-slate-400 focus:outline-none"
                          />
                        </label>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        Paid invoice: coverage settings are locked.
                      </div>
                    )}
                    
                    <label className="flex flex-col gap-1.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-violet-600"><FileText className="h-3.5 w-3.5" /> admin</span>
                      {editingInlineNote === 'internal' ? (
                        <textarea
                          autoFocus
                          value={noteEdits.internalNotes}
                          onChange={(e) => handleNoteChange('internalNotes', e.target.value)}
                          onBlur={() => setEditingInlineNote(null)}
                          rows={2}
                          placeholder="Private context for the admin team..."
                          className="min-h-[40px] resize-y border-0 border-b border-violet-200 bg-transparent px-0 py-1 text-[13px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingInlineNote('internal')}
                          className="w-full border-b border-violet-100 pb-1 text-left text-[13px] leading-relaxed text-slate-700 hover:border-violet-300"
                          title="Click to edit internal admin note"
                        >
                          {noteEdits.internalNotes?.trim() ? formatNoteText(noteEdits.internalNotes) : <span className="text-slate-400">Click to add internal note…</span>}
                        </button>
                      )}
                    </label>
                  </div>
                )}
              </div>
              <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <button
                  type="button"
                  onClick={handleCopyGuardianName}
                  className="mt-2 inline-flex w-fit items-center gap-1.5 text-left text-sm font-semibold text-slate-900"
                  title="Click to copy guardian name"
                >
                  <User className="h-3.5 w-3.5 text-slate-500" />
                  {invoice.guardian?.firstName} {invoice.guardian?.lastName}
                </button>
                <button
                  type="button"
                  onClick={handleCopyGuardianEmail}
                  className="mt-1 inline-flex w-fit items-center gap-1.5 text-left text-xs text-slate-600"
                  title="Click to copy guardian email"
                >
                  <Mail className="h-3.5 w-3.5 text-slate-500" />
                  {invoice.guardian?.email || '—'}
                </button>
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide">
                    <span className="inline-flex items-center rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
                      Students {Object.keys(studentSummary).length}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-sky-50 px-2.5 py-1 text-sky-700">
                      Entries {filteredClasses.length}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    {Object.entries(studentSummary).map(([name, { count, hours }]) => (
                      <div key={name} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{name}</span>
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{count} cls</span>
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{(hours / 60).toFixed(1)}h</span>
                      </div>
                    ))}
                    {Object.keys(studentSummary).length === 0 && (
                      <p className="text-slate-500">No classes recorded</p>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-sky-600"><FileText className="h-3.5 w-3.5" /> guardian (public)</p>
                    {isAdmin && notesStatus && (
                      <span
                        className={`text-xs font-medium ${
                          notesStatus.type === 'success'
                            ? 'text-emerald-600'
                            : notesStatus.type === 'error'
                              ? 'text-rose-600'
                              : 'text-slate-500'
                        }`}
                      >
                        {notesStatus.message}
                      </span>
                    )}
                  </div>
                  {isAdmin ? (
                    editingInlineNote === 'guardian' ? (
                      <textarea
                        autoFocus
                        value={noteEdits.notes}
                        onChange={(e) => handleNoteChange('notes', e.target.value)}
                        onBlur={() => setEditingInlineNote(null)}
                        rows={2}
                        placeholder="Visible to guardians on their invoice..."
                        className="mt-1.5 min-h-[40px] w-full resize-y border-0 border-b border-sky-200 bg-transparent px-0 py-1 text-[13px] leading-relaxed text-slate-700 placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditingInlineNote('guardian')}
                        className="mt-1.5 w-full border-b border-sky-100 pb-1 text-left text-[13px] leading-relaxed text-slate-700 hover:border-sky-300"
                        title="Click to edit guardian-visible note"
                      >
                        {noteEdits.notes?.trim() ? formatNoteText(noteEdits.notes) : <span className="text-slate-400">Click to add guardian-visible note…</span>}
                      </button>
                    )
                  ) : (
                    <div className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-relaxed text-slate-600">
                      {noteEdits.notes?.trim() ? formatNoteText(noteEdits.notes) : <span className="text-slate-400">No guardian note yet.</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {!hideClassBreakdown && (
            <div className="px-4 pb-6 sm:px-8 sm:pb-8">
              <div className="flex h-full w-full flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
                {filteredClasses.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-5 py-12 text-center text-sm text-slate-500">
                    No classes available for this invoice.
                  </div>
                ) : (
                  <div className={classTableOuterClasses}>
                    <div className={classTableInnerClasses} style={classTableInnerStyle}>
                      <table className="min-w-full table-auto divide-y divide-slate-100 text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="sticky top-0 z-10 w-12 bg-slate-50/95 px-4 py-3 text-center backdrop-blur">#</th>
                            <th className="sticky top-0 z-10 w-[22%] bg-slate-50/95 px-4 py-3 backdrop-blur">When</th>
                            <th className="sticky top-0 z-10 w-[20%] bg-slate-50/95 px-4 py-3 backdrop-blur">Student</th>
                            <th className="sticky top-0 z-10 w-[20%] bg-slate-50/95 px-4 py-3 backdrop-blur">Teacher</th>
                            <th className="sticky top-0 z-10 w-[26%] bg-slate-50/95 px-4 py-3 backdrop-blur">Subject</th>
                            <th className="sticky top-0 z-10 w-20 bg-slate-50/95 px-4 py-3 text-center backdrop-blur">Mins</th>
                            <th className="sticky top-0 z-10 w-28 bg-slate-50/95 px-4 py-3 backdrop-blur">State</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-600">
                          {filteredClasses.map((c, index) => (
                            <tr key={c._id} className={`odd:bg-white even:bg-slate-50/60 ${c.paidByGuardian ? 'outline outline-1 outline-emerald-100' : ''}`}>
                              <td className="px-4 py-3 text-center text-slate-500">{index + 1}</td>
                              <td className="px-4 py-3 text-slate-700">
                                <span className="flex items-center justify-between gap-3 whitespace-nowrap" title={`${c.date} ${c.time}`}>
                                  <span className="min-w-0 truncate text-[13px] font-medium">{formatClassDateLine(c.rawDate)}</span>
                                  <span className="w-[64px] shrink-0 text-right text-xs text-slate-500">{formatClassTimeLine(c.rawDate)}</span>
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-700">
                                <span
                                  className={`inline-flex max-w-[240px] truncate whitespace-nowrap text-xs font-semibold ${hasMultipleStudents ? (studentToneMap[c.studentName] || 'text-slate-700') : 'text-slate-700'}`}
                                  title={c.studentName}
                                >
                                  {c.studentName}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex max-w-[240px] truncate whitespace-nowrap text-xs font-semibold ${hasMultipleTeachers ? (teacherToneMap[c.teacherName] || 'text-slate-700') : 'text-slate-700'}`}
                                  title={c.teacherName}
                                >
                                  {c.teacherName}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className="block max-w-[320px] truncate whitespace-nowrap" title={c.subject}>{c.subject}</span>
                              </td>
                              <td className="px-4 py-3 text-center whitespace-nowrap">{c.duration}</td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="inline-flex items-center gap-2">
                                  <span
                                    className={`inline-flex rounded-full px-3 py-1 text-xs font-medium capitalize ${(() => {
                                      const normalized = String(c.status || '').toLowerCase();
                                      if (normalized.includes('attended') || normalized === 'completed') return 'bg-emerald-50 text-emerald-700';
                                      if (normalized.includes('scheduled') || normalized === 'in_progress') return 'bg-amber-50 text-amber-700';
                                      if (normalized.includes('missed')) return 'bg-rose-50 text-rose-700';
                                      return 'bg-slate-100 text-slate-600';
                                    })()}`}
                                  >
                                    {c.status.replace(/_/g, ' ')}
                                  </span>
                                  {c.paidByGuardian && (
                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Paid</span>
                                  )}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceViewModal;