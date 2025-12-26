/**
 * Teacher Salary Settings Page
 * 
 * Features:
 * - Manage monthly exchange rates (EGP per USD)
 * - Configure salary rate partitions (Online 1-1, Online Group, In-Person)
 * - Set default transfer fees
 * - Apply rate changes to draft invoices
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { useAuth } from '../../../contexts/AuthContext';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import {
  DollarSign,
  Settings,
  TrendingUp,
  Save,
  AlertCircle,
  CheckCircle,
  Info,
  Calendar,
  RefreshCw
} from 'lucide-react';

const SalarySettings = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  // Redirect if not admin
  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
    }
  }, [isAdmin, navigate]);

  // State
  const [activeTab, setActiveTab] = useState('exchange-rates'); // exchange-rates | partitions | transfer-fees
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // Exchange Rates State
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [exchangeRates, setExchangeRates] = useState([]);
  const [newRate, setNewRate] = useState({
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    rate: '',
    source: 'Manual Entry',
    notes: ''
  });

  // Settings State (partitions, transfer fees)
  const [settings, setSettings] = useState(null);
  const [editingPartition, setEditingPartition] = useState(null);
  const [editingTransferFee, setEditingTransferFee] = useState(null);

  // Fetch exchange rates for a year
  const fetchExchangeRates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/teacher-salary/admin/exchange-rates', {
        params: { year: selectedYear }
      });
      setExchangeRates(response.data.rates || []);
    } catch (err) {
      console.error('Error fetching exchange rates:', err);
      setError(err.response?.data?.error || 'Failed to load exchange rates');
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  // Fetch salary settings (partitions, transfer fees)
  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/teacher-salary/admin/settings');
      setSettings(response.data.settings);
    } catch (err) {
      console.error('Error fetching settings:', err);
      setError(err.response?.data?.error || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch data on mount and when tab/year changes
  useEffect(() => {
    if (activeTab === 'exchange-rates') {
      fetchExchangeRates();
    } else {
      fetchSettings();
    }
  }, [activeTab, fetchExchangeRates, fetchSettings]);

  // Add/update exchange rate
  const handleSaveExchangeRate = async (e) => {
    e.preventDefault();
    
    if (!newRate.rate || newRate.rate <= 0) {
      setError('Please enter a valid exchange rate');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      await api.post('/teacher-salary/admin/exchange-rates', {
        month: parseInt(newRate.month),
        year: parseInt(newRate.year),
        rate: parseFloat(newRate.rate),
        source: newRate.source,
        notes: newRate.notes
      });

      setSuccessMessage('Exchange rate saved successfully');
      
      // Reset form
      setNewRate({
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
        rate: '',
        source: 'Manual Entry',
        notes: ''
      });

      // Refresh rates
      fetchExchangeRates();

      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error saving exchange rate:', err);
      setError(err.response?.data?.error || 'Failed to save exchange rate');
    } finally {
      setSaving(false);
    }
  };

  // Update partition rate
  const handleUpdatePartition = async (partitionName, rateUSD, applyToDrafts) => {
    try {
      setSaving(true);
      setError(null);

      const response = await api.put(`/teacher-salary/admin/settings/partitions/${partitionName}`, {
        rateUSD: parseFloat(rateUSD),
        applyToDrafts
      });

      setSuccessMessage(
        `Partition rate updated successfully` +
        (applyToDrafts ? ` (${response.data.result.affectedInvoices || 0} draft invoices updated)` : '')
      );

      setEditingPartition(null);
      fetchSettings();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating partition:', err);
      setError(err.response?.data?.error || 'Failed to update partition');
    } finally {
      setSaving(false);
    }
  };

  // Update transfer fee
  const handleUpdateTransferFee = async (model, value) => {
    try {
      setSaving(true);
      setError(null);

      await api.put('/teacher-salary/admin/settings/transfer-fee', {
        model,
        value: parseFloat(value)
      });

      setSuccessMessage('Transfer fee updated successfully');
      setEditingTransferFee(null);
      fetchSettings();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating transfer fee:', err);
      setError(err.response?.data?.error || 'Failed to update transfer fee');
    } finally {
      setSaving(false);
    }
  };

  // Generate year options (current year ± 2 years)
  const yearOptions = [];
  const currentYear = new Date().getFullYear();
  for (let i = currentYear - 2; i <= currentYear + 2; i++) {
    yearOptions.push(i);
  }

  // Month names
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Get rate for a specific month
  const getRateForMonth = (month) => {
    return exchangeRates.find(r => r.month === month);
  };

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Settings className="h-8 w-8 text-indigo-600" />
            Teacher Salary Settings
          </h1>
          <p className="mt-2 text-gray-600">
            Manage exchange rates, salary partitions, and transfer fees
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 px-4 py-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-800 font-medium">Error</p>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-red-700 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-green-100 bg-green-50 px-4 py-3">
            <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-green-800 font-medium">Success</p>
              <p className="text-green-700 text-sm">{successMessage}</p>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="inline-flex items-center justify-center rounded-md p-2 text-sm font-medium text-green-700 hover:bg-green-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              aria-label="Dismiss success message"
            >
              ×
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6">
          <div className="flex items-center gap-3 bg-white/60 p-1 rounded-full shadow-sm max-w-md">
            <button
              onClick={() => setActiveTab('exchange-rates')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                activeTab === 'exchange-rates'
                  ? 'bg-[#2C736C] text-white shadow'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <DollarSign className={`h-4 w-4 ${activeTab === 'exchange-rates' ? 'text-white' : 'text-gray-500'}`} />
                <span>Exchange Rates</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('partitions')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                activeTab === 'partitions'
                  ? 'bg-[#2C736C] text-white shadow'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <TrendingUp className={`h-4 w-4 ${activeTab === 'partitions' ? 'text-white' : 'text-gray-500'}`} />
                <span>Partitions</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('transfer-fees')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                activeTab === 'transfer-fees'
                  ? 'bg-[#2C736C] text-white shadow'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <Settings className={`h-4 w-4 ${activeTab === 'transfer-fees' ? 'text-white' : 'text-gray-500'}`} />
                <span>Transfer Fees</span>
              </div>
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex justify-center items-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <>
            {/* Exchange Rates Tab */}
            {activeTab === 'exchange-rates' && (
              <div className="space-y-6">
                    {/* Add New Rate Form */}
                    <div className="bg-white rounded-2xl shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-indigo-600" />
                        Add / Update Rate
                  </h2>
                  
                  <form onSubmit={handleSaveExchangeRate} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Month
                        </label>
                        <select
                          value={newRate.month}
                          onChange={(e) => setNewRate({ ...newRate, month: e.target.value })}
                          className="w-full md:w-44 px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {monthNames.map((name, idx) => (
                            <option key={idx + 1} value={idx + 1}>
                              {name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Year
                        </label>
                        <select
                          value={newRate.year}
                          onChange={(e) => setNewRate({ ...newRate, year: e.target.value })}
                          className="w-full md:w-44 px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        >
                          {yearOptions.map(year => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Rate (EGP per USD) *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={newRate.rate}
                          onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })}
                          placeholder="31.50"
                          className="w-full md:w-48 px-3 py-2 rounded-lg bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Source
                        </label>
                        <input
                          type="text"
                          value={newRate.source}
                          onChange={(e) => setNewRate({ ...newRate, source: e.target.value })}
                          placeholder="Central Bank, Manual Entry, etc."
                          className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Notes
                        </label>
                        <input
                          type="text"
                          value={newRate.notes}
                          onChange={(e) => setNewRate({ ...newRate, notes: e.target.value })}
                          placeholder="Optional notes"
                          className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                      {saving ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save Rate
                        </>
                      )}
                      </button>
                      <button
                        type="button"
                        onClick={() => fetchExchangeRates()}
                        className="text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                      >
                        Refresh
                      </button>
                    </div>
                  </form>
                </div>

                {/* Exchange Rates Table */}
                <div className="bg-white rounded-2xl shadow-sm">
                  <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">
                      Exchange Rates for {selectedYear}
                    </h2>
                    <select
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                      className="px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      {yearOptions.map(year => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Month
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Rate (EGP per USD)
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Source
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Last Updated
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {monthNames.map((name, idx) => {
                          const rate = getRateForMonth(idx + 1);
                          return (
                            <tr key={idx} className={!rate ? 'bg-gray-50' : ''}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {name}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                                {rate?.rate ? (
                                  <span className="font-mono">{rate.rate.toFixed(2)}</span>
                                ) : (
                                  <span className="text-gray-400 italic">Not set</span>
                                )}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                {rate?.source || '-'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                                {rate ? new Date(rate.updatedAt).toLocaleDateString() : '-'}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                {rate ? (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                    Set
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                    Pending
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Info Box */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                      <p className="font-medium mb-1">About Exchange Rates</p>
                      <p>
                        Exchange rates are used when generating teacher invoices. The system uses the rate
                        set for the invoice month. If no rate is set, invoice generation will fail. 
                        Rates should be updated monthly before generating invoices.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Salary Partitions Tab */}
            {activeTab === 'partitions' && settings && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm">
                  <div className="p-4">
                    <h2 className="text-lg font-semibold text-gray-900">Hourly Rate Partitions</h2>
                    <p className="text-sm text-gray-600 mt-1">Configure hourly USD rates by class type.</p>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {settings.ratePartitions.map((partition) => (
                      <div key={partition.name} className="p-6">
                        <div className="flex items-start justify-between gap-6">
                          <div className="flex-1">
                            <h3 className="text-lg font-medium text-gray-900">{partition.name}</h3>
                            <p className="text-sm text-gray-600 mt-1">{partition.description}</p>
                            
                            {editingPartition === partition.name ? (
                              <div className="mt-4 space-y-3">
                                <div>
                                  <label className="block text-sm font-medium text-gray-700 mb-1">Rate (USD per hour)</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    defaultValue={partition.rateUSD || 0}
                                    id={`rate-${partition.name}`}
                                    className="w-full max-w-xs px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                  />
                                </div>
                                
                                <div className="flex items-center gap-2">
                                  <input
                                    type="checkbox"
                                    id={`apply-drafts-${partition.name}`}
                                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                                  />
                                  <label htmlFor={`apply-drafts-${partition.name}`} className="text-sm text-gray-700">Apply to draft invoices</label>
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => {
                                      const rate = document.getElementById(`rate-${partition.name}`).value;
                                      const applyToDrafts = document.getElementById(`apply-drafts-${partition.name}`).checked;
                                      handleUpdatePartition(partition.name, rate, applyToDrafts);
                                    }}
                                    disabled={saving}
                                    className="inline-flex items-center justify-center rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56] disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditingPartition(null)}
                                    className="inline-flex items-center justify-center rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 flex items-center gap-4">
                                <div className="text-2xl font-bold text-indigo-600">${partition.rateUSD?.toFixed(2) || '0.00'}/hr</div>
                                <button
                                  onClick={() => setEditingPartition(partition.name)}
                                  className="text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                                >
                                  Edit
                                </button>
                              </div>
                            )}

                            {partition.history && partition.history.length > 0 && (
                              <div className="mt-2 text-xs text-gray-500">Last updated: {new Date(partition.history[partition.history.length - 1].changedAt).toLocaleDateString()}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Info Box */}
                <div className="bg-blue-50 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                      <p className="font-medium mb-1">About Partitions</p>
                      <p>Each class type has its own USD rate. Applying changes to drafts updates pending invoices only.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Transfer Fees Tab */}
            {activeTab === 'transfer-fees' && settings && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl shadow-sm">
                  <div className="p-4">
                    <h2 className="text-lg font-semibold text-gray-900">Default Transfer Fees</h2>
                    <p className="text-sm text-gray-600 mt-1">Configure default bank transfer fees (overridable per invoice).</p>
                  </div>

                  <div className="p-6 space-y-6">
                    {/* Fixed Fee */}
                    <div>
                      <h3 className="text-base font-medium text-gray-900 mb-3">Fixed Fee (EGP)</h3>
                      
                      {editingTransferFee === 'fixed' ? (
                        <div className="space-y-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={settings?.defaultTransferFee?.fixed?.value || 0}
                            id="fixed-fee"
                            className="w-full max-w-xs px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const value = document.getElementById('fixed-fee').value;
                                handleUpdateTransferFee('fixed', value);
                              }}
                              disabled={saving}
                              className="inline-flex items-center justify-center rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingTransferFee(null)}
                              className="inline-flex items-center justify-center rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-4">
                          <div className="text-xl font-bold text-gray-900">{settings?.defaultTransferFee?.fixed?.value?.toFixed(2) || '0.00'} EGP</div>
                          <button
                            onClick={() => setEditingTransferFee('fixed')}
                            className="text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Percentage Fee */}
                    <div>
                      <h3 className="text-base font-medium text-gray-900 mb-3">Percentage Fee (%)</h3>
                      
                      {editingTransferFee === 'percentage' ? (
                        <div className="space-y-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            defaultValue={settings?.defaultTransferFee?.percentage?.value || 0}
                            id="percentage-fee"
                            className="w-full max-w-xs px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                const value = document.getElementById('percentage-fee').value;
                                handleUpdateTransferFee('percentage', value);
                              }}
                              disabled={saving}
                              className="inline-flex items-center justify-center rounded-lg bg-[#2C736C] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#245b56] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingTransferFee(null)}
                              className="inline-flex items-center justify-center rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-4">
                          <div className="text-xl font-bold text-gray-900">{settings?.defaultTransferFee?.percentage?.value?.toFixed(2) || '0.00'}%</div>
                          <button
                            onClick={() => setEditingTransferFee('percentage')}
                            className="text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info Box */}
                <div className="bg-blue-50 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                      <p className="font-medium mb-1">About Transfer Fees</p>
                      <p>Transfer fees are deducted when paying teachers. Defaults apply to new invoices but can be overridden.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SalarySettings;
