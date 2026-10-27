import { useEffect, useId, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import clsx from "clsx";

/**
 * Small dropdown menu ("…"). items: [{ key, label, icon, onClick, href, danger,
 * disabled, hidden, divider }]. Closes on outside click, Esc and after a pick.
 */
export default function MenuButton({
  items = [],
  label = "Ещё действия",
  text,
  icon: Icon = Ellipsis,
  className = "btn-secondary btn-sm btn-icon",
  align = "right",
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        // Keep Esc from also closing a dialog this menu lives in.
        e.stopPropagation();
        setOpen(false);
        rootRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    // Focus the first enabled item so the menu is usable from the keyboard.
    rootRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (visible.length === 0) return null;

  function onMenuKeyDown(e) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const nodes = Array.from(rootRef.current.querySelectorAll('[role="menuitem"]:not([disabled])'));
    if (nodes.length === 0) return;
    const i = nodes.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (i + 1) % nodes.length : (i - 1 + nodes.length) % nodes.length;
    nodes[next].focus();
  }

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        className={className}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={text ? undefined : label}
        title={text ? undefined : label}
        disabled={disabled}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {text}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className={clsx(
            "absolute top-full z-30 mt-1 min-w-[13rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-1 shadow-soft ring-1 ring-charcoal-200",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {visible.map((it, idx) => {
            const ItemIcon = it.icon;
            const cls = clsx(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 sm:py-2 text-left text-sm transition",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              it.danger ? "text-red-600 hover:bg-red-50" : "text-charcoal-700 hover:bg-charcoal-50",
            );
            const body = (
              <>
                {ItemIcon && <ItemIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span className="min-w-0">{it.label}</span>
              </>
            );
            return (
              <div key={it.key ?? idx}>
                {it.divider && idx > 0 && <div className="my-1 h-px bg-charcoal-100" role="separator" />}
                {it.href ? (
                  <a
                    role="menuitem"
                    className={cls}
                    href={it.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpen(false)}
                  >
                    {body}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className={cls}
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(false);
                      it.onClick?.();
                    }}
                  >
                    {body}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
