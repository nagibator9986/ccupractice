import { CircleCheck, FilePlus2, Check, TriangleAlert, UserCheck, Users } from "lucide-react";
import clsx from "clsx";
import { groupLabelOf } from "./studentUtils.js";
import { plural } from "../../utils/format.js";

function Count({ value, label, tone }) {
  return (
    <div className={clsx("rounded-xl px-4 py-3 text-center ring-1", tone)}>
      <div className="text-3xl font-bold leading-none tabular-nums text-charcoal-900">{value ?? 0}</div>
      <div className="mt-1.5 text-xs font-medium text-charcoal-600">{label}</div>
    </div>
  );
}

function NextCard({ icon: Icon, title, text, action, done, children }) {
  return (
    <div className="flex flex-col rounded-2xl border border-charcoal-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-coral-50 text-coral-600" aria-hidden="true">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold leading-snug text-charcoal-900">{title}</h4>
          <p className="mt-0.5 text-xs leading-relaxed text-charcoal-500">{text}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-[3.25rem]">
        {action}
        {done && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Выполнено
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

/**
 * Step 3 «Готово»: what happened + the obvious next moves. The group chips let
 * the operator choose which freshly loaded group the next action is for.
 */
export default function ImportDoneStep({
  result,
  target,
  onTarget,
  followups,
  onPractice,
  onContracts,
  onStudents,
  onClose,
}) {
  const names = result.groups?.length ? result.groups : [""];
  const label = groupLabelOf(target);
  const errors = Number(result.errors) || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-soft" aria-hidden="true">
          <CircleCheck className="h-9 w-9" />
        </span>
        <h3 className="mt-3 font-serif text-2xl font-bold text-charcoal-900">Студенты загружены</h3>
        <p className="mt-1 max-w-md text-sm text-charcoal-500">
          Данные сохранены в системе. Теперь назначьте практику и оформите договоры.
        </p>
      </div>

      <div className="mx-auto grid max-w-xl grid-cols-3 gap-2.5">
        <Count value={result.created} label="создано" tone="bg-emerald-50 ring-emerald-100" />
        <Count value={result.updated} label="обновлено" tone="bg-blue-50 ring-blue-100" />
        <Count value={result.skipped} label="пропущено" tone="bg-charcoal-50 ring-charcoal-100" />
      </div>
      {errors > 0 && (
        <p className="mx-auto flex max-w-xl items-start justify-center gap-2 text-center text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          {errors} {plural(errors, "строка", "строки", "строк")} с ошибками не загружены — исправьте их в файле и
          загрузите файл ещё раз.
        </p>
      )}

      <section aria-label="Следующий шаг">
        <h4 className="mb-2 text-sm font-semibold text-charcoal-900">Что дальше</h4>
        {names.length > 1 && (
          <div className="mb-3">
            <div className="mb-1.5 text-xs text-charcoal-500">Выберите группу, с которой продолжить:</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Загруженные группы">
              {names.map((g) => (
                <button
                  key={g || "__none"}
                  type="button"
                  aria-pressed={g === target}
                  onClick={() => onTarget(g)}
                  className={clsx(
                    "min-h-[40px] rounded-full px-3.5 text-sm font-medium transition",
                    g === target
                      ? "bg-coral-500 text-white shadow-sm"
                      : "bg-white text-charcoal-700 ring-1 ring-charcoal-200 hover:bg-charcoal-50",
                  )}
                >
                  {groupLabelOf(g)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <NextCard
            icon={UserCheck}
            title="Назначить предприятие и сроки практики"
            text={`Одно предприятие и даты для всех студентов: ${label}.`}
            done={followups.practice}
            action={
              <button type="button" className="btn-primary btn-sm" onClick={() => onPractice(target)}>
                Назначить практику
              </button>
            }
          />
          <NextCard
            icon={FilePlus2}
            title="Создать договоры"
            text={`Оформить договоры практики для: ${label}. Сначала лучше назначить предприятие.`}
            done={followups.contracts}
            action={
              <button type="button" className="btn-secondary btn-sm" onClick={() => onContracts(target)}>
                Создать договоры
              </button>
            }
          />
          <NextCard
            icon={Users}
            title="Перейти к студентам"
            text="Посмотреть загруженный список, поправить карточки вручную."
            action={
              <button type="button" className="btn-secondary btn-sm" onClick={() => onStudents(target)}>
                Открыть список
              </button>
            }
          />
          <NextCard
            icon={Check}
            title="Закрыть"
            text="Вернуться на страницу — все данные уже сохранены."
            action={
              <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
                Закрыть
              </button>
            }
          />
        </div>
      </section>
    </div>
  );
}
