import axios from './axios';

export const getTeacherInteractions = async (teacherId, params = {}) => {
  try {
    const response = await axios.get(`/users/${teacherId}/teacher-interactions`, { params });
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
};
