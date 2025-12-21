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

			import React, { useState, useEffect, useMemo } from 'react';
			import { useAuth } from '../../contexts/AuthContext';
			import { useSearch } from '../../contexts/SearchContext';
			import { useNavigate } from 'react-router-dom';
			import ProfileEditModal from './ProfileEditModal';
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
				Edit
			} from 'lucide-react';
			import api from '../../api/axios';
			import LoadingSpinner from '../ui/LoadingSpinner';

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

			const TeachersPage = () => {
				const { isAdmin, loginAsUser } = useAuth();
				const { searchTerm, globalFilter } = useSearch();
				const navigate = useNavigate();

			const [teachers, setTeachers] = useState([]);
			const [loading, setLoading] = useState(true);
			const [error, setError] = useState('');
			const [debouncedSearch, setDebouncedSearch] = useState(searchTerm || '');
			const [sortBy, setSortBy] = useState('firstName');
			const [sortOrder, setSortOrder] = useState('asc');
			const [statusFilter, setStatusFilter] = useState('active');
			const [expandedTeacher, setExpandedTeacher] = useState(null);
			const [editingTeacher, setEditingTeacher] = useState(null);
			const [currentPage, setCurrentPage] = useState(1);
				const [totalPages, setTotalPages] = useState(1);
				const itemsPerPage = 30;
				const [statusCounts, setStatusCounts] = useState({ active: 0, inactive: 0, all: 0 });

				const fetchStatusCounts = async () => {
					try {
						const baseParams = {
							role: 'teacher',
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
				}, [debouncedSearch, sortBy, sortOrder, statusFilter, currentPage]);

				const fetchTeachers = async () => {
					try {
						setLoading(true);
						const params = {
							role: 'teacher',
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
						const fetched = response.data.users || [];

						// Compute fallback values only for teachers missing monthlyHours (null/undefined)
						const needFallback = fetched.filter(t => !(t.teacherInfo && (t.teacherInfo.monthlyHours !== undefined && t.teacherInfo.monthlyHours !== null)));
						if (needFallback.length) {
							const monthStart = new Date();
							monthStart.setUTCDate(1);
							monthStart.setUTCHours(0,0,0,0);
							const now = new Date();
							await Promise.all(needFallback.map(async (t) => {
								try {
									const classesRes = await api.get('/classes', { params: { teacher: t._id, dateFrom: monthStart.toISOString(), dateTo: now.toISOString(), limit: 1000 } });
									const classes = classesRes.data.classes || [];
									const countable = classes.filter(c => ['attended','missed_by_student','absent'].includes(String(c.status)));
									const minutes = countable.reduce((s, c) => s + (Number(c.duration || 0) || 0), 0);
									const hours = Math.round((minutes / 60) * 10) / 10; // one decimal
									if (!t.teacherInfo) t.teacherInfo = {};
									t.teacherInfo._computedMonthlyHours = hours;
								} catch (err) {
									console.warn('Failed to compute fallback hours for teacher', t._id, err && err.message);
								}
							}));
						}

						setTeachers(fetched);
						setTotalPages((response.data.pagination && response.data.pagination.pages) || 1);
						await fetchStatusCounts();
					} catch (err) {
						setError('Failed to fetch teachers');
						console.error('Fetch teachers error:', err);
					} finally {
						setLoading(false);
					}
				};

				const handleSort = (field) => {
					if (sortBy === field) {
						setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
					} else {
						setSortBy(field);
						setSortOrder('asc');
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

				const filteredTeachers = useMemo(() => {
					let result = teachers || [];

					if (statusFilter !== 'all') {
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

					if (globalFilter && globalFilter !== 'all') {
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

				if (loading && !teachers.length) {
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
											<div className="flex items-center justify-between">
												<div className="flex items-center space-x-4">
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
														<div className="flex items-center space-x-4 text-sm text-muted-foreground">
															<span className={`px-2 py-1 rounded-full text-xs ${
																teacher.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
															}`}>
																{teacher.isActive ? 'Active' : 'Inactive'}
															</span>
															<span className="flex items-center">
																<Clock className="h-3 w-3 mr-1" />
																{/* Show backend value when present (including 0). Only use computed fallback when backend value is missing. */}
																{ (teacher.teacherInfo && (teacher.teacherInfo.monthlyHours !== undefined && teacher.teacherInfo.monthlyHours !== null))
																	? Number(teacher.teacherInfo.monthlyHours) || 0
																	: Number(teacher.teacherInfo?._computedMonthlyHours ?? 0)
																} hours this month
															</span>
														</div>
													</div>
												</div>

												<div className="flex items-center space-x-2">
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
											</div>
										)}
										
										

										<div className="mt-3 p-3">
											<div className="flex flex-wrap gap-2">
												{teacher.teacherInfo?.subjects?.map((subject, index) => (
													<span key={index} className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full">
														{subject}
													</span>
												))}
											</div>
										</div>
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

						{!loading && sortedTeachers.length === 0 && (
							<div className="text-center py-12">
								<User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
								<h3 className="text-lg font-semibold text-foreground mb-2">No teachers found</h3>
								<p className="text-muted-foreground">
									{searchTerm ? 'Try adjusting your search criteria.' : 'No teachers have been registered yet.'}
								</p>
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
				</div>
			);
		};			export default TeachersPage;
