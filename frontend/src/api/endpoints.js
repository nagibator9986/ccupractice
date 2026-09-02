import client from "./client";

// Mirror of client.js — used for raw <a href> download URLs.
const API_PREFIX = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "") + "/api";

export const authApi = {
  login: (email, password) => client.post("/auth/login", { email, password }).then((r) => r.data),
  me: () => client.get("/auth/me").then((r) => r.data),
  changePassword: (payload) =>
    client.post("/auth/change-password", payload).then((r) => r.data),
};

export const partnersApi = {
  list: (params) => client.get("/partners", { params }).then((r) => r.data),
  get: (id) => client.get(`/partners/${id}`).then((r) => r.data),
  create: (data) => client.post("/partners", data).then((r) => r.data),
  update: (id, data) => client.put(`/partners/${id}`, data).then((r) => r.data),
  remove: (id) => client.delete(`/partners/${id}`).then((r) => r.data),
};

export const studentsApi = {
  list: (params) => client.get("/students", { params }).then((r) => r.data),
  get: (id) => client.get(`/students/${id}`).then((r) => r.data),
  create: (data) => client.post("/students", data).then((r) => r.data),
  update: (id, data) => client.put(`/students/${id}`, data).then((r) => r.data),
  remove: (id) => client.delete(`/students/${id}`).then((r) => r.data),
  // Admin-only on the backend (PUT /api/students/<sid>/grant). Used by the
  // Students page toggle and by the LmsContracts create-modal pre-flight.
  setGrant: (sid, isGrant) =>
    client.put(`/students/${sid}/grant`, { is_grant_student: !!isGrant }).then((r) => r.data),
};

