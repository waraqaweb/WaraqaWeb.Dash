import axios from './axios';

/**
 * Student API service functions
 */

// Get all students with optional filters
export const getStudents = async (params = {}) => {
  try {
    const response = await axios.get('/students', { params });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Get a specific student by ID
export const getStudent = async (studentId) => {
  try {
    const response = await axios.get(`/students/${studentId}`);
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Get students by guardian ID
export const getStudentsByGuardian = async (guardianId) => {
  try {
    const response = await axios.get(`/students/guardian/${guardianId}`);
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Create a new student
export const createStudent = async (studentData) => {
  try {
    const response = await axios.post('/students', studentData);
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Update an existing student
export const updateStudent = async (studentId, studentData) => {
  try {
    const response = await axios.put(`/students/${studentId}`, studentData);
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Update student status (admin only)
export const updateStudentStatus = async (studentId, status) => {
  try {
    const response = await axios.put(`/students/${studentId}/status`, { status });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};

// Delete a student (admin only)
export const deleteStudent = async (studentId) => {
  try {
    const response = await axios.delete(`/students/${studentId}`);
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};