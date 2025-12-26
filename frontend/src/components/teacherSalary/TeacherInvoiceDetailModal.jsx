/**
 * Teacher Invoice Detail Modal - Clean & Simplified
 * Similar to guardian invoice modal style
 */

import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import LoadingSpinner from '../ui/LoadingSpinner';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import PrimaryButton from '../ui/PrimaryButton';
import { formatDateDDMMMYYYY } from '../../utils/date';
import {
  X,
  Download,
  FileText,
  Calendar,
  DollarSign,
  Clock,
  AlertCircle,
  Check,
  Users,
  ArrowRightLeft,
  Wallet,
  FileSpreadsheet,
  Info,
  Edit3,
  Save
} from 'lucide-react';

const TeacherInvoiceDetailModal = ({ invoiceId, onClose, onUpdate }) => {
  const { user } = useAuth();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [editedValues, setEditedValues] = useState({
    grossAmountUSD: '',
    bonusesUSD: '',
    extrasUSD: '',
    totalUSD: '',
    grossAmountEGP: '',
    bonusesEGP: '',
    extrasEGP: '',
    totalEGP: '',
    exchangeRate: '',
    transferFeeEGP: '',
    netAmountEGP: ''
  });

  // Fetch invoice details
  useEffect(() => {
    if (!invoiceId) return;

    const fetchInvoice = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Use different endpoints based on user role
        const endpoint = user?.role === 'admin' 
          ? `/teacher-salary/admin/invoices/${invoiceId}`
          : `/teacher-salary/teacher/invoices/${invoiceId}`;
          
        const response = await api.get(endpoint);
        // If server returned classes but student names are missing, try to rebuild
        // a classes array from `invoice.items` (same approach used in InvoiceViewModal)
        const rawInv = response.data.invoice;
        let finalInvoice = rawInv;

        try {
          const hasClasses = Array.isArray(rawInv?.classes) && rawInv.classes.length > 0;
          const classesHaveNames = hasClasses && rawInv.classes.some(c => c && (c.studentName || c.student || c.studentEmail));

          if (!classesHaveNames && Array.isArray(rawInv?.items) && rawInv.items.length > 0) {
            const rebuilt = rawInv.items.map((item, idx) => {
              const liveClass = item && item.class && typeof item.class === 'object' ? item.class : null;
              const studentSnapshot = item.studentSnapshot
                || liveClass?.student
                || item.class?.student
                || (typeof item.student === 'object' ? item.student : {})
                || {};
              const rawStudentName = studentSnapshot.studentName || `${studentSnapshot.firstName || ''} ${studentSnapshot.lastName || ''}`.trim();
              const studentName = rawStudentName && rawStudentName.trim().length ? rawStudentName.trim() : undefined;
              const dateSource = liveClass?.dateTime || liveClass?.scheduledDate || item.date || item.scheduledDate || null;
              const durationMinutes = Number.isFinite(Number(liveClass?.duration)) ? Number(liveClass.duration) : Number(item.duration || 0);
              const subject = liveClass?.subject || item.subject || item.description || '-';
              const rawId = liveClass?._id || item.class?._id || item._id || `item-${idx}-${Date.now()}`;

              return {
                _id: rawId,
                // keep raw date value so formatting is handled consistently by formatDateWithDay
                date: dateSource || item.date || liveClass?.date || null,
                // include full snapshot so other consumers can read more fields
                studentSnapshot,
                studentName,
                subject,
                status: liveClass?.status || item.status || 'scheduled',
                hours: (durationMinutes || 0) / 60,
                duration: durationMinutes || 0
              };
            }).filter(Boolean);

            finalInvoice = { ...rawInv, classes: rebuilt };
          }
        } catch (e) {
          // ignore rebuild errors and fall back to raw invoice
          finalInvoice = rawInv;
        }

        setInvoice(finalInvoice);
        
        // Initialize edited values with current invoice values (for admin override)
        setEditedValues({
          grossAmountUSD: finalInvoice.grossAmountUSD || '',
          bonusesUSD: finalInvoice.bonusesUSD || '',
          extrasUSD: finalInvoice.extrasUSD || '',
          totalUSD: finalInvoice.totalUSD || '',
          grossAmountEGP: finalInvoice.grossAmountEGP || '',
          bonusesEGP: finalInvoice.bonusesEGP || '',
          extrasEGP: finalInvoice.extrasEGP || '',
          totalEGP: finalInvoice.totalEGP || '',
          exchangeRate: finalInvoice.exchangeRateSnapshot?.rate || '',
          transferFeeEGP: finalInvoice.transferFeeEGP || '',
          netAmountEGP: finalInvoice.netAmountEGP || ''
        });
      } catch (err) {
        console.error('Error fetching invoice:', err);
        setError(err.response?.data?.message || 'Failed to load invoice');
      } finally {
        setLoading(false);
      }
    };

    fetchInvoice();
  }, [invoiceId, user]);

  // Format currency
  const formatCurrency = (amount, currency = 'EGP') => {
    const value = Number(amount) || 0;
    return currency === 'USD' ? `$${value.toFixed(2)}` : `${value.toFixed(2)} EGP`;
  };

  // Get status info
  const getStatusInfo = (status) => {
    const statusMap = {
      draft: { color: 'bg-gray-100 text-gray-700 border-gray-300', icon: FileText, label: 'Draft' },
      published: { color: 'bg-blue-100 text-blue-700 border-blue-300', icon: Check, label: 'Published' },
      paid: { color: 'bg-green-100 text-green-700 border-green-300', icon: Check, label: 'Paid' },
      archived: { color: 'bg-purple-100 text-purple-700 border-purple-300', icon: FileText, label: 'Archived' }
    };
    return statusMap[status] || statusMap.draft;
  };

  // Format date with day
  const formatDateWithDay = (date) => {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  // Format month/year for invoice period
  const formatInvoicePeriod = (month, year) => {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[month - 1]} ${year}`;
  };

  // Export handlers
  const handleExportPDF = () => alert('PDF export coming soon!');
  const handleExportExcel = () => alert('Excel export coming soon!');

  // Handle save overrides
  const handleSaveOverrides = async () => {
    try {
      setSaving(true);
      setError(null);

      const overrides = {};
      Object.keys(editedValues).forEach(key => {
        const val = editedValues[key];
        if (val !== '' && val !== null && val !== undefined) {
          overrides[key] = Number(val);
        }
      });

      await api.post(`/teacher-salary/admin/invoices/${invoiceId}/overrides`, { overrides });

      setEditMode(false);
      
      // Refresh invoice
      const endpoint = user?.role === 'admin' 
        ? `/teacher-salary/admin/invoices/${invoiceId}`
        : `/teacher-salary/teacher/invoices/${invoiceId}`;
      const response = await api.get(endpoint);
      setInvoice(response.data.invoice);

      if (onUpdate) {
        onUpdate();
      }
    } catch (err) {
      console.error('Error saving overrides:', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to save overrides');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50/60 backdrop-blur-sm">
        <LoadingSpinner fullScreen text="Loading invoice…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50/60 backdrop-blur-sm px-4 py-8">
        <Card className="max-w-md w-full">
          <div className="flex items-center gap-3 text-rose-600 mb-4">
            <AlertCircle className="w-8 h-8" />
            <h3 className="text-xl font-semibold">Error</h3>
          </div>
          <p className="text-sm text-slate-600 mb-6">{error}</p>
          <PrimaryButton onClick={onClose} className="w-full" variant="subtle">Close</PrimaryButton>
        </Card>
      </div>
    );
  }

  if (!invoice) return null;

  const statusInfo = getStatusInfo(invoice.status);
  const StatusIcon = statusInfo.icon;
  const totalHours = invoice.totalHours || 0;
  const hourlyRate = invoice.rateSnapshot?.rate || 0;
  const classes = invoice.classes || [];
  
  // Format student display name defensively to avoid showing "undefined undefined"
  const formatStudentName = (cls) => {
    // Mirror InvoiceViewModal behavior: prefer a trimmed studentName string
    // then fall back to nested student snapshot fields. Also sanitize common
    // literal tokens like 'undefined' or 'null' coming from bad snapshots.
    if (!cls) return '—';

    const sanitize = (val) => {
      if (!val && val !== 0) return '';
      const s = String(val).trim();
      // remove literal words that sometimes appear in broken payloads
      return s.replace(/\b(undefined|null)\b/gi, '').replace(/\s+/g, ' ').trim();
    };

    // Prefer explicit studentName string (but treat literal 'undefined'/'null' as empty)
    const rawStudentName = sanitize(cls.studentName || cls.studentSnapshot?.studentName);
    if (rawStudentName.length) return rawStudentName;

    // If server accidentally wrote literal tokens like 'undefined undefined', try other sources
    // Try invoice.classIds (server-side mapping) to find richer snapshot by matching _id
    try {
      if (invoice && Array.isArray(invoice.classIds) && cls && cls._id) {
        const match = invoice.classIds.find(ci => String(ci._id) === String(cls._id));
        if (match) {
          const via = match.studentSnapshot || match.student || match.studentInfo || match;
          const cand = sanitize(via.studentName || `${via.firstName || ''} ${via.lastName || ''}`);
          if (cand.length) return cand;
        }
      }
    } catch (e) {
      // ignore and continue
    }

    // Try nested student snapshot (common shapes)
    const studentSnapshot = cls.studentSnapshot || cls.student || cls.studentInfo || cls.studentDetails || {};
    const candidate = `${studentSnapshot.firstName || ''} ${studentSnapshot.lastName || ''}`.trim();
    const studentNameFromSnapshot = sanitize(candidate) || sanitize(studentSnapshot.name || '');
    if (studentNameFromSnapshot.length) return studentNameFromSnapshot;

    // Fallbacks: guardian/parent fields that sometimes carry the student name
    if (cls.guardianName) return sanitize(cls.guardianName);
    if (cls.parentName) return sanitize(cls.parentName);
    if (cls.guardian && (cls.guardian.name || cls.guardian.fullName)) return sanitize(cls.guardian.name || cls.guardian.fullName);
    if (cls.parent && (cls.parent.name || cls.parent.fullName)) return sanitize(cls.parent.name || cls.parent.fullName);

    // Fallbacks: email-like fields
    if (cls.studentEmail) return sanitize(cls.studentEmail);
    if (cls.email) return sanitize(cls.email);

    return '—';
  };
  
  // Format rate tier description
  const getRateTierDescription = (partition) => {
    if (!partition) return 'Standard Rate';
    return partition;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[32px] max-w-5xl w-full max-h-[95vh] overflow-hidden flex flex-col shadow-2xl ring-1 ring-black/5">
        
        {/* Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-200">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-blue-500 rounded-xl shadow-lg">
                <FileText className="w-7 h-7 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-2xl font-semibold text-slate-900 flex items-center gap-3">
                    <span>Invoice {invoice.invoiceNumber || '—'}</span>
                    <Badge tone={invoice.status === 'paid' ? 'success' : invoice.status === 'published' ? 'brand' : 'neutral'} pill>
                      <StatusIcon className="w-3.5 h-3.5" /> {statusInfo.label}
                    </Badge>
                  </h2>
                </div>
                <div className="flex items-center gap-4 text-sm text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4" />
                    <span className="font-medium">
                      {invoice.teacher?.firstName} {invoice.teacher?.lastName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-4 h-4" />
                    <span>{formatInvoicePeriod(invoice.month, invoice.year)}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PrimaryButton onClick={handleExportPDF} variant="subtle" size="sm" title="PDF" circle>
                <Download className="w-5 h-5" />
              </PrimaryButton>
              <PrimaryButton onClick={handleExportExcel} variant="subtle" size="sm" title="Excel" circle>
                <FileSpreadsheet className="w-5 h-5" />
              </PrimaryButton>
              <PrimaryButton onClick={() => setDebugOpen(d => !d)} variant="subtle" size="sm" title="Debug">
                Debug
              </PrimaryButton>
              <PrimaryButton onClick={onClose} variant="subtle" size="sm" title="Close" circle>
                <X className="w-5 h-5" />
              </PrimaryButton>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card padding="md" className="rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Total Hours</span>
                <Clock className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900">{totalHours.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-1">{classes.length} classes</p>
            </Card>
            
            <Card padding="md" className="rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Hourly Rate (USD)</span>
                <DollarSign className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900">${hourlyRate.toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-1">
                {getRateTierDescription(invoice.rateSnapshot?.partition)}
              </p>
              <p className="text-xs text-blue-600 mt-1 font-medium">
                Based on {totalHours.toFixed(2)}h this month
              </p>
            </Card>

            <Card padding="md" className="rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-500 uppercase">Exchange Rate</span>
                <ArrowRightLeft className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-900">{(invoice.exchangeRateSnapshot?.rate || 1).toFixed(2)}</p>
              <p className="text-xs text-slate-500 mt-1">EGP per USD</p>
            </Card>
            
            <Card padding="md" className="rounded-xl bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-green-700 uppercase">Net Amount (EGP)</span>
                <Wallet className="w-4 h-4 text-green-600" />
              </div>
              <p className="text-2xl font-bold text-green-700">{formatCurrency(invoice.netAmountEGP, 'EGP')}</p>
              <p className="text-xs text-green-600 mt-1">After transfer fee</p>
            </Card>
          </div>
        </div>

        {/* Payment Info */}
          {invoice.status === 'paid' && invoice.paidAt && (
            <Card className="bg-green-50 rounded-xl p-5 border border-green-200 flex items-start gap-3">
              <div className="p-2 bg-green-500 rounded-lg">
                <Check className="w-5 h-5 text-white" />
              </div>
              <div>
                <h4 className="font-semibold text-green-900 mb-1">Payment Confirmed</h4>
                <p className="text-sm text-green-800">
                  Paid on {formatDateDDMMMYYYY(invoice.paidAt)}
                  {invoice.paymentMethod && ` via ${invoice.paymentMethod}`}
                </p>
              </div>
            </Card>
        )}
        
        {/* Content - Classes Table */}
        <div className="flex-1 overflow-y-auto p-6">
        {/* Financial Breakdown (compact) */}
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-3 border border-blue-200 shadow-sm mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">Financial Summary</h3>
              </div>
              {user?.role === 'admin' && !editMode && (
                <button
                  onClick={() => setEditMode(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                >
                  <Edit3 className="w-3 h-3" />
                  Edit
                </button>
              )}
              {user?.role === 'admin' && editMode && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditMode(false)}
                    className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveOverrides}
                    disabled={saving}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <LoadingSpinner className="w-3 h-3" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-3 h-3" />
                        Save
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Rate Explanation (compact) */}
            <div className="bg-blue-100 border border-blue-300 rounded-md p-2 mb-2 text-sm text-blue-900">
              <strong className="font-semibold">Rate Calculation:</strong> based on this month's hours <strong className="font-bold">({totalHours.toFixed(2)} hrs)</strong>.
              {editMode && <span className="ml-2 text-xs italic">(Click values below to edit)</span>}
            </div>

            <div className="space-y-2 bg-white rounded-md p-3 text-sm">
              <div className="flex items-center justify-between py-1">
                <span className="text-slate-700">Base Salary (USD)</span>
                {editMode ? (
                  <input
                    type="number"
                    step="0.01"
                    value={editedValues.grossAmountUSD}
                    onChange={(e) => setEditedValues(prev => ({ ...prev, grossAmountUSD: e.target.value }))}
                    className="w-24 px-2 py-1 text-right border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 font-semibold text-slate-900"
                  />
                ) : (
                  <span className="font-semibold text-slate-900">${(totalHours * hourlyRate).toFixed(2)}</span>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-slate-600 py-1 border-t border-slate-200 pt-2">
                <span className="italic">{totalHours.toFixed(2)} hrs × ${hourlyRate.toFixed(2)}/hr</span>
                <span />
              </div>

              {invoice.exchangeRateSnapshot && (
                <>
                  <div className="flex items-center justify-between py-1 border-t border-slate-200">
                    <span className="text-slate-700">Converted to EGP</span>
                    {editMode ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editedValues.grossAmountEGP}
                        onChange={(e) => setEditedValues(prev => ({ ...prev, grossAmountEGP: e.target.value }))}
                        className="w-32 px-2 py-1 text-right border border-blue-300 rounded focus:ring-2 focus:ring-blue-500 font-semibold text-slate-900"
                      />
                    ) : (
                      <span className="font-semibold text-slate-900">{formatCurrency(invoice.grossAmountEGP, 'EGP')}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600 py-1">
                    <span className="italic">Rate: {editMode ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editedValues.exchangeRate}
                        onChange={(e) => setEditedValues(prev => ({ ...prev, exchangeRate: e.target.value }))}
                        className="w-20 px-1 py-0.5 text-center border border-blue-300 rounded focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <>{invoice.exchangeRateSnapshot.rate?.toFixed(2)}</>
                    )} EGP/USD</span>
                    <span />
                  </div>
                </>
              )}

              {(invoice.bonusesEGP && invoice.bonusesEGP > 0) && (
                <>
                  <div className="flex items-center justify-between py-1 border-t border-slate-200 text-amber-700">
                    <span className="font-medium">Bonuses</span>
                    {editMode ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editedValues.bonusesEGP}
                        onChange={(e) => setEditedValues(prev => ({ ...prev, bonusesEGP: e.target.value }))}
                        className="w-32 px-2 py-1 text-right border border-amber-300 rounded focus:ring-2 focus:ring-amber-500 font-semibold text-amber-700"
                      />
                    ) : (
                      <span className="font-semibold">+ {formatCurrency(invoice.bonusesEGP, 'EGP')}</span>
                    )}
                  </div>
                  {Array.isArray(invoice.bonuses) && invoice.bonuses.length > 0 && (
                    <div className="flex flex-col gap-1 py-1 text-xs text-slate-600">
                      {invoice.bonuses.map((bonus, idx) => {
                        const guardianName = bonus.guardianName || (bonus.guardianId ? `${bonus.guardianId.firstName || ''} ${bonus.guardianId.lastName || ''}`.trim() : null);
                        return (
                          <div key={bonus._id || idx} className="flex items-center justify-between pl-4">
                            <span className="italic">
                              {bonus.source === 'guardian' && guardianName ? (
                                <>{guardianName}</>
                              ) : bonus.source === 'admin' ? (
                                <>Admin</>
                              ) : (
                                <>{bonus.source || 'Unknown'}</>
                              )}
                              {bonus.reason && ` — ${bonus.reason}`}
                            </span>
                            <span className="font-medium">${Number(bonus.amountUSD || 0).toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {(invoice.extrasEGP && invoice.extrasEGP > 0) && (
                <div className="flex items-center justify-between py-1 border-t border-slate-200 text-indigo-700">
                  <span className="font-medium">Extras</span>
                  {editMode ? (
                    <input
                      type="number"
                      step="0.01"
                      value={editedValues.extrasEGP}
                      onChange={(e) => setEditedValues(prev => ({ ...prev, extrasEGP: e.target.value }))}
                      className="w-32 px-2 py-1 text-right border border-indigo-300 rounded focus:ring-2 focus:ring-indigo-500 font-semibold text-indigo-700"
                    />
                  ) : (
                    <span className="font-semibold">+ {formatCurrency(invoice.extrasEGP, 'EGP')}</span>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-300">
                <span className="font-semibold text-slate-900">Subtotal (EGP)</span>
                {editMode ? (
                  <input
                    type="number"
                    step="0.01"
                    value={editedValues.totalEGP}
                    onChange={(e) => setEditedValues(prev => ({ ...prev, totalEGP: e.target.value }))}
                    className="w-32 px-2 py-1 text-right border border-slate-400 rounded focus:ring-2 focus:ring-slate-600 font-bold text-slate-900"
                  />
                ) : (
                  <span className="font-bold text-slate-900">{formatCurrency(invoice.totalEGP, 'EGP')}</span>
                )}
              </div>

              {(invoice.transferFeeEGP && invoice.transferFeeEGP > 0) && (
                <>
                  <div className="flex items-center justify-between py-1 border-t border-slate-200 text-red-700">
                    <span className="">Transfer Fee</span>
                    {editMode ? (
                      <input
                        type="number"
                        step="0.01"
                        value={editedValues.transferFeeEGP}
                        onChange={(e) => setEditedValues(prev => ({ ...prev, transferFeeEGP: e.target.value }))}
                        className="w-32 px-2 py-1 text-right border border-red-300 rounded focus:ring-2 focus:ring-red-500 font-semibold text-red-700"
                      />
                    ) : (
                      <span className="font-semibold">- {formatCurrency(invoice.transferFeeEGP, 'EGP')}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600 py-1">
                    <span className="italic">{invoice.transferFeeSnapshot?.model === 'flat' ? 'Flat fee' : 'Percentage fee'}</span>
                    <span />
                  </div>
                </>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-green-600">
                <span className="text-base font-bold text-slate-900">Net Amount (EGP)</span>
                {editMode ? (
                  <input
                    type="number"
                    step="0.01"
                    value={editedValues.netAmountEGP}
                    onChange={(e) => setEditedValues(prev => ({ ...prev, netAmountEGP: e.target.value }))}
                    className="w-40 px-2 py-1 text-right border-2 border-green-600 rounded focus:ring-2 focus:ring-green-700 text-xl font-bold text-green-600"
                  />
                ) : (
                  <span className="text-xl font-bold text-green-600">{formatCurrency(invoice.netAmountEGP, 'EGP')}</span>
                )}
              </div>
            </div>
          </Card>

          
          {/* Classes Section (compact) */}
          <Card className="rounded-lg overflow-hidden shadow-sm mb-4 p-0">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-blue-100 rounded-md">
                  <Calendar className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Classes</h3>
                  <p className="text-xs text-slate-500">{classes.length} classes • {totalHours.toFixed(2)} hrs</p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              {classes.length > 0 ? (
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Date</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Student</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold text-slate-600 uppercase">Subject</th>
                      <th className="px-2 py-2 text-center text-xs font-semibold text-slate-600 uppercase">Status</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-slate-600 uppercase">Duration</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold text-slate-600 uppercase">Amount (USD)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {classes.map((cls, index) => {
                      const hours = cls.hours || 0;
                      const amount = hours * hourlyRate;
                      return (
                        <tr key={cls._id || index} className="hover:bg-slate-50 transition-colors">
                          <td className="px-2 py-2 text-sm text-slate-700 whitespace-nowrap">{formatDateWithDay(cls.date)}</td>
                          <td className="px-2 py-2 text-sm font-medium text-slate-900">{formatStudentName(cls)}</td>
                          <td className="px-2 py-2 text-sm text-slate-700">{cls.subject || '-'}</td>
                          <td className="px-2 py-2 text-center">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                              cls.status === 'attended' ? 'bg-green-100 text-green-700' :
                              cls.status === 'absent' ? 'bg-red-100 text-red-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {cls.status || 'scheduled'}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right text-sm text-slate-700 whitespace-nowrap">{hours.toFixed(2)} hrs</td>
                          <td className="px-2 py-2 text-right text-sm font-semibold text-slate-900 whitespace-nowrap">${amount.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t border-slate-300">
                    <tr>
                      <td colSpan="4" className="px-2 py-2 text-sm font-bold text-slate-900 text-right">Total</td>
                      <td className="px-2 py-2 text-right text-sm font-bold text-slate-900 whitespace-nowrap">{totalHours.toFixed(2)} hrs</td>
                      <td className="px-2 py-2 text-right text-sm font-bold text-slate-900 whitespace-nowrap">${(totalHours * hourlyRate).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <div className="px-4 py-8 text-center">
                  <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-500">No classes</p>
                </div>
              )}
            </div>
          </Card>

          {/* Adjustment History Section (Admin Only) */}
          {user?.role === 'admin' && invoice.changeHistory && invoice.changeHistory.filter(h => h.action === 'override_amounts').length > 0 && (
            <Card className="rounded-lg p-4 bg-yellow-50 border border-yellow-200 shadow-sm mb-4">
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="w-4 h-4 text-yellow-600" />
                <h3 className="text-sm font-semibold text-slate-900">Adjustment History</h3>
              </div>
              <div className="space-y-2">
                {invoice.changeHistory
                  .filter(h => h.action === 'override_amounts')
                  .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))
                  .map((record, idx) => {
                    const changedFields = [];
                    // Compare oldValue and newValue to find what actually changed
                    if (record.oldValue && record.newValue) {
                      Object.keys(record.newValue).forEach(key => {
                        if (record.oldValue[key] !== record.newValue[key]) {
                          changedFields.push({
                            field: key,
                            old: record.oldValue[key],
                            new: record.newValue[key]
                          });
                        }
                      });
                    }
                    
                    return (
                      <div key={idx} className="bg-white rounded-md p-3 border border-yellow-300 text-xs">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-slate-700">
                            {record.changedBy?.firstName || 'Admin'} {record.changedBy?.lastName || ''}
                          </span>
                          <span className="text-slate-500">{formatDateWithDay(record.changedAt)}</span>
                        </div>
                        {record.note && (
                          <p className="text-slate-600 mb-2 italic">{record.note}</p>
                        )}
                        {changedFields.length > 0 && (
                          <div className="space-y-1 text-slate-600">
                            {changedFields.map((change, changeIdx) => (
                              <div key={changeIdx} className="flex items-center gap-2">
                                <span className="font-medium">{change.field}:</span>
                                <span className="line-through text-red-600">{typeof change.old === 'number' ? change.old.toFixed(2) : change.old || 'null'}</span>
                                <span>→</span>
                                <span className="text-green-600 font-semibold">{typeof change.new === 'number' ? change.new.toFixed(2) : change.new}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </Card>
          )}

          
          {/* Temporary Debug Panel (toggleable) */}
          {debugOpen && (
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
              <Card className="rounded-lg p-3">
                <div className="flex items-start gap-4">
                  <div className="flex-1 overflow-auto text-xs">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-slate-800">Debug: classes[0]</h4>
                      <span className="text-xs text-slate-500">(toggleable)</span>
                    </div>
                    <pre className="whitespace-pre-wrap break-words text-xs bg-black/5 p-2 rounded max-h-48 overflow-auto">{JSON.stringify((classes && classes[0]) || { message: 'no classes' }, null, 2)}</pre>
                  </div>
                  <div className="flex flex-col gap-2">
                    <PrimaryButton onClick={() => {
                      try {
                        const json = JSON.stringify((classes && classes[0]) || {}, null, 2);
                        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json);
                      } catch (e) {
                        // ignore
                      }
                    }} variant="subtle" size="sm">Copy</PrimaryButton>
                    <PrimaryButton onClick={() => setDebugOpen(false)} variant="subtle" size="sm">Close</PrimaryButton>
                  </div>
                </div>
              </Card>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-xs text-slate-500">Created {formatDateDDMMMYYYY(invoice.createdAt)}</div>
          <PrimaryButton variant="subtle" onClick={onClose}>Close</PrimaryButton>
        </div>
      </div>
    </div>
  );
};

export default TeacherInvoiceDetailModal;
