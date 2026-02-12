/**
	const openGoogleMeet = (meetLink) => {
		if (meetLink) {
			/**
			 * Teachers Page Component
			 *
			 * Restored clean implementation. Important behavior:
			 * - Shows `teacher.teacherInfo.monthlyHours` when present (including explicit 0)
			 * - Falls back to `_computedMonthlyHours` only when `monthlyHours` is null/undefined
			 */

			import React, { useState, useEffect, useMemo, useRef } from 'react';
			import { useAuth } from '../../contexts/AuthContext';
			import { useSearch } from '../../contexts/SearchContext';
			import { useNavigate } from 'react-router-dom';
			import ProfileEditModal from '../../components/dashboard/ProfileEditModal';
			import { formatDateDDMMMYYYY } from '../../utils/date';
			import {
				ChevronDown,
				ChevronUp,
				MessageCircle,
				Video,
				User,
				Clock,
				DollarSign,
				Globe,
				MapPin,
				Calendar,
				Phone,
				Mail,
				UserX,
				UserCheck,
				LogIn,
				Copy,
					Edit,
					DownloadCloud,
					X
			} from 'lucide-react';
			import api from '../../api/axios';
			import LoadingSpinner from '../../components/ui/LoadingSpinner';
			import useMinLoading from '../../components/ui/useMinLoading';
			import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';

			const TEACHER_STATUS_TABS = [
				{ id: 'active', label: 'Active' },
				{ id: 'inactive', label: 'Inactive' },
				{ id: 'all', label: 'All' }
			];

			const isTeacherActive = (teacher = {}) => {
				if (typeof teacher.isActive === 'boolean') {
					return teacher.isActive;
				}
				return true;
			};

			const formatHours = (value) => {
				const numeric = Number(value);
				return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
			};

			const TeachersPage = () => {
				const { isAdmin, loginAsUser } = useAuth();
				const { searchTerm, globalFilter } = useSearch();
				const navigate = useNavigate();

			const [teachers, setTeachers] = useState([]);
			const [loading, setLoading] = useState(true);
			const showLoading = useMinLoading(loading);
			const teachersRef = useRef([]);
			const fetchTeachersInFlightRef = useRef(false);
			const fetchTeachersKeyRef = useRef('');
			const fetchTeachersAbortRef = useRef(null);
			const fetchTeachersRequestIdRef = useRef(0);
			const [error, setError] = useState('');
			const [debouncedSearch, setDebouncedSearch] = useState(searchTerm || '');
			const [sortBy] = useState('firstName');
			const [sortOrder] = useState('asc');
			const [statusFilter, setStatusFilter] = useState('active');
			const [expandedTeacher, setExpandedTeacher] = useState(null);
			const [editingTeacher, setEditingTeacher] = useState(null);
			const [currentPage, setCurrentPage] = useState(1);
				const [totalPages, setTotalPages] = useState(1);
				const itemsPerPage = 30;
				const [statusCounts, setStatusCounts] = useState({ active: 0, inactive: 0, all: 0 });
				const [showAccountLogs, setShowAccountLogs] = useState(false);
				const [accountLogSearch, setAccountLogSearch] = useState('');
				const [accountLogQuery, setAccountLogQuery] = useState('');
				const [accountLogTeacherId, setAccountLogTeacherId] = useState('');
				const [accountLogs, setAccountLogs] = useState([]);
				const [accountLogsLoading, setAccountLogsLoading] = useState(false);
				const [accountLogsError, setAccountLogsError] = useState('');
				const [showAccountOptions, setShowAccountOptions] = useState(false);
				const [expandedLogEntries, setExpandedLogEntries] = useState({});
				const [logActionModal, setLogActionModal] = useState({ open: false, log: null, action: '' });
				const [logActionConfirm, setLogActionConfirm] = useState('');
				const [logActionLoading, setLogActionLoading] = useState(false);

				const fetchStatusCounts = async () => {
					try {
						const baseParams = {
							role: 'teacher',
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
						console.warn('Failed to fetch teacher status counts', err?.message || err);
					}
				};

				// debounce global search string to avoid spamming API
				useEffect(() => {
					const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
					return () => clearTimeout(timer);
				}, [searchTerm]);

				useEffect(() => {
					fetchTeachers();
					// eslint-disable-next-line react-hooks/exhaustive-deps
				}, [sortBy, sortOrder, statusFilter, currentPage, debouncedSearch]);

				useEffect(() => {
					teachersRef.current = teachers || [];
				}, [teachers]);

				const fetchTeachers = async () => {
					try {
						const searchMode = Boolean((debouncedSearch || '').trim());
						const fetchPage = searchMode ? 1 : currentPage;
						const fetchLimit = searchMode ? 1000 : itemsPerPage;
						const requestSignature = JSON.stringify({
							page: fetchPage,
							limit: fetchLimit,
							sortBy,
							order: sortOrder,
							statusFilter: searchMode ? 'all' : statusFilter,
							search: searchMode ? debouncedSearch : undefined,
						});

						if (fetchTeachersInFlightRef.current && fetchTeachersKeyRef.current === requestSignature) {
							return;
						}

						fetchTeachersKeyRef.current = requestSignature;
						fetchTeachersInFlightRef.current = true;

						const requestId = fetchTeachersRequestIdRef.current + 1;
						fetchTeachersRequestIdRef.current = requestId;

						if (fetchTeachersAbortRef.current) {
							try {
								fetchTeachersAbortRef.current.abort();
							} catch (e) {
								// ignore abort errors
							}
						}

						const controller = new AbortController();
						fetchTeachersAbortRef.current = controller;

						const cacheKey = makeCacheKey('teachers:list', 'admin', {
							page: fetchPage,
							limit: fetchLimit,
							sortBy,
							order: sortOrder,
							statusFilter: searchMode ? 'all' : statusFilter,
							search: searchMode ? debouncedSearch : undefined,
						});

						const cached = readCache(cacheKey, { deps: ['users', 'classes'] });
						if (cached.hit && cached.value) {
							setTeachers(cached.value.teachers || []);
							setTotalPages(cached.value.totalPages || 1);
							if (cached.value.statusCounts) setStatusCounts(cached.value.statusCounts);
							setError('');
							setLoading(false);

							if (cached.ageMs < 60_000) {
								fetchTeachersInFlightRef.current = false;
								return;
							}
						}

						const hasExisting = (teachersRef.current || []).length > 0;
						setLoading(!hasExisting);
						const params = {
							role: 'teacher',
							page: fetchPage,
							limit: fetchLimit,
							sortBy,
							order: sortOrder,
							light: true,
							includeTotal: !searchMode,
						};

						if (!searchMode && statusFilter !== 'all') {
							params.isActive = statusFilter === 'active';
						}
						if (searchMode) {
							params.search = debouncedSearch;
						}

						const response = await api.get('/users', { params, signal: controller.signal });
						if (requestId !== fetchTeachersRequestIdRef.current) {
							return;
						}
						const fetched = response.data.users || [];
						setTeachers(fetched);
						const nextTotalPages = (response.data.pagination && response.data.pagination.pages) || 1;
						setTotalPages(nextTotalPages);

						// Refresh counts in the background so list can render ASAP.
						fetchStatusCounts();

						writeCache(
							cacheKey,
							{
								teachers: fetched,
								totalPages: nextTotalPages,
								statusCounts,
							},
							{ ttlMs: 5 * 60_000, deps: ['users', 'classes'] }
						);
					} catch (err) {
						const isCanceled = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError';
						if (!isCanceled) {
							setError('Failed to fetch teachers');
							console.error('Fetch teachers error:', err);
						}
					} finally {
						setLoading(false);
						fetchTeachersInFlightRef.current = false;
					}
				};

				const toggleExpanded = (teacherId) => {
					setExpandedTeacher(expandedTeacher === teacherId ? null : teacherId);
				};

				const handleStatusChange = async (teacherId, newStatus) => {
					try {
						await api.put(`/users/${teacherId}/status`, { isActive: newStatus });
						fetchTeachers();
					} catch (err) {
						setError('Failed to update teacher status');
						console.error('Update status error:', err);
					}
				};

				const handleLoginAsUser = async (userId) => {
					try {
						const result = await loginAsUser(userId);
						if (result.success) {
							navigate('/dashboard');
						} else {
							setError(result.error || 'Failed to login as user');
						}
					} catch (err) {
						setError('An unexpected error occurred during login as user');
						console.error('Login as user error:', err);
					}
				};

				const openWhatsApp = (phone) => {
					if (!phone) return;
					const cleanPhone = phone.replace(/[^\d+]/g, '');
					window.open(`https://wa.me/${cleanPhone}`, '_blank');
				};

				const openEmail = (email) => {
					if (email) {
						window.open(`mailto:${email}`, '_blank');
					}
				};

				const openGoogleMeet = (meetLink) => {
					if (meetLink) {
						window.open(meetLink, '_blank');
					}
				};

				const copyToClipboard = (text) => {
					navigator.clipboard.writeText(text).then(() => {
						alert('Copied to clipboard!');
					}).catch(err => {
						console.error('Failed to copy:', err);
					});
				};

				const teacherOptionLabel = (t) => `${t.firstName || ''} ${t.lastName || ''}`.trim();
				const teacherOptionValue = (t) => `${teacherOptionLabel(t)} | ${t.email || '-'} | ${t._id}`;
				const resolveTeacherIdFromInput = (value, list = []) => {
					const trimmed = String(value || '').trim();
					if (!trimmed) return '';
					const direct = list.find((t) => String(t._id) === trimmed);
					if (direct) return String(direct._id);
					const match = list.find((t) => teacherOptionValue(t) === trimmed);
					if (match) return String(match._id);
					const lower = trimmed.toLowerCase();
					const fallback = list.find((t) => {
						const name = teacherOptionLabel(t).toLowerCase();
						const email = (t.email || '').toLowerCase();
						const id = String(t._id || '').toLowerCase();
						return name.includes(lower) || email === lower || id === lower;
					});
					return fallback ? String(fallback._id) : '';
				};

				const filteredAccountTeachers = useMemo(() => {
					const needle = (accountLogSearch || '').trim().toLowerCase();
					if (!needle) return teachers || [];
					return (teachers || []).filter((t) => {
						const name = teacherOptionLabel(t).toLowerCase();
						const email = (t.email || '').toLowerCase();
						const id = String(t._id || '').toLowerCase();
						return name.includes(needle) || email.includes(needle) || id.includes(needle);
					});
				}, [teachers, accountLogSearch]);

				const selectedAccountTeacher = useMemo(() => {
					if (!accountLogTeacherId) return null;
					return (teachers || []).find((t) => String(t._id) === String(accountLogTeacherId)) || null;
				}, [teachers, accountLogTeacherId]);

				const loadAccountLogs = async () => {
					const query = (accountLogQuery || accountLogSearch || '').trim();
					if (!selectedAccountTeacher?._id && !query) {
						setAccountLogsError('Please select a teacher or enter an email/ID');
						return;
					}
					setAccountLogsError('');
					setAccountLogsLoading(true);
					try {
						const { data } = await api.post('/users/admin/account-logs', {
							userId: selectedAccountTeacher?._id,
							email: query && query.includes('@') ? query : (selectedAccountTeacher?.email || undefined),
							userIdOrEmail: query && !query.includes('@') ? query : undefined,
							limit: 500,
							includeClasses: true,
							classLimit: 500,
						});
						setAccountLogs(Array.isArray(data?.logs) ? data.logs : []);
					} catch (err) {
						console.error('Failed to load account logs', err);
						setAccountLogsError(err?.response?.data?.message || 'Failed to load account logs');
					} finally {
						setAccountLogsLoading(false);
					}
				};

				const buildLogKey = (log, idx) => String(log?.logId || `${log?.timestamp || 't'}-${idx}`);

				const toggleLogClasses = (key) => {
					setExpandedLogEntries((prev) => ({ ...prev, [key]: !prev[key] }));
				};

				const formatStatusLabel = (value) => {
					if (value === true) return 'Active';
					if (value === false) return 'Inactive';
					return 'Unknown';
				};

				const getHoursDelta = (log) => {
					const before = Number.isFinite(Number(log?.balanceBefore)) ? Number(log.balanceBefore) : null;
					const after = Number.isFinite(Number(log?.balanceAfter)) ? Number(log.balanceAfter) : null;
					if (before === null || after === null) return null;
					const raw = Math.round((after - before) * 1000) / 1000;
					if (!Number.isFinite(raw) || raw === 0) return null;
					return {
						value: raw,
						label: `${raw > 0 ? '+' : ''}${raw}h`,
						tone: raw > 0 ? 'text-emerald-600' : 'text-rose-600'
					};
				};

				const openLogAction = (log, action) => {
					if (!log?.logId) return;
					setLogActionModal({ open: true, log, action });
					setLogActionConfirm('');
				};

				const closeLogAction = () => {
					setLogActionModal({ open: false, log: null, action: '' });
					setLogActionConfirm('');
					setLogActionLoading(false);
				};

				const handleLogAction = async () => {
					const log = logActionModal.log;
					if (!log?.logId) return;
					setLogActionLoading(true);
					try {
						if (logActionModal.action === 'undo') {
							await api.post(`/users/admin/account-logs/${log.logId}/undo`, { source: log.source });
						} else if (logActionModal.action === 'delete') {
							await api.delete(`/users/admin/account-logs/${log.logId}`, { params: { source: log.source } });
						}
						await loadAccountLogs();
						closeLogAction();
					} catch (err) {
						console.error('Account log action failed', err);
						setAccountLogsError(err?.response?.data?.message || 'Failed to update log');
						setLogActionLoading(false);
					}
				};

				const downloadAccountLogs = () => {
					if (!accountLogs || accountLogs.length === 0) return;
					const rows = [
						[
							'timestamp',
							'source',
							'action',
							'invoiceNumber',
							'amount',
							'hours',
							'success',
							'message',
							'reason',
							'actorName',
							'balanceBefore',
							'balanceAfter',
							'statusBefore',
							'statusAfter',
							'entityType',
							'entityName',
							'billingStart',
							'billingEnd',
							'classCount',
							'generationSource',
							'logId'
						]
					];
					accountLogs.forEach((log) => {
						rows.push([
							log.timestamp ? new Date(log.timestamp).toISOString() : '',
							log.source || '',
							log.action || '',
							log.invoiceNumber || '',
							log.amount ?? '',
							log.hours ?? '',
							log.success === false ? 'false' : 'true',
							(log.message || '').replace(/\n/g, ' '),
							(log.reason || '').replace(/\n/g, ' '),
							(log.actorName || '').replace(/\n/g, ' '),
							log.balanceBefore ?? '',
							log.balanceAfter ?? '',
							log.statusBefore ?? '',
							log.statusAfter ?? '',
							log.entityType ?? '',
							(log.entityName || '').replace(/\n/g, ' '),
							log.billingPeriod?.startDate ? new Date(log.billingPeriod.startDate).toISOString() : '',
							log.billingPeriod?.endDate ? new Date(log.billingPeriod.endDate).toISOString() : '',
							log.classCount ?? '',
							log.generationSource || '',
							log.logId || ''
						]);
					});
					const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
					const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
					const url = URL.createObjectURL(blob);
					const link = document.createElement('a');
					link.href = url;
					link.download = `account-logs-${selectedAccountTeacher?._id || 'teacher'}.csv`;
					document.body.appendChild(link);
					link.click();
					document.body.removeChild(link);
					URL.revokeObjectURL(url);
				};

				const filteredTeachers = useMemo(() => {
					let result = teachers || [];
					const searchActive = Boolean((searchTerm || '').trim());

					if (!searchActive && statusFilter !== 'all') {
						const desired = statusFilter === 'active';
						result = result.filter((t) => isTeacherActive(t) === desired);
					}

					if (searchTerm && searchTerm.trim()) {
						const term = searchTerm.toLowerCase();
						result = result.filter((t) => {
							const fullName = `${t.firstName || ''} ${t.lastName || ''}`.toLowerCase();
							return (
								fullName.includes(term) ||
								(t.email || '').toLowerCase().includes(term) ||
								(t.phone || '').toLowerCase().includes(term) ||
								String(t._id).includes(term)
							);
						});
					}

					if (!searchActive && globalFilter && globalFilter !== 'all') {
						if (globalFilter === 'active') {
							result = result.filter((t) => t.isActive === true);
						} else if (globalFilter === 'inactive') {
							result = result.filter((t) => t.isActive === false);
						}
					}

					return result;
				}, [teachers, searchTerm, globalFilter, statusFilter]);

				const sortedTeachers = useMemo(() => {
					const list = [...(filteredTeachers || [])];
					const buildNameKey = (teacher) => {
						const first = (teacher.firstName || '').trim().toLowerCase();
						const last = (teacher.lastName || '').trim().toLowerCase();
						if (sortBy === 'lastName') {
							return `${last} ${first}`.trim() || last || first;
						}
						return `${first} ${last}`.trim();
					};

					list.sort((a, b) => {
						const activeDiff = (isTeacherActive(b) ? 1 : 0) - (isTeacherActive(a) ? 1 : 0);
						if (activeDiff !== 0) return activeDiff;
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
				}, [filteredTeachers, sortBy, sortOrder]);
				const confirmToken = logActionModal.log?.action || 'action';
				const isConfirmValid = logActionConfirm.trim() === confirmToken;

				if (showLoading && !teachers.length) {
					return <LoadingSpinner />;
				}

				return (
					<div className="p-6 bg-background min-h-screen">
						<div className="max-w-7xl mx-auto">
							{error && (
								<div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 mb-4">
									<span className="text-destructive text-sm">{error}</span>
								</div>
							)}

							<div className="flex flex-wrap gap-2 mb-6">
								{TEACHER_STATUS_TABS.map((tab) => {
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

							<div className="space-y-3">
								{sortedTeachers.map((teacher) => (
									<div key={teacher._id} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
										<div className="p-3">
											<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
												<div className="flex items-center gap-4">
													<div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center">
														{teacher.profilePicture ? (
															<img src={teacher.profilePicture} alt="Profile" className="h-full w-full rounded-full object-cover" />
														) : (
															<span className="text-lg font-medium text-primary-foreground">
																{teacher.firstName?.charAt(0)}{teacher.lastName?.charAt(0)}
															</span>
														)}
													</div>

													<div>
														<h3 className="text-lg font-semibold text-foreground">
															{teacher.firstName} {teacher.lastName}
														</h3>
														<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
															<span className={`px-2 py-1 rounded-full text-xs ${
																teacher.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
															}`}>
																{teacher.isActive ? 'Active' : 'Inactive'}
															</span>
															<span className="flex items-center">
																<Clock className="h-3 w-3 mr-1" />
																{/* Prefer the server-computed aggregation for this month when present. */}
																{formatHours((teacher.teacherInfo && (teacher.teacherInfo._computedMonthlyHours !== undefined && teacher.teacherInfo._computedMonthlyHours !== null))
																	? Number(teacher.teacherInfo._computedMonthlyHours) || 0
																	: Number(teacher.teacherInfo?.monthlyHours ?? 0) || 0
																)} hours this month
															</span>
															<span className="text-[11px] text-muted-foreground">(unbilled)</span>
														</div>
													</div>
												</div>

													<div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
													{teacher.phone && (
														<button
															onClick={() => openWhatsApp(teacher.phone)}
															className="icon-button icon-button--green"
															title="WhatsApp"
														>
															<MessageCircle className="h-4 w-4" />
														</button>
													)}

													{teacher.email && (
														<button
															onClick={() => openEmail(teacher.email)}
															className="icon-button icon-button--blue"
															title="Email"
														>
															<Mail className="h-4 w-4" />
														</button>
													)}

													{teacher.teacherInfo?.googleMeetLink && (
														<div className="flex items-center">
															<button
																onClick={() => openGoogleMeet(teacher.teacherInfo.googleMeetLink)}
																className="icon-button icon-button--blue"
																title="Google Meet"
															>
																<Video className="h-4 w-4" />
															</button>
															<button
																onClick={() => copyToClipboard(teacher.teacherInfo.googleMeetLink)}
																className="icon-button icon-button--muted"
																title="Copy Google Meet Link"
															>
																<Copy className="h-4 w-4" />
															</button>
														</div>
													)}

											{isAdmin() && (
												<div className="flex items-center space-x-1">
													<button
														onClick={() => setEditingTeacher(teacher)}
														className="icon-button icon-button--blue"
														title="Edit Teacher"
													>
														<Edit className="h-4 w-4" />
													</button>
													<button
														onClick={() => handleStatusChange(teacher._id, !teacher.isActive)}
														className={`icon-button transition-colors ${teacher.isActive ? 'text-red-600' : 'text-green-600'}`}
														title={teacher.isActive ? 'Deactivate' : 'Activate'}
													>
														{teacher.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
													</button>
													<button
														onClick={() => handleLoginAsUser(teacher._id)}
														className="icon-button icon-button--indigo"
														title="Login as User"
													>
														<LogIn className="h-4 w-4" />
													</button>
												</div>
											)}													<button
														onClick={() => toggleExpanded(teacher._id)}
														className="icon-button icon-button--muted"
													>
														{expandedTeacher === teacher._id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
													</button>
												</div>
											</div>
										</div>

										{expandedTeacher === teacher._id && (
											<div className="border-t border-border bg-muted/30 p-3">
												<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
													<div>
														<h4 className="font-semibold text-foreground mb-3">Contact Information</h4>
														<div className="space-y-2 text-sm">
															<div className="flex items-center space-x-2">
																<Mail className="h-4 w-4 text-muted-foreground" />
																<span>{teacher.email}</span>
															</div>
															{teacher.phone && (
																<div className="flex items-center space-x-2">
																	<Phone className="h-4 w-4 text-muted-foreground" />
																	<span>{teacher.phone}</span>
																</div>
															)}
															{teacher.address && (
																<div className="flex items-center space-x-2">
																	<MapPin className="h-4 w-4 text-muted-foreground" />
																	<span>
																		{[teacher.address.city, teacher.address.state, teacher.address.country]
																			.filter(Boolean)
																			.join(', ')}
																	</span>
																</div>
															)}
															<div className="flex items-center space-x-2">
																<Globe className="h-4 w-4 text-muted-foreground" />
																<span>{teacher.timezone || 'UTC'}</span>
															</div>
														</div>
													</div>

													<div>
														<h4 className="font-semibold text-foreground mb-3">Professional Information</h4>
														<div className="space-y-2 text-sm">
															<div className="flex items-center space-x-2">
																<DollarSign className="h-4 w-4 text-muted-foreground" />
																<span>Instapay Name: {teacher.teacherInfo?.instapayName || 'N/A'}</span>
															</div>
															{teacher.teacherInfo?.spokenLanguages?.length > 0 && (
																<div>
																	<span className="text-muted-foreground">Languages: </span>
																	<span>{teacher.teacherInfo.spokenLanguages.join(', ')}</span>
																</div>
															)}

															{(teacher.teacherInfo?.qualifications && ((Array.isArray(teacher.teacherInfo.qualifications) && teacher.teacherInfo.qualifications.length > 0) || (typeof teacher.teacherInfo.qualifications === 'string' && teacher.teacherInfo.qualifications.trim() !== ''))) && (
																<div>
																	<h5 className="text-sm font-medium text-foreground">Qualifications</h5>
																	<div className="mt-1 text-sm text-muted-foreground">
																		{Array.isArray(teacher.teacherInfo.qualifications) ? (
																			teacher.teacherInfo.qualifications.map((q, i) => {
																				let text = '';
																				if (typeof q === 'string') {
																					text = q;
																				} else if (q && typeof q === 'object') {
																					text = (q.degree || q.title || q.name || '') + (q.institution ? ` — ${q.institution}` : '') + (q.year ? ` (${q.year})` : '');
																					if (!text || text.trim() === '') text = JSON.stringify(q);
																				} else {
																					text = String(q);
																				}
																				return (
																					<span key={i} className="inline-block px-2 py-1 mr-2 mb-2 bg-primary/10 text-primary text-xs rounded-full">{text}</span>
																				);
																			})
																		) : (
																			(() => {
																				const q = teacher.teacherInfo.qualifications;
																				if (typeof q === 'string') return <span>{q}</span>;
																				if (q && typeof q === 'object') {
																					const text = (q.degree || q.title || q.name || '') + (q.institution ? ` — ${q.institution}` : '') + (q.year ? ` (${q.year})` : '');
																					return <span>{text || JSON.stringify(q)}</span>;
																				}
																				return <span>{String(q)}</span>;
																			})()
																		)}
																	</div>
																</div>
															)}
														</div>
													</div>

													<div>
														<h4 className="font-semibold text-foreground mb-3">Additional Information</h4>
														<div className="space-y-2 text-sm">
															{teacher.dateOfBirth && (
																<div className="flex items-center space-x-2">
																	<Calendar className="h-4 w-4 text-muted-foreground" />
																	<span>Born: {formatDateDDMMMYYYY(teacher.dateOfBirth)}</span>
																</div>
															)}
															<div className="flex items-center space-x-2">
																<User className="h-4 w-4 text-muted-foreground" />
																<span>Gender: {teacher.gender || 'N/A'}</span>
															</div>
															<div className="flex items-center space-x-2">
																<Calendar className="h-4 w-4 text-muted-foreground" />
																<span>Joined: {formatDateDDMMMYYYY(teacher.createdAt)}</span>
															</div>
														</div>
													</div>
												</div>
												{teacher.teacherInfo?.bio && (
										<div className="mt-4 p-3">
												<h4 className="font-semibold text-foreground mb-2">Bio</h4>
												<p className="text-sm text-muted-foreground">{teacher.teacherInfo.bio}</p>
											</div>
										)}
												{teacher.teacherInfo?.subjects?.length > 0 && (
													<div className="mt-4 p-3">
														<h4 className="font-semibold text-foreground mb-2">Subjects</h4>
														<div className="flex flex-wrap gap-2">
															{teacher.teacherInfo.subjects.map((subject, index) => (
																<span key={index} className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full">
																	{subject}
																</span>
															))}
														</div>
													</div>
												)}
											</div>
										)}
										
										
									</div>
								))}
							</div>

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

							{!showLoading && sortedTeachers.length === 0 && (
							<div className="text-center py-12">
								<User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
								<h3 className="text-lg font-semibold text-foreground mb-2">No teachers found</h3>
								<p className="text-muted-foreground">
									{searchTerm ? 'Try adjusting your search criteria.' : 'No teachers have been registered yet.'}
								</p>
							</div>
						)}
						{isAdmin() && (
							<div className="fixed bottom-6 right-6 flex flex-col items-end gap-2">
								<button
									onClick={() => {
										setShowAccountLogs(true);
										setAccountLogs([]);
										setAccountLogsError('');
									}}
									className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 flex items-center justify-center text-2xl"
									title="Account history"
								>
									+
								</button>
							</div>
						)}
					</div>

					{/* Edit Teacher Profile Modal */}
					<ProfileEditModal
						isOpen={!!editingTeacher}
						targetUser={editingTeacher}
						onClose={() => setEditingTeacher(null)}
						onSaved={() => {
							fetchTeachers();
							setEditingTeacher(null);
						}}
					/>

					{isAdmin() && showAccountLogs && (
						<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
							<div className="w-full max-w-2xl rounded-lg border border-border bg-card p-4 shadow-xl">
								<div className="flex items-center justify-between">
									<h3 className="text-lg font-semibold text-foreground">Account history</h3>
									<button
										onClick={() => setShowAccountLogs(false)}
										className="icon-button icon-button--muted"
										title="Close"
									>
										<X className="h-4 w-4" />
									</button>
								</div>

								<div className="mt-3 space-y-3">
									<div className="relative">
										<input
											type="text"
											value={accountLogSearch}
											onFocus={() => setShowAccountOptions(true)}
											onBlur={() => setTimeout(() => setShowAccountOptions(false), 120)}
											onChange={(e) => {
												const value = e.target.value;
												setAccountLogSearch(value);
												setAccountLogQuery(value);
												const resolved = resolveTeacherIdFromInput(value, teachers || []);
												if (resolved) setAccountLogTeacherId(resolved);
												setShowAccountOptions(true);
											}}
											placeholder="Search or select teacher (name, email, ID)"
											className="h-9 w-full rounded-md border border-border bg-input px-3 text-sm text-foreground"
										/>
										{showAccountOptions && filteredAccountTeachers.length > 0 && (
											<div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
												{filteredAccountTeachers.map((t) => (
													<button
														key={t._id}
														type="button"
														onMouseDown={(e) => {
															e.preventDefault();
															setAccountLogTeacherId(t._id);
															setAccountLogSearch(teacherOptionValue(t));
															setAccountLogQuery(teacherOptionValue(t));
															setShowAccountOptions(false);
														}}
														className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
													>
														{teacherOptionValue(t)}
													</button>
												))}
											</div>
										)}
									</div>

									{selectedAccountTeacher && (
										<div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-foreground">
											<div className="font-medium">
												{selectedAccountTeacher.firstName} {selectedAccountTeacher.lastName}
											</div>
											<div>{selectedAccountTeacher.email}</div>
											<div>ID: {selectedAccountTeacher._id}</div>
										</div>
									)}

									{accountLogsError && (
										<div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
											{accountLogsError}
										</div>
									)}

									<div className="flex flex-wrap items-center gap-2">
										<button
											onClick={loadAccountLogs}
											disabled={accountLogsLoading}
											className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
										>
											{accountLogsLoading ? 'Loading…' : 'Load logs'}
										</button>
										<button
											onClick={downloadAccountLogs}
											disabled={!accountLogs || accountLogs.length === 0}
											className="h-8 rounded-md border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60 inline-flex items-center gap-1"
										>
											<DownloadCloud className="h-3.5 w-3.5" />
											Download CSV
										</button>
									</div>

									<div className="max-h-[360px] overflow-auto rounded-md border border-border">
										{accountLogsLoading && accountLogs.length === 0 ? (
											<div className="p-3 text-xs text-muted-foreground">Loading logs…</div>
										) : accountLogs.length === 0 ? (
											<div className="p-3 text-xs text-muted-foreground">No logs loaded yet.</div>
										) : (
											<ul className="divide-y divide-border">
												{accountLogs.map((log, idx) => {
													const logKey = buildLogKey(log, idx);
													const hoursDelta = getHoursDelta(log);
													const statusSummary = (log.statusBefore !== undefined || log.statusAfter !== undefined)
														? `${log.entityType === 'Student' ? 'Student' : 'User'}${log.entityName ? `: ${log.entityName}` : ''}${log.entityType === 'Student' && log.guardianName ? ` (Guardian: ${log.guardianName})` : ''} ${formatStatusLabel(log.statusBefore)} → ${formatStatusLabel(log.statusAfter)}`
														: null;
													const showClasses = !!expandedLogEntries[logKey];

													return (
														<li key={logKey} className="p-3 text-xs">
															<div className="flex flex-wrap items-center justify-between gap-2">
																<div className="flex flex-wrap items-center gap-2">
																	<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground">
																		{log.action || 'event'}
																	</span>
																	<span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
																		{log.source || 'system'}
																	</span>
																	<span className="text-muted-foreground">
																		{log.timestamp ? formatDateDDMMMYYYY(log.timestamp) : ''}
																	</span>
																	{log.invoiceNumber && (
																		<span className="text-muted-foreground">Invoice {log.invoiceNumber}</span>
																	)}
																	{log.billingPeriod?.startDate && log.billingPeriod?.endDate && (
																		<span className="text-muted-foreground">
																			{formatDateDDMMMYYYY(log.billingPeriod.startDate)} → {formatDateDDMMMYYYY(log.billingPeriod.endDate)}
																		</span>
																	)}
																</div>
																<div className="flex items-center gap-2">
																	{log.canUndo && log.logId ? (
																		<button
																			type="button"
																			onClick={() => openLogAction(log, 'undo')}
																			className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
																		>
																			Undo
																		</button>
																	) : null}
																	{log.canDelete && log.logId ? (
																		<button
																			type="button"
																			onClick={() => openLogAction(log, 'delete')}
																			className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
																		>
																			Delete
																		</button>
																	) : null}
																</div>
															</div>

															{log.message && (
																<div className="mt-1 text-muted-foreground">{log.message}</div>
															)}

															<div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
																{statusSummary ? (
																	<span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px] text-foreground">
																		{statusSummary}
																	</span>
																) : null}
																{hoursDelta ? (
																	<span className={`rounded-md bg-muted/50 px-2 py-0.5 text-[11px] font-semibold ${hoursDelta.tone}`}>
																		Hours {hoursDelta.label}
																	</span>
																) : null}
																{(log.amount || log.hours) ? (
																	<span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px]">
																		{log.amount ? `Amount: ${log.amount}` : ''}
																		{log.amount && log.hours ? ' • ' : ''}
																		{log.hours ? `Hours: ${formatHours(log.hours)}` : ''}
																	</span>
																) : null}
																{(log.balanceBefore !== undefined || log.balanceAfter !== undefined) ? (
																	<span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px]">
																		Balance: {log.balanceBefore ?? '-'} → {log.balanceAfter ?? '-'} {log.balanceNote ? `(${log.balanceNote})` : ''}
																	</span>
																) : null}
																{log.actorName ? (
																	<span className="rounded-md bg-muted/50 px-2 py-0.5 text-[11px]">By: {log.actorName}</span>
																) : null}
															</div>

															{log.reason && (
																<div className="mt-1 text-muted-foreground">Reason: {log.reason}</div>
															)}

															{Array.isArray(log.classEntries) && (log.classEntries.length > 0 || log.classCount > 0) && (
																<div className="mt-2">
																	<button
																		type="button"
																		onClick={() => toggleLogClasses(logKey)}
																		className="text-[11px] font-medium text-primary hover:underline"
																	>
																		{showClasses ? 'Hide classes' : 'Show classes'} ({log.classEntries.length}
																		{log.classCount && log.classCount > log.classEntries.length ? ` of ${log.classCount}` : ''})
																	</button>
																	{showClasses ? (
																		<div className="mt-2 rounded-md border border-border bg-background/60 p-2 text-muted-foreground">
																			{log.classEntries.length === 0 ? (
																				<div className="text-[11px] text-muted-foreground">No class details available.</div>
																			) : (
																				<ul className="space-y-1">
																					{log.classEntries.map((entry, entryIndex) => (
																						<li key={`${logKey}-class-${entryIndex}`} className="flex flex-wrap gap-2">
																							<span>{entry.date ? formatDateDDMMMYYYY(entry.date) : 'Date N/A'}</span>
																							{entry.studentName && <span>Student: {entry.studentName}</span>}
																							{entry.teacherName && <span>Teacher: {entry.teacherName}</span>}
																							{entry.hours !== null && entry.hours !== undefined ? <span>{formatHours(entry.hours)}h</span> : null}
																							{entry.status ? <span>Status: {entry.status}</span> : null}
																						</li>
																					))}
																				</ul>
																			)}
																		</div>
																	) : null}
																</div>
															)}

															{log.success === false && (
																<div className="mt-1 text-destructive">Failed</div>
															)}
														</li>
													);
												})}
											</ul>
										)}
									</div>
								</div>
							</div>
							{logActionModal.open && (
								<div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
									<div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl">
										<div className="flex items-start justify-between">
											<div>
												<h4 className="text-base font-semibold text-foreground">
													{logActionModal.action === 'delete' ? 'Delete log entry' : 'Undo log action'}
												</h4>
												<p className="mt-1 text-xs text-muted-foreground">
													Copy and paste this process name to confirm:
												</p>
											</div>
											<button
												type="button"
												onClick={closeLogAction}
												className="text-muted-foreground hover:text-foreground"
											>
												<X className="h-4 w-4" />
											</button>
										</div>
										<div className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs font-mono text-foreground">
											{confirmToken}
										</div>
										<input
											value={logActionConfirm}
											onChange={(e) => setLogActionConfirm(e.target.value)}
											placeholder="Paste the process name"
											className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground"
										/>
										<div className="mt-4 flex items-center justify-end gap-2">
											<button
												type="button"
												onClick={closeLogAction}
												className="h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"
											>
												Cancel
											</button>
											<button
												type="button"
												disabled={!isConfirmValid || logActionLoading}
												onClick={handleLogAction}
												className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
											>
												{logActionLoading ? 'Processing…' : 'Confirm'}
											</button>
										</div>
									</div>
								</div>
							)}
						</div>
					)}
				</div>
			);
		};			export default TeachersPage;
