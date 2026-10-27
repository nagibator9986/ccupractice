import { useEffect, useRef, useState } from "react";
import { CircleCheck, Clock } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { useConfirm } from "../ConfirmDialog.jsx";
import { plural } from "../../utils/format.js";
import GenerateProgress, { FailureList } from "./GenerateProgress.jsx";
import { runGenerateQueue } from "./bulkOps.js";

const INITIAL = { done: 0, total: 0, current: null, failures: [] };

/**
 * «Сформировать» for the contracts ticked in the list: one contract at a time
 * (each takes a few seconds), a single progress bar, the failures listed with
 * what is missing. The user starts it explicitly — it can take minutes.
 *
 * contracts: [{ id, number, name }] — only those that still need a document.
 */
export default function BulkGenerateModal({ open, contracts = [], skippedCount = 0, onClose, onDone }) {
  const confirm = useConfirm();
  const [phase, setPhase] = useState("ready"); // ready | running | done
  const [progress, setProgress] = useState(INITIAL);
  const [summary, setSummary] = useState({ generated: 0, cancelled: false, remaining: 0 });
  const stopRef = useRef(false);
  const generatedRef = useRef(0);

  useEffect(() => {
    if (open) {
      setPhase("ready");
      setProgress(INITIAL);
      setSummary({ generated: 0, cancelled: false, remaining: 0 });
      stopRef.current = false;
      generatedRef.current = 0;
    }
  }, [open]);

  // A reload / tab close mid-run would leave a half-generated batch.
  useEffect(() => {
    if (phase !== "running") return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  async function run(items) {
    stopRef.current = false;
    setPhase("running");
    setProgress({ ...INITIAL, total: items.length, current: items[0] || null });
    const res = await runGenerateQueue(items, {
      shouldStop: () => stopRef.current,
      onProgress: (p) => setProgress(p),
    });
    generatedRef.current += res.generated.length;
    setProgress((p) => ({ ...p, current: null, failures: res.failures }));
    setSummary({ generated: generatedRef.current, cancelled: res.cancelled, remaining: res.remaining });
    setPhase("done");
    if (generatedRef.current > 0) onDone?.({ generated: generatedRef.current });
    if (res.generated.length > 0 && res.failures.length === 0 && !res.cancelled) {
      toast.success(`Сформировано договоров: ${res.generated.length}`);
    }
  }

  async function requestClose() {
    if (phase === "running") {
      const ok = await confirm({
        title: "Остановить формирование?",
        message:
          "Уже готовые договоры останутся. Текущий договор будет дособран, затем покажем итоги — остальные можно сформировать позже.",
        confirmText: "Остановить",
        cancelText: "Продолжить",
        tone: "danger",
      });
      if (ok) stopRef.current = true;
      return;
    }
    onClose?.();
  }

  const total = contracts.length;
  const failed = progress.failures;

  let footer;
  if (phase === "ready") {
    footer = (
      <>
        <button type="button" className="btn-secondary" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn-primary" onClick={() => run(contracts)} disabled={total === 0} data-autofocus>
          Сформировать {total} {plural(total, "договор", "договора", "договоров")}
        </button>
      </>
    );
  } else if (phase === "running") {
    footer = (
      <button type="button" className="btn-secondary" onClick={requestClose}>
        Остановить
      </button>
    );
  } else {
    footer = (
      <>
        {failed.length > 0 && (
          <button type="button" className="btn-secondary" onClick={() => run(failed.map((f) => ({ id: f.id, number: f.number, name: f.name })))}>
            Повторить для {failed.length}
          </button>
        )}
        <button type="button" className="btn-primary" onClick={onClose} data-autofocus>
          Готово
        </button>
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title="Формирование договоров"
      description={phase === "ready" ? "Для каждого договора создаётся файл Word и PDF." : undefined}
      size="md"
      footer={footer}
    >
      {phase === "ready" && (
        <div className="space-y-3 text-sm text-charcoal-700">
          <p>
            Будет сформировано <b>{total}</b> {plural(total, "договор", "договора", "договоров")}.
          </p>
          <p className="flex gap-2 rounded-xl bg-charcoal-50 px-3.5 py-3">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-charcoal-500" aria-hidden="true" />
            <span>
              Каждый договор собирается 3–5 секунд, поэтому окно нужно держать открытым. Если у кого-то не хватает данных, договор
              пропустится и попадёт в список ошибок — остальные продолжатся.
            </span>
          </p>
          {skippedCount > 0 && (
            <p className="text-xs text-charcoal-500">
              Ещё {skippedCount} из выбранных не затрагиваются: у них документ уже сформирован.
            </p>
          )}
        </div>
      )}

      {phase === "running" && (
        <GenerateProgress done={progress.done} total={progress.total} current={progress.current} failures={progress.failures} running />
      )}

      {phase === "done" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <div className="font-semibold">Сформировано: {summary.generated}</div>
              {summary.cancelled && (
                <div className="text-xs">
                  Остановлено вручную — не обработано: {summary.remaining}. Их можно сформировать позже из списка договоров.
                </div>
              )}
            </div>
          </div>
          <FailureList failures={failed} />
        </div>
      )}
    </Modal>
  );
}
