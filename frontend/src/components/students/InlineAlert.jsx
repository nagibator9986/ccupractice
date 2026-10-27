import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import clsx from "clsx";

// Full class strings so Tailwind's JIT sees them.
const STYLES = {
  red: { box: "bg-red-50 text-red-800 ring-red-200", icon: "text-red-500", Icon: CircleAlert },
  amber: { box: "bg-amber-50 text-amber-900 ring-amber-200", icon: "text-amber-500", Icon: TriangleAlert },
  blue: { box: "bg-blue-50 text-blue-900 ring-blue-200", icon: "text-blue-500", Icon: Info },
  green: { box: "bg-emerald-50 text-emerald-900 ring-emerald-200", icon: "text-emerald-500", Icon: CircleCheck },
};

/**
 * Calm inline notice. `tone="red"` is announced as an alert; the others are
 * plain status text. Never colour-only: every tone has its own icon.
 */
export default function InlineAlert({ tone = "blue", title, children, actions, className, icon }) {
  const s = STYLES[tone] || STYLES.blue;
  const Icon = icon || s.Icon;
  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      className={clsx("flex gap-3 rounded-xl px-3.5 py-3 text-sm ring-1", s.box, className)}
    >
      <Icon className={clsx("mt-0.5 h-4 w-4 shrink-0", s.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold leading-snug">{title}</div>}
        {children && <div className={clsx("leading-relaxed", title && "mt-0.5")}>{children}</div>}
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
