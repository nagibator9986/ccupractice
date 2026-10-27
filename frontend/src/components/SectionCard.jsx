import clsx from "clsx";
import { toneOf } from "../utils/tones.js";
import renderIcon from "../utils/renderIcon.js";

/**
 * Card with a header row. `padded={false}` is for tables / lists that should
 * run edge to edge (content is then clipped to the rounded corners).
 * `tone` tints the icon and ring — e.g. tone="red" for a danger zone.
 */
export default function SectionCard({
  title,
  icon,
  description,
  actions,
  children,
  className,
  padded = true,
  tone,
}) {
  const t = tone ? toneOf(tone) : null;
  const hasHeader = title || icon || description || actions;
  return (
    <section className={clsx("card", !padded && "overflow-hidden", t && ["ring-1", t.ring], className)}>
      {hasHeader && (
        <header
          className={clsx(
            "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 sm:px-5",
            padded ? "pt-4 sm:pt-5" : "py-3.5 border-b border-charcoal-100",
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <span
                className={clsx("h-9 w-9 shrink-0 grid place-items-center rounded-xl", toneOf(tone || "coral").soft)}
                aria-hidden="true"
              >
                {renderIcon(icon, { className: "h-[18px] w-[18px]" })}
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold leading-snug text-charcoal-900">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-charcoal-500">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {padded ? (
        <div className={clsx("px-4 sm:px-5 pb-4 sm:pb-5", hasHeader ? "pt-4" : "pt-4 sm:pt-5")}>{children}</div>
      ) : (
        children
      )}
    </section>
  );
}
