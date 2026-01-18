/**
 * MyStudentsPage Component
 * 
 * Page for guardians to view and manage their students.
 * Displays student list with details and provides actions for adding/editing students.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Users, MessageCircle, Mail, ChevronDown, UserX, UserCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';
import { formatDateDDMMMYYYY } from '../../utils/date';
import AddStudentModal from '../../components/dashboard/AddStudentModal';
import EditStudentModal from '../../components/students/EditStudentModal';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import api from '../../api/axios';
import { deleteStudent as deleteStandaloneStudent } from '../../api/students';
import { makeCacheKey, readCache, writeCache } from '../../utils/sessionCache';


const STATUS_TABS = [
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'all', label: 'All' }
];

const STUDENTS_PER_PAGE = 30;

const isStudentActive = (student = {}) => {
  const infoStatus = (student.studentInfo?.status || '').toLowerCase();
  if (infoStatus === 'inactive' || infoStatus === 'suspended') {
    return false;
  }
  if (infoStatus === 'active') {
    return true;
  }
  if (typeof student.isActive === 'boolean') {
    return student.isActive;
  }
  return student.isActive !== false;
};

const isCancelledClassStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'canceled' || normalized.startsWith('cancelled');
};

const buildUpcomingSubjectsByStudentId = (classesArr = []) => {
  const map = new Map();
  (Array.isArray(classesArr) ? classesArr : []).forEach((cls) => {
    if (!cls || isCancelledClassStatus(cls.status)) return;
    const studentId = cls.student?.studentId?._id || cls.student?.studentId;
    if (!studentId) return;
    const subject = String(cls.subject || '').trim();
    if (!subject) return;
    const key = String(studentId);
    const set = map.get(key) || new Set();
    set.add(subject);
    map.set(key, set);
  });
  const out = {};
  map.forEach((set, key) => {
    out[key] = Array.from(set).sort((a, b) => a.localeCompare(b));
  });
  return out;
};


const MyStudentsPage = () => {
  const { user, isAdmin, isTeacher, isGuardian, loading } = useAuth();
  const { searchTerm, globalFilter } = useSearch();
  const [students, setStudents] = useState([]);
  const [, setTotalHours] = useState(0);
  const [localLoading, setLocalLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [expandedStudent, setExpandedStudent] = useState(null);
  const [localSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(localSearchTerm);
  const [useGlobalSearch] = useState(true); // Guardian option
  const [guardianFilter] = useState('all');
  const [, setGuardiansList] = useState([]);
  const [classesHoursMap, setClassesHoursMap] = useState({});
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [sortBy] = useState('firstName');
  const [sortOrder] = useState('asc');
  const [statusFilter, setStatusFilter] = useState('active');
  const [currentPage, setCurrentPage] = useState(1);

  const fetchStudentsRef = React.useRef(null);
  const fetchGuardiansListRef = React.useRef(null);

  const deriveStudentTimezone = (s) => {
    return s?.guardianTimezone || s?.timezone || s?.studentInfo?.guardianTimezone || s?.studentInfo?.timezone || 'UTC';
  };

  const getStatusColor = (isActive) => {
    return isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
  };

  const effectiveSearchTerm = useMemo(() => (
    useGlobalSearch ? (searchTerm || '') : (localSearchTerm || '')
  ), [useGlobalSearch, searchTerm, localSearchTerm]);

  // Debounce localSearchTerm
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(localSearchTerm), 300);
    return () => clearTimeout(t);
  }, [localSearchTerm]);

  // Fetch students when component mounts or filters change
  // Wait for auth loading to finish before fetching to ensure token header is set
  useEffect(() => {
    if (user && !loading) {
      fetchStudentsRef.current?.();
      if (!isGuardian || !isGuardian()) fetchGuardiansListRef.current?.();
    }
  }, [user, loading, debouncedSearch, guardianFilter, sortBy, sortOrder, isGuardian]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, guardianFilter, effectiveSearchTerm]);

  useEffect(() => {
    if ((effectiveSearchTerm || '').trim() && statusFilter !== 'all') {
      setStatusFilter('all');
    }
  }, [effectiveSearchTerm, statusFilter]);


const fetchStudents = async () => {
  setLocalLoading(true);
  setError('');
  console.log('[MyStudentsPage] fetchStudents() start', {
    role: user?.role,
    userId: user?.id || user?._id,
    guardianFilter,
    search: debouncedSearch,
    sortBy,
    sortOrder
  });

  try {
  let response;
  let fetchedArr = null;

    // If a guardian filter is selected, fetch that guardian's students.
    // Admins can call the guardian endpoint, but teachers cannot — for teachers fetch from
    // their teacher-students endpoint and filter locally to avoid 403 responses.
    let guardianStudentsArr = null;
    if (guardianFilter !== 'all') {
      if (isTeacher && isTeacher()) {
        const teacherId = user._id || user.id;
        const res = await api.get(`/users/teacher/${teacherId}/students`);
        const arrAll = res.data.students || [];
        guardianStudentsArr = arrAll.filter(s => String(s.guardianId || s.guardian) === String(guardianFilter));
        const withTZ = guardianStudentsArr.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
        setStudents(withTZ);
        // Do not expose total hours to teachers
        setTotalHours(0);
      } else {
        response = await api.get(`/users/${guardianFilter}/students`);
        guardianStudentsArr = response.data.students || [];
        const withTZ = guardianStudentsArr.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
        setStudents(withTZ);
        setTotalHours(response.data.totalHours || 0);
      }
      try {
        const miss = (Array.isArray(guardianStudentsArr) ? guardianStudentsArr : []).filter(s => !s || !(s.firstName || '').trim() || !(s.lastName || '').trim());
        console.log('[MyStudentsPage] guardian students fetched', {
          guardianId: guardianFilter,
          count: (Array.isArray(guardianStudentsArr) ? guardianStudentsArr.length : 0),
          missingNames: miss.length,
          samplesMissing: (Array.isArray(guardianStudentsArr) ? guardianStudentsArr : []).slice(0, 3).map(s => ({ id: s?._id || s?.id, firstName: s?.firstName, lastName: s?.lastName }))
        });
      } catch (_) {}
      return;
    }


    const cacheKey = makeCacheKey(
      'students:list',
      user?._id,
      {
        role: user?.role,
        guardianFilter,
        statusFilter,
        globalFilter,
        search: (effectiveSearchTerm || '').trim() || undefined,
      }
    );

    const cached = readCache(cacheKey, { deps: ['users', 'students', 'classes'] });
    if (cached.hit && cached.value) {
      setStudents(cached.value.students || []);
      setTotalHours(cached.value.totalHours || 0);
      setLocalLoading(false);
      if (cached.ageMs < 60_000) return;
    }

    if (isAdmin && isAdmin()) {
      // Fast first paint: ask for a limited list first (uses the optimized filtered flow).
      // Then, if needed, the user can refine search/filters; we also cache the result.
      response = await api.get('/users/admin/all-students', {
        params: {
          search: (effectiveSearchTerm || '').trim() || undefined,
          limit: 400,
        }
      });
      const arr = response.data.students || [];
      const withTZ = arr.map((st) => ({
        ...st,
        timezone: deriveStudentTimezone(st),
        subjects: Array.isArray(st.subjects) ? st.subjects : [],
      }));
      fetchedArr = withTZ;
      setStudents(withTZ);
      setTotalHours(response.data.totalHours || 0);

      writeCache(
        cacheKey,
        { students: withTZ, totalHours: response.data.totalHours || 0 },
        { ttlMs: 5 * 60_000, deps: ['users', 'students', 'classes'] }
      );
  } else if (isTeacher && isTeacher()) {
      // For teachers show only students who have upcoming classes with this teacher.
      try {
        const teacherId = user._id || user.id;
        const classesRes = await api.get('/classes', { params: { filter: 'upcoming', teacher: teacherId, limit: 2000 } });
        const classesArr = classesRes.data.classes || [];
        const upcomingNonCancelled = classesArr.filter((cls) => !isCancelledClassStatus(cls?.status));
        console.log('[MyStudentsPage] fetched upcoming classes for teacher', { count: upcomingNonCancelled.length, teacher: teacherId });

        // Collect guardian ids and build a unique student key map
        const guardianIdsSet = new Set();
        const studentKeyMap = new Map();
        const pendingNameContexts = {};

        const subjectsByStudentId = new Map();
        for (const cls of upcomingNonCancelled) {
          const s = cls.student || {};
          const rawGuardian = s.guardianId;
          const guardianId = rawGuardian && (rawGuardian._id || rawGuardian);
          const studentId = s.studentId;
          const studentName = (s.studentName || '').trim();

          if (studentId) {
            const subject = String(cls.subject || '').trim();
            if (subject) {
              const sid = String(studentId);
              const set = subjectsByStudentId.get(sid) || new Set();
              set.add(subject);
              subjectsByStudentId.set(sid, set);
            }
          }

          if (guardianId) guardianIdsSet.add(String(guardianId));

          // Try to resolve studentId from embedded guardian students if missing
          let resolvedStudentId = studentId;
          if (!resolvedStudentId && guardianId) {
            // we'll fetch guardian records later and try to match by name
            if (studentName) {
              const key = studentName.toLowerCase();
              if (!pendingNameContexts[key]) pendingNameContexts[key] = [];
              pendingNameContexts[key].push({ guardianId: String(guardianId), studentName, sampleClass: cls });
            }
            continue; // resolution deferred
          }

          if (!guardianId || !resolvedStudentId) continue;

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

        // Fetch teacher students once and build guardian map + a lookup array of students.
        // This avoids calling /users/:id (which teachers are forbidden to call) and gives
        // us both standalone and embedded student shapes in a single response.
        const guardiansMap = {};
        let teacherStudentsArr = [];
        try {
          const teacherStudentsRes = await api.get(`/users/teacher/${teacherId}/students`);
          teacherStudentsArr = teacherStudentsRes.data.students || [];
          teacherStudentsArr.forEach((s) => {
            const gId = String(s.guardianId || s.guardian || '');
            const gName = s.guardianName || (s.guardian && `${s.guardian.firstName || ''} ${s.guardian.lastName || ''}`.trim());
            if (gId && !guardiansMap[gId]) {
              const parts = (gName || '').split(' ');
              guardiansMap[gId] = { _id: gId, firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '', fullName: gName, guardianInfo: s.guardian || null };
            }
          });
          setGuardiansList(Object.values(guardiansMap));
        } catch (gErr) {
          console.warn('Failed to fetch teacher students for guardian map', gErr?.message || gErr);
        }

        // Resolve any pending studentIds by matching guardianId + student name against teacherStudentsArr.
        // This avoids calling endpoints teachers may not be allowed to access.
        const pendingKeys = Object.keys(pendingNameContexts || {});
        if (pendingKeys.length > 0 && Array.isArray(teacherStudentsArr) && teacherStudentsArr.length > 0) {
          for (const nameKey of pendingKeys) {
            const contexts = pendingNameContexts[nameKey] || [];
            for (const ctx of contexts) {
              const targetGuardianId = String(ctx.guardianId || '');
              const targetName = String(ctx.studentName || '').trim().toLowerCase();
              if (!targetGuardianId || !targetName) continue;

              const found = teacherStudentsArr.find((ts) => {
                const gId = String(ts.guardianId || ts.guardian || '');
                const full = `${(ts.firstName || '').trim()} ${(ts.lastName || '').trim()}`.trim().toLowerCase();
                return gId === targetGuardianId && full === targetName;
              });

              if (!found?._id) continue;

              const resolvedStudentId = String(found._id);
              const mapKey = `${targetGuardianId}_${resolvedStudentId}`;
              if (!studentKeyMap.has(mapKey)) {
                studentKeyMap.set(mapKey, {
                  _id: resolvedStudentId,
                  guardianId: targetGuardianId,
                  studentName: ctx.studentName,
                  classesCount: 1,
                  sampleClass: ctx.sampleClass,
                });
              } else {
                const entry = studentKeyMap.get(mapKey);
                entry.classesCount = (entry.classesCount || 0) + 1;
                studentKeyMap.set(mapKey, entry);
              }
            }
          }
        }

        // Resolve detailed student records by matching against teacherStudentsArr (it contains both embedded and standalone shapes)
        const resolvedStudents = [];
        const studentEntries = Array.from(studentKeyMap.values());

        for (const entry of studentEntries) {
          // Prefer exact _id match in teacherStudentsArr
          const byId = teacherStudentsArr.find(ts => String(ts._id) === String(entry._id));
          if (byId) {
            resolvedStudents.push({
              _id: String(byId._id),
              firstName: byId.firstName,
              lastName: byId.lastName,
              studentInfo: byId.studentInfo || {},
              dateOfBirth: byId.dateOfBirth || byId.studentInfo?.dateOfBirth || null,
              gender: byId.gender || byId.studentInfo?.gender || null,
              language: byId.language || byId.studentInfo?.language || null,
              spokenLanguages: byId.spokenLanguages || byId.studentInfo?.spokenLanguages || byId.studentInfo?.languagesSpoken || null,
              learningPreferences: byId.learningPreferences || byId.studentInfo?.learningPreferences || null,
              evaluationSummary: byId.evaluationSummary || byId.studentInfo?.evaluationSummary || null,
              notes: byId.notes || byId.studentInfo?.notes || null,
              profilePicture: (byId.profilePicture && (byId.profilePicture.url || byId.profilePicture)) || byId.profilePictureThumbnail || null,
              guardianId: entry.guardianId,
              guardianName: byId.guardianName || (byId.guardian ? `${byId.guardian.firstName || ''} ${byId.guardian.lastName || ''}`.trim() : (guardiansMap[entry.guardianId] && guardiansMap[entry.guardianId].fullName)),
              classesCount: entry.classesCount,
              subjects: Array.from(subjectsByStudentId.get(String(byId._id)) || []).sort((a, b) => a.localeCompare(b))
            });
            continue;
          }

          // Otherwise try matching by guardianId + name
          const byName = teacherStudentsArr.find(ts => {
            const gId = String(ts.guardianId || ts.guardian || '');
            const full = `${(ts.firstName || '').trim()} ${(ts.lastName || '').trim()}`.trim().toLowerCase();
            return gId === String(entry.guardianId) && full === (entry.studentName || '').trim().toLowerCase();
          });

          if (byName) {
            resolvedStudents.push({
              _id: String(byName._id),
              firstName: byName.firstName,
              lastName: byName.lastName,
              studentInfo: byName.studentInfo || {},
              dateOfBirth: byName.dateOfBirth || byName.studentInfo?.dateOfBirth || null,
              gender: byName.gender || byName.studentInfo?.gender || null,
              language: byName.language || byName.studentInfo?.language || null,
              spokenLanguages: byName.spokenLanguages || byName.studentInfo?.spokenLanguages || byName.studentInfo?.languagesSpoken || null,
              learningPreferences: byName.learningPreferences || byName.studentInfo?.learningPreferences || null,
              evaluationSummary: byName.evaluationSummary || byName.studentInfo?.evaluationSummary || null,
              notes: byName.notes || byName.studentInfo?.notes || null,
              profilePicture: (byName.profilePicture && (byName.profilePicture.url || byName.profilePicture)) || byName.profilePictureThumbnail || null,
              guardianId: entry.guardianId,
              guardianName: byName.guardianName || (byName.guardian ? `${byName.guardian.firstName || ''} ${byName.guardian.lastName || ''}`.trim() : (guardiansMap[entry.guardianId] && guardiansMap[entry.guardianId].fullName)),
              classesCount: entry.classesCount,
              subjects: Array.from(subjectsByStudentId.get(String(byName._id)) || []).sort((a, b) => a.localeCompare(b))
            });
            continue;
          }

          // If still unresolved, push a lightweight placeholder (name only)
          resolvedStudents.push({
            _id: entry._id,
            firstName: entry.studentName || '',
            lastName: '',
            studentInfo: {},
            dateOfBirth: null,
            gender: null,
            language: null,
            spokenLanguages: null,
            learningPreferences: null,
            evaluationSummary: null,
            notes: null,
            profilePicture: null,
            guardianId: entry.guardianId,
            guardianName: (guardiansMap[entry.guardianId] && guardiansMap[entry.guardianId].fullName) || undefined,
            classesCount: entry.classesCount,
            subjects: Array.from(subjectsByStudentId.get(String(entry._id)) || []).sort((a, b) => a.localeCompare(b))
          });
        }

        // Teachers should not see inactive students at all
        const visibleStudents = resolvedStudents.filter((st) => isStudentActive(st));

        // Sort and set
        visibleStudents.sort((a, b) => {
          const an = `${a.firstName || ''} ${a.lastName || ''}`.trim().toLowerCase();
          const bn = `${b.firstName || ''} ${b.lastName || ''}`.trim().toLowerCase();
          return an.localeCompare(bn);
        });

        fetchedArr = visibleStudents;
        const withTZ = visibleStudents.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
        setStudents(withTZ);
        setTotalHours(0);
      } catch (err) {
        console.error('Failed to fetch classes for teacher view', err);
        setError('Failed to fetch students');
      }
    } else if (isGuardian && isGuardian()) {
      response = await api.get(`/users/${user._id || user.id}/students`);
      const arr = response.data.students || [];
      const withTZ = arr.map(st => ({ ...st, timezone: deriveStudentTimezone(st) }));
      fetchedArr = withTZ;
      setStudents(withTZ);
      setTotalHours(response.data.totalHours || 0);
    } else {
      throw new Error('Unauthorized role');
    }
    try {
      const summaryArr = fetchedArr || [];
      const miss = summaryArr.filter(s => !s || !(s.firstName || '').trim() || !(s.lastName || '').trim());
      console.log('[MyStudentsPage] fetched students summary', {
        role: user?.role,
        count: summaryArr.length,
  totalHours: response?.data?.totalHours || 0,
        missingNames: miss.length,
        samplesMissing: summaryArr.slice(0, 3).map(s => ({ id: s?._id || s?.id, firstName: s?.firstName, lastName: s?.lastName, guardianId: s?.guardianId }))
      });
    } catch (_) {}
    // After students fetched, compute real hours from past classes for each student (never negative)
    try {
      const map = {};
      const studentIds = (fetchedArr || []).map(s => String(s._id));
      const countableStatuses = ['attended', 'missed_by_student']; // classes that count towards consumed/billed hours
      if (studentIds.length) {
        if (isGuardian && isGuardian()) {
          // For guardians, fetch all past classes related to this guardian once and sum durations per student
          try {
            const classesRes = await api.get('/classes', { params: { filter: 'past', guardian: user._id, limit: 1000 } });
            const classesArr = classesRes.data.classes || [];
            classesArr.forEach(cls => {
              if (!countableStatuses.includes(cls.status)) return;
              const s = cls.student || {};
              const sid = String(s.studentId || s._id || '');
              if (!sid) return;
              map[sid] = (map[sid] || 0) + (Number(cls.duration) || 0); // minutes
            });
          } catch (err) {
            console.warn('Failed to fetch past classes for guardian to compute hours', err?.message || err);
          }
        } else {
          // For teachers/admins, batch past classes by studentIds to avoid 1 request per student.
          const ids = (fetchedArr || []).map((st) => String(st._id)).filter(Boolean);
          const chunkSize = 50;
          const chunks = [];
          for (let i = 0; i < ids.length; i += chunkSize) {
            chunks.push(ids.slice(i, i + chunkSize));
          }

          for (const chunk of chunks) {
            if (!chunk.length) continue;
            try {
              const res = await api.get('/classes', {
                params: {
                  filter: 'past',
                  studentIds: chunk.join(','),
                  limit: 1000,
                }
              });
              const classesArr = res.data.classes || [];
              classesArr.forEach((c) => {
                if (!countableStatuses.includes(c.status)) return;
                const sid = String(c?.student?.studentId || c?.student?._id || '');
                if (!sid) return;
                map[sid] = (map[sid] || 0) + (Number(c.duration) || 0);
              });
            } catch (err) {
              console.warn('Failed to fetch past classes batch for students', err?.message || err);
              // Ensure these students don't get stuck without a value
              chunk.forEach((sid) => { map[String(sid)] = map[String(sid)] || 0; });
            }
          }
        }
      }
      // Ensure all students have at least 0 minutes
      (fetchedArr || []).forEach(s => { map[String(s._id)] = map[String(s._id)] || 0; });
      // Convert minutes to hours (decimal) rounded to 1 decimal place
      const hoursMap = {};
      Object.keys(map).forEach(k => {
        const mins = Number(map[k]) || 0;
        const hrs = Math.round((mins / 60) * 10) / 10;
        hoursMap[k] = hrs >= 0 ? hrs : 0;
      });
      setClassesHoursMap(hoursMap);
    } catch (countErr) {
      console.warn('Failed to compute classes hours map', countErr?.message || countErr);
      setClassesHoursMap({});
    }
  } catch (error) {
    console.error('❌ Error fetching students:', error);
    const errorMessage = error.response?.data?.message || 'Failed to fetch students.';
    setError(errorMessage);
  } finally {
    setLocalLoading(false);
  }
};

const fetchGuardiansList = async () => {
  try {
    // Admins can fetch all guardians via /api/users
    if (isAdmin && isAdmin()) {
      const res = await api.get('/users', { params: { role: 'guardian', limit: 1000 } });
      setGuardiansList(res.data.users || []);
      return;
    }

    // Teachers are not allowed to call the admin /users endpoint. Build a guardian list from students taught by the teacher.
    if (isTeacher && isTeacher()) {
      const res = await api.get(`/users/teacher/${user._id || user.id}/students`);
      const students = res.data.students || [];
      // Extract unique guardians from students
      const map = new Map();
      students.forEach((s) => {
        const gId = s.guardianId || (s.guardian && (s.guardian._id || s.guardian.id));
        const gName = s.guardianName || (s.guardian && `${s.guardian.firstName || ''} ${s.guardian.lastName || ''}`.trim());
        if (gId && !map.has(String(gId))) {
          map.set(String(gId), { _id: gId, firstName: gName?.split(' ')?.[0] || '', lastName: gName?.split(' ')?.slice(1).join(' ') || '', fullName: gName });
        }
      });
      setGuardiansList(Array.from(map.values()));
      return;
    }

    // Guardians don't need a guardians list
    setGuardiansList([]);
  } catch (err) {
    console.error('Failed to fetch guardians list for filter:', err);
  }
};

  fetchStudentsRef.current = fetchStudents;
  fetchGuardiansListRef.current = fetchGuardiansList;

  const filteredStudents = useMemo(() => {
    let result = students || [];

    if (statusFilter !== 'all') {
      const desiredActive = statusFilter === 'active';
      result = result.filter((student) => isStudentActive(student) === desiredActive);
    }

    try {
      console.log('[MyStudentsPage] filtering', {
        incoming: (students || []).length,
        useGlobalSearch,
        effectiveSearchTerm
      });
    } catch(_) {}

    const trimmedTerm = (effectiveSearchTerm || '').trim().toLowerCase();
    if (trimmedTerm) {
      const parts = trimmedTerm.split(/\s+/).filter(Boolean);
      result = result.filter((s) => {
        const firstName = (s.firstName || '').toLowerCase();
        const lastName = (s.lastName || '').toLowerCase();
        const fullName = `${firstName} ${lastName}`.trim();
        const email = (s.email || '').toLowerCase();
        const phone = (s.phone || '').toLowerCase();
        const guardianName = s.guardian ? `${s.guardian.firstName} ${s.guardian.lastName}`.toLowerCase() : '';
        const className = s.class ? (s.class.name || '').toLowerCase() : '';

        const partsMatchName = parts.every(p => (
          firstName.startsWith(p) || lastName.startsWith(p) || fullName.includes(p)
        ));

        return partsMatchName || 
               email.includes(trimmedTerm) || 
               phone.includes(trimmedTerm) || 
               fullName.includes(trimmedTerm) ||
               guardianName.includes(trimmedTerm) ||
               className.includes(trimmedTerm) ||
               String(s._id).includes(trimmedTerm);
      });
    }

    // Apply global filter (only when using global search)
    if (useGlobalSearch && globalFilter && globalFilter !== 'all') {
      switch (globalFilter) {
        case 'active':
          result = result.filter(s => s.isActive === true);
          break;
        case 'inactive':
          result = result.filter(s => s.isActive === false);
          break;
        default:
          break;
      }
    }
    
    try {
      const miss = (result || []).filter(s => !s || !(s.firstName || '').trim() || !(s.lastName || '').trim());
      console.log('[MyStudentsPage] filtered result', {
        out: (result || []).length,
        missingNames: miss.length
      });
    } catch(_) {}
    
    return result;
  }, [students, effectiveSearchTerm, useGlobalSearch, globalFilter, statusFilter]);

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
      const keyA = buildNameKey(a);
      const keyB = buildNameKey(b);
      if (keyA === keyB) {
        return (a.lastName || '').localeCompare(b.lastName || '', undefined, { sensitivity: 'base' });
      }
      return keyA.localeCompare(keyB, undefined, { sensitivity: 'base' });
    });

    if (sortOrder === 'desc') {
      list.reverse();
    }

    return list;
  }, [filteredStudents, sortBy, sortOrder]);

  const totalPages = useMemo(() => (
    sortedStudents.length ? Math.ceil(sortedStudents.length / STUDENTS_PER_PAGE) : 1
  ), [sortedStudents]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages || 1);
    }
  }, [currentPage, totalPages]);

  const paginatedStudents = useMemo(() => {
    const start = (currentPage - 1) * STUDENTS_PER_PAGE;
    return sortedStudents.slice(start, start + STUDENTS_PER_PAGE);
  }, [sortedStudents, currentPage]);

  // Fetch subjects only for currently visible page (admin & teacher).
  useEffect(() => {
    const run = async () => {
      if (!user || loading) return;
      if (!(isAdmin && isAdmin()) && !(isTeacher && isTeacher())) return;
      if (!Array.isArray(paginatedStudents) || paginatedStudents.length === 0) return;

      const ids = paginatedStudents
        .map((s) => s && (s._id || s.id))
        .filter(Boolean)
        .map(String);
      if (!ids.length) return;

      // Only fetch if at least one visible student is missing subjects.
      const missing = paginatedStudents.some((s) => !Array.isArray(s?.subjects) || s.subjects.length === 0);
      if (!missing) return;

      try {
        setSubjectsLoading(true);
        const params = {
          filter: 'upcoming',
          studentIds: ids.join(','),
          limit: 2000,
        };
        // For teachers, keep teacher restriction.
        if (isTeacher && isTeacher()) {
          params.teacher = user._id || user.id;
        }

        const classesRes = await api.get('/classes', { params });
        const classesArr = classesRes.data.classes || [];
        const subjectsById = buildUpcomingSubjectsByStudentId(classesArr);

        setStudents((prev) => (Array.isArray(prev) ? prev.map((st) => {
          const sid = String(st?._id || st?.id || '');
          if (!sid) return st;
          const nextSubjects = subjectsById[sid];
          if (!nextSubjects || (Array.isArray(st.subjects) && st.subjects.length)) return st;
          return { ...st, subjects: nextSubjects };
        }) : prev));
      } catch (e) {
        console.warn('Failed to fetch subjects for visible students', e?.message || e);
      } finally {
        setSubjectsLoading(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, currentPage, isAdmin, isTeacher, paginatedStudents]);



  const handleStudentAdded = (newStudent) => {
    console.log('✅ New student added:', newStudent);
    // Refresh the students list
    fetchStudents();
  };

  const handleRemoveStudent = async (student) => {
    if (!window.confirm('Are you sure you want to remove this student?')) {
      return;
    }

    try {
      const studentId = student?._id || student;
      if (!studentId) throw new Error('Invalid student id');

      // Admins can delete embedded students via guardian-scoped route, and standalone students via /students/:id
      if (isAdmin && isAdmin()) {
        if (student && student._source === 'standalone') {
          await deleteStandaloneStudent(studentId);
        } else {
          const guardianId = student?.guardianId || student?.guardian?._id || student?.guardian;
          if (guardianId) {
            await api.delete(`/users/${guardianId}/students/${studentId}`);
          } else {
            // Fallback for unknown shapes
            await deleteStandaloneStudent(studentId);
          }
        }
      } else {
        // Guardians remove from their own account
        await api.delete(`/users/${user._id || user.id}/students/${studentId}`);
      }

      console.log('🗑️ Student removed successfully');
      
      // Refresh the students list
      fetchStudents();
      
      alert('Student removed successfully!');
    } catch (error) {
      console.error('❌ Error removing student:', error);
      const errorMessage = error.response?.data?.message || 'Failed to remove student.';
      alert(`Error: ${errorMessage}`);
    }
  };

  // Toggle active status for a student. Handles both standalone students (User documents)
  // and embedded students under a guardian. For embedded students we call the
  // guardian-scoped student update endpoint: PUT /api/users/:guardianId/students/:studentId
  // For standalone students we call the admin user status endpoint: PUT /api/users/:id/status
  const handleToggleActive = async (student, newStatus) => {
    try {
      if (student && student._source === 'standalone') {
        // standalone student stored in Student model (or legacy standalone user). Prefer Student endpoint.
        try {
          await api.put(`/students/${student._id}`, { isActive: newStatus });
        } catch (_) {
          await api.put(`/users/${student._id}/status`, { isActive: newStatus });
        }
      } else if (student && (student._source === 'embedded' || student.guardianId)) {
        // embedded student under a guardian
        const guardianId = student.guardianId || student.guardian;
        await api.put(`/users/${guardianId}/students/${student._id}`, { isActive: newStatus });
      } else {
        // Fallback: try guardian-scoped update if guardianId present, otherwise try user status
        if (student && student.guardianId) {
          await api.put(`/users/${student.guardianId}/students/${student._id}`, { isActive: newStatus });
        } else if (student) {
          await api.put(`/users/${student._id}/status`, { isActive: newStatus });
        } else {
          throw new Error('Invalid student payload');
        }
      }

      fetchStudents();
    } catch (err) {
      console.error('Failed to update active status for user', student && (student._id || student), err);
      // surface useful axios/server message when available
      const msg = err?.response?.data?.message || err?.message || 'Failed to update status';
      alert(msg);
    }
  };

  const toggleStudentDetails = (studentId) => {
    setExpandedStudent(expandedStudent === studentId ? null : studentId);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Not specified';
  return formatDateDDMMMYYYY(dateString);
  };

  const getStudentPicture = (s) => {
    if (!s) return null;
    // support multiple shapes: string URL, object with url, or object with thumbnail
    if (typeof s.profilePicture === 'string' && s.profilePicture) return s.profilePicture;
    if (s.profilePicture && typeof s.profilePicture === 'object') {
      return s.profilePicture.url || s.profilePicture.thumbnail || s.profilePicture;
    }
    // legacy property support
    if (s.profilePictureUrl) return s.profilePictureUrl;
    return null;
  };

  if (!user || !((isGuardian && isGuardian()) || (isAdmin && isAdmin()) || (isTeacher && isTeacher()))) {
    return (
      <div className="p-6 bg-background min-h-screen">
        <div className="max-w-7xl mx-auto">
          <div className="text-center text-red-600">
            <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
            <p>Only guardians, teachers, or admins can access this page.</p>
          </div>
        </div>
      </div>
    );
  }

  // Do not early-return while loading so the search and filters stay mounted (prevents focus loss)

  const isPageLoading = Boolean(loading || localLoading);

  // Derived student counts for header counters
  const totalStudents = (students || []).length;
  const activeStudents = (students || []).filter((student) => isStudentActive(student)).length;
  const inactiveStudents = totalStudents - activeStudents;
  const statusCounts = {
    active: activeStudents,
    inactive: inactiveStudents,
    all: totalStudents
  };

  return (
    <div className="p-5 bg-background min-h-screen">
      <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => {
            const isSelected = statusFilter === tab.id;
            const count = statusCounts[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
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

        {/* Hide Add Student button for teachers */}
        {!isTeacher || !isTeacher() ? (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="btn-primary flex items-center ml-auto"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Add New Student
          </button>
        ) : null}
      </div>
      
      {/* Students List */}
      {isPageLoading && sortedStudents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <LoadingSpinner text="Loading students…" />
          {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
        </div>
      ) : null}

      {sortedStudents.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-muted-foreground mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">No students yet</h3>
          <p className="text-muted-foreground mb-4">
            You haven't added any students to your account yet.
          </p>
          {!isTeacher || !isTeacher() ? (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary"
            >
              Add Your First Student
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {paginatedStudents.map((student) => (
            <div key={student._id} className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
              {/* Student Header */}
              <div className="p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex-shrink-0">
                      {(() => {
                        const pic = getStudentPicture(student);
                        if (pic) {
                          return (
                            <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-100">
                              <img src={pic} alt="Student" className="h-full w-full object-cover" />
                            </div>
                          );
                        }

                        return (
                          <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                            <span className="text-secondary-foreground font-semibold">
                              {student.firstName?.[0]}{student.lastName?.[0]}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">
                        {student.firstName} {student.lastName}
                        {student.selfGuardian && (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Self-enrolled
                          </span>
                        )}
                      </h3>
                      
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {/* Show guardian name under student for admin and teacher users */}
                      {(isAdmin && isAdmin()) || (isTeacher && isTeacher()) ? (
                        (() => {
                          let guardian = null;
                          if (student.guardian && typeof student.guardian === 'object' && (student.guardian.firstName || student.guardian.lastName)) {
                            guardian = student.guardian;
                          }
                          const fallbackGuardianName = student.guardianName || student.studentInfo?.guardianName;
                          let gName = null;
                          if (guardian) gName = `${guardian.firstName || ''} ${guardian.lastName || ''}`.trim();
                          if (!gName) {
                            gName = fallbackGuardianName || (student.studentInfo?.guardian ? `${student.studentInfo.guardian.firstName || ''} ${student.studentInfo.guardian.lastName || ''}`.trim() : null);
                          }
                          return gName ? (
                            <div className="text-sm text-muted-foreground">
                              <Users className="inline h-3 w-3 mr-1 align-middle" />
                              {gName}
                            </div>
                          ) : null;
                        })()
                      ) : null}
                        {/* Show real hours (computed from past classes durations) in My Students page */}
                        <span className="font-medium text-foreground">
                          { (classesHoursMap[String(student._id)] ?? 0) } hours
                        </span>
                        <span className={`px-2 py-1 rounded-full text-xs ${getStatusColor(student.isActive !== false)}`}>
                          {student.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                        <p><span className="font-medium">Timezone:</span> {deriveStudentTimezone(student)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:w-auto sm:justify-end">
                    {/* WhatsApp Button */}
                    {student.whatsapp && (
                      <a
                        href={`https://wa.me/${student.whatsapp.replace(/[^0-9]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="icon-button icon-button--green"
                        title="WhatsApp"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    )}

                    {/* Email Button */}
                    {student.email && (
                      <a
                        href={`mailto:${student.email}`}
                        className="icon-button icon-button--blue"
                        title="Email"
                      >
                        <Mail className="h-4 w-4" />
                      </a>
                    )}

                    {/* Admin Actions (activate/login) */}
                    {isAdmin && isAdmin() && (
                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          onClick={() => handleToggleActive(student, !(student.isActive !== false))}
                          className={`icon-button transition-colors ${student.isActive !== false ? 'text-red-600' : 'text-green-600'}`}
                          title={student.isActive !== false ? 'Deactivate' : 'Activate'}
                        >
                          {student.isActive !== false ? (
                            <UserX className="h-4 w-4" />
                          ) : (
                            <UserCheck className="h-4 w-4" />
                          )}
                        </button>

                      </div>
                    )}

                    

                    {/* Edit Button */}
                    {(!isTeacher || !isTeacher()) && (
                      <button
                        onClick={() => setEditingStudent({ studentId: student._id, guardianId: student.guardianId || student.guardian || null })}
                        className="icon-button icon-button--blue"
                        title="Edit Student"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                    )}

                    {/* Remove/Delete Button - hide for teachers */}
                    {(!isTeacher || !isTeacher()) && (
                      <button
                        onClick={() => handleRemoveStudent(student)}
                        className="icon-button icon-button--red"
                        title="Remove Student"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                    {/* Expand/Collapse Button */}
                    <button
                      onClick={() => toggleStudentDetails(student._id)}
                      className="icon-button icon-button--muted"
                      aria-expanded={expandedStudent === student._id}
                    >
                      <ChevronDown className={`h-4 w-4 transform transition-transform ${expandedStudent === student._id ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Expanded Details */}
              {expandedStudent === student._id && (
                <div className="border-t border-border bg-muted/30 p-3 space-y-6">
                  {(() => {
                    const guardianFullName = String(student.guardianName || '').trim();
                    const guardianFirstName = guardianFullName ? guardianFullName.split(' ')[0] : '';
                    const spokenLanguages =
                      (Array.isArray(student.spokenLanguages) && student.spokenLanguages.length > 0)
                        ? student.spokenLanguages
                        : (Array.isArray(student.studentInfo?.spokenLanguages) && student.studentInfo.spokenLanguages.length > 0)
                          ? student.studentInfo.spokenLanguages
                          : (Array.isArray(student.studentInfo?.languagesSpoken) && student.studentInfo.languagesSpoken.length > 0)
                            ? student.studentInfo.languagesSpoken
                          : [];
                    const subjects = Array.isArray(student.subjects) ? student.subjects : [];
                    const dobValue = student.dateOfBirth || student.studentInfo?.dateOfBirth || null;
                    const genderValue = student.gender || student.studentInfo?.gender || null;
                    const lp = student.studentInfo?.learningPreferences || student.learningPreferences;
                    const notes = student.studentInfo?.notes || student.notes;
                    const canSeeNotes = Boolean(isAdmin && isAdmin());
                    const visibleNotes = canSeeNotes ? notes : null;
                    const canSeeEvaluation = Boolean(((isAdmin && isAdmin()) || (isTeacher && isTeacher())) && student.evaluationSummary);
                    const showTeacherView = Boolean(isTeacher && isTeacher());
                    const showContactInfo = !showTeacherView;
                    const showTimezone = !showTeacherView;

                    return (
                      <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {showContactInfo && (
                      <div>
                        <h4 className="font-medium text-gray-900 mb-2">Contact Information</h4>
                        <div className="space-y-1 text-sm text-gray-600">
                          <p><span className="font-medium">Email:</span> {student.email || 'Not provided'}</p>
                          <p><span className="font-medium">Phone:</span> {student.phone || 'Not provided'}</p>
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Personal Information</h4>
                      <div className="space-y-1 text-sm text-gray-600">
                        <p><span className="font-medium">Date of Birth:</span> {formatDate(dobValue)}</p>
                        <p><span className="font-medium">Gender:</span> {genderValue || 'Not specified'}</p>
                        <p><span className="font-medium">Guardian first name:</span> {guardianFirstName || 'Not specified'}</p>
                        {showTimezone && (
                          <p><span className="font-medium">Timezone:</span> {deriveStudentTimezone(student)}</p>
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-medium text-gray-900 mb-2">Academic Information</h4>
                      <div className="space-y-1 text-sm text-gray-600">
                        <p><span className="font-medium">Languages they speak:</span> {spokenLanguages.length ? spokenLanguages.join(', ') : (student.language || student.studentInfo?.language || 'Not specified')}</p>
                        <p><span className="font-medium">Subjects:</span> {subjects.length ? subjects.join(', ') : 'Not specified'}</p>
                      </div>
                    </div>
                  </div>
                  
                  {(() => {
                    const hasAny = lp || visibleNotes || canSeeEvaluation;
                    if (!hasAny) return null;
                    return (
                      <div className="space-y-4">
                        {lp && (
                          <div className="mb-3">
                            <h4 className="font-medium text-foreground mb-1">Learning Preferences</h4>
                            <p className="text-sm text-muted-foreground">{lp}</p>
                          </div>
                        )}

                        {visibleNotes && (
                          <div className="mb-3">
                            <h4 className="font-medium text-foreground mb-1">Notes (admin only)</h4>
                            <p className="text-sm text-muted-foreground">{visibleNotes}</p>
                          </div>
                        )}

                        {canSeeEvaluation && (
                          <div className="mb-3">
                            <h4 className="font-medium text-foreground mb-1">Evaluation Summary</h4>
                            <p className="text-sm text-muted-foreground">{student.evaluationSummary}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {sortedStudents.length > 0 && totalPages > 1 && (
        <div className="flex justify-center items-center space-x-2 mt-4">
          <button
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="px-3 py-2 border border-border rounded-md bg-input text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
          >
            Previous
          </button>
          <span className="px-3 py-2 text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-2 border border-border rounded-md bg-input text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted transition-colors"
          >
            Next
          </button>
        </div>
      )}

      {/* Add Student Modal - only for non-teachers */}
      {!isTeacher || !isTeacher() ? (
        <AddStudentModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onStudentAdded={handleStudentAdded}
        />
      ) : null}

      {/* Edit Student Modal */}
      {editingStudent && (!isTeacher || !isTeacher()) && (
        <EditStudentModal
          studentId={editingStudent.studentId}
          guardianId={editingStudent.guardianId}
          onClose={() => setEditingStudent(null)}
          onUpdated={fetchStudents}
        />
      )}
      </div>
    </div>
  );
};
export default MyStudentsPage;

