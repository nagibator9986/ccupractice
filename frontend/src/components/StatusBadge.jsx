import { STATUS_COLORS, STATUS_LABELS } from "../utils/format.js";
import clsx from "clsx";

export default function StatusBadge({ value }) {
  // Defensive coercion: if the backend ever returns a new status without a
  // matching label, prefer the raw string; if the value is null/undefined or
  // accidentally an object (API drift), fall back to a dash so React doesn't
  // try to render an object child.
  const label = STATUS_LABELS[value] ?? (typeof value === "string" ? value : "—");
  if (import.meta.env.DEV && value && !STATUS_LABELS[value]) {
    // Surface unmapped statuses during development so a new backend enum
    // doesn't ship as raw English text to users.
    console.warn("StatusBadge: missing label for status", value);
  }
  return (
    <span className={clsx("badge", STATUS_COLORS[value] || "bg-slate-100 text-slate-600")}>
      {label}
    </span>
  );
}
