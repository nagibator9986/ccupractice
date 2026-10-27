import { useEffect, useRef } from "react";
import clsx from "clsx";
import renderIcon from "../utils/renderIcon.js";

const SIZES = {
  sm: "min-h-[36px] px-3 text-xs gap-1.5",
  md: "min-h-[44px] sm:min-h-[38px] px-3.5 text-sm gap-2",
};

/**
 * Segmented / pill tabs. Roving tabindex + arrow keys per the ARIA tabs
 * pattern. Panels are the caller's job; pass `ariaLabel` to name the tablist.
 */
export default function Tabs({ options = [], value, onChange, size = "md", className, ariaLabel }) {
  const listRef = useRef(null);

  // Keep the active pill visible inside the horizontally scrollable strip. We
  // scroll the strip itself (not scrollIntoView) so mounting never yanks the
  // whole page.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector('[aria-selected="true"]');
    if (!list || !el) return;
    const left = el.offsetLeft - 8;
    const right = el.offsetLeft + el.offsetWidth + 8;
    if (left < list.scrollLeft) list.scrollLeft = left;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
  }, [value]);

  function onKeyDown(e) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key) || options.length === 0) return;
    e.preventDefault();
    const cur = Math.max(0, options.findIndex((o) => o.value === value));
    let next = cur;
    if (e.key === "ArrowRight") next = (cur + 1) % options.length;
    if (e.key === "ArrowLeft") next = (cur - 1 + options.length) % options.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = options.length - 1;
    onChange(options[next].value);
    // Move DOM focus with the selection (automatic activation).
    requestAnimationFrame(() => listRef.current?.querySelectorAll('[role="tab"]')[next]?.focus());
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={clsx(
        "no-scrollbar max-w-full overflow-x-auto overscroll-x-contain",
        // p-1 on the scroller leaves room so the focus outline isn't clipped.
        "inline-flex gap-1 rounded-xl bg-charcoal-100/70 p-1",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={clsx(
              "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium transition",
              SIZES[size] || SIZES.md,
              active
                ? "bg-white text-charcoal-900 shadow-sm ring-1 ring-charcoal-200/70"
                : "text-charcoal-600 hover:text-charcoal-900 hover:bg-white/60",
            )}
          >
            {o.icon && renderIcon(o.icon, { className: "h-4 w-4 shrink-0", "aria-hidden": true })}
            {o.label}
            {o.count != null && (
              <span
                className={clsx(
                  "rounded-full px-1.5 min-w-[1.25rem] text-center text-[11px] font-semibold tabular-nums leading-5",
                  active ? "bg-coral-100 text-coral-700" : "bg-charcoal-200/70 text-charcoal-600",
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
