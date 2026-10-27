import { Link } from "react-router-dom";
import { CircleAlert, CircleCheck, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import { SCOPE_TITLE, readinessLink } from "./contractFlow.js";

function MissingRow({ m, newTab }) {
  const to = readinessLink(m);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="chip !bg-white !text-charcoal-600 !ring-charcoal-200">{SCOPE_TITLE[m.scope] || m.scope}</span>
      <span className="min-w-0 flex-1 text-sm text-charcoal-800">{m.label}</span>
      {to ? (
        <Link
          to={to}
          target={newTab ? "_blank" : undefined}
          rel={newTab ? "noreferrer" : undefined}
          className="link inline-flex items-center gap-1 text-sm font-semibold"
        >
          Исправить
          {newTab && <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />}
        </Link>
      ) : (
        <span className="text-xs text-charcoal-500">нет записи</span>
      )}
    </li>
  );
}

/**
 * What is still missing before the contract can be generated.
 * critical (red, always open) vs recommended (amber, collapsed).
 * readiness = { ok, critical, recommended, missing: [{scope, field, label, severity, entity_id}] }.
 * `newTab`: open the fix links in a new tab (use inside dialogs).
 */
export default function ReadinessChecklist({ readiness, newTab = false, onRecheck, rechecking = false, className }) {
  if (!readiness) return null;
  const missing = readiness.missing || [];
  const critical = missing.filter((m) => m.severity === "critical");
  const recommended = missing.filter((m) => m.severity !== "critical");

  if (critical.length === 0 && recommended.length === 0) {
    return (
      <div
        className={clsx(
          "flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200",
          className,
        )}
      >
        <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        Все данные для договора заполнены.
      </div>
    );
  }

  return (
    <div className={clsx("space-y-3", className)}>
      {critical.length > 0 ? (
        <div className="rounded-xl bg-red-50/70 px-3.5 py-3 ring-1 ring-red-200" role="alert">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-red-800">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              Не хватает обязательных данных ({critical.length}) — без них договор не сформируется
            </span>
            {onRecheck && (
              <button type="button" className="btn-ghost btn-sm max-sm:min-h-[44px]" onClick={onRecheck} disabled={rechecking}>
                <RefreshCw className={clsx("h-3.5 w-3.5", rechecking && "animate-spin")} aria-hidden="true" />
                Проверить снова
              </button>
            )}
          </div>
          <ul className="mt-1 divide-y divide-red-100">
            {critical.map((m) => (
              <MissingRow key={`${m.scope}-${m.field}`} m={m} newTab={newTab} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
          <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">Все обязательные данные заполнены.</span>
          {onRecheck && (
            <button type="button" className="btn-ghost btn-sm max-sm:min-h-[44px]" onClick={onRecheck} disabled={rechecking}>
              <RefreshCw className={clsx("h-3.5 w-3.5", rechecking && "animate-spin")} aria-hidden="true" />
              Проверить снова
            </button>
          )}
        </div>
      )}

      {recommended.length > 0 && (
        <details className="group rounded-xl bg-amber-50/70 ring-1 ring-amber-200">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 text-sm font-medium text-amber-900 [&::-webkit-details-marker]:hidden">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              Желательно заполнить ({recommended.length}) — это попадёт в текст договора
            </span>
            <span className="text-xs text-amber-700 group-open:hidden">показать</span>
            <span className="hidden text-xs text-amber-700 group-open:inline">скрыть</span>
          </summary>
          <ul className="divide-y divide-amber-100 px-3.5 pb-2">
            {recommended.map((m) => (
              <MissingRow key={`${m.scope}-${m.field}`} m={m} newTab={newTab} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