export const contractsApi = {
  list: (params) => client.get("/contracts", { params }).then((r) => r.data),
  get: (id) => client.get(`/contracts/${id}`).then((r) => r.data),
  create: (data) => client.post("/contracts", data).then((r) => r.data),
  update: (id, data) => client.put(`/contracts/${id}`, data).then((r) => r.data),
  remove: (id) => client.delete(`/contracts/${id}`).then((r) => r.data),
  generate: (id, payload) =>
    client.post(`/contracts/${id}/generate`, payload || {}).then((r) => r.data),
  uploadScan: (id, file) => {
    const form = new FormData();
    form.append("file", file);
    // Let the browser/axios set Content-Type with the correct multipart
    // boundary parameter — hardcoding the header strips the boundary, which
    // some servers/proxies refuse to parse.
    return client.post(`/contracts/${id}/upload-scan`, form).then((r) => r.data);
  },
  download: async (id, fmt, filename) => {
    const res = await client.get(`/contracts/${id}/download/${fmt}`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `contract_${id}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },
  signatureReport: async (id, number) => {
    const res = await client.get(`/contracts/${id}/signature-report/download`, {
      responseType: "blob",
    });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Отчёт_подписания_${number || id}.docx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },
};

export const archiveApi = {
  list: (params) => client.get("/archive", { params }).then((r) => r.data),
  tree: () => client.get("/archive/tree").then((r) => r.data),
};

export const settingsApi = {
  getCollege: () => client.get("/settings/college").then((r) => r.data),
  updateCollege: (data) => client.put("/settings/college", data).then((r) => r.data),
  uploadTemplate: (file) => {
    const form = new FormData();
    form.append("file", file);
    // Let the browser/axios set Content-Type so the multipart boundary is
    // attached automatically.
    return client.post("/settings/template", form).then((r) => r.data);
  },
  templateInfo: () => client.get("/settings/template/info").then((r) => r.data),
};

export const signingApi = {
  invite: (contractId, payload) =>
    client.post(`/signing/contracts/${contractId}/invite`, payload).then((r) => r.data),
  listRequests: (contractId) =>
    client.get(`/signing/contracts/${contractId}/requests`).then((r) => r.data),
  revoke: (requestId) =>
    client.post(`/signing/requests/${requestId}/revoke`).then((r) => r.data),
  resend: (requestId) =>
    client.post(`/signing/requests/${requestId}/resend`).then((r) => r.data),
  publicView: (token) =>
    client.get(`/signing/public/${token}`).then((r) => r.data),
  publicMarkViewed: (token) =>
    client.post(`/signing/public/${token}/view`).then((r) => r.data),
  publicPayload: (token) =>
    client.get(`/signing/public/${token}/payload`).then((r) => r.data),
  publicSubmit: (token, cms) =>
    client.post(`/signing/public/${token}/submit`, { cms }).then((r) => r.data),
  publicDownloadUrl: (token, fmt) => `${API_PREFIX}/signing/public/${token}/download/${fmt}`,
};

async function blobDownload(url, filename) {
  const res = await client.get(url, { responseType: "blob" });
  const objUrl = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
}

export const enrollmentsApi = {
  list: (params) => client.get("/enrollments", { params }).then((r) => r.data),
  get: (id) => client.get(`/enrollments/${id}`).then((r) => r.data),
  suggestNumber: (year) =>
    client.get("/enrollments/suggest-number", { params: { year } }).then((r) => r.data),
  create: (data) => client.post("/enrollments", data).then((r) => r.data),
  update: (id, data) => client.put(`/enrollments/${id}`, data).then((r) => r.data),
  generate: (id, payload) =>
    client.post(`/enrollments/${id}/generate`, payload || {}).then((r) => r.data),
  remove: (id) => client.delete(`/enrollments/${id}`).then((r) => r.data),
  downloadDoc: (id, document, fmt, filename) =>
    blobDownload(`/enrollments/${id}/download/${document}/${fmt}`, filename),
  // "Сертификат подписания" — side-channel PDF that lists who signed, with QR
  // pointing at /verify/<code>. SAFETY: the endpoint never mutates the signed
  // bytes, so it can be downloaded any number of times without invalidating
  // any existing signature.
  downloadCertificate: (id, number) =>
    blobDownload(
      `/enrollments/${id}/certificate`,
      `Сертификат_подписания_${number || id}.pdf`,
    ),
  invite: (id, payload) =>
    client.post(`/enrollments/${id}/invite`, payload || {}).then((r) => r.data),
  listRequests: (id) =>
    client.get(`/enrollments/${id}/requests`).then((r) => r.data),
  revoke: (rid) => client.post(`/enrollments/requests/${rid}/revoke`).then((r) => r.data),
  resend: (rid) => client.post(`/enrollments/requests/${rid}/resend`).then((r) => r.data),
  // Public (token-based) signing flow:
  publicView: (token) =>
    client.get(`/enrollments/public/${token}`).then((r) => r.data),
  publicMarkViewed: (token) =>
    client.post(`/enrollments/public/${token}/view`).then((r) => r.data),
  publicPayload: (token, document) =>
    client.get(`/enrollments/public/${token}/payload/${document}`).then((r) => r.data),
  publicSubmit: (token, document, cms) =>
    client.post(`/enrollments/public/${token}/submit/${document}`, { cms }).then((r) => r.data),
  publicDownloadUrl: (token, document, fmt) =>
    `${API_PREFIX}/enrollments/public/${token}/download/${document}/${fmt}`,
  // Inline (in-browser) PDF preview so the signer sees the full bilingual
  // document — both the Kazakh and Russian columns — before signing.
  publicPreviewUrl: (token, document) =>
    `${API_PREFIX}/enrollments/public/${token}/download/${document}/pdf?inline=1`,
  // Admin-side "Подпись колледжа" flow: no token, just the admin's own
  // NCALayer session signs on behalf of the college. Director identity is
  // auto-pulled from CollegeSettings and never typed by the admin.
  collegeInfo: (id) =>
    client.get(`/enrollments/${id}/college-info`).then((r) => r.data),
  collegePayload: (id, document) =>
    client.get(`/enrollments/${id}/college-payload/${document}`).then((r) => r.data),
  collegeSign: (id, document, cms) =>
    client.post(`/enrollments/${id}/college-sign/${document}`, { cms }).then((r) => r.data),
};

// Mirror of enrollmentsApi shape so frontend file patterns transfer 1:1 to
// the LmsContractsPage. The LMS aggregate has a SINGLE document (no
// /<document> path segment on payload/submit/download endpoints).
export const lmsContractsApi = {
  list: (params) => client.get("/lms-contracts", { params }).then((r) => r.data),
  get: (id) => client.get(`/lms-contracts/${id}`).then((r) => r.data),
  suggestNumber: (year) =>
    client.get("/lms-contracts/suggest-number", { params: { year } }).then((r) => r.data),
  grantStudents: () =>
    client.get("/lms-contracts/grant-students").then((r) => r.data),
  // Contracts whose applicant snapshot disagrees with the linked Student.
  linkAudit: () => client.get("/lms-contracts/link-audit").then((r) => r.data),
  // Re-attach a contract to the student it actually belongs to.
  relinkStudent: (id, studentId, resyncSnapshot = false) =>
    client
      .put(`/lms-contracts/${id}/student`, {
        student_id: studentId,
        resync_snapshot: !!resyncSnapshot,
      })
      .then((r) => r.data),
  create: (data) => client.post("/lms-contracts", data).then((r) => r.data),
  update: (id, data) => client.put(`/lms-contracts/${id}`, data).then((r) => r.data),
  generate: (id, payload) =>
    client.post(`/lms-contracts/${id}/generate`, payload || {}).then((r) => r.data),
  // `force` confirms destroying existing ЭЦП signatures — the backend refuses
  // with 409 code="has_signatures" without it.
  remove: (id, force = false) =>
    client.delete(`/lms-contracts/${id}`, { data: { force: !!force } }).then((r) => r.data),
  downloadDoc: (id, fmt, filename) =>
    blobDownload(`/lms-contracts/${id}/download/${fmt}`, filename),
  invite: (id, payload) =>
    client.post(`/lms-contracts/${id}/invite`, payload || {}).then((r) => r.data),
  listRequests: (id) =>
    client.get(`/lms-contracts/${id}/requests`).then((r) => r.data),
  revoke: (rid) => client.post(`/lms-contracts/requests/${rid}/revoke`).then((r) => r.data),
  resend: (rid) => client.post(`/lms-contracts/requests/${rid}/resend`).then((r) => r.data),
  // Public (token-based) signing flow — single document, no /<document> segment.
  publicView: (token) =>
    client.get(`/lms-contracts/public/${token}`).then((r) => r.data),
  publicMarkViewed: (token) =>
    client.post(`/lms-contracts/public/${token}/view`).then((r) => r.data),
  publicPayload: (token) =>
    client.get(`/lms-contracts/public/${token}/payload`).then((r) => r.data),
  publicSubmit: (token, cms) =>
    client.post(`/lms-contracts/public/${token}/submit`, { cms }).then((r) => r.data),
  publicDownloadUrl: (token, fmt) =>
    `${API_PREFIX}/lms-contracts/public/${token}/download/${fmt}`,
  publicPreviewUrl: (token) =>
    `${API_PREFIX}/lms-contracts/public/${token}/download/pdf?inline=1`,
};

// Convenience to toggle the grant flag from the Students page (admin-only on
// the backend). Living next to lmsContractsApi keeps the LMS-related API
// surface co-located.
export const studentGrantApi = {
  setFlag: (sid, isGrant) =>
    client.put(`/students/${sid}/grant`, { is_grant_student: !!isGrant }).then((r) => r.data),
};

export const specialtiesApi = {
  list: (params) => client.get("/specialties", { params }).then((r) => r.data),
  create: (data) => client.post("/specialties", data).then((r) => r.data),
  update: (id, data) => client.put(`/specialties/${id}`, data).then((r) => r.data),
  remove: (id) => client.delete(`/specialties/${id}`).then((r) => r.data),
};

export const verifyApi = {
  get: (code) => client.get(`/verify/${code}`).then((r) => r.data),
  fileUrl: (code, fmt) => `${API_PREFIX}/verify/${code}/file/${fmt}`,
};

export const signaturesApi = {
  payloadHash: (contractId) =>
    client.get(`/signatures/contracts/${contractId}/payload-hash`).then((r) => r.data),
  attach: (contractId, payload) =>
    client.post(`/signatures/contracts/${contractId}/attach`, payload).then((r) => r.data),
  list: (contractId) =>
    client.get(`/signatures/contracts/${contractId}`).then((r) => r.data),
};
