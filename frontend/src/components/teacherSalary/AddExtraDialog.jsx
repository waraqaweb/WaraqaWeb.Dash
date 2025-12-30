/**
 * Add Extra Dialog
 * 
 * Dialog for adding extra line items to draft or published invoices.
 * Extras are additional charges/deductions (positive or negative amounts).
 */

import React, { useState } from 'react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import { AlertCircle, Plus, X } from 'lucide-react';

const AddExtraDialog = ({ invoice, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    amountUSD: '',
    description: '',
    isDeduction: false
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate amount
    const amount = parseFloat(formData.amountUSD);
    if (isNaN(amount) || amount === 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!formData.description.trim()) {
      setError('Please provide a description');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // If it's a deduction, make the amount negative
      const finalAmount = formData.isDeduction && amount > 0 ? -amount : amount;

      await api.post(`/teacher-salary/admin/invoices/${invoice._id}/extras`, {
        amountUSD: finalAmount,
        description: formData.description.trim()
      });

      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (err) {
      console.error('Error adding extra:', err);
      setError(err.response?.data?.message || 'Failed to add extra');
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

  // Calculate preview amount in target currency
  const inputAmount = formData.amountUSD && !isNaN(parseFloat(formData.amountUSD))
    ? parseFloat(formData.amountUSD)
    : 0;
  
  const finalAmount = formData.isDeduction && inputAmount > 0 ? -inputAmount : inputAmount;
  
  const previewAmount = finalAmount !== 0 && invoice?.currency === 'EGP'
    ? finalAmount * (invoice?.snapshotExchangeRate?.rateEGPPerUSD || 31.5)
    : finalAmount;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Plus className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Add Extra Item</h3>
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

        {/* Teacher Info */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Teacher</span>
            <span className="text-sm font-medium text-gray-900">
              {invoice?.teacher?.firstName} {invoice?.teacher?.lastName}
            </span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type *
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleChange('isDeduction', false)}
                className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                  !formData.isDeduction
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Plus className="w-4 h-4 inline mr-1" />
                Addition
              </button>
              <button
                type="button"
                onClick={() => handleChange('isDeduction', true)}
                className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                  formData.isDeduction
                    ? 'border-red-600 bg-red-50 text-red-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <X className="w-4 h-4 inline mr-1" />
                Deduction
              </button>
            </div>
          </div>

          {/* Amount in USD */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Amount (USD) *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={formData.amountUSD}
                onChange={(e) => handleChange('amountUSD', e.target.value)}
                required
                placeholder="0.00"
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            {previewAmount !== 0 && (
              <p className="mt-1 text-xs text-gray-500">
                {formData.isDeduction && '- '}
                {invoice?.currency === 'EGP' ? (
                  <>≈ {formatCurrency(Math.abs(previewAmount), invoice.currency)} (at rate {invoice?.snapshotExchangeRate?.rateEGPPerUSD?.toFixed(2)})</>
                ) : (
                  <>= ${Math.abs(previewAmount).toFixed(2)}</>
                )}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description *
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              required
              placeholder={
                formData.isDeduction
                  ? 'e.g., Late penalty, Equipment damage'
                  : 'e.g., Travel reimbursement, Material costs'
              }
              maxLength={100}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              {formData.description.length}/100 characters
            </p>
          </div>

          {/* Info Box */}
          <div className={`p-3 rounded-lg ${formData.isDeduction ? 'bg-red-50 border border-red-200' : 'bg-indigo-50 border border-indigo-200'}`}>
            <p className={`text-xs ${formData.isDeduction ? 'text-red-700' : 'text-indigo-700'}`}>
              {formData.isDeduction
                ? '⚠️ This will decrease the invoice total'
                : 'ℹ️ This will increase the invoice total'}
            </p>
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
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              aria-label="Add extra item to invoice"
            >
              {loading ? (
                <>
                  <LoadingSpinner className="w-4 h-4" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add Extra
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddExtraDialog;
