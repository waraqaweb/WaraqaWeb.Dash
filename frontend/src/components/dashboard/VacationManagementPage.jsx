import React, { useState, useEffect, useMemo } from 'react';
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
import VacationModal from './VacationModal';
import VacationDetailsModal from './VacationDetailsModal';

const VacationManagementPage = () => {
  const { user } = useAuth();
  const { searchTerm, globalFilter } = useSearch();
  const [activeTab, setActiveTab] = useState('individual');
  const [individualVacations, setIndividualVacations] = useState([]);
  const [systemVacations, setSystemVacations] = useState([]);
  const [myVacations, setMyVacations] = useState([]);
  const [loading, setLoading] = useState(true);
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

  // Determine available tabs based on user role
  const getAvailableTabs = () => {
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
    
    return tabs;
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
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
      }
    } catch (err) {
      console.error('Error fetching vacation data:', err);
    } finally {
      setLoading(false);
    }
  };

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
    if (!confirm('Are you sure you want to delete this vacation?')) return;

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
    if (!confirm('Are you sure you want to terminate this system vacation?')) return;

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
    if (!confirm(`Are you sure you want to ${actionLabel}?`)) return;

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

  // Set default tab based on user role
  useEffect(() => {
    const tabs = getAvailableTabs();
    if (tabs.length > 0 && !tabs.find(tab => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [user]);

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
              const teacherName = vacation.user?.fullName || `${vacation.user?.firstName || vacation.teacher?.firstName || ''} ${vacation.user?.lastName || vacation.teacher?.lastName || ''}`.trim();
              const effectiveEndDate = vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate;
              const teacherId = vacation.user?._id || vacation.user?.id || vacation.teacher?._id;

              return (
              <div key={vacation._id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">
                            {teacherName || 'Unknown Teacher'}
                      </h3>
                          <span className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
                            {getStatusIcon(status)}
                            <span className="capitalize">{status}</span>
                      </span>
                    </div>
                    <p className="text-gray-600 mb-2">{vacation.reason}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                            <span>{formatDateTime(vacation.startDate)} - {formatDateTime(effectiveEndDate)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Users className="h-4 w-4" />
                            <span>{vacation.substitutes?.length || 0} students configured</span>
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
            onClick={() => handleCreateVacation('individual')}
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
            {filteredMyVacations.map((vacation) => {
              const status = vacation.lifecycleStatus || vacation.status;
              const effectiveEndDate = vacation.effectiveEndDate || vacation.actualEndDate || vacation.endDate;
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
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <div className="flex items-center space-x-1">
                        <Calendar className="h-4 w-4" />
                        <span>{formatDateTime(vacation.startDate)} - {formatDateTime(effectiveEndDate)}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Users className="h-4 w-4" />
                        <span>{vacation.substitutes?.length || 0} students configured</span>
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
                    <button 
                      onClick={() => handleViewVacationDetails(vacation)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    
                    {status === 'pending' && (
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

  const availableTabs = getAvailableTabs();

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