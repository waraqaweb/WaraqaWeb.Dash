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

export async function saveInterviewScorecard(source, id, payload) {
  const { data } = await api.patch(`${BASE}/responses/${source}/${id}/interview`, payload);
  return data.response || null;
}

// Generate/refresh the post-interview contract-acceptance link for a candidate.
export async function generateContractLink(source, id) {
  const { data } = await api.post(`${BASE}/responses/${source}/${id}/contract-link`);
  return data;
}

// Public: fetch the contract text + acceptance status for a token.
export async function getPublicTeacherAgreement(token) {
  const { data } = await api.get(`${BASE}/agreement/${token}`);
  return data;
}

// Public: record the candidate's acceptance of the contract.
export async function acceptPublicTeacherAgreement(token, fullName) {
  const { data } = await api.post(`${BASE}/agreement/${token}/accept`, { fullName });
  return data;
}

export async function convertCandidateToTeacher(source, id, payload) {
  const { data } = await api.post(`${BASE}/responses/${source}/${id}/convert-to-teacher`, payload);
  return data;
}

// ─── Training Batches ────────────────────────────────────────────────────────

export async function listTrainingBatches() {
  const { data } = await api.get(`${BASE}/training-batches`);
  return data.batches || [];
}

export async function getTrainingBatch(id) {
  const { data } = await api.get(`${BASE}/training-batches/${id}`);
  return data.batch || null;
}

export async function createTrainingBatch(payload) {
  const { data } = await api.post(`${BASE}/training-batches`, payload);
  return data.batch || null;
}

export async function updateTrainingBatch(id, payload) {
  const { data } = await api.put(`${BASE}/training-batches/${id}`, payload);
  return data.batch || null;
}

export async function addCandidateToBatch(batchId, payload) {
  const { data } = await api.post(`${BASE}/training-batches/${batchId}/candidates`, payload);
  return data.batch || null;
}

export async function removeCandidateFromBatch(batchId, candidateId) {
  const { data } = await api.delete(`${BASE}/training-batches/${batchId}/candidates/${candidateId}`);
  return data.batch || null;
}

export async function updateBatchSession(batchId, sessionNumber, payload) {
  const { data } = await api.put(`${BASE}/training-batches/${batchId}/sessions/${sessionNumber}`, payload);
  return data.batch || null;
}

export async function addBatchSession(batchId, payload) {
  const { data } = await api.post(`${BASE}/training-batches/${batchId}/sessions`, payload);
  return data.batch || null;
}

export async function removeBatchSession(batchId, sessionNumber) {
  const { data } = await api.delete(`${BASE}/training-batches/${batchId}/sessions/${sessionNumber}`);
  return data.batch || null;
}

export async function getLectureTemplate() {
  const { data } = await api.get(`${BASE}/training-lecture-template`);
  return data;
}

export async function saveLectureTemplate(topics) {
  const { data } = await api.put(`${BASE}/training-lecture-template`, { topics });
  return data;
}

export async function updateCandidateOutcome(batchId, candidateId, payload) {
  const { data } = await api.patch(`${BASE}/training-batches/${batchId}/candidates/${candidateId}/outcome`, payload);
  return data.batch || null;
}

// ─── Recruitment automation (emails, capacity, sheet import) ──────────────────

export async function getRecruitmentEmailTemplates() {
  const { data } = await api.get(`${BASE}/email-templates`);
  return data;
}

export async function saveRecruitmentEmailTemplates(templates) {
  const { data } = await api.put(`${BASE}/email-templates`, { templates });
  return data;
}

export async function sendCandidateEmail(source, id, payload) {
  const { data } = await api.post(`${BASE}/responses/${source}/${id}/send-email`, payload);
  return data;
}

export async function getCapacityConfig() {
  const { data } = await api.get(`${BASE}/capacity-config`);
  return data;
}

export async function saveCapacityConfig(config) {
  const { data } = await api.put(`${BASE}/capacity-config`, { config });
  return data;
}

export async function importApplicantsFromSheet(sheetUrl) {
  const { data } = await api.post(`${BASE}/import-sheet`, { sheetUrl });
  return data;
}

// Google Sheet auto-sync configuration (source of truth for applicants).
export async function getSheetSyncConfig() {
  const { data } = await api.get(`${BASE}/sheet-sync`);
  return data.config || null;
}

export async function saveSheetSyncConfig(payload) {
  const { data } = await api.put(`${BASE}/sheet-sync`, payload);
  return data.config || null;
}

export async function runSheetSyncNow() {
  const { data } = await api.post(`${BASE}/sheet-sync/run`);
  return data;
}

export async function getPendingCandidateEmails() {
  const { data } = await api.get(`${BASE}/pending-emails`);
  return data;
}

export async function sendPendingCandidateEmails() {
  const { data } = await api.post(`${BASE}/send-pending-emails`);
  return data;
}

export async function setTeacherAcceptingStudents(teacherId, acceptingNewStudents) {
  const { data } = await api.put(`/users/${teacherId}/accepting-students`, { acceptingNewStudents });
  return data;
}

