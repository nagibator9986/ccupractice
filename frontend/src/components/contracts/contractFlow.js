// Shared vocabulary of the practice-contract screens: signer roles, the
// "what to do next" states, status transitions, readiness deep links and the
// text of the message that goes with a signing link. No React in here.

export const ROLES = ["college", "partner", "student"];

export const ROLE_TITLE = {
  college: "Колледж",
  partner: "Предприятие",
  student: "Студент",
};

// One letter per party for the compact К·П·С indicator in the lists.
export const ROLE_SHORT = { college: "К", partner: "П", student: "С" };

export const ROLE_HINT = {
  college: "Директор колледжа подписывает ЭЦП от имени организации образования",
  partner: "Руководитель предприятия подписывает ЭЦП от имени базы практики",
  student: "Студент подписывает ЭЦП от своего имени",
};

export const SCOPE_TITLE = {
  student: "Студент",
  partner: "Предприятие",
  college: "Колледж",
};

// `Contract.next_action` (backend/app/models/contract.py) → label + tone.
// Tones are keys of utils/tones.js.
export const NEXT_ACTION_META = {
  generate: { label: "Сформировать", tone: "amber" },
  invite: { label: "Отправить на подпись", tone: "blue" },
  await_signatures: { label: "Ждём подписи", tone: "indigo" },
  complete: { label: "Завершить", tone: "emerald" },
  done: { label: "Готово", tone: "green" },
};

// The values the "Что делать дальше" filter offers (done has its own status tab).
export const STAGE_OPTIONS = ["generate", "invite", "await_signatures", "complete"];

// Mirror of `_ALLOWED_STATUS_TRANSITIONS` in backend/app/api/contracts.py.
// `signed` is never a manual target: the signing flow owns it. Keep in sync
// with the backend — the server answers 409 for anything not listed here.
export const ALLOWED_STATUS_TRANSITIONS = {
  draft: ["generated"],
  generated: ["sent", "draft"],
  sent: ["generated", "completed"],
  signed: ["completed"],
  scan_uploaded: ["completed"],
  completed: ["scan_uploaded"],
};

/** Button text for a manual status move, in plain language. */
export function statusMoveLabel(from, to) {
  if (to === "completed") return "Завершить договор";
  if (to === "sent") return "Отметить как отправленный";
  if (to === "generated") return from === "draft" ? "Отметить как сформированный" : "Вернуть в «Сформирован»";
  if (to === "draft") return "Вернуть в «Черновик»";
  if (to === "scan_uploaded") return "Вернуть в «Скан загружен»";
  return to;
}

/** Where the clerk goes to fix a missing field (URL contract of the brief). */
export function readinessLink(m) {
  if (!m) return null;
  if (m.scope === "college") return "/settings";
  if (!m.entity_id) return null;
  if (m.scope === "student") return `/students?edit=${m.entity_id}`;
  if (m.scope === "partner") return `/partners?edit=${m.entity_id}`;
  return null;
}

export function criticalLabels(readiness) {
  return (readiness?.missing || []).filter((m) => m.severity === "critical").map((m) => m.label);
}

/** Local calendar date as YYYY-MM-DD (toISOString() is UTC and flips a day early in Kazakhstan). */
export function todayLocalISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The API sends naive UTC timestamps ("2026-11-25T10:00:00.123456"). Without
 * a zone `new Date()` would read them as local time and drift by hours.
 */
export function parseServerDate(value) {
  if (!value) return null;
  const s = String(value);
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
  const d = new Date(!hasZone && s.includes("T") ? `${s}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value) {
  const d = parseServerDate(value);
  return d ? d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
}

export function fmtDateTime(value) {
  const d = parseServerDate(value);
  return d
    ? d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

/** Whole days until `value` (negative when already past); null when unknown. */
export function daysLeft(value) {
  const d = parseServerDate(value);
  if (!d) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/**
 * State of one party's signing link:
 * none | pending | viewed | expired | signed.  A revoked link counts as none.
 */
export function requestState(req) {
  if (!req) return "none";
  if (req.status === "signed") return "signed";
  if (req.status === "revoked") return "none";
  const left = daysLeft(req.expires_at);
  if (req.expired || (left != null && left < 0)) return "expired";
  return req.status === "viewed" ? "viewed" : "pending";
}

export const REQUEST_STATE_META = {
  none: { label: "Ссылка не создана", tone: "slate" },
  pending: { label: "Ссылка выдана", tone: "amber" },
  viewed: { label: "Открыл(а) ссылку", tone: "indigo" },
  expired: { label: "Срок ссылки истёк", tone: "red" },
  signed: { label: "Подписано", tone: "emerald" },
};

/** Short phrase about the expiry, e.g. "до 25.11.2026 (через 12 дн.)". */
export function expiryText(req) {
  if (!req?.expires_at) return "";
  const left = daysLeft(req.expires_at);
  const until = fmtDate(req.expires_at);
  if (left == null) return `до ${until}`;
  if (left < 0) return `истекла ${until}`;
  if (left === 0) return `до ${until} (истекает сегодня)`;
  return `до ${until} (ещё ${left} дн.)`;
}

/** The link as the signer will open it (the API already uses the SPA origin). */
export function signUrlOf(req) {
  if (!req) return "";
  if (req.sign_url && /^https?:\/\//i.test(req.sign_url)) return req.sign_url;
  if (req.token) return `${window.location.origin}/sign/${req.token}`;
  return req.sign_url || "";
}

/**
 * Text that accompanies a signing link. Mirrors the message in the Excel
 * export of the backend (api/signing.py::links_export). Nothing is sent
 * automatically — the clerk pastes it into a messenger.
 */
export function buildSignMessage({ name, number, studentName, url, expiresAt }) {
  const hello = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
  const who = studentName ? ` (студент: ${studentName})` : "";
  const until = expiresAt ? ` Срок действия — до ${fmtDate(expiresAt)}.` : "";
  return `${hello} Просим подписать договор практики № ${number}${who} электронной подписью (ЭЦП) через NCALayer. Ссылка: ${url}${until}`;
}
