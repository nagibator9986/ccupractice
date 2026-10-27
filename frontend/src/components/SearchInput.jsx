import { Search, X } from "lucide-react";
import clsx from "clsx";

// type="text" (not "search"): the native search-cancel "x" differs per browser
// and would double up with our own clear button.
export default function SearchInput({ value, onChange, placeholder = "Поиск…", className, autoFocus }) {
  return (
    <div className={clsx("relative", className)}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400"
        aria-hidden="true"
      />
      <input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={autoFocus}
        className="input pl-10 pr-10"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            // Esc clears first; a second Esc then reaches any enclosing dialog.
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-lg text-charcoal-400 hover:text-charcoal-700 hover:bg-charcoal-100 transition"
          aria-label="Очистить поиск"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
