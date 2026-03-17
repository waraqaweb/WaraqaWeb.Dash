import api from './axios';

const BASE = '/leads';

export async function savePublicStudentLead(payload, leadId = '') {
  const { data } = leadId
    ? await api.put(`${BASE}/public/student-registration/${leadId}`, payload)
    : await api.post(`${BASE}/public/student-registration`, payload);
  return data;
}

export async function createPublicStudentLead(payload) {
  return savePublicStudentLead(payload);
}

export async function listRegistrationLeads(params = {}) {
  const { data } = await api.get(BASE, { params });
  return data.leads || [];
}

export async function convertRegistrationLead(leadId) {
  const { data } = await api.post(`${BASE}/${leadId}/convert`);
  return data;
}

export async function archiveRegistrationLead(leadId, archived = true, reason = '') {
  const { data } = await api.post(`${BASE}/${leadId}/archive`, { archived, reason });
  return data;
}
