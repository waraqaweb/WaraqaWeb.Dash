/**
 * Salary Settings Modal - Compact version
 * 
 * Features:
 * - Manage monthly exchange rates (EGP per USD)
 * - Configure salary rate partitions (Online 1-1, Online Group, In-Person)
 * - Set default transfer fees
 * - Apply rate changes to draft invoices
 */

import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  DollarSign,
  TrendingUp,
  Save,
  AlertCircle,
  CheckCircle,
  Info,
  RefreshCw,
  X,
  Edit,
  Calendar,
  Settings,
  Plus,
  Trash2
} from 'lucide-react';

const SalarySettingsModal = ({ onClose, onUpdate }) => {
  // State
  const [activeTab, setActiveTab] = useState('exchange-rates');
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

  // Settings State
  const [settings, setSettings] = useState(null);
  const [editingPartition, setEditingPartition] = useState(null);
  const [editingTransferFee, setEditingTransferFee] = useState(false);
  const [editingPartitions, setEditingPartitions] = useState(false);
  const [tempPartitions, setTempPartitions] = useState([]);
  const [editingRate, setEditingRate] = useState(null); // { month, year, rate }

  // Helpers for dynamic tier rows
  const generateTempId = () => `tier-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const clonePartitions = (list = []) =>
    list.map((partition) => ({
      ...partition,
      tempId: partition.tempId || partition._id || generateTempId()
    }));

  const createPartitionTemplate = (list = tempPartitions) => {
    const last = list[list.length - 1];
    const lastMax = last ? Number(last.maxHours) : null;
    const hasValidLastMax = last && !Number.isNaN(lastMax) && lastMax !== 99999;
    const minHoursBase = hasValidLastMax ? lastMax + 0.01 : 0;
    const minHours = parseFloat(minHoursBase.toFixed(2));
    const maxHours = parseFloat((minHoursBase + 10).toFixed(2));

    return {
      name: `Tier ${list.length + 1}`,
      description: 'Custom rate tier',
      minHours,
      maxHours,
      rateUSD: last?.rateUSD || 1,
      isActive: true,
      tempId: generateTempId()
    };
  };

  const handleAddPartitionRow = () => {
    setTempPartitions((prev) => [...prev, createPartitionTemplate(prev)]);
  };

  const handleRemovePartitionRow = (index) => {
    setTempPartitions((prev) => {
      if (prev.length <= 1) {
        setError('At least one tier is required.');
        return prev;
      }
      return prev.filter((_, idx) => idx !== index);
    });
  };

  // Round helper to two decimals
  const roundTwo = (n) => {
    if (n == null || Number.isNaN(Number(n))) return n;
    return Math.round(Number(n) * 100) / 100;
  };

  // Fetch data on mount and when tab/year changes
  useEffect(() => {
    if (activeTab === 'exchange-rates') {
      fetchExchangeRates();
    } else {
      fetchSettings();
    }
  }, [activeTab, selectedYear]);

  // Initialize tempPartitions when settings load
  useEffect(() => {
    if (settings?.ratePartitions) {
      setTempPartitions(clonePartitions(settings.ratePartitions));
    }
  }, [settings]);

  // Fetch exchange rates for a year
  const fetchExchangeRates = async () => {
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
  };

  // Fetch salary settings
  const fetchSettings = async () => {
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
  };

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
      
      setNewRate({
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear(),
        rate: '',
        source: 'Manual Entry',
        notes: ''
      });

      fetchExchangeRates();
      if (onUpdate) onUpdate();

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
      if (onUpdate) onUpdate();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating partition:', err);
      setError(err.response?.data?.error || 'Failed to update partition');
    } finally {
      setSaving(false);
    }
  };

  // Save all partition tiers
  const handleSavePartitions = async () => {
    try {
      setSaving(true);
      setError(null);

      // Validate partitions
      for (let i = 0; i < tempPartitions.length; i++) {
        const p = tempPartitions[i];
        if (p.minHours == null || isNaN(p.minHours) || p.minHours < 0 || p.maxHours == null || isNaN(p.maxHours) || p.maxHours < p.minHours || p.rateUSD == null || isNaN(p.rateUSD) || p.rateUSD <= 0) {
          setError(`Invalid values in tier ${i + 1}: ensure min ≥ 0, max ≥ min, and rate > 0`);
          return;
        }
      }

      const sanitizedPartitions = tempPartitions.map(({ tempId, _id, __v, ...rest }) => ({ ...rest }));

      await api.put('/teacher-salary/admin/settings/rate-partitions', {
        ratePartitions: sanitizedPartitions
      });

      setSuccessMessage('Rate tiers updated successfully');
      setEditingPartitions(false);
      fetchSettings();
      if (onUpdate) onUpdate();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating partitions:', err);
      setError(err.response?.data?.error || 'Failed to update rate tiers');
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
      if (onUpdate) onUpdate();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating transfer fee:', err);
      setError(err.response?.data?.error || 'Failed to update transfer fee');
    } finally {
      setSaving(false);
    }
  };

  // Generate year options - longer list from 5 years ago to 3 years ahead
  const yearOptions = [];
  const currentYear = new Date().getFullYear();
  for (let i = currentYear - 5; i <= currentYear + 3; i++) {
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

  // Format hours to two decimals for display (handles infinity sentinel 99999)
  const formatHours = (v) => {
    if (v == null) return '—';
    if (Number(v) === 99999) return '∞';
    const n = Number(v);
    if (isNaN(n)) return '—';
    return `${n.toFixed(2)}h`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header - Google Forms Style */}
        <div className="sticky top-0 bg-white/95 px-6 py-4 shadow-sm flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-normal text-gray-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-600" />
            Salary Settings
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-600"
            aria-label="Close salary settings"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mx-6 mt-3 p-3 bg-red-50 rounded-lg shadow-sm flex items-start gap-3 text-red-800">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 text-sm">{error}</div>
            <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800 text-sm" aria-label="Dismiss error">×</button>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-3 p-3 bg-green-50 rounded-lg shadow-sm flex items-start gap-3 text-green-800">
            <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 text-sm">{successMessage}</div>
            <button onClick={() => setSuccessMessage(null)} className="text-green-600 hover:text-green-800 text-sm" aria-label="Dismiss success">×</button>
          </div>
        )}

        {/* Tabs - modern pill tabs */}
        <div className="px-6 py-4 bg-white/50">
          <div className="inline-flex items-center gap-2 bg-gray-100/60 p-1 rounded-full shadow-sm">
            <button
              onClick={() => setActiveTab('exchange-rates')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                activeTab === 'exchange-rates' ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <DollarSign className={`h-4 w-4 ${activeTab === 'exchange-rates' ? 'text-white' : 'text-gray-500'}`} />
                <span>Exchange</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('partitions')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                activeTab === 'partitions' ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <TrendingUp className={`h-4 w-4 ${activeTab === 'partitions' ? 'text-white' : 'text-gray-500'}`} />
                <span>Tiers</span>
              </div>
            </button>

            <button
              onClick={() => setActiveTab('transfer-fees')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                activeTab === 'transfer-fees' ? 'bg-indigo-600 text-white shadow' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-center gap-2">
                <Settings className={`h-4 w-4 ${activeTab === 'transfer-fees' ? 'text-white' : 'text-gray-500'}`} />
                <span>Fees</span>
              </div>
            </button>
          </div>
        </div>

        {/* Compact Content */}
        <div className="p-1">
          {loading ? (
            <div className="flex justify-center items-center py-8">
              <LoadingSpinner size="md" />
            </div>
          ) : (
            <>
              {/* Exchange Rates Tab - Google Forms Style */}
              {activeTab === 'exchange-rates' && (
                <div className="space-y-4">
                  {/* Add/Update Rate Form - Google Style */}
                  <div className="bg-white rounded-2xl shadow-sm p-4">
                    <h3 className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-indigo-600" />
                      Add / Update Rate
                    </h3>

                    <form onSubmit={handleSaveExchangeRate} className="space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-56">
                          <label className="block text-xs text-gray-600 mb-1">Month</label>
                          <select
                            value={newRate.month}
                            onChange={(e) => setNewRate({ ...newRate, month: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-200 text-sm"
                          >
                            {monthNames.map((name, idx) => (
                              <option key={idx + 1} value={idx + 1}>{name}</option>
                            ))}
                          </select>
                        </div>

                        <div className="w-36">
                          <label className="block text-xs text-gray-600 mb-1">Year</label>
                          <select
                            value={newRate.year}
                            onChange={(e) => setNewRate({ ...newRate, year: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-200 text-sm"
                          >
                            {yearOptions.map(year => (
                              <option key={year} value={year}>{year}</option>
                            ))}
                          </select>
                        </div>

                        <div className="flex-1 max-w-xs">
                          <label className="block text-xs text-gray-600 mb-1">Rate (EGP per USD)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={newRate.rate}
                            onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })}
                            placeholder="31.50"
                            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200 text-sm"
                            required
                          />
                        </div>

                        <div className="flex-shrink-0">
                          <button
                            type="submit"
                            disabled={saving}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
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
                        </div>
                        <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-800">Rates — {selectedYear}</h3>
                      <select
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                        className="px-3 py-2 text-sm rounded-lg bg-white border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-200"
                      >
                        {yearOptions.map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                    </div>
                      </div>
                    </form>
                  </div>

                  {/* Exchange Rates Grid - Google Style with Edit */}
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    

                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
                      {monthNames.map((name, idx) => {
                        const rate = getRateForMonth(idx + 1);
                        const isEditing = editingRate?.month === idx + 1 && editingRate?.year === selectedYear;
                        
                        return (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg transition-all ${
                                rate
                                  ? 'bg-gray-50 hover:bg-gray-100 cursor-pointer'
                                  : 'bg-gray-100 border border-dashed border-gray-300'
                              }`}
                            onClick={() => {
                              if (rate && !isEditing) {
                                setEditingRate({ month: idx + 1, year: selectedYear, rate: rate.rate });
                              }
                            }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-normal text-gray-800">{name.substring(0, 3)}</span>
                              {rate ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-normal bg-gray-200 text-gray-700">
                                  Set
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-normal bg-gray-300 text-gray-600">
                                  Not Set
                                </span>
                              )}
                            </div>
                            
                            {isEditing ? (
                              <div className="space-y-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editingRate.rate}
                                  onChange={(e) => setEditingRate({ ...editingRate, rate: e.target.value })}
                                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                  autoFocus
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        setSaving(true);
                                        await api.post('/teacher-salary/admin/exchange-rates', {
                                          month: editingRate.month,
                                          year: editingRate.year,
                                          rate: parseFloat(editingRate.rate),
                                          source: 'Manual Entry',
                                          notes: ''
                                        });
                                        setSuccessMessage('Rate updated successfully');
                                        setEditingRate(null);
                                        fetchExchangeRates();
                                        setTimeout(() => setSuccessMessage(null), 3000);
                                      } catch (err) {
                                        setError(err.response?.data?.error || 'Failed to update rate');
                                      } finally {
                                        setSaving(false);
                                      }
                                    }}
                                    className="flex-1 px-3 py-2 text-sm bg-indigo-600 text-white rounded-full hover:bg-indigo-700"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingRate(null);
                                    }}
                                    className="flex-1 px-3 py-2 text-sm bg-gray-100 text-gray-800 rounded-full hover:bg-gray-200"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm font-normal text-gray-900">
                                {rate?.rate ? (
                                  <span className="font-mono">{rate.rate.toFixed(2)}</span>
                                ) : (
                                  <span className="text-gray-400 text-xs">—</span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Info */}
                  
                </div>
              )}

              {/* Rate Partitions Tab - Google Style */}
              {activeTab === 'partitions' && (
                <div className="space-y-4">
                                   

                  {/* Rate Partitions Grid */}
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
                      <h3 className="text-sm font-medium text-gray-800">Hour-Based Rate Tiers</h3>
                      {!editingPartitions ? (
                        <button
                          onClick={() => {
                            setTempPartitions(clonePartitions(settings?.ratePartitions || []));
                            setEditingPartitions(true);
                          }}
                          className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-full hover:bg-indigo-700 flex items-center gap-2"
                          aria-label="Edit rate tiers"
                        >
                          <Edit className="h-4 w-4" aria-hidden="true" />
                          Edit
                        </button>
                      ) : (
                        <div className="flex flex-wrap gap-2 items-center">
                          <button
                            onClick={handleAddPartitionRow}
                            className="px-3 py-2 text-sm bg-white text-gray-800 rounded-full border border-gray-200 hover:border-gray-300 flex items-center gap-2"
                          >
                            <Plus className="h-4 w-4" />
                            Add Tier
                          </button>
                          <button
                            onClick={() => {
                              setEditingPartitions(false);
                              setTempPartitions(clonePartitions(settings?.ratePartitions || []));
                            }}
                            className="px-3 py-2 text-sm bg-gray-200 text-gray-800 rounded-full hover:bg-gray-300 flex items-center gap-2"
                          >
                            <X className="h-4 w-4" />
                            Cancel
                          </button>
                          <button
                            onClick={handleSavePartitions}
                            disabled={saving}
                            className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                          >
                            {saving ? (
                              <>
                                <RefreshCw className="h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="h-4 w-4" />
                                Save
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="p-4 space-y-3">
                      {(editingPartitions ? tempPartitions : settings?.ratePartitions || []).map((partition, index) => (
                        <div
                          key={partition.tempId || partition._id || `${partition.name || 'tier'}-${index}`}
                          className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex flex-wrap items-start gap-3">
                            {/* Tier Badge */}
                            <div className="flex-shrink-0">
                              <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                                <span className="text-white text-xs font-normal">{index + 1}</span>
                              </div>
                            </div>

                            {/* Hour Range */}
                            <div className="flex-1 grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1 uppercase tracking-wide">
                                  Min Hours
                                </label>
                                {editingPartitions ? (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={partition.minHours}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      const parsed = parseFloat(raw);
                                      setTempPartitions((prev) => {
                                        const updated = prev.map(p => ({ ...p }));
                                        let desired = parsed;
                                        if (index > 0) {
                                          const prevMax = Number(updated[index - 1].maxHours) || 0;
                                          const fill = prevMax === 99999 ? prevMax : roundTwo(prevMax + 0.01);
                                          if (Number.isNaN(desired) || desired < fill) {
                                            desired = fill;
                                          }
                                        }
                                        updated[index].minHours = Number.isNaN(Number(desired)) ? desired : roundTwo(desired);
                                        return updated;
                                      });
                                    }}
                                    className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                  />
                                ) : (
                                  <div className="text-sm font-normal text-gray-900">{formatHours(partition.minHours)}</div>
                                )}
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1 uppercase tracking-wide">
                                  Max Hours
                                </label>
                                {editingPartitions ? (
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={partition.maxHours}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      const parsed = parseFloat(raw);
                                      setTempPartitions((prev) => {
                                        const updated = prev.map(p => ({ ...p }));
                                        const newMax = Number.isNaN(parsed) ? parsed : roundTwo(parsed);
                                        updated[index].maxHours = newMax;
                                        // adjust next partition's min to be contiguous
                                        if (index + 1 < updated.length) {
                                          const nextFill = newMax === 99999 ? 99999 : roundTwo(Number(newMax) + 0.01);
                                          updated[index + 1].minHours = nextFill;
                                        }
                                        return updated;
                                      });
                                    }}
                                    className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                  />
                                ) : (
                                  <div className="text-sm font-normal text-gray-900">{formatHours(partition.maxHours)}</div>
                                )}
                              </div>
                              {/* remove button moved into Rate column to keep it inline */}
                            </div>

                              {/* Rate */}
                              <div className="flex-shrink-0 w-36">
                                <label className="block text-xs font-medium text-gray-600 mb-1 uppercase tracking-wide">
                                  Rate (USD/hr)
                                </label>
                                {editingPartitions ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={partition.rateUSD}
                                      onChange={(e) => {
                                        const updated = [...tempPartitions];
                                        updated[index].rateUSD = parseFloat(e.target.value);
                                        setTempPartitions(updated);
                                      }}
                                      className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    />
                                    {editingPartitions && tempPartitions.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemovePartitionRow(index)}
                                        aria-label={`Remove tier ${index + 1}`}
                                        className="inline-flex items-center justify-center p-2 text-red-600 bg-white border border-red-200 rounded-full hover:bg-red-50"
                                        title="Remove tier"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="text-sm font-normal text-gray-900 font-mono">
                                    ${partition.rateUSD.toFixed(2)}
                                  </div>
                                )}
                              </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Transfer Fees Tab - Google Style */}
              {activeTab === 'transfer-fees' && (
                <div className="space-y-4">
                  

                  {/* Current Setting Display */}
                  <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50">
                      <h3 className="text-sm font-medium text-gray-800">Current Transfer Fee</h3>
                    </div>

                    <div className="p-4">
                      {editingTransferFee ? (
                        <div className="space-y-2.5">
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
                              <label className="block text-xs text-gray-600 mb-1">Fee Type</label>
                              <select
                                id="transfer-fee-model"
                                defaultValue={settings?.defaultTransferFee?.model || 'flat'}
                                className="w-full px-3 py-2 text-sm rounded-lg bg-gray-50 border border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-200"
                              >
                                <option value="flat">Flat Fee (EGP)</option>
                                <option value="percentage">Percentage (%)</option>
                                <option value="none">No Fee</option>
                              </select>
                            </div>
                            
                            <div className="flex-1">
                              <label className="block text-xs text-gray-600 mb-1">Amount / Percentage</label>
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                defaultValue={settings?.defaultTransferFee?.value || 0}
                                id="transfer-fee-value"
                                placeholder="e.g., 25 or 2.500"
                                className="w-full px-3 py-2 text-sm rounded-lg bg-white border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                              />
                            </div>

                            <button
                              onClick={() => {
                                const model = document.getElementById('transfer-fee-model').value;
                                const value = document.getElementById('transfer-fee-value').value;
                                handleUpdateTransferFee(model, value);
                              }}
                              disabled={saving}
                              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                            >
                              {saving ? (
                                <>
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <Save className="h-3 w-3" />
                                  Save
                                </>
                              )}
                            </button>
                            
                            <button
                              onClick={() => setEditingTransferFee(false)}
                              className="px-4 py-2 text-sm bg-gray-200 text-gray-800 rounded-full hover:bg-gray-300 flex items-center gap-2 whitespace-nowrap"
                            >
                              <X className="h-3 w-3" />
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs text-gray-600 mb-1">Active Fee Structure</div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-lg font-normal text-gray-900">
                                {settings?.defaultTransferFee?.model === 'flat' ? (
                                  <>EGP {settings?.defaultTransferFee?.value?.toFixed(2) || '0.00'}</>
                                ) : settings?.defaultTransferFee?.model === 'percentage' ? (
                                  <>{settings?.defaultTransferFee?.value?.toFixed(3) || '0.000'}%</>
                                ) : (
                                  <>No Fee</>
                                )}
                              </span>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-normal bg-gray-200 text-gray-700">
                                {settings?.defaultTransferFee?.model === 'flat' ? 'Flat' : 
                                 settings?.defaultTransferFee?.model === 'percentage' ? 'Percentage' : 'None'}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => setEditingTransferFee(true)}
                            className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-full hover:bg-indigo-700 flex items-center gap-2"
                          >
                            <Edit className="h-4 w-4" />
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Example Calculation */}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <DollarSign className="h-3.5 w-3.5 text-gray-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-gray-700">
                        <strong>Example:</strong> For EGP 3,000 salary with {
                          settings?.defaultTransferFee?.model === 'flat' 
                            ? `${settings?.defaultTransferFee?.value?.toFixed(2) || 0} EGP flat fee`
                            : settings?.defaultTransferFee?.model === 'percentage'
                            ? `${settings?.defaultTransferFee?.value?.toFixed(3) || 0}% fee`
                            : 'no fee'
                        }, teacher receives {
                          settings?.defaultTransferFee?.model === 'flat'
                            ? `EGP ${(3000 - (settings?.defaultTransferFee?.value || 0)).toFixed(2)}`
                            : settings?.defaultTransferFee?.model === 'percentage'
                            ? `EGP ${(3000 - (3000 * (settings?.defaultTransferFee?.value || 0) / 100)).toFixed(2)}`
                            : 'EGP 3,000.00'
                        }.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white/95 px-6 py-3 shadow-inner rounded-b-2xl">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-gray-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-700">
              {activeTab === 'exchange-rates' && 'Update monthly exchange rates before generating invoices.'}
              {activeTab === 'partitions' && 'Tiers apply to monthly hours. Edit to change rates.'}
              {activeTab === 'transfer-fees' && 'Transfer fees are deducted from payouts. Use 3 decimals for precision.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalarySettingsModal;
