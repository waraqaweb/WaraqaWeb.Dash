/**
 * Mark Paid Dialog
 * 
 * Dialog for marking published invoices as paid.
 * Includes payment method selection and optional proof upload.
 */

import React, { useState } from 'react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import { AlertCircle, Check, DollarSign, Upload, X } from 'lucide-react';

const MarkPaidDialog = ({ invoice, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    paymentMethod: 'bank_transfer',
    paymentProofUrl: '',
    notes: ''
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError(null);

      await api.post(`/teacher-salary/admin/invoices/${invoice._id}/mark-paid`, formData);

      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (err) {
      console.error('Error marking invoice as paid:', err);
      setError(err.response?.data?.message || 'Failed to mark invoice as paid');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount, currency = 'EGP') => {
    const value = Number(amount) || 0;
    if (currency === 'USD') {
      return `$${value.toFixed(2)}`;
    }
    return `${value.toFixed(2)} EGP`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Mark as Paid</h3>
              <p className="text-sm text-gray-600">Invoice #{invoice?.invoiceNumber}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Invoice Summary */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Teacher</span>
            <span className="text-sm font-medium text-gray-900">
              {invoice?.teacher?.firstName} {invoice?.teacher?.lastName}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Amount</span>
            <span className="text-lg font-bold text-green-600">
              {formatCurrency(invoice?.finalTotal, invoice?.currency)}
            </span>
          </div>
          <p className="mt-3 text-xs text-gray-600">
            Fields affected: sets <span className="font-mono">TeacherInvoice.status</span> to <span className="font-mono">paid</span> and stores payment details (method/proof/notes). Paid invoices are treated as closed; late classes create adjustment invoices.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Method *
            </label>
            <select
              value={formData.paymentMethod}
              onChange={(e) => handleChange('paymentMethod', e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent"
            >
              <option value="bank_transfer">Bank Transfer</option>
              <option value="instapay">Instapay</option>
              <option value="paypal">PayPal</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Payment Proof URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Payment Proof URL (Optional)
            </label>
            <div className="relative">
              <Upload className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="url"
                value={formData.paymentProofUrl}
                onChange={(e) => handleChange('paymentProofUrl', e.target.value)}
                placeholder="https://..."
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Link to payment receipt or screenshot (e.g., from cloud storage)
            </p>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Additional payment details..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent resize-none"
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-800 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              aria-label="Mark invoice as paid"
            >
              {loading ? (
                <>
                  <LoadingSpinner className="w-4 h-4" aria-hidden="true" />
                  Processing...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" aria-hidden="true" />
                  Mark as Paid
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MarkPaidDialog;
