import api from "../api/axios";
import { makeCacheKey, readCache, writeCache } from "../utils/sessionCache";

const CACHE_USER_SCOPE_KEY = 'waraqa:cacheUserScope';

const getCacheUserScope = () => {
  try {
    if (typeof window === 'undefined') return 'anon';
    return window.sessionStorage?.getItem(CACHE_USER_SCOPE_KEY) || 'anon';
  } catch (e) {
    return 'anon';
  }
};

const inflight = new Map();

const cachedCall = async (scope, params, deps, ttlMs, fetcher) => {
  const userScope = getCacheUserScope();
  const key = makeCacheKey(scope, userScope, params);
  const cached = readCache(key, { deps });
  if (cached.hit) return cached.value;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await fetcher();
      writeCache(key, value, { ttlMs, deps });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
};

// Cache durations: keep short for search results, longer for direct ID lookups.
const TTL_SEARCH_MS = 5 * 60 * 1000;
const TTL_BY_ID_MS = 60 * 60 * 1000;

const formatDisplayName = (first = "", last = "", fallback = "") => {
  const composed = `${first || ""} ${last || ""}`.replace(/\s+/g, " ").trim();
  return composed || fallback;
};

const normalizeId = (value) => {
  if (!value) return "";
  return String(value);
};

const teacherToOption = (teacher = {}) => ({
  id: normalizeId(teacher._id || teacher.id),
  label: formatDisplayName(teacher.firstName, teacher.lastName, teacher.email || "Unnamed Teacher"),
  subtitle: teacher.email || teacher.teacherInfo?.instapayName || "",
  raw: teacher,
});

const guardianToOption = (guardian = {}) => ({
  id: normalizeId(guardian._id || guardian.id),
  label: formatDisplayName(guardian.firstName, guardian.lastName, guardian.email || "Unnamed Guardian"),
  subtitle: guardian.email || guardian.guardianInfo?.relationship || "",
  raw: guardian,
});

const studentToOption = (student = {}) => {
  const guardian = student.guardian || student.studentInfo?.guardian || null;
  const guardianId = student.studentInfo?.guardianId || student.guardianId || guardian?._id;
  const guardianName = student.guardianName || (guardian ? formatDisplayName(guardian.firstName, guardian.lastName, "") : "");
  return {
    id: normalizeId(student._id || student.id),
    label: formatDisplayName(student.firstName, student.lastName, student.email || "Unnamed Student"),
    subtitle: guardianName ? `Guardian: ${guardianName}` : student.email || "",
    guardianId: normalizeId(guardianId),
    guardianName,
    raw: student,
  };
};

const getUsers = async (params) => {
  return cachedCall(
    'entitySearch:getUsers',
    params,
    ['users', 'teachers', 'guardians'],
    TTL_SEARCH_MS,
    async () => {
      const response = await api.get("/users", { params });
      return response.data.users || response.data.data || [];
    }
  );
};

export const searchTeachers = async (searchTerm = "") => {
  const params = {
    role: "teacher",
    search: searchTerm || undefined,
    page: 1,
    limit: 20,
    sortBy: "firstName",
    order: "asc",
  };

  const users = await cachedCall(
    'entitySearch:searchTeachers',
    params,
    ['users', 'teachers'],
    TTL_SEARCH_MS,
    async () => getUsers(params)
  );
  return (users || []).map(teacherToOption);
};

export const getTeacherById = async (id) => {
  if (!id) return null;
  return cachedCall(
    'entitySearch:getTeacherById',
    { id: normalizeId(id) },
    ['users', 'teachers'],
    TTL_BY_ID_MS,
    async () => {
      const response = await api.get(`/users/${id}`);
      return teacherToOption(response.data.user || response.data);
    }
  );
};

export const searchGuardians = async (searchTerm = "") => {
  const params = {
    role: "guardian",
    search: searchTerm || undefined,
    page: 1,
    limit: 20,
    sortBy: "firstName",
    order: "asc",
  };

  const users = await cachedCall(
    'entitySearch:searchGuardians',
    params,
    ['users', 'guardians'],
    TTL_SEARCH_MS,
    async () => getUsers(params)
  );
  return (users || []).map(guardianToOption);
};

export const getGuardianById = async (id) => {
  if (!id) return null;
  return cachedCall(
    'entitySearch:getGuardianById',
    { id: normalizeId(id) },
    ['users', 'guardians'],
    TTL_BY_ID_MS,
    async () => {
      const response = await api.get(`/users/${id}`);
      return guardianToOption(response.data.user || response.data);
    }
  );
};

export const searchStudents = async (searchTerm = "", guardianId = null, limit = 20) => {
  if (guardianId) {
    const params = { guardianId: normalizeId(guardianId), search: searchTerm || undefined };
    return cachedCall(
      'entitySearch:searchStudentsByGuardian',
      params,
      ['students', 'users', 'guardians'],
      TTL_SEARCH_MS,
      async () => {
        const response = await api.get(`/users/${guardianId}/students`, {
          params: { search: searchTerm || undefined },
        });
        const students = response.data?.students || [];
        return students.map((student) =>
          studentToOption({
            ...student,
            guardianId,
            guardianName: student.guardianName,
          })
        );
      }
    );
  }

  const params = {
    search: searchTerm || undefined,
    limit,
  };

  return cachedCall(
    'entitySearch:searchStudentsAdmin',
    params,
    ['students', 'users'],
    TTL_SEARCH_MS,
    async () => {
      const response = await api.get("/users/admin/all-students", { params });
      const students = response.data?.students || [];
      return students.map(studentToOption);
    }
  );
};

export const getStudentById = async (id, guardianId = null) => {
  if (!id) return null;

  if (guardianId) {
    return cachedCall(
      'entitySearch:getStudentByIdGuardian',
      { id: normalizeId(id), guardianId: normalizeId(guardianId) },
      ['students', 'users', 'guardians'],
      TTL_BY_ID_MS,
      async () => {
        const response = await api.get(`/users/${guardianId}/students`);
        const students = response.data?.students || [];
        const match = students.find((student) => normalizeId(student._id) === normalizeId(id));
        return match
          ? studentToOption({
              ...match,
              guardianId,
              guardianName: match.guardianName,
            })
          : null;
      }
    );
  }

  return cachedCall(
    'entitySearch:getStudentByIdAdmin',
    { id: normalizeId(id) },
    ['students', 'users'],
    TTL_BY_ID_MS,
    async () => {
      const response = await api.get("/users/admin/all-students", {
        params: {
          studentId: id,
          limit: 1,
        },
      });
      const students = response.data?.students || [];
      const match = students.find((student) => normalizeId(student._id) === normalizeId(id));
      return match ? studentToOption(match) : null;
    }
  );
};

export const __entitySearchCacheUserScopeKey = CACHE_USER_SCOPE_KEY;
