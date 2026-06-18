import api from './axios';

export async function fetchBusinessIntelligence() {
  const { data } = await api.get('/analytics/business-intelligence');
  return data;
}

export async function fetchBIHub({ period = 'thisMonth', startDate, endDate } = {}) {
  const params = { period };
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;
  const { data } = await api.get('/analytics/bi-hub', { params });
  return data;
}
