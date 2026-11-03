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

// Who actually signs the student's side: the student, or (under 16) the legal representative.
export const CAPACITY_REP = "legal_representative";
export const REP_TITLE = "Законный представитель";
export const REP_REASON = "студент младше 16 лет";

/** Title of a party; the student's row becomes «Законный представитель» for a minor. */
export function partyTitle(role, capacity) {
  if (role === "student" && capacity === CAPACITY_REP) return REP_TITLE;
  return ROLE_TITLE[role] || role;
}

// How a party signs: ЭЦП (NCALayer / eGov mobile) or on paper with a scan the college reviews.
export const SIGN_METHODS = ["ecp", "scan"];
export const SIGN_METHOD_META = {
  ecp: { label: "ЭЦП", long: "Электронная подпись (ЭЦП)", tone: "indigo" },
  scan: { label: "Бумага + скан", long: "На бумаге, со сканом", tone: "teal" },
};

export const ROLE_HINT = {
  college: "Директор колледжа подписывает ЭЦП от имени организации образования",
  partner: "Руководитель предприятия подписывает ЭЦП от имени базы практики",
  student: "Студент подписывает ЭЦП от своего имени",
};

/** One-line explanation under the party's name. */
export function roleHint(role, capacity = "self", method = "ecp") {
  const paper = method === "scan";
  if (role === "college") return ROLE_HINT.college;
  if (role === "partner") {
    return paper
      ? "Руководитель предприятия подписывает договор на бумаге и загружает скан"
      : ROLE_HINT.partner;
  }
  if (capacity === CAPACITY_REP) {
    return paper
      ? "Подписывает на бумаге и загружает скан — вместо студента"
      : "Подписывает ЭЦП вместо студента";
  }
  return paper ? "Студент подписывает договор на бумаге и загружает скан" : ROLE_HINT.student;
}

/** Capacity of the student's side for one row: the live link wins, then the signature, then the contract. */
export function capacityOf({ role, req, signature, contract }) {
  if (role !== "student") return "self";
  return req?.signer_capacity || signature?.signer_capacity || contract?.student_signer || "self";
}

/** Method of one row: what was used (signature) > the live link > the default of the student card. */
export function methodOf({ role, req, signature, contract }) {
  if (signature) return signature.channel === "scan" ? "scan" : "ecp";
  if (req) return req.method === "scan" ? "scan" : "ecp";
  if (role === "student" && contract?.student_sign_method === "scan") return "scan";
  return "ecp";
}

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
  review_scan: { label: "Проверить скан", tone: "teal" },
  await_signatures: { label: "Ждём подписи", tone: "indigo" },
  complete: { label: "Завершить", tone: "emerald" },
  done: { label: "Готово", tone: "green" },
};

// The values the "Что делать дальше" filter offers (done has its own status tab).
export const STAGE_OPTIONS = ["generate", "invite", "review_scan", "await_signatures", "complete"];

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
  if (m.scope === "student") {
    // The representative's fields sit on their own tab of the student card.
    const rep = typeof m.field === "string" && m.field.startsWith("legal_rep_");
    return `/students?edit=${m.entity_id}${rep ? "&tab=rep" : ""}`;
  }
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

/** Is there a scan of this link that waits for the college's decision? */
export function hasPendingScan(req) {
  return !!req && req.scan?.review === "pending" && (req.status === "pending" || req.status === "viewed");
}

/**
 * State of one party's signing link:
 * none | pending | viewed | expired | signed | scan_wait | scan_pending | scan_rejected.
 * A revoked link counts as none. A scan that waits for review beats "expired": the
 * college can still accept it, the signer's link is irrelevant at that point.
 */
export function requestState(req) {
  if (!req) return "none";
  if (req.status === "signed") return "signed";
  if (req.status === "revoked") return "none";
  if (hasPendingScan(req)) return "scan_pending";
  const left = daysLeft(req.expires_at);
  if (req.expired || (left != null && left < 0)) return "expired";
  if (req.method === "scan") return req.scan?.review === "rejected" ? "scan_rejected" : "scan_wait";
  return req.status === "viewed" ? "viewed" : "pending";
}

