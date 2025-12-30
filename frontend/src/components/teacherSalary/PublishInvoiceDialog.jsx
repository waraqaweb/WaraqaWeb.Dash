/**
 * Publish Invoice Dialog
 * 
 * Confirmation dialog for publishing draft invoices.
 * Once published, teachers can view their invoices.
 */

import React, { useState } from 'react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import { AlertCircle, Check, Eye } from 'lucide-react';

const PublishInvoiceDialog = ({ invoice, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handlePublish = async () => {
    try {
      setLoading(true);
      setError(null);

      await api.post(`/teacher-salary/admin/invoices/${invoice._id}/publish`);

      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (err) {
      console.error('Error publishing invoice:', err);
      setError(err.response?.data?.message || 'Failed to publish invoice');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
          <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Eye className="w-6 h-6 text-blue-600" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">Publish Invoice</h3>
            <p className="text-sm text-gray-600">Invoice #{invoice?.invoiceNumber}</p>
          </div>
        </div>

        {/* Content */}
        <div className="mb-6">
          <p className="text-gray-700 mb-4">
            Are you sure you want to publish this invoice? Once published:
          </p>
          <ul className="space-y-2 text-sm text-gray-600">
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span>The teacher will be able to view the invoice</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span>Email notification will be sent to the teacher</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <span>The invoice can still be modified (bonuses, extras)</span>
            </li>
          </ul>
        </div>

        {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
              {error}
            </div>
          )}

        {/* Actions */}
          <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Cancel publish invoice"
          >
            Cancel
          </button>
          <button
            onClick={handlePublish}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-custom-teal text-white rounded-lg hover:bg-custom-teal-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            aria-label="Publish invoice"
          >
            {loading ? (
              <>
                <LoadingSpinner className="w-4 h-4" aria-hidden="true" />
                Publishing...
              </>
            ) : (
              <>
                <Eye className="w-4 h-4" aria-hidden="true" />
                Publish
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PublishInvoiceDialog;
