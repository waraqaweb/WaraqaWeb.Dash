import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateDDMMMYYYY } from '../../utils/date';
import {
  X,
  Download,
  FileDown,
  FileText,
  Users,
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

const roundCurrency = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
};

const normalizeStatusValue = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const CANCELLED_CLASS_STATUSES = new Set([
  'cancelled',
  'cancelled_by_teacher',
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

const InvoiceViewModal = ({ invoiceSlug, invoiceId, onClose, onInvoiceUpdate }) => {
  const { user, socket } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const handleClose = onClose || (() => navigate(-1));

  const [invoice, setInvoice] = useState(null);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [classPeriod, setClassPeriod] = useState({ start: '', end: '' });
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

  // Admin filters
  const [maxHours, setMaxHours] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [savingCoverage, setSavingCoverage] = useState(false);
  const [coverageStatus, setCoverageStatus] = useState(null);
  const [noteEdits, setNoteEdits] = useState({
    notes: '',
    internalNotes: ''
  });
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesStatus, setNotesStatus] = useState(null);
  const [waiveTransferFee, setWaiveTransferFee] = useState(false);

  const notesLastSavedRef = useRef({ notes: '', internalNotes: '' });
  const skipNextNotesSave = useRef(false);
  const coverageLastSavedRef = useRef({ maxHours: '', customEndDate: '', waiveTransferFee: false });
  const skipNextCoverageSave = useRef(false);
  const totalsSyncKeyRef = useRef(null);
  const syncingSnapshotRef = useRef(false);
  // Tracks debounce timer and a monotonically increasing id for class fetch calls
  const fetchClassesForInvoiceRef = useRef(null);
  // Track if classes have been fetched initially to prevent auto-updates on modal open
  const initialClassesFetchedRef = useRef(false);
  // Track if user has made any changes to filters
  const userModifiedFiltersRef = useRef(false);

  const formatDateInput = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  };

  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatDateDisplay = useCallback((value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const mon = MONTHS_SHORT[d.getUTCMonth()];
    const yr = d.getUTCFullYear();
    return `${day} ${mon} ${yr}`;
  }, []);

  const getReadableInvoiceId = (invoice) => {
    if (!invoice) return '';
    const sys = invoice.invoiceNumber || invoice.invoiceName || '';
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
      const m = sys.match(/(20\d{2})[\/-]?(\d{1,2})/);
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

  const getStatusTooltip = (status) => {
    switch (status) {
      case 'paid': return 'Paid — payment received';
      case 'overdue': return 'Overdue — payment overdue';
      case 'pending': return 'Pending — awaiting payment';
      case 'partially_paid': return 'Partially paid — outstanding balance';
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
    setInvoice(inv);
    const nextNotes = {
      notes: inv?.notes || '',
      internalNotes: inv?.internalNotes || ''
    };
    skipNextNotesSave.current = true;
    setNoteEdits(nextNotes);
    notesLastSavedRef.current = nextNotes;
    const coverage = inv.coverage || {};
    const hasMaxHours = typeof coverage.maxHours === 'number' && Number.isFinite(coverage.maxHours);
    const normalizedMax = hasMaxHours ? Math.max(0, coverage.maxHours) : null;
    const normalizedEndDate = coverage.endDate ? formatDateInput(coverage.endDate) : '';

    const nextMaxHours = normalizedMax && normalizedMax > 0 ? String(normalizedMax) : '';
    const nextCustomEndDate = nextMaxHours ? '' : normalizedEndDate;

    skipNextCoverageSave.current = true;
    setMaxHours(nextMaxHours);
    setCustomEndDate(nextCustomEndDate);
    const nextWaive = Boolean(coverage.waiveTransferFee);
    setWaiveTransferFee(nextWaive);
    userModifiedFiltersRef.current = false;
    coverageLastSavedRef.current = {
      maxHours: nextMaxHours,
      customEndDate: nextCustomEndDate || '',
      waiveTransferFee: nextWaive
    };
  }, []);

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
    if (!identifier) return;
    let cancelled = false;

    const fetchInvoiceDetails = async () => {
      try {
        setLoading(true);
        setCoverageStatus(null);
        setResolvedInvoiceId(invoiceId || null);
        
        // Reset tracking flags when opening a new invoice
        initialClassesFetchedRef.current = false;
        userModifiedFiltersRef.current = false;
        
        const { data: invRes } = await api.get(`/invoices/${identifier}`);
        if (cancelled) return;
        const inv = invRes.invoice || invRes;
        
        syncInvoiceState(inv);
        setResolvedInvoiceId(inv?._id || invoiceId || null);
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
  }, [identifier, invoiceId, syncInvoiceState]);

  // Listen for real-time invoice updates via socket
  useEffect(() => {
    if (!socket || !resolvedInvoiceId) return;

    const handleInvoiceUpdate = async (updatedInvoice) => {
      // Only re-fetch if this is the invoice we're viewing
      if (updatedInvoice && updatedInvoice._id === resolvedInvoiceId) {
        try {
          const { data: invRes } = await api.get(`/invoices/${identifier}`);
          const inv = invRes.invoice || invRes;
          syncInvoiceState(inv);
        } catch (err) {
          console.error('Failed to refresh invoice after socket update:', err);
        }
      }
    };

    socket.on('invoice:updated', handleInvoiceUpdate);
    socket.on('invoice:paid', handleInvoiceUpdate);
    socket.on('invoice:partially_paid', handleInvoiceUpdate);

    return () => {
      socket.off('invoice:updated', handleInvoiceUpdate);
      socket.off('invoice:paid', handleInvoiceUpdate);
      socket.off('invoice:partially_paid', handleInvoiceUpdate);
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
        const { data: invRes } = await api.get(`/invoices/${identifier}`);
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
    if (!invoice) return;
    if (isRefillOnlyInvoice) {
      setClasses([]);
      initialClassesFetchedRef.current = true;
      setClassesLoading(false);
      return;
    }

    const dynamicItems = Array.isArray(invoice?.dynamicClasses?.items)
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
        const eligibleForCoverage = deriveClassEligibility(
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
  }, [classes, maxHours, endDateBoundary]);

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

  const actualHoursDisplay = useMemo(() => formatHoursValue(totalMinutes / 60), [totalMinutes, formatHoursValue]);
  const actualHoursBreakdown = useMemo(() => {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
    const wholeHours = Math.floor(totalMinutes / 60);
    const remainder = totalMinutes - wholeHours * 60;
    let roundedMinutes = Math.round(remainder);
    let adjustedHours = wholeHours;

    if (roundedMinutes === 60) {
      adjustedHours += 1;
      roundedMinutes = 0;
    }

    return { hours: adjustedHours, minutes: roundedMinutes };
  }, [totalMinutes]);

  const actualHoursReadable = useMemo(() => {
    if (!actualHoursBreakdown) return null;
    const minutes = String(actualHoursBreakdown.minutes).padStart(2, '0');
    return `${actualHoursBreakdown.hours}h ${minutes}m`;
  }, [actualHoursBreakdown]);

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

  useEffect(() => {
    if (userModifiedFiltersRef.current) return;
    const hasCap = maxHours !== '' && maxHours !== null && maxHours !== undefined;
    if (!hasCap) return;

    const numericMax = Number(maxHours);
    if (!Number.isFinite(numericMax) || numericMax <= 0) return;

    const actualHours = totalMinutes / 60;
    if (!Number.isFinite(actualHours) || actualHours <= 0) return;

    const roundedActual = Math.round(actualHours * 100) / 100;
    const normalizedActualString = formatHoursValue(roundedActual);
    if (!normalizedActualString) return;

    const normalizedActual = Number(normalizedActualString);
    if (!Number.isFinite(normalizedActual) || normalizedActual <= 0) return;

    const diff = Math.abs(normalizedActual - numericMax);
    if (diff > 0.005) {
      setMaxHours(normalizedActualString);
    }
  }, [totalMinutes, maxHours, formatHoursValue]);

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

  // Keep the classes table area a fixed, scrollable region to avoid layout
  // shifts when the number of classes changes (which caused the modal to
  // visually jump up/down). Use a sensible min/max height so small lists
  // still look compact while longer lists scroll.
  const classTableOuterClasses = 'flex-1 overflow-hidden';
  const classTableInnerClasses = 'overflow-y-auto overflow-x-hidden rounded-b-3xl';
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
    doc.text(`Invoice #${invoice.invoiceNumber}`, 14, 38);
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

    doc.save(`Invoice-${invoice.invoiceNumber}.pdf`);
  };

  // Excel
  const downloadExcel = () => {
    if (!invoice) return;

    const studentLines = Object.entries(studentSummary).map(
      ([name, { count, hours }]) => [`${name}: ${count} classes ${(hours / 60).toFixed(2)} hrs`]
    );

    const worksheetData = [
      ['Invoice #', invoice.invoiceNumber],
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
    XLSX.writeFile(workbook, `Invoice-${invoice.invoiceNumber}.xlsx`);
  };

  const handleSaveCoverage = useCallback(async () => {
    const targetInvoiceId = invoice?._id || resolvedInvoiceId;
    if (!targetInvoiceId) return;
    setSavingCoverage(true);
    let succeeded = false;

    try {
      const strategyValue = maxHours ? 'cap_hours' : customEndDate ? 'custom_end' : 'full_period';

      let parsedMaxHours = null;
      if (maxHours !== '' && maxHours !== null && maxHours !== undefined) {
        const numeric = Number(maxHours);
        if (Number.isFinite(numeric) && numeric >= 0) {
          parsedMaxHours = numeric;
        }
      }

      const payload = {
        strategy: strategyValue,
        maxHours: parsedMaxHours,
        endDate: customEndDate || null,
        waiveTransferFee: Boolean(waiveTransferFee),
        // ✅ Send the calculated totals so they get persisted (use the memoized previewTotals)
        previewTotals: previewTotals
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
      coverageLastSavedRef.current = {
        maxHours: maxHours || '',
        customEndDate: customEndDate || '',
        waiveTransferFee: Boolean(waiveTransferFee)
      };
      setCoverageStatus({ type: 'success', message: 'saved' });
      succeeded = true;
    } catch (err) {
      console.error('Coverage update failed:', err);
      const message = err?.response?.data?.message || 'Failed to update coverage settings';
      setCoverageStatus({ type: 'error', message });
    } finally {
      setSavingCoverage(false);
      if (succeeded) {
        setTimeout(() => setCoverageStatus(null), 2000);
      }
    }
  }, [resolvedInvoiceId, invoice, maxHours, customEndDate, waiveTransferFee, syncInvoiceState, previewTotals]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!invoice && !resolvedInvoiceId) return;

    if (skipNextCoverageSave.current) {
      skipNextCoverageSave.current = false;
      return;
    }

    if (savingCoverage) return;

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
  }, [isAdmin, resolvedInvoiceId, maxHours, customEndDate, waiveTransferFee, handleSaveCoverage, savingCoverage]);

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
        internalNotes: noteEdits.internalNotes
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
        internalNotes: (updatedInvoice?.internalNotes ?? noteEdits.internalNotes) || ''
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

  useEffect(() => {
    if (!invoice) return;
    if (skipNextNotesSave.current) {
      skipNextNotesSave.current = false;
      return;
    }

    const last = notesLastSavedRef.current;
    if (noteEdits.notes === last.notes && noteEdits.internalNotes === last.internalNotes) return;

    if (savingNotes) return;

    setNotesStatus({ type: 'progress', message: 'Saving…' });
    const timer = setTimeout(() => {
      handleSaveNotes();
    }, 600);

    return () => clearTimeout(timer);
  }, [noteEdits.notes, noteEdits.internalNotes, invoice, handleSaveNotes, savingNotes]);

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
          setInvoice((prev) => (prev ? { ...prev, ...updated } : updated));

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
                const localMax = maxHours !== '' && maxHours !== null && maxHours !== undefined ? Number(maxHours) : null;
                const persistedMax = refetched.coverage && typeof refetched.coverage.maxHours === 'number' ? refetched.coverage.maxHours : null;
                const localEnd = customEndDate || null;
                const persistedEnd = refetched.coverage && refetched.coverage.endDate ? refetched.coverage.endDate : null;
                const localWaive = Boolean(waiveTransferFee);
                const persistedWaive = Boolean(refetched.coverage && refetched.coverage.waiveTransferFee);

                const maxDiffers = (localMax === null && persistedMax !== null) || (localMax !== null && persistedMax === null) || (localMax !== null && persistedMax !== null && Math.abs(localMax - persistedMax) > 0.0001);
                const endDiffers = (localEnd || '') !== (persistedEnd || '');
                const waiveDiffers = localWaive !== persistedWaive;

                if (maxDiffers || endDiffers || waiveDiffers) {
                  const strategyValue = maxHours ? 'cap_hours' : customEndDate ? 'custom_end' : 'full_period';
                  const parsedMaxHours = Number.isFinite(Number(maxHours)) ? Number(maxHours) : null;
                  const coveragePayload = {
                    strategy: strategyValue,
                    maxHours: parsedMaxHours,
                    endDate: customEndDate || null,
                    waiveTransferFee: Boolean(waiveTransferFee),
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

  if (loading) return <LoadingSpinner />;
  if (!invoice) return <div className="p-4 text-center">Invoice not found</div>;

  const statusTone = (() => {
    switch (invoice.status) {
      case 'paid':
        return 'bg-emerald-500/20 text-emerald-900 ring-1 ring-emerald-500/30';
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
      <div className="relative w-full max-w-6xl overflow-hidden rounded-[32px] bg-white shadow-2xl">
        <button
          onClick={handleClose}
          className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/70 text-slate-500 shadow hover:text-slate-900"
          aria-label="Close invoice modal"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="space-y-8">
          <div className="border-b border-slate-200 bg-white/95 px-8 py-8">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Invoice overview</p>
                <h2 className="text-3xl font-semibold text-slate-900 flex items-center gap-3">
                  {invoice.invoiceName || `Invoice ${invoice.invoiceNumber}`}
                  <span className="text-xs rounded-full border border-slate-200 bg-white px-2 py-0.5 text-slate-500" title={`System ID: ${invoice.invoiceNumber || invoice._id}`}>{getReadableInvoiceId(invoice)}</span>
                </h2>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusTone}`} title={getStatusTooltip(invoice.status)} aria-label={getStatusTooltip(invoice.status)}>
                    <Sparkles className="h-4 w-4" />
                    {invoice.status}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <Users className="h-4 w-4 text-slate-500" />
                    <span className="font-medium text-slate-700">{invoice.guardian?.firstName} {invoice.guardian?.lastName}</span>
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1">
                    <Calendar className="h-4 w-4 text-slate-500" />
                    <span>{formatDateDisplay(invoice.createdAt)}</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                <div className="flex flex-wrap gap-2">
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
                  {invoice?.invoiceSlug && (
                    <button
                      onClick={handleCopyShareLink}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                      type="button"
                    >
                      <Link2 className="h-4 w-4" />
                      <span>Copy share link</span>
                    </button>
                  )}
                  <button
                    onClick={downloadPDF}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                    type="button"
                  >
                    <FileText className="h-4 w-4" />
                    <span>Download PDF</span>
                  </button>
                  <button
                    onClick={downloadExcel}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
                    type="button"
                  >
                    <FileDown className="h-4 w-4" />
                    <span>Export Excel</span>
                  </button>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
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

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <div className="mt-2 space-y-2">
                      <div>
                        <p className="text-2xl font-semibold text-slate-900">${amount.toFixed(2)}</p>
                        <p className="text-xs uppercase tracking-wide text-slate-400">Invoice total</p>
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
                            <p className="text-xs text-slate-500">
                              Tip will be distributed equally between teachers after applicable transfer fees.
                            </p>
                          </>
                        )}
                        <div className="flex justify-between pt-2">
                          <span>Paid</span>
                          <span>${paidAmount.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-slate-900">
                          <span>Remaining</span>
                          <span>${remainingBalance.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
                        {isRefillOnlyInvoice ? (
                          <p className="text-slate-600">Hour refill purchase — no classes yet</p>
                        ) : (
                          <>
                            <p>Classes: <span className="font-medium text-slate-900">{filteredClasses.length}</span></p>
                            <p>Total hours: <span className="font-medium text-slate-900">{totalHours.toFixed(2)}</span></p>
                            <p>Hourly rate: <span className="font-medium text-slate-900">${guardianRate.toFixed(2)}</span></p>
                          </>
                        )}
                      </div>
                    </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-2 text-xs tracking-wide text-slate-500">
                    <p className="font-semibold uppercase text-slate-500">Classes &amp; coverage</p>
                    <div className="flex flex-wrap items-center gap-3 text-slate-500">
                      {!isRefillOnlyInvoice ? (
                        <div className="flex flex-col text-[13px] leading-tight">
                          <span className="font-semibold text-slate-900">{filteredClasses.length} classes</span>
                          <span className="text-slate-600">{subtotalHoursDisplay}h at ${guardianRate.toFixed(2)} / hr</span>
                        </div>
                      ) : (
                        <div className="flex flex-col text-[13px] leading-tight">
                          <span className="font-semibold text-slate-900">No classes yet</span>
                          <span className="text-slate-600">Hour refill only</span>
                        </div>
                      )}
                      {/* Only admins can view or edit the waive-transfer-fee control */}
                      {isAdmin && (
                        <label className="inline-flex shrink-0 items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium normal-case text-slate-600">
                          <input
                            type="checkbox"
                            checked={waiveTransferFee}
                            onChange={(e) => setWaiveTransferFee(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                          />
                          <span>Transfer Fees</span>
                        </label>
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
                  <div className="mt-4 space-y-4 text-sm text-slate-600">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
                        <span>Max class hours</span>
                        <input
                          type="number"
                          value={maxHours}
                          onChange={(e) => {
                            const value = e.target.value;
                            userModifiedFiltersRef.current = true; // Track user modification
                            setMaxHours(value);
                            if (value !== '' && value !== null && value !== undefined) {
                              setCustomEndDate('');
                            }
                          }}
                          placeholder="e.g. 10"
                          className="rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        />
                        
                      </label>
                      <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
                        <span>End Date</span>
                        <input
                          type="date"
                          value={customEndDate}
                          onChange={(e) => {
                            const value = e.target.value;
                            userModifiedFiltersRef.current = true; // Track user modification
                            setCustomEndDate(value);
                            if (value) {
                              setMaxHours('');
                            }
                          }}
                          className="rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-700 shadow-inner focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                        />
                      </label>
                    </div>
                    
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Internal Admin Note</span>
                      <textarea
                        value={noteEdits.internalNotes}
                        onChange={(e) => handleNoteChange('internalNotes', e.target.value)}
                        rows={1}
                        placeholder="Private context for the admin team..."
                        className="min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-relaxed text-slate-700 shadow-inner placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 resize-y"
                      />
                    </label>
                  </div>
                )}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Guardian</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {invoice.guardian?.firstName} {invoice.guardian?.lastName}
                </p>
                <p className="text-sm text-slate-600">{invoice.guardian?.email || '—'}</p>
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Students</p>
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    {Object.entries(studentSummary).map(([name, { count, hours }]) => (
                      <div key={name} className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{name}</span>
                        <span className="text-slate-500">• {count} cls • {(hours / 60).toFixed(1)}h</span>
                      </div>
                    ))}
                    {Object.keys(studentSummary).length === 0 && (
                      <p className="text-slate-500">No classes recorded</p>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Guardian Note</p>
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
                    <textarea
                      value={noteEdits.notes}
                      onChange={(e) => handleNoteChange('notes', e.target.value)}
                      rows={1}
                      placeholder="Visible to guardians on their invoice..."
                      className="mt-1.5 min-h-[38px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-700 shadow-inner placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200 resize-y"
                    />
                  ) : (
                    <div className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-relaxed text-slate-600">
                      {noteEdits.notes?.trim() ? formatNoteText(noteEdits.notes) : <span className="text-slate-400">No guardian note yet.</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {!isRefillOnlyInvoice && (
            <div className="px-8 pb-8">
              <div className="flex h-full w-full flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                  <h3 className="text-base font-semibold text-slate-900">Class sessions</h3>
                  <span className="text-xs uppercase tracking-wide text-slate-400">
                    {classesLoading ? 'Refreshing…' : `${filteredClasses.length} entries`}
                  </span>
                </div>
                {filteredClasses.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center px-5 py-12 text-center text-sm text-slate-500">
                    No classes available for this invoice.
                  </div>
                ) : (
                  <div className={classTableOuterClasses}>
                    <div className={classTableInnerClasses} style={classTableInnerStyle}>
                      <table className="min-w-full table-fixed divide-y divide-slate-100 text-sm">
                        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="sticky top-0 z-10 w-12 bg-slate-50/95 px-5 py-3 text-center backdrop-blur">#</th>
                            <th className="sticky top-0 z-10 bg-slate-50/95 px-5 py-3 backdrop-blur">Date &amp; time</th>
                            <th className="sticky top-0 z-10 bg-slate-50/95 px-5 py-3 backdrop-blur">Student</th>
                            <th className="sticky top-0 z-10 bg-slate-50/95 px-5 py-3 backdrop-blur">Teacher</th>
                            <th className="sticky top-0 z-10 bg-slate-50/95 px-5 py-3 backdrop-blur">Subject</th>
                            <th className="sticky top-0 z-10 bg-slate-50/95 px-5 py-3 backdrop-blur">Duration (mins)</th>
                            <th className="sticky top-0 z-10 bg-slate-50/95 px-5 py-3 backdrop-blur">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-slate-600">
                          {filteredClasses.map((c, index) => (
                            <tr key={c._id} className={`odd:bg-white even:bg-slate-50/60 ${c.paidByGuardian ? 'outline outline-1 outline-emerald-100' : ''}`}>
                              <td className="px-5 py-3 text-center text-slate-500">{index + 1}</td>
                              <td className="px-5 py-3 text-slate-700 whitespace-normal break-words">{`${c.date} ${c.time}`}</td>
                              <td className="px-5 py-3 text-slate-700 whitespace-normal break-words">{c.studentName}</td>
                              <td className="px-5 py-3 whitespace-normal break-words">{c.teacherName}</td>
                              <td className="px-5 py-3 whitespace-normal break-words">{c.subject}</td>
                              <td className="px-5 py-3 whitespace-normal break-words">{c.duration}</td>
                              <td className="px-5 py-3 whitespace-normal break-words">
                                <span className="inline-flex items-center gap-2">
                                  <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium capitalize text-slate-600">
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
  );
};

export default InvoiceViewModal;