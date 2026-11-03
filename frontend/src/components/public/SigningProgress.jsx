import { Check, Clock, Eye, FileSearch, FileUp, FileX } from "lucide-react";
import clsx from "clsx";
import ProgressBar from "../ProgressBar.jsx";
import { toneOf } from "../../utils/tones.js";
import { formatDateTime } from "../../utils/format.js";
import { shortLabel, utcIso } from "./scanUtils.js";

const STEPS = [
  { role: "college", label: "Колледж" },
  { role: "partner", label: "Предприятие" },
  { role: "student", label: "Студент" },
];

const STATUS_META = {
  signed: { label: "Подписано", Icon: Check, tone: "emerald" },
  viewed: { label: "Просмотрено", Icon: Eye, tone: "amber" },
  pending: { label: "Ожидает", Icon: Clock, tone: "slate" },
  // Signing on paper: the scan is not a signature until the college has accepted it.
  scan_wait: { label: "Ждём скан", Icon: FileUp, tone: "slate" },
  scan_pending: { label: "Скан на проверке", Icon: FileSearch, tone: "blue" },
  scan_rejected: { label: "Нужен новый скан", Icon: FileX, tone: "amber" },
};

/** Backend row status -> the three states a signer cares about. */
export function partyStatus(item) {
  if (item?.status === "signed") return "signed";
  if (item?.status === "viewed") return "viewed";
  return "pending"; // pending / revoked / no row yet
}

/** Richer view of one party for the tracker: adds the paper-scan states. */
export function partyView(item, forceSigned = false) {
  if (forceSigned || item?.status === "signed") return "signed";
  if (item?.scan_review === "pending") return "scan_pending";
  if (item?.scan_review === "rejected") return "scan_rejected";
  if (item?.method === "scan" && (item?.status === "pending" || item?.status === "viewed")) return "scan_wait";
  return partyStatus(item);
}

export function signedCount(signingState) {
  return STEPS.filter((s) => partyStatus(signingState?.[s.role]) === "signed").length;
}

/** Name of a party: the backend's capacity-aware label when known («Законный представитель…»), else the static one. */
export function stepLabel(role, signingState) {
  const fromServer = shortLabel(signingState?.[role]?.label);
  return fromServer || STEPS.find((s) => s.role === role)?.label || role;
}

/** Three-step tracker: Колледж · Предприятие · Студент (or his representative). `forceSigned` marks `myRole` signed right after submit. */
export default function SigningProgress({ signingState, myRole, forceSigned = false }) {
  const views = STEPS.map((s) => partyView(signingState?.[s.role], forceSigned && s.role === myRole));
  const done = views.filter((x) => x === "signed").length;
  return (
    <section className="card p-4 sm:p-5 mb-4 sm:mb-5" aria-label="Ход подписания">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h2 className="text-sm font-semibold text-charcoal-900">Ход подписания</h2>
        <span className="text-xs font-medium text-charcoal-500 tabular-nums">
          подписали {done} из {STEPS.length}
        </span>
      </div>
      <ProgressBar value={done} max={STEPS.length} tone="emerald" height="sm" label="Подписали сторон" />
      <ol className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-3">
        {STEPS.map((s, i) => {
          const view = views[i];
          const meta = STATUS_META[view];
          const t = toneOf(meta.tone);
          const mine = s.role === myRole;
          const item = signingState?.[s.role];
          const signedAt = item?.signed_at;
          return (
            <li
              key={s.role}
              className={clsx(
                "min-w-0 rounded-xl border p-2 sm:p-3",
                mine ? "border-coral-300 bg-coral-50/50" : "border-charcoal-100 bg-white",
              )}
            >
              <div className="text-[11px] sm:text-sm font-semibold leading-tight text-charcoal-900 break-words" lang="ru">{stepLabel(s.role, signingState)}</div>
              <div className="mt-1.5 flex items-start gap-1.5">
                <span className={clsx("h-5 w-5 shrink-0 grid place-items-center rounded-full", t.soft)} aria-hidden="true">
                  <meta.Icon className="h-3 w-3" />
                </span>
                <span className="pt-0.5 text-xs font-medium leading-4 text-charcoal-700">{meta.label}</span>
              </div>
              {view === "signed" && signedAt && (
                <div className="mt-0.5 text-[11px] leading-snug text-charcoal-500">{formatDateTime(utcIso(signedAt))}</div>
              )}
              {view === "signed" && item?.method === "scan" && (
                <div className="text-[11px] leading-snug text-charcoal-500">на бумаге, по скану</div>
              )}
              {mine && <span className="chip mt-1.5 !text-[10px] !px-2 !py-0.5">это вы</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
