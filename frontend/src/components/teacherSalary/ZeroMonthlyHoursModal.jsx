import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';
import { X, Calendar, Users, Search, CheckSquare, Square, AlertCircle, Trash2, Loader } from 'lucide-react';

const ZeroMonthlyHoursModal = ({ onClose, onSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [loadingTeachers, setLoadingTeachers] = useState(true);
  const [error, setError] = useState(null);

  // Form state
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [selectionType, setSelectionType] = useState('all'); // all or specific
  const [selectedTeachers, setSelectedTeachers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [includeInactive, setIncludeInactive] = useState(true);

  useEffect(() => {
    const now = new Date();
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    setSelectedMonth(String(previousMonth.getMonth() + 1));
    setSelectedYear(String(previousMonth.getFullYear()));
  }, []);

  useEffect(() => {
    const fetchTeachers = async () => {
      try {
        setLoadingTeachers(true);
        const response = await api.get('/users', { params: { role: 'teacher', isActive: true } });
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

  const filteredTeachers = useMemo(() => {
    if (!searchTerm) return teachers;
    const s = searchTerm.toLowerCase();
    return teachers.filter(t => `${t.firstName} ${t.lastName}`.toLowerCase().includes(s) || t.email?.toLowerCase().includes(s));
  }, [teachers, searchTerm]);

  const toggleTeacher = (id) => {
    setSelectedTeachers(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const selectAll = () => setSelectedTeachers(filteredTeachers.map(t => t._id));
  const deselectAll = () => setSelectedTeachers([]);

  const monthOptions = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ value: String(date.getMonth() + 1), year: String(date.getFullYear()), label: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
    }
    return months;
  }, []);

  const handleZero = async () => {
    if (!selectedMonth || !selectedYear) { setError('Please select month and year'); return; }
    if (selectionType === 'specific' && selectedTeachers.length === 0) { setError('Select at least one teacher'); return; }

    const teacherCount = selectionType === 'all' ? teachers.length : selectedTeachers.length;
    const monthName = new Date(parseInt(selectedYear), parseInt(selectedMonth) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const confirmMsg = `Zero monthly hours for ${teacherCount} teacher${teacherCount !== 1 ? 's' : ''} for ${monthName}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      setLoading(true);
      setError(null);

      const payload = {
        month: parseInt(selectedMonth),
        year: parseInt(selectedYear),
        includeInactive: includeInactive,
        createInvoices: true
      };
      if (selectionType === 'specific') payload.teacherIds = selectedTeachers;

      const resp = await api.post('/teacher-salary/admin/zero-monthly-hours', payload);
      const results = resp.data.results || {};
      let msg = '';
      if (results.summary) {
        msg += `✓ Zeroed ${results.summary.zeroed || 0} teachers. `;
        msg += `✓ Created ${results.summary.invoicesCreated || 0} invoices. `;
        if (results.summary.failed) msg += `⚠ ${results.summary.failed} failed. `;
      } else {
        msg = 'Operation completed';
      }

      onSuccess(msg);
      onClose();
    } catch (err) {
      console.error('Zero monthly hours failed:', err);
      setError(err.response?.data?.error || err.response?.data?.message || 'Failed to zero hours');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Zero Monthly Hours</h2>
              <p className="text-sm text-slate-500">Zero teacher monthly hours and automatically create invoices for the selected month.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" disabled={loading} aria-label="Close zero monthly hours dialog"><X className="w-5 h-5" aria-hidden="true"/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1"><p className="text-sm text-red-800">{error}</p></div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2"><Calendar className="w-4 h-4 inline mr-1"/> Select Month</label>
            <select value={`${selectedYear}-${selectedMonth}`} onChange={(e) => { const [yr,mn] = e.target.value.split('-'); setSelectedYear(yr); setSelectedMonth(mn); }} className="w-full px-4 py-2 border rounded-lg">
              {monthOptions.map(opt => (<option key={`${opt.year}-${opt.value}`} value={`${opt.year}-${opt.value}`}>{opt.label}</option>))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3"><Users className="w-4 h-4 inline mr-1"/> Selection</label>
            <div className="space-y-2">
              <label className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer">
                <input type="radio" name="selectionType" value="all" checked={selectionType === 'all'} onChange={(e) => setSelectionType(e.target.value)} />
                <div className="flex-1"><div className="font-medium">All Teachers</div><div className="text-sm text-slate-500">Affect all teachers (respecting include inactive option)</div></div>
              </label>
              <label className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer">
                <input type="radio" name="selectionType" value="specific" checked={selectionType === 'specific'} onChange={(e) => setSelectionType(e.target.value)} />
                <div className="flex-1"><div className="font-medium">Specific Teachers</div><div className="text-sm text-slate-500">Choose teachers manually</div></div>
              </label>
            </div>
          </div>

          {selectionType === 'specific' && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-slate-50 p-4 border-b space-y-3">
                <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" placeholder="Search teachers..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 py-2 border rounded-lg" />
                </div>
                <div className="flex items-center justify-between"><div className="text-sm text-slate-600">{selectedTeachers.length} of {filteredTeachers.length} selected</div>
                <div className="flex space-x-2"><button onClick={selectAll} className="text-sm text-blue-600" aria-label="Select all teachers">Select All</button><button onClick={deselectAll} className="text-sm" aria-label="Clear selection">Clear</button></div></div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {loadingTeachers ? (
                  <div className="flex items-center justify-center py-8"><LoadingSpinner size="sm"/></div>
                ) : filteredTeachers.length === 0 ? (
                  <div className="text-center py-8 text-slate-500">No teachers found</div>
                ) : (
                  <div className="divide-y">
                    {filteredTeachers.map(t => (
                      <label key={t._id} className="flex items-center p-4 cursor-pointer"><div className="flex-shrink-0">{selectedTeachers.includes(t._id) ? <CheckSquare className="w-5 h-5 text-blue-600"/> : <Square className="w-5 h-5 text-slate-400"/>}</div>
                      <input type="checkbox" checked={selectedTeachers.includes(t._id)} onChange={() => toggleTeacher(t._id)} className="sr-only" />
                      <div className="ml-3"><div className="font-medium">{t.firstName} {t.lastName}</div><div className="text-sm text-slate-500">{t.email}</div></div></label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> Include inactive teachers</label>
            <span className="text-sm text-slate-500">Invoices are automatically created before zeroing to lock monthly hours.</span>
          </div>

          <div className="bg-blue-50 border rounded-lg p-4 text-sm text-blue-800">Zeroing monthly hours is irreversible for the selected month; this action will be recorded in the audit log.</div>
        </div>

        <div className="flex items-center justify-end p-6 border-t bg-slate-50">
          <button onClick={onClose} className="px-4 py-2" aria-label="Cancel zero monthly hours">Cancel</button>
          <button onClick={handleZero} disabled={loading} className="ml-3 px-6 py-2 bg-red-600 text-white rounded-lg flex items-center" aria-label="Zero monthly hours">
            {loading ? <><Loader className="w-4 h-4 animate-spin" aria-hidden="true"/> <span className="ml-2">Processing...</span></> : <> <Trash2 className="w-4 h-4" aria-hidden="true"/> <span className="ml-2">Zero Hours</span></>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ZeroMonthlyHoursModal;
