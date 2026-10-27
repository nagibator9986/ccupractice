import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  BadgeCheck,
  Building2,
  Download,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Search,
  TriangleAlert,
  Upload,
  UserCheck,
  Users,
  SearchX,
} from "lucide-react";
import clsx from "clsx";
import PageHeader from "../components/PageHeader.jsx";
import EmptyState from "../components/EmptyState.jsx";
import SearchInput from "../components/SearchInput.jsx";
import StatCard from "../components/StatCard.jsx";
import ProgressBar, { StackedProgress } from "../components/ProgressBar.jsx";
import { CardSkeleton } from "../components/Skeleton.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { errorText, studentsApi } from "../api/endpoints.js";
import { CONTRACT_STATUS_META, STATUS_LABELS, plural } from "../utils/format.js";
import { TONES } from "../utils/tones.js";
import ImportStudentsWizard from "../components/students/ImportStudentsWizard.jsx";
import BulkPracticeModal from "../components/students/BulkPracticeModal.jsx";
import BulkContractsWizard from "../components/contracts/BulkContractsWizard.jsx";
import { fmtPeriod, groupLabelOf, groupParamOf } from "../components/students/studentUtils.js";
import { SORTS, nextStep, sortGroups } from "../components/students/groupSteps.js";

const PIPELINE = ["draft", "generated", "sent", "signed", "scan_uploaded", "completed"];

function Bar({ label, value, max, done }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-charcoal-600">{label}</span>
        <span className="font-semibold tabular-nums text-charcoal-800">
          {value}/{max}
        </span>
      </div>
      <ProgressBar value={value} max={max} tone={done ? "emerald" : "coral"} height="sm" label={label} />
    </div>
  );
}

