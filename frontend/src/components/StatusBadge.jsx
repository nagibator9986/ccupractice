import { BadgeCheck, CircleCheck, FileText, FileUp, PenLine, Send } from "lucide-react";
import clsx from "clsx";
import { CONTRACT_STATUS_META } from "../utils/format.js";
import { toneOf } from "../utils/tones.js";

// CONTRACT_STATUS_META stores icon NAMES (format.js has no React imports).
const ICONS = { BadgeCheck, CircleCheck, FileText, FileUp, PenLine, Send };

export default function StatusBadge({ value }) {
  const meta = CONTRACT_STATUS_META[value];
  // Defensive coercion: if the backend ever returns a new status without a
  // matching label, prefer the raw string; if the value is null/undefined or
  // accidentally an object (API drift), fall back to a dash so React doesn't
  // try to render an object child.
  const label = meta?.label ?? (typeof value === "string" ? value : "—");
  if (import.meta.env.DEV && value && !meta) {
    // Surface unmapped statuses during development so a new backend enum
    // doesn't ship as raw English text to users.
    console.warn("StatusBadge: missing label for status", value);
  }
  const tone = toneOf(meta?.tone);
  const Icon = ICONS[meta?.icon];
  return (
    <span className={clsx("badge", tone.badge)}>
      {Icon ? (
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <span className={clsx("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
