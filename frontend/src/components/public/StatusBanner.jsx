import clsx from "clsx";
import { toneOf } from "../../utils/tones.js";
import renderIcon from "../../utils/renderIcon.js";

/**
 * One calm status card used for every state of the signing link
 * (ready / signed / expired / revoked / invalid / error).
 * `role="alert"` for problems, `role="status"` for everything else.
 */
export default function StatusBanner({ tone = "coral", icon, title, children, actions, role = "status", className }) {
  const t = toneOf(tone);
  return (
    <div role={role} className={clsx("card flex gap-3 sm:gap-4 p-4 sm:p-5 ring-1", t.ring, className)}>
      <span
        className={clsx("h-10 w-10 sm:h-11 sm:w-11 shrink-0 grid place-items-center rounded-xl", t.soft)}
        aria-hidden="true"
      >
        {renderIcon(icon, { className: "h-5 w-5 sm:h-6 sm:w-6" })}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-serif text-lg sm:text-xl font-bold text-charcoal-900 leading-snug">{title}</h2>
        {children && <div className="mt-1 text-sm text-charcoal-600 leading-relaxed">{children}</div>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
