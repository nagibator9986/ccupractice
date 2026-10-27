import { toneOf } from "./tones.js";

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Russian numeral agreement for "год/года/лет".
export function ruYears(n) {
  if (n == null) return "лет";
  const a = Math.abs(n) % 100;
  const b = Math.abs(n) % 10;
  if (a > 10 && a < 20) return "лет";
  if (b === 1) return "год";
  if (b >= 2 && b <= 4) return "года";
  return "лет";
}

// Single source of truth for contract statuses. `icon` is a lucide-react
// component NAME (string) so this file stays free of React imports;
// StatusBadge maps it to the real component.
export const CONTRACT_STATUS_META = {
  draft: { label: "Черновик", tone: "slate", icon: "PenLine" },
  generated: { label: "Сформирован", tone: "blue", icon: "FileText" },
  sent: { label: "Отправлен партнеру", tone: "indigo", icon: "Send" },
  signed: { label: "Подписан (ЭЦП)", tone: "emerald", icon: "BadgeCheck" },
  scan_uploaded: { label: "Скан загружен", tone: "teal", icon: "FileUp" },
  completed: { label: "Завершён", tone: "green", icon: "CircleCheck" },
};

// Derived views kept for backward compatibility (pages iterate STATUS_LABELS
// with Object.entries, so insertion order above is the display order).
export const STATUS_COLORS = Object.fromEntries(
  Object.entries(CONTRACT_STATUS_META).map(([k, m]) => [k, toneOf(m.tone).badge]),
);

export const STATUS_LABELS = Object.fromEntries(
  Object.entries(CONTRACT_STATUS_META).map(([k, m]) => [k, m.label]),
);

// Signing-party roles (not to be confused with user roles admin/viewer).
export const ROLE_LABELS = {
  college: "Колледж",
  partner: "Предприятие",
  student: "Обучающийся",
};

// Russian plural: plural(5, "студент", "студента", "студентов") -> "студентов".
// Fractions take the "few" form ("1,5 года"), as in Russian grammar.
export function plural(n, one, few, many) {
  const num = Number(n);
  if (!Number.isFinite(num)) return many;
  if (!Number.isInteger(num)) return few;
  const a = Math.abs(num) % 100;
  const b = Math.abs(num) % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export function formatBytes(n) {
  const num = Number(n);
  if (n == null || !Number.isFinite(num) || num < 0) return "—";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let v = num;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 || v >= 10 ? 0 : 1;
  return `${v.toLocaleString("ru-RU", { maximumFractionDigits: digits })} ${units[i]}`;
}

// "Иванов Иван Иванович" -> "Иванов И.И."
export function shortName(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const [surname, ...rest] = parts;
  const ini = rest.map((p) => `${p[0].toUpperCase()}.`).join("");
  return ini ? `${surname} ${ini}` : surname;
}

// "Иванов Иван Иванович" -> "ИИ" (avatar letters: surname + first name).
export function initials(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

// Normalise to the 11-digit "7xxxxxxxxxx" form; null when it can't be a KZ/RU
// mobile number (so callers fall back to the raw text instead of mangling it).
function normalizePhoneDigits(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "8") d = `7${d.slice(1)}`;
  else if (d.length === 10) d = `7${d}`;
  return d.length === 11 && d[0] === "7" ? d : null;
}

// +7 7xx xxx xx xx. Empty -> "" (callers do `formatPhone(p) || "—"`).
export function formatPhone(raw) {
  if (raw == null || raw === "") return "";
  const d = normalizePhoneDigits(raw);
  if (!d) return String(raw);
  return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9, 11)}`;
}

// wa.me link; no phone -> the "pick a contact" share link.
export function whatsappUrl(phone, text) {
  const d = normalizePhoneDigits(phone) ?? String(phone ?? "").replace(/\D/g, "");
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  if (!d) return `https://wa.me/${q || "?text="}`;
  return `https://wa.me/${d}${q}`;
}

// Save a Blob as a file via a transient <a download>. The URL is revoked on a
// timer: revoking synchronously cancels the download in Safari/Firefox.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
