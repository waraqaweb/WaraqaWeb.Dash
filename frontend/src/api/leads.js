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

export async function updateLeadOnboarding(leadId, step, done) {
  const { data } = await api.patch(`${BASE}/${leadId}/onboarding`, { step, done });
  return data;
}

// Homepage onboarding to-do: recent leads + recent guardian signups (last 3 weeks).
export async function getOnboardingTodos() {
  const { data } = await api.get(`${BASE}/onboarding-todos`);
  return { leads: data.leads || [], signups: data.signups || [] };
}

// Unified registration management (kind = 'lead' | 'signup').
export async function setRegistrationStep(kind, id, step, done) {
  const { data } = await api.post(`${BASE}/registration/${kind}/${id}/step`, { step, done });
  return data;
}

export async function addRegistrationNote(kind, id, text) {
  const { data } = await api.post(`${BASE}/registration/${kind}/${id}/note`, { text });
  return data;
}

export async function sendRegistrationEmail(kind, id, subject, body) {
  const { data } = await api.post(`${BASE}/registration/${kind}/${id}/email`, { subject, body });
  return data;
}

export async function cancelRegistration(kind, id, cancel = true, reason = '') {
  const { data } = await api.post(`${BASE}/registration/${kind}/${id}/cancel`, { cancel, reason });
  return data;
}
