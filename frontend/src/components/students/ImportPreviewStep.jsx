import { useId, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  Download,
  Layers,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import clsx from "clsx";
import Tabs from "../Tabs.jsx";
import SearchInput from "../SearchInput.jsx";
import { Pagination } from "../Pagination.jsx";
import usePagination from "../../hooks/usePagination.js";
import { TextField } from "../Field.jsx";
import InlineAlert from "./InlineAlert.jsx";
import EmptyState from "../EmptyState.jsx";
import { TONES } from "../../utils/tones.js";
import { downloadBlob, plural } from "../../utils/format.js";
import { buildCsv, fmtDay, fmtPeriod } from "./studentUtils.js";

/* ───────────────────────────── helpers ───────────────────────────── */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function fmtChangeValue(field, v, partnerMap) {
  if (v === null || v === undefined || v === "") return "пусто";
  if (typeof v === "boolean") return v ? "Да" : "Нет";
  if (field === "partner_id") return partnerMap?.[v] || `предприятие №${v}`;
  if (typeof v === "string" && ISO_DAY.test(v)) return fmtDay(v);
  return String(v);
}

function groupSourceText(sheet) {
  const g = sheet.suggested_group;
  switch (sheet.group_source) {
    case "column":
      return "группа из колонки «Группа»";
    case "title":
      return `группа из заголовка листа: ${g}`;
    case "sheet":
      return `группа по названию листа: ${g}`;
    case "default":
      return `группа по умолчанию: ${g}`;
    case "override":
      return `группа указана вручную: ${g}`;
    case "forced":
      return `все студенты — в группу ${g}`;
    default:
      return "группа не определена";
  }
}

function metaLine(meta) {
  if (!meta) return "";
  const parts = [];
  if (meta.group_name) parts.push(`Группа ${meta.group_name}`);
  if (meta.specialty) parts.push(`Специальность ${[meta.specialty_code, meta.specialty].filter(Boolean).join(" ")}`);
  if (meta.course) parts.push(`Курс ${meta.course}`);
  if (meta.curator) parts.push(`Куратор ${meta.curator}`);
  return parts.join(", ");
}

const STATUS = {
  new: { label: "Новый", tone: "emerald" },
  update: { label: "Обновится", tone: "blue" },
  unchanged: { label: "Без изменений", tone: "slate" },
  skip: { label: "Пропущен", tone: "amber" },
  error: { label: "Ошибка", tone: "red" },
};

function RowStatus({ status }) {
  const m = STATUS[status] || STATUS.unchanged;
  return (
    <span className={clsx("badge whitespace-nowrap", TONES[m.tone].badge)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", TONES[m.tone].dot)} aria-hidden="true" />
      {m.label}
    </span>
  );
}

const TILES = [
  { key: "all", label: "Всего строк", field: "total", tone: "slate", hint: "в файле" },
  { key: "new", label: "Новые", field: "new", tone: "emerald", hint: "будут добавлены" },
  { key: "update", label: "Обновятся", field: "update", tone: "blue", hint: "карточка изменится" },
  { key: "unchanged", label: "Без изменений", field: "unchanged", tone: "slate", hint: "уже всё заполнено" },
  { key: "skip", label: "Пропущены", field: "skip", tone: "amber", hint: "уже есть в системе" },
  { key: "error", label: "С ошибками", field: "error", tone: "red", hint: "не загрузятся" },
];

function Tile({ tile, value, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "rounded-xl p-3 text-left ring-1 transition",
        TONES[tile.tone].soft,
        active ? "ring-2 ring-coral-400" : "ring-charcoal-100 hover:ring-charcoal-300",
      )}
    >
      <span className="block text-2xl font-bold leading-none tabular-nums text-charcoal-900">{value ?? 0}</span>
      <span className="mt-1.5 block text-xs font-semibold text-charcoal-800">{tile.label}</span>
      <span className="block text-[11px] text-charcoal-500">{tile.hint}</span>
    </button>
  );
}

/* ───────────────────────────── groups ───────────────────────────── */

