import axios from 'axios';

// Base URL is relative ("/api") so the Vite dev proxy or nginx can route it.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Normalize backend error shapes into a single throwable message.
function toError(err) {
  const res = err.response?.data;
  if (res?.details?.length) {
    return new Error(res.details.map((d) => `${d.field}: ${d.message}`).join('; '));
  }
  return new Error(res?.error || err.message || 'Request failed');
}

async function request(promise) {
  try {
    const { data } = await promise;
    return data;
  } catch (err) {
    throw toError(err);
  }
}

export const merchantsApi = {
  list: (params) => request(api.get('/merchants', { params })),
  get: (id) => request(api.get(`/merchants/${id}`)),
  create: (payload) => request(api.post('/merchants', payload)),
  update: (id, payload) => request(api.put(`/merchants/${id}`, payload)),
  remove: (id) => request(api.delete(`/merchants/${id}`)),
};

export const posDevicesApi = {
  list: (params) => request(api.get('/pos-devices', { params })),
  get: (id) => request(api.get(`/pos-devices/${id}`)),
  create: (payload) => request(api.post('/pos-devices', payload)),
  update: (id, payload) => request(api.put(`/pos-devices/${id}`, payload)),
  remove: (id) => request(api.delete(`/pos-devices/${id}`)),
};

// Read-only warehouse (spos.*) analytics endpoints.
export const whApi = {
  summary: () => request(api.get('/wh/summary')),
  merchants: (params) => request(api.get('/wh/merchants', { params })),
  merchant: (id) => request(api.get(`/wh/merchants/${id}`)),
  devices: (params) => request(api.get('/wh/devices', { params })),
  device: (id) => request(api.get(`/wh/devices/${id}`)),
};

export default api;
