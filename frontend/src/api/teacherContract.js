import api from './axios';

const BASE = '/teacher-contract';

export async function getMyTeacherContract() {
  const { data } = await api.get(`${BASE}/me`);
  return data.submission || null;
}

export async function saveMyTeacherContract(formData) {
  const { data } = await api.post(`${BASE}/me`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
}

export async function submitPublicTeacherContract(formData) {
  const { data } = await api.post(`${BASE}/public`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return data;
}

export async function getTeacherContractTemplate() {
  const { data } = await api.get(`${BASE}/template`);
  return data.template || '';
}

export async function listPublicRecruitmentCampaigns() {
  const { data } = await api.get(`${BASE}/campaigns/public`);
  return data.campaigns || [];
}

export async function listRecruitmentCampaigns() {
  const { data } = await api.get(`${BASE}/campaigns`);
  return data.campaigns || [];
}

export async function createRecruitmentCampaign(payload) {
  const { data } = await api.post(`${BASE}/campaigns`, payload);
  return data.campaign || null;
}

export async function updateRecruitmentCampaign(id, payload) {
  const { data } = await api.put(`${BASE}/campaigns/${id}`, payload);
  return data.campaign || null;
}

export async function updateTeacherContractTemplate(template) {
  const { data } = await api.put(`${BASE}/template`, { template });
  return data;
}

export async function listTeacherContractResponses() {
  const { data } = await api.get(`${BASE}/responses`);
  return data.responses || [];
}

export async function getTeacherContractResponseSummary() {
  const { data } = await api.get(`${BASE}/responses-summary`);
  return data;
}

export async function getTeacherOperationsSummary() {
  const { data } = await api.get(`${BASE}/operations-summary`);
  return data;
}

export async function updateTeacherContractResponse(source, id, payload) {
  const { data } = await api.patch(`${BASE}/responses/${source}/${id}`, payload);
  return data.response || null;
}
