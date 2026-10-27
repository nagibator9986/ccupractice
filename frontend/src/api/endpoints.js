import client from "./client";

// Mirror of client.js — used for raw <a href> download URLs.
const API_PREFIX = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "") + "/api";

/**
 * Human-readable message from an axios error. Blob responses (xlsx/pdf
 * downloads) carry their JSON error inside a Blob, so reading `data.error`
 * directly gives `undefined` — this unwraps it.
 */
export async function errorText(e, fallback = "Произошла ошибка") {
  let data = e?.response?.data;
  if (data instanceof Blob) {
    try {
      data = JSON.parse(await data.text());
    } catch {
      data = null;
    }
  }
  return data?.error || (e?.code === "ECONNABORTED" ? "Сервер отвечает слишком долго" : null) || fallback;
}

/** `Content-Disposition: attachment; filename*=UTF-8''...` → decoded name. */
function filenameFrom(res, fallback) {
  const cd = res.headers?.["content-disposition"] || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1] : fallback;
}

function saveBlob(res, fallbackName) {
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFrom(res, fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

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

  // ── Group-oriented operations (see backend api/student_bulk.py) ──────────
  // Per-group overview: students, partner/period coverage, contract pipeline.
  groups: () => client.get("/students/groups").then((r) => r.data),
  // Blank .xlsx template (dropdowns are filled from partners/specialties/groups).
  downloadImportTemplate: async () => {
    const res = await client.get("/students/import/template", { responseType: "blob" });
    saveBlob(res, "Шаблон_загрузки_студентов.xlsx");
  },
  // Import is stateless: the SAME file + options go to preview and to commit.
  //   options = { mode: "skip"|"fill"|"overwrite", default_group, force_group,
  //               group_overrides: {sheetName: group}, defaults: {partner_id,
  //               practice_start, practice_end, college_supervisor,
  //               partner_supervisor, practice_type, course, specialty, ...} }
  importPreview: (file, options = {}) => {
    const form = new FormData();
    form.append("file", file);
    form.append("options", JSON.stringify(options));
    return client.post("/students/import/preview", form, { timeout: 120_000 }).then((r) => r.data);
  },
  // expect = { new, update } from the preview the operator confirmed; the
  // server answers 409 code="plan_changed" if the register moved meanwhile.
  importCommit: (file, options = {}, expect = {}) => {
    const form = new FormData();
    form.append("file", file);
    form.append("options", JSON.stringify(options));
    if (expect.new != null) form.append("expect_new", String(expect.new));
    if (expect.update != null) form.append("expect_update", String(expect.update));
    return client.post("/students/import/commit", form, { timeout: 120_000 }).then((r) => r.data);
  },
  // Same columns as the import template — an exported group can be edited and re-imported.
  exportXlsx: async (params) => {
    const res = await client.get("/students/export", { params, responseType: "blob" });
    saveBlob(res, "Студенты.xlsx");
  },
  // { student_ids | group, fields: {partner_id, practice_start, practice_end,
  //   college_supervisor, partner_supervisor, practice_type}, only_empty }
  bulkPractice: (body) => client.post("/students/bulk-practice", body).then((r) => r.data),
  // Deletes students WITHOUT contracts; returns { deleted, blocked: [{id, full_name, reason}] }.
  bulkDelete: (student_ids) =>
    client.post("/students/bulk-delete", { student_ids }).then((r) => r.data),
};

export const contractsApi = {
  list: (params) => client.get("/contracts", { params }).then((r) => r.data),
  get: (id) => client.get(`/contracts/${id}`).then((r) => r.data),
  create: (data) => client.post("/contracts", data).then((r) => r.data),
  update: (id, data) => client.put(`/contracts/${id}`, data).then((r) => r.data),
  // Signed / scanned contracts need `force` (backend answers 409 has_signatures).
  remove: (id, force = false) =>
    client.delete(`/contracts/${id}`, { data: { force: !!force } }).then((r) => r.data),
  // payload: { force } resets signatures; { allow_incomplete } overrides the
  // readiness gate (backend answers 422 code="incomplete" with `readiness`).
  generate: (id, payload) =>
    client.post(`/contracts/${id}/generate`, payload || {}, { timeout: 180_000 }).then((r) => r.data),
  // Pre-flight for the create dialog: { readiness, duplicate, student_contracts }.
  readiness: (params) => client.get("/contracts/readiness", { params }).then((r) => r.data),
  // body: { student_ids | group, partner_id?, contract_date, existing: "skip"|"allow",
  //         skip_incomplete, dry_run } → { created, will_create, skipped, contract_ids, items, warnings }
  bulk: (body) => client.post("/contracts/bulk", body).then((r) => r.data),
  // Dashboard numbers: totals, by_status, by_next_action, attention, groups, recent.
  stats: () => client.get("/contracts/stats").then((r) => r.data),
  exportXlsx: async (params) => {
    const res = await client.get("/contracts/export", { params, responseType: "blob" });
    saveBlob(res, "Договоры_практики.xlsx");
  },
  // Authenticated inline preview: returns an object URL for <iframe src>.
  // The CALLER must URL.revokeObjectURL() it when done.
  previewUrl: async (id, fmt = "pdf") => {
    const res = await client.get(`/contracts/${id}/download/${fmt}`, {
      params: { inline: 1 },
      responseType: "blob",
    });
    return URL.createObjectURL(res.data);
  },
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
  // Keeps the token (the URL already sent stays valid), only moves the expiry.
  extend: (requestId, days = 30) =>
    client.post(`/signing/requests/${requestId}/extend`, { days }).then((r) => r.data),
  // → { new_links, items: [{contract_id, number, student_name, group_name,
  //      status: "ok"|"skipped", reason, links: [{id, signer_role, recipient_name,
  //      recipient_phone, sign_url, token, expires_at, is_new, ...}]}] }
  bulkInvite: (contract_ids, roles = ["partner", "student"]) =>
    client.post("/signing/bulk-invite", { contract_ids, roles }, { timeout: 120_000 }).then((r) => r.data),
  // .xlsx with every live link + a ready-to-paste message per row.
  exportLinks: async (contract_ids, roles) => {
    const res = await client.post(
      "/signing/links-export",
      { contract_ids, ...(roles ? { roles } : {}) },
      { responseType: "blob" },
    );
    saveBlob(res, "Ссылки_на_подписание.xlsx");
  },
  publicPreviewUrl: (token) => `${API_PREFIX}/signing/public/${token}/download/pdf?inline=1`,
  // eGov mobile (QR / deep link). Start returns { session:{id,status,expires_at}, qr_png (data URI),
  // qr_content, deep_links:{ios,android}, https, ttl_minutes }; status polls { session:{status,error}, request_status }.
  egovStart: (token) => client.post(`/signing/public/${token}/egov/session`).then((r) => r.data),
  egovStatus: (token, sessionId) =>
    client.get(`/signing/public/${token}/egov/session/${sessionId}`).then((r) => r.data),
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
