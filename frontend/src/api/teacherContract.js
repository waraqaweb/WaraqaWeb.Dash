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

export async function updateTeacherContractTemplate(template) {
  const { data } = await api.put(`${BASE}/template`, { template });
  return data;
}

export async function listTeacherContractResponses() {
  const { data } = await api.get(`${BASE}/responses`);
  return data.responses || [];
}
