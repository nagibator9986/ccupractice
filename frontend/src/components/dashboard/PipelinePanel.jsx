import { Link } from "react-router-dom";
import { CircleCheck, FileText, Hourglass, Send } from "lucide-react";
import clsx from "clsx";
import SectionCard from "../SectionCard.jsx";
import { StackedProgress } from "../ProgressBar.jsx";
import { CONTRACT_STATUS_META, plural } from "../../utils/format.js";
import { toneOf } from "../../utils/tones.js";

const STATUS_ORDER = ["draft", "generated", "sent", "signed", "scan_uploaded", "completed"];

// next_action -> what the clerk does about it. Order = order of the workflow.
const ACTIONS = [
  { key: "generate", label: "Сформировать", hint: "договор создан, файла ещё нет", Icon: FileText, tone: "blue" },
  { key: "invite", label: "Отправить на подпись", hint: "файл готов, ссылки не отправлены", Icon: Send, tone: "indigo" },
  { key: "await_signatures", label: "Ждём подписи", hint: "ссылки у подписантов", Icon: Hourglass, tone: "amber" },
  { key: "complete", label: "Завершить", hint: "все подписали — осталось закрыть", Icon: CircleCheck, tone: "emerald" },
];

/** Contracts by status (stacked bar + clickable legend) and by the next step to take. */
export default function PipelinePanel({ byStatus = {}, byAction = {} }) {
  const total = STATUS_ORDER.reduce((a, s) => a + (Number(byStatus[s]) || 0), 0);
  const segments = STATUS_ORDER.map((s) => ({
    label: CONTRACT_STATUS_META[s].label,
    value: Number(byStatus[s]) || 0,
    tone: CONTRACT_STATUS_META[s].tone,
  }));
  const done = Number(byAction.done) || 0;

  return (
    <SectionCard
      title="Договоры по этапам"
      description={total ? `Всего ${total} ${plural(total, "договор", "договора", "договоров")}` : "Договоров пока нет"}
      actions={
        <Link to="/contracts" className="link text-sm">
          Все договоры
        </Link>
      }
    >
      <StackedProgress segments={segments} height="lg" />
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
        {STATUS_ORDER.map((s, i) => {
          const meta = CONTRACT_STATUS_META[s];
          const n = segments[i].value;
          return (
            <li key={s}>
              <Link
                to={`/contracts?status=${s}`}
                className={clsx(
                  "flex min-h-[40px] items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-charcoal-50 sm:min-h-0",
                  n === 0 ? "text-charcoal-400" : "text-charcoal-700",
                )}
              >
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", toneOf(meta.tone).dot)} aria-hidden="true" />
                <span className="min-w-0 truncate">{meta.label}</span>
                <span className="ml-auto font-semibold tabular-nums text-charcoal-900">{n}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="divider my-4" />
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-500">Что делать дальше</h3>
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {ACTIONS.map(({ key, label, hint, Icon, tone }) => {
          const n = Number(byAction[key]) || 0;
          const t = toneOf(tone);
          return (
            <li key={key}>
              <Link
                to={`/contracts?stage=${key}`}
                className={clsx(
                  "block h-full rounded-xl border p-3 transition hover:shadow-soft",
                  n > 0 ? "border-charcoal-200 bg-white hover:border-coral-300" : "border-charcoal-100 bg-charcoal-50/50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={clsx("grid h-7 w-7 place-items-center rounded-lg", n > 0 ? t.soft : "bg-charcoal-50 text-charcoal-400")} aria-hidden="true">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={clsx("text-2xl font-bold tabular-nums leading-none", n > 0 ? "text-charcoal-900" : "text-charcoal-300")}>{n}</span>
                </div>
                <div className="mt-2 text-sm font-semibold text-charcoal-800">{label}</div>
                <div className="text-[11px] leading-snug text-charcoal-500">{hint}</div>
              </Link>
            </li>
          );
        })}
      </ul>
      {done > 0 && (
        <p className="mt-2 text-xs text-charcoal-500">
          Уже завершено: <span className="font-semibold text-charcoal-700">{done}</span>
        </p>
      )}
    </SectionCard>
  );
}
