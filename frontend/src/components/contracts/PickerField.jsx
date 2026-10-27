import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import clsx from "clsx";

const MAX_SHOWN = 60;

/**
 * Searchable single-choice picker built on a plain text input + a list that
 * opens right under it (in the normal flow, so it never gets clipped by a
 * scrolling dialog). No dependencies.
 *
 * options: [{ value, label, hint?, group?, search? }]  — `group` is a heading
 * shown whenever it changes between neighbouring options, so the caller
 * controls the order (e.g. "assigned to this partner" first).
 */
export default function PickerField({
  label,
  value,
  onChange,
  options,
  placeholder = "Начните вводить…",
  required,
  disabled,
  error,
  hint,
  emptyText = "Ничего не найдено",
  loading = false,
  inputRef,
}) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const wrapRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value ?? "")) || null,
    [options, value],
  );

  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.hint || ""} ${o.search || ""}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [options, query]);

  const shown = filtered.slice(0, MAX_SHOWN);

  // Keep the keyboard-highlighted option inside the scrolling list.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${uid}-opt-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, uid]);

  function pick(opt) {
    onChange(opt ? String(opt.value) : "");
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === "Escape" && open) {
      // Close the list first; a second Esc then reaches the dialog.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery("");
    }
  }

  function onBlur(e) {
    if (!wrapRef.current?.contains(e.relatedTarget)) {
      setOpen(false);
      setQuery("");
    }
  }

  const display = open ? query : selected?.label || "";
  let lastGroup = null;

  return (
    <div ref={wrapRef} onBlur={onBlur}>
      <label className="label" htmlFor={inputId}>
        {label}
        {required && (
          <span className="ml-0.5 text-coral-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <div className="relative">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${uid}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          autoComplete="off"
          className={clsx("input pr-16", error && "input-error")}
          placeholder={loading ? "Загрузка списка…" : selected ? selected.label : placeholder}
          value={display}
          disabled={disabled}
          // Not on focus: a dialog focuses its first field when it opens, and a list
          // popping open by itself would cover the form. Click / typing / ↓ open it.
          onClick={() => {
            setOpen(true);
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
          {selected && !disabled && (
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-lg text-charcoal-400 hover:bg-charcoal-100 hover:text-charcoal-700"
              aria-label={`Очистить: ${label}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(null)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <ChevronDown className="pointer-events-none h-4 w-4 text-charcoal-400" aria-hidden="true" />
        </div>
      </div>

      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-charcoal-200 bg-white p-1 shadow-soft"
        >
          {shown.length === 0 && (
            <li className="px-3 py-3 text-sm text-charcoal-500">{loading ? "Загрузка…" : emptyText}</li>
          )}
          {shown.map((o, i) => {
            const heading = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group || lastGroup;
            const isSel = selected && String(selected.value) === String(o.value);
            return (
              <li key={o.value} role="presentation">
                {heading && (
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-charcoal-400">
                    {heading}
                  </div>
                )}
                <div
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={!!isSel}
                  // mousedown (not click) + preventDefault keeps focus in the input
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={clsx(
                    "flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm sm:min-h-0",
                    i === active ? "bg-coral-50 text-charcoal-900" : "text-charcoal-700",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint && <span className="block truncate text-xs text-charcoal-500">{o.hint}</span>}
                  </span>
                  {isSel && <Check className="h-4 w-4 shrink-0 text-coral-600" aria-hidden="true" />}
                </div>
              </li>
            );
          })}
          {filtered.length > MAX_SHOWN && (
            <li className="px-3 py-2 text-xs text-charcoal-500">
              Показаны первые {MAX_SHOWN} из {filtered.length} — уточните запрос
            </li>
          )}
        </ul>
      )}

      {error ? (
        <div className="mt-1 text-xs text-red-600">{error}</div>
      ) : (
        hint && <div className="mt-1 text-xs text-charcoal-500">{hint}</div>
      )}
    </div>
  );
}
