/**
 * Guardians Page Component
 * 
 * Displays a searchable, filterable, and sortable list of guardians.
 * Includes detailed view with collapsible information, linked students, and payment info.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';
import { useNavigate } from 'react-router-dom';
import { formatDateDDMMMYYYY } from '../../utils/date';
import { 
  ChevronDown, 
  ChevronUp, 
  MessageCircle, 
  User, 
  Clock, 
  Globe,
  Mail, 
  Phone, 
  MapPin, 
  Users, 
  CreditCard, 
  UserX, 
  UserCheck, 
  LogIn,
  Baby,
  Edit
} from 'lucide-react';
import ProfileEditModal from '../../components/dashboard/ProfileEditModal';
import api from '../../api/axios';

const GUARDIAN_STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'all', label: 'All' }
];

const isGuardianActive = (guardian = {}) => {
  if (typeof guardian.isActive === 'boolean') {
    return guardian.isActive;
  }
  return true;
};

const GuardiansPage = () => {
  const { isAdmin, loginAsUser } = useAuth();
  const { searchTerm, globalFilter } = useSearch();
  const navigate = useNavigate();
  const [guardians, setGuardians] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const sortBy = 'firstName';
  const sortOrder = 'asc';
  const [statusFilter, setStatusFilter] = useState('active');
  const [expandedGuardian, setExpandedGuardian] = useState(null);
  const [editingGuardian, setEditingGuardian] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const itemsPerPage = 30;
  const [statusCounts, setStatusCounts] = useState({ active: 0, inactive: 0, all: 0 });
  const [hoursAdjustments, setHoursAdjustments] = useState({});

  const fetchStatusCounts = useCallback(async () => {
    try {
      const baseParams = {
        role: 'guardian',
        search: debouncedSearch || undefined,
      };

      const makeRequest = (overrides = {}) => api.get('/users', {
        params: {
          ...baseParams,
          ...overrides,
          page: 1,
          limit: 1,
        },
      });

      const [allRes, activeRes, inactiveRes] = await Promise.all([
        makeRequest(),
        makeRequest({ isActive: true }),
        makeRequest({ isActive: false }),
      ]);

      setStatusCounts({
        all: allRes.data.pagination?.total ?? (allRes.data.users?.length || 0),
        active: activeRes.data.pagination?.total ?? (activeRes.data.users?.length || 0),
        inactive: inactiveRes.data.pagination?.total ?? (inactiveRes.data.users?.length || 0),
      });
    } catch (err) {
      console.warn('Failed to fetch guardian status counts', err?.message || err);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const fetchGuardians = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        role: 'guardian',
        page: currentPage,
        limit: itemsPerPage,
        search: debouncedSearch,
        sortBy,
        order: sortOrder,
      };

      if (statusFilter !== 'all') {
        params.isActive = statusFilter === 'active';
      }

      const response = await api.get('/users', { params });
      setGuardians(response.data.users);
      setTotalPages(response.data.pagination.pages);
      await fetchStatusCounts();
    } catch (err) {
      setError('Failed to fetch guardians');
      console.error('Fetch guardians error:', err);
    } finally {
      setLoading(false);
    }
  }, [currentPage, debouncedSearch, fetchStatusCounts, itemsPerPage, sortBy, sortOrder, statusFilter]);

  useEffect(() => {
    fetchGuardians();
  }, [fetchGuardians]);

  const toggleExpanded = (guardianId) => {
    setExpandedGuardian(expandedGuardian === guardianId ? null : guardianId);
  };

  const setHoursAdjustmentValue = (guardianId, patch) => {
    setHoursAdjustments((prev) => {
      const existing = prev[guardianId] || { action: 'add', hours: '', reason: '' };
      return { ...prev, [guardianId]: { ...existing, ...patch } };
    });
  };

  const handleManualHoursAdjustment = async (guardianId) => {
    const draft = hoursAdjustments[guardianId] || { action: 'add', hours: '', reason: '' };
    const hoursValue = Number(draft.hours);
    if (!Number.isFinite(hoursValue)) {
      setError('Please enter a valid hours number');
      return;
    }

    try {
      await api.post(`/users/admin/guardians/${guardianId}/hours`, {
        action: draft.action,
        hours: hoursValue,
        reason: draft.reason || undefined,
      });

      setHoursAdjustments((prev) => ({
        ...prev,
        [guardianId]: { action: draft.action, hours: '', reason: '' },
      }));

      await fetchGuardians();
    } catch (err) {
      console.error('Manual guardian hours adjustment error:', err);
      setError(err?.response?.data?.message || 'Failed to update guardian hours');
    }
  };

  const handleStatusChange = async (guardianId, newStatus) => {
    try {
  await api.put(`/users/${guardianId}/status`, { isActive: newStatus });
      fetchGuardians(); // Refresh the list
    } catch (err) {
      setError('Failed to update guardian status');
      console.error('Update status error:', err);
    }
  };

  const handleLoginAsUser = async (userId) => {
    try {
      const result = await loginAsUser(userId);
      if (result.success) {
        navigate('/dashboard'); // Redirect to dashboard after logging in as user
      } else {
        setError(result.error || 'Failed to login as user');
      }
    } catch (err) {
      setError('An unexpected error occurred during login as user');
      console.error('Login as user error:', err);
    }
  };

  const openWhatsApp = (phone) => {
    if (phone) {
      const cleanPhone = phone.replace(/[^\d+]/g, '');
      window.open(`https://wa.me/${cleanPhone}`, '_blank');
    }
  };

  const openEmail = (email) => {
    if (email) {
      window.open(`mailto:${email}`, '_blank');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'inactive': return 'bg-red-100 text-red-800';
      case 'suspended': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredGuardians = useMemo(() => {
    let result = guardians || [];

    if (statusFilter !== 'all') {
      const desired = statusFilter === 'active';
      result = result.filter((guardian) => isGuardianActive(guardian) === desired);
    }

    if (searchTerm.trim()) {
      const globalTerm = searchTerm.toLowerCase();
      result = result.filter((g) => {
        const fullName = `${g.firstName || ''} ${g.lastName || ''}`.toLowerCase();
        return (
          fullName.includes(globalTerm) ||
          (g.email || '').toLowerCase().includes(globalTerm) ||
          (g.phone || '').toLowerCase().includes(globalTerm) ||
          String(g._id).includes(globalTerm) ||
          (g.guardianInfo?.students || []).some(s => (`${s.firstName} ${s.lastName}`).toLowerCase().includes(globalTerm))
        );
      });
    }

    if (globalFilter && globalFilter !== 'all') {
      switch (globalFilter) {
        case 'active':
          result = result.filter(g => g.isActive === true);
          break;
        case 'inactive':
          result = result.filter(g => g.isActive === false);
          break;
        default:
          break;
      }
    }

    return result;
  }, [guardians, searchTerm, globalFilter, statusFilter]);

  const sortedGuardians = useMemo(() => {
    const list = [...(filteredGuardians || [])];
    const buildNameKey = (guardian) => {
      const first = (guardian.firstName || '').trim().toLowerCase();
      const last = (guardian.lastName || '').trim().toLowerCase();
      if (sortBy === 'lastName') {
        return `${last} ${first}`.trim() || last || first;
      }
      return `${first} ${last}`.trim();
    };

    list.sort((a, b) => {
      const nameA = buildNameKey(a);
      const nameB = buildNameKey(b);
      if (nameA === nameB) {
        return (a.lastName || '').localeCompare(b.lastName || '', undefined, { sensitivity: 'base' });
      }
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    });

    if (sortOrder === 'desc') {
      list.reverse();
    }

    return list;
  }, [filteredGuardians, sortBy, sortOrder]);

  // keep the page UI mounted while loading so search inputs don't lose focus

  return (
    <div className="p-6 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto">

        {/* Error Message */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 mb-4">
            <span className="text-destructive text-sm">{error}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-6">
          {GUARDIAN_STATUS_TABS.map((tab) => {
            const isSelected = statusFilter === tab.id;
            const count = tab.id === 'all' ? statusCounts.all : (statusCounts[tab.id] || 0);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : 'bg-transparent border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{tab.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Guardians List */}
        <div className="space-y-3">
          {sortedGuardians.map((guardian) => (
            <div key={guardian._id} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
              {/* Guardian Summary */}
              <div className="p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center">
                      {guardian.profilePicture ? (
                        <img src={guardian.profilePicture} alt="Profile" className="h-full w-full rounded-full object-cover" />
                      ) : (
                        <span className="text-lg font-medium text-primary-foreground">
                          {guardian.firstName?.charAt(0)}{guardian.lastName?.charAt(0)}
                        </span>
                      )}
                    </div>

                    {/* Basic Info */}
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {guardian.firstName} {guardian.lastName}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(guardian.isActive ? 'active' : 'inactive')}`}>
                          {guardian.isActive ? 'Active' : 'Inactive'}
                        </span>
                        <span className="flex items-center">
                          <Users className="h-3 w-3 mr-1" />
                          {guardian.guardianInfo?.students?.length || 0} students
                        </span>
                        <span className="flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          {guardian.guardianInfo?.totalHours || 0} hours left
                        </span>
                        <span className="flex items-center">
                          <Globe className="h-3 w-3 mr-1" />
                          {guardian.timezone || guardian.guardianInfo?.timezone || 'UTC'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                    {/* WhatsApp */}
                    {guardian.phone && (
                      <button
                        onClick={() => openWhatsApp(guardian.phone)}
                        className="icon-button icon-button--green"
                        title="WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </button>
                    )}
                    {/* Email */}
                    {guardian.email && (
                      <button
                        onClick={() => openEmail(guardian.email)}
                        className="icon-button icon-button--blue"
                        title="Email"
                      >
                        <Mail className="h-4 w-4" />
                      </button>
                    )}

                    {/* Admin Actions */}
                    {isAdmin() && (
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          onClick={() => setEditingGuardian(guardian)}
                          className="icon-button icon-button--blue"
                          title="Edit Guardian"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleStatusChange(guardian._id, !guardian.isActive)}
                          className={`icon-button transition-colors ${guardian.isActive ? 'text-red-600' : 'text-green-600'}`}
                          title={guardian.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {guardian.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={() => handleLoginAsUser(guardian._id)}
                          className="icon-button icon-button--indigo"
                          title="Login as User"
                        >
                          <LogIn className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    {/* Expand/Collapse */}
                    <button
                      onClick={() => toggleExpanded(guardian._id)}
                      className="icon-button icon-button--muted"
                    >
                      {expandedGuardian === guardian._id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded Details */}
              {expandedGuardian === guardian._id && (
                <div className="border-t border-border bg-muted/30 p-3 space-y-6">
    {/* Guardian Info Section */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Contact Information */}
      <div>
        <h4 className="font-semibold text-foreground mb-3">Contact Information</h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center space-x-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span>{guardian.email}</span>
          </div>
          {guardian.phone && (
            <div className="flex items-center space-x-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{guardian.phone}</span>
            </div>
          )}
          {guardian.address && (
            <div className="flex items-center space-x-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span>
                {[guardian.address.city, guardian.address.state, guardian.address.country]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Guardian Details */}
      <div>
        <h4 className="font-semibold text-foreground mb-3">Guardian Details</h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center space-x-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span>Relationship: {guardian.guardianInfo?.relationship || '-'}</span>
          </div>
          <div className="flex items-center space-x-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>Total Hours: {guardian.guardianInfo?.totalHours || 0}</span>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground">Manual adjustment (admin only)</span>
              <select
                value={(hoursAdjustments[guardian._id]?.action) || 'add'}
                onChange={(e) => setHoursAdjustmentValue(guardian._id, { action: e.target.value })}
                className="h-8 rounded-md border border-border bg-input px-2 text-xs text-foreground"
              >
                <option value="add">Add</option>
                <option value="subtract">Subtract</option>
                <option value="set">Set</option>
              </select>
              <input
                type="number"
                step="0.25"
                value={(hoursAdjustments[guardian._id]?.hours) ?? ''}
                onChange={(e) => setHoursAdjustmentValue(guardian._id, { hours: e.target.value })}
                placeholder="Hours"
                className="h-8 w-24 rounded-md border border-border bg-input px-2 text-xs text-foreground"
              />
              <input
                type="text"
                value={(hoursAdjustments[guardian._id]?.reason) ?? ''}
                onChange={(e) => setHoursAdjustmentValue(guardian._id, { reason: e.target.value })}
                placeholder="Reason (optional)"
                className="h-8 w-52 max-w-full rounded-md border border-border bg-input px-2 text-xs text-foreground"
              />
              <button
                onClick={() => handleManualHoursAdjustment(guardian._id)}
                className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                Apply
              </button>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <span>
              Payment Method: {
                (() => {
                  let method = guardian.guardianInfo?.paymentMethod ?? guardian.paymentMethod ?? null;
                  if (!method || method === 'credit_card') return 'PayPal';
                  const labels = { paypal: 'PayPal', bank_transfer: 'Bank Transfer', wise: 'Wise Transfer', credit_card: 'Credit Card' };
                  return labels[method] || (typeof method === 'string' ? method : '-');
                })()
              }
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-medium">Hourly Rate:</span>
            <span>{(guardian.guardianInfo?.hourlyRate ?? guardian.hourlyRate ?? guardian.guardianInfo?.rate ?? guardian.rate) ?? 'Not set'}</span>
          </div>
        </div>
      </div>

      {/* Emergency Contact */}
      {guardian.guardianInfo?.emergencyContact && (
        <div>
          <h4 className="font-semibold text-foreground mb-3">Emergency Contact</h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center space-x-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span>{guardian.guardianInfo.emergencyContact.name}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{guardian.guardianInfo.emergencyContact.phone}</span>
            </div>
            <div className="flex items-center space-x-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span>{guardian.guardianInfo.emergencyContact.relationship}</span>
            </div>
          </div>
        </div>
      )}
    </div>

    {/* Linked Students */}
    {guardian.guardianInfo?.students && guardian.guardianInfo.students.length > 0 && (
      <div>
        <h4 className="font-semibold text-foreground mb-3">Linked Students</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {guardian.guardianInfo.students.map((student) => (
            <div key={student._id} className="bg-card border border-border rounded-lg p-3 flex flex-col space-y-1">
              <div className="flex items-center space-x-3">
                <div className="h-10 w-10 bg-secondary rounded-full flex items-center justify-center">
                  {student.profilePicture ? (
                    <img src={student.profilePicture} alt="Profile" className="h-full w-full rounded-full object-cover" />
                  ) : (
                    <span className="text-sm font-medium text-secondary-foreground">
                      {student.firstName?.charAt(0)}{student.lastName?.charAt(0)}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-medium text-foreground">{student.firstName} {student.lastName}</p>
                  <p className="text-xs text-muted-foreground">{student.hoursRemaining || 0} hours left</p>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                <div>Grade: {student.grade || '-'}</div>
                <div>School: {student.school || '-'}</div>
                <div>Subjects: {(student.subjects || []).join(', ') || '-'}</div>
                <div>DOB: {student.dateOfBirth ? formatDateDDMMMYYYY(student.dateOfBirth) : '-'}</div>
                <div>Gender: {student.gender || '-'}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}


              </div>
            </div>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center space-x-2 mt-6">
            <button
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 border border-border rounded-md bg-input text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
            >
              Previous
            </button>
            <span className="px-3 py-2 text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 border border-border rounded-md bg-input text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
            >
              Next
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && sortedGuardians.length === 0 && (
          <div className="text-center py-12">
            <Baby className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No guardians found</h3>
            <p className="text-muted-foreground">
              {searchTerm ? 'Try adjusting your search criteria.' : 'No guardians have been registered yet.'}
            </p>
          </div>
        )}
        {/* Profile Edit Modal for Guardians */}
        {editingGuardian && (
          <ProfileEditModal
            isOpen={!!editingGuardian}
            targetUser={editingGuardian}
            onClose={() => setEditingGuardian(null)}
            onSaved={() => { fetchGuardians(); setEditingGuardian(null); }}
          />
        )}
      </div>
    </div>
  );
};

export default GuardiansPage;


