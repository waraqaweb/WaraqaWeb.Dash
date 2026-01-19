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
    paymentMethod: 'instapay',
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

  const getExchangeRate = () => {
    const rate = invoice?.exchangeRateSnapshot?.rate
      || invoice?.exchangeRate
      || invoice?.exchangeRateEGP
      || invoice?.usdToEgp
      || invoice?.exchangeRateUsed;
    return Number(rate) || 1;
  };

  const resolveAmountEGP = () => {
    const candidates = [
      invoice?.netAmountEGP,
      invoice?.totalEGP,
      invoice?.grossAmountEGP,
      invoice?.finalTotalEGP,
      invoice?.finalTotalInEGP
    ];
    for (const c of candidates) {
      const v = Number(c);
      if (Number.isFinite(v) && v > 0) return v;
    }
    const finalTotal = Number(invoice?.finalTotal || 0);
    if (finalTotal > 0) {
      if ((invoice?.currency || 'EGP') === 'EGP') return finalTotal;
      return finalTotal * getExchangeRate();
    }
    return 0;
  };

  const resolveBonusesEGP = () => {
    const direct = Number(invoice?.bonusesEGP || 0);
    if (direct) return direct;
    const usd = Number(invoice?.bonusesUSD || 0);
    return usd ? usd * getExchangeRate() : 0;
  };

  const resolveExtrasEGP = () => {
    const direct = Number(invoice?.extrasEGP || 0);
    if (direct) return direct;
    const usd = Number(invoice?.extrasUSD || 0);
    return usd ? usd * getExchangeRate() : 0;
  };

  const amountEGP = resolveAmountEGP();
  const totalHours = Number(invoice?.totalHours || 0);
  const hourlyRate = Number(invoice?.rateSnapshot?.rate || invoice?.snapshotRate?.rateUSD || invoice?.hourlyRateUSD || 0);
  const tierLabel = invoice?.rateSnapshot?.partition || invoice?.snapshotRate?.partition || '—';
  const bonusesEGP = resolveBonusesEGP();
  const extrasEGP = resolveExtrasEGP();
  const transferFeeEGP = Number(invoice?.transferFeeEGP || 0);
  const instapayName = invoice?.teacher?.teacherInfo?.instapayName || invoice?.teacher?.instapayName || '';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <DollarSign className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Mark invoice as paid</h3>
              <p className="text-xs text-gray-500">Invoice #{invoice?.invoiceNumber}</p>
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
        <div className="mb-5 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-gray-900">
              {invoice?.teacher?.firstName} {invoice?.teacher?.lastName}
            </div>
            <div className="text-lg font-semibold text-emerald-700">
              {formatCurrency(amountEGP, 'EGP')}
            </div>
          </div>
          {instapayName && (
            <div className="mt-1 text-xs text-emerald-700">Instapay: {instapayName}</div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-600">
            <div className="flex items-center justify-between">
              <span>Hours</span>
              <span className="font-medium text-gray-800">{totalHours.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Rate tier</span>
              <span className="font-medium text-gray-800">{tierLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Hourly rate</span>
              <span className="font-medium text-gray-800">${hourlyRate.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Bonus</span>
              <span className="font-medium text-gray-800">{formatCurrency(bonusesEGP, 'EGP')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Extra / Deduction</span>
              <span className="font-medium text-gray-800">{formatCurrency(extrasEGP, 'EGP')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Transfer fee</span>
              <span className="font-medium text-gray-800">{formatCurrency(transferFeeEGP, 'EGP')}</span>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Payment Method */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Payment method</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'instapay', label: 'Instapay' },
                { value: 'bank_transfer', label: 'Bank Transfer' },
                { value: 'cash', label: 'Cash' },
                { value: 'other', label: 'Other' }
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleChange('paymentMethod', option.value)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${formData.paymentMethod === option.value ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Proof link (optional)</label>
            <div className="relative">
              <Upload className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="url"
                value={formData.paymentProofUrl}
                onChange={(e) => handleChange('paymentProofUrl', e.target.value)}
                placeholder="Paste link"
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent"
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Link to payment receipt or screenshot.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Notes (optional)</label>
            <textarea
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              rows={2}
              placeholder="Add a short note"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent"
            />
          </div>
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