function GroupCard({ g }) {
  return (
    <li className="rounded-xl border border-charcoal-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className={clsx("text-sm font-semibold", g.name ? "text-charcoal-900" : "text-amber-700")}>
          {g.name || "Без группы"}
        </span>
        {g.name ? (
          g.in_db === 0 ? (
            <span className={clsx("badge !px-2 !py-0.5 !text-[11px]", TONES.emerald.badge)}>новая группа</span>
          ) : (
            <span className={clsx("badge !px-2 !py-0.5 !text-[11px]", TONES.slate.badge)}>в базе: {g.in_db}</span>
          )
        ) : (
          <span className={clsx("badge !px-2 !py-0.5 !text-[11px]", TONES.amber.badge)}>загрузятся без группы</span>
        )}
      </div>
      <div className="mt-1.5 text-xs leading-relaxed text-charcoal-500">
        Строк: <b className="tabular-nums text-charcoal-800">{g.total}</b>
        {g.new > 0 && <> · новых {g.new}</>}
        {g.update > 0 && <> · обновятся {g.update}</>}
        {g.error > 0 && <span className="text-red-600"> · ошибок {g.error}</span>}
      </div>
    </li>
  );
}

/* ───────────────────────────── sheets ───────────────────────────── */

function ColumnMapRow({ sheetName, header, manual, value, fields, onChange }) {
  const id = useId();
  return (
    <li className="flex flex-col gap-1 rounded-lg bg-white p-2 ring-1 ring-charcoal-100 sm:flex-row sm:items-center sm:gap-3">
      <label htmlFor={id} className="min-w-0 flex-1 text-xs text-charcoal-700">
        <span className="font-medium">{header}</span>
        <span className="ml-1.5 text-charcoal-400">
          {manual ? "— загружается вручную" : value ? "— будет загружена" : "— не загружается"}
        </span>
      </label>
      <select
        id={id}
        className="input input-sm sm:!w-56"
        value={value}
        onChange={(e) => onChange(sheetName, header, e.target.value)}
        aria-label={`Загружать колонку «${header}» как`}
      >
        <option value="">Не загружать</option>
        {fields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </select>
    </li>
  );
}

function SheetCard({
  sheet,
  fields,
  colDraft,
  appliedCols,
  onColumnChange,
  onApplyGroup,
  busy,
  defaultOpen,
  groupNames,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [groupDraft, setGroupDraft] = useState("");
  const bodyId = useId();
  const listId = useId();
  const noGroup = sheet.group_source === "none" && !sheet.skipped_reason;
  const draftCols = colDraft?.[sheet.name] || {};
  const applied = appliedCols?.[sheet.name] || {};
  const meta = metaLine(sheet.meta);
  const manualCols = (sheet.columns || []).filter((c) => applied[c.header]);
  const mapRows = [
    ...(sheet.ignored_columns || []).map((h) => ({ header: h, manual: false })),
    ...manualCols.map((c) => ({ header: c.header, manual: true })),
  ];

  return (
    <li className={clsx("rounded-xl border bg-white", noGroup || sheet.skipped_reason ? "border-amber-300" : "border-charcoal-200")}>
      <button
        type="button"
        className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-charcoal-900">{sheet.name}</span>
          <span className={clsx("block text-xs", noGroup ? "font-medium text-amber-700" : "text-charcoal-500")}>
            {sheet.rows} {plural(sheet.rows, "строка", "строки", "строк")} · {groupSourceText(sheet)}
            {!open && sheet.ignored_columns?.length > 0 && (
              <span className="text-charcoal-400"> · не загружаются колонки: {sheet.ignored_columns.length}</span>
            )}
          </span>
        </span>
        <ChevronDown className={clsx("h-4 w-4 shrink-0 text-charcoal-400 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div id={bodyId} className="space-y-3 border-t border-charcoal-100 px-3.5 py-3">
          {sheet.skipped_reason && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
              Лист пропущен: {sheet.skipped_reason}
            </p>
          )}

          {(meta || sheet.headerless) && (
            <div className="space-y-1 text-xs text-charcoal-600">
              {meta && (
                <p>
                  <span className="font-semibold text-charcoal-700">Из шапки листа:</span> {meta}
                </p>
              )}
              {sheet.headerless && (
                <p className="text-charcoal-500">Список без заголовков колонок — ФИО определены автоматически.</p>
              )}
            </div>
          )}

          {noGroup && (
            <form
              className="flex flex-wrap items-end gap-2 rounded-lg bg-amber-50/60 p-3 ring-1 ring-amber-200"
              onSubmit={(e) => {
                e.preventDefault();
                if (groupDraft.trim()) onApplyGroup(sheet.name, groupDraft.trim());
              }}
            >
              <div className="min-w-[12rem] flex-1">
                <TextField
                  label="Группа для листа"
                  value={groupDraft}
                  onChange={setGroupDraft}
                  list={listId}
                  placeholder="например, ПО 25-1"
                  hint="В листе не нашлось группы — укажите, куда отнести этих студентов."
                  autoComplete="off"
                />
                <datalist id={listId}>
                  {groupNames.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>
              <button type="submit" className="btn-secondary mb-[1.35rem]" disabled={busy || !groupDraft.trim()}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Применить
              </button>
            </form>
          )}

          {sheet.columns?.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-charcoal-400">Что нашли в файле</div>
              <ul className="flex flex-wrap gap-1.5">
                {sheet.columns.map((c) => (
                  <li
                    key={`${c.key}-${c.header}`}
                    className="inline-flex items-center gap-1 rounded-full bg-coral-50 px-2.5 py-1 text-xs font-medium text-coral-800 ring-1 ring-coral-100"
                    title={c.header && c.header !== c.label ? `Колонка в файле: ${c.header}` : undefined}
                  >
                    {c.label}
                    {c.header && c.header !== c.label && <span className="font-normal text-coral-600/70">← {c.header}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mapRows.length > 0 && (
            <div className="rounded-lg bg-charcoal-50/70 p-2.5 ring-1 ring-charcoal-100">
              <div className="mb-2 text-xs text-charcoal-500">
                <span className="font-semibold text-charcoal-700">Загружать как…</span> Эти колонки по умолчанию не
                загружаются. Если нужны — выберите, куда их записать, и нажмите «Применить сопоставление».
              </div>
              <ul className="grid gap-2 lg:grid-cols-2">
                {mapRows.map((r) => (
                  <ColumnMapRow
                    key={`${r.header}-${r.manual}`}
                    sheetName={sheet.name}
                    header={r.header}
                    manual={r.manual}
                    value={draftCols[r.header] ?? applied[r.header] ?? ""}
                    fields={fields}
                    onChange={onColumnChange}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ─────────────────────────────── rows ─────────────────────────────── */

function RowOutcome({ row, partnerMap }) {
  const changes = row.changes || [];
  const errors = row.errors || [];
  const warnings = row.warnings || [];
  return (
    <div className="space-y-1 text-xs leading-snug">
      {row.status === "new" && <div className="text-charcoal-600">Будет создана новая карточка</div>}
      {row.status === "unchanged" && <div className="text-charcoal-500">Уже всё заполнено — менять нечего</div>}
      {row.status === "skip" && <div className="text-charcoal-500">Уже есть в системе — не меняется</div>}
      {row.status === "update" && (
        <ul className="space-y-0.5">
          {changes.slice(0, 6).map((c) => (
            <li key={c.field} className="text-charcoal-700">
              <span className="font-medium">{c.label}:</span>{" "}
              <span className="text-charcoal-500">{fmtChangeValue(c.field, c.old, partnerMap)}</span>
              <ArrowRight className="mx-1 inline h-3 w-3 text-charcoal-400" role="img" aria-label="станет" />
              <span className="font-medium text-blue-700">{fmtChangeValue(c.field, c.new, partnerMap)}</span>
            </li>
          ))}
          {changes.length > 6 && <li className="text-charcoal-500">…и ещё {changes.length - 6}</li>}
        </ul>
      )}
      {errors.map((m, i) => (
        <div key={`e${i}`} className="flex items-start gap-1.5 font-medium text-red-700">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {m}
        </div>
      ))}
      {warnings.map((m, i) => (
        <div key={`w${i}`} className="flex items-start gap-1.5 text-amber-800">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          {m}
        </div>
      ))}
    </div>
  );
}

const rowKey = (r) => `${r.sheet}:${r.row}`;

function rowMatches(r, filter) {
  switch (filter) {
    case "all":
      return true;
    case "warn":
      return r.status !== "error" && (r.warnings?.length || 0) > 0;
    default:
      return r.status === filter;
  }
}

function RowsSection({ rows, summary, multiSheet, filter, onFilter, partnerMap, sectionRef }) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (!rowMatches(r, filter)) return false;
        if (!q) return true;
        return (r.full_name || "").toLowerCase().includes(q) || (r.iin || "").includes(q);
      }),
    [rows, filter, q],
  );
  const { page, setPage, pageSize, setPageSize, totalPages, pageItems, total } = usePagination(
    filtered,
    25,
    `${filter}|${q}`,
  );

  const options = [
    { value: "all", label: "Все", count: summary.total },
    { value: "new", label: "Новые", count: summary.new },
    { value: "update", label: "Обновятся", count: summary.update },
    { value: "error", label: "Ошибки", count: summary.error },
    { value: "warn", label: "С предупреждениями", count: summary.with_warnings },
  ];
  // Tiles can also select statuses without a tab of their own.
  if (filter === "unchanged") options.push({ value: "unchanged", label: "Без изменений", count: summary.unchanged });
  if (filter === "skip") options.push({ value: "skip", label: "Пропущены", count: summary.skip });

  function downloadErrors() {
    const bad = rows.filter((r) => r.status === "error");
    const csv = buildCsv(
      ["Лист", "Строка", "ФИО", "ИИН", "Ошибки"],
      bad.map((r) => [r.sheet, r.row, r.full_name, r.iin, (r.errors || []).join(" | ")]),
    );
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "Ошибки_загрузки_студентов.csv");
  }

  return (
    <section ref={sectionRef} aria-label="Строки файла" className="scroll-mt-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-charcoal-900">Строки файла</h3>
        {summary.error > 0 && (
          <button type="button" className="btn-secondary btn-sm" onClick={downloadErrors}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Скачать ошибки (CSV)
          </button>
        )}
      </div>
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <Tabs options={options} value={filter} onChange={onFilter} size="sm" ariaLabel="Фильтр строк" />
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по ФИО или ИИН" className="lg:w-72" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-charcoal-200">
          <EmptyState
            compact
            title="Нет строк по этому фильтру"
            description={q ? "Измените запрос поиска." : "Выберите другую вкладку."}
            action={
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setSearch("");
                  onFilter("all");
                }}
              >
                Показать все строки
              </button>
            }
          />
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-charcoal-500" aria-live="polite">
            Показано {pageItems.length} из {total} {plural(total, "строки", "строк", "строк")}
          </p>

          {/* desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-charcoal-200 md:block">
            <table className="table-default table-compact">
              <thead>
                <tr>
                  <th>{multiSheet ? "Лист · №" : "№"}</th>
                  <th>Статус</th>
                  <th>ФИО</th>
                  <th>ИИН</th>
                  <th>Группа</th>
                  <th>Предприятие</th>
                  <th>Практика</th>
                  <th className="min-w-[16rem]">Что произойдёт</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((r) => (
                  <tr key={rowKey(r)} className={clsx(r.status === "error" && "bg-red-50/40")}>
                    <td className="whitespace-nowrap align-top tabular-nums text-xs text-charcoal-500">
                      {multiSheet && <span className="mr-1">{r.sheet} ·</span>}
                      {r.row}
                    </td>
                    <td className="align-top"><RowStatus status={r.status} /></td>
                    <td className="align-top font-medium">{r.full_name || <span className="text-red-600">нет ФИО</span>}</td>
                    <td className="align-top tabular-nums text-xs">{r.iin || <span className="text-charcoal-400">—</span>}</td>
                    <td className="align-top text-xs">{r.group_name || <span className="text-amber-700">без группы</span>}</td>
                    <td className="max-w-[12rem] align-top text-xs">{r.partner_name || <span className="text-charcoal-400">—</span>}</td>
                    <td className="align-top whitespace-nowrap text-xs tabular-nums">
                      {fmtPeriod(r.practice_start, r.practice_end) || <span className="text-charcoal-400">—</span>}
                    </td>
                    <td className="align-top"><RowOutcome row={r} partnerMap={partnerMap} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile cards */}
          <ul className="space-y-2 md:hidden">
            {pageItems.map((r) => (
              <li
                key={rowKey(r)}
                className={clsx("rounded-xl border p-3", r.status === "error" ? "border-red-200 bg-red-50/40" : "border-charcoal-200 bg-white")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold leading-snug">{r.full_name || <span className="text-red-600">нет ФИО</span>}</div>
                    <div className="text-xs text-charcoal-500">
                      {multiSheet ? `${r.sheet} · ` : ""}строка {r.row}
                      {r.iin ? ` · ${r.iin}` : ""}
                    </div>
                  </div>
                  <RowStatus status={r.status} />
                </div>
                <div className="mt-1.5 text-xs text-charcoal-600">
                  {r.group_name || <span className="text-amber-700">без группы</span>}
                  {r.partner_name ? ` · ${r.partner_name}` : ""}
                  {fmtPeriod(r.practice_start, r.practice_end) ? ` · ${fmtPeriod(r.practice_start, r.practice_end)}` : ""}
                </div>
                <div className="mt-2"><RowOutcome row={r} partnerMap={partnerMap} /></div>
              </li>
            ))}
          </ul>

          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </>
      )}
    </section>
  );
}

/* ───────────────────────────── the step ───────────────────────────── */

/**
 * Step 2 «Проверка». Pure view of the server's preview — nothing is written
 * until the host commits. Re-running the preview (sheet group / column mapping)
 * is delegated to the host through onApplyGroup / onApplyColumns.
 */
export default function ImportPreviewStep({
  preview,
  busy,
  appliedCols,
  colDraft,
  columnsDirty,
  onColumnChange,
  onApplyColumns,
  onApplyGroup,
  groupNames,
  partnerMap,
}) {
  const [filter, setFilter] = useState("all");
  const rowsRef = useRef(null);
  const summary = preview.summary;
  const sheets = preview.sheets || [];
  const rows = preview.rows || [];
  const fields = preview.available_fields || [];
  const attention = sheets.some((s) => s.group_source === "none" || s.skipped_reason);
  const sheetsId = useId();
  const [sheetsOpen, setSheetsOpen] = useState(sheets.length <= 3 || attention);

  function pickFilter(key) {
    setFilter(key);
    rowsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={clsx("space-y-5 transition-opacity", busy && "pointer-events-none opacity-60")} aria-busy={busy || undefined}>
      <InlineAlert tone="blue" icon={ShieldCheck} title="Файл проверен — в систему пока ничего не записано">
        Данные попадут в список студентов только после кнопки «Загрузить» внизу. Сейчас можно всё посмотреть и вернуться
        назад, чтобы изменить настройки.
      </InlineAlert>

      {busy && (
        <p className="flex items-center gap-2 text-xs text-charcoal-500" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Пересчитываем…
        </p>
      )}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((t) => (
          <Tile key={t.key} tile={t} value={summary[t.field]} active={filter === t.key} onClick={() => pickFilter(t.key)} />
        ))}
      </div>
      {summary.with_warnings > 0 && (
        <button
          type="button"
          onClick={() => pickFilter("warn")}
          className={clsx("badge !px-3 !py-1.5", TONES.amber.badge, filter === "warn" && "ring-2 ring-coral-400")}
          aria-pressed={filter === "warn"}
        >
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Предупреждений: {summary.with_warnings} — проверьте строки
        </button>
      )}

      {(summary.no_iin > 0 || summary.no_group > 0) && (
        <InlineAlert tone="amber" title="Обратите внимание">
          <ul className="list-disc space-y-1 pl-5">
            {summary.no_iin > 0 && (
              <li>
                У {summary.no_iin} {plural(summary.no_iin, "студента", "студентов", "студентов")} нет ИИН — они загрузятся, но
                для договора ИИН обязателен. Позже загрузите файл с ИИН в режиме «Дополнить пустые поля» — студенты
                найдутся по ФИО.
              </li>
            )}
            {summary.no_group > 0 && (
              <li>
                У {summary.no_group} {plural(summary.no_group, "студента", "студентов", "студентов")} не указана группа — они
                загрузятся «Без группы». Чтобы этого избежать, вернитесь назад и укажите группу либо задайте её для листа
                ниже.
              </li>
            )}
          </ul>
        </InlineAlert>
      )}

      {summary.groups?.length > 0 && (
        <section aria-label="Группы в файле">
          <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-charcoal-900">
            <Layers className="h-4 w-4 text-charcoal-400" aria-hidden="true" />
            Группы в файле
          </h3>
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {summary.groups.map((g) => (
              <GroupCard key={g.name || "__none"} g={g} />
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Листы и колонки">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="flex min-h-[40px] items-center gap-2 text-sm font-semibold text-charcoal-900"
            aria-expanded={sheetsOpen}
            aria-controls={sheetsId}
            onClick={() => setSheetsOpen((v) => !v)}
          >
            Листы и колонки
            <span className="font-normal text-charcoal-500">({sheets.length})</span>
            <ChevronDown className={clsx("h-4 w-4 text-charcoal-400 transition-transform", sheetsOpen && "rotate-180")} aria-hidden="true" />
          </button>
          {columnsDirty && (
            <button type="button" className="btn-primary btn-sm" onClick={onApplyColumns} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Применить сопоставление колонок
            </button>
          )}
        </div>
        {sheetsOpen && (
          <ul id={sheetsId} className="space-y-2">
            {sheets.map((s) => (
              <SheetCard
                key={s.name}
                sheet={s}
                fields={fields}
                colDraft={colDraft}
                appliedCols={appliedCols}
                onColumnChange={onColumnChange}
                onApplyGroup={onApplyGroup}
                busy={busy}
                defaultOpen={sheets.length <= 2 || s.group_source === "none" || !!s.skipped_reason}
                groupNames={groupNames}
              />
            ))}
          </ul>
        )}
      </section>

      <RowsSection
        rows={rows}
        summary={summary}
        multiSheet={sheets.length > 1}
        filter={filter}
        onFilter={setFilter}
        partnerMap={partnerMap}
        sectionRef={rowsRef}
      />
    </div>
  );
}
