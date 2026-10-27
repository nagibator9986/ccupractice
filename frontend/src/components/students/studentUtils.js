// Pure helpers shared by the Students / Groups pages and the import wizard.
// No React in here so they stay trivially testable.

/** `?group=` value that means "students with no group at all". */
export const GROUP_NONE = "__none__";

export const PRACTICE_TYPES = ["учебной", "профессиональной", "производственной", "преддипломной"];

export const COURSES = [1, 2, 3, 4, 5, 6];

/** Empty values of the "practice settings" block (wizard defaults / bulk assign). */
export const EMPTY_PRACTICE = {
  partner_id: "",
  practice_start: "",
  practice_end: "",
  college_supervisor: "",
  partner_supervisor: "",
  practice_type: "",
  course: "",
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

function isoParts(v) {
  const m = ISO.exec(String(v ?? ""));
  return m ? { y: m[1], m: m[2], d: m[3] } : null;
}

/** 2026-06-01 -> 01.06.2026 (timezone-safe: never goes through Date). */
export function fmtDay(v) {
  if (v == null || v === "") return "—";
  const p = isoParts(v);
  return p ? `${p.d}.${p.m}.${p.y}` : String(v);
}

/**
 * Compact practice period: "01.06 – 30.06.2026" (same year), full dates across
 * years, "с 01.06.2026" / "до 30.06.2026" for a half-set period, null if unset.
 */
export function fmtPeriod(start, end) {
  const a = isoParts(start);
  const b = isoParts(end);
  if (a && b) {
    return a.y === b.y ? `${a.d}.${a.m} – ${b.d}.${b.m}.${b.y}` : `${a.d}.${a.m}.${a.y} – ${b.d}.${b.m}.${b.y}`;
  }
  if (a) return `с ${a.d}.${a.m}.${a.y}`;
  if (b) return `до ${b.d}.${b.m}.${b.y}`;
  return null;
}

export const groupLabelOf = (name) => (name ? name : "Без группы");
export const groupParamOf = (name) => (name ? name : GROUP_NONE);

/** "ООО Ромашка • свободно 3" — free seats come from partners?with_stats=1. */
export function partnerLabel(p) {
  if (!p) return "";
  const base = p.organization_name || `Предприятие №${p.id}`;
  if (p.seats_free == null) return base;
  return p.seats_free > 0 ? `${base} • свободно ${p.seats_free}` : `${base} • мест нет`;
}

/** Field-level errors of a practice block. */
export function validatePractice(v) {
  const errors = {};
  if (v.practice_start && v.practice_end && v.practice_end < v.practice_start) {
    errors.practice_end = "Окончание не может быть раньше начала";
  }
  if (v.course !== "" && v.course != null) {
    const n = Number(v.course);
    if (!Number.isInteger(n) || n < 1 || n > 6) errors.course = "Курс — число от 1 до 6";
  }
  return errors;
}

/** Only non-empty values, typed the way the API wants them. */
export function cleanPractice(v, { course = true } = {}) {
  const out = {};
  if (v.partner_id !== "" && v.partner_id != null) out.partner_id = Number(v.partner_id);
  for (const k of ["practice_start", "practice_end"]) {
    if (v[k]) out[k] = v[k];
  }
  for (const k of ["college_supervisor", "partner_supervisor", "practice_type"]) {
    const t = String(v[k] ?? "").trim();
    if (t) out[k] = t;
  }
  if (course && v.course !== "" && v.course != null) out.course = Number(v.course);
  return out;
}

/** The embedded LMS contract that pins the grant flag (null if none / finished). */
export function activeLms(student) {
  return student?.lms_contract?.is_active ? student.lms_contract : null;
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel-friendly CSV: BOM + `;` separator (Russian locale default). */
export function buildCsv(header, rows) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}
