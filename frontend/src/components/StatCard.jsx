import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import clsx from "clsx";
import { toneOf } from "../utils/tones.js";
import renderIcon from "../utils/renderIcon.js";
import { Skeleton } from "./Skeleton.jsx";

export default function StatCard({ icon, label, value, hint, tone = "coral", to, loading = false, className }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm font-medium text-charcoal-500">{label}</span>
        {icon && (
          <span
            className={clsx("h-9 w-9 shrink-0 grid place-items-center rounded-xl", toneOf(tone).soft)}
            aria-hidden="true"
          >
            {renderIcon(icon, { className: "h-[18px] w-[18px]" })}
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-bold leading-none tracking-tight tabular-nums text-charcoal-900">
        {loading ? <Skeleton className="h-8 w-20" /> : value ?? "—"}
      </div>
      {hint && !loading && <div className="mt-2 text-xs text-charcoal-500 leading-snug">{hint}</div>}
      {to && (
        <ArrowUpRight
          className="absolute right-3 bottom-3 h-4 w-4 text-charcoal-300 opacity-0 transition group-hover:opacity-100 group-hover:text-coral-500"
          aria-hidden="true"
        />
      )}
    </>
  );

  const base = "card relative block p-4 sm:p-5";
  if (to) {
    return (
      <Link
        to={to}
        className={clsx(base, "group transition hover:ring-coral-200 hover:shadow-soft", className)}
        aria-busy={loading || undefined}
      >
        {body}
      </Link>
    );
  }
  return (
    <div className={clsx(base, className)} aria-busy={loading || undefined}>
      {body}
    </div>
  );
}
