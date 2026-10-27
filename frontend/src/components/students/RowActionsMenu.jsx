import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import clsx from "clsx";

const MENU_W = 248;

/**
 * Compact «…» menu for a table row / card. The popup is portalled to <body> and
 * positioned with `fixed`, so it is never clipped by the table's scroll box.
 * items: [{ key, label, icon: LucideComponent, onClick, tone?: "danger", disabled? }]
 */
export default function RowActionsMenu({ items = [], label = "Другие действия" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) btnRef.current?.focus();
  }

  function toggle() {
    if (open) return close(false);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const estH = items.length * 40 + 16;
    const below = window.innerHeight - r.bottom;
    const top = below < estH + 12 && r.top > estH ? r.top - estH - 4 : r.bottom + 4;
    const left = Math.min(Math.max(8, r.right - MENU_W), Math.max(8, window.innerWidth - MENU_W - 8));
    setPos({ top, left });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onMove = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the first enabled item when the menu opens.
  useLayoutEffect(() => {
    if (open) menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
  }, [open]);

  function onMenuKey(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const nodes = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') || []);
    if (!nodes.length) return;
    const i = nodes.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (i + 1) % nodes.length : (i - 1 + nodes.length) % nodes.length;
    nodes[next].focus();
  }

  if (!items.length) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn-ghost btn-icon btn-sm"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Ellipsis className="h-4 w-4" aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W }}
            className="z-[60] rounded-xl bg-white p-1.5 shadow-soft ring-1 ring-charcoal-200"
          >
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    close(false);
                    it.onClick?.();
                  }}
                  className={clsx(
                    "flex min-h-[40px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-coral-400",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    it.tone === "danger"
                      ? "text-red-600 hover:bg-red-50"
                      : "text-charcoal-700 hover:bg-charcoal-50",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  {it.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
