import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Skeleton } from "../Skeleton.jsx";
import { GROUP_NONE, groupLabelOf, groupParamOf } from "./studentUtils.js";

/** green = every student has a contract, amber = some do, grey = none yet. */
export function groupHealth(g) {
  if (g.students > 0 && g.without_contract === 0) return "ok";
  if (g.contracts > 0) return "partial";
  return "none";
}

const DOT = { ok: "bg-emerald-500", partial: "bg-amber-400", none: "bg-charcoal-300" };
const HEALTH_TEXT = {
  ok: "у всех есть договор",
  partial: "часть студентов без договора",
  none: "договоров ещё нет",
};

/**
 * Horizontally scrollable group chips. `value` is the URL `group` param
 * ("" = все, "__none__" = без группы, otherwise the group name).
 */
export default function GroupStrip({ groups = [], value = "", onChange, loading = false }) {
  const listRef = useRef(null);
  const total = groups.reduce((a, g) => a + (g.students || 0), 0);
  const known = groups.some((g) => groupParamOf(g.name) === value);

  // Keep the active chip visible inside the strip (scroll the strip, not the page).
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector('[aria-pressed="true"]');
    if (!list || !el) return;
    const left = el.offsetLeft - 12;
    const right = el.offsetLeft + el.offsetWidth + 12;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [value, groups.length]);

  if (loading && groups.length === 0) {
    return (
      <div className="mb-3 flex gap-2 overflow-hidden" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-28 shrink-0 rounded-full" />
        ))}
      </div>
    );
  }
  if (groups.length === 0) return null;

  return (
    <div
      ref={listRef}
      role="group"
      aria-label="Группы"
      className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto overscroll-x-contain px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <Chip active={value === ""} onClick={() => onChange("")}>
        Все <span className="tabular-nums opacity-80">({total})</span>
      </Chip>
      {groups.map((g) => {
        const param = groupParamOf(g.name);
        const health = groupHealth(g);
        return (
          <Chip key={param} active={value === param} onClick={() => onChange(param)}>
            <span className={clsx("h-2 w-2 shrink-0 rounded-full", DOT[health])} aria-hidden="true" />
            {groupLabelOf(g.name)}
            <span className="tabular-nums opacity-80">· {g.students}</span>
            <span className="sr-only"> ({HEALTH_TEXT[health]})</span>
          </Chip>
        );
      })}
      {value && value !== GROUP_NONE && !known && (
        <Chip active onClick={() => onChange(value)}>
          {value}
        </Chip>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition sm:min-h-[36px]",
        active
          ? "bg-coral-500 text-white shadow-sm"
          : "bg-white text-charcoal-700 ring-1 ring-charcoal-200 hover:bg-charcoal-50 hover:ring-charcoal-300",
      )}
    >
      {children}
    </button>
  );
}
