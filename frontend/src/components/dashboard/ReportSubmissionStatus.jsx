import React, { useEffect, useState, useCallback } from 'react';
import { Clock, AlertCircle, CheckCircle2, XCircle, Shield } from 'lucide-react';
import api from '../../api/axios';

/**
 * ReportSubmissionStatus Component
 * Displays submission window status, deadlines, and admin controls
 */
const ReportSubmissionStatus = ({ classId, userRole, onExtensionGranted, onRefresh }) => {
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
        if (!cancelled) {
          setExtensionHours(hours);
        }
      } catch (err) {
        // ignore
      }
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

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleGrantExtension = async () => {
    try {
      setProcessing(true);
      const res = await api.post(`/classes/${classId}/grant-extension`, {
        extensionHours: parseInt(extensionHours),
        reason: extensionReason || `Extension granted for ${extensionHours} hours`,
      });
      
      // Show success message
      alert(`✅ Extension granted successfully!\n\nThe teacher now has ${extensionHours} more hours to submit the report.\n\nNew deadline: ${new Date(res.data.expiresAt).toLocaleString()}`);
      
      setShowExtensionModal(false);
      setExtensionReason('');
      await fetchStatus();
      if (onExtensionGranted) onExtensionGranted();
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Error granting extension:', err);
      alert('❌ Failed to grant extension: ' + (err.response?.data?.message || 'Unknown error'));
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
    if (minutes > 0) {
      return `${wholeHours}h ${minutes}m`;
    }
    return `${wholeHours} hour${wholeHours !== 1 ? 's' : ''}`;
  };

  if (loading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-blue-700">
          <Clock className="h-5 w-5 animate-spin" />
          <span>Checking submission status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-red-700">
          <XCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!status) return null;

  // Report already submitted
  if (status.reportSubmitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle2 className="h-5 w-5" />
          <div className="flex-1">
            <p className="font-semibold">Report Submitted</p>
            <p className="text-sm">
              Submitted on {new Date(status.submittedAt).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Class hasn't ended yet
  if (!status.classEnded) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 text-blue-700">
          <Clock className="h-5 w-5" />
          <div className="flex-1">
            <p className="font-semibold">Class Scheduled</p>
            <p className="text-sm">
              You can submit the report after the class ends at{' '}
              {new Date(status.classEndTime).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Class marked as unreported
  if (status.status === 'unreported') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-2 text-red-700">
          <AlertCircle className="h-5 w-5 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Submission Window Expired</p>
            <p className="text-sm mb-2">
              The 72-hour submission window has expired and this class is marked as unreported.
            </p>
            {userRole === 'teacher' && (
              <p className="text-sm font-medium">
                Please contact an administrator to grant an extension.
              </p>
            )}
            {userRole === 'admin' && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowExtensionModal(true);
                }}
                className="mt-2 px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-700 flex items-center gap-1"
              >
                <Shield className="h-4 w-4" />
                Grant Extension
              </button>
            )}
          </div>
        </div>

        {/* Extension Modal */}
        {showExtensionModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Grant Extension</h3>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
                <p className="font-medium mb-1">What this does</p>
                <p>Reopens the submission window for the selected hours. The teacher still needs to submit the report.</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Extension Duration (hours)</label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={extensionHours}
                    onChange={(e) => setExtensionHours(e.target.value)}
                    className="w-full px-3 py-2 border rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reason (optional)</label>
                  <textarea
                    value={extensionReason}
                    onChange={(e) => setExtensionReason(e.target.value)}
                    className="w-full px-3 py-2 border rounded"
                    rows="3"
                    placeholder="Reason for extension..."
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowExtensionModal(false);
                    }}
                    disabled={processing}
                    className="px-4 py-2 border rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleGrantExtension();
                    }}
                    disabled={processing}
                    className="px-4 py-2 bg-custom-teal text-white rounded hover:bg-custom-teal-dark disabled:opacity-50"
                  >
                    {processing ? 'Granting...' : 'Grant Extension'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Submission window is open
  const isExtended = status.adminExtension && status.adminExtension.granted && !status.adminExtension.expired;
  const timeRemaining = status.timeRemaining;
  const deadline = status.deadline ? new Date(status.deadline) : null;

  const isExpiringSoon = timeRemaining !== null && timeRemaining < 24;
  const isVeryUrgent = timeRemaining !== null && timeRemaining < 6;

  const bgColor = isVeryUrgent ? 'bg-red-50' : isExpiringSoon ? 'bg-amber-50' : 'bg-green-50';
  const borderColor = isVeryUrgent ? 'border-red-200' : isExpiringSoon ? 'border-amber-200' : 'border-green-200';
  const textColor = isVeryUrgent ? 'text-red-700' : isExpiringSoon ? 'text-amber-700' : 'text-green-700';

  return (
    <div className={`${bgColor} border ${borderColor} rounded-lg p-4 mb-4`}>
      <div className="flex items-start gap-2">
        <Clock className={`h-5 w-5 mt-0.5 ${textColor}`} />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <p className={`font-semibold ${textColor}`}>
              {isExtended ? 'Admin Extension Granted' : 'Submission Window Open'}
            </p>
            {userRole === 'admin' && !isExtended && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowExtensionModal(true);
                }}
                className="px-2 py-1 text-xs bg-custom-teal text-white rounded hover:bg-custom-teal-dark flex items-center gap-1"
              >
                <Shield className="h-3 w-3" />
                Extend
              </button>
            )}
          </div>
          <div className={`text-sm ${textColor}`}>
            {timeRemaining !== null && (
              <p className="font-medium">
                {formatTimeRemaining(timeRemaining)} remaining
              </p>
            )}
            {deadline && (
              <p className="mt-1">
                Deadline: {deadline.toLocaleString()}
              </p>
            )}
            {isExtended && status.adminExtension && (
              <p className="mt-2 text-xs">
                Extended by {status.adminExtension.grantedBy?.firstName || 'Admin'} on{' '}
                {new Date(status.adminExtension.grantedAt).toLocaleString()}
                {status.adminExtension.reason && (
                  <span className="block mt-1 italic">{status.adminExtension.reason}</span>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Extension Modal */}
      {showExtensionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Grant Extension</h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
              <p className="font-medium mb-1">What this does</p>
              <p>Reopens the submission window for the selected hours. The teacher still needs to submit the report.</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Extension Duration (hours)</label>
                <input
                  type="number"
                  min="1"
                  max="168"
                  value={extensionHours}
                  onChange={(e) => setExtensionHours(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reason (optional)</label>
                <textarea
                  value={extensionReason}
                  onChange={(e) => setExtensionReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded"
                  rows="3"
                  placeholder="Reason for extension..."
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowExtensionModal(false);
                  }}
                  disabled={processing}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleGrantExtension();
                  }}
                  disabled={processing}
                  className="px-4 py-2 bg-custom-teal text-white rounded hover:bg-custom-teal-dark disabled:opacity-50"
                >
                  {processing ? 'Granting...' : 'Grant Extension'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportSubmissionStatus;
