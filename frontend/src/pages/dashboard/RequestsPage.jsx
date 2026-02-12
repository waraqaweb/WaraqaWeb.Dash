import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import useMinLoading from '../../components/ui/useMinLoading';
import {
  REQUEST_CATEGORIES,
  REQUEST_CATEGORY_LABEL_MAP,
  REQUEST_STATUS_OPTIONS,
  REQUEST_TYPE_CONFIG,
  REQUEST_TYPES,
  REQUEST_TYPE_LABEL_MAP,
} from '../../constants/requestTypes';

const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-800',
  done: 'bg-green-100 text-green-800',
  rejected: 'bg-rose-100 text-rose-800',
  delayed: 'bg-slate-200 text-slate-800',
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const emptyForm = {
  category: 'class_modification',
  type: 'change_class_time',
  title: '',
  description: '',
  urgency: 'normal',
  studentId: '',
  studentName: '',
  relatedClassId: '',
  relatedInvoiceId: '',
  details: {},
};

const toLabel = (key) => key ? key.replace(/_/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase()) : '';

const formatDateTime = (value) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
};

const normalizeFormForType = (form) => {
  const config = REQUEST_TYPE_CONFIG[form.type];
  const requiredKeys = new Set((config?.fields || []).map((f) => f.key));
  const details = Object.entries(form.details || {}).reduce((acc, [key, value]) => {
    if (!requiredKeys.has(key)) return acc;
    if (Array.isArray(value)) {
      acc[key] = value;
    } else if (typeof value === 'boolean') {
      acc[key] = value;
    } else {
      const str = String(value ?? '').trim();
      if (str !== '') acc[key] = str;
    }
    return acc;
  }, {});

  return {
    ...form,
    details,
  };
};

