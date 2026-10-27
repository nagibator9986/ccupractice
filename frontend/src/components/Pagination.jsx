import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";

// 1 … 4 5 6 … 20 — always first, last and a window around the current page.
function pageList(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(totalPages - 1, page + 1);
  if (from > 2) out.push("gap-l");
  for (let p = from; p <= to; p += 1) out.push(p);
  if (to < totalPages - 1) out.push("gap-r");
  out.push(totalPages);
  return out;
}

const NAV_BTN =
  "h-9 min-w-9 sm:h-8 sm:min-w-8 px-2 grid place-items-center rounded-lg text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed";

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
  pageSizes = [25, 50, 100],
}) {
  // Nothing to paginate when everything fits on the smallest page.
  if (!total || total <= Math.min(...pageSizes)) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label="Постраничная навигация"
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-1 py-3 text-sm text-charcoal-600"
    >
      <div className="flex items-center justify-between sm:justify-start gap-4">
        <span className="tabular-nums" aria-live="polite">
          {start}–{end} из {total}
        </span>
        {onPageSize && (
          <label className="flex items-center gap-2 text-xs text-charcoal-500">
            <span className="hidden sm:inline">На странице</span>
            <select
              className="input input-sm !w-auto"
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              aria-label="Строк на странице"
            >
              {pageSizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex items-center justify-center sm:justify-end gap-1">
        <button
          type="button"
          className={clsx(NAV_BTN, "text-charcoal-600 hover:bg-charcoal-100")}
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Предыдущая страница"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {pageList(page, totalPages).map((p) =>
          typeof p === "string" ? (
            <span key={p} className="px-1 text-charcoal-400 select-none" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPage(p)}
              aria-label={`Страница ${p}`}
              aria-current={p === page ? "page" : undefined}
              className={clsx(
                NAV_BTN,
                "tabular-nums",
                p === page
                  ? "bg-coral-500 text-white shadow-sm"
                  : "text-charcoal-600 hover:bg-charcoal-100",
              )}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className={clsx(NAV_BTN, "text-charcoal-600 hover:bg-charcoal-100")}
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Следующая страница"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

export default Pagination;
