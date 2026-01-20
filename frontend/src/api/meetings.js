import api from './axios';

const BASE = '/meetings';

export async function fetchMeetingAvailability({ meetingType, rangeStart, rangeEnd, timezone }) {
  const params = { meetingType };
  if (rangeStart) params.rangeStart = rangeStart;
  if (rangeEnd) params.rangeEnd = rangeEnd;
  if (timezone) params.timezone = timezone;
  const { data } = await api.get(`${BASE}/availability`, { params });
  return data.windows || [];
}

export async function listMeetings(params = {}) {
  const { data } = await api.get(BASE, { params });
  return data.meetings || [];
}

export async function bookMeeting(payload) {
  const { data } = await api.post(`${BASE}/book`, payload);
  return data;
}

export async function listMeetingAvailabilitySlots(params = {}, options = {}) {
  const { data } = await api.get(`${BASE}/availability/slots`, { params, ...options });
  return data;
}

export async function createMeetingAvailabilitySlot(payload) {
  const { data } = await api.post(`${BASE}/availability/slots`, payload);
  return data.slot;
}

export async function updateMeetingAvailabilitySlot(slotId, updates) {
  const { data } = await api.put(`${BASE}/availability/slots/${slotId}`, updates);
  return data.slot;
}

export async function deleteMeetingAvailabilitySlot(slotId) {
  const { data } = await api.delete(`${BASE}/availability/slots/${slotId}`);
  return data;
}

export async function listMeetingTimeOff(params = {}, options = {}) {
  const { data } = await api.get(`${BASE}/availability/timeoff`, { params, ...options });
  return data;
}

export async function createMeetingTimeOff(payload) {
  const { data } = await api.post(`${BASE}/availability/timeoff`, payload);
  return data.period;
}

export async function deleteMeetingTimeOff(timeOffId) {
  const { data } = await api.delete(`${BASE}/availability/timeoff/${timeOffId}`);
  return data;
}

export async function submitMeetingReport(meetingId, payload) {
  if (!meetingId) throw new Error('meetingId is required to submit a report');
  const { data } = await api.post(`${BASE}/${meetingId}/report`, payload);
  return data.meeting;
}

export async function deleteMeeting(meetingId) {
  const { data } = await api.delete(`${BASE}/${meetingId}`);
  return data.meeting;
}
