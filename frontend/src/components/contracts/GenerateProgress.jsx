import { Link } from "react-router-dom";
import { CircleAlert, Loader2 } from "lucide-react";
import ProgressBar from "../ProgressBar.jsx";
import { plural } from "../../utils/format.js";

// ≈ seconds per contract (DOCX render + LibreOffice → PDF).
const SECONDS_PER_CONTRACT = 4;

function etaText(left) {
  const sec = left * SECONDS_PER_CONTRACT;
  if (sec < 45) return "меньше минуты";
  const min = Math.round(sec / 60);
  return `около ${min} ${plural(min, "минуты", "минут", "минут")}`;
}

/**
 * Failures of the generation queue: [{ id, number, name, reason, missing[] }].
 * Each row links to the contract, where the readiness card shows what to fix.
 */
export function FailureList({ failures = [], maxHeight = "max-h-56" }) {
  if (failures.length === 0) return null;
  return (
    <div className="rounded-xl ring-1 ring-red-200">
      <div className="flex items-center gap-2 rounded-t-xl bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-800">
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
        Не удалось сформировать: {failures.length}
      </div>
      <ul className={`${maxHeight} divide-y divide-red-100 overflow-y-auto px-3.5`}>
        {failures.map((f) => (
          <li key={f.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <Link to={`/contracts/${f.id}`} target="_blank" rel="noreferrer" className="link font-semibold">
                {f.number ? `№ ${f.number}` : `Договор ${f.id}`}
              </Link>
              <span className="text-charcoal-800">{f.name}</span>
            </div>
            <div className="text-xs text-red-700">
              {f.reason}
              {f.missing?.length > 0 && <>: {f.missing.join(", ")}</>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Single progress block of the sequential generation: bar, «k из N», the name
 * being processed right now and the failures collected so far.
 */
export default function GenerateProgress({ done = 0, total = 0, current = null, failures = [], running = true, title }) {
  const left = Math.max(total - done, 0);
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-charcoal-800">
            {title || "Формируем документы"}: {done} из {total}
          </div>
          {running && left > 0 && (
            <div className="text-xs text-charcoal-500">Осталось {etaText(left)}</div>
          )}
        </div>
        <ProgressBar value={done} max={Math.max(total, 1)} tone="coral" height="lg" label="Прогресс формирования договоров" />
      </div>

      {running && current && (
        <div className="flex items-center gap-2 rounded-xl bg-charcoal-50 px-3.5 py-2.5 text-sm text-charcoal-700" aria-live="polite">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-coral-500" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Сейчас: <span className="font-medium">{current.name}</span>
            {current.number ? <span className="text-charcoal-500"> · № {current.number}</span> : null}
          </span>
        </div>
      )}

      <FailureList failures={failures} />
    </div>
  );
}
