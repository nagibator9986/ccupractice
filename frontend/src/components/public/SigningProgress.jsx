import { Check, Clock, Eye } from "lucide-react";
import clsx from "clsx";
import ProgressBar from "../ProgressBar.jsx";
import { toneOf } from "../../utils/tones.js";
import { formatDateTime } from "../../utils/format.js";

const STEPS = [
  { role: "college", label: "Колледж" },
  { role: "partner", label: "Предприятие" },
  { role: "student", label: "Студент" },
];

const STATUS_META = {
  signed: { label: "Подписано", Icon: Check, tone: "emerald" },
  viewed: { label: "Просмотрено", Icon: Eye, tone: "amber" },
  pending: { label: "Ожидает", Icon: Clock, tone: "slate" },
};

/** Backend row status -> the three states a signer cares about. */
export function partyStatus(item) {
  if (item?.status === "signed") return "signed";
  if (item?.status === "viewed") return "viewed";
  return "pending"; // pending / revoked / no row yet
}

export function signedCount(signingState) {
  return STEPS.filter((s) => partyStatus(signingState?.[s.role]) === "signed").length;
}

export function stepLabel(role) {
  return STEPS.find((s) => s.role === role)?.label || role;
}

/** Three-step tracker: Колледж · Предприятие · Студент. `forceSigned` marks `myRole` signed right after submit. */
export default function SigningProgress({ signingState, myRole, forceSigned = false }) {
  const states = STEPS.map((s) => (forceSigned && s.role === myRole ? "signed" : partyStatus(signingState?.[s.role])));
  const done = states.filter((x) => x === "signed").length;
  return (
    <section className="card p-4 sm:p-5 mb-4 sm:mb-5" aria-label="Ход подписания">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h2 className="text-sm font-semibold text-charcoal-900">Ход подписания</h2>
        <span className="text-xs font-medium text-charcoal-500 tabular-nums">
          подписали {done} из {STEPS.length}
        </span>
      </div>
      <ProgressBar value={done} max={STEPS.length} tone="emerald" height="sm" label="Подписали сторон" />
      <ol className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
        {STEPS.map((s, i) => {
          const status = states[i];
          const meta = STATUS_META[status];
          const t = toneOf(meta.tone);
          const mine = s.role === myRole;
          const signedAt = signingState?.[s.role]?.signed_at;
          return (
            <li
              key={s.role}
              className={clsx(
                "min-w-0 rounded-xl border p-2.5 sm:p-3",
                mine ? "border-coral-300 bg-coral-50/50" : "border-charcoal-100 bg-white",
              )}
            >
              <div className="text-xs sm:text-sm font-semibold leading-tight text-charcoal-900 break-words">{s.label}</div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className={clsx("h-5 w-5 shrink-0 grid place-items-center rounded-full", t.soft)} aria-hidden="true">
                  <meta.Icon className="h-3 w-3" />
                </span>
                <span className="text-xs font-medium text-charcoal-700">{meta.label}</span>
              </div>
              {status === "signed" && signedAt && (
                <div className="mt-0.5 text-[11px] leading-snug text-charcoal-500">{formatDateTime(signedAt)}</div>
              )}
              {mine && <span className="chip mt-1.5 !text-[10px] !px-2 !py-0.5">это вы</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
