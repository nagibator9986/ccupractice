import { Inbox } from "lucide-react";
import clsx from "clsx";
import renderIcon from "../utils/renderIcon.js";

export default function EmptyState({ icon = Inbox, title, description, action, compact = false }) {
  return (
    <div className={clsx("flex flex-col items-center text-center px-4", compact ? "py-8" : "py-14")}>
      <span
        className={clsx(
          "grid place-items-center rounded-2xl bg-charcoal-50 text-charcoal-400 ring-1 ring-charcoal-100",
          compact ? "h-11 w-11 mb-3" : "h-14 w-14 mb-4",
        )}
        aria-hidden="true"
      >
        {renderIcon(icon, { className: compact ? "h-5 w-5" : "h-6 w-6", strokeWidth: 1.75 })}
      </span>
      {title && <h3 className={clsx("font-semibold text-charcoal-800", compact ? "text-sm" : "text-base")}>{title}</h3>}
      {description && (
        <p className={clsx("mt-1 max-w-md text-charcoal-500", compact ? "text-xs" : "text-sm")}>{description}</p>
      )}
      {action && <div className={clsx("flex flex-wrap justify-center gap-2", compact ? "mt-3" : "mt-5")}>{action}</div>}
    </div>
  );
}
