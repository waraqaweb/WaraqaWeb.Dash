/**
 * Add Bonus Dialog
 * 
 * Dialog for adding bonuses to draft or published invoices.
 * Bonuses are added in USD and converted to target currency.
 */

import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import { AlertCircle, Gift, X, Search } from 'lucide-react';

const AddBonusDialog = ({ invoice, onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [guardians, setGuardians] = useState([]);
  const [loadingGuardians, setLoadingGuardians] = useState(false);
  const [guardianSearch, setGuardianSearch] = useState('');
  
  const [formData, setFormData] = useState({
    amountUSD: '',
    source: 'admin', // default to 'admin' (valid enum: 'guardian' | 'admin')
    guardianId: '',
    grossAmountUSD: '', // Amount guardian sent (before 5% transfer fee)
    reason: ''
  });

  // Fetch guardians when source is 'guardian'
  useEffect(() => {
    if (formData.source === 'guardian') {
      fetchGuardians();
    }
  }, [formData.source]);

  const fetchGuardians = async () => {
    try {
      setLoadingGuardians(true);
      const response = await api.get('/users', {
        params: { role: 'guardian', active: true, limit: 200 }
      });
      setGuardians(response.data.users || response.data || []);
    } catch (err) {
      console.error('Error fetching guardians:', err);
      setError('Failed to load guardians list');
    } finally {
      setLoadingGuardians(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };
      
      // When guardian source is selected and gross amount changes, auto-calculate net amount (95%)
      if (field === 'grossAmountUSD' && prev.source === 'guardian') {
        const gross = parseFloat(value);
        if (!isNaN(gross) && gross > 0) {
          updated.amountUSD = (gross * 0.95).toFixed(2); // 5% transfer fee
        } else {
          updated.amountUSD = '';
        }
      }
      
      // When switching to guardian, clear amountUSD so user enters gross amount
      if (field === 'source' && value === 'guardian') {
        updated.amountUSD = '';
        updated.grossAmountUSD = '';
      }
      
      // When switching to admin, clear guardian fields
      if (field === 'source' && value === 'admin') {
        updated.guardianId = '';
        updated.grossAmountUSD = '';
      }
      
      return updated;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.source.trim()) {
      setError('Please provide a source for the bonus');
      return;
    }

    // Validate amount based on source
    const amount = parseFloat(formData.amountUSD);
    const gross = parseFloat(formData.grossAmountUSD);
    if (formData.source === 'guardian') {
      if (isNaN(gross) || gross <= 0) {
        setError('Please enter a valid gross amount sent by the guardian');
        return;
      }
    } else {
      if (isNaN(amount) || amount <= 0) {
        setError('Please enter a valid bonus amount');
        return;
      }
    }

    // Validate guardian selection when source is guardian
    if (formData.source === 'guardian' && !formData.guardianId) {
      setError('Please select a guardian');
      return;
    }

    if (!formData.reason.trim() || formData.reason.trim().length < 5) {
      setError('Please provide a reason (at least 5 characters)');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const payload = {
        source: formData.source.trim(),
        reason: formData.reason.trim()
      };

      // Include guardianId if source is guardian
      if (formData.source === 'guardian' && formData.guardianId) {
        payload.guardianId = formData.guardianId;
        payload.grossAmountUSD = gross;
      } else {
        payload.amountUSD = amount;
      }

      await api.post(`/teacher-salary/admin/invoices/${invoice._id}/bonuses`, payload);

      if (onSuccess) {
        onSuccess();
      }

      onClose();
    } catch (err) {
      console.error('Error adding bonus:', err);
      setError(err.response?.data?.message || err.response?.data?.error || 'Failed to add bonus');
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
  const previewAmount = formData.amountUSD && !isNaN(parseFloat(formData.amountUSD))
    ? invoice?.currency === 'EGP'
      ? parseFloat(formData.amountUSD) * (invoice?.snapshotExchangeRate?.rateEGPPerUSD || 31.5)
      : parseFloat(formData.amountUSD)
    : 0;

  // Filter guardians by search
  const filteredGuardians = guardians.filter(g => {
    if (!guardianSearch.trim()) return true;
    const search = guardianSearch.toLowerCase();
    const name = `${g.firstName || ''} ${g.lastName || ''}`.toLowerCase();
    const email = (g.email || '').toLowerCase();
    return name.includes(search) || email.includes(search);
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Gift className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Add Bonus</h3>
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
          {/* Source */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Source *
            </label>
            <select
              value={formData.source}
              onChange={(e) => handleChange('source', e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            >
              <option value="admin">Admin</option>
              <option value="guardian">Guardian</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Select who is providing this bonus
            </p>
          </div>

          {/* Guardian Selection (only when source is guardian) */}
          {formData.source === 'guardian' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Guardian *
              </label>
              {loadingGuardians ? (
                <div className="flex items-center justify-center py-4">
                  <LoadingSpinner className="w-5 h-5" />
                  <span className="ml-2 text-sm text-gray-500">Loading guardians...</span>
                </div>
              ) : (
                <>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={guardianSearch}
                      onChange={(e) => setGuardianSearch(e.target.value)}
                      placeholder="Search guardians..."
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                    />
                  </div>
                  <select
                    value={formData.guardianId}
                    onChange={(e) => handleChange('guardianId', e.target.value)}
                    required
                    size={5}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                  >
                    <option value="">-- Select a guardian --</option>
                    {filteredGuardians.map(g => (
                      <option key={g._id} value={g._id}>
                        {g.firstName} {g.lastName} ({g.email})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {filteredGuardians.length} guardian{filteredGuardians.length !== 1 ? 's' : ''} available
                  </p>
                </>
              )}
            </div>
          )}

          {/* Gross Amount (only when source is guardian) */}
          {formData.source === 'guardian' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount Guardian Sent (USD) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                  $
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={formData.grossAmountUSD}
                  onChange={(e) => handleChange('grossAmountUSD', e.target.value)}
                  required
                  placeholder="0.00"
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Gross amount before 5% transfer fee deduction
              </p>
              {formData.grossAmountUSD && !isNaN(parseFloat(formData.grossAmountUSD)) && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-600">Gross amount:</span>
                    <span className="font-semibold">${parseFloat(formData.grossAmountUSD).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-600">Transfer fee (5%):</span>
                    <span className="text-red-600">-${(parseFloat(formData.grossAmountUSD) * 0.05).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-blue-300">
                    <span className="font-semibold text-gray-900">Net to teacher:</span>
                    <span className="font-bold text-green-600">${formData.amountUSD}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Amount in USD (only when source is admin) */}
          {formData.source === 'admin' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bonus Amount (USD) *
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
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                />
              </div>
              {previewAmount > 0 && invoice?.currency === 'EGP' && (
                <p className="mt-1 text-xs text-gray-500">
                  ≈ {formatCurrency(previewAmount, invoice.currency)} (at rate {invoice?.snapshotExchangeRate?.rateEGPPerUSD?.toFixed(2)})
                </p>
              )}
            </div>
          )}

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reason *
            </label>
            <textarea
              value={formData.reason}
              onChange={(e) => handleChange('reason', e.target.value)}
              required
              placeholder="Reason for this bonus (min 5 characters)..."
              rows={3}
              minLength={5}
              maxLength={200}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
            />
            <p className="mt-1 text-xs text-gray-500">
              {formData.reason.length}/200 characters
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
              className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              aria-label="Add bonus to invoice"
            >
              {loading ? (
                <>
                  <LoadingSpinner className="w-4 h-4" />
                  Adding...
                </>
              ) : (
                <>
                  <Gift className="w-4 h-4" aria-hidden="true" />
                  Add Bonus
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddBonusDialog;
