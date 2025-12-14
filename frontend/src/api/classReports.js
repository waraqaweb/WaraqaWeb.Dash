import api from './axios';

export const submitClassReport = async (payload) => {
  const res = await api.post('/class-reports', payload);
  return res.data;
};
