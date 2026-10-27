import { Link } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";

// backTo: "/route" or { to, label }.
function BackLink({ backTo }) {
  const { to, label = "Назад" } = typeof backTo === "string" ? { to: backTo } : backTo;
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-md pr-1 text-xs font-medium text-charcoal-500 hover:text-coral-600 transition"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Link>
  );
}

export default function PageHeader({ title, description, actions, eyebrow, breadcrumbs, backTo }) {
  const hasCrumbs = Array.isArray(breadcrumbs) && breadcrumbs.length > 0;
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 md:gap-4 mb-5 md:mb-6">
      <div className="min-w-0">
        {(backTo || hasCrumbs) && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {backTo && <BackLink backTo={backTo} />}
            {hasCrumbs && (
              <nav aria-label="Навигационная цепочка">
                <ol className="flex flex-wrap items-center gap-1 text-xs text-charcoal-500">
                  {breadcrumbs.map((c, i) => {
                    const last = i === breadcrumbs.length - 1;
                    return (
                      <li key={`${c.label}-${i}`} className="flex items-center gap-1">
                        {c.to && !last ? (
                          <Link to={c.to} className="rounded hover:text-coral-600 hover:underline underline-offset-2">
                            {c.label}
                          </Link>
                        ) : (
                          <span aria-current={last ? "page" : undefined} className={last ? "text-charcoal-700" : undefined}>
                            {c.label}
                          </span>
                        )}
                        {!last && <ChevronRight className="h-3 w-3 text-charcoal-300" aria-hidden="true" />}
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}
          </div>
        )}
        {eyebrow && <div className="chip mb-2">{eyebrow}</div>}
        <h1 className="font-serif text-2xl md:text-3xl font-bold text-charcoal-900 leading-tight">{title}</h1>
        {description && (
          <p className="text-sm text-charcoal-500 mt-1.5 max-w-3xl leading-relaxed">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
    </div>
  );
}
