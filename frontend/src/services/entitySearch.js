import api from "../api/axios";

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
  const response = await api.get("/users", { params });
  return response.data.users || response.data.data || [];
};

export const searchTeachers = async (searchTerm = "") => {
  const users = await getUsers({
    role: "teacher",
    search: searchTerm || undefined,
    page: 1,
    limit: 20,
    sortBy: "firstName",
    order: "asc",
  });
  return users.map(teacherToOption);
};

export const getTeacherById = async (id) => {
  if (!id) return null;
  const response = await api.get(`/users/${id}`);
  return teacherToOption(response.data.user || response.data);
};

export const searchGuardians = async (searchTerm = "") => {
  const users = await getUsers({
    role: "guardian",
    search: searchTerm || undefined,
    page: 1,
    limit: 20,
    sortBy: "firstName",
    order: "asc",
  });
  return users.map(guardianToOption);
};

export const getGuardianById = async (id) => {
  if (!id) return null;
  const response = await api.get(`/users/${id}`);
  return guardianToOption(response.data.user || response.data);
};

export const searchStudents = async (searchTerm = "", guardianId = null, limit = 20) => {
  if (guardianId) {
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

  const response = await api.get("/users/admin/all-students", {
    params: {
      search: searchTerm || undefined,
      limit,
    },
  });
  const students = response.data?.students || [];
  return students.map(studentToOption);
};

export const getStudentById = async (id, guardianId = null) => {
  if (!id) return null;

  if (guardianId) {
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

  const response = await api.get("/users/admin/all-students", {
    params: {
      studentId: id,
      limit: 1,
    },
  });
  const students = response.data?.students || [];
  const match = students.find((student) => normalizeId(student._id) === normalizeId(id));
  return match ? studentToOption(match) : null;
};