const RequestFormModal = ({
  open,
  onClose,
  onSubmit,
  value,
  setValue,
  students,
  role,
  isAdmin,
  loading,
}) => {
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);

  if (!open) return null;

  const typeOptions = REQUEST_TYPES.filter((item) =>
    item.roles.includes(role) || isAdmin
  );

  const selectedConfig = REQUEST_TYPE_CONFIG[value.type] || { fields: [] };

  const updateField = (fieldKey, fieldValue) => {
    setValue((prev) => ({
      ...prev,
      details: {
        ...(prev.details || {}),
        [fieldKey]: fieldValue,
      },
    }));
  };

  const selectedStudent = students.find((s) => String(s._id) === String(value.studentId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">{value._id ? 'Edit Request' : 'New Request'}</h3>
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1 text-sm">Close</button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="mb-1 block text-sm text-muted-foreground">Type</label>
            <select
              value={value.type}
              onChange={(e) => {
                const nextType = e.target.value;
                setValue((prev) => ({
                  ...prev,
                  type: nextType,
                  category: REQUEST_TYPE_CONFIG[nextType]?.category || prev.category,
                  title: REQUEST_TYPE_LABEL_MAP[nextType] || prev.title,
                  details: {},
                }));
              }}
              className="h-10 w-full rounded-md border border-border bg-input px-2"
            >
              {typeOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm text-muted-foreground">Urgency</label>
            <select
              value={value.urgency}
              onChange={(e) => setValue((prev) => ({ ...prev, urgency: e.target.value }))}
              className="h-10 w-full rounded-md border border-border bg-input px-2"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm text-muted-foreground">Description (required)</label>
            <textarea
              value={value.description}
              onChange={(e) => setValue((prev) => ({ ...prev, description: e.target.value }))}
              rows={3}
              className="w-full rounded-md border border-border bg-input px-2 py-2"
              placeholder="Write full details so admin can process without WhatsApp follow-up..."
            />
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-border p-3">
          <button
            type="button"
            onClick={() => setShowOptionalDetails((prev) => !prev)}
            className="text-sm font-medium text-primary"
          >
            {showOptionalDetails ? 'Hide optional details' : 'Add optional details (student / class / invoice)'}
          </button>

          {showOptionalDetails && (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Related class ID (optional)</label>
                <input
                  value={value.relatedClassId}
                  onChange={(e) => setValue((prev) => ({ ...prev, relatedClassId: e.target.value }))}
                  className="h-10 w-full rounded-md border border-border bg-input px-2"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Related invoice ID (optional)</label>
                <input
                  value={value.relatedInvoiceId}
                  onChange={(e) => setValue((prev) => ({ ...prev, relatedInvoiceId: e.target.value }))}
                  className="h-10 w-full rounded-md border border-border bg-input px-2"
                />
              </div>
            </div>
          )}
        </div>

        {showOptionalDetails && (
        <div className="mt-4 rounded-lg border border-border p-3">
          <h4 className="mb-2 text-sm font-semibold text-foreground">More optional details</h4>

          {(selectedConfig.fields || []).map((field) => {
            if (field.type === 'student') {
              return (
                <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-2" key={field.key}>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">{field.label}</label>
                    <select
                      value={value.studentId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        const student = students.find((s) => String(s._id) === String(nextId));
                        setValue((prev) => ({
                          ...prev,
                          studentId: nextId,
                          studentName: student ? `${student.firstName || ''} ${student.lastName || ''}`.trim() : prev.studentName,
                        }));
                      }}
                      className="h-10 w-full rounded-md border border-border bg-input px-2"
                    >
                      <option value="">Select student</option>
                      {students.map((student) => (
                        <option key={student._id} value={student._id}>
                          {(student.firstName || '').trim()} {(student.lastName || '').trim()} {student.isActive === false ? '(Inactive)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-muted-foreground">Manual student name (optional)</label>
                    <input
                      value={value.studentName}
                      onChange={(e) => setValue((prev) => ({ ...prev, studentName: e.target.value }))}
                      className="h-10 w-full rounded-md border border-border bg-input px-2"
                      placeholder="Type name if student is not linked"
                    />
                  </div>
                </div>
              );
            }

            const fieldVal = value.details?.[field.key];

            if (field.type === 'textarea') {
              return (
                <div className="mb-3" key={field.key}>
                  <label className="mb-1 block text-sm text-muted-foreground">{field.label}</label>
                  <textarea
                    rows={3}
                    value={fieldVal || ''}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    className="w-full rounded-md border border-border bg-input px-2 py-2"
                  />
                </div>
              );
            }

            if (field.type === 'select') {
              return (
                <div className="mb-3" key={field.key}>
                  <label className="mb-1 block text-sm text-muted-foreground">{field.label}</label>
                  <select
                    value={fieldVal || ''}
                    onChange={(e) => updateField(field.key, e.target.value)}
                    className="h-10 w-full rounded-md border border-border bg-input px-2"
                  >
                    <option value="">Select</option>
                    {(field.options || []).map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              );
            }

            if (field.type === 'checkbox') {
              return (
                <div className="mb-3" key={field.key}>
                  <label className="inline-flex items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={Boolean(fieldVal)}
                      onChange={(e) => updateField(field.key, e.target.checked)}
                    />
                    {field.label}
                  </label>
                </div>
              );
            }

            if (field.type === 'days') {
              const selectedDays = Array.isArray(fieldVal) ? fieldVal : [];
              return (
                <div className="mb-3" key={field.key}>
                  <label className="mb-1 block text-sm text-muted-foreground">{field.label}</label>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.map((day) => {
                      const active = selectedDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            if (active) {
                              updateField(field.key, selectedDays.filter((d) => d !== day));
                            } else {
                              updateField(field.key, [...selectedDays, day]);
                            }
                          }}
                          className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const inputType = field.type === 'number' ? 'number' : (field.type === 'date' ? 'date' : (field.type === 'time' ? 'time' : 'text'));

            return (
              <div className="mb-3" key={field.key}>
                <label className="mb-1 block text-sm text-muted-foreground">{field.label}</label>
                <input
                  type={inputType}
                  value={fieldVal || ''}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-input px-2"
                />
              </div>
            );
          })}

          {selectedStudent ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Current selected student: {selectedStudent.firstName} {selectedStudent.lastName}
            </p>
          ) : null}
        </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="rounded-md border border-primary bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {loading ? 'Saving...' : (value._id ? 'Update request' : 'Submit request')}
          </button>
        </div>
      </div>
    </div>
  );
};

const RequestsPage = ({ isActive = true }) => {
  const { user, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminUser = Boolean(isAdmin && isAdmin());

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, pending: 0, delayed: 0, done: 0, rejected: 0, doneToday: 0 });
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [statusTab, setStatusTab] = useState('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [selectedId, setSelectedId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [actionNoteById, setActionNoteById] = useState({});
  const [followUpById, setFollowUpById] = useState({});

  const showLoading = useMinLoading(loading);
  const fetchReqRef = useRef(0);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/requests/summary');
      setSummary(res.data?.summary || { total: 0, pending: 0, delayed: 0, done: 0, rejected: 0, doneToday: 0 });
    } catch (err) {
      // keep page usable
    }
  }, []);

  const fetchStudents = useCallback(async () => {
    try {
      const userId = user?._id || user?.id;
      const role = user?.role;
      let list = [];

      if (role === 'guardian' && userId) {
        const res = await api.get(`/users/${userId}/students`);
        list = res.data?.students || [];
      } else if (role === 'teacher' && userId) {
        const res = await api.get(`/users/teacher/${userId}/students`);
        list = res.data?.students || [];
      } else {
        const res = await api.get('/students', { params: { page: 1, limit: 300 } });
        list = res.data?.students || [];
      }

      const map = new Map();
      list.forEach((item) => {
        const id = item?._id || item?.id || item?.studentId || item?.standaloneStudentId;
        if (!id) return;
        map.set(String(id), {
          ...item,
          _id: id,
        });
      });

      setStudents(Array.from(map.values()));
    } catch (err) {
      setStudents([]);
    }
  }, [user?._id, user?.id, user?.role]);

  const fetchItems = useCallback(async () => {
    if (!isActive) return;
    setLoading(true);
    setError('');
    try {
      const requestId = fetchReqRef.current + 1;
      fetchReqRef.current = requestId;

      const params = {
        page,
        limit: 20,
      };
      if (statusTab !== 'all') params.status = statusTab;
      if (typeFilter) params.type = typeFilter;
      if (search.trim()) params.q = search.trim();

      const res = await api.get('/requests', { params });
      if (requestId !== fetchReqRef.current) return;

      setItems(res.data?.requests || []);
      setTotalPages(res.data?.pagination?.totalPages || 1);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load requests');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [isActive, page, search, statusTab, typeFilter]);

  useEffect(() => {
    if (!isActive) return;
    fetchSummary();
    fetchStudents();
  }, [fetchStudents, fetchSummary, isActive]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const openCreate = () => {
    const defaultType = REQUEST_TYPES.find((item) => item.roles.includes(user?.role))?.value || 'change_class_time';
    const defaultCategory = REQUEST_TYPE_CONFIG[defaultType]?.category || 'class_modification';
    setForm({
      ...emptyForm,
      type: defaultType,
      category: defaultCategory,
    });
    setShowForm(true);
  };

  useEffect(() => {
    if (!isActive) return;
    const params = new URLSearchParams(location.search || '');
    const requestType = params.get('requestType') || '';
    if (!requestType || !REQUEST_TYPE_CONFIG[requestType]) return;

    const typeConfig = REQUEST_TYPE_CONFIG[requestType];
    if (!isAdminUser && !(typeConfig.roles || []).includes(user?.role)) return;

    setForm((prev) => ({
      ...prev,
      category: typeConfig.category,
      type: requestType,
      title: REQUEST_TYPE_LABEL_MAP[requestType] || prev.title,
      studentId: params.get('studentId') || prev.studentId,
      studentName: params.get('studentName') || prev.studentName,
      relatedClassId: params.get('classId') || prev.relatedClassId,
      relatedInvoiceId: params.get('invoiceId') || prev.relatedInvoiceId,
      details: {
        ...(prev.details || {}),
        classId: params.get('classId') || prev.details?.classId || '',
      },
    }));
    setShowForm(true);
    navigate('/dashboard/requests', { replace: true });
  }, [isActive, isAdminUser, location.search, navigate, user?.role]);

  const openEdit = (requestItem) => {
    setForm({
      _id: requestItem._id,
      category: requestItem.category,
      type: requestItem.type,
      title: requestItem.title || '',
      description: requestItem.description || '',
      urgency: requestItem.urgency || 'normal',
      studentId: requestItem.student?.studentId || '',
      studentName: requestItem.student?.name || '',
      relatedClassId: requestItem.relatedClassId || '',
      relatedInvoiceId: requestItem.relatedInvoiceId || '',
      details: requestItem.details && typeof requestItem.details === 'object' ? requestItem.details : {},
      adminNotes: requestItem.adminNotes || '',
      status: requestItem.status,
    });
    setShowForm(true);
  };

  const submitForm = async () => {
    const normalized = normalizeFormForType(form);

    if (!normalized.type || !normalized.category) {
      alert('Please select request category and type.');
      return;
    }
    if (!String(normalized.description || '').trim()) {
      alert('Please enter a detailed description.');
      return;
    }

    const payload = {
      category: normalized.category,
      type: normalized.type,
      title: String(normalized.title || '').trim() || REQUEST_TYPE_LABEL_MAP[normalized.type],
      description: String(normalized.description || '').trim(),
      urgency: normalized.urgency,
      studentId: normalized.studentId || undefined,
      studentName: normalized.studentName || undefined,
      relatedClassId: normalized.relatedClassId || undefined,
      relatedInvoiceId: normalized.relatedInvoiceId || undefined,
      details: normalized.details,
    };

    if (isAdminUser && form.adminNotes !== undefined) {
      payload.adminNotes = form.adminNotes;
    }

    setSaving(true);
    try {
      if (normalized._id) {
        await api.put(`/requests/${normalized._id}`, payload);
      } else {
        await api.post('/requests', payload);
      }
      setShowForm(false);
      setForm({ ...emptyForm });
      await Promise.all([fetchItems(), fetchSummary()]);
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to save request');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (requestId) => {
    if (!window.confirm('Delete this request?')) return;
    try {
      await api.delete(`/requests/${requestId}`);
      await Promise.all([fetchItems(), fetchSummary()]);
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to delete request');
    }
  };

  const handleStatusChange = async (requestId, status) => {
    const note = actionNoteById[requestId] || '';
    try {
      await api.post(`/requests/${requestId}/status`, { status, note });
      await Promise.all([fetchItems(), fetchSummary()]);
      setActionNoteById((prev) => ({ ...prev, [requestId]: '' }));
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to update status');
    }
  };

  const handleAddFollowUp = async (requestId) => {
    const note = String(followUpById[requestId] || '').trim();
    if (!note) return;
    try {
      await api.post(`/requests/${requestId}/follow-up`, { note });
      await fetchItems();
      setFollowUpById((prev) => ({ ...prev, [requestId]: '' }));
    } catch (err) {
      alert(err?.response?.data?.message || 'Failed to add follow-up');
    }
  };

  const canCreate = ['teacher', 'guardian', 'admin'].includes(user?.role);

  const quickStatusTabs = useMemo(
    () => [{ value: 'all', label: 'All' }, ...REQUEST_STATUS_OPTIONS],
    []
  );

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Requests Hub</h2>
          <p className="text-sm text-muted-foreground">Structured replacement for WhatsApp operational requests.</p>
        </div>
        {canCreate && (
          <button onClick={openCreate} className="rounded-md border border-primary bg-primary px-4 py-2 text-sm text-primary-foreground">
            New Request
          </button>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Pending</p><p className="text-lg font-semibold">{summary.pending || 0}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Delayed</p><p className="text-lg font-semibold">{summary.delayed || 0}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Done</p><p className="text-lg font-semibold">{summary.done || 0}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Rejected</p><p className="text-lg font-semibold">{summary.rejected || 0}</p></div>
        <div className="rounded-lg border border-border bg-card p-3"><p className="text-xs text-muted-foreground">Done today</p><p className="text-lg font-semibold">{summary.doneToday || 0}</p></div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="flex flex-wrap gap-2">
          {quickStatusTabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setStatusTab(tab.value);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-xs ${statusTab === tab.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="h-10 rounded-md border border-border bg-input px-2"
        >
          <option value="">All types</option>
          {REQUEST_TYPES.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Filter by request ID, user, student, title..."
          className="h-10 rounded-md border border-border bg-input px-2"
        />
      </div>

      {showLoading ? (
        <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
      ) : (
        <>
          {error ? (
            <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
          ) : null}

          <div className="space-y-3">
            {items.map((requestItem) => {
              const expanded = selectedId === requestItem._id;
              const statusClass = STATUS_BADGE[requestItem.status] || 'bg-muted text-muted-foreground';
              const typeLabel = REQUEST_TYPE_LABEL_MAP[requestItem.type] || toLabel(requestItem.type);
              const categoryLabel = REQUEST_CATEGORY_LABEL_MAP[requestItem.category] || toLabel(requestItem.category);
              const canEdit = isAdminUser || String(requestItem.createdBy?.userId || '') === String(user?._id || '');

              return (
                <div key={requestItem._id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{requestItem.requestCode}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass}`}>{requestItem.status}</span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{categoryLabel}</span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{typeLabel}</span>
                      </div>
                      <p className="mt-1 text-sm font-medium text-foreground">{requestItem.title}</p>
                      <p className="text-xs text-muted-foreground">By {requestItem.createdBy?.name || '-'} • Updated {formatDateTime(requestItem.updatedAt)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setSelectedId(expanded ? null : requestItem._id)}
                        className="rounded-md border border-border px-3 py-1 text-xs"
                      >
                        {expanded ? 'Hide' : 'View'}
                      </button>
                      {canEdit && (
                        <button onClick={() => openEdit(requestItem)} className="rounded-md border border-border px-3 py-1 text-xs">Edit</button>
                      )}
                      {canEdit && (
                        <button onClick={() => handleDelete(requestItem._id)} className="rounded-md border border-rose-300 px-3 py-1 text-xs text-rose-700">Delete</button>
                      )}
                    </div>
                  </div>

                  {expanded && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
                      <div>
                        <p className="font-medium text-foreground">Description</p>
                        <p className="text-muted-foreground whitespace-pre-wrap">{requestItem.description}</p>
                      </div>

                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="rounded-md border border-border p-2">
                          <p className="text-xs text-muted-foreground">Student</p>
                          <p className="font-medium text-foreground">{requestItem.student?.name || requestItem.student?.studentId || '-'}</p>
                        </div>
                        <div className="rounded-md border border-border p-2">
                          <p className="text-xs text-muted-foreground">Urgency</p>
                          <p className="font-medium text-foreground capitalize">{requestItem.urgency || 'normal'}</p>
                        </div>
                      </div>

                      <div className="rounded-md border border-border p-2">
                        <p className="mb-1 text-xs text-muted-foreground">Structured details</p>
                        {requestItem.details && typeof requestItem.details === 'object' && Object.keys(requestItem.details).length > 0 ? (
                          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                            {Object.entries(requestItem.details).map(([key, val]) => (
                              <div key={key} className="text-xs text-foreground">
                                <span className="font-medium text-muted-foreground">{toLabel(key)}:</span>{' '}
                                {Array.isArray(val) ? val.join(', ') : String(val)}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">No structured details</p>
                        )}
                      </div>

                      <div>
                        <p className="mb-1 font-medium text-foreground">Timeline</p>
                        <div className="space-y-1">
                          {(requestItem.timeline || []).slice().reverse().map((entry, index) => (
                            <div key={`${requestItem._id}-t-${index}`} className="rounded border border-border bg-muted/20 px-2 py-1 text-xs">
                              <span className="font-medium">{toLabel(entry.action)}</span>
                              {entry.status ? ` • ${entry.status}` : ''}
                              {entry.byRole ? ` • ${entry.byRole}` : ''}
                              {entry.note ? ` • ${entry.note}` : ''}
                              {' • '}
                              {formatDateTime(entry.at)}
                            </div>
                          ))}
                          {(requestItem.timeline || []).length === 0 && <p className="text-xs text-muted-foreground">No timeline entries.</p>}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <div className="rounded-md border border-border p-2">
                          <p className="mb-1 text-xs text-muted-foreground">Add follow-up note</p>
                          <textarea
                            rows={2}
                            value={followUpById[requestItem._id] || ''}
                            onChange={(e) => setFollowUpById((prev) => ({ ...prev, [requestItem._id]: e.target.value }))}
                            className="w-full rounded-md border border-border bg-input px-2 py-1 text-xs"
                          />
                          <div className="mt-1 flex justify-end">
                            <button onClick={() => handleAddFollowUp(requestItem._id)} className="rounded-md border border-border px-2 py-1 text-xs">Add</button>
                          </div>
                        </div>

                        {isAdminUser && (
                          <div className="rounded-md border border-border p-2">
                            <p className="mb-1 text-xs text-muted-foreground">Admin action</p>
                            <textarea
                              rows={2}
                              value={actionNoteById[requestItem._id] || ''}
                              onChange={(e) => setActionNoteById((prev) => ({ ...prev, [requestItem._id]: e.target.value }))}
                              className="w-full rounded-md border border-border bg-input px-2 py-1 text-xs"
                              placeholder="Reason / note"
                            />
                            <div className="mt-1 flex flex-wrap gap-1">
                              <button onClick={() => handleStatusChange(requestItem._id, 'done')} className="rounded-md border border-green-200 px-2 py-1 text-xs text-green-700">Done</button>
                              <button onClick={() => handleStatusChange(requestItem._id, 'delayed')} className="rounded-md border border-slate-300 px-2 py-1 text-xs">Delayed</button>
                              <button onClick={() => handleStatusChange(requestItem._id, 'rejected')} className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700">Reject</button>
                              <button onClick={() => handleStatusChange(requestItem._id, 'pending')} className="rounded-md border border-amber-300 px-2 py-1 text-xs text-amber-700">Pending</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!showLoading && items.length === 0 && (
              <div className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted-foreground">
                No requests found.
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </>
      )}

      <RequestFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={submitForm}
        value={form}
        setValue={setForm}
        students={students}
        role={user?.role}
        isAdmin={isAdminUser}
        loading={saving}
      />
    </div>
  );
};

export default RequestsPage;
