import { STATUS_COLORS, STATUS_LABELS } from "../utils/format.js";
import clsx from "clsx";

export default function StatusBadge({ value }) {
  return (
    <span className={clsx("badge", STATUS_COLORS[value] || "bg-slate-100 text-slate-600")}>
      {STATUS_LABELS[value] || value}
    </span>
  );
}
