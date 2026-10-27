import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../Modal.jsx";
import { CheckboxField } from "../Field.jsx";
import InlineAlert from "./InlineAlert.jsx";
import PracticeFields from "./PracticeFields.jsx";
import { errorText, partnersApi, studentsApi } from "../../api/endpoints.js";
import { plural } from "../../utils/format.js";
import { EMPTY_PRACTICE, cleanPractice, validatePractice } from "./studentUtils.js";

/**
 * «Назначить практику» — set partner / dates / supervisors for many students at
 * once. Target is either explicit `studentIds` or a whole `group` ("" = the
 * students without a group). Only the fields the operator filled in are sent,
 * so nothing is ever cleared by accident.
 *
 * After a successful call the dialog stays open in a result state so the
 * operator SEES how many students were changed (and which were skipped).
 */
export default function BulkPracticeModal(props) {
  if (!props.open) return null;
  return <BulkPracticeBody {...props} />;
}

function BulkPracticeBody({ onClose, onDone, studentIds, group, groupLabel, count }) {
  const [values, setValues] = useState({ ...EMPTY_PRACTICE });
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [partners, setPartners] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await partnersApi.list({ with_stats: 1 });
        if (alive) setPartners(r.items || []);
      } catch (e) {
        if (alive) {
          setPartners([]);
          toast.error(await errorText(e, "Не удалось загрузить список предприятий"));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const byIds = Array.isArray(studentIds) && studentIds.length > 0;
  const total = byIds ? studentIds.length : Number.isFinite(Number(count)) ? Number(count) : null;
  const subtitle = useMemo(() => {
    if (groupLabel) return `Для: ${groupLabel}`;
    if (byIds) return `Для: ${studentIds.length} ${plural(studentIds.length, "студента", "студентов", "студентов")}`;
    if (group === "") return "Для: студентов без группы";
    if (group) return `Для: группа ${group}`;
    return "";
  }, [groupLabel, byIds, studentIds, group]);

  const fields = cleanPractice(values, { course: false });
  const hasFields = Object.keys(fields).length > 0;
  const invalid = Object.keys(validatePractice(values)).length > 0;
  const hasTarget = byIds || group !== undefined;

  function patch(p) {
    setValues((prev) => ({ ...prev, ...p }));
  }

  async function submit() {
    if (busy || !hasFields || invalid || !hasTarget) return;
    setBusy(true);
    setError("");
    try {
      const body = { fields, only_empty: onlyEmpty };
      if (byIds) body.student_ids = studentIds;
      else body.group = group;
      const res = await studentsApi.bulkPractice(body);
      setResult(res);
      onDone?.(res);
    } catch (e) {
      setError(await errorText(e, "Не удалось назначить практику"));
    } finally {
      setBusy(false);
    }
  }

  const done = !!result;

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      title="Назначить практику"
      description={subtitle}
      size="lg"
      footer={
        done ? (
          <button type="button" className="btn-primary" onClick={onClose} data-autofocus>
            Готово
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Отмена
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={busy || !hasFields || invalid || !hasTarget}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {busy ? "Назначаем…" : "Назначить практику"}
            </button>
          </>
        )
      }
    >
      {done ? (
        <ResultPanel result={result} />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-charcoal-600">
            Заполните только то, что нужно изменить: пустые поля остаются как есть и ничего не стирают.
          </p>
          <PracticeFields value={values} onChange={patch} partners={partners} count={total} />
          <CheckboxField
            label="Режим"
            text="Менять только пустые поля"
            checked={onlyEmpty}
            onChange={setOnlyEmpty}
            hint="Студентам, у которых предприятие или даты уже заданы, эти значения не изменятся."
          />
          {!hasFields && (
            <p className="text-xs text-charcoal-500">Заполните хотя бы одно поле, чтобы продолжить.</p>
          )}
          {error && (
            <InlineAlert tone="red" title="Не получилось назначить практику">
              {error}
            </InlineAlert>
          )}
        </div>
      )}
    </Modal>
  );
}

function ResultPanel({ result }) {
  const updated = Number(result.updated) || 0;
  const selected = Number(result.selected) || 0;
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-4 py-4 ring-1 ring-emerald-200">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-500 text-white" aria-hidden="true">
          <CircleCheck className="h-6 w-6" />
        </span>
        <div>
          <div className="text-base font-semibold text-emerald-900">
            {updated > 0
              ? `Практика назначена: ${updated} из ${selected} ${plural(selected, "студента", "студентов", "студентов")}`
              : "Изменений нет"}
          </div>
          <div className="text-sm text-emerald-800">
            {updated > 0
              ? "Данные сохранены. Теперь можно оформлять договоры."
              : "У выбранных студентов все эти поля уже заполнены или не отличаются от введённых."}
          </div>
        </div>
      </div>

      {warnings.map((w, i) => (
        <InlineAlert key={w.code || i} tone="amber" title="Обратите внимание">
          {w.message}
        </InlineAlert>
      ))}

      {skipped.length > 0 && (
        <InlineAlert tone="amber" title={`Не изменены: ${skipped.length}`}>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {skipped.slice(0, 12).map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.full_name}</span> — {s.reason}
              </li>
            ))}
          </ul>
          {skipped.length > 12 && <div className="mt-1 text-xs">…и ещё {skipped.length - 12}</div>}
        </InlineAlert>
      )}
    </div>
  );
}
