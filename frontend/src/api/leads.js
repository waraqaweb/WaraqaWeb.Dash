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
  return { leads: data.leads || [], signups: data.signups || [], meetings: data.meetings || [] };
}

// Unified registration management (kind = 'lead' | 'signup' | 'meeting').
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

// Mark the whole registration complete (paid + done) and close it out, or reopen.
export async function completeRegistration(kind, id, complete = true) {
  const { data } = await api.post(`${BASE}/registration/${kind}/${id}/complete`, { complete });
  return data;
}

// Lazily fetch heavy joins for one registration: linked evaluation availability
// and whether each student already has scheduled classes. Only call when a modal opens.
export async function getRegistrationDetails(kind, id) {
  const { data } = await api.get(`${BASE}/registration/${kind}/${id}/details`);
  return data;
}