export const REQUEST_STATE_META = {
  none: { label: "Ссылка не создана", tone: "slate" },
  pending: { label: "Ссылка выдана", tone: "amber" },
  viewed: { label: "Открыл(а) ссылку", tone: "indigo" },
  expired: { label: "Срок ссылки истёк", tone: "red" },
  signed: { label: "Подписано", tone: "emerald" },
  scan_wait: { label: "Ждём скан", tone: "amber" },
  scan_pending: { label: "Скан на проверке", tone: "blue" },
  scan_rejected: { label: "Скан отклонён", tone: "red" },
};

// Scan limits of the signer's page (server: scan_store.py) — checked here before an admin upload.
export const SCAN_MAX_FILES = 10;
export const SCAN_MAX_MB = 15;

/** Client-side check of files picked for a scan. "" = fine, otherwise a user-ready message. */
export function validateScanFiles(files) {
  const list = Array.from(files || []);
  if (list.length === 0) return "Выберите файл со сканом";
  const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  const isImg = (f) => /^image\/(jpe?g|png)$/i.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);
  const wrong = list.find((f) => !isPdf(f) && !isImg(f));
  if (wrong) return `Файл «${wrong.name}» не подходит: нужен PDF или фото в формате JPG/PNG`;
  const big = list.find((f) => f.size > SCAN_MAX_MB * 1024 * 1024);
  if (big) return `Файл «${big.name}» больше ${SCAN_MAX_MB} МБ`;
  if (list.some(isPdf) && list.length > 1) return "Загрузите один PDF-файл или несколько фото — вместе их смешивать нельзя";
  if (list.length > SCAN_MAX_FILES) return `Не больше ${SCAN_MAX_FILES} фото за один раз`;
  return "";
}

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

// Pieces of the message that goes with a link; kept apart so Telegram can take the link
// separately from the text.
function messageParts({ name, number, studentName, expiresAt, method = "ecp", capacity = "self" }) {
  const hello = name ? `Здравствуйте, ${name}!` : "Здравствуйте!";
  const rep = capacity === CAPACITY_REP;
  const until = expiresAt ? ` Срок действия — до ${fmtDate(expiresAt)}.` : "";
  let intro;
  let lead;
  if (method === "scan") {
    intro = rep
      ? `${hello} Студент${studentName ? ` ${studentName}` : ""} младше 16 лет, поэтому договор практики № ${number} подписывает законный представитель — на бумаге.`
      : `${hello} Договор практики № ${number}${studentName ? ` (студент: ${studentName})` : ""} нужно подписать на бумаге.`;
    lead = "Распечатайте, подпишите и загрузите скан или фото по ссылке:";
  } else {
    intro = rep
      ? `${hello} Просим подписать как законный представитель договор практики № ${number}${studentName ? ` студента ${studentName}` : ""} электронной подписью (ЭЦП) через NCALayer.`
      : `${hello} Просим подписать договор практики № ${number}${studentName ? ` (студент: ${studentName})` : ""} электронной подписью (ЭЦП) через NCALayer.`;
    lead = "Ссылка:";
  }
  return { intro, lead, until };
}

/**
 * Text that accompanies a signing link. Mirrors the message in the Excel
 * export of the backend (api/signing.py::links_export). Nothing is sent
 * automatically — the clerk pastes it into a messenger.
 * `method` = "ecp" | "scan", `capacity` = "self" | "legal_representative" (both from the link).
 */
export function buildSignMessage({ url, ...rest }) {
  const { intro, lead, until } = messageParts(rest);
  return `${intro} ${lead} ${url}${until}`;
}

/**
 * The same text without the link itself (Telegram's share URL carries the link separately).
 * For paper links the instruction stays, ending with a colon: the link follows it.
 */
export function buildSignText(args) {
  const { intro, lead, until } = messageParts(args);
  return args.method === "scan" ? `${intro}${until} ${lead}` : `${intro}${until}`;
}
