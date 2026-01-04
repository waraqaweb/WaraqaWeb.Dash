import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';
import api from '../../api/axios';
import { 
  Calendar, 
  Clock, 
  User, 
  Users, 
  Globe, 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  Plus,
  Edit,
  Trash2,
  Eye,
  Check,
  X
} from 'lucide-react';
import VacationModal from '../../components/dashboard/VacationModal';
import VacationDetailsModal from '../../components/dashboard/VacationDetailsModal';
import GuardianStudentVacationModal from '../../components/dashboard/GuardianStudentVacationModal';

const VacationManagementPage = () => {
  const { user } = useAuth();
  const { searchTerm, globalFilter } = useSearch();

  const toLocalDateInput = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
  };

  const parseLocalDayStart = (yyyyMmDd) => {
    if (!yyyyMmDd) return null;
    const d = new Date(`${yyyyMmDd}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const parseLocalDayEnd = (yyyyMmDd) => {
    if (!yyyyMmDd) return null;
    const d = new Date(`${yyyyMmDd}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const [activeTab, setActiveTab] = useState('individual');
  const [individualVacations, setIndividualVacations] = useState([]);
  const [systemVacations, setSystemVacations] = useState([]);
  const [myVacations, setMyVacations] = useState([]);
  const [loading, setLoading] = useState(true);

  const [summaryFrom, setSummaryFrom] = useState(() => {
    const now = new Date();
    return toLocalDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [summaryTo, setSummaryTo] = useState(() => toLocalDateInput(new Date()));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState('individual'); // 'individual' or 'system'
  const [editingVacation, setEditingVacation] = useState(null);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(null);
  const [approvalAction, setApprovalAction] = useState(''); // 'approve' or 'reject'
  const [rejectionReason, setRejectionReason] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailVacation, setDetailVacation] = useState(null);
  const [detailImpact, setDetailImpact] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [showGuardianStudentModal, setShowGuardianStudentModal] = useState(false);

  const availableTabs = useMemo(() => {
    const tabs = [];

    if (user?.role === 'admin') {
      tabs.push(
        { id: 'individual', label: 'Individual Vacations', icon: User },
        { id: 'system', label: 'System Vacations', icon: Globe }
      );
    }

    if (user?.role === 'teacher') {
      tabs.push({ id: 'my-vacations', label: 'My Vacations', icon: Calendar });
    }

    if (user?.role === 'guardian') {
      tabs.push({ id: 'my-vacations', label: 'My Vacations', icon: Calendar });
    }

    return tabs;
  }, [user?.role]);

  // Ensure the active tab is always valid for the current role
  useEffect(() => {
    if (availableTabs.length === 0) return;
    const isValid = availableTabs.some((tab) => tab.id === activeTab);
    if (!isValid) setActiveTab(availableTabs[0].id);
  }, [availableTabs, activeTab]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'individual' && user?.role === 'admin') {
        const res = await api.get('/vacations');
        setIndividualVacations(res.data.vacations || []);
      } else if (activeTab === 'system' && user?.role === 'admin') {
        const res = await api.get('/system-vacations');
        setSystemVacations(res.data.systemVacations || res.data || []);
      } else if (activeTab === 'my-vacations' && user?.role === 'teacher') {
        const teacherId = user?._id || user?.id;
        const res = await api.get(`/vacations/user/${teacherId}`);
        setMyVacations(res.data.vacations || []);
      } else if (activeTab === 'my-vacations' && user?.role === 'guardian') {
        const res = await api.get('/vacations/guardian');
        setMyVacations(res.data.vacations || []);
      }
    } catch (err) {
      console.error('Error fetching vacation data:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, user?.role, user?._id, user?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateVacation = (type) => {
    setCreateType(type);
    setEditingVacation(null);
    setShowCreateModal(true);
  };

  const handleEditVacation = (vacation, typeHint = 'individual') => {
    setEditingVacation(vacation);
    setCreateType(typeHint);
    setShowCreateModal(true);
  };

  const handleApproveReject = (vacation, action) => {
    setPendingApproval(vacation);
    setApprovalAction(action);
    setRejectionReason('');
    setShowApprovalModal(true);
  };

  const handleApprovalSubmit = async () => {
    if (!pendingApproval) return;

    try {
      const approved = approvalAction === 'approved';
      await api.post(`/vacations/${pendingApproval._id}/approval`, {
        approved,
        rejectionReason: approved ? undefined : rejectionReason
      });
      await fetchData();
      setShowApprovalModal(false);
      setPendingApproval(null);
    } catch (err) {
      console.error('Error updating vacation status:', err);
      alert('Error updating vacation status. Please try again.');
    }
  };

  const handleDeleteVacation = async (vacation) => {
    if (!window.confirm('Are you sure you want to delete this vacation?')) return;

    try {
      if (!vacation.name && !['pending', 'rejected'].includes(vacation.status)) {
        alert('Only pending or rejected vacations can be deleted. Consider ending the vacation early instead.');
        return;
      }
      const endpoint = vacation.name 
        ? `/system-vacations/${vacation._id}`
        : `/vacations/${vacation._id}`;

      await api.delete(endpoint);
      await fetchData();
    } catch (err) {
      console.error('Error deleting vacation:', err);
      alert('Error deleting vacation. Please try again.');
    }
  };

  const handleTerminateSystemVacation = async (vacation) => {
    if (!window.confirm('Are you sure you want to terminate this system vacation?')) return;

    try {
      await api.post(`/system-vacations/${vacation._id}/end`);
      await fetchData();
    } catch (err) {
      console.error('Error terminating system vacation:', err);
      alert('Error terminating system vacation. Please try again.');
    }
  };

  const handleEndVacationEarly = async (vacation) => {
    const actionLabel = vacation.lifecycleStatus === 'approved' ? 'shorten this vacation' : 'end this vacation now';
    if (!window.confirm(`Are you sure you want to ${actionLabel}?`)) return;

    let endDatePayload = undefined;
    if (vacation.lifecycleStatus === 'approved' && new Date(vacation.startDate) > new Date()) {
      const newEndInput = window.prompt('Enter the new end date (YYYY-MM-DD) or leave blank to keep the current end date:');
      if (newEndInput) {
        const parsed = new Date(newEndInput);
        if (isNaN(parsed.getTime())) {
          alert('Invalid date provided. Please use YYYY-MM-DD format.');
          return;
        }
        endDatePayload = parsed.toISOString();
      }
    }

    const reason = window.prompt('Optional note about ending this vacation early:') || undefined;

    try {
      await api.post(`/vacations/${vacation._id}/end`, {
        endDate: endDatePayload,
        reason
      });
      await fetchData();
    } catch (err) {
      console.error('Error ending vacation early:', err);
      alert(err.response?.data?.message || 'Failed to end vacation early.');
    }
  };

  const handleVacationSuccess = async () => {
    await fetchData();
    setShowCreateModal(false);
    setEditingVacation(null);
  };

  const handleViewVacationDetails = async (vacation) => {
    if (!vacation?._id) return;
    setShowDetailsModal(true);
    setDetailLoading(true);
    setDetailError('');
    setDetailImpact(null);
    setDetailVacation(vacation);

    try {
      const res = await api.get(`/vacations/${vacation._id}/impact`);
      setDetailVacation(res.data?.vacation || vacation);
      setDetailImpact(res.data?.impact || null);
    } catch (err) {
      console.error('Error loading vacation details:', err);
      setDetailError(err.response?.data?.message || 'Failed to load vacation details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCloseDetails = () => {
    setShowDetailsModal(false);
    setDetailVacation(null);
    setDetailImpact(null);
    setDetailError('');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'approved': return 'text-green-600 bg-green-50 border-green-200';
      case 'rejected': return 'text-red-600 bg-red-50 border-red-200';
      case 'pending': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'active': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'ended': return 'text-gray-600 bg-gray-100 border-gray-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved': return <CheckCircle className="h-4 w-4" />;
      case 'rejected': return <XCircle className="h-4 w-4" />;
      case 'pending': return <AlertCircle className="h-4 w-4" />;
      case 'active': return <Clock className="h-4 w-4" />;
      case 'ended': return <CheckCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const formatDateTime = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const filteredIndividualVacations = individualVacations.filter(vacation => {
    const teacherFirst = vacation.user?.firstName || vacation.teacher?.firstName || '';
    const teacherLast = vacation.user?.lastName || vacation.teacher?.lastName || '';
    const teacherFull = vacation.user?.fullName || `${teacherFirst} ${teacherLast}`;
    const matchesSearch = teacherFull.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vacation.reason?.toLowerCase().includes(searchTerm.toLowerCase());
    const status = vacation.lifecycleStatus || vacation.status;
    const matchesFilter = globalFilter === 'all' || status === globalFilter;
    return matchesSearch && matchesFilter;
  });

  const filteredSystemVacations = systemVacations.filter(vacation => {
    const matchesSearch = vacation.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         vacation.message?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = globalFilter === 'all' || vacation.status === globalFilter;
    return matchesSearch && matchesFilter;
  });

  const filteredMyVacations = myVacations.filter(vacation => {
    const matchesSearch = vacation.reason?.toLowerCase().includes(searchTerm.toLowerCase());
    const status = vacation.lifecycleStatus || vacation.status;
    const matchesFilter = globalFilter === 'all' || status === globalFilter;
    return matchesSearch && matchesFilter;
  });

  const groupedGuardianMyVacations = useMemo(() => {
    if (user?.role !== 'guardian') return [];

    const localDayKey = (value) => {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const minuteBucket = (value) => {
      const d = value ? new Date(value) : null;
      const ms = d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
      return Math.floor(ms / 60000);
    };

    const groups = new Map();

    for (const v of (filteredMyVacations || [])) {
      if (!v) continue;
      const status = v.lifecycleStatus || v.status || 'pending';
      const startKey = localDayKey(v.startDate);
      const endKey = localDayKey(v.effectiveEndDate || v.actualEndDate || v.endDate);
      const createdBucket = minuteBucket(v.createdAt);
      const reason = v.reason || '';
      const key = `${status}::${startKey}::${endKey}::${reason}::${createdBucket}`;

      const existing = groups.get(key) || {
        key,
        status,
        reason,
        startDate: v.startDate,
        endDate: v.effectiveEndDate || v.actualEndDate || v.endDate,
        createdAt: v.createdAt,
        vacations: [],
        studentNames: []
      };

      existing.vacations.push(v);
      if (v.userName) existing.studentNames.push(v.userName);
      groups.set(key, existing);
    }

    const normalize = (name) => String(name || '').trim();

    return Array.from(groups.values())
      .map((g) => {
        const deduped = Array.from(new Set((g.studentNames || []).map(normalize).filter(Boolean)));
        deduped.sort((a, b) => a.localeCompare(b));
        return { ...g, studentNames: deduped };
      })
      .sort((a, b) => {
        const aMs = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bMs = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bMs - aMs;
      });
  }, [filteredMyVacations, user?.role]);

  const handleDeleteGuardianVacationGroup = async (group) => {
    if (!group || !Array.isArray(group.vacations) || group.vacations.length === 0) return;

    const canDelete = group.vacations.every((v) => {
      const status = v.lifecycleStatus || v.status;
      return ['pending', 'rejected'].includes(status);
    });

    if (!canDelete) {
      alert('Only pending or rejected vacations can be deleted.');
      return;
    }

    const confirmMsg = `Delete this vacation request for ${group.vacations.length} student${group.vacations.length === 1 ? '' : 's'}?`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await Promise.allSettled(group.vacations.map((v) => api.delete(`/vacations/${v._id}`)));
      await fetchData();
    } catch (e) {
      console.error('Error deleting guardian vacation group', e);
      alert('Error deleting vacation request. Please try again.');
    }
  };

  const vacationSummaryRows = useMemo(() => {
    if (user?.role !== 'admin') return [];

    const rangeStart = parseLocalDayStart(summaryFrom);
    const rangeEnd = parseLocalDayEnd(summaryTo);
    if (!rangeStart || !rangeEnd) return [];

    if (rangeEnd < rangeStart) return [];

    const overlapMs = (start, end) => {
      if (!start || !end) return 0;
      const startMs = start.getTime();
      const endMs = end.getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
      if (endMs <= startMs) return 0;
      const oStart = Math.max(startMs, rangeStart.getTime());
      const oEnd = Math.min(endMs, rangeEnd.getTime());
      return Math.max(0, oEnd - oStart);
    };

    const formatAggregate = (ms) => {
      const hours = ms / (1000 * 60 * 60);
      if (hours < 24) {
        const val = Math.round(hours * 10) / 10;
        return `${val}${val === 1 ? ' hr' : ' hrs'}`;
      }
      const days = hours / 24;
      if (days < 30) {
        const val = Math.round(days * 10) / 10;
        return `${val}${val === 1 ? ' day' : ' days'}`;
      }
      const months = days / 30;
      const val = Math.round(months * 10) / 10;
      return `${val}${val === 1 ? ' month' : ' months'}`;
    };

    const getTeacherAllowance = (teacherUser) => {
      const ti = teacherUser?.teacherInfo;
      const raw =
        ti?.vacationAllowanceDaysPerYear ??
        ti?.vacationDaysPerYear ??
        ti?.allowedVacationDaysPerYear ??
        ti?.vacationAllowanceDays ??
        null;
      const numeric = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof numeric === 'number' && Number.isFinite(numeric) && numeric > 0) {
        return `${numeric} days/year`;
      }
      return '—';
    };

    const totals = new Map();

    (individualVacations || []).forEach((vacation) => {
      if (!vacation) return;
      if (vacation.role && vacation.role !== 'teacher') return;

      const status = vacation.lifecycleStatus || vacation.status || vacation.approvalStatus;
      if (['rejected', 'cancelled'].includes(status)) return;

      const teacherId = String(vacation.user?._id || vacation.user?.id || vacation.teacher?._id || vacation.teacher || '');
      if (!teacherId) return;

      const teacherName =
        vacation.user?.fullName ||
        `${vacation.user?.firstName || vacation.teacher?.firstName || ''} ${vacation.user?.lastName || vacation.teacher?.lastName || ''}`.trim() ||
        vacation.user?.email ||
        'Unknown teacher';

      const start = new Date(vacation.startDate);
      const end = new Date(vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate);
      const duration = overlapMs(start, end);
      if (duration <= 0) return;

      const existing = totals.get(teacherId) || {
        teacherId,
        teacherName,
        totalMs: 0,
        vacationCount: 0,
        allowance: getTeacherAllowance(vacation.user)
      };

      existing.totalMs += duration;
      existing.vacationCount += 1;
      totals.set(teacherId, existing);
    });

    return Array.from(totals.values())
      .map((row) => ({
        ...row,
        totalLabel: formatAggregate(row.totalMs)
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [user?.role, individualVacations, summaryFrom, summaryTo]);

  const renderIndividualVacations = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Individual Vacations</h2>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => handleCreateVacation('individual')}
            className="bg-custom-teal text-white px-4 py-2 rounded-lg hover:bg-custom-teal-dark flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>Create Vacation</span>
          </button>
        </div>
      </div>

      {/* Summary */}
      {user?.role === 'admin' && (
        <div className="bg-white rounded-lg shadow p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Vacation summary</h3>
              <p className="text-sm text-gray-600">Totals are based on vacations overlapping the selected period.</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input
                  type="date"
                  value={summaryFrom}
                  onChange={(e) => setSummaryFrom(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input
                  type="date"
                  value={summaryTo}
                  onChange={(e) => setSummaryTo(e.target.value)}
                  className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
            </div>
          </div>

          {(() => {
            const start = parseLocalDayStart(summaryFrom);
            const end = parseLocalDayEnd(summaryTo);
            const invalid = !start || !end || end < start;
            if (invalid) {
              return <p className="mt-4 text-sm text-red-600">Select a valid date range.</p>;
            }
            if (vacationSummaryRows.length === 0) {
              return <p className="mt-4 text-sm text-gray-600">No teacher vacations found in this period.</p>;
            }

            return (
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-gray-600 border-b">
                      <th className="py-2 pr-4">Teacher</th>
                      <th className="py-2 pr-4">Vacations</th>
                      <th className="py-2 pr-4">Total</th>
                      <th className="py-2">Allowance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {vacationSummaryRows.map((row) => (
                      <tr key={row.teacherId}>
                        <td className="py-2 pr-4 font-medium text-gray-900 whitespace-nowrap">{row.teacherName}</td>
                        <td className="py-2 pr-4 text-gray-700">{row.vacationCount}</td>
                        <td className="py-2 pr-4 text-gray-700 whitespace-nowrap">{row.totalLabel}</td>
                        <td className="py-2 text-gray-700 whitespace-nowrap">{row.allowance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-gray-500">Allowance appears only if it’s configured on the teacher profile.</p>
              </div>
            );
          })()}
        </div>
      )}

      {/* Vacation List */}
      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading vacations...</p>
          </div>
        ) : filteredIndividualVacations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No individual vacations found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredIndividualVacations.map((vacation) => {
              const status = vacation.lifecycleStatus || vacation.status;
              const isStudentVacation = vacation?.role === 'student';
              const teacherName = vacation.user?.fullName || `${vacation.user?.firstName || vacation.teacher?.firstName || ''} ${vacation.user?.lastName || vacation.teacher?.lastName || ''}`.trim();
              const studentName = vacation.userName || vacation.studentName || '';
              const displayName = isStudentVacation ? (studentName || 'Student') : (teacherName || 'Unknown Teacher');
              const effectiveEndDate = vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate;
              const teacherId = vacation.user?._id || vacation.user?.id || vacation.teacher?._id;
              const impactedTeachers = Array.isArray(vacation.impactedTeachers) ? vacation.impactedTeachers : [];
              const impactedTeacherNames = impactedTeachers
                .map((t) => (typeof t === 'string' ? t : (t?.name || '')))
                .filter(Boolean);

              return (
              <div key={vacation._id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">
                            {displayName}
                      </h3>
                          <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
                            {getStatusIcon(status)}
                            <span className="capitalize">{status}</span>
                      </span>
                    </div>
                    <p className="text-gray-600 mb-2">{vacation.reason}</p>
                    {isStudentVacation && impactedTeacherNames.length > 0 && (
                      <p className="text-sm text-gray-500 mb-2">Teachers: {impactedTeacherNames.join(', ')}</p>
                    )}
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                            <span>{formatDateTime(vacation.startDate)} - {formatDateTime(effectiveEndDate)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Users className="h-4 w-4" />
                            <span>{isStudentVacation ? '1 student' : `${vacation.substitutes?.length || 0} students configured`}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => handleViewVacationDetails(vacation)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    
                    {user?.role === 'admin' && (vacation.status === 'pending' || vacation.lifecycleStatus === 'pending') && (
                      <>
                        <button 
                          onClick={() => handleApproveReject(vacation, 'approved')}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                          title="Approve"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleApproveReject(vacation, 'rejected')}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Reject"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    
                    {((user?.role === 'admin') || 
                      (user?.role === 'teacher' && teacherId === (user._id || user.id) && vacation.status === 'pending')) && (
                      <button 
                        onClick={() => handleEditVacation(vacation, 'individual')}
                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                        title="Edit"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                    )}
                    
                    {((user?.role === 'admin') ||
                      (user?.role === 'teacher' && teacherId === (user._id || user.id))) &&
                      ['approved', 'active'].includes(status) && (
                        <button
                          onClick={() => handleEndVacationEarly(vacation)}
                          className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                          title="End Vacation Early"
                        >
                          <Clock className="h-4 w-4" />
                        </button>
                      )}

                    {((user?.role === 'admin') || 
                      (user?.role === 'teacher' && teacherId === (user._id || user.id) && vacation.status === 'pending')) && (
                      <button 
                        onClick={() => handleDeleteVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const renderSystemVacations = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">System Vacations</h2>
          <p className="text-gray-600">Manage institution-wide holidays and breaks</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => handleCreateVacation('system')}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>Create System Vacation</span>
          </button>
        </div>
      </div>

      {/* System Vacation List */}
      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading system vacations...</p>
          </div>
        ) : filteredSystemVacations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Globe className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No system vacations found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredSystemVacations.map((vacation) => (
              <div key={vacation._id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{vacation.name}</h3>
                      {vacation.isActive && (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium bg-green-50 text-green-600 border border-green-200">
                          <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                          <span>Active</span>
                        </span>
                      )}
                    </div>
                    <p className="text-gray-600 mb-2">{vacation.message}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                            <span>{formatDateTime(vacation.startDate)} - {formatDateTime(vacation.endDate)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Clock className="h-4 w-4" />
                        <span>Timezone: {vacation.timezone}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Users className="h-4 w-4" />
                        <span>{vacation.affectedClasses || 0} classes affected</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => handleViewVacationDetails(vacation)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    
                    <button 
                      onClick={() => handleEditVacation(vacation, 'system')}
                      className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                      title="Edit"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    
                    {vacation.isActive ? (
                      <button 
                        onClick={() => handleTerminateSystemVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                        title="Terminate Early"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleDeleteVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderMyVacations = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">My Vacations</h2>
          <p className="text-gray-600">Manage your vacation requests and view status</p>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => {
              if (user?.role === 'guardian') {
                setShowGuardianStudentModal(true);
              } else {
                handleCreateVacation('individual');
              }
            }}
            className="bg-custom-teal text-white px-4 py-2 rounded-lg hover:bg-custom-teal-dark flex items-center space-x-2"
          >
            <Plus className="h-4 w-4" />
            <span>Request Vacation</span>
          </button>
        </div>
      </div>

      {/* My Vacation List */}
      <div className="bg-white rounded-lg shadow">
        {loading ? (
          <div className="p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading your vacations...</p>
          </div>
        ) : filteredMyVacations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Calendar className="h-12 w-12 mx-auto mb-4 text-gray-300" />
            <p>No vacation requests found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {user?.role === 'guardian'
              ? groupedGuardianMyVacations.map((group) => {
                  const status = group.status;
                  const studentCount = group.vacations.length;
                  const names = group.studentNames || [];
                  const shown = names.slice(0, 4);
                  const remaining = Math.max(0, names.length - shown.length);

                  return (
                    <div key={group.key} className="p-6 hover:bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h3 className="text-lg font-semibold text-gray-900">{group.reason}</h3>
                            <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
                              {getStatusIcon(status)}
                              <span className="capitalize">{status}</span>
                            </span>
                          </div>

                          <div className="text-sm text-gray-600 mb-2">
                            Students: {studentCount}
                            {shown.length > 0 && (
                              <>
                                {' '}· {shown.join(', ')}{remaining ? ` +${remaining} more` : ''}
                              </>
                            )}
                          </div>

                          <div className="flex items-center space-x-4 text-sm text-gray-500">
                            <div className="flex items-center space-x-1">
                              <Calendar className="h-4 w-4" />
                              <span>{formatDateTime(group.startDate)} - {formatDateTime(group.endDate)}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Users className="h-4 w-4" />
                              <span>Student vacation</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleDeleteGuardianVacationGroup(group)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              : filteredMyVacations.map((vacation) => {
              const status = vacation.lifecycleStatus || vacation.status;
              const effectiveEndDate = vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate;
              const isStudentVacation = vacation.role === 'student';
              return (
              <div key={vacation._id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{vacation.reason}</h3>
                      <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
                        {getStatusIcon(status)}
                        <span className="capitalize">{status}</span>
                      </span>
                    </div>
                    {user?.role === 'guardian' && isStudentVacation && (
                      <div className="text-sm text-gray-600 mb-2">
                        Student: {vacation.userName || 'Student'}
                      </div>
                    )}
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                        <span>{formatDateTime(vacation.startDate)} - {formatDateTime(effectiveEndDate)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Users className="h-4 w-4" />
                        <span>{isStudentVacation ? 'Student vacation' : `${vacation.substitutes?.length || 0} students configured`}</span>
                      </div>
                    </div>
                    {status === 'rejected' && vacation.rejectionReason && (
                      <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-sm text-red-800">
                          <strong>Rejection Reason:</strong> {vacation.rejectionReason}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {user?.role !== 'guardian' && (
                      <button 
                        onClick={() => handleViewVacationDetails(vacation)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="View Details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    )}
                    
                    {status === 'pending' && user?.role !== 'guardian' && (
                      <>
                        <button 
                          onClick={() => handleEditVacation(vacation, 'individual')}
                          className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteVacation(vacation)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}

                    {status === 'pending' && user?.role === 'guardian' && (
                      <button 
                        onClick={() => handleDeleteVacation(vacation)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}

                    {['approved', 'active'].includes(status) && (
                      <button
                        onClick={() => handleEndVacationEarly(vacation)}
                        className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
                        title="End Vacation Early"
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="p-6">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {availableTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'individual' && renderIndividualVacations()}
      {activeTab === 'system' && renderSystemVacations()}
      {activeTab === 'my-vacations' && renderMyVacations()}

      {/* Vacation Modal */}
      <VacationModal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          setEditingVacation(null);
        }}
        type={createType}
        vacation={editingVacation}
        onSuccess={handleVacationSuccess}
      />

      <VacationDetailsModal
        isOpen={showDetailsModal}
        onClose={handleCloseDetails}
        vacation={detailVacation}
        impact={detailImpact}
        loading={detailLoading}
        error={detailError}
      />

      <GuardianStudentVacationModal
        isOpen={showGuardianStudentModal}
        onClose={() => setShowGuardianStudentModal(false)}
        onSuccess={async () => {
          await fetchData();
          setShowGuardianStudentModal(false);
        }}
      />

      {/* Approval Modal */}
      {showApprovalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              {approvalAction === 'approved' ? 'Approve' : 'Reject'} Vacation Request
            </h3>
            
            {pendingApproval && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="font-medium">{pendingApproval.user?.fullName || `${pendingApproval.user?.firstName || ''} ${pendingApproval.user?.lastName || ''}`.trim()}</p>
                <p className="text-sm text-gray-600">{pendingApproval.reason}</p>
                <p className="text-sm text-gray-500">
                  {formatDateTime(pendingApproval.startDate)} - {formatDateTime(pendingApproval.effectiveEndDate || pendingApproval.endDate)}
                </p>
              </div>
            )}

            {approvalAction === 'rejected' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rejection Reason *
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  placeholder="Please provide a reason for rejection..."
                />
              </div>
            )}

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowApprovalModal(false)}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleApprovalSubmit}
                disabled={approvalAction === 'rejected' && !rejectionReason.trim()}
                className={`px-4 py-2 text-white rounded-lg ${
                  approvalAction === 'approved' 
                    ? 'bg-green-600 hover:bg-green-700' 
                    : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {approvalAction === 'approved' ? 'Approve' : 'Reject'} Request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VacationManagementPage;