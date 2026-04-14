import api from './axios';

export async function fetchBusinessIntelligence() {
  const { data } = await api.get('/analytics/business-intelligence');
  return data;
}
