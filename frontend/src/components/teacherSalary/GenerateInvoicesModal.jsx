/**
 * Generate Teacher Invoices Modal
 * Allows selecting month and teachers (all or specific)
 */

import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import {
  X,
  Calendar,
  Users,
  Search,
  CheckSquare,
  Square,
  AlertCircle,
  FileText,
  Loader
} from 'lucide-react';

const GenerateInvoicesModal = ({ onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [error, setError] = useState(null);
  const [runSummary, setRunSummary] = useState(null);

  // Form state
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [generationType, setGenerationType] = useState('all'); // 'all' or 'specific'
  const [selectedTeachers, setSelectedTeachers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Initialize with previous month
  useEffect(() => {
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    setSelectedMonth(String(previousMonth.getMonth() + 1));
    setSelectedYear(String(previousMonth.getFullYear()));
  }, []);

  // Fetch teachers
  useEffect(() => {
    const fetchTeachers = async () => {
      try {
        setLoadingTeachers(true);
        const response = await api.get('/users', {
          params: { role: 'teacher', isActive: true }
        });
        setTeachers(response.data.users || []);
      } catch (err) {
        console.error('Error fetching teachers:', err);
        setError('Failed to load teachers');
      } finally {
        setLoadingTeachers(false);
      }
    };
    fetchTeachers();
  }, []);

  // Filter teachers by search term
  const filteredTeachers = useMemo(() => {
    if (!searchTerm) return teachers;
    const search = searchTerm.toLowerCase();
    return teachers.filter(t => 
      `${t.firstName} ${t.lastName}`.toLowerCase().includes(search) ||
      t.email?.toLowerCase().includes(search)
    );
  }, [teachers, searchTerm]);

  // Handle teacher selection
  const toggleTeacher = (teacherId) => {
    setSelectedTeachers(prev => 
      prev.includes(teacherId)
        ? prev.filter(id => id !== teacherId)
        : [...prev, teacherId]
    );
  };

  const selectAll = () => {
    setSelectedTeachers(filteredTeachers.map(t => t._id));
  };

  const deselectAll = () => {
    setSelectedTeachers([]);
  };

  // Generate month options (last 12 months)
  const monthOptions = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        value: String(date.getMonth() + 1),
        year: String(date.getFullYear()),
        label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      });
    }
    return months;
  }, []);

  // Handle form submission
  const handleGenerate = async () => {
    if (!selectedMonth || !selectedYear) {
      setError('Please select a month and year');
      return;
    }

    if (generationType === 'specific' && selectedTeachers.length === 0) {
      setError('Please select at least one teacher');
      return;
    }

    const monthName = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, 1)
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const teacherCount = generationType === 'all' 
      ? teachers.length 
      : selectedTeachers.length;

    const confirmMsg = generationType === 'all'
      ? `Generate invoices for ALL ${teacherCount} teachers for ${monthName}?`
      : `Generate invoices for ${teacherCount} selected teacher${teacherCount !== 1 ? 's' : ''} for ${monthName}?`;

    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setRunSummary(null);

      const payload = {
        month: parseInt(selectedMonth),
        year: parseInt(selectedYear),
        teacherIds: generationType === 'specific' ? selectedTeachers : undefined
      };

      const response = await api.post('/teacher-salary/admin/generate', payload, {
        suppressErrorLog: true
      });

      const results = response.data.results || null;
      const created = results?.summary?.created || 0;
      const adjusted = results?.summary?.adjusted || 0;
      const adjustmentsCreated = results?.summary?.adjustmentsCreated || 0;
      const skipped = results?.summary?.skipped || 0;
      const failed = results?.summary?.failed || 0;

      // Build success message
      let message = '';
      if (created > 0) {
        message += `✓ Created ${created} new invoice${created !== 1 ? 's' : ''}. `;
      }
      if (adjusted > 0) {
        message += `✓ Adjusted ${adjusted} existing invoice${adjusted !== 1 ? 's' : ''}. `;
      }
      if (adjustmentsCreated > 0) {
        message += `✓ Created ${adjustmentsCreated} adjustment invoice${adjustmentsCreated !== 1 ? 's' : ''}. `;
      }
      if (skipped > 0) {
        message += `${skipped} skipped. `;
      }
      if (failed > 0) {
        message += `⚠ ${failed} failed. `;
      }

      if (message) {
        onSuccess(message);
      } else {
        onSuccess('Invoice generation completed.');
      }

      setRunSummary(results);

      if (skipped === 0 && failed === 0) {
        onClose();
      }
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to generate invoices');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Generate Teacher Invoices</h2>
              <p className="text-sm text-slate-500">Creates or updates unpaid invoices for the selected month</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            disabled={loading}
            aria-label="Close generate invoices dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {runSummary && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-700">
                <CheckSquare className="w-4 h-4 text-emerald-600" />
                <span>
                  Created {runSummary.summary?.created || 0}, adjusted {runSummary.summary?.adjusted || 0},
                  adjustments {runSummary.summary?.adjustmentsCreated || 0},
                  skipped {runSummary.summary?.skipped || 0}, failed {runSummary.summary?.failed || 0}.
                </span>
              </div>

              {Array.isArray(runSummary.skipped) && runSummary.skipped.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Skipped</p>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {runSummary.skipped.map((item) => (
                      <li key={`${item.teacherId}-${item.reason}`} className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-2">
                        <span className="font-medium text-slate-800">{item.teacherName || 'Teacher'}</span>
                        <span className="text-slate-600">{item.reason || 'Skipped'}</span>
                        {item.details && (
                          <span className="text-xs text-slate-500">
                            {item.details.existingInvoice && `Invoice: ${item.details.existingInvoice}. `}
                            {typeof item.details.totalCount === 'number' && `Classes: ${item.details.totalCount}. `}
                            {typeof item.details.availableCount === 'number' && `Available: ${item.details.availableCount}. `}
                            {typeof item.details.excludedCount === 'number' && `Linked: ${item.details.excludedCount}. `}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Month Selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              <Calendar className="w-4 h-4 inline mr-1" />
              Select Month
            </label>
            <select
              value={`${selectedYear}-${selectedMonth}`}
              onChange={(e) => {
                const [year, month] = e.target.value.split('-');
                setSelectedYear(year);
                setSelectedMonth(month);
              }}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              disabled={loading}
            >
              {monthOptions.map(opt => (
                <option key={`${opt.year}-${opt.value}`} value={`${opt.year}-${opt.value}`}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Generation Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">
              <Users className="w-4 h-4 inline mr-1" />
              Generate For
            </label>
            <div className="space-y-2">
              <label className="flex items-center space-x-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  type="radio"
                  name="generationType"
                  value="all"
                  checked={generationType === 'all'}
                  onChange={(e) => setGenerationType(e.target.value)}
                  className="w-4 h-4 text-blue-600"
                  disabled={loading}
                />
                <div className="flex-1">
                  <div className="font-medium text-slate-900">All Teachers</div>
                  <div className="text-sm text-slate-500">
                    Generate invoices for all {teachers.length} active teachers
                  </div>
                </div>
              </label>

              <label className="flex items-center space-x-3 p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  type="radio"
                  name="generationType"
                  value="specific"
                  checked={generationType === 'specific'}
                  onChange={(e) => setGenerationType(e.target.value)}
                  className="w-4 h-4 text-blue-600"
                  disabled={loading}
                />
                <div className="flex-1">
                  <div className="font-medium text-slate-900">Specific Teachers</div>
                  <div className="text-sm text-slate-500">
                    Choose which teachers to generate invoices for
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Teacher Selection (shown when generationType is 'specific') */}
          {generationType === 'specific' && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 p-4 border-b border-slate-200 space-y-3">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search teachers by name or email..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    disabled={loading}
                  />
                </div>

                {/* Select all/none */}
                <div className="flex items-center justify-between">
                  <div className="text-sm text-slate-600">
                    {selectedTeachers.length} of {filteredTeachers.length} selected
                  </div>
                  <div className="flex space-x-2">
                        <button
                          onClick={selectAll}
                          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          disabled={loading}
                          aria-label="Select all teachers"
                        >
                          Select All
                        </button>
                    <span className="text-slate-300">|</span>
                    <button
                      onClick={deselectAll}
                      className="text-sm text-slate-600 hover:text-slate-700 font-medium"
                      disabled={loading}
                      aria-label="Clear teacher selection"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>

              {/* Teacher list */}
              <div className="max-h-64 overflow-y-auto">
                {loadingTeachers ? (
                  <div className="flex items-center justify-center py-8">
                    <LoadingSpinner size="sm" />
                    <span className="ml-2 text-sm text-slate-500">Loading teachers...</span>
                  </div>
                ) : filteredTeachers.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">
                      {searchTerm ? 'No teachers found matching your search' : 'No active teachers found'}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {filteredTeachers.map(teacher => (
                      <label
                        key={teacher._id}
                        className="flex items-center space-x-3 p-4 hover:bg-slate-50 cursor-pointer"
                      >
                        <div className="flex-shrink-0">
                          {selectedTeachers.includes(teacher._id) ? (
                            <CheckSquare className="w-5 h-5 text-blue-600" />
                          ) : (
                            <Square className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <input
                          type="checkbox"
                          checked={selectedTeachers.includes(teacher._id)}
                          onChange={() => toggleTeacher(teacher._id)}
                          className="sr-only"
                          disabled={loading}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900">
                            {teacher.firstName} {teacher.lastName}
                          </div>
                          {teacher.email && (
                            <div className="text-sm text-slate-500 truncate">
                              {teacher.email}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Info box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800 space-y-1">
                <p className="font-medium">How it works:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>If a teacher already has an invoice for this month and no new unbilled classes, it will be skipped</li>
                  <li>If there's no invoice yet and there are unbilled classes, a new invoice will be created</li>
                  <li>If there's an unpaid invoice with new unbilled classes, it will be adjusted to include them</li>
                  <li>If the month's main invoice is already paid and new unbilled classes appear (late reports), an adjustment invoice will be created</li>
                  <li>Teachers with zero hours will be skipped</li>
                </ul>
                <p className="pt-2 text-blue-900">
                  Fields affected: creates/updates <span className="font-mono">TeacherInvoice</span> records and links classes by setting <span className="font-mono">Class.billedInTeacherInvoiceId</span>.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end space-x-3 p-6 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-700 hover:text-slate-900 font-medium transition-colors"
            disabled={loading}
            aria-label="Cancel invoice generation"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || loadingTeachers}
            className="px-6 py-2 bg-[var(--primary)] text-white rounded-lg hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center space-x-2"
            aria-label="Generate invoices"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                <span>Generate Invoices</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GenerateInvoicesModal;
