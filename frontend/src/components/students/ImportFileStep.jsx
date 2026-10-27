import { useId } from "react";
import { ChevronDown, FileSpreadsheet, Loader2 } from "lucide-react";
import clsx from "clsx";
import FileDropzone from "../FileDropzone.jsx";
import { TextField } from "../Field.jsx";
import InlineAlert from "./InlineAlert.jsx";
import PracticeFields from "./PracticeFields.jsx";
import { cleanPractice } from "./studentUtils.js";

export const IMPORT_MODES = [
  {
    value: "fill",
    title: "Дополнить пустые поля",
    text: "Рекомендуется. Найденные студенты сохранят всё, что уже заполнено, — файл только добавит недостающее.",
  },
  {
    value: "skip",
    title: "Только новые",
    text: "Студенты, которые уже есть в системе, не меняются вообще. Добавляются только те, кого ещё нет.",
  },
  {
    value: "overwrite",
    title: "Обновить данными из файла",
    text: "У найденных студентов значения из файла заменят текущие. Пустые ячейки файла ничего не стирают.",
  },
];

function RadioCard({ name, value, checked, onChange, title, text, children }) {
  return (
    <div className="flex h-full flex-col">
      <label
        className={clsx(
          "flex flex-1 cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition",
          checked
            ? "border-coral-400 bg-coral-50/50 ring-2 ring-coral-100"
            : "border-charcoal-200 bg-white hover:border-coral-300",
        )}
      >
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          onChange={() => onChange(value)}
          className="mt-1 h-4 w-4 shrink-0 accent-coral-500"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-charcoal-900">{title}</span>
          {text && <span className="mt-0.5 block text-xs leading-relaxed text-charcoal-500">{text}</span>}
        </span>
      </label>
      {checked && children && <div className="mt-3 pl-1 sm:pl-7">{children}</div>}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="mb-2.5 text-sm font-semibold text-charcoal-900">{title}</h3>
      {children}
    </section>
  );
}

/** Step 1 «Файл»: pick the file and say where the students go. */
export default function ImportFileStep({
  file,
  onFile,
  onClearFile,
  busy,
  scope,
  onScope,
  forceGroup,
  onForceGroup,
  defaultGroup,
  onDefaultGroup,
  mode,
  onMode,
  practiceOpen,
  onPracticeOpen,
  practice,
  onPractice,
  groups,
  partners,
  error,
  onDownloadTemplate,
  templateBusy,
}) {
  const listId = useId();
  const practiceId = useId();
  const filled = Object.keys(cleanPractice(practice)).length;

  return (
    <div className="space-y-6">
      <Section title="1. Выберите файл со списком студентов">
        {/* The dialog focuses the first [data-autofocus]; without this it would
            land on the dropzone's invisible file input. */}
        <div data-autofocus tabIndex={-1} className="rounded-xl outline-none">
          <FileDropzone
            accept=".xlsx,.csv"
            file={file}
            onFile={onFile}
            onClear={onClearFile}
            busy={busy}
            maxSizeMb={20}
            hint="Excel (.xlsx) или CSV, до 20 МБ. Можно загрузить сразу несколько групп."
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <ul className="space-y-1 text-xs leading-relaxed text-charcoal-500">
            <li>Одна строка — один студент. Нужны хотя бы ФИО; ИИН можно добавить позже.</li>
            <li>Группа берётся из колонки «Группа», из названия листа или из заголовка над таблицей.</li>
            <li>Пока вы не подтвердите загрузку на следующем шаге, ничего не сохраняется.</li>
          </ul>
          <button
            type="button"
            className="btn-ghost btn-sm shrink-0 text-coral-700"
            onClick={onDownloadTemplate}
            disabled={templateBusy}
          >
            {templateBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            )}
            Скачать шаблон Excel
          </button>
        </div>
      </Section>

      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-charcoal-900">2. Куда загрузить</legend>
        <div className="space-y-2.5">
          <RadioCard
            name="import-scope"
            value="file"
            checked={scope === "file"}
            onChange={onScope}
            title="Группы взять из файла"
            text="Колонка «Группа», название листа или заголовок над таблицей — как удобнее в вашем файле."
          >
            <TextField
              label="Группа по умолчанию, если в файле её нет"
              value={defaultGroup}
              onChange={onDefaultGroup}
              list={listId}
              placeholder="необязательно"
              autoComplete="off"
            />
          </RadioCard>
          <RadioCard
            name="import-scope"
            value="one"
            checked={scope === "one"}
            onChange={onScope}
            title="Все студенты файла — в одну группу"
            text="Группа из файла игнорируется: все строки попадут в выбранную группу."
          >
            <TextField
              label="Название группы"
              required
              value={forceGroup}
              onChange={onForceGroup}
              list={listId}
              placeholder="например, ПО 25-1"
              autoComplete="off"
              error={scope === "one" && !forceGroup.trim() ? "Укажите группу" : undefined}
              data-autofocus={scope === "one" || undefined}
            />
          </RadioCard>
        </div>
        <datalist id={listId}>
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </fieldset>

      <fieldset>
        <legend className="mb-2.5 text-sm font-semibold text-charcoal-900">3. Если студент уже есть в системе</legend>
        <div className="grid gap-2.5 md:grid-cols-3">
          {IMPORT_MODES.map((m) => (
            <RadioCard
              key={m.value}
              name="import-mode"
              value={m.value}
              checked={mode === m.value}
              onChange={onMode}
              title={m.title}
              text={m.text}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-charcoal-500">
          Студента находят по ИИН, а если ИИН нет — по ФИО. Дубликаты не создаются ни в одном из режимов.
        </p>
      </fieldset>

      <section className="rounded-xl border border-charcoal-200">
        <button
          type="button"
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left"
          aria-expanded={practiceOpen}
          aria-controls={practiceId}
          onClick={() => onPracticeOpen(!practiceOpen)}
        >
          <span>
            <span className="block text-sm font-semibold text-charcoal-900">
              Практика для всей загрузки <span className="font-normal text-charcoal-500">(необязательно)</span>
            </span>
            <span className="block text-xs text-charcoal-500">
              {filled > 0 ? `Заполнено полей: ${filled}` : "Предприятие, сроки и руководители — сразу всем загружаемым студентам."}
            </span>
          </span>
          <ChevronDown
            className={clsx("h-5 w-5 shrink-0 text-charcoal-400 transition-transform", practiceOpen && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {practiceOpen && (
          <div id={practiceId} className="border-t border-charcoal-100 px-4 py-4">
            <p className="mb-4 text-xs text-charcoal-500">
              Значения из строк файла важнее: эти данные подставятся только там, где в файле ячейка пуста.
            </p>
            <PracticeFields value={practice} onChange={onPractice} partners={partners} showCourse />
          </div>
        )}
      </section>

      {error && (
        <InlineAlert tone="red" title="Не удалось проверить файл">
          {error}
        </InlineAlert>
      )}
    </div>
  );
}

