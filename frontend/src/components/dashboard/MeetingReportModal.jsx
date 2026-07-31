import React, { useCallback, useEffect, useState } from 'react';
import { submitMeetingReport } from '../../api/meetings';
import UnifiedReportComposerModal from '../reports/UnifiedReportComposerModal';

const MeetingReportModal = ({ isOpen, meeting = null, onClose, onSaved }) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSuccessMessage('');
  }, [isOpen, meeting?._id, meeting?.id]);

  const handleSubmit = useCallback(async ({ id, payload }) => {
    if (!id) {
      setError('Missing meeting reference');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const updated = await submitMeetingReport(id, payload);
      setSuccessMessage('Meeting report saved');
      if (onSaved) onSaved(updated);
    } catch (err) {
      const message = err?.response?.data?.message || 'Failed to save meeting report';
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [onSaved]);

  return (
    <UnifiedReportComposerModal
      isOpen={isOpen && Boolean(meeting)}
      mode="meeting"
      context={{ meeting }}
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      successMessage={successMessage}
    />
  );
};

export default MeetingReportModal;
