import { Check } from "lucide-react";
import clsx from "clsx";
import renderIcon from "../utils/renderIcon.js";

/**
 * Horizontal stepper. A step is "done" (green check), "active" (coral) or
 * pending. On narrow screens the row scrolls instead of squashing labels.
 */
export default function Stepper({ steps = [], compact = false, className }) {
  return (
    <ol
      className={clsx("no-scrollbar flex items-start overflow-x-auto overscroll-x-contain pb-1", className)}
    >
      {steps.map((s, i) => (
        <StepItem key={s.key ?? i} step={s} index={i} last={i === steps.length - 1} compact={compact} />
      ))}
    </ol>
  );
}

function StepItem({ step, index, last, compact }) {
  const state = step.done ? "done" : step.active ? "active" : "todo";
  const size = compact ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  const dot = (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-full font-semibold transition-colors",
        size,
        state === "done" && "bg-emerald-500 text-white",
        state === "active" && "bg-coral-500 text-white ring-4 ring-coral-100",
        state === "todo" && "bg-white text-charcoal-400 ring-1 ring-charcoal-200",
      )}
      aria-hidden="true"
    >
      {state === "done" ? (
        <Check className={iconSize} strokeWidth={3} />
      ) : step.icon ? (
        renderIcon(step.icon, { className: iconSize })
      ) : (
        index + 1
      )}
    </span>
  );

  const connector = !last && (
    <span
      className={clsx(
        "mx-2 h-0.5 min-w-4 flex-1 rounded-full",
        step.done ? "bg-emerald-400" : "bg-charcoal-200",
      )}
      aria-hidden="true"
    />
  );

  const label = (
    <span
      className={clsx(
        "font-medium leading-tight",
        compact ? "text-xs" : "text-sm",
        state === "todo" ? "text-charcoal-500" : "text-charcoal-900",
      )}
    >
      {step.label}
    </span>
  );

  return (
    <li
      aria-current={state === "active" ? "step" : undefined}
      className={clsx(
        "flex",
        compact ? "items-center" : "flex-col",
        last ? "shrink-0" : "flex-1",
        // Non-compact keeps a floor width so labels don't collapse on phones; the row scrolls instead.
        !compact && (last ? "min-w-[7rem]" : "min-w-[9.5rem]"),
      )}
    >
      {compact ? (
        <>
          <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            {dot}
            {label}
          </span>
          {connector}
        </>
      ) : (
        <>
          <div className="flex items-center">
            {dot}
            {connector}
          </div>
          <div className="mt-2 pr-3">
            {label}
            {step.description && (
              <div className="mt-0.5 text-xs leading-snug text-charcoal-500">{step.description}</div>
            )}
          </div>
        </>
      )}
      <span className="sr-only">
        {state === "done" ? " (выполнено)" : state === "active" ? " (текущий шаг)" : ""}
      </span>
    </li>
  );
}
