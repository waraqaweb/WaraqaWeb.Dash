/**
 * Students Page Component
 * 
 * Displays a searchable, filterable, and sortable list of students
 * Includes detailed view with collapsible information, guardian details, and academic progress
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Search, 
  SortAsc, 
  SortDesc, 
  ChevronDown, 
  ChevronUp, 
  MessageCircle, 
  User, 
  Clock, 
  GraduationCap, 
  Users, 
  MapPin, 
  Phone,
  Mail,
  Book,
  Star,
  UserX,
  UserCheck,
  Baby,
  School,
  Plus,
  Minus,
  LogIn,
  Edit,
  Globe
} from 'lucide-react';
import api from '../../api/axios';
import EditStudentModal from '../students/EditStudentModal';
import LoadingSpinner from '../ui/LoadingSpinner';

const STUDENT_STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'all', label: 'All' }
];

const isStudentActive = (student = {}) => {
  const infoStatus = (student.studentInfo?.status || '').toLowerCase();
  if (infoStatus.includes('inactive') || infoStatus === 'suspended') {
    return false;
  }
  if (infoStatus === 'active') {
    return true;
  }
  if (typeof student.isActive === 'boolean') {
    return student.isActive;
  }
  return true;
};

const StudentsPage = () => {
  const { user, isAdmin, isGuardian, isTeacher, loginAsUser } = useAuth();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const location = useLocation();

  const urlParams = new URLSearchParams(location.search);
  const initialSearch = urlParams.get('q') || '';
  const initialPage = Number(urlParams.get('page') || '1');

  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [sortBy, setSortBy] = useState('firstName');
  const [sortOrder, setSortOrder] = useState('asc');
  const [statusFilter, setStatusFilter] = useState('active');
  const [guardianFilter, setGuardianFilter] = useState('all');
  const [guardiansList, setGuardiansList] = useState([]);
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [editingStudent, setEditingStudent] = useState(null); // Store both studentId and guardianId
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(1);
  const [guardiansData, setGuardiansData] = useState({});
  const deriveStudentTimezone = (s) => {
    return s?.guardianTimezone || s?.timezone || s?.studentInfo?.guardianTimezone || s?.studentInfo?.timezone || 'UTC';
  };
  const itemsPerPage = 30;
  const fetchStudentsRef = useRef(null);
  const [statusCounts, setStatusCounts] = useState({ active: 0, inactive: 0, all: 0 });

  const updateStatusCountsFromList = (list = []) => {
    const counts = { active: 0, inactive: 0, all: list.length };
    list.forEach((student) => {
      if (isStudentActive(student)) {
        counts.active += 1;
      } else {
        counts.inactive += 1;
      }
    });
    setStatusCounts(counts);
  };

  const fetchStatusCounts = async () => {
    try {
      const baseParams = {
        role: 'student',
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
      console.warn('Failed to fetch student status counts', err?.message || err);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // when debounced search or page changes, reflect in URL (replace so user can use back/forward)
  useEffect(() => {
    try {
      const p = new URLSearchParams(location.search);
      if (debouncedSearch) p.set('q', debouncedSearch); else p.delete('q');
      p.set('page', String(currentPage));
      const newSearch = p.toString();
      const newUrl = `${location.pathname}${newSearch ? `?${newSearch}` : ''}`;
      if (newUrl !== window.location.pathname + window.location.search) {
        window.history.replaceState({}, '', newUrl);
      }
    } catch (e) {
      // ignore
    }
  }, [debouncedSearch, currentPage, location.pathname, location.search]);

  // reset to first page when the user types a new query
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    fetchStudentsRef.current?.();
  }, [debouncedSearch, sortBy, sortOrder, statusFilter, currentPage, guardianFilter]);

  const fetchStudents = async () => {
    try {
      let countsHandled = false;
      setLoading(true);
      console.log('[StudentsPage] fetchStudents() start', {
        guardianFilter,
        isGuardian: isGuardian && isGuardian(),
        isAdmin: isAdmin && isAdmin(),
        page: currentPage,
        search: debouncedSearch,
        sortBy,
        sortOrder,
        statusFilter
      });
      const params = {
        role: 'student',
        page: currentPage,
        limit: itemsPerPage,
        search: debouncedSearch,
        sortBy,
        order: sortOrder,
      };

      if (statusFilter !== 'all') {
        params.isActive = statusFilter === 'active';
      }

      // If a guardian is selected in the filter, fetch that guardian's students
      let response;
      if (guardianFilter !== 'all') {
        response = await api.get(`/users/${guardianFilter}/students`);
        const arr = response.data.students || [];
        const withTZ = arr.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
        console.log('[StudentsPage] fetched guardian students', { count: arr.length, guardianId: guardianFilter });
        setStudents(withTZ);
        setTotalPages(1);
        updateStatusCountsFromList(withTZ);
        countsHandled = true;
      } else if (isGuardian()) {
        // if logged-in user is a guardian, fetch their students
        response = await api.get(`/users/guardian/${user._id}/students`);
        const arr = response.data.students || [];
        const withTZ = arr.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
        console.log('[StudentsPage] fetched my guardian students', { count: arr.length, guardianId: user?._id });
        setStudents(withTZ);
        setTotalPages(1);
        updateStatusCountsFromList(withTZ);
        countsHandled = true;
      } else if (isTeacher && isTeacher()) {
        // Teachers: show only students who have upcoming classes with this teacher
        // Use classes endpoint with filter=upcoming and teacher id
        try {
          const classesRes = await api.get('/classes', { params: { filter: 'upcoming', teacher: user._id, limit: 1000 } });
          const classesArr = classesRes.data.classes || [];
          console.log('[StudentsPage] fetched upcoming classes for teacher', { count: classesArr.length, teacher: user._id });

          // First collect guardian ids present in returned classes
          const guardianIdsSet = new Set();
          classesArr.forEach((cls) => {
            const s = cls.student || {};
            const guardianId = s.guardianId && (s.guardianId._id || s.guardianId);
            if (guardianId) guardianIdsSet.add(String(guardianId));
          });

          // Fetch guardians data for all involved guardians
          const guardianIds = Array.from(guardianIdsSet);
          const guardiansPromises = guardianIds.map(id => fetchGuardianData(id));
          const guardiansResults = await Promise.all(guardiansPromises);
          const guardiansMap = {};
          guardianIds.forEach((id, idx) => { guardiansMap[id] = guardiansResults[idx]; });
          setGuardiansData(guardiansMap);

          // Build unique student map keyed by guardianId + studentId (or fallback to matched embedded student id)
          const studentKeyMap = new Map();
          const pendingNameContexts = {}; // name -> [{ guardianId, studentName, sampleClass }]

          for (const cls of classesArr) {
            const s = cls.student || {};
            const rawGuardian = s.guardianId;
            const guardianId = rawGuardian && (rawGuardian._id || rawGuardian);
            const studentId = s.studentId;
            const studentName = (s.studentName || '').trim();

            // If we have studentId use it, otherwise try to match against guardian embedded students by name
            let resolvedStudentId = studentId;
            if (!resolvedStudentId && guardianId && guardiansMap[String(guardianId)]) {
              const g = guardiansMap[String(guardianId)];
              if (g && g.guardianInfo && Array.isArray(g.guardianInfo.students)) {
                const match = g.guardianInfo.students.find(ss => {
                  const full = `${ss.firstName || ''} ${ss.lastName || ''}`.trim();
                  return full && studentName && full.toLowerCase() === studentName.toLowerCase();
                });
                if (match) resolvedStudentId = match._id;
              }
            }

            if (!resolvedStudentId) {
              // Queue for global name search fallback later
              if (studentName) {
                const key = studentName.toLowerCase();
                if (!pendingNameContexts[key]) pendingNameContexts[key] = [];
                pendingNameContexts[key].push({ guardianId: guardianId ? String(guardianId) : null, studentName, sampleClass: cls });
              }
              continue; // skip adding to map now; we'll resolve after global search
            }

            if (!guardianId || !resolvedStudentId) {
              // skip if we still can't resolve student identity
              continue;
            }

            const key = `${guardianId}_${resolvedStudentId}`;
            if (!studentKeyMap.has(key)) {
              studentKeyMap.set(key, {
                _id: String(resolvedStudentId),
                guardianId: String(guardianId),
                studentName: studentName || '',
                classesCount: 1,
                sampleClass: cls,
              });
            } else {
              const entry = studentKeyMap.get(key);
              entry.classesCount = (entry.classesCount || 0) + 1;
              studentKeyMap.set(key, entry);
            }
          }

          // For pending name contexts (classes without studentId or embedded match), try a global students search by name
          const pendingNames = Object.keys(pendingNameContexts);
          if (pendingNames.length > 0) {
            // For each unique name, call users search endpoint and attempt to match by full name
            for (const nameKey of pendingNames) {
              try {
                const name = pendingNameContexts[nameKey][0].studentName;
                const searchRes = await api.get('/users', { params: { role: 'student', search: name, limit: 20 } });
                const candidates = searchRes.data.users || [];
                const exact = candidates.find(c => {
                  const full = `${c.firstName || ''} ${c.lastName || ''}`.trim();
                  return full && full.toLowerCase() === name.toLowerCase();
                });

                const chosen = exact || candidates[0] || null;
                if (chosen) {
                  // For each context using this name, map to the chosen student id and guardian if possible
                  for (const ctx of pendingNameContexts[nameKey]) {
                    const resolvedStudentId = String(chosen._id);
                    const guardianId = ctx.guardianId || (chosen.studentInfo?.guardianId || null);
                    if (!guardianId) continue;
                    const key = `${guardianId}_${resolvedStudentId}`;
                    if (!studentKeyMap.has(key)) {
                      studentKeyMap.set(key, {
                        _id: resolvedStudentId,
                        guardianId: String(guardianId),
                        studentName: name,
                        classesCount: 1,
                        sampleClass: ctx.sampleClass,
                      });
                    } else {
                      const entry = studentKeyMap.get(key);
                      entry.classesCount = (entry.classesCount || 0) + 1;
                      studentKeyMap.set(key, entry);
                    }
                  }
                } else {
                  // no candidate found; skip
                }
              } catch (err) {
                console.warn('Global student search failed for', nameKey, err?.message || err);
              }
            }
          }

          // For each unique student, try to resolve detailed info either from guardian embedded students or standalone user record
          const resolvedStudents = [];
          const studentFetchPromises = [];
          const studentEntries = Array.from(studentKeyMap.values());

          for (const entry of studentEntries) {
            const guardian = guardiansMap[entry.guardianId];
            let foundEmbedded = null;
            if (guardian && guardian.guardianInfo && Array.isArray(guardian.guardianInfo.students)) {
              foundEmbedded = guardian.guardianInfo.students.find(s => String(s._id) === String(entry._id));
            }
            if (foundEmbedded) {
              resolvedStudents.push({
                _id: String(entry._id),
                firstName: foundEmbedded.firstName,
                lastName: foundEmbedded.lastName,
                studentInfo: {
                  ...foundEmbedded,
                },
                profilePicture: (foundEmbedded.profilePicture && (foundEmbedded.profilePicture.url || foundEmbedded.profilePicture)) || null,
                guardianId: entry.guardianId,
                guardianName: `${guardian?.firstName || ''} ${guardian?.lastName || ''}`.trim(),
                classesCount: entry.classesCount,
              });
            } else {
              // Defer fetching standalone student user
              studentFetchPromises.push((async () => {
                try {
                  const stuRes = await api.get(`/users/${entry._id}`);
                  const stu = stuRes.data.user;
                  return {
                    _id: stu._id,
                    firstName: stu.firstName,
                    lastName: stu.lastName,
                    studentInfo: stu.studentInfo || {},
                    profilePicture: (stu.profilePicture && (stu.profilePicture.url || stu.profilePicture)) || stu.profilePictureThumbnail || null,
                    guardianId: entry.guardianId,
                    guardianName: guardiansMap[entry.guardianId] ? `${guardiansMap[entry.guardianId].firstName || ''} ${guardiansMap[entry.guardianId].lastName || ''}`.trim() : undefined,
                    classesCount: entry.classesCount,
                  };
                } catch (e) {
                  console.warn('Failed to fetch standalone student', entry._id, e?.message || e);
                  return null;
                }
              })());
            }
          }

          const fetchedStandalone = await Promise.all(studentFetchPromises);
          fetchedStandalone.forEach(s => { if (s) resolvedStudents.push(s); });

          // Sort by name
          resolvedStudents.sort((a, b) => {
            const an = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
            const bn = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
            return an.localeCompare(bn);
          });

          const withTZ = resolvedStudents.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
          setStudents(withTZ);
          setTotalPages(1);
          updateStatusCountsFromList(withTZ);
          countsHandled = true;
          response = { data: { users: resolvedStudents, students: resolvedStudents } };
        } catch (err) {
          console.error('Failed to fetch classes for teacher view', err);
          setError('Failed to fetch students');
        }
      } else {
        // Admins should see embedded students as well; use the aggregate endpoint
          if (isAdmin()) {
          response = await api.get('/users/admin/all-students');
          const arr = response.data.students || [];
          const withTZ = arr.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
          console.log('[StudentsPage] fetched admin all-students', { count: arr.length });
          setStudents(withTZ);
          setTotalPages(1);
          updateStatusCountsFromList(withTZ);
          countsHandled = true;
        } else {
          // Fallback for other roles (non-teacher, non-guardian), fetch users
          response = await api.get('/users', { params });
          const arr = response.data.users || [];
          console.log('[StudentsPage] fetched /users?role=student', { count: arr.length });
          const withTZ = arr.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
          setStudents(withTZ);
          setTotalPages(response.data.pagination?.pages || 1);
        }
      }

      // Fetch guardian data for each student (use the freshly fetched students)
      const fetchedStudents = response.data.users || response.data.students || [];
      try {
        const miss = fetchedStudents.filter(s => !s || !(s.firstName || '').trim() || !(s.lastName || '').trim());
        console.log('[StudentsPage] fetchedStudents summary', {
          total: fetchedStudents.length,
          missingNames: miss.length,
          samplesMissing: miss.slice(0, 3).map(s => ({ id: s?._id || s?.id, firstName: s?.firstName, lastName: s?.lastName, guardianId: s?.studentInfo?.guardianId || s?.guardianId, guardianName: s?.guardianName }))
        });
      } catch (e) {
        console.warn('[StudentsPage] failed to summarize fetchedStudents', e?.message || e);
      }
      // Support both standalone student users (studentInfo.guardianId) and embedded students (guardianId on the object)
      const guardianIds = [...new Set(fetchedStudents.map(student => (student.studentInfo?.guardianId || student.guardianId)).filter(Boolean))];
      // If current user is a teacher, use teacher endpoint to get guardian info in bulk (teachers cannot call /users/:id)
      if (isTeacher && isTeacher()) {
        try {
          const teacherId = user._id || user.id;
          const teacherStudentsRes = await api.get(`/users/teacher/${teacherId}/students`);
          const teacherStudentsArr = teacherStudentsRes.data.students || [];
          const gMap = {};
          teacherStudentsArr.forEach(ts => {
            const gId = String(ts.guardianId || ts.guardian || '');
            if (gId && !gMap[gId]) {
              const gName = ts.guardianName || (ts.guardian && `${ts.guardian.firstName || ''} ${ts.guardian.lastName || ''}`.trim());
              const parts = (gName || '').split(' ');
              gMap[gId] = { _id: gId, firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '', timezone: ts.guardianTimezone || (ts.guardian && ts.guardian.timezone) || undefined };
            }
          });
          setGuardiansData(gMap);
          console.log('[StudentsPage] guardiansData populated (teacher) ', { guardiansCount: Object.keys(gMap).length });
        } catch (gErr) {
          console.warn('Failed to fetch teacher guardians data', gErr?.message || gErr);
        }
      } else {
        const guardiansPromises = guardianIds.map(guardianId => fetchGuardianData(guardianId));
        const guardiansResults = await Promise.all(guardiansPromises);
        const guardiansMap = {};
        guardianIds.forEach((guardianId, index) => {
          guardiansMap[guardianId] = guardiansResults[index];
        });
        setGuardiansData(guardiansMap);
        console.log('[StudentsPage] guardiansData populated', { guardiansCount: guardianIds.length });
      }

      // If we don't already have the guardians list for the filter dropdown, fetch basic list
      if (guardiansList.length === 0 && !isGuardian()) {
        fetchGuardiansList();
      }

      if (!countsHandled) {
        await fetchStatusCounts();
      }

    } catch (err) {
      setError('Failed to fetch students');
      console.error('Fetch students error:', err);
    } finally {
      setLoading(false);
    }
  };

  fetchStudentsRef.current = fetchStudents;

  // Log when students state changes, to surface empty/missing cases
  useEffect(() => {
    try {
      const miss = (students || []).filter(s => !s || !(s.firstName || '').trim() || !(s.lastName || '').trim());
      console.log('[StudentsPage] students state updated', {
        count: (students || []).length,
        missingNames: miss.length,
        guardianFilter
      });
    } catch (e) {
      // ignore
    }
  }, [students, guardianFilter]);

  const fetchGuardianData = async (guardianId) => {
    try {
  const response = await api.get(`/users/${guardianId}`);
      return response.data.user;
    } catch (err) {
      console.error('Fetch guardian error:', err);
      return null;
    }
  };

  const fetchGuardiansList = async () => {
    try {
      const res = await api.get('/users', { params: { role: 'guardian', limit: 1000 } });
      setGuardiansList(res.data.users || []);
    } catch (err) {
      console.error('Failed to fetch guardians list for filter:', err);
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

  const toggleExpanded = (studentId) => {
    setExpandedStudent(expandedStudent === studentId ? null : studentId);
  };

  const handleStatusChange = async (studentId, newStatus) => {
    try {
  await api.put(`/users/${studentId}/status`, { isActive: newStatus });
      fetchStudents(); // Refresh the list
    } catch (err) {
      setError('Failed to update student status');
      console.error('Update status error:', err);
    }
  };

  const handleHoursUpdate = async (studentId, hoursChange) => {
    try {
      const student = students.find(s => s._id === studentId);
      const currentHours = student.studentInfo?.hoursRemaining || 0;
      const newHours = currentHours + hoursChange;
      
  await api.put(`/users/${studentId}`, {
        studentInfo: {
          ...student.studentInfo,
          hoursRemaining: newHours
        }
      });
      
      fetchStudents(); // Refresh the list
    } catch (err) {
      setError('Failed to update student hours');
      console.error('Update hours error:', err);
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

  const getEvaluationColor = (evaluation) => {
    switch (evaluation?.toLowerCase()) {
      case 'excellent': return 'text-green-600';
      case 'good': return 'text-blue-600';
      case 'average': return 'text-yellow-600';
      case 'needs improvement': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  // keep the page UI mounted while loading so search inputs don't lose focus

  const filteredStudents = useMemo(() => {
    const q = (searchTerm || '').trim().toLowerCase();
    let working = students || [];

    if (statusFilter !== 'all') {
      working = working.filter((student) => {
        const active = isStudentActive(student);
        return statusFilter === 'active' ? active : !active;
      });
    }

    if (!q) return working;

    const parts = q.split(/\s+/).filter(Boolean);
    return working.filter((s) => {
      const first = (s.firstName || '').toLowerCase();
      const last = (s.lastName || '').toLowerCase();
      const full = `${first} ${last}`.trim();
      const email = (s.email || '').toLowerCase();
      const phone = (s.phone || '').toLowerCase();
      const guardian = guardiansData[s.studentInfo?.guardianId];
      const guardianFirst = (guardian?.firstName || '').toLowerCase();
      const guardianLast = (guardian?.lastName || '').toLowerCase();
      const guardianFull = `${guardianFirst} ${guardianLast}`.trim();

      // Multi-part prefix matching: e.g. "jo sm" matches John Smith
      const partsMatchName = parts.every(p => (
        first.startsWith(p) || last.startsWith(p) || full.includes(p)
      ));

      const emailMatch = email.includes(q);
      const phoneMatch = phone.includes(q);
      const guardianMatch = guardianFull.includes(q) || parts.every(p => guardianFirst.startsWith(p) || guardianLast.startsWith(p));

      return partsMatchName || emailMatch || phoneMatch || guardianMatch || full.includes(q);
    });
  }, [students, guardiansData, searchTerm, statusFilter]);

  const sortedStudents = useMemo(() => {
    const list = [...(filteredStudents || [])];
    const buildNameKey = (student) => {
      const first = (student.firstName || '').trim().toLowerCase();
      const last = (student.lastName || '').trim().toLowerCase();
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
  }, [filteredStudents, sortBy, sortOrder]);

  return (
    <div className="p-6 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {isGuardian() ? 'My Students' : 'Students'}
          </h1>
          <p className="text-muted-foreground">
            {isGuardian() ? 'View and manage your students\' information' : 'Manage and view student information'}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 mb-4">
            <span className="text-destructive text-sm">{error}</span>
          </div>
        )}

        {/* Search and Filters - visible to all users */}
        <div className="bg-card rounded-lg shadow-sm border border-border p-3 mb-6">
          <div className="flex flex-wrap gap-2 mb-4">
            {STUDENT_STATUS_TABS.map((tab) => {
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

          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search students by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-border rounded-md bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {/* Guardian Filter */}
            <div className="flex items-center space-x-2">
              <label className="text-sm">Guardian</label>
              <select
                value={guardianFilter}
                onChange={(e) => setGuardianFilter(e.target.value)}
                className="px-3 py-2 border border-border rounded-md bg-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All Guardians</option>
                {guardiansList.map(g => (
                  <option key={g._id} value={g._id}>{g.firstName} {g.lastName}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleSort('firstName')}
                className="flex items-center space-x-1 px-3 py-2 border border-border rounded-md bg-input text-foreground hover:bg-muted transition-colors"
              >
                <span>Name</span>
                {sortBy === 'firstName' && (
                  sortOrder === 'asc' ? <SortAsc className="h-4 w-4" /> : <SortDesc className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Students List */}
        {loading && sortedStudents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <LoadingSpinner text="Loading students…" />
            {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
          </div>
        ) : null}

        <div className="space-y-3">
          {sortedStudents.map((student) => {
            // Resolve guardian object from multiple possible locations and the guardiansData cache
            let guardian = null;

            // If the student object already contains a populated guardian object, use it
            if (student.guardian && typeof student.guardian === 'object' && (student.guardian.firstName || student.guardian.lastName)) {
              guardian = student.guardian;
            } else {
              // Try multiple ID locations and match against fetched guardiansData
              const candidateIds = [
                student.studentInfo?.guardianId,
                student.guardianId,
                student.studentInfo?.guardian?._id,
                student.guardian?._id
              ].filter(Boolean).map(String);

              for (const id of candidateIds) {
                if (guardiansData[id]) { guardian = guardiansData[id]; break; }
              }
            }

            // Fallback name values that may be present on the student object
            const fallbackGuardianName = student.guardianName || student.studentInfo?.guardianName;
            
            return (
              <div key={student._id} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
                {/* Student Summary */}
                <div className="p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {/* Avatar */}
                      <div className="h-12 w-12 bg-primary rounded-full flex items-center justify-center overflow-hidden">
                        {student.profilePicture ? (
                          // support either string URL or object { url, thumbnail }
                          <img
                            src={typeof student.profilePicture === 'string' ? student.profilePicture : (student.profilePicture.url || student.profilePicture.thumbnail || '')}
                            alt="Profile"
                            className="h-full w-full rounded-full object-cover"
                          />
                        ) : (
                          <span className="text-lg font-medium text-primary-foreground">
                            {student.firstName?.charAt(0)}{student.lastName?.charAt(0)}
                          </span>
                        )}
                      </div>

                      {/* Basic Info */}
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">
                          {student.firstName} {student.lastName}
                        </h3>
                        {/* Show guardian name under student name for admin and teacher users to disambiguate similar names */}
                        {(isAdmin() || (isTeacher && isTeacher())) && (
                          (() => {
                            let gName = null;
                            if (guardian) {
                              gName = `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim();
                            }
                            if (!gName) {
                              // use any fallback name present on the student record
                              gName = fallbackGuardianName || (student.studentInfo?.guardian ? `${student.studentInfo.guardian.firstName || ''} ${student.studentInfo.guardian.lastName || ''}`.trim() : null);
                            }
                            return gName ? (
                              <div className="text-sm text-muted-foreground mt-1">
                                <Users className="inline h-3 w-3 mr-1 align-middle" />
                                {gName}
                              </div>
                            ) : null;
                          })()
                        )}
                        <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                          <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(student.studentInfo?.status || 'active')}`}>
                            {student.studentInfo?.status || 'Active'}
                          </span>
                          {guardian && (
                            <span className="flex items-center">
                              <Users className="h-3 w-3 mr-1" />
                              {guardian.firstName} {guardian.lastName}
                            </span>
                          )}
                          {!guardian && (student.guardianName) && (
                            <span className="flex items-center">
                              <Users className="h-3 w-3 mr-1" />
                              {student.guardianName}
                            </span>
                          )}
                          {!isTeacher() && (
                            <span className="flex items-center">
                              <Clock className="h-3 w-3 mr-1" />
                              {student.studentInfo?.hoursRemaining || 0} hours left
                            </span>
                          )}
                          {(student.studentInfo?.evaluationSummary && (isAdmin() || (isTeacher && isTeacher()))) && (
                            <span className={`flex items-center ${getEvaluationColor(student.studentInfo.evaluationSummary)}`}>
                              <Star className="h-3 w-3 mr-1" />
                              {student.studentInfo.evaluationSummary}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center space-x-2">
                      {/* WhatsApp */}
                      {student.studentInfo?.whatsapp && (
                        <button
                          onClick={() => openWhatsApp(student.studentInfo.whatsapp)}
                          className="icon-button icon-button--green"
                          title="WhatsApp"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </button>
                      )}
                      {/* Email */}
                      {student.email && (
                        <button
                          onClick={() => openEmail(student.email)}
                          className="icon-button icon-button--blue"
                          title="Email"
                        >
                          <Mail className="h-4 w-4" />
                        </button>
                      )}

                      {/* Edit Button - Available for both Admin and Guardian */}
                      {(isAdmin() || isGuardian()) && (
                        <button
                          onClick={() => {
                            // Determine if this is an embedded student or a standalone User record
                            // Embedded students won't have a 'role' field, while User records will
                            const isEmbeddedStudent = !student.role;
                            
                            console.log('Edit button clicked:', {
                              studentId: student._id,
                              studentName: `${student.firstName} ${student.lastName}`,
                              hasRole: !!student.role,
                              role: student.role,
                              isEmbeddedStudent,
                              guardianFilter,
                              isGuardian: isGuardian(),
                              isAdmin: isAdmin()
                            });
                            
                            if (isEmbeddedStudent && guardianFilter !== 'all') {
                              // This is an embedded student, use the guardian ID
                              console.log('Using embedded student path with guardianId:', guardianFilter);
                              setEditingStudent({ 
                                studentId: student._id, 
                                guardianId: guardianFilter 
                              });
                            } else if (isEmbeddedStudent && isGuardian()) {
                              // Guardian viewing their embedded students
                              console.log('Using embedded student path with user._id:', user._id);
                              setEditingStudent({ 
                                studentId: student._id, 
                                guardianId: user._id 
                              });
                            } else {
                              // This is a standalone User record with role 'student'
                              // No guardianId needed - update the User record directly
                              console.log('Using standalone user path (no guardianId)');
                              setEditingStudent({ 
                                studentId: student._id, 
                                guardianId: null 
                              });
                            }
                          }}
                          className="icon-button icon-button--blue"
                          title="Edit Student"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                      )}

                      {/* Admin Actions */}
                      {isAdmin() && (
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => handleHoursUpdate(student._id, 5)}
                            className="icon-button icon-button--green"
                            title="Add 5 hours"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleHoursUpdate(student._id, -5)}
                            className="icon-button icon-button--red"
                            title="Remove 5 hours"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleStatusChange(student._id, !student.isActive)}
                            className={`icon-button transition-colors ${student.isActive ? 'icon-button--red' : 'icon-button--green'}`}
                            title={student.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {student.isActive ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => handleLoginAsUser(student._id)}
                            className="icon-button icon-button--indigo"
                            title="Login as User"
                          >
                            <LogIn className="h-4 w-4" />
                          </button>
                        </div>
                      )}

                      {/* Expand/Collapse */}
                      <button
                        onClick={() => toggleExpanded(student._id)}
                        className="icon-button icon-button--muted"
                      >
                        {expandedStudent === student._id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Subjects */}
                  <div className="mt-3">
                    <div className="flex flex-wrap gap-2">
                      {student.studentInfo?.subjects?.map((subject, index) => (
                        <span
                          key={index}
                          className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full"
                        >
                          {subject}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedStudent === student._id && (
                  <div className="border-t border-border bg-muted/30 p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {/* Contact Information */}
                      <div>
                        <h4 className="font-semibold text-foreground mb-3">Contact Information</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center space-x-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            <span>{student.email}</span>
                          </div>
                          {student.phone && (
                            <div className="flex items-center space-x-2">
                              <Phone className="h-4 w-4 text-muted-foreground" />
                              <span>{student.phone}</span>
                            </div>
                          )}
                          {student.studentInfo?.whatsapp && (
                            <div className="flex items-center space-x-2">
                              <MessageCircle className="h-4 w-4 text-muted-foreground" />
                              <span>{student.studentInfo.whatsapp}</span>
                            </div>
                          )}
                          {student.address && (
                            <div className="flex items-center space-x-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span>
                                {[student.address.city, student.address.state, student.address.country]
                                  .filter(Boolean)
                                  .join(', ')}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center space-x-2">
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <span>{deriveStudentTimezone(student)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Academic Information */}
                      <div>
                        <h4 className="font-semibold text-foreground mb-3">Academic Information</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center space-x-2">
                            <GraduationCap className="h-4 w-4 text-muted-foreground" />
                            <span>Grade: {student.studentInfo?.grade || 'N/A'}</span>
                          </div>
                          <div className="flex items-center space-x-2">
                            <School className="h-4 w-4 text-muted-foreground" />
                            <span>School: {student.studentInfo?.school || 'N/A'}</span>
                          </div>
                          {!isTeacher() && (
                            <div className="flex items-center space-x-2">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <span>{student.studentInfo?.hoursRemaining || 0} hours remaining</span>
                            </div>
                          )}
                          {(student.studentInfo?.evaluationSummary && (isAdmin() || (isTeacher && isTeacher()))) && (
                            <div className="flex items-center space-x-2">
                              <Star className="h-4 w-4 text-muted-foreground" />
                              <span className={getEvaluationColor(student.studentInfo.evaluationSummary)}>
                                {student.studentInfo.evaluationSummary}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center space-x-2">
                            <Book className="h-4 w-4 text-muted-foreground" />
                            <span>Language: {student.studentInfo?.language || 'N/A'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Guardian Information */}
                      {guardian && (
                        <div>
                          <h4 className="font-semibold text-foreground mb-3">Guardian Information</h4>
                          <div className="space-y-2 text-sm">
                            <div className="flex items-center space-x-2">
                              <User className="h-4 w-4 text-muted-foreground" />
                              <span>{guardian.firstName} {guardian.lastName}</span>
                            </div>
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
                            <div className="flex items-center space-x-2">
                              <Users className="h-4 w-4 text-muted-foreground" />
                              <span>{guardian.guardianInfo?.relationship || 'Parent'}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Learning Preferences (show to teacher/admin/guardian) */}
                    {(() => {
                      const lp = student.studentInfo?.learningPreferences || student.learningPreferences;
                      if (!lp) return null;
                      return (
                        <div className="mt-6">
                          <h4 className="font-semibold text-foreground mb-2">Learning Preferences</h4>
                          <p className="text-sm text-muted-foreground">{lp}</p>
                        </div>
                      );
                    })()}

                    {/* Current Teachers */}
                    {student.studentInfo?.currentTeachers?.length > 0 && (
                      <div className="mt-6">
                        <h4 className="font-semibold text-foreground mb-3">Current Teachers</h4>
                        <div className="flex flex-wrap gap-2">
                          {student.studentInfo.currentTeachers.map((teacher, index) => (
                            <span
                              key={index}
                              className="px-3 py-1 bg-card border border-border rounded-full text-sm"
                            >
                              {teacher}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Pagination - Only show for admin and teachers */}
        {!isGuardian() && totalPages > 1 && (
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
        {!loading && sortedStudents.length === 0 && (
          <div className="text-center py-12">
            <Baby className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No students found</h3>
            <p className="text-muted-foreground">
              {searchTerm ? 'Try adjusting your search criteria.' : 
               isGuardian() ? 'No students are linked to your account yet.' : 'No students have been registered yet.'}
            </p>
          </div>
        )}
      </div>

      {/* Edit Student Modal */}
      {editingStudent && (
        <EditStudentModal
          studentId={editingStudent.studentId}
          guardianId={editingStudent.guardianId}
          onClose={() => setEditingStudent(null)}
          onUpdated={fetchStudents}
        />
      )}
    </div>
  );
};

export default StudentsPage;


