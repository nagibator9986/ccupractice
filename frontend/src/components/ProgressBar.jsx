import clsx from "clsx";
import { toneOf } from "../utils/tones.js";

const HEIGHTS = { sm: "h-1.5", md: "h-2.5", lg: "h-3.5" };

function pctOf(value, max) {
  const v = Number(value) || 0;
  const m = Number(max) || 0;
  if (m <= 0) return 0;
  return Math.min(100, Math.max(0, (v / m) * 100));
}

export default function ProgressBar({ value = 0, max = 100, tone = "coral", showLabel = false, height = "md", className, label }) {
  const pct = pctOf(value, max);
  return (
    <div className={clsx("flex items-center gap-3", className)}>
      <div
        className={clsx("flex-1 overflow-hidden rounded-full bg-charcoal-100", HEIGHTS[height] || HEIGHTS.md)}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Number(max) || 100}
        aria-valuenow={Math.min(Number(value) || 0, Number(max) || 100)}
        aria-label={label}
      >
        <div
          className={clsx("h-full rounded-full transition-[width] duration-500 ease-out", toneOf(tone).bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-charcoal-600">
          {Math.round(pct)}%
        </span>
      )}
    </div>
  );
}

/**
 * One bar split into status segments. `total` defaults to the sum, so the bar
 * is full; pass a bigger total to leave an empty remainder.
 */
export function StackedProgress({ segments = [], total, height = "md", showLegend = false, className }) {
  const sum = segments.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const denom = Number(total) > 0 ? Number(total) : sum;
  return (
    <div className={className}>
      <div
        className={clsx("flex w-full overflow-hidden rounded-full bg-charcoal-100", HEIGHTS[height] || HEIGHTS.md)}
        role="img"
        aria-label={segments.map((s) => `${s.label ?? ""}: ${s.value}`).join(", ")}
      >
        {segments.map((s, i) => {
          const pct = pctOf(s.value, denom);
          if (pct <= 0) return null;
          return (
            <div
              key={s.label ?? i}
              className={clsx("h-full transition-[width] duration-500 ease-out", toneOf(s.tone).bar)}
              style={{ width: `${pct}%` }}
              title={s.label ? `${s.label}: ${s.value}` : undefined}
            />
          );
        })}
      </div>
      {showLegend && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal-600">
          {segments.map((s, i) => (
            <li key={s.label ?? i} className="inline-flex items-center gap-1.5">
              <span className={clsx("h-2 w-2 rounded-full", toneOf(s.tone).dot)} aria-hidden="true" />
              {s.label}
              <span className="font-semibold tabular-nums text-charcoal-800">{s.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
