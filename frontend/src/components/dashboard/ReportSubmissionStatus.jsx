import React, { useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { Clock, AlertCircle, CheckCircle2, XCircle, Shield } from 'lucide-react';
import api from '../../api/axios';

const formatCompactDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${lookup.day} ${lookup.month} ${lookup.year} ${lookup.hour}:${lookup.minute} ${lookup.dayPeriod || ''}`.trim();
};

/* ---- Quick-select presets for extension hours ---- */
const HOUR_PRESETS = [6, 12, 24, 48, 72];

/* ---- Shared extension modal (rendered via portal) ---- */
function ExtensionModal({ show, hours, reason, processing, onChangeHours, onChangeReason, onGrant, onClose }) {
  if (!show) return null;

  const content = (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !processing) onClose(); }}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl ring-1 ring-gray-900/5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2C736C]/10">
              <Shield className="h-4 w-4 text-[#2C736C]" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Grant Extension</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            Reopens the submission window so the teacher can submit the report.
          </p>
        </div>

        {/* body */}
        <div className="space-y-4 px-5 py-4">
          {/* duration */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-700">Duration (hours)</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {HOUR_PRESETS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => onChangeHours(h)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    Number(hours) === h
                      ? 'bg-[#2C736C] text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {h}h
                </button>
              ))}
            </div>
            <input
              type="number"
              min="1"
              max="168"
              value={hours}
              onChange={(e) => onChangeHours(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[#2C736C] focus:outline-none focus:ring-2 focus:ring-[#2C736C]/20"
            />
          </div>

          {/* reason */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-700">Reason <span className="font-normal text-gray-400">(optional)</span></label>
            <textarea
              value={reason}
              onChange={(e) => onChangeReason(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-[#2C736C] focus:outline-none focus:ring-2 focus:ring-[#2C736C]/20"
              rows="2"
              placeholder="Reason for extension…"
            />
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
            disabled={processing}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onGrant(); }}
            disabled={processing}
            className="rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245e58] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {processing ? 'Granting…' : 'Grant Extension'}
          </button>
        </div>
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
}

/**
 * ReportSubmissionStatus Component
 * Displays submission window status, deadlines, and admin controls
 */
const ReportSubmissionStatus = ({ classId, userRole, onExtensionGranted, onRefresh, compact = false, compactBare = false, compactInline = false }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [extensionHours, setExtensionHours] = useState(24);
  const [extensionReason, setExtensionReason] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (userRole !== 'admin') return;
    let cancelled = false;
    const fetchDefaultHours = async () => {
      try {
        const res = await api.get('/settings/admin_extension_hours');
        const hours = Number(res.data?.setting?.value) || 24;
        if (!cancelled) setExtensionHours(hours);
      } catch (_) { /* ignore */ }
    };
    fetchDefaultHours();
    return () => { cancelled = true; };
  }, [userRole]);

  const fetchStatus = useCallback(async () => {
    if (!classId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.get(`/classes/${classId}/submission-status`);
      setStatus(res.data);
    } catch (err) {
      console.error('Error fetching submission status:', err);
      setError(err.response?.data?.message || 'Failed to load status');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleGrantExtension = async () => {
    try {
      setProcessing(true);
      const res = await api.post(`/classes/${classId}/grant-extension`, {
        extensionHours: parseInt(extensionHours),
        reason: extensionReason || `Extension granted for ${extensionHours} hours`,
      });
      alert(`Extension granted successfully!\n\nThe teacher now has ${extensionHours} more hours to submit the report.\n\nNew deadline: ${new Date(res.data.expiresAt).toLocaleString()}`);
      setShowExtensionModal(false);
      setExtensionReason('');
      await fetchStatus();
      if (onExtensionGranted) onExtensionGranted();
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Error granting extension:', err);
      alert('Failed to grant extension: ' + (err.response?.data?.message || 'Unknown error'));
    } finally {
      setProcessing(false);
    }
  };

  const formatTimeRemaining = (hours) => {
    if (hours === null || hours === undefined) return '';
    if (hours < 1) {
      const minutes = Math.floor(hours * 60);
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    const wholeHours = Math.floor(hours);
    const minutes = Math.floor((hours - wholeHours) * 60);
    if (minutes > 0) return `${wholeHours}h ${minutes}m`;
    return `${wholeHours} hour${wholeHours !== 1 ? 's' : ''}`;
  };

  /* ---- shared "Extend" trigger button ---- */
  const extendButton = (size = 'sm') => userRole === 'admin' ? (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowExtensionModal(true); }}
      className={
        size === 'xs'
          ? 'shrink-0 rounded-lg bg-[#2C736C] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-[#245e58]'
          : 'inline-flex items-center gap-1 rounded-lg bg-[#2C736C] px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-[#245e58]'
      }
    >
      {size !== 'xs' && <Shield className="h-3 w-3" />}
      Extend
    </button>
  ) : null;

  /* ---- shared extension modal (portal) ---- */
  const extensionModal = (
    <ExtensionModal
      show={showExtensionModal}
      hours={extensionHours}
      reason={extensionReason}
      processing={processing}
      onChangeHours={setExtensionHours}
      onChangeReason={setExtensionReason}
      onGrant={handleGrantExtension}
      onClose={() => setShowExtensionModal(false)}
    />
  );

  /* ---- helper for compact rendering ---- */
  const renderCompactStatus = (title, lines = [], toneClass = 'text-slate-700', action = null, containerClassName = compactBare ? 'px-0 py-0' : 'bg-slate-50 border border-slate-200 rounded-lg px-3 py-2') => (
    <div className={containerClassName}>
      <div className={`flex justify-between gap-3 ${compactInline ? 'items-center' : 'items-start'}`}>
        <div className={`min-w-0 ${compactInline ? 'flex flex-wrap items-center gap-x-2 gap-y-1' : 'space-y-1'}`}>
          <p className={`${compactInline ? 'text-xs' : 'text-sm'} font-semibold ${toneClass}`}>{title}</p>
          {lines.filter(Boolean).slice(0, compactInline ? 1 : 2).map((line, index) => (
            <p key={index} className={`${compactInline ? 'text-[11px]' : 'text-xs'} ${toneClass} break-words`}>{line}</p>
          ))}
        </div>
        {action}
      </div>
    </div>
  );

  // ─── Loading ───
  if (loading) {
    if (compact) return renderCompactStatus('Checking…', [], 'text-blue-700', null, compactBare ? 'px-0 py-0' : 'bg-blue-50 border border-blue-200 rounded-lg px-3 py-2');
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-blue-700">
          <Clock className="h-5 w-5 animate-spin" />
          <span>Checking submission status...</span>
        </div>
      </div>
    );
  }

  // ─── Error ───
  if (error) {
    if (compact) return renderCompactStatus(error, [], 'text-red-700', null, compactBare ? 'px-0 py-0' : 'bg-red-50 border border-red-200 rounded-lg px-3 py-2');
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-red-700"><XCircle className="h-5 w-5" /><span>{error}</span></div>
      </div>
    );
  }

  if (!status) return null;

  // ─── Report already submitted ───
  if (status.reportSubmitted) {
    if (compact) return renderCompactStatus(compactInline ? 'Submitted' : 'Report Submitted', [], 'text-green-700', null, compactBare ? 'px-0 py-0' : 'bg-green-50 border border-green-200 rounded-lg px-3 py-2');
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle2 className="h-5 w-5" />
          <div className="flex-1">
            <p className="font-semibold">Report Submitted</p>
            <p className="text-sm">Submitted on {new Date(status.submittedAt).toLocaleString()}</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Class hasn't ended yet ───
  if (!status.classEnded) {
    if (compact) return renderCompactStatus(compactInline ? 'Opens later' : 'Class Scheduled', [status.classEndTime ? `${compactInline ? 'At' : 'Opens'} ${formatCompactDateTime(status.classEndTime)}` : null], 'text-blue-700', null, compactBare ? 'px-0 py-0' : 'bg-blue-50 border border-blue-200 rounded-lg px-3 py-2');
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-blue-700">
          <Clock className="h-5 w-5" />
          <div className="flex-1">
            <p className="font-semibold">Class Scheduled</p>
            <p className="text-sm">You can submit the report after the class ends at {new Date(status.classEndTime).toLocaleString()}</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Unreported ───
  if (status.status === 'unreported') {
    if (compact) {
      return (
        <>
          {renderCompactStatus(
            compactInline ? 'Closed' : 'Submission Closed',
            [userRole === 'teacher' ? (compactInline ? 'Ask admin' : 'Ask admin to reopen it') : 'Marked as unreported'],
            'text-red-700',
            extendButton('xs'),
            compactBare ? 'px-0 py-0' : 'bg-red-50 border border-red-200 rounded-lg px-3 py-2'
          )}
          {extensionModal}
        </>
      );
    }
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-2 text-red-700">
          <AlertCircle className="h-5 w-5 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Submission Window Expired</p>
            <p className="text-sm mb-2">The 72-hour submission window has expired and this class is marked as unreported.</p>
            {userRole === 'teacher' && <p className="text-sm font-medium">Please contact an administrator to grant an extension.</p>}
            {userRole === 'admin' && <div className="mt-2">{extendButton('sm')}</div>}
          </div>
        </div>
        {extensionModal}
      </div>
    );
  }

  // ─── Submission window open ───
  const isExtended = status.adminExtension && status.adminExtension.granted && !status.adminExtension.expired;
  const timeRemaining = status.timeRemaining;
  const deadline = status.deadline ? new Date(status.deadline) : null;
  const isExpiringSoon = timeRemaining !== null && timeRemaining < 24;
  const isVeryUrgent = timeRemaining !== null && timeRemaining < 6;
  const bgColor = isVeryUrgent ? 'bg-red-50' : isExpiringSoon ? 'bg-amber-50' : 'bg-green-50';
  const borderColor = isVeryUrgent ? 'border-red-200' : isExpiringSoon ? 'border-amber-200' : 'border-green-200';
  const textColor = isVeryUrgent ? 'text-red-700' : isExpiringSoon ? 'text-amber-700' : 'text-green-700';

  if (compact) {
    return (
      <>
        {renderCompactStatus(
          compactInline ? (isExtended ? 'Extended' : 'Open') : (isExtended ? 'Admin Extension Granted' : 'Submission Window Open'),
          [
            compactInline
              ? (timeRemaining !== null ? `${formatTimeRemaining(timeRemaining)} left` : (deadline ? `Due ${formatCompactDateTime(deadline)}` : null))
              : (timeRemaining !== null ? `${formatTimeRemaining(timeRemaining)} left` : null),
            compactInline ? null : (deadline ? `Due ${formatCompactDateTime(deadline)}` : null),
          ],
          textColor,
          !isExtended ? extendButton('xs') : null,
          compactBare ? 'px-0 py-0' : `${bgColor} border ${borderColor} rounded-lg px-3 py-2`
        )}
        {extensionModal}
      </>
    );
  }

  return (
    <div className={`${bgColor} border ${borderColor} rounded-lg p-4 mb-4`}>
      <div className="flex items-start gap-2">
        <Clock className={`h-5 w-5 mt-0.5 ${textColor}`} />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <p className={`font-semibold ${textColor}`}>
              {isExtended ? 'Admin Extension Granted' : 'Submission Window Open'}
            </p>
            {!isExtended && extendButton('sm')}
          </div>
          <div className={`text-sm ${textColor}`}>
            {timeRemaining !== null && <p className="font-medium">{formatTimeRemaining(timeRemaining)} remaining</p>}
            {deadline && <p className="mt-1">Deadline: {deadline.toLocaleString()}</p>}
            {isExtended && status.adminExtension && (
              <p className="mt-2 text-xs">
                Extended by {status.adminExtension.grantedBy?.firstName || 'Admin'} on {new Date(status.adminExtension.grantedAt).toLocaleString()}
                {status.adminExtension.reason && <span className="block mt-1 italic">{status.adminExtension.reason}</span>}
              </p>
            )}
          </div>
        </div>
      </div>
      {extensionModal}
    </div>
  );
};

export default ReportSubmissionStatus;
