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
  ChevronDown,
  CheckSquare,
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
  const [teacherDropdownOpen, setTeacherDropdownOpen] = useState(false);
  const [releaseLoadingId, setReleaseLoadingId] = useState(null);
  const [releaseMessage, setReleaseMessage] = useState(null);

  const setMonthYearFromDate = (date) => {
    setSelectedMonth(String(date.getMonth() + 1));
    setSelectedYear(String(date.getFullYear()));
  };

  // Initialize with previous month
  useEffect(() => {
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    setMonthYearFromDate(previousMonth);
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

  // Handle form submission
  const handleGenerate = async () => {
    if (!selectedMonth || !selectedYear) {
      setError('Select a month');
      return;
    }

    if (generationType === 'specific' && selectedTeachers.length === 0) {
      setError('Select at least one teacher');
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
      setReleaseMessage(null);

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

      // Keep modal open so admins can review results and use release actions if needed.
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to generate invoices');
    } finally {
      setLoading(false);
    }
  };

  const selectedCount = generationType === 'all' ? teachers.length : selectedTeachers.length;
  const selectedMonthLabel = (selectedYear && selectedMonth)
    ? new Date(Number(selectedYear), Number(selectedMonth) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : 'Selected month';
  const selectedMonthInputValue = (selectedYear && selectedMonth)
    ? `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
    : '';
  const now = new Date();
  const quickMonthOptions = [
    { key: 'previous', label: 'Last', date: new Date(now.getFullYear(), now.getMonth() - 1, 1) },
    { key: 'current', label: 'Current', date: new Date(now.getFullYear(), now.getMonth(), 1) }
  ];
  const selectedTeacherObjects = useMemo(
    () => teachers.filter((t) => selectedTeachers.includes(t._id)),
    [teachers, selectedTeachers]
  );

  const handleReleaseLinkedClasses = async (teacherId) => {
    if (!teacherId || !selectedMonth || !selectedYear) return;
    const month = parseInt(selectedMonth);
    const year = parseInt(selectedYear);

    const confirmMsg = 'Release linked classes for this teacher in the selected month?';
    if (!window.confirm(confirmMsg)) return;

    try {
      setReleaseLoadingId(teacherId);
      setReleaseMessage(null);
      await api.post('/teacher-salary/admin/release-linked-classes', {
        teacherId,
        month,
        year
      });
      setReleaseMessage('Linked classes released. You can generate invoices again.');
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to release linked classes');
    } finally {
      setReleaseLoadingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Generate Teacher Invoices</h2>
              <p className="text-sm text-slate-500">Monthly invoice run</p>
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

              {releaseMessage && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {releaseMessage}
                </div>
              )}

              {Array.isArray(runSummary.skipped) && runSummary.skipped.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Skipped</p>
                  <ul className="space-y-1 text-sm text-slate-700">
                    {runSummary.skipped.map((item) => {
                      const reasonText = String(item.reason || '').toLowerCase();
                      const canRelease = reasonText.includes('linked') || reasonText.includes('already linked');
                      return (
                        <li key={`${item.teacherId}-${item.reason}`} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1">
                              <span className="font-medium text-slate-800">{item.teacherName || 'Teacher'}</span>
                              <span className="block text-slate-600">{item.reason || 'Skipped'}</span>
                              {item.details && (
                                <span className="block text-xs text-slate-500">
                                  {item.details.existingInvoice && `Invoice: ${item.details.existingInvoice}. `}
                                  {typeof item.details.totalCount === 'number' && `Classes: ${item.details.totalCount}. `}
                                  {typeof item.details.availableCount === 'number' && `Available: ${item.details.availableCount}. `}
                                  {typeof item.details.excludedCount === 'number' && `Linked: ${item.details.excludedCount}. `}
                                </span>
                              )}
                            </div>
                            {canRelease && item.teacherId && (
                              <button
                                type="button"
                                onClick={() => handleReleaseLinkedClasses(item.teacherId)}
                                disabled={releaseLoadingId === item.teacherId}
                                className="shrink-0 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              >
                                {releaseLoadingId === item.teacherId ? 'Releasing…' : 'Release classes'}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Month Selection */}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-slate-700">
                <Calendar className="w-4 h-4 inline mr-1" />
                Month
              </label>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                {selectedMonthLabel}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-center">
              <input
                type="month"
                value={selectedMonthInputValue}
                onChange={(e) => {
                  const [year, month] = e.target.value.split('-');
                  setSelectedYear(year || '');
                  setSelectedMonth(month ? String(Number(month)) : '');
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                disabled={loading}
              />

              <div className="flex flex-wrap gap-2">
                {quickMonthOptions.map((quick) => (
                  <button
                    key={quick.key}
                    type="button"
                    onClick={() => setMonthYearFromDate(quick.date)}
                    disabled={loading}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    {quick.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generation Type */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              <Users className="w-4 h-4 inline mr-1" />
              Scope
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setGenerationType('all')}
                disabled={loading}
                className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                  generationType === 'all'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                All teachers
              </button>

              <button
                type="button"
                onClick={() => setGenerationType('specific')}
                disabled={loading}
                className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                  generationType === 'specific'
                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                Selected teachers
              </button>
            </div>
          </div>

          {/* Teacher Selection (shown when generationType is 'specific') */}
          {generationType === 'specific' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Selected</div>
                {selectedTeacherObjects.length === 0 ? (
                  <div className="text-sm text-slate-500">No teachers selected</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selectedTeacherObjects.map((teacher) => (
                      <span key={teacher._id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                        {teacher.firstName} {teacher.lastName}
                        <button
                          type="button"
                          onClick={() => toggleTeacher(teacher._id)}
                          className="text-blue-500 hover:text-blue-700"
                          aria-label={`Remove ${teacher.firstName} ${teacher.lastName}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setTeacherDropdownOpen((prev) => !prev)}
                  disabled={loading || loadingTeachers}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <span>{selectedTeachers.length > 0 ? `${selectedTeachers.length} selected` : 'Choose teachers'}</span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${teacherDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {teacherDropdownOpen && (
                  <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                    <div className="border-b border-slate-100 p-3 space-y-2">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search teachers..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                          disabled={loading}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-500">{selectedTeachers.length}/{teachers.length}</span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={selectAll}
                            className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={deselectAll}
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="max-h-56 overflow-y-auto p-1.5">
                      {filteredTeachers.length === 0 ? (
                        <div className="px-3 py-6 text-center text-sm text-slate-500">No matches</div>
                      ) : (
                        filteredTeachers.map((teacher) => {
                          const checked = selectedTeachers.includes(teacher._id);
                          return (
                            <button
                              key={teacher._id}
                              type="button"
                              onClick={() => toggleTeacher(teacher._id)}
                              className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${checked ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700'}`}
                            >
                              <span className="truncate">{teacher.firstName} {teacher.lastName}</span>
                              {checked && <CheckSquare className="h-4 w-4" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Info box */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800 space-y-1">
                <p className="font-medium">What happens</p>
                <p>Creates or updates unpaid invoices and skips zero hours.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-200 bg-slate-50">
          <button
            onClick={handleGenerate}
            disabled={loading || loadingTeachers}
            className="px-6 py-2.5 bg-[var(--primary)] text-white rounded-lg hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors flex items-center space-x-2"
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
                <span>Generate {selectedCount > 0 ? `(${selectedCount})` : ''}</span>
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-medium transition-colors"
            disabled={loading}
            aria-label="Cancel invoice generation"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default GenerateInvoicesModal;