function GroupCard({ g, isAdmin, exporting, onPractice, onContracts, onExport }) {
  const step = nextStep(g);
  const named = !!g.name;
  const studentsLink = `/students?group=${encodeURIComponent(groupParamOf(g.name))}`;
  const contractsLink = named ? `/contracts?group=${encodeURIComponent(g.name)}` : null;
  const noIin = Math.max(0, g.students - g.with_iin);
  const period = fmtPeriod(g.practice_start, g.practice_end);
  const subtitle = [
    `${g.students} ${plural(g.students, "студент", "студента", "студентов")}`,
    g.specialty,
    g.course ? `${g.course} курс` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const segments = PIPELINE.map((k) => ({
    label: STATUS_LABELS[k],
    value: g.by_status?.[k] || 0,
    tone: CONTRACT_STATUS_META[k].tone,
  })).filter((s) => s.value > 0);
  const StepIcon = step.Icon;

  return (
    <article className="card flex flex-col p-4 sm:p-5" aria-label={`Группа ${groupLabelOf(g.name)}`}>
      <header>
        <h2 className={clsx("font-serif text-xl font-bold leading-tight", named ? "text-charcoal-900" : "text-charcoal-500")}>
          {groupLabelOf(g.name)}
        </h2>
        <p className="mt-0.5 text-sm text-charcoal-500">{subtitle}</p>
        {period && <p className="mt-0.5 text-xs text-charcoal-500">Практика: {period}</p>}
      </header>

      <div className={clsx("mt-4 flex items-start gap-3 rounded-xl p-3", TONES[step.tone].soft)}>
        <StepIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">Следующий шаг</div>
          <div className="text-sm font-semibold leading-snug text-charcoal-900">{step.title}</div>
          {step.hint && <div className="text-xs text-charcoal-600">{step.hint}</div>}
          {step.action === "practice" && isAdmin && (
            <button type="button" className="btn-primary btn-sm mt-2 min-h-[40px] sm:min-h-0" onClick={() => onPractice(g)}>
              {step.button}
            </button>
          )}
          {step.action === "contracts" && isAdmin && (
            <button type="button" className="btn-primary btn-sm mt-2 min-h-[40px] sm:min-h-0" onClick={() => onContracts(g)}>
              {step.button}
            </button>
          )}
          {step.action === "link" && contractsLink && (
            <Link to={contractsLink} className="btn-primary btn-sm mt-2 min-h-[40px] sm:min-h-0">
              {step.button}
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <Bar label="Предприятие назначено" value={g.with_partner} max={g.students} done={g.with_partner === g.students} />
        <Bar label="Сроки заданы" value={g.with_period} max={g.students} done={g.with_period === g.students} />
        <Bar label="Подписано" value={g.fully_signed} max={g.students} done={g.fully_signed === g.students} />
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-medium text-charcoal-600">Договоры</div>
        {segments.length > 0 ? (
          <>
            <StackedProgress segments={segments} total={g.students} height="md" showLegend />
            {g.without_contract > 0 && (
              <p className="mt-1.5 text-xs text-charcoal-500">Без договора: {g.without_contract}</p>
            )}
          </>
        ) : (
          <p className="text-xs text-charcoal-500">Договоров ещё нет.</p>
        )}
      </div>

      {(g.partners?.length > 0 || noIin > 0) && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {(g.partners || []).slice(0, 3).map((p) => (
            <span
              key={p.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-charcoal-100 px-2.5 py-1 text-[11px] font-medium text-charcoal-700"
              title={`${p.name}: студентов ${p.count}`}
            >
              <Building2 className="h-3 w-3 shrink-0 text-charcoal-400" aria-hidden="true" />
              <span className="truncate">{p.name}</span>
              <span className="tabular-nums text-charcoal-500">· {p.count}</span>
            </span>
          ))}
          {noIin > 0 && (
            <Link
              to={studentsLink}
              className={clsx("badge !text-[11px]", TONES.amber.badge)}
              title="Для договора ИИН обязателен. Откройте список и заполните ИИН."
            >
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              Без ИИН: {noIin}
            </Link>
          )}
        </div>
      )}

      <div className="mt-auto pt-5">
      <div className="flex flex-wrap gap-2 border-t border-charcoal-100 pt-4">
        {isAdmin && (
          <>
            <button type="button" className="btn-secondary btn-sm min-h-[40px] sm:min-h-0" onClick={() => onPractice(g)}>
              <UserCheck className="h-4 w-4" aria-hidden="true" />
              Назначить практику
            </button>
            <button type="button" className="btn-secondary btn-sm min-h-[40px] sm:min-h-0" onClick={() => onContracts(g)}>
              <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              Создать договоры
            </button>
          </>
        )}
        <Link to={studentsLink} className="btn-ghost btn-sm min-h-[40px] sm:min-h-0">
          <Users className="h-4 w-4" aria-hidden="true" />
          Студенты
        </Link>
        {contractsLink && (
          <Link to={contractsLink} className="btn-ghost btn-sm min-h-[40px] sm:min-h-0">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Договоры
          </Link>
        )}
        {named && (
          <button
            type="button"
            className="btn-ghost btn-sm min-h-[40px] sm:min-h-0"
            onClick={() => onExport(g)}
            disabled={exporting}
            title="Список группы в Excel — те же колонки, что в шаблоне загрузки"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            Экспорт
          </button>
        )}
      </div>
      </div>
    </article>
  );
}

const STEPS = [
  { n: 1, title: "Загрузить", text: "Файл Excel со списками групп. Сначала всё проверяется, ничего не сохраняется само." },
  { n: 2, title: "Назначить", text: "Предприятие и сроки практики — сразу всей группе одним действием." },
  { n: 3, title: "Подписать", text: "Договоры создаются по группе, затем уходят на подпись со ссылками." },
];

export default function GroupsPage() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("name");
  const [importOpen, setImportOpen] = useState(false);
  const [practiceFor, setPracticeFor] = useState(null); // group object
  const [contractsFor, setContractsFor] = useState(null);
  const [exportingKey, setExportingKey] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await studentsApi.groups();
      setGroups(r.items || []);
      setLoadFailed(false);
    } catch (e) {
      const st = e.response?.status;
      if (st !== 401 && st !== 422) toast.error(await errorText(e, "Не удалось загрузить группы"));
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ?import=1 opens the wizard once, then disappears from the URL.
  const importParam = params.get("import");
  useEffect(() => {
    if (!importParam) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("import");
        return next;
      },
      { replace: true },
    );
    if (isAdmin) setImportOpen(true);
  }, [importParam, isAdmin, setParams]);

  async function onExport(g) {
    setExportingKey(g.name);
    try {
      await studentsApi.exportXlsx({ group: g.name });
    } catch (e) {
      toast.error(await errorText(e, "Не удалось выгрузить файл"));
    } finally {
      setExportingKey(null);
    }
  }

  async function onDownloadTemplate() {
    try {
      await studentsApi.downloadImportTemplate();
    } catch (e) {
      toast.error(await errorText(e, "Не удалось скачать шаблон"));
    }
  }

  const stats = useMemo(
    () => ({
      groups: groups.filter((g) => g.name).length,
      students: groups.reduce((a, g) => a + g.students, 0),
      contracts: groups.reduce((a, g) => a + g.contracts, 0),
      signed: groups.reduce((a, g) => a + g.fully_signed, 0),
    }),
    [groups],
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? groups.filter((g) => groupLabelOf(g.name).toLowerCase().includes(needle)) : groups;
    return sortGroups(list, sort);
  }, [groups, q, sort]);

  const empty = !loading && !loadFailed && groups.length === 0;

  return (
    <div>
      <PageHeader
        title="Практика по группам"
        description="Загрузите список группы, назначьте предприятие и сроки, оформите договоры и отправьте их на подпись — всё по группам."
        actions={
          <>
            {isAdmin && (
              <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                Загрузить из Excel
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={onDownloadTemplate}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              Скачать шаблон
            </button>
          </>
        }
      />

      {!empty && !loadFailed && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard icon={Layers} label="Групп" value={stats.groups} loading={loading} tone="coral" />
          <StatCard icon={Users} label="Студентов" value={stats.students} loading={loading} tone="blue" />
          <StatCard icon={FileText} label="С договором" value={stats.contracts} loading={loading} tone="indigo" />
          <StatCard icon={BadgeCheck} label="Полностью подписано" value={stats.signed} loading={loading} tone="emerald" />
        </div>
      )}

      {!empty && !loadFailed && (
        <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <SearchInput className="sm:max-w-sm sm:flex-1" value={q} onChange={setQ} placeholder="Найти группу" />
          <label className="flex items-center gap-2 text-sm text-charcoal-600">
            <span className="shrink-0">Сортировка</span>
            <select className="input sm:!w-52" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Сортировка групп">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <span className="text-xs text-charcoal-500 sm:ml-auto" aria-live="polite">
            {q.trim() ? `Найдено групп: ${visible.length} из ${groups.length}` : `Всего: ${groups.length}`}
          </span>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <CardSkeleton key={i} lines={6} />
          ))}
        </div>
      ) : loadFailed ? (
        <div className="card">
          <EmptyState
            icon={SearchX}
            title="Не удалось загрузить группы"
            description="Проверьте соединение и попробуйте ещё раз."
            action={
              <button type="button" className="btn-secondary" onClick={() => { setLoading(true); load(); }}>
                Повторить
              </button>
            }
          />
        </div>
      ) : empty ? (
        <div className="card">
          <EmptyState
            icon={Layers}
            title="Групп пока нет"
            description="Начните с загрузки списка студентов из Excel — группы появятся здесь сами, вместе с подсказками, что делать дальше."
            action={
              isAdmin ? (
                <>
                  <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    Загрузить студентов из Excel
                  </button>
                  <button type="button" className="btn-secondary" onClick={onDownloadTemplate}>
                    <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                    Скачать шаблон
                  </button>
                </>
              ) : (
                <p className="text-sm text-charcoal-500">Списки групп загружает администратор.</p>
              )
            }
          />
          <ol className="mx-auto grid max-w-4xl gap-3 px-4 pb-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl bg-charcoal-50/70 p-4 ring-1 ring-charcoal-100">
                <div className="flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-coral-500 text-sm font-bold text-white" aria-hidden="true">
                    {s.n}
                  </span>
                  <span className="text-sm font-semibold text-charcoal-900">{s.title}</span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-charcoal-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Search}
            title="Такой группы нет"
            description="Измените запрос или покажите все группы."
            action={
              <button type="button" className="btn-secondary" onClick={() => setQ("")}>
                Показать все группы
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((g) => (
            <GroupCard
              key={g.name || "__none"}
              g={g}
              isAdmin={isAdmin}
              exporting={exportingKey === g.name}
              onPractice={setPracticeFor}
              onContracts={setContractsFor}
              onExport={onExport}
            />
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <ImportStudentsWizard open={importOpen} onClose={() => setImportOpen(false)} onDone={load} onChanged={load} />
          <BulkPracticeModal
            open={!!practiceFor}
            group={practiceFor?.name}
            groupLabel={practiceFor ? groupLabelOf(practiceFor.name) : undefined}
            count={practiceFor?.students}
            onClose={() => setPracticeFor(null)}
            onDone={load}
          />
          <BulkContractsWizard
            open={!!contractsFor}
            group={contractsFor?.name}
            groupLabel={contractsFor ? groupLabelOf(contractsFor.name) : undefined}
            onClose={() => setContractsFor(null)}
            onDone={load}
          />
        </>
      )}
    </div>
  );
}
